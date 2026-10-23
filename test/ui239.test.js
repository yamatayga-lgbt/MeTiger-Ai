/**
 * Тесты 0.239 — голосовой ввод на ходу без потерь при паузах и отправка черновика одним касанием.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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

const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui239')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const out = join(dir, 'voice.mjs')
execFileSync(
  bin,
  ['src/lib/voice.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'],
  { stdio: 'inherit' },
)
const voice = await import(out)

console.log('\n── 1. Умная склейка пауз и защита от дублей на стыках (src/lib/voice.ts) ──')

await t('T239a-1: stitchDictation убирает кумулятивный повтор Android Chrome, клеит запятые и поднимает заглавную после точки', () => {
  // Кумулятивный повтор фразы после паузы
  const s1 = voice.stitchDictation('Посчитай смету по второму этажу', 'посчитай смету по второму этажу и добавь доставку')
  assert.equal(s1, 'Посчитай смету по второму этажу и добавь доставку')

  // Полный дубль фразы при перезапуске сеанса
  const s2 = voice.stitchDictation('Купить цемент и песок', 'купить цемент и песок')
  assert.equal(s2, 'Купить цемент и песок')

  // Приклейка знака препинания без пробела и заглавная буква нового предложения
  const s3 = voice.stitchDictation('Сделай таблицу.', 'второй столбец в рублях')
  assert.equal(s3, 'Сделай таблицу. Второй столбец в рублях')

  const s4 = voice.stitchDictation('Привет', ', как дела?')
  assert.equal(s4, 'Привет, как дела?')
})

await t('T239a-2: joinLive снимает длинный стык до 8 слов, а punctuate понимает «знак вопроса» и «знак восклицания»', () => {
  const tail = voice.joinLive(
    'проверь пожалуйста остатки по складу номер три сегодня',
    'пожалуйста остатки по складу номер три сегодня утром',
  )
  assert.equal(tail, 'утром')
  assert.equal(voice.punctuate('куда везти груз знак вопроса отлично знак восклицания'), 'куда везти груз? отлично!')
})

console.log('\n── 2. Сохранение незакреплённой речи на паузе и перезапуск в мобильном WebKit ──')

await t('T239b-1: пауза без isFinal + InvalidStateError в onend не теряют первую фразу и продолжают диктовку', async () => {
  const prevWin = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  const instances = []
  class FakeMobileRecognition {
    constructor() {
      this.continuous = false
      this.interimResults = false
      this.maxAlternatives = 1
      this.lang = 'ru-RU'
      this.onresult = null
      this.onerror = null
      this.onend = null
      this.startCalls = 0
      instances.push(this)
    }
    start() {
      this.startCalls++
      // Имитируем баг мобильного WebKit: синхронный повторный start() внутри onend бросает ошибку.
      if (this.startCalls > 1) {
        const err = new Error('InvalidStateError')
        err.name = 'InvalidStateError'
        throw err
      }
    }
    stop() {}
    abort() {}
  }

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 16000
      this.destination = {}
    }
    createMediaStreamSource() { return { connect() {} } }
    createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} } }
    createGain() { return { gain: { value: 1 }, connect() {} } }
    async close() {}
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: FakeAudioContext, webkitSpeechRecognition: FakeMobileRecognition },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      language: 'ru-RU',
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    },
  })

  try {
    let acc = ''
    const session = voice.startVoice(
      {
        onFinal: (chunk) => { acc = voice.stitchDictation(acc, chunk) },
        onInterim: () => {},
        onLevel: () => {},
        onError: (msg) => { throw new Error(msg) },
      },
      'ru-RU',
    )

    for (let i = 0; i < 20 && instances.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.equal(instances.length, 1)

    // 1. Первая фраза пришла ТОЛЬКО как interim, после чего наступила пауза и браузер закрыл сеанс (onend).
    instances[0].onresult({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: false, 0: { transcript: 'напиши договор подряда точка' } },
      },
    })
    instances[0].onend()
    assert.equal(acc, 'Напиши договор подряда.')

    // 2. Ждём отложенного пересоздания распознавателя (90 мс) после InvalidStateError.
    await new Promise((r) => setTimeout(r, 130))
    assert.equal(instances.length, 2)

    // 3. Вторая фраза после паузы склеивается с заглавной буквы без потери первой!
    instances[1].onresult({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: false, 0: { transcript: 'срок работ тридцать дней' } },
      },
    })
    session.stop()
    assert.equal(acc, 'Напиши договор подряда. Срок работ тридцать дней')
  } finally {
    if (prevWin) Object.defineProperty(globalThis, 'window', prevWin)
    else delete globalThis.window
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav)
    else delete globalThis.navigator
  }
})

console.log('\n── 3. Быстрая отправка с голосовой полосы и синхронизация версий ──')

await t('T239c-1: ChatView содержит кнопку «Сразу отправить» на голосовой полосе, автоповтор при связи и чистые заметки 0.239', () => {
  const chatSrc = readFileSync('src/views/ChatView.tsx', 'utf8')
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8')

  assert.match(chatSrc, /className="voice-ic is-send"/)
  assert.match(chatSrc, /aria-label="Сразу отправить"/)
  assert.match(chatSrc, /addEventListener\('online'/)

  const v = versionsAligned()
  assert.equal(v.ok, true, v.why)
  assert.equal(/\b(src\/|engine\/|functions\/|SpeechRecognition|WebKit|InvalidStateError)\b/.test(notesSrc), false)
})

if (failed > 0) {
  console.error(`\n✗ Провалено: ${failed} из ${passed + failed}`)
  process.exit(1)
}
console.log(`\n✓ Все проверки 0.239 пройдены (${passed})`)
