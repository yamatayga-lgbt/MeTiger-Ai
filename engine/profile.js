/**
 * Профиль человека и адрес памяти. Память — личная, а не общая на всех.
 *
 * Зачем. Продукт открытый: им будут пользоваться не только владелец. А память до
 * сих пор висела на ключе `web` — то есть у всех, кто зашёл через браузер, был ОДИН
 * общий разговор в голове агента: чужие факты, чужие предпочтения, чужие «моя жена
 * Лена». Это не приватность и не «понимание», это каша. Здесь:
 *   • адрес памяти выводится из человека (`userId`), а не из канала;
 *   • профиль («как зовут», «чем занимаетесь», «подробнее о вас») хранится отдельно
 *     и приходит в промпт блоком данных — он заполняется один раз в Настройках и
 *     не требует выпрашивать это у человека каждый разговор;
 *   • «автоматическое понимание» сделано правилами, а не лишними вызовами модели:
 *     профессия и то, что человек написал о себе, выбирают УРОВЕНЬ разговора
 *     (термины и код / по шагам и с примерами / коротко / подробно / без эмодзи).
 *     Модель на это не тратится ни разу — важно, потому что провайдеры бесплатные.
 *
 * Чего здесь сознательно нет:
 *   • аккаунтов и аутентификации — идентификатор это стабильный ключ устройства (или
 *     id в Telegram, если приложение открыто внутри бота);
 *   • любых диагнозов, оценки человека и «психоанализа»: блок говорит только о том,
 *     КАК с ним говорить, а не о том, КТО он;
 *   • додумывания: в промпт уходит ровно то, что человек написал сам.
 *
 * Хранение — тот же KV `MEMORY`, что у памяти чатов, отдельным префиксом ключа.
 * Новый binding не нужен; запись одна на пользователя и только когда текст
 * действительно изменился (бесплатный KV — 1000 записей в сутки на аккаунт).
 */

import { kvKey } from './kvkey.js';

export const CAPS = { name: 60, job: 90, about: 1500 };
/** Минимум между записями одного профиля, мс: защита от «сохраняю каждое нажатие». */
export const WRITE_MS = 2000;

/** Управляющие символы в идентификаторе — это либо ошибка, либо попытка сломать ключ. */
export function sanitizeUserId(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{4,80}$/.test(s) ? s : '';
}

/**
 * Ключ памяти чата. В Telegram он уже личный (`tg_<chat id>` — беседа принадлежит
 * одному человеку), поэтому там ничего не меняем и старую память не теряем.
 * В вебе без этого все жили бы в одном «web».
 */
export function memoryKey(userId, chatId) {
  const base = String(chatId || 'web');
  const uid = sanitizeUserId(userId);
  if (!uid) return base;
  if (/^tg[-_]/.test(base)) return base;
  return 'u-' + uid;
}

/** Ключ профиля в хранилище — одного человека между браузером и ботом. */
export function profileKey(userId) {
  const uid = sanitizeUserId(userId);
  return uid ? kvKey('profile', uid) : '';
}

/** Текст поля: без управляющих символов, с переносами, под потолком. */
function field(v, max, keepNewlines) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\u00a0/g, ' ');
  s = keepNewlines ? s.replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s*\n\s*/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

/** Запись в полном виде. Полей, которых нет здесь, в профиле жить не должно. */
export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const p = {
    name: field(d.name, CAPS.name, false),
    job: field(d.job, CAPS.job, false),
    about: field(d.about, CAPS.about, true),
    updatedAt: Number(d.updatedAt) || 0,
  };
  p.filled = !!(p.name || p.job || p.about);
  return p;
}

const RE_TECH = /(разработ|программист|кодер|инженер|архитектор|дата-?сайентист|аналитик данных|data ?scient|machine learning|ml\b|devops|backend|back-end|frontend|front-end|fullstack|full[- ]stack|админ|системный администратор|сетевик|математик|физик|астроном|робот|электронщик|програм)/i;
const RE_PLAIN = /(врач|медсест|фельдшер|фармац|учител|преподават|студент|школник|абиториент|бухгалтер|кадров|юрист|адвокат|нотариус|менеджер|продаж|маркетолог|копирайт|дизайнер|иллюстратор|психолог|логопед|воспитател|строител|отделочник|механик|водитель|электрик|сантехник|повар|кондитер|агроном|ветеринар|военн|спасател|полицейск)/i;
const RE_TERSE = /(коротк|кратк|покороче|полаконичн|без воды|без лишни|только суть|сух)/i;
const RE_LONG = /(подробн|развернут|развёрнут|детальн|пошагов|с объяснени|с примерам|распиши|пожалу?йста подробнее)/i;
const RE_NO_EMOJI = /(без эмодзи|без смайл|без значк|без иконк)/i;
const RE_LISTS = /(списк|таблиц|по пунктам|пунктам и|структур)/i;
const RE_CODE = /(код|python|javascript|typescript|sql|excel|таблиц[аы] в|макрос|vba|bash|linux|консол|терминал|git)/i;

/**
 * Что профиль диктует о форме ответа. Возвращает список правил словами — их видит и
 * человек в Настройках («как агент подстроится»), и модель в промпте: расхождение
 * между этими двумя было бы обещанием, а не настройкой.
 */
export function signalsOf(p) {
  const p2 = p || {};
  const out = [];
  const job = p2.job || '';
  const about = p2.about || '';
  const both = job + ' ' + about;
  if (RE_TECH.test(both)) {
    out.push('человек разбирается в теме: можно термины и детали, код показывать целиком, базу не разжёвывать');
  } else if (RE_PLAIN.test(both)) {
    out.push('объясняй простым языком и по шагам, термины расшифровывай в скобках, добавляй бытовой пример');
  }
  if (RE_CODE.test(both)) out.push('код, команды и формулы оформляй блоками, а не внутри текста');
  if (RE_TERSE.test(about)) out.push('попросил коротко: ответ в 2–4 строки, подробности — только если спросят');
  if (RE_LONG.test(about)) out.push('попросил подробно: раскрывай детали и объясняй, почему так');
  if (RE_NO_EMOJI.test(about)) out.push('без эмодзи и украшений');
  if (RE_LISTS.test(about)) out.push('оформляй списками или таблицей, если данных больше трёх пунктов');
  if (p2.name) out.push('обращайся по имени: ' + p2.name);
  return out;
}

/** Блок в системный промпт. Пустой профиль — пустая строка (ничего не вставляем). */
export function blockOf(p) {
  const prof = normalize(p);
  if (!prof.filled) return '';
  const lines = [];
  lines.push('· Как обращаться: ' + (prof.name || 'без имени'));
  if (prof.job) lines.push('· Чем занимается: ' + prof.job);
  if (prof.about) lines.push('· О себе (его слова): ' + prof.about);
  const sig = signalsOf(prof);
  if (sig.length) lines.push('· Как подстраиваться: ' + sig.join('; '));
  return '\n\nПРОФИЛЬ ЧЕЛОВЕКА — он заполнил это сам в Настройках. Опирайся на эти данные и не выдумывай сверх них; не пересказывай блок и не хвали человека за то, что он о себе написал.\n'
    + lines.join('\n');
}

const clone = (p) => ({ name: p.name, job: p.job, about: p.about, updatedAt: p.updatedAt, filled: p.filled });

/**
 * Профиль на хранилище. o: { env, store, log } — `store` тот же, что у памяти
 * (`{ get, put, delete }` от KV), чтобы не плодить связки.
 */
export function createProfile(o) {
  const opts = o || {};
  const env = opts.env || {};
  const store = opts.store || null;
  const log = opts.log || (() => {});
  const on = String(env.PROFILE || '') !== 'off';
  /* Явный 0 означает «без паузы», а не «дефолт»: `||` проглатывал ноль, и настройка
     вёрстки/тестов «пиши сразу» молча превращалась в 2 секунды ожидания. */
  const wRaw = Number(env.PROFILE_WRITE_MS);
  const writeMs = Number.isFinite(wRaw) ? Math.min(Math.max(0, wRaw), 60000) : WRITE_MS;
  const last = new Map();
  const cache = new Map();

  const read = async (uid) => {
    const key = profileKey(uid);
    if (!key || !store) return null;
    if (cache.has(key)) return cache.get(key);
    try {
      /* Контент-тип договорились с памятью чатов: хост отдаёт объект (адаптер
         `memoryStore` сам делает KV.get(...,'json')), строка приходит только от голого
         KV. Разбирать надо оба случая — иначе строка молча нормализуется в пустой
         профиль и «профиль не сохраняется» выглядит как поломка ключа. */
      let raw = await store.get(key);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      const rec = normalize(raw);
      if (cache.size > 60) cache.clear();
      cache.set(key, rec);
      return rec;
    } catch (e) {
      log('profile', 'read error', String((e && e.message) || e).slice(0, 120));
      return null;
    }
  };

  async function get(userId) {
    const uid = sanitizeUserId(userId);
    if (!uid) return { ok: false, why: 'не с чем обращаться к профилю: нет идентификатора пользователя' };
    if (!on) return { ok: false, why: 'профили выключены (PROFILE=off)' };
    const rec = await read(uid);
    if (!store) return { ok: true, profile: normalize(null), block: '', signals: [], stored: false, why: 'KV не подключена — профиль никуда не сохранится, работает только в этом запросе' };
    return { ok: true, profile: rec || normalize(null), block: blockOf(rec), signals: signalsOf(rec || {}), stored: !!(rec && rec.updatedAt) };
  }

  /**
   * Сохранить. Возвращает то, что записалось (а не то, что прислали), — чтобы фронт
   * показывал человеку реальную форму, а не его же черновик.
   */
  async function put(userId, raw) {
    const uid = sanitizeUserId(userId);
    if (!uid) return { ok: false, why: 'не с чем обращаться к профилю: нет идентификатора пользователя' };
    if (!on) return { ok: false, why: 'профили выключены (PROFILE=off)' };
    const next = normalize(raw);
    const prev = await read(uid);
    if (!store) return { ok: false, why: 'KV не подключена — сохранять некуда (в Settings: MEMORY binding)' };
    /* одинаковый текст = ничего не пишем: бесплатная квота KV — 1000 записей в сутки
       на весь аккаунт, и «сохранение» при каждом нажатии съедало бы её молча */
    const same = prev && prev.name === next.name && prev.job === next.job && prev.about === next.about;
    const wait = writeMs - (Date.now() - (last.get(uid) || 0));
    if (!same && wait > 0) {
      return { ok: false, why: 'профиль обновлён ' + Math.round((Date.now() - (last.get(uid) || 0)) / 1000) + ' с назад — подожди ' + Math.ceil(wait / 1000) + ' с', tooSoon: true };
    }
    if (same) return { ok: true, profile: prev, block: blockOf(prev), signals: signalsOf(prev), stored: true, unchanged: true };
    const rec = normalize(Object.assign({}, next, { updatedAt: Date.now() }));
    try {
      /* объект, не строка: адаптер хоста сериализует сам (см. memoryStore), и наша
         строка превратилась бы в JSON-в-JSON, который обратно уже не читается */
      await store.put(profileKey(uid), rec);
      last.set(uid, Date.now());
      cache.set(profileKey(uid), rec);
    } catch (e) {
      const why = String((e && e.message) || e).slice(0, 140);
      log('profile', 'write error', why);
      return { ok: false, why: 'хранилище не приняло запись: ' + why };
    }
    return { ok: true, profile: rec, block: blockOf(rec), signals: signalsOf(rec), stored: true, truncated: truncatedOf(raw, rec) };
  }

  async function clear(userId) {
    const uid = sanitizeUserId(userId);
    if (!uid) return { ok: false, why: 'нет идентификатора пользователя' };
    const empty = normalize(null);
    if (!store) return { ok: true, profile: empty, block: '' };
    try {
      if (typeof store.delete === 'function') await store.delete(profileKey(uid));
      else await store.put(profileKey(uid), empty);
      cache.set(profileKey(uid), empty);
      last.set(uid, Date.now());
    } catch (e) {
      return { ok: false, why: 'очистить не вышло: ' + String((e && e.message) || e).slice(0, 140) };
    }
    return { ok: true, profile: empty, block: '' };
  }

  return {
    get,
    put,
    clear,
    keyOf: (uid) => profileKey(uid),
    stats: () => ({ on, store: !!store, caps: CAPS, writeMs }),
  };
}

/** Что пришлось обрезать — человек должен видеть, а не искать, куда делся текст. */
function truncatedOf(raw, rec) {
  const out = [];
  const r = raw || {};
  const pairs = [['имя', 'name'], ['профессия', 'job'], ['рассказ о себе', 'about']];
  for (const [label, k] of pairs) {
    const sent = String(r[k] == null ? '' : r[k]).trim();
    if (sent.length > rec[k].length && sent.length > 4) out.push(label + ' обрезан до ' + rec[k].length + ' знаков');
  }
  return out;
}
