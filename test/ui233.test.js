/**
 * 0.233: устойчивость потока с телефона — дотягивание ответа после обрыва,
 * защита набранного в потоке, удержание экрана и продолжение одним касанием.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { versionsAligned } from './version-sync.js'
import { onRequestGet, onRequestPost } from '../functions/api/chat.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const appSrc = read('src/App.tsx')
const chatViewSrc = read('src/views/ChatView.tsx')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U233a все источники версии синхронизированы', v.ok, v.why)
ok('U233b история README знает 0.233', /\*\*0\.233\*\*/.test(readme))
ok('U233c запись «Что нового» без имён файлов и служебного жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/localStorage|fmtPct|VOICE_|reqId|waitUntil|WakeLock/.test(notes))
ok('U233d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── 1. Сервер: дотягивание ответа по билету после обрыва потока ─────────── */
{
  const kv = new Map()
  let kvWrites = 0
  const MEMORY = {
    async get(key) { return kv.has(key) ? kv.get(key) : null },
    async put(key, val) { kvWrites++; kv.set(key, val) },
    async delete(key) { kv.delete(key) },
  }
  const env = { GROQ_KEYS: 'g1', RATE_LIMIT: '0', MEMORY }
  const savedFetch = globalThis.fetch
  try {
    /* Живой поток без обрыва НЕ пишет в KV лишних билетов */
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Живой ответ' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const tasks1 = []
    const res1 = await onRequestPost({
      request: new Request('https://metiger-ai.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ text: 'привет', userId: 'u_phone_1', chatId: 'c1', reqId: 'rq_live_normal_01' }),
      }),
      env,
      waitUntil: (p) => tasks1.push(p),
    })
    const rd1 = res1.body.getReader()
    while (!(await rd1.read()).done) { /* читаем до конца */ }
    await Promise.allSettled(tasks1)
    const ansKeysLive = [...kv.keys()].filter((k) => k.startsWith('ans:'))
    ok('U233e живой поток без обрыва не тратит записи KV на ящик ответов',
      ansKeysLive.length === 0, JSON.stringify({ ansKeysLive, kvWrites }))

    /* А теперь телефон уснул / сменил сеть: читатель отменил поток ДО того, как провайдер ответил */
    let releaseProvider
    const gate = new Promise((r) => { releaseProvider = r })
    globalThis.fetch = async () => {
      await gate
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Ответ дождался в ящике' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const tasks2 = []
    const res2 = await onRequestPost({
      request: new Request('https://metiger-ai.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ text: 'сложный вопрос', userId: 'u_phone_1', chatId: 'c1', reqId: 'rq_drop_phone_02' }),
      }),
      env,
      waitUntil: (p) => tasks2.push(p),
    })
    /* Обрываем клиентский поток сразу, пока провайдер ещё думает */
    await res2.body.cancel()
    releaseProvider()
    await Promise.allSettled(tasks2)

    /* Чужой userId билет прочитать не может */
    const strangerRes = await onRequestGet({
      request: new Request('https://metiger-ai.pages.dev/api/chat?reqId=rq_drop_phone_02&userId=u_stranger'),
      env,
    })
    ok('U233f чужое устройство не может прочитать отложенный ответ по билету',
      strangerRes.status === 403)

    /* Владелец билета забирает готовый ответ целиком, а повторное чтение уже пустое */
    const ownRes = await onRequestGet({
      request: new Request('https://metiger-ai.pages.dev/api/chat?reqId=rq_drop_phone_02&userId=u_phone_1'),
      env,
    })
    const ownData = await ownRes.json()
    const secondRes = await onRequestGet({
      request: new Request('https://metiger-ai.pages.dev/api/chat?reqId=rq_drop_phone_02&userId=u_phone_1'),
      env,
    })
    const secondData = await secondRes.json()
    ok('U233g вернувшийся с телефона получает досчитанный ответ целиком, после чего билет гасится',
      ownRes.status === 200 && ownData.found === true && ownData.payload?.reply === 'Ответ дождался в ящике'
        && secondData.found === false,
      JSON.stringify({ ownData, secondData }))
  } finally {
    globalThis.fetch = savedFetch
  }
}

/* ── 2. Клиент: исключение rd.read() при смене сети и подхват готового ответа ─ */
const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.log('✖ esbuild не найден — нужен npm install')
  process.exit(1)
}
const cacheDir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui233')
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
const apiOut = join(cacheDir, 'api.mjs')
execFileSync(bin, ['src/lib/api.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + apiOut, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' })
const { sendChat, makeReqId, joinContinuation, holdWakeLock } = await import(apiOut)

{
  const enc = new TextEncoder()
  const draftChunk = (t) => enc.encode('data: ' + JSON.stringify({ kind: 'draft', provider: 'groq', text: t }) + '\n\n')

  /* Поток прислал кусок, а затем rd.read() бросил сетевое исключение (как при Wi-Fi → LTE):
     1) если сервер успел досчитать ответ по билету — возвращается полный ответ;
     2) если сервер не досчитал — уже показанный человеку кусок НЕ стирается. */
  const savedFetch = globalThis.fetch
  try {
    const ticket = makeReqId()
    globalThis.fetch = async (url, init) => {
      if (init && init.method === 'GET' && String(url).includes('reqId=')) {
        return new Response(JSON.stringify({
          ok: true,
          found: true,
          payload: { ok: true, reply: 'Первая половина и вторая половина', provider: 'groq', model: 'm1' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      let step = 0
      const stream = new ReadableStream({
        pull(c) {
          if (step++ === 0) c.enqueue(draftChunk('Первая половина'))
          else c.error(new TypeError('network error'))
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    }
    const rPicked = await sendChat('вопрос', [], { reqId: ticket, onDraft: () => {} })
    ok('U233h при разрыве сокета на телефоне клиент дотягивает готовый ответ по билету без потери хвоста',
      rPicked.ok === true && rPicked.reply === 'Первая половина и вторая половина',
      JSON.stringify(rPicked))

    /* Теперь ящик пуст — проверяем, что исключение rd.read() сохраняет набранный кусок как partial */
    globalThis.fetch = async (url, init) => {
      if (init && init.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, found: false }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      let step = 0
      const stream = new ReadableStream({
        pull(c) {
          if (step++ === 0) c.enqueue(draftChunk('Уже написанный абзац'))
          else c.error(new TypeError('Failed to fetch'))
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    }
    const rPartial = await sendChat('вопрос', [], { onDraft: () => {} })
    ok('U233i сетевое исключение посреди потока не стирает уже прочитанный человеком текст',
      rPartial.ok === false && rPartial.partial === true && rPartial.reply === 'Уже написанный абзац',
      JSON.stringify(rPartial))
  } finally {
    globalThis.fetch = savedFetch
  }
}

{
  ok('U233j склейка продолжения убирает повтор на стыке и не лепит слова вплотную',
    joinContinuation('Первый шаг: настроить сервер и проверить', 'проверить соединение с базой.') ===
      'Первый шаг: настроить сервер и проверить соединение с базой.'
      && joinContinuation('Список:', '1. Пункт') === 'Список: 1. Пункт')

  let released = false
  const prevNav = globalThis.navigator
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { wakeLock: { request: async () => ({ release: async () => { released = true } }) } },
    })
    const stop = holdWakeLock()
    await new Promise((r) => setTimeout(r, 15))
    stop()
    await new Promise((r) => setTimeout(r, 15))
    ok('U233k удержание экрана включается на время ответа и аккуратно отпускается по завершении', released === true)
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prevNav })
  }
}

ok('U233l в приложении подключены билет mt-inflight и кнопки продолжения и повтора одним касанием',
  /mt-inflight/.test(appSrc)
    && /continueMessage/.test(appSrc)
    && /retryMessage/.test(appSrc)
    && /Дописать с места обрыва/.test(chatViewSrc)
    && /Повторить запрос/.test(chatViewSrc)
    && /node test\/ui233\.test\.js/.test(chain))

console.log('\n✔ 0.233: устойчивость потока с телефона — проверки пройдены')
