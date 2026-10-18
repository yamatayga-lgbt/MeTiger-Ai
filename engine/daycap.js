/**
 * Суточный потолок агента (0.202, правка 0.220) — общий запас на ВСЕХ людей.
 *
 * Зачем. `engine/limits.js` считает частоту по IP: 30 запросов в минуту — это
 * ~43 000 в сутки с ОДНОГО адреса, а весь бесплатный пул — около 9 900 попыток
 * до провайдеров. Без потолка десять адресов в ритме лимита выключали агента
 * всем до полуночи UTC.
 *
 * 0.220. Раньше изолят РЕЗЕРВИРОВАЛ кусок (50) в KV ещё до ответа, а тратил
 * его из памяти. На Cloudflare каждый холодный запуск — новый изолят: он
 * откусывал 50, тратил 1–3, умирал — и 47 сгорали навсегда. 184 живых попытки
 * выглядели как половина дневного запаса. Теперь в KV пишется только то, что
 * реально ушло к провайдерам. Кусок 50 остаётся экономией записей ВНУТРИ
 * одного изолята (сто take подряд — две записи), а не платой за холодный старт.
 *
 * check() только смотрит счётчик, не резервирует. take(n) копит списание;
 * flush() (или набор до размера куска) записывает его. Атомарного счётчика у KV
 * нет — два изолята могут перезаписать одно число; потолок 9 000 против ~9 900
 * ёмкости пула, небольшой недосчёт честнее, чем ложный «день кончился».
 *
 * Отказ хранилища НЕ выключает агента: без KV потолок держится в памяти изолята.
 */

export const DAY_CAP_DEFAULT = 9000;
export const DAY_CAP_CHUNK = 50;
export const DAY_CAP_KEY = 'cap:v1:';
/** Двое суток: запас на переход через полночь UTC и на запросы по старому ключу. */
export const DAY_CAP_TTL_SEC = 60 * 60 * 48;

const num = (v, def, min) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

/** Сутки UTC — те же, по которым считаются квоты провайдеров. */
export function capDayOf(t) {
  return new Date(Number(t) || Date.now()).toISOString().slice(0, 10);
}

/** Миллисекунды до полуночи UTC: когда запас начнётся заново. */
export function msToUtcMidnight(t) {
  const d = new Date(Number(t) || Date.now());
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return next - d.getTime();
}

export function capCfg(env) {
  const e = env || {};
  const max = num(e.DAY_CAP, DAY_CAP_DEFAULT, 0);
  return {
    /* DAY_CAP_OFF=1 — потолок выключен целиком (аварийный тумблер владельца). */
    on: String(e.DAY_CAP_OFF || '') !== '1' && max > 0,
    max,
    chunk: Math.max(1, Math.floor(num(e.DAY_CAP_CHUNK, DAY_CAP_CHUNK, 1))),
    keyPrefix: String(e.DAY_CAP_KEY || DAY_CAP_KEY),
    ttlSec: DAY_CAP_TTL_SEC,
  };
}

export function capKeyOf(day, prefix) {
  return String(prefix || DAY_CAP_KEY) + String(day);
}

/**
 * Экземпляр на запрос. `check()` — перед движком, `take(n)` — после ответа,
 * `flush()` — дописать хвост в KV (дверь зовёт из waitUntil).
 */
export function createDayCap(opts) {
  const o = opts || {};
  const cfg = o.cfg || capCfg(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});

  let day = '';
  let usedShared = 0;  // последний известный общий расход в хранилище
  let pending = 0;     // потрачено этим изолятом, ещё не записано
  let spent = 0;       // потрачено этим изолятом всего (без KV — единственный счёт)
  let degraded = false;
  let blocked = false;
  let reads = 0, writes = 0;

  function rollover() {
    const d = capDayOf(now());
    if (d === day) return;
    day = d;
    usedShared = 0;
    pending = 0;
    spent = 0;
    blocked = false;
  }

  function booked() {
    return Math.max(0, usedShared + pending, spent);
  }

  function state(extra) {
    rollover();
    const used = Math.min(booked(), cfg.on ? cfg.max : booked());
    return Object.assign({
      on: cfg.on,
      day,
      max: cfg.on ? cfg.max : 0,
      used,
      remaining: cfg.on ? Math.max(0, cfg.max - used) : null,
      chunk: cfg.chunk,
      resetInMs: msToUtcMidnight(now()),
      degraded,
      blocked,
    }, extra || {});
  }

  async function readUsed() {
    if (!store) {
      degraded = true;
      return spent;
    }
    try {
      const rec = await store.get(capKeyOf(day, cfg.keyPrefix));
      reads++;
      const used = rec && typeof rec.used === 'number' ? Math.max(0, rec.used) : 0;
      usedShared = Math.max(usedShared, used);
      return usedShared;
    } catch (e) {
      degraded = true;
      log('warn', 'суточный потолок не прочитан: ' + ((e && e.message) || e));
      return Math.max(usedShared, spent);
    }
  }

  /** Дописать pending в KV. Никогда не бросает. */
  async function flush() {
    rollover();
    if (!cfg.on || pending <= 0) return state();
    if (!store) {
      degraded = true;
      pending = 0;
      if (spent >= cfg.max) blocked = true;
      return state();
    }
    const key = capKeyOf(day, cfg.keyPrefix);
    const add = pending;
    pending = 0;
    try {
      const rec = await store.get(key);
      reads++;
      const used = rec && typeof rec.used === 'number' ? Math.max(0, rec.used) : 0;
      const next = Math.min(cfg.max, used + add);
      await store.put(key, { used: next, day }, cfg.ttlSec);
      writes++;
      usedShared = next;
      if (usedShared >= cfg.max) blocked = true;
    } catch (e) {
      /* Запись не вышла — возвращаем хвост в pending, чтобы state() не врал
         «списано 0», и продолжаем по памяти изолята. */
      pending += add;
      degraded = true;
      log('warn', 'суточный потолок не записан: ' + ((e && e.message) || e));
      if (spent >= cfg.max) blocked = true;
    }
    return state();
  }

  /** Можно ли идти дальше. Смотрит счётчик, кусок заранее не откусывает. */
  async function check() {
    rollover();
    if (!cfg.on) return Object.assign(state(), { allowed: true });
    if (blocked) return Object.assign(state(), { allowed: false });
    const used = await readUsed();
    const nowUsed = Math.max(used, spent) + pending;
    if (nowUsed >= cfg.max) {
      blocked = true;
      return Object.assign(state(), { allowed: false });
    }
    return Object.assign(state(), { allowed: true });
  }

  /** Списать потраченные попытки. Никогда не бросает: ответ уже у человека. */
  async function take(n) {
    rollover();
    const k = Math.max(1, Math.floor(Number(n) || 1));
    if (!cfg.on) return state();
    const room = Math.max(0, cfg.max - booked());
    const use = Math.min(k, room);
    if (use <= 0) { blocked = true; return state(); }
    spent += use;
    pending += use;
    if (booked() >= cfg.max) blocked = true;
    if (store && pending >= cfg.chunk) await flush();
    return state();
  }

  /** Сколько уже потрачено — без списания. Для панели. */
  async function peek() {
    rollover();
    if (!cfg.on) return state();
    if (!store) { degraded = true; return state(); }
    await readUsed();
    if (usedShared >= cfg.max) blocked = true;
    return state();
  }

  return {
    check,
    take,
    flush,
    peek,
    state,
    stats: () => ({ on: cfg.on, max: cfg.max, chunk: cfg.chunk, reads, writes, degraded, pending, spent }),
    cfg,
  };
}
