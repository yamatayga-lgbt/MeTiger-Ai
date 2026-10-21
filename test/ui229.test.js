/**
 * 0.229: видно, КАК агент работает — одна лента шагов над ответом.
 *
 * Просьба владельца дословно: «усилил бы ответы и визуально лучше, также как
 * агент думает и т.п., чтобы можно было посмотреть как он думает, окошко
 * сворачивается автоматически, текст идёт плавно, с прозрачностями в начале и
 * в конце как он думает. Короче всякие штучки сделай. Как сейчас типа Edit,
 * Read, Search, Thinking».
 *
 * Что было: пять независимых блоков («Думал N с», «Прочитал N файлов»,
 * «использовал веб-поиск», «Searching the web», «Drawing the image»). Каждый
 * сворачивался сам по себе, жил на своём месте и половина говорила
 * по-английски. Человек видел не работу агента, а пять разных отчётов.
 *
 * Что стало: одна лента — заголовок «Думал 4 с · 3 шага», под ним след шагов
 * (искал / открыл / прочитал / нарисовал / инструмент) и сами мысли с
 * затуханием по краям. Пока идёт работа — раскрыта и тикает; пошёл ответ —
 * сворачивается сама; развернул человек — остаётся развёрнутой.
 *
 * Проверки стерегут именно эти обещания, а не устройство кода.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const css = read('src/styles/index.css')
const view = read('src/views/ChatView.tsx')
const trace = read('src/components/AgentTrace.tsx')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

/* Комментарии вон: в пояснениях «почему так» стоят те же слова (в том числе
   английские названия старых блоков), и проверки «этого нет» ловили бы текст,
   а не код. Тот же приём, что в U176/U177. */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

ok('U229a все источники версии синхронизированы', v.ok, v.why)
ok('U229b история README знает 0.229', /\*\*0\.229\*\*/.test(readme))
ok('U229c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/AgentTrace|Grid|mask-image|ui229/.test(notes))
ok('U229d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── одна лента вместо пяти блоков ───────────────────────────────────── */

ok('U229e лента шагов — отдельный компонент, и он подключён к чату',
  existsSync('src/components/AgentTrace.tsx')
    && /export function AgentTrace/.test(trace)
    && /import \{ AgentTrace \} from '\.\.\/components\/AgentTrace'/.test(view)
    /* Живая и готовая — одна и та же лента, не два разных блока. */
    && (view.match(/<AgentTrace/g) || []).length === 2)

ok('U229f пяти старых блоков больше нет ни в разметке, ни в стилях',
  !/CollapsedThought|ToolUsedBadge|ExploredReadsBlock|WebSearchBlock|ImageProgressBlock/.test(bare(view))
    && !/msg-reason|msg-explored|msg-web-search|msg-tool-used|img-prog/.test(bare(css))
    && !/explored-step|web-search-title|reason-brain-icon/.test(bare(css)))

/* ── окно раскрыто, пока идёт работа, и сворачивается само ───────────── */

ok('U229g пошёл текст ответа — лента сворачивается сама (живость гаснет вместе с первым куском ответа)',
  /live=\{!draft\}/.test(view)
    /* Внутри оболочки: старт — по живости, а смена живости двигает раскрытие. */
    && /const \[open, setOpen\] = useState\(live\)/.test(trace)
    && /if \(wasLive\.current === live\) return/.test(trace)
    && /setOpen\(live \? true : false\)/.test(trace)
    /* Раскрытие анимируется высотой сетки, а не «появилось/исчезло». */
    && /grid-template-rows: 0fr/.test(css) && /\.trace\.is-open \.trace-body \{[\s\S]{0,80}grid-template-rows: 1fr/.test(css))

ok('U229h человек развернул сам — машина больше не лезет (его решение старше автосворачивания)',
  /const touched = useRef\(false\)/.test(trace)
    && /if \(touched\.current\) return/.test(trace)
    && /touched\.current = true[\s\S]{0,60}setOpen/.test(trace)
    && /aria-expanded=\{open\}/.test(trace))

/* ── текст идёт плавно, с прозрачностью в начале и в конце ───────────── */

ok('U229i мысли «плывут»: затухание сверху и снизу, а не обрыв линейкой',
  /\.trace-think \{[\s\S]{0,900}mask-image: linear-gradient\([\s\S]{0,240}transparent 0%/.test(css)
    && /\.trace-think \{[\s\S]{0,900}-webkit-mask-image/.test(css)
    && /\.trace-think\.is-live \.trace-think-text/.test(css))

ok('U229j мысли прокручиваются за хвостом, но перестают, если человек отлистал',
  /const stuck = useRef\(true\)/.test(trace)
    && /if \(!el \|\| !live \|\| !stuck\.current\) return/.test(trace)
    && /stuck\.current = el\.scrollHeight - el\.scrollTop - el\.clientHeight < 24/.test(trace))

ok('U229k пока ответ пишется, его низ тоже гаснет — текст доезжает, а не щёлкает краем',
  /\.msg-draft \{[\s\S]{0,400}mask-image: linear-gradient\(180deg, #000 0%/.test(css))

ok('U229l движение уважает «меньше движения»: анимации выключаются настройкой системы',
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,700}\.trace-bar::after/.test(css))

/* ── шаги названы по-русски и по-человечески ─────────────────────────── */

ok('U229m шаги — как в агентских интерфейсах, но по-русски: ищу / открыл / прочитал / рисую / инструмент',
  /Ищу в интернете «\$\{shortQuery\(w\.query\)\}»/.test(trace)
    && /Искал в интернете «\$\{shortQuery\(w\.query\)\}»/.test(trace)
    && /Открываю \$\{hostOf/.test(trace) && /Открыл \$\{hostOf/.test(trace)
    && /'Прочитал' : 'Не прочитал'/.test(trace)
    && /'Рисую'/.test(trace) && /'Нарисовал'/.test(trace) && /'Правлю'/.test(trace)
    && /Инструмент: \$\{ru\}/.test(trace)
    /* Порядок чтения — без «шаг N» и без счётчиков: это список дел, а не отчёт. */
    && !/Шаг \d/.test(bare(trace)))

ok('U229n английских строк прежних блоков не осталось ни в одном состоянии',
  !/Searching the web|Searched for|Fetched |Drawing the image|Thought for|Explored \d|channel \d of/i.test(bare(trace) + bare(view)))

ok('U229o имена каналов картинок наружу не выходят — только «канал не ответил, пробую другой»',
  !/x\.channel/.test(bare(trace))
    && /канал не ответил — пробую другой/.test(trace)
    && !/gemini|odirouter|workersai|pollinations/i.test(bare(trace)))

ok('U229p счётчик шагов склоняется по-русски: 1 шаг / 2 шага / 5 шагов',
  /pluralRu\(count, 'шаг', 'шага', 'шагов'\)/.test(trace)
    /* Склонение одно на всё приложение — из api.ts, а не своё в каждом файле. */
    && /import \{ TOOL_RU, pluralRu,/.test(trace)
    && /if \(d === 1\) return/.test(read('src/lib/api.ts')))

/* ── вёрстка: всё объявлено, всё читается на телефоне ────────────────── */

ok('U229q у каждого класса ленты есть правило в стилях (ничего не «висит» без вида)',
  [
    'trace', 'trace-head', 'trace-orb', 'trace-spin', 'trace-head-label', 'trace-head-meta',
    'trace-chev', 'trace-bar', 'trace-body', 'trace-body-inner', 'trace-steps', 'trace-step',
    'trace-step-summary', 'trace-step-chev', 'trace-step-lead', 'trace-step-body', 'trace-mark', 'trace-step-icon', 'trace-step-label',
    'trace-step-note', 'trace-step-items', 'trace-step-item', 'trace-step-link', 'trace-think',
    'trace-think-text', 'trace-caret', 'trace-code', 'trace-notes',
  ].every((c) => new RegExp('\\.' + c + '[\\s,{:.]').test(css)))

ok('U229r лента не вылезает за узкий экран: строки обрезаются многоточием, длинный адрес не рвёт пузырь',
  /\.trace \{\s*[\s\S]{0,120}max-width: 100%/.test(css)
    /* Название шага — две строки и многоточие, а не обрубок на первом слове. */
    && /\.trace-step-label \{[\s\S]{0,300}-webkit-line-clamp: 2/.test(css)
    && /\.trace-step-note \{[\s\S]{0,160}text-overflow: ellipsis/.test(css)
    && /\.trace-step \{[\s\S]{0,200}min-width: 0/.test(css)
    && /\.trace-think \{[\s\S]{0,400}overflow-wrap: anywhere/.test(css))

ok('U229s стили ленты — переменными темы, без новых единиц экрана и без картинок',
  /\.trace-head \{[\s\S]{0,600}var\(--text\)/.test(css)
    && /\.trace-mark\.is-done \{[\s\S]{0,120}var\(--ok\)/.test(css)
    && !/100dvh/.test(bare(css)) && !/url\(/.test(css.slice(css.indexOf('.trace {'), css.indexOf('.trace {') + 12000)))

{
  /* Разбор стилей настоящим парсером: сломанный CSS браузер молча выбрасывает
     вместе с правилом перед обломком — так уже было в 0.228. */
  const require2 = createRequire(import.meta.url)
  const postcss = require2('postcss')
  let parsed = null
  let err = ''
  try { parsed = postcss.parse(css) } catch (e) { err = String(e && e.message) }
  ok('U229t стили разбираются без обломков', parsed !== null, err)
  ok('U229u ключевые кадры ленты на месте и названы по-своему',
    ['traceOrbPulse', 'traceSpin', 'traceShimmer', 'traceBarRun', 'traceRowIn', 'traceTextIn', 'traceCaret']
      .every((k) => new RegExp('@keyframes ' + k + ' \\{').test(css)))
}

ok('U229w шаги, которые человек видел в работе, остаются в готовом ответе',
  /final\.webSteps = webSteps/.test(read('src/lib/api.ts'))
    && /webSteps=\{Array\.isArray\(m\.webSteps\)/.test(view))

ok('U229x секунды не сбрасываются, когда пошёл ответ (иначе «Думал 1 с» после долгого поиска)',
  /const t = window\.setInterval\(\(\) => setTickSec/.test(trace)
    && !/if \(!live\) return\s*\n\s*const t = window\.setInterval/.test(trace)
    && /Math\.max\(Math\.max\(0, Math\.round\(thinkingSec \|\| 0\)\), tickSec\)/.test(trace))

ok('U229y длинный вопрос не растягивает шаг поиска на простыню, а заголовок-эхо не дублирует адрес',
  /function shortQuery/.test(trace) && /t\.length > 64/.test(trace)
    && /shortQuery\(w\.query\)/.test(trace)
    && /w\.title !== hostOf\(w\.url\)/.test(trace))

ok('U229v проверка подключена к общему прогону', /node test\/ui229\.test\.js/.test(chain))

console.log('\n✔ 0.229: видно, как агент думает — проверки пройдены')
