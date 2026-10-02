/**
 * /api/profile — кто ты такой, и где твоя память.
 *
 *   GET    /api/profile?id=<userId>      — что сохранено и как агент подстроится
 *   PUT    /api/profile                  — сохранить { userId, name, job, about }
 *   DELETE /api/profile?id=<userId>      — забыть профиль
 *
 * Зачем отдельная дверь, а не «скажи мне своё имя в чате». Профиль — данные, а не
 * просьба: человек пишет их один раз в Настройках, и они участвуют в каждом ответе.
 * Из разговора имя тоже можно запомнить (это делает Память), но полагаться на это
 * нельзя: разговоры разные, а профиль один на человека.
 *
 * Правила держит engine/profile.js — здесь только вход, права и честные ответы:
 *   • без идентификатора — 400 словами, а не пустой объект (молча записать «в никуда»
 *     означало бы потерять данные без следа);
 *   • без связки KV — 503 с причиной: профиль без хранилища живёт одну request'у;
 *   • writes — через тот же счётчик частоты, что и чат: бесплатный KV имеет 1000
 *     записей в сутки на аккаунт, и «сохранение» на каждое нажатие съедало бы их.
 */
import { cfgOf as limitsCfg, createRateLimiter } from '../../engine/limits.js';
import { createProfile, memoryKey, sanitizeUserId, CAPS } from '../../engine/profile.js';
import { limitsStore, memoryStore } from './chat.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

/* Карта счётчика — общая между запросами внутри тёплого изолятора (урок чата:
   без неё лимит считался бы заново в каждом вызове). */
const WRITE_LOCAL = new Map();

function uidOf(request, body) {
  const fromBody = body && body.userId;
  const uid = sanitizeUserId(fromBody) || sanitizeUserId(new URL(request.url).searchParams.get('id'));
  return uid;
}

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || 'anon';
}

const store = (env) => createProfile({ env, store: memoryStore(env), log: (k, m, x) => console.log(k, m, String(x || '').slice(0, 140)) });

/** Одна и та же форма ответа: фронт рисует поля, curl читает строки. */
function shape(uid, got) {
  return {
    ok: true,
    id: uid,
    profile: got.profile,
    block: got.block || '',
    signals: got.signals || [],
    stored: !!got.stored,
    /* куда ляжет память разговора этого человека — видно заранее, а не «где-то там» */
    memoryChatId: memoryKey(uid, 'web'),
    why: got.why || undefined,
    caps: CAPS,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const uid = uidOf(request, null);
  if (!uid) return json({ ok: false, error: 'нужен идентификатор пользователя: /api/profile?id=…' }, 400);
  const got = await store(env).get(uid);
  if (!got.ok) return json({ ok: false, error: got.why, id: uid }, 503);
  return json(shape(uid, got));
}

export async function onRequestPut(context) {
  const { request, env } = context;
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'тело должно быть JSON: { name, job, about }' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'пустое тело — сохранять нечего' }, 400);
  const uid = uidOf(request, body);
  if (!uid) {
    return json({ ok: false, error: 'профиль пишется на человека: передай userId (в браузере он заводится сам)' }, 400);
  }
  if (env.RATE_LIMIT !== '0') {
    const rate = createRateLimiter({ store: limitsStore(env), cfg: limitsCfg(env), base: WRITE_LOCAL });
    const r = await rate.check(ipOf(request) + ':' + uid);
    if (r.limited) return json({ ok: false, error: 'слишком часто — подожди минуту', rate: { n: r.n, max: rate.cfg.rateMax } }, 429);
  }
  const got = await store(env).put(uid, { name: body.name, job: body.job, about: body.about });
  if (!got.ok) {
    /* слишком быстро — не ошибка человека, а защита квоты: фронт повторит сам */
    return json({ ok: false, error: got.why, tooSoon: !!got.tooSoon }, got.tooSoon ? 429 : 503);
  }
  const out = shape(uid, got);
  out.saved = true;
  if (got.unchanged) out.unchanged = true;
  if (got.truncated && got.truncated.length) out.truncated = got.truncated;
  return json(out);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const uid = uidOf(request, null);
  if (!uid) return json({ ok: false, error: 'нужен идентификатор пользователя: /api/profile?id=…' }, 400);
  const got = await store(env).clear(uid);
  if (!got.ok) return json({ ok: false, error: got.why }, 503);
  return json({ ok: true, id: uid, profile: got.profile, block: '', signals: [], cleared: true, memoryChatId: memoryKey(uid, 'web') });
}
