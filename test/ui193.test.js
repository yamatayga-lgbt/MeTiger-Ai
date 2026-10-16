/**
 * 0.195: бесконечная память — лента чата уходит целиком, без капов.
 *
 * Владелец: «зачем нам этот переключатель? Безлимитный контекст и так будет
 * всегда работать, но только в отдельных чатах». Так и сделано: ни флагов, ни
 * настройки — каждый чат несёт свою историю (до 200 реплик), дверь и движок
 * подняли потолки, а то, что не влезает в окно модели, сжимается в богатую
 * выжимку: начало разговора — целиком, старое — по ~220 знаков. Чаты изолированы:
 * удалил чат — ушла и серверная память этого разговора (forgetThread), и медиа.
 *
 * Проверки держат и отсутствие старого переключателя, и работу новой схемы.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const models = read('src/lib/models.ts')
const popover = read('src/components/ParamsPopover.tsx')
const api = read('src/lib/api.ts')
const app = read('src/App.tsx')
const door = read('functions/api/chat.js')
const engine = read('engine/chat.js')
const ctxfit = read('engine/ctxfit.js')
const css = read('src/styles/index.css')
const pkg = JSON.parse(read('package.json'))
const chain = String(pkg.scripts.test || '')

/* все файлы фронтенда — чтобы подтвердить: флага нигде не осталось */
const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|css)$/.test(name) || /\.(js)$/.test(name)) acc.push(p)
  }
  return acc
}
const srcAll = walk('src').map(read).join('\n')

/* ── переключателя больше нет ────────────────────────────────────────────── */
ok('C1 переключателя «Безлимитный контекст» в Параметрах нет — режим всегда включён',
  !/Безлимитный контекст/.test(popover) && !/params-switch/.test(css),
  'упоминаний: ' + (popover.match(/Безлимитный/g) || []).length)

ok('C2 флага ctxUnlimited во фронтенде не осталось ни в одном файле',
  !/ctxUnlimited/.test(srcAll))

/* ── фронт шлёт много всегда ─────────────────────────────────────────────── */
ok('C3 фронт уходит всей историей чата — без срезов и капов',
  /\n        history,/.test(api) && !/history\.slice\(/.test(api)
    && /const history = \(current\?\.messages \?\? \[\]\)\.map/.test(app) && !/histMax/.test(app))

/* ── сервер: флага нет, капы высокие всегда ──────────────────────────────── */
ok('C4 в двери и движке флага нет — режим не переключается',
  !/ctxUnlimited/.test(door) && !/ctxUnlimited/.test(engine))

ok('C5 капы: реплика 16 000, текст 96 000, лента без предела (env-ручки сильнее)',
  /msg: num\(env && env\.CTX_MAX_MSG, 16000\)/.test(ctxfit)
    && /text: num\(env && env\.CTX_MAX_TEXT, 96000\)/.test(ctxfit)
    && /history: num\(env && env\.CTX_MAX_HISTORY, Infinity\)/.test(ctxfit))

/* ── выжимка: богатая, всегда ────────────────────────────────────────────── */
ok('C6 выжимка всегда богатая: richDigest вместо тонкой, начало разговора — целиком',
  /function richDigest/.test(ctxfit)
    && !/function digest\(/.test(ctxfit)
    && /body\.slice\(-60\)/.test(ctxfit) && /\.slice\(0, 240\)/.test(ctxfit)
    && /С чего начался разговор \(целиком\)/.test(ctxfit)
    && /старые реплики целиком не влезают в окно/.test(ctxfit))

ok('C7 выжимка вписывается в окно: не влезает — снимаем ещё реплик и обогащаем',
  /droppedList\.push\(out\.history\.shift\(\)\);/.test(ctxfit) && /guard < 250/.test(ctxfit))

ok('C8 примечание человеку: сколько реплик целиком и сколько сжато',
  /'в окне ' \+ out\.history\.length \+ ' реплик целиком, предыдущие ' \+ droppedList\.length \+ ' сжал в выжимку/
    .test(ctxfit.replace(/\n/g, ' ').replace(/ {2}/g, ' ')))

ok('C9 движок тащит всю ленту по умолчанию; явный historyKeep сильнее',
  /slice\(-Number\(input\.historyKeep \|\| Infinity\)\)/.test(engine))

ok('C10 тест подключён к цепочке прогона', /node test\/ui193\.test\.js/.test(chain))

console.log('\n' + '✔ 0.195: бесконечная память — лента не ограничена')
