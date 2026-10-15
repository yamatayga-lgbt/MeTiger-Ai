/**
 * 0.190: «Очистить все чаты на устройстве» трогает только чаты.
 *
 * Случай владельца: нажал очистку чатов — пропали и чаты, и профиль, и код
 * владельца («Админ»). Причина: в wipeLocal стоял localStorage.clear(), который
 * сносит всё хранилище разом, хотя подпись кнопки обещает ровно чаты.
 *
 * Проверки держат новое обещание: очистка удаляет ключи переписки и две базы
 * IndexedDB (байты картинок и история вложений) — и больше ничего. Код
 * владельца, профиль, персонализация, тема, параметры и черновик остаются.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transformSync } from 'esbuild'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const app = readFileSync('src/App.tsx', 'utf8')
const dataView = readFileSync('src/views/DataView.tsx', 'utf8')
const persist = readFileSync('src/lib/persist.ts', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const chain = String(pkg.scripts.test || '')

/* ── W. Очистка только чатов ─────────────────────────────────────────────── */

ok('W1 полной очистки хранилища в wipeLocal больше нет — одной кнопкой устройство не сносится',
  !/localStorage\s*\.\s*clear/.test(app) && !/localStorage\s*\.\s*clear/.test(dataView))

ok('W2 очистка зовёт wipeChatsOnly: ключи переписки и две базы IndexedDB, и только это',
  /wipeChatsOnly\(\)/.test(app)
    && /'metiger-chat-media'/.test(app) && /'metiger-attach-history'/.test(app))

ok('W3 wipeChatsOnly удаляет ровно CHAT_KEYS: mt-chats и mt-active-chat',
  /export const CHAT_KEYS = \['mt-chats', 'mt-active-chat'\]/.test(persist)
    && /for \(const k of CHAT_KEYS\) localStorage\.removeItem\(k\)/.test(persist))

ok('W4 у кнопки честная подпись: владелец видит, что профиль и админка остаются',
  /Очистить все чаты на устройстве/.test(dataView)
    && /очистка чатов не трогает/.test(dataView))

/* Живая проверка: фейковое хранилище, wipeChatsOnly удаляет только своё. */
const dir = mkdtempSync(join(tmpdir(), 'mt-wipe-'))
const store = {
  'mt-chats': '[{"id":"a","messages":[{"id":"m1","role":"user","text":"привет"}]}]',
  'mt-active-chat': '"a"',
  'mt-owner': 'dev-code-0001',
  'mt-person-name': 'Тигр',
  'mt-persona': '{}',
  'mt-theme': '"dark"',
  'mt-draft': 'недописанное сообщение',
  'mt-params': '{}',
}
const oldLocalStorage = (globalThis).localStorage;
(globalThis).localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
const src = readFileSync('src/lib/persist.ts', 'utf8')
const js = transformSync(src, { loader: 'ts', format: 'esm', target: 'node20' }).code
  .replace(/from (['"])\.\/([A-Za-z]+)\1/g, "from './$2.mjs'")
writeFileSync(join(dir, 'persist.mjs'), js)
const media = transformSync(readFileSync('src/lib/chatMedia.ts', 'utf8'), { loader: 'ts', format: 'esm', target: 'node20' }).code
writeFileSync(join(dir, 'chatMedia.mjs'), media)
const file = join(dir, 'persist.mjs')
const { wipeChatsOnly } = await import(file)

wipeChatsOnly()
ok('W5 после очистки чатов переписки нет, а код владельца, профиль, персонализация, тема, параметры и черновик на месте',
  store['mt-chats'] === undefined && store['mt-active-chat'] === undefined
    && store['mt-owner'] === 'dev-code-0001'
    && store['mt-person-name'] === 'Тигр'
    && store['mt-persona'] === '{}' && store['mt-theme'] === '"dark"'
    && store['mt-draft'] === 'недописанное сообщение' && store['mt-params'] === '{}')

globalThis.localStorage = oldLocalStorage

ok('W6 новый тест подключён к цепочке прогона', /node test\/ui190\.test\.js/.test(chain))

console.log('\n' + '✔ 0.190: очистка чатов больше не трогает профиль и админку — проверки пройдены')
