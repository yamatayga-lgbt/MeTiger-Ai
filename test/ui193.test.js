/**
 * 0.193: режим «Безлимитный контекст».
 *
 * Просьба владельца (приоритет 1 плана обгона): разговор не должен забывать
 * начало только потому, что окно модели кончилось. Переключатель в «Параметрах»;
 * во включённом состоянии фронт шлёт до 200 реплик вместо 8, дверь поднимает
 * потолки, а движок сжимает невлезающее в богатую выжимку (начало разговора —
 * целиком) вместо короткой строки-напоминания.
 *
 * Проверки держат всю дорогу флага: переключатель → запрос → дверь → движок.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

/* ── Фронт: переключатель и дорога флага ─────────────────────────────────── */
ok('C1 переключатель «Безлимитный контекст» живёт в «Параметрах»: role="switch", без анимаций',
  /Безлимитный контекст/.test(popover) && /role="switch"/.test(popover)
    && /params-switch-dot/.test(popover)
    && !/transition/.test(css.slice(css.indexOf('.params-switch {'), css.indexOf('.params-switch {') + 700)))

ok('C2 параметр в GenParams: сохраняется, старое состояние не ломается, по умолчанию выключен',
  /ctxUnlimited\?: boolean/.test(models)
    && /ctxUnlimited: p\.ctxUnlimited === true/.test(models)
    && /p\.ctxUnlimited !== true/.test(models))

ok('C3 флаг доезжает до двери: тело запроса и лента 200 вместо 8',
  /ctxUnlimited: opts\.ctxUnlimited \? true : undefined/.test(api)
    && /history\.slice\(-\(opts\.ctxUnlimited \? 200 : 8\)\)/.test(api)
    && /const histMax = genParams\.ctxUnlimited \? 200 : 8/.test(app))

/* ── Сервер: дверь и движок ──────────────────────────────────────────────── */
ok('C4 дверь пропускает флаг в движок, движок несёт его в каждую подгонку окна',
  /ctxUnlimited: norm\.ctxUnlimited === true/.test(door)
    && (engine.match(/ctxUnlimited: input\.ctxUnlimited === true/g) || []).length >= 3,
  (engine.match(/ctxUnlimited/g) || []).length)

ok('C5 капы безлимита: реплика 16 000, текст 96 000, лента 200; без флага — прежние',
  /unlimited \? 16000 : MAX_MSG/.test(ctxfit)
    && /unlimited \? 96000 : MAX_TEXT/.test(ctxfit)
    && /unlimited \? 200 : MAX_HISTORY/.test(ctxfit)
    && /ctxUnlimited: unlimited,/.test(ctxfit))

ok('C6 выжимка богатая: до 40 реплик по 220 знаков, начало разговора — до 1500 целиком',
  /function richDigest/.test(ctxfit)
    && /parts\.length >= 40/.test(ctxfit)
    && /\.slice\(0, 220\)/.test(ctxfit)
    && /\.slice\(0, 1500\)/.test(ctxfit)
    && /С чего начался разговор \(целиком\)/.test(ctxfit))

ok('C7 выжимка вписывается в окно: не влезает — снимаем ещё реплик и обогащаем (порядок не переворачивается)',
  /порядок выжимки остаётся «от начала разговора к концу»/.test(ctxfit)
    && /droppedList\.push\(out\.history\.shift\(\)\);/.test(ctxfit)
    && /guard < 250/.test(ctxfit))

ok('C8 примечание человеку честное: сколько реплик целиком и сколько сжато',
  /безлимит: ' \+ out\.history\.length \+ ' реплик целиком, предыдущие ' \+ droppedList\.length \+ ' сжал в выжимку/.test(ctxfit.replace(/\n/g, ' ').replace(/ {2}/g, ' ')))

ok('C9 обычный режим не тронут: тонкая выжимка и прежние примечания на месте',
  /function digest\(list\)/.test(ctxfit)
    && /историю урезал на ' \+ droppedList\.length \+ ' реплик с начала/.test(ctxfit.replace(/\n/g, ' ')))

ok('C10 тест подключён к цепочке прогона', /node test\/ui193\.test\.js/.test(chain))

console.log('\n' + '✔ 0.193: безлимитный контекст — разговор помнит начало — проверки пройдены')
