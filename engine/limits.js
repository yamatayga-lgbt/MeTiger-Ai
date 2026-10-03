/**
 * Общий слой: лимит частоты и карантин провайдеров, видимые всем изоляторам.
 *
 * Зачем. Pages создаёт воркер на запрос, тёплых изоляторов несколько, и то и другое
 * живёт в модульной `Map` — practically это значит, что «12 запросов в минуту»
 * превращается в 12 × N, а провайдер, поймавший 429, наказан только тому изолятору,
 * который его поймал. Остальные честно продолжают стучаться в мёртвую дверь и жечь
 * бесплатную квоту — ровно то, ради чего карантин и придуман.
 *
 * Хранилищем служит тот же KV-байндинг `MEMORY`, что и у памяти чата: две связки в
 * проекте не нужны. Без байндинга слой прозрачен — поведение остаётся прежним
 * (локальные Map), и наружу не уходит ни одного вызова.
 *
 * Экономия на бесплатных лимитах KV (100 000 чтений и 1 000 записей в сутки) —
 * часть дизайна, а не деталь:
 *   · обычный собеседник не стоит ни одной операции KV: чужой счётчик читаем,
 *     только когда кто-то подошёл к лимиту (`RATE_PROBE_AT`) и уже перешёл его;
 *   · маркер блокировки пишется не чаще одного раза на окно (`SHARED_WRITE_MS`),
 *     иначе назойливый клиент сам упрётся в 1 000 записей в сутки;
 *   · карантин: одно чтение на запрос и одна запись на наказание, а наказаний в
 *     норме нет вовсе.
 *
 * Все операции обёрнуты в try/catch: хранилище не имеет права сломать ответ.
 */

import { fnv1a } from './kvkey.js';

/** KV не принимает expirationTtl меньше 60 секунд — молча, ошибкой валидации. */
export const KV_MIN_TTL_SEC = 60;
export const KV_MAX_TTL_SEC = 60 * 60 * 24 * 30;

function num(env, name, def, min) {
  const v = Number(env && env[name]);
  return Number.isFinite(v) && v >= min ? v : def;
}

export function cfgOf(env) {
  const e = env || {};
  return {
    on: String(e.SHARED_LIMITS == null ? '1' : e.SHARED_LIMITS) !== '0',
    rateMax: num(e, 'RATE_MAX', 12, 1),
    rateWindowMs: num(e, 'RATE_WINDOW_MS', 60000, 5000),
    writeEveryMs: num(e, 'SHARED_WRITE_MS', 60000, 5000),
    probeAt: num(e, 'RATE_PROBE_AT', 3, 0),
    quarKey: String(e.SHARED_QUAR_KEY || 'quarantine:providers'),
    quarTtlMaxSec: num(e, 'QUAR_TTL_MAX', 3600, KV_MIN_TTL_SEC),
  };
}

/** Милисекунды жизни → секунды TTL с учетом каприза KV (не короче 60, не больше максимума). */
export function ttlSec(ms, maxSec) {
  const sec = Math.ceil((Number(ms) || 0) / 1000);
  const max = maxSec || KV_MAX_TTL_SEC;
  return Math.min(max, Math.max(KV_MIN_TTL_SEC, sec));
}

/**
 * Ключ бакета. Здесь НЕ `kvKey`: читаемого слагаемого в ip всё равно нет, а
 * «тот же клиент, а не кто он» — единственное, что слоям нужно. Один хэш, и в
 * хранилище не уезжает ни один адрес в открытом виде.
 */
export function rateKey(ip) { return 'rl:' + fnv1a(String(ip || 'anon')); }

/**
 * Счётчик «не чаще N запросов в окно». Локальная часть — синхронная и бесплатная,
 * общая — только для тех, кто подошёл к границе.
 */
export function createRateLimiter(opts) {
  const o = opts || {};
  const cfg = o.cfg || cfgOf(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  /* base — карта извне: в Pages воркер создаётся на запрос, и без общей карты
     «12 запросов в минуту» считалось бы заново в каждом запросе. */
  const local = o.base || new Map();
  let sharedReads = 0, sharedWrites = 0;

  async function check(ip) {
    const t = now();
    const who = String(ip || 'anon');
    const b = local.get(who) || { n: 0, t: t, w: 0 };
    if (t - b.t > cfg.rateWindowMs) { b.n = 0; b.t = t; }
    b.n += 1;
    const key = rateKey(who);
    let shared = false;
    /* Два момента, когда лезем в хранилище: начало окна (иначе спаммер, чьи запросы
       размазали по изоляторам, получит форочку — свежий изолятор ничего не про него
       не знает) и приближение к лимиту. Всё остальное время счётчик локальный и
       бесплатный. */
    const nearLimit = b.n === 1 || b.n > cfg.rateMax - cfg.probeAt;
    const canShare = !!store && cfg.on;

    if (canShare && nearLimit) {
      try {
        const rec = await store.get(key);
        sharedReads++;
        shared = true;
        /* Чужой маркер «этот клиент уже перебрал» действует, пока не истёк;
           своё окно локальный счётчик не обнуляет. */
        if (rec && typeof rec.blockedUntil === 'number' && rec.blockedUntil > t && b.n <= cfg.rateMax) {
          b.n = cfg.rateMax + 1;
        } else if (rec && typeof rec.n === 'number' && t - (rec.t || 0) <= cfg.rateWindowMs && rec.n > b.n) {
          b.n = rec.n;   /* изолятор нас не переживает: счёт уже ведётся другими */
        }
      } catch (e) {
        log('warn', 'общий лимит не прочитан: ' + ((e && e.message) || e));
      }
      if (b.n > cfg.rateMax && t - b.w >= cfg.writeEveryMs) {
        b.w = t;
        try {
          await store.put(key, { n: b.n, t: t, blockedUntil: t + cfg.rateWindowMs }, ttlSec(cfg.rateWindowMs, cfg.quarTtlMaxSec));
          sharedWrites++;
        } catch (e) {
          log('warn', 'маркер блокировки не записан: ' + ((e && e.message) || e));
        }
      }
    }
    local.set(who, b);
    return { limited: b.n > cfg.rateMax, n: b.n, shared: shared, near: nearLimit };
  }

  return {
    check: check,
    /* сколько KV-операций реально ушло — это то, что человек спросит при разборе
       «почему память кончилась на середине месяца» */
    stats: () => ({ on: cfg.on && !!store, ips: local.size, reads: sharedReads, writes: sharedWrites }),
    clear: () => local.clear(),
    cfg: cfg,
  };
}

/**
 * Карантин провайдеров. Возвращается объект, совместимый с Map по методу, которым
 * его трогает движок (get/set/delete/entries), — движок читает его синхронно внутри
 * обхода очереди, поэтому «попросить хранилище» там невозможно в принципе.
 * pull() и flush() дергает вход /api/chat: до обхода и после ответа.
 */
export function createQuarantine(opts) {
  const o = opts || {};
  const cfg = o.cfg || cfgOf(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  const local = o.base || new Map();
  let shared = Object.create(null);
  let dirty = false;
  let reads = 0, writes = 0;

  function alive(entry, t) { return !!entry && typeof entry.until === 'number' && entry.until > t; }
  function prune(t) {
    for (const [id, v] of [...local.entries()]) if (!alive(v, t)) local.delete(id);
  }

  async function pull() {
    if (!store || !cfg.on) return { on: false, merged: 0 };
    let rec = null;
    try { rec = await store.get(cfg.quarKey); reads++; }
    catch (e) { log('warn', 'карантин не прочитан: ' + ((e && e.message) || e)); return { on: true, merged: 0, error: true }; }
    const t = now();
    shared = rec && typeof rec === 'object' ? rec : Object.create(null);
    let merged = 0;
    for (const [id, v] of Object.entries(shared)) {
      if (!alive(v, t)) continue;
      const mine = local.get(id);
      /* берём более долгое наказание: чужой изолятор мог увидеть 429 раньше нас */
      if (!alive(mine, t) || mine.until < v.until) { local.set(id, { until: v.until, why: String(v.why || '').slice(0, 140) }); merged++; }
    }
    prune(t);
    return { on: true, merged: merged, known: Object.keys(shared).length };
  }

  async function flush() {
    if (!store || !cfg.on) return { written: false, on: false };
    if (!dirty) return { written: false, on: true };
    dirty = false;
    const t = now();
    const table = {};
    let nearest = 0;
    for (const src of [shared, Object.fromEntries(local)]) {
      for (const [id, v] of Object.entries(src || {})) {
        if (!alive(v, t)) continue;
        const cur = table[id];
        if (!cur || cur.until < v.until) table[id] = { until: v.until, why: String(v.why || '').slice(0, 140) };
        nearest = Math.max(nearest, v.until - t);
      }
    }
    try {
      if (!Object.keys(table).length) await store.delete(cfg.quarKey);
      else await store.put(cfg.quarKey, table, ttlSec(nearest, cfg.quarTtlMaxSec));
      writes++;
      shared = table;
      return { written: true, on: true, punished: Object.keys(table).length };
    } catch (e) {
      log('warn', 'карантин не записан: ' + ((e && e.message) || e));
      return { written: false, on: true, error: true };
    }
  }

  return {
    /* Map-совместимая часть — ровно то, что использует движок */
    get: (id) => local.get(id),
    has: (id) => local.has(id),
    set: (id, v) => { local.set(id, v); dirty = true; return this; },
    /* Снятие наказания обязано дожить до хранилища: движок делает delete, когда
       провайдер ожил. Если чинить только локальную карту, общее хранилище всю
       жизнь держало бы мёртвым того, кто давно живой (pull вернул бы его обратно). */
    delete: (id) => {
      const had = local.delete(id);
      if (had) { dirty = true; if (shared) delete shared[id]; }
      return had;
    },
    entries: () => local.entries(),
    get size() { return local.size; },
    clear: () => { local.clear(); if (shared) shared = Object.create(null); dirty = true; },
    pull: pull,
    flush: flush,
    stats: () => ({ on: cfg.on && !!store, local: local.size, reads: reads, writes: writes, dirty: dirty }),
    cfg: cfg,
  };
}

/** Что слой о себе знает — для диагностики в GET /api/chat. */
export function limitsInfo(env, store) {
  const cfg = cfgOf(env);
  return {
    on: cfg.on && !!store,
    why: !store ? 'нет связки MEMORY — лимиты живут в изоляторе'
      : !cfg.on ? 'SHARED_LIMITS=0' : '',
    rateMax: cfg.rateMax,
    windowMs: cfg.rateWindowMs,
    quarantineKey: cfg.quarKey,
  };
}
