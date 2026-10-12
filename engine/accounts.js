/**
 * Аккаунты (0.174) — чистая часть: правила, ключи, пароли и настройки входов.
 *
 * Зачем это всё. До 0.173 у человека не было имени и адреса: память жила на
 * устройстве (ключ в localStorage), а о проблемах он писал анонимно. Владелец
 * попросил иначе: «добавим вход в аккаунты, основа будет через Google… на этих
 * аккаунтах и будет память пользователя». Значит, аккаунт — это адрес, по
 * которому живёт память, профиль и обращения; устройство перестаёт быть адресом.
 *
 * Что здесь и чего здесь нет:
 *   · правила (почта, пароль, потолок в 5 аккаунтов) — здесь, потому что их
 *     проверяет тест без сети и без Cloudflare (тот же приём, что у engine/limits.js);
 *   · сам HTTP-вход — в functions/api/auth.js;
 *   · пароли хранятся производной (PBKDF2-SHA256 + соль), открытым текстом — нет
 *     нигде: даже новое письмо при восстановлении мы сначала ставим паролем и
 *     только потом отправляем, в базе остаётся производная.
 *
 * Входы (проверяются по ключам в env, поэтому «включён» — это про ключ, а не про
 * галочку в коде):
 *   GOOGLE_CLIENT_ID/SECRET, VK_CLIENT_ID/SECRET, DISCORD_CLIENT_ID/SECRET,
 *   FACEBOOK_CLIENT_ID/SECRET, TIKTOK_CLIENT_KEY/SECRET, INSTAGRAM_CLIENT_ID/SECRET,
 *   и почта — BREVO_API_KEY + BREVO_FROM.
 */

/** Потолок аккаунтов, заведённых с одного устройства (просьба владельца: «максимум 5»). */
export const ACCOUNTS_PER_DEVICE = 5;

/** Пароль: короткий не пускаем, длинный не режем — 8 знаков это минимум, который просят все. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Сессия живёт два месяца: реже входов — меньше поводов забыть пароль. */
export const SESSION_TTL_SEC = 60 * 60 * 24 * 60;

/** Сколько живёт «состояние» перехода к чужому входу (защита от подстановки кода). */
export const OAUTH_STATE_TTL_SEC = 600;

/** Имя печеньки. httpOnly, поэтому из скриптов её не видно — токен берёт сервер. */
export const SESSION_COOKIE = 'mt_sess';

/* ---------- почта ---------- */

/** Приводим адрес к одному виду: регистр и пробелы не должны создавать «два» аккаунта. */
export function normalizeEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
}

/** Простая проверка адреса: одна собака, точка в домене, без пробелов. */
export function validEmail(v) {
  const s = normalizeEmail(v);
  if (s.length < 6 || s.length > 120) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}

/** Правило пароля словами — эту же фразу показывает форма, чтобы не выдумывать текст. */
export function passwordProblem(v) {
  const s = String(v == null ? '' : v);
  if (s.length < PASSWORD_MIN) return `пароль короче ${PASSWORD_MIN} знаков`;
  if (s.length > PASSWORD_MAX) return `пароль длиннее ${PASSWORD_MAX} знаков`;
  if (/^\s|\s$/.test(s)) return 'пароль начинается или кончается пробелом';
  return '';
}

/* ---------- пароли ---------- */

const b64 = (bytes) => {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += String.fromCharCode(b);
  return btoa(out);
};

const iterOf = (env) => Math.max(10_000, Number(env && env.ACCOUNT_PBKDF2_ITER) || 120_000);

async function derive(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

/** Пара «соль + производная» — то, что уходит в хранилище вместо пароля. */
export async function hashPassword(password, env) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = b64(saltBytes.buffer);
  const iterations = iterOf(env);
  return { salt, iterations, hash: await derive(password, salt, iterations) };
}

/** Проверка пароля. Сравнение посимвольное и без раннего выхода — по времени нельзя
    понять, сколько знаков уже совпало. */
export async function verifyPassword(password, rec, env) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = await derive(password, rec.salt, Math.max(10_000, Number(rec.iterations) || iterOf(env)));
  const want = String(rec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/**
 * Новый пароль для письма. Читаемый, а не «x7Kd93Lq»: человек вводит его с
 * телефона, и слова вроде `tiger-л7м` набирать проще, чем случайную кашу.
 * Похожие знаки (0/O, 1/l/I) не используем — их путают при вводе.
 */
export function newPassword(rand) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = typeof rand === 'function' ? rand() : crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      out.push(alphabet[Math.floor(r * alphabet.length) % alphabet.length]);
    }
    return out.join('');
  };
  return 'tiger-' + pick(4) + '-' + pick(4);
}

/* ---------- ключи хранилища ---------- */

export const accountKey = (id) => 'acc:' + String(id || '').slice(0, 40);
export const sessionKey = (token) => 'sess:' + String(token || '').slice(0, 80);
export const oauthStateKey = (state) => 'oast:' + String(state || '').slice(0, 80);
export const deviceKey = (device) => 'dev:' + String(device || '').slice(0, 40);
export const providerKey = (provider, sub) => 'prov:' + String(provider) + ':' + String(sub || '').slice(0, 60);
export const ownerMetaKey = () => 'meta:owner';

/** Ключ адреса — отпечаток, а не сам адрес: перечисление ключей не выдаёт чужую почту. */
export async function emailKey(email) {
  const data = new TextEncoder().encode('mt-mail:' + normalizeEmail(email));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return 'accmail:' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

/* ---------- то, что показываем человеку ---------- */

export function publicAccount(rec, opts) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const o = opts || {};
  return {
    id: String(r.id || ''),
    email: String(r.email || ''),
    name: String(r.name || ''),
    createdAt: Math.floor(Number(r.createdAt) || 0),
    providers: Object.keys(r.providers || {}),
    mayRecover: !!r.email,
    owner: !!o.owner,
  };
}

export function deviceProblem(dev, env) {
  const ids = Array.isArray(dev && dev.ids) ? dev.ids : [];
  const max = Math.max(1, Number(env && env.ACCOUNTS_PER_DEVICE) || ACCOUNTS_PER_DEVICE);
  if (ids.length < max) return '';
  return `с этого устройства уже заведено ${ids.length} аккаунтов — больше ${max} нельзя, войдите в один из них`;
}

/* ---------- чужие входы ---------- */

/**
 * Описание каждого входа: как отправить человека к провайдеру и как по коду
 * получить его личность. Ключи берутся из env, поэтому «вход включён» — это
 * наличие ключа: пустые кнопки не показываем и обещаний не раздаём.
 */
export const PROVIDERS = {
  google: {
    title: 'Google',
    keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    scope: 'openid email profile',
    authorize: (c) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, access_type: 'online', prompt: 'select_account', state: c.state,
    }),
    token: async (c) => {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: c.code, client_id: c.clientId, client_secret: c.clientSecret,
          redirect_uri: c.redirectUri, grant_type: 'authorization_code',
        }),
      });
      const d = await r.json();
      if (!d.access_token) throw new Error('Google не дал доступ');
      const u = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: 'Bearer ' + d.access_token },
      })).json();
      return { sub: u.sub, email: u.email || '', name: u.name || '' };
    },
  },
  vk: {
    title: 'VK',
    keys: ['VK_CLIENT_ID', 'VK_CLIENT_SECRET'],
    scope: 'email',
    authorize: (c) => 'https://oauth.vk.com/authorize?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, state: c.state, v: '5.199',
    }),
    token: async (c) => {
      const r = await fetch('https://oauth.vk.com/access_token?' + new URLSearchParams({
        client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, code: c.code,
      }));
      const d = await r.json();
      if (!d.access_token) throw new Error('VK не дал доступ');
      const info = await (await fetch('https://api.vk.com/method/users.get?' + new URLSearchParams({
        user_ids: String(d.user_id || ''), fields: 'screen_name', access_token: d.access_token, v: '5.199',
      }))).json();
      const u = (info.response && info.response[0]) || {};
      return { sub: String(d.user_id || u.id || ''), email: d.email || '', name: [u.first_name, u.last_name].filter(Boolean).join(' ') };
    },
  },
  discord: {
    title: 'Discord',
    keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
    scope: 'identify email',
    authorize: (c) => 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, state: c.state,
    }),
    token: async (c) => {
      const r = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: c.code, client_id: c.clientId, client_secret: c.clientSecret,
          redirect_uri: c.redirectUri, grant_type: 'authorization_code',
        }),
      });
      const d = await r.json();
      if (!d.access_token) throw new Error('Discord не дал доступ');
      const u = await (await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: 'Bearer ' + d.access_token },
      })).json();
      return { sub: u.id, email: u.email || '', name: u.global_name || u.username || '' };
    },
  },
  facebook: {
    title: 'Facebook',
    keys: ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'],
    scope: 'email public_profile',
    authorize: (c) => 'https://www.facebook.com/v19.0/dialog/oauth?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, state: c.state,
    }),
    token: async (c) => {
      const t = await (await fetch('https://graph.facebook.com/v19.0/oauth/access_token?' + new URLSearchParams({
        client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, code: c.code,
      }))).json();
      if (!t.access_token) throw new Error('Facebook не дал доступ');
      const u = await (await fetch('https://graph.facebook.com/me?' + new URLSearchParams({
        fields: 'id,name,email', access_token: t.access_token,
      }))).json();
      return { sub: u.id, email: u.email || '', name: u.name || '' };
    },
  },
  tiktok: {
    title: 'TikTok',
    keys: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    scope: 'user.info.basic',
    authorize: (c) => 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
      client_key: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, state: c.state,
    }),
    token: async (c) => {
      const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: c.clientId, client_secret: c.clientSecret, code: c.code,
          grant_type: 'authorization_code', redirect_uri: c.redirectUri,
        }),
      });
      const d = await r.json();
      if (!d.access_token) throw new Error('TikTok не дал доступ');
      const u = await (await fetch('https://open.tiktokapis.com/v2/user/info/?' + new URLSearchParams({ fields: 'open_id,display_name' }), {
        headers: { authorization: 'Bearer ' + d.access_token },
      })).json();
      const info = (u.data && u.data.user) || {};
      /* TikTok почту не отдаёт вовсе — аккаунт будет без адреса, и это честно
         сказано в интерфейсе (восстановление по почте для него недоступно). */
      return { sub: info.open_id || d.open_id || '', email: '', name: info.display_name || '' };
    },
  },
  instagram: {
    title: 'Instagram',
    keys: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
    scope: 'user_profile',
    authorize: (c) => 'https://api.instagram.com/oauth/authorize?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
      scope: c.scope, state: c.state,
    }),
    token: async (c) => {
      const r = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: c.clientId, client_secret: c.clientSecret, code: c.code,
          grant_type: 'authorization_code', redirect_uri: c.redirectUri,
        }),
      });
      const d = await r.json();
      if (!d.access_token) throw new Error('Instagram не дал доступ');
      /* Instagram почту тоже не отдаёт: вход есть, адреса у аккаунта не будет. */
      return { sub: String(d.user_id || (d.user && d.user.id) || ''), email: '', name: '' };
    },
  },
};

/** Какие входы включены прямо сейчас — по ключам, а не по списку в коде. */
export function enabledProviders(env) {
  const e = env || {};
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    out[id] = { title: p.title, on: p.keys.every((k) => String(e[k] || '').trim()) };
  }
  return out;
}
