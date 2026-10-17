/**
 * Суточный потолок агента (0.202) — общий запас на ВСЕХ людей, а не на адрес.
 *
 * Зачем. `engine/limits.js` считает частоту по IP: 30 запросов в минуту — это
 * ~43 000 в сутки с ОДНОГО адреса, а весь бесплатный пул — около 9 900 попыток
 * до провайдеров. Значит десять адресов, стучащих в ритме лимита, выключают
 * бесплатного агента до полуночи UTC — для всех, включая владельца. Частотный
 * лимит от этого не спасает по устройству: он про «не части», а не «не всё».
 *
 * Как устроено. Бюджет не считаем на каждый запрос — это 9 900 записей в KV при
 * бесплатных 1 000 в сутки. Изолят РЕЗЕРВИРУЕТ кусок (по умолчанию 50 попыток)
 * на всё хранилище и тратит его из памяти; когда кусок кончился — резервирует
 * следующий. Записей за сутки получается около max/chunk (180 из 1 000 бесплатных),
 * а потолок всё равно общий: сумма резервов не может перевалить за max. Кусок
 * не берём крупнее: резерв сразу виден в проценте кольца, и на 100 он прыгал бы
 * на 1,1 % при одном-единственном вопросе.
 *
 * Чего это НЕ обещает. Атомарного счётчика у KV нет: два изолята могут прочитать
 * одно число и записать одно и то же — тогда резерв «потеряется», и потолок
 * сдвинется на этот кусок. Поэтому max берётся с запасом от ёмкости пула
 * (9 000 против ~9 900), а не впритык. Это честнее, чем обещать точность,
 * которой у бесплатного KV нет.
 *
 * Отказ хранилища НЕ выключает агента: без KV потолок держится только внутри
 * изолятора (и помечается degraded). Лучше ответить человеку, чем показать
 * «лимит кончился» из-за недоступного KV.
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
 * Экземпляр на запрос. `check()` — перед движком, `take(n)` — после ответа:
 * потолок считается в попытках к провайдерам, потому что пул измеряется ими же.
 */
export function createDayCap(opts) {
  const o = opts || {};
  const cfg = o.cfg || capCfg(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});

  let day = '';          // сутки, под которые взяты локальные состояния ниже
  let have = 0;          // зарезервировано, но ещё не потрачено этим изолятором
  let usedShared = 0;    // последний известный общий резерв в хранилище
  let spent = 0;         // сколько потрачено этим изолятором (без KV — единственный счёт)
  let degraded = false;  // хранилище не ответило: держимся локальным пределом
  let blocked = false;   // потолок объявлен исчерпанным (до смены суток)
  let reads = 0, writes = 0;

  function rollover() {
    const d = capDayOf(now());
    if (d === day) return;
    day = d;
    have = 0;
    usedShared = 0;
    spent = 0;
    blocked = false;
  }

  function state(extra) {
    rollover();
    /* «Израсходовано» — это резерв, а не только потраченное: запас уже отнят у
       всех, даже если этот изолят его ещё не истратил. Собственный расход берём
       вторым слагаемым — без хранилища и после его отказа он единственный. */
    const used = Math.max(0, usedShared, spent);
    return Object.assign({
      on: cfg.on,
      day,
      max: cfg.on ? cfg.max : 0,
      used: Math.min(used, cfg.on ? cfg.max : used),
      remaining: cfg.on ? Math.max(0, cfg.max - used) : null,
      chunk: cfg.chunk,
      resetInMs: msToUtcMidnight(now()),
      degraded,
      blocked,
    }, extra || {});
  }

  /** Выдать кусок из памяти изолятора: без хранилища и когда оно отказало. */
  function grantLocal() {
    const grant = Math.min(cfg.chunk, Math.max(0, cfg.max - spent - have));
    if (grant <= 0) { blocked = true; return 0; }
    have += grant;
    return grant;
  }

  /** Взять у хранилища ещё один кусок. true — бюджет есть, false — исчерпан. */
  async function reserve() {
    if (!cfg.on) return true;
    if (blocked) return false;
    if (!store) {
      /* Без связки MEMORY резервировать нечего: потолок держим по памяти изолятора —
         кусок «выдаём» себе сами, иначе списание не с чего начинать. */
      degraded = true;
      if (grantLocal() <= 0) return false;
      return true;
    }
    const key = capKeyOf(day, cfg.keyPrefix);
    let used = usedShared;
    try {
      const rec = await store.get(key);
      reads++;
      if (rec && typeof rec.used === 'number' && rec.used >= 0) used = rec.used;
      else used = 0;
    } catch (e) {
      degraded = true;
      log('warn', 'суточный потолок не прочитан: ' + ((e && e.message) || e));
      if (grantLocal() <= 0) return false;
      return true;
    }
    if (used >= cfg.max) {
      usedShared = used;
      blocked = true;
      return false;
    }
    /* Последний кусок может быть меньше обычного — не теряем остаток. */
    const grant = Math.min(cfg.chunk, cfg.max - used);
    try {
      await store.put(key, { used: used + grant, day }, cfg.ttlSec);
      writes++;
    } catch (e) {
      degraded = true;
      log('warn', 'суточный потолок не записан: ' + ((e && e.message) || e));
      if (grantLocal() <= 0) return false;
      return true;
    }
    usedShared = used + grant;
    have += grant;
    return true;
  }

  /** Можно ли идти дальше. true — в запасе есть хотя бы одна попытка. */
  async function check() {
    rollover();
    if (!cfg.on) return Object.assign(state(), { allowed: true });
    if (have > 0) return Object.assign(state(), { allowed: true });
    const okReserve = await reserve();
    return Object.assign(state(), { allowed: !!okReserve && have > 0 });
  }

  /** Списать потраченные попытки. Никогда не бросает: ответ уже у человека. */
  async function take(n) {
    rollover();
    const k = Math.max(1, Math.floor(Number(n) || 1));
    if (!cfg.on) return state();
    let left = k;
    while (left > 0) {
      if (have <= 0) {
        const got = await reserve();
        if (!got) break;
        if (have <= 0) break;
      }
      const use = Math.min(have, left);
      have -= use;
      spent += use;
      left -= use;
    }
    return state();
  }

  /** Сколько уже потрачено — без резервирования. Для диагностики и панели. */
  async function peek() {
    rollover();
    if (!cfg.on) return state();
    if (!store) { degraded = true; return state(); }
    try {
      const rec = await store.get(capKeyOf(day, cfg.keyPrefix));
      reads++;
      const used = rec && typeof rec.used === 'number' ? Math.max(0, rec.used) : 0;
      usedShared = Math.max(usedShared, used);
    } catch (e) {
      degraded = true;
      log('warn', 'суточный потолок не прочитан: ' + ((e && e.message) || e));
    }
    return state();
  }

  return {
    check,
    take,
    peek,
    state,
    stats: () => ({ on: cfg.on, max: cfg.max, chunk: cfg.chunk, reads, writes, degraded, have, spent }),
    cfg,
  };
}
