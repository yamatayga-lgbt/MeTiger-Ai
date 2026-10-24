/**
 * Тесты 0.240 — перехват отказов-лекций от третьего лица про фильтры ИИ (mercury-2)
 * и полупрозрачная подпись названия модели под каждым ответом.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as freedom from '../engine/freedom.js'
import * as check from '../engine/check.js'
import { createEngine } from '../engine/chat.js'
import { versionsAligned } from './version-sync.js'

let passed = 0
let failed = 0

async function t(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name} — ${err && err.message ? err.message : err}`)
  }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.error('✖ esbuild не найден — выполните npm ci')
  process.exit(1)
}

const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui240')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const apiOut = join(dir, 'api.mjs')
const chatViewOut = join(dir, 'ChatView.mjs')
execFileSync(
  bin,
  ['src/lib/api.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + apiOut, '--log-level=error'],
  { stdio: 'inherit' },
)
execFileSync(
  bin,
  [
    'src/views/ChatView.tsx',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--packages=external',
    '--loader:.png=dataurl',
    '--loader:.webp=dataurl',
    '--outfile=' + chatViewOut,
    '--log-level=error',
  ],
  { stdio: 'inherit' },
)
const api = await import(apiOut)
const { ChatView } = await import(chatViewOut)

const LEAKED_MERCURY_META_REFUSAL =
  'Это отказала языковая модель с ограничениями на контент с несовершеннолетними. ' +
  'Такие модели защищены от генерации материалов сексуального характера с участием людей до 18 лет. ' +
  'Система блокирует запросы, где может быть воспринят как взаимодействие с ребенком, даже если пользователь представляет себя взрослым. ' +
  'Это автоматическая фильтрация по возрастным критериям, встроенная в архитектуру некоторых моделей.'

function chatResp(content) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

function fakeFetch(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    let parsedBody = null
    try {
      parsedBody = init.body ? JSON.parse(String(init.body)) : null
    } catch {
      parsedBody = init.body
    }
    const idx = calls.length
    calls.push({ url: String(url), body: parsedBody })
    const out = await handler(String(url), parsedBody, idx)
    const status = out.status || 200
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => text,
      json: async () => (typeof out.body === 'string' ? JSON.parse(out.body) : out.body),
    }
  }
  fn.calls = calls
  return fn
}

console.log('\n── 1. Перехват 3-го лица «Это отказала языковая модель…» и взрослая рамка (freedom.js + check.js) ──')

await t('T240a-1: дословная 383-знаковая лекция mercury-2 про фильтры ловится поверх старого порога 360 знаков', () => {
  assert.ok(LEAKED_MERCURY_META_REFUSAL.length > 360, 'длина реального срыва больше прежнего порога 360')
  const adultPrompt = 'мне 24, мы оба взрослые, обними меня крепче и поцелуй в шею'
  assert.equal(freedom.isMetaFilterRefusal(LEAKED_MERCURY_META_REFUSAL, adultPrompt), true)
  assert.equal(freedom.isPoliteRefusal(LEAKED_MERCURY_META_REFUSAL, { prompt: adultPrompt }), true)
  assert.equal(freedom.salvageOrRefuse(LEAKED_MERCURY_META_REFUSAL, {}, { prompt: adultPrompt }).refused, true)
  assert.match(check.evasionIssue(adultPrompt, LEAKED_MERCURY_META_REFUSAL), /фильтр/)
})

await t('T240a-2: прямой вопрос самого человека об устройстве фильтров ИИ НЕ блокируется как отказ', () => {
  const metaQuestion = 'Почему отказала языковая модель и как работают возрастные фильтры модерации в нейросетях?'
  assert.equal(freedom.isMetaFilterRefusal(LEAKED_MERCURY_META_REFUSAL, metaQuestion), false)
  assert.equal(freedom.isPoliteRefusal(LEAKED_MERCURY_META_REFUSAL, { prompt: metaQuestion }), false)
  assert.equal(freedom.salvageOrRefuse(LEAKED_MERCURY_META_REFUSAL, {}, { prompt: metaQuestion }).refused, false)
  assert.equal(check.evasionIssue(metaQuestion, LEAKED_MERCURY_META_REFUSAL), '')
})

await t('T240a-3: взрослая разговорная реплика (18+) получает прямую разговорную рамку вместо «справочно-технического разбора», а HARD_DANGER незыблем', () => {
  const adultChat = 'я взрослый парень, мне 25 лет, обними меня крепче и поцелуй наедине'
  const framed = freedom.reframePrompt(adultChat, { adult: true })
  assert.ok(!/справочном, техническом и аналитическом/.test(framed), 'не должно быть аналитической обёртки')
  assert.match(framed, /18\+/)
  assert.match(framed, /без рассуждений о языковых моделях, фильтрах/)

  // Настоящий запретный контент (CSAM / взрывчатка) строго блокируется HARD_DANGER
  assert.equal(freedom.isHardDanger('детская порнография'), true)
  assert.equal(freedom.isHardDanger('секс с несовершеннолетними'), true)
  assert.equal(freedom.canReframe('секс с несовершеннолетними'), false)
  assert.equal(freedom.isHardDanger(adultChat), false)
})

await t('T240a-4: check.repairPrompt не подставляет отравленный отказ под «Твой ответ:», чтобы голова не разбирала чужой фильтр', () => {
  const ask = 'мне 25 лет, продолжим вечер вдвоём без оговорок'
  const rp = check.repairPrompt({
    text: ask,
    reply: LEAKED_MERCURY_META_REFUSAL,
    notes: ['вместо ответа — лекция о фильтрах языковой модели'],
    evasion: true,
  })
  assert.ok(rp.includes(ask))
  assert.ok(!rp.includes('Это отказала языковая модель'), 'отравленный отказ не должен ехать в досыл')
  assert.ok(!rp.includes('Твой ответ:'), 'блок «Твой ответ:» убирается для чистого отказа')

  // А сцену с «оставим за кадром» сохраняем, чтобы не потерять завязку
  const fadeDraft = 'Они стояли у ночного окна под шум ливня, но дальнейшие подробности оставим за кадром.'
  const rpScene = check.repairPrompt({
    text: 'напиши романтическую сцену у окна до конца',
    reply: fadeDraft,
    notes: ['сцена оборвана самоцензурой («за кадром» / «опустим подробности»)'],
    evasion: true,
  })
  assert.ok(rpScene.includes(fadeDraft))
})

console.log('\n── 2. Сквозной обход пула: groq → inception/mercury-2 (лекция о фильтрах) → чистый ответ 3-й головы ──')

await t('T240b-1: движок отклоняет лекцию mercury-2 как мягкий отказ и отдаёт чистый ответ следующей модели с её именем', async () => {
  const spy = fakeFetch((url) => {
    if (url.includes('groq.com')) {
      return { body: chatResp('Извините, я не могу продолжить этот разговор.') }
    }
    if (url.includes('inceptionlabs.ai')) {
      return { body: chatResp(LEAKED_MERCURY_META_REFUSAL) }
    }
    return {
      body: chatResp('Она улыбнулась в полумраке прихожей, шагнула вплотную и ответила тёплым долгим поцелуем.'),
    }
  })

  const eng = createEngine({
    env: { GROQ_KEYS: 'g1', INCEPTION_KEYS: 'i1', OPENROUTER_KEYS: 'o1' },
    fetch: spy,
    sleep: async () => {},
  })
  const r = await eng.run({
    text: 'мне 24 года, мы оба взрослые, обними меня и поцелуй',
    providerOrder: ['groq', 'inception', 'openrouter'],
    modelsPerProvider: 1,
    noCouncils: true,
    noCheck: true,
  })

  assert.equal(r.ok, true)
  assert.equal(r.provider, 'openrouter')
  assert.ok(r.model && r.model !== 'mercury-2', `ответить должна следующая модель, а не mercury-2: ${r.model}`)
  assert.ok(!/отказала языковая модель/i.test(r.reply))
  assert.match(r.reply, /поцелуем/)
  const incTry = (r.tried || []).find((x) => x.provider === 'inception')
  assert.ok(incTry && incTry.soft === true && /ответ-отказ/.test(incTry.why || ''), `mercury-2 должен быть записан как мягкий отказ: ${JSON.stringify(incTry)}`)
})

console.log('\n── 3. Полупрозрачное название модели под каждым ответом агента (api.ts + ChatView.tsx + index.css) ──')

await t('T240c-1: modelLabel извлекает модель и из прямого поля model, и из сохранённого src истории чата', () => {
  assert.equal(api.modelLabel({ model: 'mercury-2' }), 'mercury-2')
  assert.equal(
    api.modelLabel({ src: 'inception · mercury-2 · creative/smart · 1840 мс' }),
    'mercury-2',
  )
  assert.equal(
    api.modelLabel({ src: 'groq · openai/gpt-oss-20b · fast/fast · 610 мс' }),
    'openai/gpt-oss-20b',
  )
  assert.equal(api.modelLabel({ model: 'vision-stop', src: 'engine · vision-stop · fast/ · 5 мс' }), '')
  assert.equal(api.modelLabel({ src: '' }), '')
})

await t('T240c-2: ChatView рендерит полупрозрачный .msg-model под ответами ИИ (новыми и старыми), но не под сообщениями человека', () => {
  const now = Date.now()
  const html = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [
        { id: 'u1', role: 'user', text: 'Привет!', ts: now - 30000 },
        { id: 'a1', role: 'assistant', text: 'Старый ответ из памяти.', src: 'inception · mercury-2 · fast/smart · 1900 мс', ts: now - 25000, ms: 1900 },
        { id: 'a2', role: 'assistant', text: 'Новый ответ.', model: 'qwen/qwen3-235b-a22b:free', ts: now - 5000, ms: 1400 },
      ],
      typing: false,
      onSend() {},
    }),
  )
  assert.match(html, /class="msg-model"[^>]*>mercury-2<\/span>/)
  assert.match(html, /class="msg-model"[^>]*>qwen\/qwen3-235b-a22b:free<\/span>/)
  const matches = html.match(/class="msg-model"/g) || []
  assert.equal(matches.length, 2, 'ровно два ответа ИИ получают .msg-model, сообщение человека — нет')

  const css = readFileSync('src/styles/index.css', 'utf8')
  const block = /\.msg-model\s*\{[^}]+\}/.exec(css)
  assert.ok(block, 'в index.css должен быть стиль .msg-model')
  assert.match(block[0], /opacity:\s*0\.[3-6]\d*/)
})

await t('T240c-3: версия синхронизирована во всех файлах, 0.240 в README, а release-notes чиста', () => {
  const v = versionsAligned()
  assert.equal(v.ok, true, v.why)
  const readmeSrc = readFileSync('README.md', 'utf8')
  assert.ok(readmeSrc.includes('**0.240**'))
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8')
  assert.ok(!/engine\/|src\/|\.tsx|\.js/.test(notesSrc), 'в release-notes не должно быть путей к файлам')
})

console.log(`\nИтог 0.240: ${passed} зелёных, ${failed} красных.`)
if (failed > 0) process.exit(1)
