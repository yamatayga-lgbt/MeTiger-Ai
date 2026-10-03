#!/usr/bin/env node
/**
 * Живая проверка моделей: отвечает или нет, и тем ли провайдером.
 *
 * Зачем: каталог в окне выбора строится из двух источников — витрина (src/lib/models.ts)
 * и списки самих провайдеров (`GET /models`). Вторые никто не верифицирует: там полно
 * имён-алиасов агрегаторов (VTRIX «GPT 6 Astra» и прочее) с неизвестной ценой, и половина
 * из них не отвечает вовсе. Прежде чем что-то убирать из списка, это нужно измерить,
 * а не додумывать на глаз.
 *
 * Проверка идёт через настоящий путь движка (POST /api/chat с пином модели), а не прямым
 * запросом к провайдеру: человеку важна именно наша цепочка — пин, пул, отказ. Признак
 * «модель рабочая»: ok && движок ответил именно этой моделью && пин не сорвался (pinMiss).
 *
 * Запуск:
 *   node scripts/models-probe.mjs                 # витрина + 60 случайных из каталога
 *   node scripts/models-probe.mjs --all           # весь каталог (долго и много запросов)
 *   node scripts/models-probe.mjs --ids a,b,c     # список вручную
 *   node scripts/models-probe.mjs --merge docs/аудит-моделей.json  # пересобрать снимок из отчёта
 *   ENGINE=http://127.0.0.1:8788 node scripts/models-probe.mjs
 *
 * Тексты ответов не печатаются: в песочнице лог виден кому угодно, а чаты — личные.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = process.env.ENGINE || 'http://127.0.0.1:8788'
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const CONC = Number(val('--concurrency', '3'))
const SAMPLE = has('--all') ? Infinity : Number(val('--sample', '60'))
const TIMEOUT_MS = Number(val('--timeout', '60000'))
const DELAY = Number(val('--delay', '350'))
const PER_SOURCE = Number(val('--per-source', '6'))

/** id из витрины — те, что человек видит первыми. */
function showcaseIds() {
  const src = readFileSync(join(ROOT, 'src/lib/models.ts'), 'utf8')
  return [...src.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]).filter(Boolean)
}

async function catalog() {
  const r = await fetch(`${ENGINE}/api/models`, { signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`/api/models → ${r.status}`)
  return r.json()
}

async function probe(id, seq) {
  const body = JSON.stringify({
    text: 'Ответь ровно одним символом: 2+2',
    chatId: `models_probe_${seq}`,
    model: id,
  })
  const t0 = Date.now()
  try {
    const r = await fetch(`${ENGINE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const d = await r.json().catch(() => ({}))
    const answered = String(d.reply || '').trim().length > 0
    const sameModel = d.model === id || d.pinned === id
    return {
      id,
      http: r.status,
      ok: !!d.ok,
      answered,
      sameModel,
      pinMiss: !!d.pinMiss,
      provider: d.provider || '',
      used: d.model || '',
      ms: Date.now() - t0,
      err: d.error || (d.ok ? '' : 'ok:false'),
      tried: (d.tried || []).slice(0, 4).map((t) => `${t.provider}:${String(t.why || '').slice(0, 40)}`),
    }
  } catch (e) {
    return {
      id, http: 0, ok: false, answered: false, sameModel: false, pinMiss: false,
      provider: '', used: '', ms: Date.now() - t0, err: String(e && e.message || e).slice(0, 90),
    }
  }
}

/** Вердикт: жива только если движок ответил именно этой моделью и пин не промахнулся. */
/* Вердикты разделены нарочно: «квота» и «таймаут» — это не приговор модели, а состояние
   кошелька провайдера в эту минуту; удалять из списка по такому нельзя. */
const verdict = (x) => (x.ok && x.answered && x.sameModel && !x.pinMiss ? 'жива'
  : x.http === 429 ? 'квота провайдера'
  : x.http === 0 ? (String(x.err).includes('timeout') || String(x.err).includes('AbortError') ? 'таймаут' : 'сеть не ответила')
  : x.ok && x.answered ? 'отвечает не этой моделью'
  : x.pinMiss ? 'пин сорвался' : 'молчит')


/* ==================== снимок проверки ====================
   Пишет engine/models-verified.js. Правило одно: последнее измерение перекрывает
   предыдущее для тех имён, которые в этом прогоне участвовали, остальные сохраняются.
   Союз «жива когда-либо» сознательно не делаем: реле отвечает через раз, и такая модель
   в списке выбора — та же лотерея, только проверенная один раз. */
const SNAP = join(ROOT, 'engine/models-verified.js')

function readSnapshot() {
  try {
    const t = readFileSync(SNAP, 'utf8')
    const grab = (name) => {
      const m = t.match(new RegExp(name + ':\\s*\\[([\\s\\S]*?)\\]', 'm'))
      return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : []
    }
    return { at: (t.match(/at: '([^']*)'/) || [])[1] || '', alive: grab('alive'), dead: grab('dead') }
  } catch { return { at: '', alive: [], dead: [] } }
}

function writeSnapshot(res) {
  const prev = readSnapshot()
  const touched = new Set(res.map((x) => x.id))
  const alive = new Set(prev.alive.filter((id) => !touched.has(id)))
  const dead = new Set(prev.dead.filter((id) => !touched.has(id)))
  for (const x of res) {
    const v = verdict(x)
    if (v === 'жива') { alive.add(x.id); dead.delete(x.id) }
    else if (v === 'квота' || v === 'таймаут' || v === 'сеть не ответила') { /* не приговор: оставляем как было */ }
    else { dead.add(x.id); alive.delete(x.id) }
  }
  const arr = (name, ids) => `  ${name}: [\n` + ids.map((i) => `    '${i.replace(/'/g, "\\'")}',`).join('\n') + `\n  ],`
  const body = `export const VERIFIED = {\n  at: '${new Date().toISOString().slice(0, 10)}',\n  tested: ${alive.size + dead.size},\n`
    + arr('alive', [...alive].sort()) + '\n' + arr('dead', [...dead].sort()) + '\n}'
  const head = readFileSync(SNAP, 'utf8').split('export const VERIFIED')[0]
  writeFileSync(SNAP, head + body + '\n')
  console.log(`снимок обновлён: engine/models-verified.js · живых ${alive.size} · мёртвых ${dead.size}`)
}

const run = async (list) => {
  const out = []
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const n = i++
      const x = await probe(list[n], n)
      if (DELAY) await new Promise((r) => setTimeout(r, DELAY))
      out.push(x)
      process.stdout.write(`  ${(n + 1).toString().padStart(3)}/${list.length} ${verdict(x).padEnd(26)} ${x.id}\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker))
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

const seeded = (arr, n) => {
  if (!Number.isFinite(n) || arr.length <= n) return arr
  const a = arr.slice()
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]]
  }
  return a.slice(0, n)
}

const main = async () => {
  if (has('--merge')) {
    const rep = JSON.parse(readFileSync(val('--merge', join(ROOT, 'docs/аудит-моделей.json')), 'utf8'))
    writeSnapshot(rep.results || [])
    return
  }
  const cat = await catalog()
  const models = cat.models || []
  if (!models.length) throw new Error('каталог пуст — движок не отдал модели')
  const show = showcaseIds()
  const rest = models.filter((m) => !show.includes(m.id))
  // Выборка по источникам: случайные 60 из 233 в основном вытащили бы один агрегатор,
  // а нам важно знать поведение каждого (у openrouter к тому же 50 запросов в сутки).
  const bySource = new Map()
  for (const m of rest) {
    const k = m.src || '?'
    if (!bySource.has(k)) bySource.set(k, [])
    bySource.get(k).push(m.id)
  }
  const picked = [...bySource.entries()].flatMap(([k, arr]) => seeded(arr, has('--all') ? Infinity : PER_SOURCE))
  const ids = has('--ids') ? val('--ids', '').split(',').filter(Boolean)
    : [...show, ...(has('--all') ? rest.map((m) => m.id) : picked)]
  console.log('источники в выборке:', [...bySource.entries()].map(([k, v]) => `${k}:${Math.min(v.length, has('--all') ? v.length : PER_SOURCE)}/${v.length}`).join(' '))
  const byId = new Map(models.map((m) => [m.id, m]))

  console.log(`пробую ${ids.length} моделей через ${ENGINE} (параллельно ${CONC}, таймаут ${TIMEOUT_MS / 1000} с)`)
  const res = await run(ids)

  const alive = res.filter((x) => verdict(x) === 'жива')
  const dead = res.filter((x) => ['молчит', 'пин сорвался', 'отвечает не этой моделью', 'сеть не ответила'].includes(verdict(x)))
  const quota = res.filter((x) => ['квота провайдера', 'таймаут'].includes(verdict(x)))
  const unknownPrice = res.filter((x) => { const m = byId.get(x.id); return m && m.priceKnown === false })
  const nonFreeish = res.filter((x) => { const m = byId.get(x.id); return m && m.curated === false && m.priceKnown === false })

  const rows = res.map((x) => {
    const m = byId.get(x.id) || {}
    return `| \`${x.id}\` | ${(m.vendor || 'витрина').padEnd(10)} | ${verdict(x)} | ${x.provider || '—'} | ${x.ms} мс | ${m.priceKnown === false ? 'неизвестна' : 'указана'} |`
  })
  const md = `# Аудит моделей: живые ответы вместо списка

Снято скриптом \`node scripts/models-probe.mjs\` ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
через \`POST /api/chat\` с пином модели (движок: ${ENGINE}). Проба — ${ids.length} имя из ${models.length}
в каталоге; критерий «жива»: движок ответил именно этой моделью, и пин не сорвался.

Итог: живых **${alive.length}**, мёртвых или спорных **${dead.length}**, не проверено из-за
квот/таймаутов **${quota.length}**; из проверенных с
неизвестной ценой **${unknownPrice.length}**, из них вне пула движка — **${nonFreeish.length}**.

| модель | вендор | вердикт | отклик пришёл от | задержка | цена в списке |
|---|---|---|---|---|---|
${rows.join('\n')}

## Что с этим делать

- «молчит» и «пин сорвался» — кандидат на удаление из витрины: человек выбирает имя, а получает
  отказ или чужую модель;
- имена с ценой «неизвестна» вне пула — это алиасы агрегаторов (\`odirouter\`, \`xkiro\`, \`atria\`,
  \`sharellm\`): бесплатными их никто не подтверждал, в списке выбора их быть не должно;
- сам каталог (число «живых у провайдеров») оставляем как есть: это счётчик, а не меню.
`
  writeSnapshot(res)
  writeFileSync(join(ROOT, 'docs/аудит-моделей.md'), md)
  writeFileSync(join(ROOT, 'docs/аудит-моделей.json'), JSON.stringify({
    at: new Date().toISOString(), engine: ENGINE, tested: ids.length, catalogTotal: models.length,
    alive: alive.map((x) => x.id), dead: dead.map((x) => ({ id: x.id, why: verdict(x), err: x.err, tried: x.tried })),
    quota: quota.map((x) => ({ id: x.id, why: verdict(x) })),
    results: res,
  }, null, 1) + '\n')
  console.log(`\nживых ${alive.length} · мёртвых/спорных ${dead.length} · отчёт: docs/аудит-моделей.md`)
}

main().catch((e) => { console.error('проба не состоялась:', e.message); process.exit(1) })
