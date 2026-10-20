/**
 * Веб-уведомления (0.225): шифрование и подпись по стандартам, без сторонних библиотек.
 *
 * Зачем своё, а не пакет: воркер Cloudflare живёт на Web Crypto и не тянет Node-овые
 * зависимости `web-push` (ему нужен `crypto` из Node). Здесь ровно два стандарта:
 *
 *   · RFC 8291 — как зашифровать текст так, чтобы его прочитал только браузер
 *     получателя (ECDH P-256 + HKDF-SHA256 + AES-128-GCM, схема `aes128gcm`);
 *   · RFC 8292 — кто имеет право слать: JWT ES256, подписанный ключом VAPID.
 *
 * Обе части сверены с тестовым вектором RFC 8291 (Appendix A) — не «вроде работает»,
 * а побайтово совпадает с примером из стандарта. Иначе push-сервис молча ответит 400,
 * и уведомление просто не придёт, без внятной причины.
 *
 * Ключи VAPID — в переменных окружения: VAPID_PUBLIC и VAPID_PRIVATE (base64url,
 * публичный — 65 байт несжатой точки, приватный — 32 байта), VAPID_SUBJECT —
 * `mailto:` или ссылка на проект (push-сервисы требуют контакт на случай жалоб).
 */

const TE = new TextEncoder();

/** base64url без выравнивания — формат, которого ждут и JWT, и `applicationServerKey`. */
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Обратное к b64u: пустая строка и мусор дают пустой массив, а не исключение. */
export function unb64u(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!s) return new Uint8Array(0);
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  try {
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return new Uint8Array(0);
  }
}

const cat = (...parts) => {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/**
 * HKDF для этой схемы — два HMAC, и оба короче 32 байт.
 *
 * Встроенный HKDF из Web Crypto делает extract и expand одним вызовом, а RFC 8291
 * разносит их по разным шагам и с разными входами: сначала ключ выводится из общего
 * секрета с солью-секретом подписки, потом из него — ключ и nonce с солью сообщения.
 * Поэтому считаем руками: extract = HMAC(соль, секрет), expand = HMAC(ключ, инфо|0x01).
 * Длины у нас 16 и 12 байт, то есть один блок — обрезаем.
 */
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}
const hkdfExtract = (salt, ikm) => hmac(salt, ikm);
const expandOne = async (prk, info, len) => (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len);

/**
 * Ключ для подписи VAPID из окружения.
 * `ok: false` — уведомления не настроены; это не ошибка продукта, а честное «пока нет».
 */
export function vapidFromEnv(env) {
  const pub = unb64u(env && env.VAPID_PUBLIC);
  const priv = unb64u(env && env.VAPID_PRIVATE);
  const subject = String((env && env.VAPID_SUBJECT) || 'mailto:owner@metiger-ai.pages.dev');
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) {
    return { ok: false, publicKey: '', subject, why: 'ключи VAPID не заданы' };
  }
  return {
    ok: true,
    publicKey: b64u(pub),
    subject,
    jwk: {
      kty: 'EC',
      crv: 'P-256',
      d: b64u(priv),
      x: b64u(pub.slice(1, 33)),
      y: b64u(pub.slice(33, 65)),
    },
  };
}

/**
 * JWT для заголовка Authorization (RFC 8292).
 * `aud` — origin push-сервиса (не весь endpoint: именно origin), `exp` — не больше суток.
 */
export async function vapidToken({ jwk, subject, endpoint, now, ttl = 12 * 3600 }) {
  let aud = '';
  try { aud = new URL(endpoint).origin; } catch (e) { return ''; }
  if (!aud || !jwk) return '';
  const head = b64u(TE.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(TE.encode(JSON.stringify({
    aud,
    exp: Math.floor((now || Date.now()) / 1000) + ttl,
    sub: subject,
  })));
  const data = TE.encode(head + '.' + body);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  /* Web Crypto отдаёт подпись в сыром виде r||s — ровно то, что требует JWS ES256. */
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return head + '.' + body + '.' + b64u(new Uint8Array(sig));
}

/** Проверка подписи — нужна тестам и полезна, если понадобится разбирать чужой токен. */
export async function verifyVapidToken(token, publicKeyB64) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const raw = unb64u(publicKeyB64);
  if (raw.length !== 65) return false;
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64u(parts[2]),
      TE.encode(parts[0] + '.' + parts[1]),
    );
  } catch (e) {
    return false;
  }
}

/**
 * Тело push-сообщения по RFC 8291 (`aes128gcm`).
 *
 * `salt` и `asPrivate` можно передать готовыми — этим пользуется тест с вектором
 * из стандарта: криптография с случайными значениями иначе не сверяется.
 */
export async function encryptPayload({ p256dh, auth }, plaintext, opts) {
  const uaPub = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPub.length !== 65 || !authSecret.length) throw new Error('подписка без ключей p256dh/auth');
  const o = opts || {};
  const salt = o.salt || crypto.getRandomValues(new Uint8Array(16));

  let asPrivate = o.asPrivate;
  let asPublic = o.asPublic;
  if (!asPrivate || !asPublic) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    asPrivate = unb64u(jwk.d);
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  /* Приватный ключ отправителя для ECDH: Web Crypto умеет импортировать его только JWK. */
  const asJwk = {
    kty: 'EC',
    crv: 'P-256',
    d: b64u(asPrivate),
    x: b64u(asPublic.slice(1, 33)),
    y: b64u(asPublic.slice(33, 65)),
  };
  const asKey = await crypto.subtle.importKey('jwk', asJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKey, 256));

  /* Ниже — ровно шаги §3.4 RFC 8291, в том же порядке. */
  const prkKey = await hkdfExtract(authSecret, ecdh);
  const ikm = await expandOne(prkKey, cat(TE.encode('WebPush: info\x00'), uaPub, asPublic), 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await expandOne(prk, TE.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await expandOne(prk, TE.encode('Content-Encoding: nonce\x00'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = cat(TE.encode(String(plaintext || '')), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, body));

  /* Заголовок: соль (16) · размер записи (4, big-endian) · длина ключа отправителя (1) · ключ (65). */
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Разбор подписки от браузера: только https, только нормальные ключи. */
export function parseSubscription(value) {
  const s = value && typeof value === 'object' ? value : null;
  if (!s) return null;
  const endpoint = String(s.endpoint || '');
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 900) return null;
  const keys = s.keys && typeof s.keys === 'object' ? s.keys : {};
  const p256dh = String(keys.p256dh || '');
  const auth = String(keys.auth || '');
  if (unb64u(p256dh).length !== 65 || !unb64u(auth).length) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Отправка push-сообщения.
 * Возвращает `{ ok, gone, status }`: `gone` — подписка мертва (404/410), её надо удалить,
 * иначе будем вечно слать в пустоту.
 */
export async function sendPush(subscription, payload, env, opts) {
  const v = vapidFromEnv(env);
  if (!v.ok) return { ok: false, gone: false, status: 0, why: v.why };
  const o = opts || {};
  const body = await encryptPayload(subscription.keys, JSON.stringify(payload || {}));
  const token = await vapidToken({ jwk: v.jwk, subject: v.subject, endpoint: subscription.endpoint, now: o.now });
  const res = await (o.fetch || fetch)(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: 'vapid t=' + token + ', k=' + v.publicKey,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(o.ttl == null ? 3600 : o.ttl),
      urgency: o.urgency || 'normal',
      ...(o.topic ? { topic: String(o.topic).slice(0, 32) } : {}),
    },
    body,
  });
  const status = res && res.status ? res.status : 0;
  return { ok: status >= 200 && status < 300, gone: status === 404 || status === 410, status };
}
