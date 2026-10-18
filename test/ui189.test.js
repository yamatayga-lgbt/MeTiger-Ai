/**
 * 0.189: панель админа проще, проценты честные, черновик не теряется.
 *
 * Всё началось с вопросов и просьб владельца: «Пункт устройств уберём», «панель
 * Разработчика была только у меня», «на окне ввода 100%, а в Использовании —
 * 99,8%», «записи сделать проще, и последний черновик только», «при каждом
 * обновлении настройки, профиль, чаты и т.д. должны сохраняться».
 *
 * Проверки держат ровно это: админ-панель без списка устройств и под замком,
 * одна и та же цифра запаса в шапке и на экране, одна запись в «Что нового»
 * (история — в README), один последний черновик поля ввода и страховка чатов
 * при переполнении хранилища.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const ring = read('src/components/LimitsRing.tsx')
const admin = read('src/views/AdminView.tsx')
const sidebar = read('src/components/Sidebar.tsx')
const chat = read('src/views/ChatView.tsx')
const persist = read('src/lib/persist.ts')
const app = read('src/App.tsx')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const version = read('src/lib/version.ts')
const pkg = JSON.parse(read('package.json'))
const chain = String(pkg.scripts.test || '')

/* ── R. Проценты ─────────────────────────────────────────────────────────── */
ok('R1 кольцо в шапке показывает тот же процент, что и экран: fmtPct с десятыми, никакого округления до целых',
  />\{fmtPct\(pct\)\}<\/span>/.test(ring) && !/Math\.round\(pct\)/.test(ring))

/* ── A. Админ-панель ─────────────────────────────────────────────────────── */
ok('R2 списка устройств в панели больше нет: остались только обращения',
  !/Устройства/.test(admin) && !/device\?owner=1/.test(admin)
    && !/DeviceRow/.test(admin) && !/Segmented/.test(admin)
    && /<ReportsView notify={notify} embedded \/>/.test(admin))

ok('R3 панель видит только владелец: пункт в разделах — по коду, сервер сверяет хэш',
  /owner \? \[\.\.\.SECTIONS, OWNER_SECTION\] : SECTIONS/.test(sidebar)
    && /REPORT_OWNER_HASH/.test(read('functions/api/report.js'))
    && /ownerOk\(request, env\)/.test(read('functions/api/device.js'))
    && /видна только владельцу/.test(admin))

/* ── N. Записи «Что нового» ──────────────────────────────────────────────── */
const appVer = (version.match(/APP_VERSION = '([^']+)'/) || [])[1] || ''
const noteVers = [...notes.matchAll(/version: '([^']+)'/g)].map((m) => m[1])
ok('R4 в «Что нового» ровно одна запись — текущей версии; полная история — в README',
  noteVers.length === 1 && noteVers[0] === appVer && /\*\*0\.188\*\*/.test(readme),
  'записей ' + noteVers.length + ', версия ' + appVer)

ok('R5 запись написана проще: без имён файлов и внутреннего жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/localStorage|fmtPct|VOICE_/.test(notes))

/* ── D. Черновик ─────────────────────────────────────────────────────────── */
ok('R6 последний черновик поля ввода живёт в mt-draft: подставляется при каждом открытии чата, пишется с набором, уходит с отправкой',
  /const DRAFT_KEY = 'mt-draft'/.test(chat)
    && /localStorage\.getItem\(DRAFT_KEY\)/.test(chat)
    && !/draftOnce/.test(chat)
    && /localStorage\.setItem\(DRAFT_KEY, value\.slice\(0, DRAFT_MAX\)\)/.test(chat)
    && /else localStorage\.removeItem\(DRAFT_KEY\)/.test(chat))

ok('R7 при переключении чата черновик прошлого не затирается: первая отрисовка не пишет, уход — сохраняет',
  /const draftSkip = useRef\(true\)/.test(chat)
    && /draftSkip\.current = false/.test(chat)
    && /valueRef\.current/.test(chat)
    && /localStorage\.setItem\(DRAFT_KEY, v\.slice\(0, DRAFT_MAX\)\)/.test(chat))

/* ── S. Сохранение при обновлении ────────────────────────────────────────── */
ok('R8 чаты застрахованы от переполнения: не влезло — повтор со свежими двадцатью, медиа по-прежнему в IndexedDB',
  /страховка 0\.189/.test(persist)
    && /\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)/.test(persist)
    && /\.slice\(0, 20\)/.test(persist)
    && /map\(stripMediaForStorage\)/.test(persist))

ok('R9 старые ключи мёртвых настроек стираются при старте: mt-talk и старый отпечаток устройства',
  /export function sweepDeadKeys/.test(persist)
    && /\['mt-talk', 'mt-dev-fp'\]/.test(persist)
    && /sweepDeadKeys\(\)/.test(app))

/* ── Цепочка ─────────────────────────────────────────────────────────────── */
ok('R10 новый тест подключён к цепочке прогона', /node test\/ui189\.test\.js/.test(chain))

console.log('\n' + '✔ 0.189: админка проще, проценты честные, черновик не теряется — проверки пройдены')
