/**
 * 0.225: уведомления — шифрование и подпись по стандартам.
 *
 * Главная проверка здесь одна и она строгая: тело push-сообщения обязано совпасть
 * с примером из RFC 8291 (Appendix A) побайтово. Не «похоже на правильное»:
 * push-сервис на ошибку в HKDF отвечает 400 без объяснений, и уведомление просто
 * не приходит — а человек думает, что приложение его не будит.
 *
 * Вторая — полный круг: шифруем для подписки, расшифровываем её же приватным
 * ключом (как это сделал бы браузер). Так проверено не только совпадение с
 * примером, но и то, что наши ключи и ключи подписки сходятся между собой.
 */
import assert from 'node:assert/strict'
import {
  b64u, unb64u, vapidFromEnv, vapidToken, verifyVapidToken, encryptPayload, parseSubscription, sendPush,
} from '../engine/webpush.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const TE = new TextEncoder()
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign(
  'HMAC',
  await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  d,
))

/* ── 1. Вектор из стандарта ──────────────────────────────────────────────── */

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  cipher: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
}

const vector = await encryptPayload(
  { p256dh: RFC.uaPublic, auth: RFC.auth },
  RFC.plaintext,
  { salt: unb64u(RFC.salt), asPrivate: unb64u(RFC.asPrivate), asPublic: unb64u(RFC.asPublic) },
)
const want = cat(unb64u(RFC.header), unb64u(RFC.cipher))
ok('W1 тело push-сообщения совпадает с примером RFC 8291 побайтово',
  b64u(vector) === b64u(want), { got: vector.length, want: want.length })

/* ── 2. Полный круг: как это прочитает браузер ───────────────────────────── */

async function decryptAsBrowser(uaPrivate, body) {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const priv = unb64u(uaPrivate)
  /* Публичную часть из приватной не вывести средствами Web Crypto — в тесте она
     известна заранее, как и в реальной подписке. */
  const uaPublic = unb64u(RFC.uaPublic)
  const uaJwk = {
    kty: 'EC', crv: 'P-256', d: b64u(priv), x: b64u(uaPublic.slice(1, 33)), y: b64u(uaPublic.slice(33)),
  }
  const key = await crypto.subtle.importKey('jwk', uaJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const peer = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, key, 256))
  const auth = unb64u(RFC.auth)
  const prkKey = await hmac(auth, ecdh)
  const ikm = await hmac(prkKey, cat(TE.encode('WebPush: info\x00'), uaPublic, asPublic, new Uint8Array([1])))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, cat(TE.encode('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, cat(TE.encode('Content-Encoding: nonce\x00'), new Uint8Array([1])))).slice(0, 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, cipher))
  return new TextDecoder().decode(plain.slice(0, -1))
}

ok('W2 получатель расшифровывает тело своим ключом — круг замыкается',
  (await decryptAsBrowser(RFC.uaPrivate, vector)) === RFC.plaintext)

/* ── 3. Подпись VAPID ────────────────────────────────────────────────────── */

const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const env = {
  VAPID_PUBLIC: b64u(pubRaw),
  VAPID_PRIVATE: privJwk.d,
  VAPID_SUBJECT: 'mailto:test@example.org',
}
const v = vapidFromEnv(env)
ok('W3 ключи из окружения читаются: публичный 65 байт, приватный 32',
  v.ok && unb64u(v.publicKey).length === 65 && unb64u(v.jwk.d).length === 32)

const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'
const token = await vapidToken({ jwk: v.jwk, subject: v.subject, endpoint, now: 1_700_000_000_000 })
const [h, p] = token.split('.')
const claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
ok('W4 токен подписан и проверяется тем же ключом',
  await verifyVapidToken(token, v.publicKey), token.slice(0, 24))
ok('W5 в токене только origin push-сервиса, а не весь длинный адрес',
  claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'mailto:test@example.org'
    && claims.exp > Math.floor(1_700_000_000_000 / 1000))
ok('W6 подпись не сходится с чужим ключом — токен нельзя переписать',
  !(await verifyVapidToken(token, b64u(new Uint8Array(65).fill(7)))))
ok('W7 без ключей в окружении честно говорит «не заданы», а не падает',
  vapidFromEnv({}).ok === false && /не заданы/.test(vapidFromEnv({}).why))

/* ── 4. Подписка и отправка ──────────────────────────────────────────────── */

ok('W8 подписка проверяется: https и оба ключа обязательны',
  !!parseSubscription({ endpoint, keys: { p256dh: RFC.uaPublic, auth: RFC.auth } })
    && parseSubscription({ endpoint: 'http://evil', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }) === null
    && parseSubscription({ endpoint, keys: { p256dh: 'коротко', auth: RFC.auth } }) === null
    && parseSubscription({ endpoint, keys: { p256dh: RFC.uaPublic } }) === null)

let seen = null
const fake = async (url, init) => {
  seen = { url, init }
  return { status: 201 }
}
const sent = await sendPush({ endpoint, keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, { title: 'т', body: 'б' }, env, { fetch: fake })
ok('W9 отправка: заголовки по стандарту и тело зашифровано',
  sent.ok && seen.init.method === 'POST'
    && seen.init.headers['content-encoding'] === 'aes128gcm'
    && /^vapid t=eyJ/.test(seen.init.headers.authorization)
    && seen.init.headers.authorization.endsWith(', k=' + v.publicKey)
    && seen.init.body.length > 100)

const gone = await sendPush({ endpoint, keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, {}, env, { fetch: async () => ({ status: 410 }) })
const fine = await sendPush({ endpoint, keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, {}, env, { fetch: async () => ({ status: 500 }) })
ok('W10 мёртвая подписка (410) отличается от временной поломки (500)',
  gone.ok === false && gone.gone === true && fine.ok === false && fine.gone === false)

const off = await sendPush({ endpoint, keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, {}, {}, { fetch: fake })
ok('W11 без ключей отправка не пробует сеть и говорит причину',
  off.ok === false && /VAPID/.test(off.why || ''))

console.log('\n✔ 0.225: шифрование и подпись уведомлений — проверки пройдены')
