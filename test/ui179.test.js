/**
 * 0.179: кольцо общего запаса агента — кнопка «Просмотреть лимиты» в шапке.
 *
 * Просьба владельца дословно: «Хочу сделать удобную кнопку как „Просмотреть
 * лимиты“ рядом с иконкой Воркспейса, будет иконка похожая на лимиты… если всего
 * 5к в день запросов, то это 100 %, если 2,5к — понятно, что уже 50 %… с 100 %
 * зелёный, потом немного прижелтевшее, на 50 % жёлтое, потом немного до красного,
 * и 0 % красный мигает». На уточняющий вопрос он выбрал: «только кольцо в шапке»
 * (полоски под полем ввода нет) и «только проценты до сотых: 100.0 %, 91,2 %».
 *
 * Здесь держим именно эти обещания и места, где они ломаются молча:
 *   · счёт запаса — серверный (`poolOf`), фронт своего процента не считает;
 *   · процент с десятыми и русской запятой, а не целым числом;
 *   · цвет уходит от зелёного через жёлтый к красному ровно по запасу;
 *   · мигание ровно при нуле, и его снимает «меньше движения»;
 *   · кольцо не висит в поле ввода (второй вариант владельца отклонён) и не
 *     опрашивает сервер чаще минуты;
 *   · нажатие ведёт на «Использование и лимиты», а не в никуда.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const topbar = read('src/components/Topbar.tsx')
const app = read('src/App.tsx')
const view = read('src/views/UsageView.tsx')
const ring = read('src/components/LimitsRing.tsx')
const lib = read('src/lib/limits.ts')
const css = read('src/styles/index.css')
const door = read('functions/api/usage.js')
const engine = read('engine/usage.js')
const sw = read('public/sw.js')
const chain = String(pkg.scripts.test || '')

/* Комментарии вон: в пояснениях стоят те же имена, и проверки «этого нет» ловили
   бы текст, а не код (тот же приём, что в U176/U177). */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ── Числа: настоящий импорт src/lib/limits.ts, а не пересказ ──────────────── */
const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.log('✖ лимиты: esbuild не найден (' + bin + ') — проверки НЕ выполнены. Нужно `npm install`.')
  process.exit(1)
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-limits')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const out = join(dir, 'limits.mjs')
execFileSync(bin, ['src/lib/limits.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' })
const { fmtPct, ringHue, ringColor, isExhausted, poolLine, poolNote, requestsWord, RING_SAT, RING_LIGHT, RING_LIGHT_DARK } = await import(out)

const v = versionsAligned()
ok('U179a все источники версии синхронизированы', v.ok, v.why)
ok('U179b «Что нового» и README знают 0.179',
  /version: '0\.179'/.test(notes) && /\*\*0\.179\*\*/.test(readme))
ok('U179c запись говорит человеку про запас, а не про внутренности',
  /запас|лимит/i.test(notes) && !/poolOf|env\.AI|эндпоинт/.test(notes)
    && sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── Запас: счёт, процент, цвет, мигание ──────────────────────────────────── */
ok('U179d процент с десятыми и русской запятой — «98,9 %», а не «99 %»',
  fmtPct(98.8686) === '98,9\u00a0%' && fmtPct(100) === '100,0\u00a0%' && fmtPct(91.24) === '91,2\u00a0%'
    && /toFixed\(1\)/.test(lib) && /replace\('\.', ','\)/.test(lib),
  fmtPct(98.8686) + ' / ' + fmtPct(91.24))

ok('U179e границы: ниже нуля и выше ста не бывает, «нет данных» — не ноль',
  fmtPct(-5) === '0,0\u00a0%' && fmtPct(140) === '100,0\u00a0%' && fmtPct(null) === '—')

ok('U179f цвет: 100 % зелёный, 50 % жёлтый, 0 % красный',
  Math.round(ringHue(100)) === 120 && Math.round(ringHue(50)) === 60 && Math.round(ringHue(0)) === 0
    && ringColor(100).startsWith('hsl(120') && ringColor(0).startsWith('hsl(0'),
  [ringHue(100), ringHue(50), ringHue(0)].join('/'))

ok('U179g «чуть прижелтевшее» приходит само: цвет уезжает вместе с запасом, без ступенек',
  ringHue(90) > 100 && ringHue(90) < 120 && ringHue(25) > 0 && ringHue(25) < 60
    && ringHue(80) - ringHue(79) < 2,
  [ringHue(90), ringHue(25)].join('/'))

ok('U179h мигание — ровно при нуле, а не при «почти кончилось»',
  isExhausted(0) === true && isExhausted(0.04) === true
    && isExhausted(0.5) === false && isExhausted(20) === false && isExhausted(null) === false)

/* Разряды в ru-RU разделены неразрывным пробелом: сравниваем, приведя все
   пробелы к обычному, — иначе проверка падала бы на форме записи, а не на смысле. */
const flat = (t) => String(t).replace(/[\u00a0\u202f\s]+/g, ' ')
ok('U179i строка под кольцом говорит словами и склоняет запросы',
  flat(poolLine({ live: 12, capacity: 9900, used: 112, remaining: 9788, pct: 98.87 })) === 'осталось 9 788 запросов из 9 900'
    && requestsWord(1) === 'запрос' && requestsWord(2) === 'запроса' && requestsWord(5) === 'запросов'
    && requestsWord(11) === 'запросов' && requestsWord(21) === 'запрос',
  poolLine({ live: 12, capacity: 9900, used: 112, remaining: 9788, pct: 98.87 }))

ok('U179j пустой запас назван словами, а не «0 % без объяснений»',
  /кончился/.test(poolNote({ live: 3, capacity: 100, used: 100, remaining: 0, pct: 0 }))
    && /в порядке/.test(poolNote({ live: 3, capacity: 100, used: 1, remaining: 99, pct: 99 }))
    && /не отвечают/.test(poolNote(null)))

/* ── Сервер: запас считает движок, дверь отдаёт готовым ───────────────────── */
ok('U179k запас считает движок — одна правда на шапку и на панель',
  /export function poolOf/.test(engine) && /poolOf\(rows\)/.test(door)
    && /pool,/.test(door) && !/reduce\(.*dayLimit/.test(bare(view)))

/* ── Шапка: кольцо на месте, поле ввода не тронуто ────────────────────────── */
ok('U179l кольцо стоит в шапке рядом с Workspace, а не вместо него',
  /<LimitsRing onOpen=\{onOpenLimits\} \/>/.test(topbar)
    && /icon=\{Folder\}/.test(topbar)
    && topbar.indexOf('LimitsRing') < topbar.indexOf('icon={Folder}'),
  'порядок в разметке')

ok('U179m нажатие ведёт на «Использование и лимиты», а не в никуда',
  /onOpenLimits=\{\(\) => navigate\('usage'\)\}/.test(app)
    && /onOpenLimits\?: \(\) => void/.test(topbar)
    && /haptic\('light'\)/.test(bare(ring)))

ok('U179n кольцо не лезет в поле ввода: второй вариант владельца отклонён',
  !/LimitsRing|limits-btn|limits-pct|usage-pool/.test(bare(read('src/views/ChatView.tsx')))
    && /\.limits-pct \{/.test(css) && /limits-pct/.test(ring))

ok('U179o опрос редкий: раз в минуту, а чаще — только когда человек сам открыл панель',
  /RING_EVERY_MS = 60000/.test(ring) && /useUsageLive\(true, RING_EVERY_MS\)/.test(ring)
    && /useUsageLive\(true, EVERY_MS\)/.test(view) && /EVERY_MS = 5000/.test(view))

ok('U179p кольцо не рисуется без чисел: пустая полоска врала бы про кончившийся запас',
  /if \(pct == null\) return null/.test(ring)
    && /data && data\.pool/.test(bare(view)))

/* ── Вид: цвет и мигание живут в стилях, а не в подписи ───────────────────── */
ok('U179q цвет кольца — от запаса, и он один для светлой и тёмной темы',
  /* Оттенок уезжает в CSS переменной, светлота — в правилах тем. Числа в стилях
     и в коде обязаны совпадать: иначе кольцо в шапке и подпись на панели
     разъедутся цветом при смене темы, и заметит это только глаз. */
  /* Куском текста, а не регуляркой: скобки JSX в регулярке проверяли бы
     собственную экранировку, а не код (уже один раз на этом споткнулись). */
  ring.includes("style={{ '--ring-h': String(Math.round(ringHue(pct) * 10) / 10) } as CSSProperties}")
    && /hsl\(var\(--ring-h, 120\) 62% 42%\)/.test(css)
    && /\[data-theme='dark'\] \.limits-btn \{\s*color: hsl\(var\(--ring-h, 120\) 62% 58%\)/.test(css)
    && RING_SAT === 62 && RING_LIGHT === 42 && RING_LIGHT_DARK === 58
    /* Формулу в коде сверяем по куску, а не регуляркой: регулярка здесь проверяла
       бы собственную экранировку, а не формулу. */
    && lib.includes('`hsl(${ringHue(pct).toFixed(1)} ${RING_SAT}% ${light}%)`')
    && ringColor(0, 'dark').includes('62% 58%') && ringColor(0).includes('62% 42%'),
  ringColor(0) + ' / ' + ringColor(0, 'dark'))

ok('U179r мигание при нуле есть, и «меньше движения» его снимает',
  /\.limits-btn\.is-empty \{/.test(css) && /limits-blink/.test(css)
    && /prefers-reduced-motion: reduce/.test(css)
    && /is-empty/.test(css) && /steps\(1, end\)/.test(css))

ok('U179s капсула с названием чата осталась посередине: боковые колонки шапки равны',
  /--topbar-side: 118px/.test(css)
    && /grid-template-columns: var\(--topbar-side\) 1fr var\(--topbar-side\)/.test(css)
    && /--topbar-side: 92px/.test(css),
  'на узких экранах колонки сжимаются вместе с подписью')

ok('U179t панель «Использование и лимиты» показывает ту же цифру первой',
  /usage-pool/.test(view) && /Общий запас агента: \{fmtPct\(data\.pool\.pct\)\}/.test(view)
    && /\.usage-pool \{/.test(css) && /LimitsRingGlyph/.test(view)
    && /\[data-theme='dark'\] \.usage-pool-ring/.test(css))

ok('U179u проверка подключена к общему прогону — иначе она бы «прошла» сама по себе',
  /test\/ui179\.test\.js/.test(chain) && /test\/usage\.test\.js/.test(chain))

ok('U179v цвет кольца виден и в тёмной теме: дорожка не исчезает',
  /strokeOpacity=\{0\.18\}/.test(ring) && /\.limits-btn:hover/.test(css))

console.log('\n✔ 0.179: запас агента виден в шапке — проверки пройдены')
