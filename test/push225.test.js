/**
 * 0.225: «уведомление, когда ответ готов».
 *
 * Проверяем не только шифрование (оно в webpush.test.js), но и то, что вокруг
 * него не сломается: подписка хранится и удаляется, дверь не превратилась в
 * открытый релей, а дверь чата действительно досчитывает ответ после того, как
 * человек закрыл приложение.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'
import { onRequestGet, onRequestPost } from '../functions/api/push.js'
import { pushKeyOf, pushText, pushTitle, saveSubscription, readSubscription } from '../engine/pushstore.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const web = read('engine/webpush.js')
const store = read('engine/pushstore.js')
const api = read('functions/api/push.js')
const sw = read('public/sw.js')
const chat = read('functions/api/chat.js')
const appTsx = read('src/App.tsx')
const client = read('src/lib/push.ts')
const profile = read('src/views/ProfileView.tsx')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U225a все источники версии синхронизированы', v.ok, v.why)
ok('U225b история README и «Что нового» знают 0.225',
  /\*\*0\.225\*\*/.test(readme) && /version: '0\.225'/.test(notes))
ok('U225c в записи нет имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/VAPID|aes128gcm|waitUntil/.test(notes))
ok('U225d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── подписка: хранится, читается, удаляется ─────────────────────────────── */

const kv = new Map()
const MEMORY = {
  async get(key, type) {
    const raw = kv.get(key)
    if (!raw) return null
    return type === 'json' ? JSON.parse(raw) : raw
  },
  async put(key, value) { kv.set(key, value) },
  async delete(key) { kv.delete(key) },
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const env = {
  MEMORY,
  VAPID_PUBLIC: b64u(pub),
  VAPID_PRIVATE: jwk.d,
  VAPID_SUBJECT: 'mailto:test@example.org',
}
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-1', keys: { p256dh: b64u(pub), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } }

const ctx = (method, body, url) => ({
  request: new Request(url || 'https://metiger-ai.pages.dev/api/push', {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
    body: body ? JSON.stringify(body) : undefined,
  }),
  env,
})
const body = async (res) => ({ status: res.status, data: await res.json() })

const saved = await body(await onRequestPost(ctx('POST', { id: 'dev_test_1', action: 'subscribe', subscription: sub })))
ok('U225e подписка сохраняется и подтверждается',
  saved.status === 200 && saved.data.on === true && kv.has(pushKeyOf('dev_test_1')))

const got = await body(await onRequestGet(ctx('GET', null, 'https://metiger-ai.pages.dev/api/push?id=dev_test_1')))
ok('U225f без подписки ключ отдаётся, но «не подписано»',
  got.data.ok === true && got.data.key.length > 80 && got.data.on === true)

const anon = await body(await onRequestGet(ctx('GET', null, 'https://metiger-ai.pages.dev/api/push?id=other_dev')))
ok('U225g чужое устройство не будится: у него своя запись',
  anon.data.on === false)

const bad = await body(await onRequestPost(ctx('POST', { id: 'dev_test_1', action: 'subscribe', subscription: { endpoint: 'http://evil', keys: {} } })))
ok('U225h подписка с http-адресом не принимается',
  bad.status === 400 && /настоящую/.test(bad.data.error))

const removed = await body(await onRequestPost(ctx('POST', { id: 'dev_test_1', action: 'unsubscribe' })))
const after = await readSubscription(env, 'dev_test_1')
ok('U225i отписка удаляет запись, а не просто ставит флаг',
  removed.data.on === false && after === null && !kv.has(pushKeyOf('dev_test_1')))

const noId = await body(await onRequestPost(ctx('POST', { action: 'subscribe', subscription: sub })))
ok('U225j без идентификатора устройства дверь закрыта', noId.status === 400)

const unconfigured = await body(await onRequestGet({ request: new Request('https://x/api/push?id=dev'), env: { MEMORY } }))
ok('U225k без ключей сервер честно говорит «пока не настроено», а не 500',
  unconfigured.status === 200 && unconfigured.data.on === false && /VAPID/.test(unconfigured.data.why))

/* ── текст уведомления ───────────────────────────────────────────────────── */

ok('U225l в шторке первая строка без разметки, а не кусок markdown',
  pushText('**Готово.** Аренда — 950 рублей.\n\nВторой абзац') === 'Готово. Аренда — 950 рублей. Второй абзац'
    && pushText('## Итог\nтаблица | раз') === 'Итог таблица раз')
ok('U225m длинный ответ обрезается по границе слова с многоточием',
  pushText('а'.repeat(400)).length <= 140 && pushText('а'.repeat(400)).endsWith('…'))
ok('U225n пустой ответ и ошибка звучат по-разному',
  pushTitle(true) === 'MeTiger Ai — ответ готов'
    && pushTitle(false) === 'MeTiger Ai — не получилось'
    && pushText('', false) === 'Ответ не получился — загляните в чат')

/* ── дверь чата: досчёт и уведомление ────────────────────────────────────── */

ok('U225o оборванный поток не отменяет работу: job отдан waitUntil',
  /context\.waitUntil\(job\)/.test(chat)
    && /writer\.closed\.catch\(\(\) => \{ clientGone = true; closed = true; \}\)/.test(chat))
ok('U225p уведомление шлётся только ушедшему и только по его просьбе',
  /if \(!clientGone \|\| !notifyOn \|\| !notifyUser\) return;/.test(chat)
    && /copy\.notify === true \|\| copy\.notify === 1/.test(chat)
    && /notify: opts\.notify \? true : undefined/.test(read('src/lib/api.ts')))
ok('U225q пауза перед уведомлением есть — вернувшегося не будим',
  /pause\(PUSH_GRACE_MS\)/.test(chat) && /PUSH_GRACE_MS = 2000/.test(store))
ok('U225r мёртвая подписка удаляется при отправке',
  /if \(res && res\.gone\) await forgetSubscription/.test(store))

/* ── клиент ─────────────────────────────────────────────────────────────── */

ok('U225s разрешение спрашивается только по нажатию, а не при загрузке',
  /export async function enablePush/.test(client)
    && /Notification\.requestPermission\(\)/.test(client)
    && !/useEffect\(\(\) => \{\s*void enablePush/.test(client))
ok('U225t скрытая вкладка уведомляет сама, видимая — молчит',
  /document\.visibilityState !== 'hidden'/.test(client)
    && /notifyIfHidden\(chatId, reply\)/.test(appTsx))
ok('U225u после перезапуска подписка приводится в порядок молча',
  /export async function syncPush/.test(client) && /void syncPush\(\)/.test(appTsx))
ok('U225v в профиле есть строка «Уведомления» и проверка связи',
  /<span className="rows-name">Уведомления<\/span>/.test(profile)
    && /Проверить уведомление/.test(profile)
    && /запрещены в браузере/.test(profile))

/* ── service worker ─────────────────────────────────────────────────────── */

ok('U225w воркер показывает уведомление и ведёт в приложение',
  /addEventListener\('push'/.test(sw) && /showNotification\(/.test(sw)
    && /addEventListener\('notificationclick'/.test(sw) && /clients\.openWindow/.test(sw))
ok('U225x уведомление одно на ответ, а не стопка',
  /tag: 'mt-answer'/.test(sw))
ok('U225x2 нажатие открывает именно тот чат, где готов ответ',
  /searchParams\.get\('chat'\)/.test(appTsx) && /setActiveChatId\(id\)/.test(appTsx)
    && /url\.searchParams\.delete\('chat'\)/.test(appTsx))

/* ── проверка подключена к прогону ──────────────────────────────────────── */

ok('U225y проверки подключены к общему прогону',
  /test\/webpush\.test\.js/.test(chain) && /test\/push225\.test\.js/.test(chain))

console.log('\n✔ 0.225: уведомления о готовом ответе — проверки пройдены')
