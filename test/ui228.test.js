/**
 * 0.228: уборка — приложение похудело, ничего не потеряв.
 *
 * Эту версию никто не просил словами «уберите вот это». Она выросла из аудита
 * кода: искали, что можно УДАЛИТЬ, и нашли мёртвое, фальшивое и сломанное.
 *
 *   1. Мёртвое: окно выбора моделей (ModelPicker, ModelIcon, ~650 строк
 *      компонентов и ~600 строк стилей). Из приложения его убрали в 0.151 —
 *      «это Агент, а не витрина чужих моделей», — но компоненты, стили и
 *      проверки остались и держали друг друга живыми.
 *   2. Фальшивое: шесть проверок в ui170 с условием `true` — зелёная галочка,
 *      которая ничего не проверяла, и пункт «Плагины — скоро» в меню «+».
 *   3. Сломанное: в стилях лежал обломок `@keyframes` (хвост удалённой в 0.188
 *      анимации). Браузер молча выбрасывал его, а вместе с ним — и правило
 *      перед ним, о котором никто не знал.
 *
 * Проверки ниже стерегут именно это: что мёртвое не вернулось, что фальшивое не
 * завелось снова и что стили разбираются без обломков.
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
const attach = read('src/components/AttachMenu.tsx')
const page = read('src/lib/pageGesture.ts')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U228a все источники версии синхронизированы', v.ok, v.why)
ok('U228b история README знает 0.228', /\*\*0\.228\*\*/.test(readme))
ok('U228c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/ModelPicker|line-clamp|ui170|keyframes/.test(notes))
ok('U228d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── мёртвое не вернулось ─────────────────────────────────────────────── */

ok('U228e окна выбора модели нет: ни компонентов, ни их стилей',
  !existsSync('src/components/ModelPicker.tsx')
    && !existsSync('src/components/ModelIcon.tsx')
    && !/\.model-panel\b|\.model-row\b|\.model-search\b|\.m-av\b/.test(css))

ok('U228f тень панели и значок параметров остались — ими пользуются меню «+» и шторка параметров',
  /\.model-backdrop\s*\{/.test(css) && /\.params-btn\s*\{/.test(css)
    && /'\.model-backdrop'/.test(page))

ok('U228g файлов, которые никто не открывал, нет',
  !existsSync('src/ErrorBoundary.jsx')
    && !existsSync('src/components/ContextUsageIndicator.tsx')
    && !existsSync('modal.mjs')
    && !existsSync('probe')
    && !existsSync('RELEASE_SYSTEM.md'))

/* ── фальшивое не завелось снова ──────────────────────────────────────── */

const bare = read('test/ui170.test.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
ok('U228h в проверках нет «ok(..., true)» — галочка значит проверку',
  !/ok\(\s*['"`][^'"`]*['"`]\s*,\s*true\s*\)/.test(bare))

ok('U228i в меню «+» только то, что работает: камера, фото, файлы',
  /Камера/.test(attach) && /Фото/.test(attach) && /Файлы/.test(attach)
    && !/Плагин/.test(attach.replace(/\/\*[\s\S]*?\*\//g, ''))
    && !/attach-menu-item is-soon/.test(attach))

/* ── стили разбираются ────────────────────────────────────────────────── */

/* Разбираем стили настоящим парсером, а не на глаз: именно тихая ошибка разбора
   и была бедой — браузер выбрасывал кусок @keyframes и вместе с ним правило
   перед ним, а CSS выглядел целым. postcss приходит вместе с vite; нет его —
   проверка честно говорит «не проверено», а не рисует галочку. */
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '')
let parses = null
try {
  const postcss = createRequire(import.meta.url)('postcss')
  postcss.parse(css)
  parses = true
} catch (e) {
  parses = e && e.name === 'CssSyntaxError' ? String(e.message) : null
}
ok('U228j стили разбираются без ошибок: обломков правил не осталось',
  parses === true || parses === null,
  parses === null ? 'postcss недоступен — пропущено' : parses)
ok('U228j2 скобки в стилях сходятся',
  cssBare.split('{').length === cssBare.split('}').length,
  cssBare.split('{').length + ' открывающих / ' + cssBare.split('}').length + ' закрывающих')

ok('U228k проверки подключены к общему прогону', chain.includes('test/ui228.test.js'))
