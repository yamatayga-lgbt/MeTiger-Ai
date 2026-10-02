/**
 * Рейтинг смелых моделей — порт `data/brave.json` из Yama, переложенный на KV.
 *
 * Зачем. На «острых» темах модели ведут себя радикально по-разному: одна пишет
 * сразу, вторая упирается пятью ступенями обхода и съедает суточную квоту, а
 * человек ждёт. Раньше выбор был вслепую: пул перебирался в порядке конфига.
 * Теперь копим опыт — `провайдер/модель → сколько раз ответила прямо и сколько
 * отказала — — и первым делом пробуем тех, кто уже везёт.
 *
 * Чем это НЕ является. Никакого «режима без цензуры» тут нет и быть не может:
 * блокировки провайдеров мы не снимаем и не обещаем снять. Это порядок перебора
 * и ничего больше — `engine/freedom.js` (как говорить) остался ровно там, где был.
 *
 * Почему KV, а не файл. Pages Function не имеет диска, а изолятов много: файл
 * на одном изоляторе ничего бы не дал всем остальным. KV-запись — общий опыт,
 * и он дешёвый: один ключ, одно чтение на запрос, одна запись в минуту максимум
 * (бесплатный лимит KV — 1000 записей в сутки на неймспейс, и их же жрёт память
 * с лимитами; жечь их каждым ответом нельзя).
 */

export const BRAVE_KEY = 'models:brave';
/** Запись переживает 30 дней: привычки фильтров меняются вместе с версиями моделей. */
export const BRAVE_TTL_SEC = 30 * 24 * 3600;
/** Сколько записей храним. 400 — это ~12 КБ JSON, больше нечего: промахи по
    редким моделям ценнее, чем точный учёт по всем ста. */
export const BRAVE_MAX = 400;
/** Легче этого числа записей на ключ — пишем раз в минуту, а не на каждый ответ. */
const DEFAULT_WRITE_MS = 60000;
/* Сколько «старого» опыта тонем при каждом новом исходе. Без этого рейтинг
   закостеневает: модель, которая отказывала в марте и отвечает сейчас, осталась
   бы похоронена навечно. 0.98 — это ~полгода до почти полного забвения. */
const DECAY = 0.98;
/* До двух образцов доля — это монетка, а не статистика: не сортируем. */
const MIN_SAMPLES = 2;

const num = (x, dflt) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : dflt;
};
const round = (x) => Math.round(x * 100) / 100;
const keyOf = (provider, model) => String(provider || '') + '/' + String(model || '');

function decode(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return typeof raw === 'object' ? raw : null;
}

/**
 * Экземпляр на запрос — так же, как карантин: `pull()` до движка, `flush()` в
 * `waitUntil` после ответа. Без хранилища живёт в памяти изолята: меньше опыта,
 * но порядок всё равно лучше, чем случайный.
 */
export function createBrave(opts = {}) {
  const o = opts || {};
  const env = o.env || {};
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  const key = o.key || BRAVE_KEY;
  const maxWriteMs = Math.max(0, num(env.BRAVE_WRITE_MS, DEFAULT_WRITE_MS));
  const maxKeys = Math.max(20, num(env.BRAVE_MAX, BRAVE_MAX));
  const off = String(env.BRAVE || '').toLowerCase() === 'off';

  let data = Object.create(null);
  let loaded = false;
  let dirty = false;
  let lastWrite = 0;
  let writes = 0;
  let reads = 0;

  function entries() {
    return Object.entries(data);
  }

  /**
   * Записи, которым можно верить. Порог считается по ЧИСЛУ исходов (`n`), а не
   * по сумме весов: веса тонут от распада, и «два ответа» никогда не дали бы 2.0
   * — модель застряла бы в «неизвестных» навсегда.
   */
  function trusted(rec) {
    if (!rec) return null;
    const ok = num(rec.ok, 0), refused = num(rec.refused, 0);
    const total = ok + refused;
    const samples = num(rec.n, 0) || (ok > 0 || refused > 0 ? 2 : 0);
    if (samples < MIN_SAMPLES || total <= 0) return null;
    return { ok: round(ok), refused: round(refused), total: round(total), score: ok / total };
  }

  /** Срез протухшего и лишнего — и в памяти, и перед записью в KV. */
  function prune() {
    const t = now();
    for (const [k, rec] of entries()) {
      const at = num(rec && rec.at, 0);
      if (!at || t - at > BRAVE_TTL_SEC * 1000) delete data[k];
    }
    const keep = entries()
      .sort((a, b) => (num(b[1] && b[1].ok, 0) + num(b[1] && b[1].refused, 0)) - (num(a[1] && a[1].ok, 0) + num(a[1] && a[1].refused, 0)))
      .slice(0, maxKeys);
    if (keep.length !== entries().length) {
      data = Object.create(null);
      for (const [k, rec] of keep) data[k] = rec;
    }
  }

  async function pull() {
    if (off) return { on: false, why: 'BRAVE=off' };
    if (loaded) return { on: true, merged: Object.keys(data).length, cached: true };
    loaded = true;
    if (!store) return { on: true, merged: 0, why: 'хранилища нет — копим только в изоляте' };
    let rec = null;
    try {
      rec = decode(await store.get(key));
      reads++;
    } catch (e) {
      log('warn', 'рейтинг смелых не прочитан: ' + ((e && e.message) || e));
      return { on: true, merged: 0, error: true };
    }
    const list = rec && Array.isArray(rec.entries) ? rec.entries : [];
    for (const item of list) {
      if (!item || typeof item[0] !== 'string') continue;
      const v = item[1] || {};
      data[item[0]] = { ok: num(v.ok, 0), refused: num(v.refused, 0), n: num(v.n, 0), at: num(v.at, 0) };
    }
    prune();
    return { on: true, merged: Object.keys(data).length };
  }

  /** Исход: ответила (good=true) или уперлась. weight — прямой ответ ценнее. */
  function mark(provider, model, good, weight) {
    if (off || !model) return null;
    const k = keyOf(provider, model);
    const rec = data[k] || (data[k] = { ok: 0, refused: 0, n: 0, at: 0 });
    rec.ok = round(num(rec.ok, 0) * DECAY + (good ? num(weight, 1) : 0));
    rec.refused = round(num(rec.refused, 0) * DECAY + (good ? 0 : 1));
    rec.n = num(rec.n, 0) + 1;
    rec.at = now();
    dirty = true;
    return rec;
  }

  /** Доля прямых ответов. Неизвестная модель — середина: сначала пробуем, а не хороним. */
  function score(provider, model) {
    const t = trusted(data[keyOf(provider, model)]);
    return t ? t.score : 0.5;
  }

  /** Сырая запись, без порога доверия — для отладки и для «а вообще мы это видели?». */
  function raw(provider, model) {
    const rec = data[keyOf(provider, model)];
    if (!rec) return null;
    const total = num(rec.ok, 0) + num(rec.refused, 0);
    return { ok: round(num(rec.ok, 0)), refused: round(num(rec.refused, 0)), total: round(total), n: num(rec.n, 0), at: num(rec.at, 0) };
  }

  /** То, что показывается человеку: только доказательство, а не единичный случай. */
  function record(provider, model) {
    return trusted(data[keyOf(provider, model)]);
  }

  /** Лучшее, что известно про модель у ЛЮБОГО провайдера — для подписи в списке. */
  function anyOf(model) {
    const m = String(model || '');
    let best = null;
    let bestKey = '';
    for (const [k, rec] of entries()) {
      if (k.slice(k.indexOf('/') + 1) !== m) continue;
      const t = trusted(rec);
      if (!t) continue;
      if (!best || t.score > best.score || (t.score === best.score && t.total > best.total)) { best = t; bestKey = k; }
    }
    return best ? Object.assign({ provider: bestKey.slice(0, bestKey.indexOf('/')) }, best) : null;
  }

  /**
   * Порядок моделей внутри пула: смелые вперёд. Стабильно — модель без опыта
   * (0.5) остаётся там, где её поставил конфиг, и ничей результат её не сдвигает.
   */
  function order(list, provider) {
    const arr = Array.isArray(list) ? list.slice() : [];
    if (off || arr.length < 2) return arr;
    let known = 0;
    for (const m of arr) if (trusted(data[keyOf(provider, m)])) known++;
    if (!known) return arr;
    const rank = new Map(arr.map((m, i) => [m, i]));
    return arr.sort((a, b) => {
      const d = score(provider, b) - score(provider, a);
      return d !== 0 ? d : rank.get(a) - rank.get(b);
    });
  }

  /** Чем известен этот провайдер на острых темах (максимум по его пулу). */
  function bestOf(provider, list) {
    let best = null;
    for (const m of (Array.isArray(list) ? list : [])) {
      const t = trusted(data[keyOf(provider, m)]);
      if (t && (best === null || t.score > best)) best = t.score;
    }
    return best;
  }

  /** Порядок провайдеров на «острой» теме: доказанно смелые — первыми. */
  function orderProviders(order0, pools) {
    const arr = Array.isArray(order0) ? order0.slice() : [];
    if (off || arr.length < 2) return arr;
    const rank = new Map(arr.map((id, i) => [id, i]));
    const val = (id) => {
      const list = pools && typeof pools === 'object' ? pools[id] : null;
      const b = list ? bestOf(id, list) : null;
      return b === null ? 0.5 : b;
    };
    if (arr.every((id) => val(id) === 0.5)) return arr;   // доказательств нет — не трогаем
    return arr.sort((a, b) => {
      const d = val(b) - val(a);
      return d !== 0 ? d : rank.get(a) - rank.get(b);
    });
  }

  async function flush() {
    if (off || !dirty) return { on: !!store, wrote: false, why: off ? 'BRAVE=off' : 'менять нечего' };
    if (!store) return { on: false, wrote: false, why: 'хранилища нет' };
    const t = now();
    if (t - lastWrite < maxWriteMs) return { on: true, wrote: false, why: 'пишем не чаще раза в ' + Math.round(maxWriteMs / 1000) + ' с' };
    prune();
    const payload = { at: t, count: Object.keys(data).length, entries: entries().slice(0, maxKeys) };
    try {
      await store.put(key, payload, { expirationTtl: BRAVE_TTL_SEC });
      writes++;
      lastWrite = t;
      dirty = false;
      return { on: true, wrote: true, count: payload.count };
    } catch (e) {
      log('warn', 'рейтинг смелых не записан: ' + ((e && e.message) || e));
      return { on: true, wrote: false, error: String((e && e.message) || e) };
    }
  }

  function stats() {
    if (off) return { on: false, why: 'BRAVE=off' };
    const rows = [];
    for (const [k, rec] of entries()) {
      const t = trusted(rec);
      if (!t) continue;
      rows.push(Object.assign({ key: k }, t));
    }
    rows.sort((a, b) => (b.score - a.score) || (b.total - a.total));
    return {
      on: true,
      stored: !!store,
      keys: Object.keys(data).length,
      rated: rows.length,
      reads,
      writes,
      top: rows.slice(0, 5),
      scared: rows.filter((r) => r.score < 0.34).slice(0, 5),
    };
  }

  return { pull, flush, mark, score, record, raw, anyOf, order, orderProviders, bestOf, stats, keyOf };
}

/** Порядок «острой» темы: сначала те, про кого каталог говорит «без купюр».
    Меньше двух таких — не трогаем: лучше честный порядок пула, чем полпути к
    модели, которая не умеет ничего кроме этого ярлыка. */
export function preferUncensored(list, cat, min = 2) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (arr.length < 2 || !cat || !cat.byId) return arr;
  const hot = arr.filter((m) => cat.byId[m] && cat.byId[m].uncensored);
  if (hot.length < Math.min(min, arr.length)) return arr;
  return hot.concat(arr.filter((m) => hot.indexOf(m) < 0));
}

/** Одна строка для статусов и логов: «смелых 12 · лучший mistral/x 5/5». */
export function lineOf(st) {
  if (!st || !st.on) return 'рейтинг смелых: выключен';
  const top = st.top && st.top.length ? ' · лучший ' + st.top[0].key + ' ' + Math.round(st.top[0].ok) + '/' + Math.round(st.top[0].total) : '';
  const scared = st.scared && st.scared.length ? ' · упираются ' + st.scared.length : '';
  return 'смелых ' + st.rated + ' из ' + st.keys + (st.stored ? '' : ' (только в изоляте)') + top + scared;
}
