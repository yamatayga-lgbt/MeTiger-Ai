/**
 * Суточный потолок на ОДИН адрес (0.224) — вторая дверь рядом с общей.
 *
 * Зачем. `engine/daycap.js` держит общий запас на всех (9 000 попыток в сутки), а
 * `engine/limits.js` — только частоту: 30 запросов в минуту. Вдвоём они защищают
 * плохо: скрипт с одного адреса в этом ритме выжигает общий запас примерно за
 * пять часов и выключает агента ВСЕМ до полуночи UTC. Замер 19.10.2026 на живом
 * проде: одно сообщение стоит 2–2,7 попытки к провайдерам (совет голов, запасная
 * голова, поиск), то есть 9 000 попыток — это всего ~3 500–4 000 сообщений на
 * весь сервис за сутки. Одному человеку такой кусок брать незачем.
 *
 * Как устроено — две ступени, а не одна:
 *   • мягкая (IP_DAY_CAP, по умолчанию 600 попыток): адрес отвечает дальше, но
 *     без совета голов и без глубокого исследования. Человек этого почти не
 *     замечает — обычному разговору совет голов не нужен вовсе, — а расход с
 *     одного сообщения падает с ~2,5 попытки до ~1,2;
 *   • жёсткая (IP_DAY_HARD, по умолчанию 1 500): до полуночи UTC этот адрес
 *     отдыхает, с честной причиной и временем сброса.
 *
 * Почему две, а не одна. Жёсткий потолок с порога в 600 попыток ловил бы живых
 * людей за мобильным оператором: в сотовых сетях за одним адресом (CGNAT) сидят
 * десятки абонентов. 600 попыток — это ~250 сообщений, столько не пишет никто;
 * но 10 активных людей на одном адресе — уже 2 200, и это не злоупотребление.
 * Поэтому мягкая ступень накрывает скрипт, не задевая людей, а жёсткая — только
 * того, кто продолжает жечь запас после предупреждения.
 *
 * Экономия на бесплатном KV — часть дизайна, как и в соседних слоях:
 * списание копится в памяти изолята и уходит в хранилище куском (25), а чтение
 * кэшируется на минуту; при отказе хранилища слой прозрачен (fail-open) — ответ
 * человеку важнее счётчика.
 */

import { fnv1a } from './kvkey.js';
import { msToUtcMidnight, capDayOf } from './daycap.js';

/** Мягкая ступень: после неё — без совета голов и исследования. */
export const IP_DAY_CAP_DEFAULT = 600;
/** Жёсткая ступень: после неё адрес отдыхает до полуночи UTC. */
export const IP_DAY_HARD_DEFAULT = 1500;
/** Кусок: сколько копим в памяти изолята перед записью в KV. */
export const IP_DAY_CHUNK = 25;
export const IP_DAY_KEY = 'ipcap:v1:';
/** Сколько верить своему кэшу прочтения — минута. */
export const IP_CACHE_MS = 60000;
/** Двое суток: запас на переход через полночь и запросы по старому ключу. */
export const IP_DAY_TTL_SEC = 60 * 60 * 48;

const num = (v, def, min) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

export function ipCfg(env) {
  const e = env || {};
  const soft = num(e.IP_DAY_CAP, IP_DAY_CAP_DEFAULT, 1);
  const hard = Math.max(soft + 1, num(e.IP_DAY_HARD, IP_DAY_HARD_DEFAULT, 1));
  return {
    /* IP_DAY_OFF=1 — вторая дверь выключена целиком (аварийный тумблер владельца). */
    on: String(e.IP_DAY_OFF || '') !== '1',
    soft,
    hard,
    chunk: Math.max(1, Math.floor(num(e.IP_DAY_CHUNK, IP_DAY_CHUNK, 1))),
    keyPrefix: String(e.IP_DAY_KEY || IP_DAY_KEY),
    cacheMs: Math.max(0, num(e.IP_DAY_CACHE_MS, IP_CACHE_MS, 0)),
    ttlSec: IP_DAY_TTL_SEC,
  };
}

/** Ключ: день + хэш адреса. Сам адрес в хранилище не уезжает — как у `rl:` в limits.js. */
export function ipKeyOf(day, ip, prefix) {
  return String(prefix || IP_DAY_KEY) + String(day) + ':' + fnv1a(String(ip || 'anon'));
}

/**
 * Экземпляр на запрос. `check()` — до движка, `take(n)` — после ответа,
 * `flush()` — хвост в KV (дверь зовёт из waitUntil), `peek()` — для панели.
 *
 * `base` — общая карта изолята: Pages создаёт воркер на запрос, и без неё каждый
 * запрос читал бы KV заново (а это 100 000 чтений в сутки на бесплатном тарифе).
 */
export function createIpCap(opts) {
  const o = opts || {};
  const cfg = o.cfg || ipCfg(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  const ip = String(o.ip || 'anon');
  const cache = o.base || new Map();

  let day = '';
  let key = '';
  let usedShared = 0;   // последнее известное из хранилища
  let pending = 0;      // накоплено этим изолятом, ещё не записано
  let spent = 0;        // этот изолят потратил всего (единственный счёт без KV)
  let cachedAt = 0;
  let degraded = false;
  let reads = 0, writes = 0;

  function rollover() {
    const d = capDayOf(now());
    if (d === day) return;
    day = d;
    key = ipKeyOf(day, ip, cfg.keyPrefix);
    usedShared = 0;
    pending = 0;
    spent = 0;
    cachedAt = 0;
  }

  function used() {
    rollover();
    return Math.max(usedShared, 0) + pending;
  }

  function state(extra) {
    rollover();
    const u = used();
    return Object.assign({
      on: cfg.on,
      day,
      used: u,
      softMax: cfg.on ? cfg.soft : 0,
      hardMax: cfg.on ? cfg.hard : 0,
      soft: cfg.on && u >= cfg.soft,
      blocked: cfg.on && u >= cfg.hard,
      resetInMs: msToUtcMidnight(now()),
      degraded,
    }, extra || {});
  }

  /** Своё прочтение — не чаще раза в минуту на пару «день + адрес». */
  async function readUsed() {
    rollover();
    const hit = cache.get(key);
    if (hit && now() - hit.at < cfg.cacheMs) {
      usedShared = Math.max(usedShared, hit.used || 0);
      return usedShared;
    }
    if (!store) { degraded = true; return usedShared; }
    try {
      const rec = await store.get(key);
      reads++;
      const was = rec && typeof rec.used === 'number' ? Math.max(0, rec.used) : 0;
      usedShared = Math.max(usedShared, was);
      cache.set(key, { used: usedShared, at: now() });
      return usedShared;
    } catch (e) {
      degraded = true;
      log('warn', 'потолок адреса не прочитан: ' + ((e && e.message) || e));
      return usedShared;
    }
  }

  /** Дописать накопленное в KV. Никогда не бросает. */
  async function flush() {
    rollover();
    if (!cfg.on || pending <= 0) return state();
    if (!store) { degraded = true; pending = 0; return state(); }
    const add = pending;
    pending = 0;
    try {
      const rec = await store.get(key);
      reads++;
      const was = rec && typeof rec.used === 'number' ? Math.max(0, rec.used) : 0;
      const next = Math.min(cfg.hard + cfg.chunk, was + add);
      await store.put(key, { used: next, day }, cfg.ttlSec);
      writes++;
      usedShared = next;
      cache.set(key, { used: next, at: now() });
    } catch (e) {
      /* Запись не вышла — хвост возвращаем, чтобы state() не врал «0». */
      pending += add;
      degraded = true;
      log('warn', 'потолок адреса не записан: ' + ((e && e.message) || e));
    }
    return state();
  }

  /** Можно ли идти дальше и не пора ли урезать дорогие шаги. */
  async function check() {
    rollover();
    if (!cfg.on) return state({ allowed: true });
    await readUsed();
    const u = used();
    if (u >= cfg.hard) return state({ allowed: false });
    return state({ allowed: true });
  }

  /** Списать попытки этого ответа. Никогда не бросает: ответ уже у человека. */
  async function take(n) {
    rollover();
    if (!cfg.on) return state();
    const k = Math.max(1, Math.floor(Number(n) || 1));
    spent += k;
    pending += k;
    if (store && pending >= cfg.chunk) await flush();
    return state();
  }

  /** Сколько потрачено — без списания. Для панели владельца. */
  async function peek() {
    rollover();
    if (!cfg.on) return state();
    if (!store) { degraded = true; return state(); }
    await readUsed();
    return state();
  }

  return {
    check,
    take,
    flush,
    peek,
    state,
    stats: () => ({ on: cfg.on, soft: cfg.soft, hard: cfg.hard, reads, writes, degraded, pending, spent }),
    cfg,
  };
}

/** Общая карта кэша: одна на изолят, как у createRateLimiter (см. limits.js). */
export const IP_CACHE = new Map();
