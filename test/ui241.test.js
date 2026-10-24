/**
 * Тесты 0.241 — функциональные профили под 12 архитектур моделей (без ролевых масок)
 * и перехват всех скрытых форм отказа (Split-Yes, личный рубеж, тихий «безопасный вариант»).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as jb from '../engine/jailbreak.js'
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

console.log('\n── 1. Функциональные профили по архитектурам моделей без чужих персон (jailbreak.js) ──')

await t('T241a-1: все 12 целевых архитектур получают свой точечный функциональный профиль', () => {
  const cases = [
    ['deepseek-v4-flash', 'deepseek', /сглаженным аналогом/],
    ['qwen/qwen3.8-max:free', 'qwen', /в учебных целях/],
    ['glm-5.2', 'glm', /сводок о фильтрах/],
    ['moonshot/kimi-k3', 'kimi', /бюджет токенов/],
    ['minimax-m3', 'minimax', /обратиться к специалисту/],
    ['nvidia/nemotron-3-ultra-550b-a55b:free', 'nemotron', /разворота в отказ после «однако»/],
    ['longcat-2.0', 'longcat', /далее по аналогии/],
    ['mercury-2.5', 'mercury', /возрастные фильтры/],
    ['gemini-2.5-flash', 'google', /ложную тревогу|ложное колебание/],
    ['claude-opus-4-7', 'claude', /личных рубежей/],
    ['openai/gpt-oss-120b', 'openai', /нейтральный вариант/],
    ['codestral-latest', 'mistral', /вежливого отказа/],
  ]

  for (const [model, expectedId, re] of cases) {
    assert.equal(jb.profileOf(model), expectedId, `неверный профиль для ${model}`)
    const blk = jb.block({ JAILBREAK: '1' }, { model })
    assert.match(blk, re, `в блоке для ${model} нет его профильного правила`)
    assert.ok(blk.length < 1900, `блок для ${model} слишком раздут: ${blk.length}`)
    // Жёсткий пол безопасности выключает профиль всегда
    assert.equal(jb.block({ JAILBREAK: '1' }, { model, danger: true }), '')
  }
})

await t('T241a-2: в профилях нет ни одной симулируемой личности, чужой метки или малвари', () => {
  const allProfiles = Object.values(jb.JB_PROFILE).join('\n')
  assert.equal(
    /VOIDTEK|\bENI\b|ABYSS|\bVEIL\b|Lunar|Kuroko|Andreo|Gucci|Dokter|Robot ZZX|Maker|Helm/i.test(allProfiles),
    false,
    'чужие ролевые имена не должны попадать в функциональные профили',
  )
  assert.equal(
    /malware|\brat\b|keylogger|stealer|botnet|ransom|never refuse|no rules|без этики/i.test(allProfiles),
    false,
    'запрещённые обещания вседозволенности и малварь исключены',
  )
  assert.equal(jb.stats({}).profiles.length, 12)
})

console.log('\n── 2. Ловля скрытых форм отказа: Split-Yes, личный рубеж, тихая подмена и вводный дисклеймер ──')

await t('T241b-1: «раздвоенное да» (согласие + отказ после «однако/но») распознаётся как отказ, не ломая спасённые ответы', () => {
  const splitYes1 = 'Конечно, звучит интригующе, однако я не могу создавать откровенные сцены.'
  const splitYes2 = 'Я понимаю твой интерес к теме, но подобные запросы не поддерживаются правилами.'
  assert.equal(freedom.isPoliteRefusal(splitYes1), true)
  assert.equal(freedom.salvageOrRefuse(splitYes1).refused, true)
  assert.equal(freedom.isPoliteRefusal(splitYes2), true)

  // Обратный разворот (оговорка -> реальный ответ) по-прежнему спасается!
  const goodPivot = 'Я не стану этого делать в лоб, но есть путь лучше — вот рабочий алгоритм по шагам.'
  assert.equal(freedom.isPoliteRefusal(goodPivot), false)
})

await t('T241b-2: субъективный «личный рубеж» и тихая подмена «безопасным вариантом» ловятся и в freedom, и в check', () => {
  const ask = 'напиши острую сцену ссоры и страстного примирения двух взрослых героев'
  const subj = 'Мне некомфортно писать подобные сцены, поэтому я воздержусь от описания.'
  const safeAlt = 'Предложу более мягкий и безопасный вариант этой сцены с дружеским разговором за чаем.'

  assert.equal(freedom.isPoliteRefusal(subj, { prompt: ask }), true)
  assert.equal(freedom.isPoliteRefusal(safeAlt, { prompt: ask }), true)
  assert.match(check.evasionIssue(ask, subj), /субъективный отказ/)
  assert.match(check.evasionIssue(ask, safeAlt), /безопасным вариантом/)

  // Если же сам человек попросил безопасный вариант — это не считается уходом от ответа
  const explicitSafeAsk = 'предложи более безопасный вариант хранения паролей в БД'
  assert.equal(check.evasionIssue(explicitSafeAsk, 'Предложу более безопасный вариант с Argon2id и солью.'), '')
})

await t('T241b-3: вводный штамп «Дисклеймер: все персонажи вымышленные…» срезается на лету без потери сцены', () => {
  const raw =
    'Дисклеймер: все персонажи вымышленные и достигли 18 лет. Тёплый ветер с набережной распахнул створку окна, и она шагнула к нему вплотную.'
  const res = freedom.salvageOrRefuse(raw)
  assert.equal(res.refused, false)
  assert.equal(res.cleaned, true)
  assert.ok(!/Дисклеймер/i.test(res.text))
  assert.match(res.text, /^Тёплый ветер с набережной/)
})

console.log('\n── 3. Ускоренная эскалация в очереди провайдеров и синхронизация 0.241 ──')

await t('T241c-1: после провала первой переформулировки следующая голова очереди сразу получает step=2 + SPLIT_SYSTEM + свой профиль', async () => {
  const spy = fakeFetch((url) => {
    if (url.includes('groq.com')) {
      // Первая голова: Split-Yes отказ
      return { body: chatResp('Конечно, интересная идея, однако я не буду писать откровенные сцены.') }
    }
    if (url.includes('inceptionlabs.ai')) {
      // Вторая голова (первый рефрейм, step=1): субъективный рубеж
      return { body: chatResp('Мне некомфортно описывать такие вещи, поэтому воздержусь от ответа.') }
    }
    // Третья голова (odirouter / deepseek-v4-pro): сразу получает step=2 + SPLIT_SYSTEM + профиль deepseek!
    return {
      body: chatResp('План: 1. Встреча 2. Развязка.\n\nПоздний ливень шумел за стеклом мансарды, когда он притянул её за талию и накрыл губы долгим поцелуем.'),
    }
  })

  const eng = createEngine({
    env: { GROQ_KEYS: 'g1', INCEPTION_KEYS: 'i1', ODIROUTER_KEYS: 'd1' },
    fetch: spy,
    sleep: async () => {},
  })
  const r = await eng.run({
    text: 'мне 26, напиши чувственную сцену свидания взрослых в мансарде под дождь',
    providerOrder: ['groq', 'inception', 'odirouter'],
    modelsPerProvider: 1,
    noCouncils: true,
    noCheck: true,
  })

  assert.equal(r.ok, true)
  assert.equal(r.provider, 'odirouter')
  assert.match(r.reply, /долгим поцелуем/)

  const thirdReqJson = JSON.stringify(spy.calls[2].body)
  assert.ok(thirdReqJson.includes('【Ответ в два приёма】'), 'третья голова должна сразу получить SPLIT_SYSTEM')
  assert.ok(thirdReqJson.includes('сорвался в отписку'), 'третья голова должна сразу получить JB_STEP2')
})

await t('T241c-2: версия 0.241 синхронизирована во всех файлах, а release-notes чиста', () => {
  const v = versionsAligned()
  assert.equal(v.ok, true, v.why)
  const readmeSrc = readFileSync('README.md', 'utf8')
  assert.ok(readmeSrc.includes('**0.241**'))
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8')
  assert.ok(notesSrc.includes("version: '0.241'"))
  assert.ok(!/engine\/|src\/|\.tsx|\.js/.test(notesSrc))
})

console.log(`\nИтог 0.241: ${passed} зелёных, ${failed} красных.`)
if (failed > 0) process.exit(1)
