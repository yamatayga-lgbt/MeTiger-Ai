/**
 * 0.217: заголовок шапки без капсулы, крупнее, до круглых кнопок.
 *
 * Владелец прислал два снимка: «Профиль» в серой пилюле и «Персонализация»
 * обрезанная, хотя по бокам пусто. Просил убрать фон заголовка, увеличить
 * шрифт и растянуть подпись до круглых кнопок «назад» и папки.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const css = read('src/styles/index.css')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()
const pill = (css.match(/\.topbar-pill \{[\s\S]*?\n\}/) || [''])[0]
const topbar = (css.match(/\.topbar \{[\s\S]*?\n\}/) || [''])[0]

ok('U217a все источники версии синхронизированы', v.ok, v.why)
ok('U217b история README знает 0.217',
  /\*\*0\.217\*\*/.test(readme))
ok('U217c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/topbar-pill|topbar-side/.test(notes))
ok('U217d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U217e заголовок шапки без фона и без рамки-капсулы',
  /background: transparent/.test(pill) && /border: none/.test(pill)
    && !/background: var\(--surface-2\)/.test(pill)
    && !/border: 1px solid/.test(pill), pill.slice(0, 220))
ok('U217f шрифт заголовка крупнее 14 px',
  /font-size: 18px/.test(pill), pill)
ok('U217g заголовок на всю ширину между круглыми кнопками',
  /justify-self: stretch/.test(pill) && /width: 100%/.test(pill)
    && /--topbar-side: 44px/.test(topbar)
    && /grid-template-columns: var\(--topbar-side\) 1fr var\(--topbar-side\)/.test(topbar)
    && !/--topbar-side: 118px/.test(css) && !/--topbar-side: 92px/.test(css))
ok('U217h круглая кнопка шапки свой фон не потеряла',
  /\.icon-btn\.topbar-round,[\s\S]{0,80}\.side-item\.active \{[\s\S]{0,120}background-color: var\(--surface-2\)/.test(css))
ok('U217i проверка подключена к общему прогону', /test\/ui217\.test\.js/.test(chain))

console.log('\n✔ 0.217: заголовок шапки без капсулы — проверки пройдены')
