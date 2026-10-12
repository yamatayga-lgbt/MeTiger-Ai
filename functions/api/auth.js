/**
 * /api/auth — вход, регистрация, восстановление пароля и чужие входы (0.174).
 *
 * Владелец попросил так: «добавим вход в аккаунты, основа будет через Google, но
 * можно и другие способы: TikTok, Instagram, VK, Discord, Facebook — не только вход,
 * но и регистрация. Если забыл пароль — на почту поступает пароль… можно максимум
 * только 5 разных аккаунтов. На этих аккаунтах и будет память пользователя».
 *
 * Как это устроено здесь:
 *   · аккаунт — это адрес, под которым живёт память (engine/accounts.js считает
 *     ключи, здесь только правила приёма);
 *   · вход по почте и паролю: POST ?action=register | login | logout | change | recover;
 *   · чужие входы: GET ?start=<сеть> уводит к провайдеру, GET ?callback=<сеть>
 *     возвращает сюда, мы обмениваем код на личность и выдаём свою сессию;
 *   · сессия — токен в httpOnly-печеньке + запись в KV на два месяца;
 *   · потолок «5 аккаунтов» — про заведённые с одного устройства (владелец выбрал
 *     «до 5 у одного человека»; считаем по устройству, иначе никак не отличить
 *     двух людей с одной почтой).
 *
 * Ключи сетей — в env (GOOGLE_CLIENT_ID и т.д.). Вход без ключа честно выключен:
 * кнопки нет, обещаний нет. Почта — BREVO_API_KEY + BREVO_FROM.
 */
import { cfgOf as limitsCfg, createRateLimiter } from '../../engine/limits.js';
import { limitsStore, realClientIp } from './chat.js';
import { sendMail, mailConfigured, mailTooOften, newPasswordLetter } from '../../engine/mailer.js';
import {
  ACCOUNTS_PER_DEVICE, OAUTH_STATE_TTL_SEC, PROVIDERS, SESSION_COOKIE, SESSION_TTL_SEC,
  accountKey, deviceKey, deviceProblem, emailKey, enabledProviders, hashPassword, newPassword,
  normalizeEmail, oauthStateKey, ownerMetaKey, passwordProblem, publicAccount, providerKey,
  sessionKey, validEmail, verifyPassword,
} from '../../engine/accounts.js';

/* Своя карта частоты: вход — это то место, где перебор пароля должен упираться в
   потолок раньше, чем в терпение. Пять попыток в минуту — это уже не человек. */
const RATE_LOCAL = new Map();

const json = (body, status, extraHeaders) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {}),
    },
  });

/** Хранилище: тот же терпимый разбор, что у памяти чата (заглушка отдаёт объект, KV — строку). */
export function authStore(env) {
  const kv = env && env.MEMORY;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  const parse = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  return {
    get: (key) => Promise.resolve(kv.get(key)).then(parse, () => null),
    put: async (key, value, ttlSec) => {
      await kv.put(key, JSON.stringify(value), ttlSec ? { expirationTtl: Math.max(60, Math.floor(ttlSec)) } : undefined);
    },
    del: async (key) => {
      if (typeof kv.delete !== 'function') return;
      try { await kv.delete(key); } catch (e) { /* уже нет — и хорошо */ }
    },
    list: (opts) => Promise.resolve(kv.list(opts)).then((r) => (r && r.keys) || [], () => []),
  };
}

const randomId = (bytes) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Печенька сессии. Значение — случайный токен; больше из неё ничего не читается.
 *
 * `Secure` ставится по схеме запроса, а не всегда: на проде это всегда https и
 * флаг на месте, а вот локальная проверка (стенд на http://127.0.0.1) с ним
 * теряла печеньку — браузер её не сохранял, и «вошёл» локально не наступало.
 * Ослабления здесь нет: наружу печенька уходит только по https.
 */
function sessionCookie(token, maxAgeSec, request) {
  const secure = request && new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly' + secure + '; SameSite=Lax; Max-Age=' + Math.floor(maxAgeSec);
}

function cookieFrom(request, name) {
  const raw = String(request.headers.get('cookie') || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** Токен запроса: печенька (браузер) или заголовок (пробы и бот). */
export function tokenOf(request) {
  const bearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return bearer || cookieFrom(request, SESSION_COOKIE);
}

/** Кто это. Публичный помощник — им пользуются чат, профиль и обращения. */
export async function sessionUser(request, env) {
  const token = tokenOf(request);
  if (!token) return null;
  const store = authStore(env);
  if (!store) return null;
  const sess = await store.get(sessionKey(token));
  if (!sess || !sess.uid) return null;
  const rec = await store.get(accountKey(sess.uid));
  if (!rec) return null;
  return { rec, token, at: Number(sess.at) || 0 };
}

/** Владелец: адрес из OWNER_EMAILS или первый зарегистрировавшийся (пока список пуст). */
export async function isOwnerAccount(rec, env, store) {
  const list = String((env && env.OWNER_EMAILS) || '').split(',').map((s) => normalizeEmail(s)).filter(Boolean);
  if (list.length) return list.includes(normalizeEmail(rec && rec.email));
  const st = store || authStore(env);
  if (!st) return false;
  const meta = await st.get(ownerMetaKey());
  return !!meta && String(meta.uid) === String(rec && rec.id);
}

/** Отметить владельца — вызывается при первой регистрации, если OWNER_EMAILS пуст. */
async function claimOwnerIfFirst(rec, env, store) {
  const list = String((env && env.OWNER_EMAILS) || '').trim();
  if (list) return;
  const meta = await store.get(ownerMetaKey());
  if (meta && meta.uid) return;
  await store.put(ownerMetaKey(), { uid: rec.id, at: Date.now() });
}

/** Устройство: какие аккаунты с него заводили (для потолка в 5). */
async function deviceRecord(store, device) {
  const key = deviceKey(device);
  const rec = (await store.get(key)) || { ids: [] };
  if (!Array.isArray(rec.ids)) rec.ids = [];
  return { key, rec };
}

async function newSession(store, rec, device) {
  const token = randomId(32);
  await store.put(sessionKey(token), { uid: rec.id, at: Date.now(), dev: String(device || '').slice(0, 40) }, SESSION_TTL_SEC);
  return token;
}

/* ---------- чужие входы ---------- */

function originOf(request) {
  const u = new URL(request.url);
  return u.origin;
}

function providerEnv(env, id) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const map = {
    google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    vk: ['VK_CLIENT_ID', 'VK_CLIENT_SECRET'],
    discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
    facebook: ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'],
    tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    instagram: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
  };
  const [idKey, secretKey] = map[id] || [];
  const clientId = String((env && env[idKey]) || '').trim();
  const clientSecret = String((env && env[secretKey]) || '').trim();
  if (!clientId || !clientSecret) return null;
  return { id, def: p, clientId, clientSecret };
}

async function handleStart(request, env, store, providerId) {
  const cfg = providerEnv(env, providerId);
  if (!cfg) return json({ ok: false, error: 'этот вход ещё не подключён' }, 400);
  const url = new URL(request.url);
  const device = String(url.searchParams.get('device') || '').slice(0, 40);
  const state = randomId(16);
  await store.put(oauthStateKey(state), { provider: providerId, device, at: Date.now() }, OAUTH_STATE_TTL_SEC);
  const redirectUri = originOf(request) + '/api/auth?callback=' + providerId;
  const to = cfg.def.authorize({ clientId: cfg.clientId, redirectUri, state, scope: cfg.def.scope });
  return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
}

async function handleCallback(request, env, store, providerId) {
  const cfg = providerEnv(env, providerId);
  const url = new URL(request.url);
  const state = String(url.searchParams.get('state') || '');
  const code = String(url.searchParams.get('code') || '');
  const fail = (why) => new Response(null, {
    status: 302,
    headers: { location: '/?auth=' + encodeURIComponent(why), 'cache-control': 'no-store' },
  });
  if (!cfg) return fail('вход не подключён');
  if (!state || !code) return fail('вход отменён');
  const st = await store.get(oauthStateKey(state));
  if (!st || st.provider !== providerId) return fail('вход устарел — попробуйте ещё раз');
  await store.del(oauthStateKey(state));

  let user;
  try {
    user = await cfg.def.token({
      code, clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      redirectUri: originOf(request) + '/api/auth?callback=' + providerId,
    });
  } catch (e) {
    return fail(String((e && e.message) || 'вход не получился'));
  }
  if (!user || !user.sub) return fail('сеть не назвала пользователя');

  const linkKey = providerKey(providerId, user.sub);
  let rec = (await store.get(linkKey)) ? await store.get(accountKey((await store.get(linkKey)).uid)) : null;

  if (!rec) {
    /* Первый раз этим входом: ищем аккаунт по адресу (человек мог сперва
       зарегистрироваться паролем, а теперь входит через Google) — и привязываем. */
    const email = normalizeEmail(user.email);
    if (email) {
      const byMail = await store.get(await emailKey(email));
      if (byMail && byMail.uid) rec = await store.get(accountKey(byMail.uid));
    }
    if (!rec) {
      const dev = await deviceRecord(store, st.device);
      const problem = deviceProblem(dev.rec, env);
      if (problem) return fail(problem);
      rec = {
        id: randomId(8),
        email,
        name: String(user.name || '').slice(0, 60),
        createdAt: Date.now(),
        device: String(st.device || '').slice(0, 40),
        providers: {},
      };
      await store.put(accountKey(rec.id), rec);
      if (email) await store.put(await emailKey(email), { uid: rec.id });
      dev.rec.ids.push(rec.id);
      await store.put(dev.key, dev.rec);
      await claimOwnerIfFirst(rec, env, store);
    }
  }
  await store.put(linkKey, { uid: rec.id });
  if (!rec.providers) rec.providers = {};
  if (!rec.providers[providerId]) {
    rec.providers[providerId] = String(user.sub);
    await store.put(accountKey(rec.id), rec);
  }

  const token = await newSession(store, rec, st.device);
  return new Response(null, {
    status: 302,
    headers: { location: '/', 'set-cookie': sessionCookie(token, SESSION_TTL_SEC, request), 'cache-control': 'no-store' },
  });
}

/* ---------- входы ---------- */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const store = authStore(env);

  if (url.searchParams.has('providers')) {
    return json({ ok: true, providers: enabledProviders(env), mail: mailConfigured(env), maxPerDevice: ACCOUNTS_PER_DEVICE });
  }

  if (store && url.searchParams.has('start')) {
    return handleStart(request, env, store, String(url.searchParams.get('start') || '').toLowerCase());
  }
  if (store && url.searchParams.has('callback')) {
    return handleCallback(request, env, store, String(url.searchParams.get('callback') || '').toLowerCase());
  }

  if (url.searchParams.has('me')) {
    if (!store) return json({ ok: false, error: 'хранилище не подключено (нет связки MEMORY)' }, 503);
    const who = await sessionUser(request, env);
    if (!who) return json({ ok: true, user: null });
    return json({
      ok: true,
      user: publicAccount(who.rec, { owner: await isOwnerAccount(who.rec, env, store) }),
      mail: mailConfigured(env),
    });
  }

  /* Служебный мостик владельца: список аккаунтов и назначение владельца по старому
     коду. Нужен ровно один раз — чтобы после выкладки 0.174 отметить аккаунт
     владельца, не заводя отдельную консоль. В интерфейсе его нет. */
  if (url.searchParams.get('owner') === '1') {
    if (!store) return json({ ok: false, error: 'хранилище не подключено' }, 503);
    if (!(await legacyOwner(request, env))) return json({ ok: false, error: 'нет доступа' }, 403);
    const keys = await store.list({ prefix: 'acc:', limit: 200 });
    const accounts = [];
    for (const k of keys) {
      const rec = await store.get(k.name);
      if (rec) accounts.push({ id: rec.id, email: rec.email, name: rec.name, createdAt: rec.createdAt, providers: Object.keys(rec.providers || {}) });
    }
    accounts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const meta = await store.get(ownerMetaKey());
    return json({ ok: true, accounts, owner: meta && meta.uid ? meta.uid : '', total: accounts.length });
  }

  return json({ ok: true, auth: true, routes: ['POST ?action=register|login|logout|change|recover', 'GET ?me=1|providers=1|start=|callback='] });
}

/** Проверка старого кода владельца — только для служебного мостика. */
async function legacyOwner(request, env) {
  const code = String(request.headers.get('x-mt-owner') || '');
  if (!code) return false;
  const mod = await import('../../engine/reports.js');
  return mod.isOwnerCode(code, env && env.REPORT_OWNER_HASH);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const store = authStore(env);
  if (!store) return json({ ok: false, error: 'хранилище не подключено (нет связки MEMORY)' }, 503);

  /* Тело может быть пустым (например, у «выхода» его нет вовсе). Раньше здесь
     стоял отказ «запрос не разобрался», и выход не работал — поймано тестом S2.
     Теперь пустое тело — это {}, а нужные поля каждое действие проверяет само. */
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const action = String(url.searchParams.get('action') || body.action || '').toLowerCase();
  const device = String(body.device || '').slice(0, 40);

  /* Служебный мостик: назначить владельца аккаунту по коду. */
  if (action === 'claim' || url.searchParams.get('owner') === '1') {
    if (!(await legacyOwner(request, env))) return json({ ok: false, error: 'нет доступа' }, 403);
    const uid = String(body.uid || '').trim();
    if (!uid) return json({ ok: false, error: 'нужен uid аккаунта' }, 400);
    const rec = await store.get(accountKey(uid));
    if (!rec) return json({ ok: false, error: 'аккаунт не найден' }, 404);
    await store.put(ownerMetaKey(), { uid: rec.id, at: Date.now(), email: rec.email });
    return json({ ok: true, owner: rec.id, email: rec.email });
  }

  if (env.RATE_LIMIT !== '0' && action !== 'logout') {
    const cfg = limitsCfg(env);
    const max = Math.max(1, Number(env.AUTH_RATE_MAX) || 10);
    const rate = createRateLimiter({ store: limitsStore(env), cfg: { ...cfg, rateMax: max }, base: RATE_LOCAL });
    const r = await rate.check(realClientIp(request, env));
    if (r.limited) return json({ ok: false, error: 'слишком часто — подождите минуту' }, 429);
  }

  if (action === 'logout') {
    const token = tokenOf(request);
    if (token) await store.del(sessionKey(token));
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, request) });
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (action === 'register') {
    if (!validEmail(email)) return json({ ok: false, error: 'проверьте адрес почты — письмо о восстановлении пойдёт на него' }, 400);
    const bad = passwordProblem(password);
    if (bad) return json({ ok: false, error: bad }, 400);
    const mailKey = await emailKey(email);
    if (await store.get(mailKey)) return json({ ok: false, error: 'такой адрес уже зарегистрирован — войдите' }, 409);
    const dev = await deviceRecord(store, device);
    const problem = deviceProblem(dev.rec, env);
    if (problem) return json({ ok: false, error: problem }, 409);

    const pass = await hashPassword(password, env);
    const rec = {
      id: randomId(8),
      email,
      name: String(body.name || '').slice(0, 60).trim(),
      createdAt: Date.now(),
      device,
      providers: {},
      ...pass,
    };
    await store.put(accountKey(rec.id), rec);
    await store.put(mailKey, { uid: rec.id });
    dev.rec.ids.push(rec.id);
    await store.put(dev.key, dev.rec);
    await claimOwnerIfFirst(rec, env, store);
    const token = await newSession(store, rec, device);
    return json({ ok: true, user: publicAccount(rec, { owner: await isOwnerAccount(rec, env, store) }) }, 200, {
      'set-cookie': sessionCookie(token, SESSION_TTL_SEC, request),
    });
  }

  if (action === 'login') {
    if (!validEmail(email) || !password) return json({ ok: false, error: 'нужны адрес и пароль' }, 400);
    const byMail = await store.get(await emailKey(email));
    const rec = byMail && byMail.uid ? await store.get(accountKey(byMail.uid)) : null;
    /* Одинаковый ответ на «нет такого адреса» и «не тот пароль»: иначе чужой
       человек узнаёт по ответам, кто здесь зарегистрирован. */
    const okPass = await verifyPassword(password, rec, env);
    if (!rec || !okPass) return json({ ok: false, error: 'адрес или пароль не подошли' }, 401);
    /* Вход с нового устройства тоже считаем: иначе потолок «5 аккаунтов» обходится
       сменой устройства. Считаем только НОВЫЕ для устройства аккаунты. */
    const dev = await deviceRecord(store, device);
    if (device && !dev.rec.ids.includes(rec.id)) {
      const problem = deviceProblem(dev.rec, env);
      if (problem) return json({ ok: false, error: problem }, 409);
      dev.rec.ids.push(rec.id);
      await store.put(dev.key, dev.rec);
    }
    const token = await newSession(store, rec, device);
    return json({ ok: true, user: publicAccount(rec, { owner: await isOwnerAccount(rec, env, store) }) }, 200, {
      'set-cookie': sessionCookie(token, SESSION_TTL_SEC, request),
    });
  }

  if (action === 'change') {
    const who = await sessionUser(request, env);
    if (!who) return json({ ok: false, error: 'сначала войдите' }, 401);
    const bad = passwordProblem(password);
    if (bad) return json({ ok: false, error: bad }, 400);
    if (!(await verifyPassword(String(body.old || ''), who.rec, env))) {
      return json({ ok: false, error: 'текущий пароль не подошёл' }, 401);
    }
    const pass = await hashPassword(password, env);
    const next = { ...who.rec, ...pass };
    await store.put(accountKey(next.id), next);
    return json({ ok: true });
  }

  if (action === 'recover') {
    if (!validEmail(email)) return json({ ok: false, error: 'проверьте адрес почты' }, 400);
    if (!mailConfigured(env)) {
      return json({ ok: false, error: 'почта ещё не подключена — напишите владельцу через «Сообщить об ошибке»' }, 503);
    }
    if (mailTooOften(email)) return json({ ok: false, error: 'письмо уже отправлено — подождите минуту' }, 429);
    const byMail = await store.get(await emailKey(email));
    const rec = byMail && byMail.uid ? await store.get(accountKey(byMail.uid)) : null;
    /* Ответ один и тот же, есть такой адрес или нет: иначе по ответам можно
       перебрать, кто здесь зарегистрирован. Письмо уходит только своему адресу. */
    if (rec) {
      const fresh = newPassword();
      const pass = await hashPassword(fresh, env);
      await store.put(accountKey(rec.id), { ...rec, ...pass });
      const letter = newPasswordLetter({ email: rec.email, password: fresh });
      const sent = await sendMail(env, { to: rec.email, subject: letter.subject, text: letter.text });
      if (!sent.ok) return json({ ok: false, error: sent.why }, 502);
    }
    return json({ ok: true, message: 'если такой адрес у нас есть, письмо с новым паролем уже в пути' });
  }

  return json({ ok: false, error: 'неизвестное действие' }, 400);
}
