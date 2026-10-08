/**
 * Учёт расхода провайдеров: сколько запросов ушло, чем это кончилось и кто на паузе.
 *
 * Зачем отдельный слой. У бесплатных провайдеров квоты суточные (OpenRouter 50,
 * Gemini 250, остальные 900–1000 на ключ), а наружу «сколько уже израсходовано» не
 * выходило никогда: движок знал это про ключи внутри одного запроса, человек — нет.
 * Отсюда панель «Использование и Лимиты»: счётчик в день по каждому провайдеру,
 * счётчик в минуту и текущие паузы.
 *
 * Точность честная, а не показная. Атомарного счётчика в KV у Cloudflare нет, а
 * Pages Functions крутятся в разных изолятax: каждый считает своё и прибавляет к
 * тому, что уже лежит в хранилище (read-modify-write), не чаще раза в
 * `USAGE_WRITE_MS`. Цена другой схемы — запись в KV на каждый запрос, а это
 * 1000 записей в сутки на бесплатном тарифе, то есть счётчик съел бы ровно ту
 * квоту, которую считает. Поэтому:
 *
 *   • «в день»     — сложение изолятов, точное до последней минуты записи;
 *   • «в минуту»   — нижняя оценка (по минутным маркам хранилища и своей памяти);
 *   • «своё сейчас»— мгновенное: то, что этот изолят накопил с прошлой записи,
 *                   видно сразу, не дожидаясь KV.
 *
 * Сутки считаются по UTC — так же, как у провайдеров; в панели это написано, чтобы
 * «счётчик сбросился в 03:00 по Минску» не выглядело поломкой.
 *
 *   USAGE=0            выключить слой целиком (счётчики останутся в памяти изолята)
 *   USAGE_WRITE_MS     пауза между записями в KV (пол 10000)
 *   USAGE_READ_MS      сколько держать прочитанное из KV, прежде чем спросить снова
 *   USAGE_RPM          переопределить справочные потолки «в минуту» строкой JSON
 */
import { ttlSec } from './limits.js';

/** Сколько живёт суточная запись в хранилище: сутки + запас на переход через полночь. */
export const USAGE_DAY_TTL_SEC = 2 * 24 * 3600;

/**
 * Справочные потолки «в минуту» по провайдеру. Это ориентир для панели, а не
 * юридически точная цифра тарифа: у провайдеров RPM менялся (Groq 30, Gemini 15,
 * OdiRouter отвечает 429 уже на 6-м запросе в минуту), поэтому число подписано в
 * интерфейсе как «справочно» и переопределяется `USAGE_RPM` без правки кода.
 * Суточный потолок берётся не отсюда, а из таблицы провайдеров (providers.js).
 */
export const PROVIDER_RPM = {
  gemini: 15,
  groq: 30,
  mistral: 60,
  openrouter: 20,
  cloudflare: 60,
  xkiro: 30,
  zai: 30,
  atria: 20,
  sharellm: 20,
  odirouter: 15,
  /* 0.099. LLM7 без ключа держит около 15 запросов в минуту на адрес
     («Retry after 3 seconds» — из живых проб). Kilo лимит не публикует, ставим
     осторожные 10. */
  llm7: 15,
  kilo: 10,
};

function envNum(env, name, def, min) {
  const raw = env && env[name];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min == null ? 0 : min, Math.round(n));
}

/** Строка суток по UTC — та же, чем живут суточные квоты провайдеров. */
export function dayKeyOf(t) {
  return new Date(Number(t) || Date.now()).toISOString().slice(0, 10);
}

/** Номер минуты — по нему видно, «та же минута» в хранилище или уже прошлая. */
export function minuteOf(t) {
  return Math.floor((Number(t) || Date.now()) / 60000);
}

/**
 * Хранилище для счётчиков. Подходит и настоящий KV-байндинг (`env.MEMORY`), и
 * подставная карта из тестов: нужны только `get`/`put`. Значение читается
 * терпимо к форме — так же, как это делает `limitsStore` в functions/api/chat.js:
 * настоящий KV отдаёт строку, локальная заглушка — уже разобранный объект.
 */
export function storeOf(env) {
  const kv = env && (env.USAGE_STORE || env.MEMORY);
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  return {
    get: (key) => Promise.resolve(kv.get(key)).then((raw) => {
      if (raw == null) return null;
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }, () => null),
    put: (key, value, opts) => Promise.resolve(kv.put(key, JSON.stringify(value), opts))
      .then(() => true, () => false),
  };
}

function blankRow() {
  return { attempt: 0, ok: 0, refused: 0, dead: 0, lastAt: 0, model: '', pause: null };
}

/**
 * Счётчик расхода. Один экземпляр на изолят (см. `sharedUsage`), состояние:
 *   local   — всё, что этот изолят видел с момента запуска (мгновенный срез);
 *   pending — то, что ещё не уехало в KV (его прибавляем к хранилищу при записи);
 *   base    — последнее прочитанное из KV (с учётом уже записанного нами).
 */
export function createUsage(opts = {}) {
  const env = opts.env || {};
  const store = opts.store !== undefined ? opts.store : storeOf(env);
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const mode = String(env.USAGE == null ? '' : env.USAGE).toLowerCase();
  const off = mode === '0' || mode === 'off';
  /* Пауза записи по умолчанию 30 с, а не 60, как у общих маркеров лимитов: панель
     обещает живой счётчик, и задержка в минуту на «сколько уже ушло сегодня»
     выглядит поломкой. 30 с — это 2 записи в минуту на изолят; на бесплатном KV
     (1000 записей в сутки) хватает с запасом, а на случай всплеска есть
     USAGE_WRITE_MAX: счётчик не имеет права съесть бюджет, который считает. */
  const writeMs = envNum(env, 'USAGE_WRITE_MS', 30000, 10000);
  const readMs = envNum(env, 'USAGE_READ_MS', 15000, 0);
  const writeCap = envNum(env, 'USAGE_WRITE_MAX', 300, 0);
  const rpmOverride = (() => {
    try {
      const raw = env && env.USAGE_RPM;
      if (!raw) return null;
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) { return null; }
  })();

  const local = new Map();
  const pending = new Map();
  let day = dayKeyOf(now());
  let base = { day, providers: {} };
  let baseAt = 0;
  let lastWrite = 0;
  let writes = 0;
  let reads = 0;
  let skipped = 0;
  let dirty = false;

  function rollIfNeeded() {
    const d = dayKeyOf(now());
    if (d === day) return false;
    /* Смена суток: старые счётчики больше не «сегодня», а переносить их в новую
       запись нельзя — иначе день начинался бы с чужого расхода. */
    day = d;
    local.clear();
    pending.clear();
    base = { day, providers: {} };
    baseAt = 0;
    dirty = false;
    return true;
  }

  function loc(id) {
    let v = local.get(id);
    if (!v) { v = { attempt: 0, ok: 0, refused: 0, dead: 0, lastAt: 0, model: '', stamps: [] }; local.set(id, v); }
    return v;
  }

  function pend(id) {
    let v = pending.get(id);
    if (!v) { v = { attempt: 0, ok: 0, refused: 0, dead: 0, pause: null, stamps: 0 }; pending.set(id, v); }
    return v;
  }

  /** Один исходящий запрос к провайдеру. Ставится до сети — попытка важна и тогда,
   *  когда провайдер ответил отказом, таймаутом или не ответил вовсе. */
  function attempt(id, model) {
    if (off || !id) return;
    rollIfNeeded();
    const t = now();
    const l = loc(id);
    l.attempt++;
    l.lastAt = t;
    if (model) l.model = String(model).slice(0, 80);
    l.stamps.push(t);
    if (l.stamps.length > 400) l.stamps.splice(0, l.stamps.length - 400);
    const p = pend(id);
    p.attempt++;
    p.stamps++;
    dirty = true;
  }

  /** Чем кончилась попытка: ok · refused (ответ-отказ) · dead (429/401/квота). */
  function outcome(id, kind) {
    if (off || !id) return;
    const key = kind === 'ok' ? 'ok' : kind === 'refused' ? 'refused' : kind === 'dead' ? 'dead' : '';
    if (!key) return;
    rollIfNeeded();
    const l = loc(id);
    l[key]++;
    pend(id)[key]++;
    dirty = true;
  }

  /** Провайдер ушёл в карантин: пишем маркером в ту же суточную запись. */
  function pause(id, why, ms) {
    if (off || !id) return;
    rollIfNeeded();
    loc(id);
    pend(id).pause = {
      until: now() + Math.max(1000, Number(ms) || 0),
      why: String(why || '').slice(0, 140),
    };
    dirty = true;
  }

  /** Сколько запросов этого изолята случилось за последнюю минуту. */
  function minuteCount(id) {
    const l = local.get(id);
    if (!l) return 0;
    const t = now();
    return l.stamps.filter((x) => t - x < 60000).length;
  }

  function keyOf(d) { return 'usage:day:' + (d || day); }

  async function pull(o = {}) {
    if (!store || off) { baseAt = now(); return base; }
    if (!o.force && baseAt && now() - baseAt < readMs) return base;
    rollIfNeeded();
    const got = await store.get(keyOf());
    reads++;
    baseAt = now();
    base = (got && got.day === day && got.providers && typeof got.providers === 'object')
      ? { day, providers: got.providers }
      : { day, providers: {} };
    return base;
  }

  /**
   * Запись в KV. Не чаще `USAGE_WRITE_MS` и только когда есть что писать:
   * складываем свежепрочитанное с нашей пачкой, поэтому чужие изоляты не стираются.
   */
  async function flush(o = {}) {
    if (off) return { written: false, why: 'USAGE=0 — слой выключен' };
    if (!store) return { written: false, why: 'нет хранилища (байндинг MEMORY не подключён)' };
    rollIfNeeded();
    if (!dirty || !pending.size) return { written: false, why: 'нечего писать' };
    if (writeCap && writes >= writeCap) {
      skipped++;
      return { written: false, why: 'берегу бюджет записей KV (потолок ' + writeCap + ' на изолят)' };
    }
    const t = now();
    if (!o.force && lastWrite && t - lastWrite < writeMs) {
      skipped++;
      return { written: false, why: 'пауза между записями (' + writeMs + ' мс)', inMs: writeMs - (t - lastWrite) };
    }
    /* Пачку забираем себе до сети: пока идёт запись, движок уже может считать
       следующую попытку — её терять нельзя, она уйдёт следующей записью. */
    const batch = new Map(pending);
    pending.clear();
    const fresh = await pull({ force: true });
    const next = { day, providers: {} };
    for (const id of Object.keys(fresh.providers || {})) {
      next.providers[id] = Object.assign(blankRow(), fresh.providers[id]);
    }
    const minute = minuteOf(t);
    for (const [id, d] of batch) {
      const row = next.providers[id] || (next.providers[id] = blankRow());
      row.attempt += d.attempt;
      row.ok += d.ok;
      row.refused += d.refused;
      row.dead += d.dead;
      const seen = minuteCount(id);
      /* Минутная марка живёт до истечения своей минуты, а не до смены номера минуты:
         запись «2 запроса в 12:00:59» обязана быть видна и в 12:01:20 — иначе панель
         показывала бы ноль сразу после того, как запросы реально были. */
      const had = row.min && row.min.until > t ? row.min.n : 0;
      row.min = { at: minute, n: Math.max(had, seen), until: t + 60000 };
      if (local.get(id) && local.get(id).lastAt) row.lastAt = Math.max(row.lastAt || 0, local.get(id).lastAt);
      if (local.get(id) && local.get(id).model) row.model = local.get(id).model;
      if (d.pause) row.pause = d.pause;
    }
    next.at = t;
    const ok = await store.put(keyOf(), next, { expirationTtl: ttlSec(USAGE_DAY_TTL_SEC * 1000, USAGE_DAY_TTL_SEC) });
    if (!ok) {
      /* Хранилище отказало — пачку возвращаем, чтобы она не пропала молча. */
      for (const [id, d] of batch) {
        const p = pend(id);
        p.attempt += d.attempt;
        p.ok += d.ok;
        p.refused += d.refused;
        p.dead += d.dead;
        if (d.pause) p.pause = d.pause;
      }
      dirty = true;
      return { written: false, why: 'хранилище отказало' };
    }
    base = next;
    baseAt = t;
    lastWrite = t;
    writes++;
    dirty = false;
    return { written: true, at: t, rows: batch.size };
  }

  /** Срез для панели: хранилище + незаписанное. Ничего не пишет и в сеть не ходит. */
  function snapshot(o = {}) {
    rollIfNeeded();
    const t = now();
    const minute = minuteOf(t);
    const ids = [];
    const push = (id) => { if (id && ids.indexOf(id) < 0) ids.push(id); };
    for (const id of Object.keys((base && base.providers) || {})) push(id);
    for (const id of local.keys()) push(id);
    for (const id of pending.keys()) push(id);
    const rows = {};
    const totals = { attempt: 0, ok: 0, refused: 0, dead: 0 };
    for (const id of ids) {
      const b = (base && base.providers && base.providers[id]) || null;
      const l = local.get(id) || null;
      const p = pending.get(id) || null;
      const row = {
        attempt: (b ? b.attempt || 0 : 0) + (p ? p.attempt || 0 : 0),
        ok: (b ? b.ok || 0 : 0) + (p ? p.ok || 0 : 0),
        refused: (b ? b.refused || 0 : 0) + (p ? p.refused || 0 : 0),
        dead: (b ? b.dead || 0 : 0) + (p ? p.dead || 0 : 0),
        minute: Math.max(minuteCount(id), b && b.min && b.min.until > t ? b.min.n : 0),
        lastAt: Math.max(b ? b.lastAt || 0 : 0, l ? l.lastAt || 0 : 0),
        model: (l && l.model) || (b && b.model) || '',
      };
      const pause = (p && p.pause) || (b && b.pause) || null;
      row.pause = pause && pause.until > t ? pause : null;
      row.live = !!(l && l.attempt);
      rows[id] = row;
      totals.attempt += row.attempt;
      totals.ok += row.ok;
      totals.refused += row.refused;
      totals.dead += row.dead;
    }
    return {
      day,
      at: t,
      providers: rows,
      totals,
      rpm: Object.assign({}, PROVIDER_RPM, rpmOverride || {}),
      writeMs,
      readMs,
      writeCap,
      store: !!store,
      off,
      dirty,
      unsaved: pending.size,
      writes,
      reads,
      skipped,
    };
  }

  return {
    attempt, outcome, pause, snapshot, pull, flush,
    stats: () => ({ day, store: !!store, off, writeMs, readMs, writeCap, writes, reads, skipped, dirty, providers: local.size }),
    keyOf,
  };
}

/* Общий слой на изолят — как sharedImggen: движок создаётся на каждый запрос, и
   без общей карты счётчик терял бы всё, что накопил между запросами (а вместе с
   ним и смысл паузы между записями в KV). */
let shared = null;

export function sharedUsage(env, store) {
  if (!shared) shared = createUsage({ env: env || {}, store });
  return shared;
}

/** Сбросить общий слой — для тестов и для смены окружения. */
export function resetSharedUsage() {
  shared = null;
}
