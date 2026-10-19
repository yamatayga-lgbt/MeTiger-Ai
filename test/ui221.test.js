/**
 * 0.221: поле ввода не схлопывается, фон чата до краёв, меню без чёрного слоя.
 *
 * Снимок владельца: «Новый чат», от поля ввода осталась тонкая кромка над
 * кнопками, плейсхолдера нет. После 0.219 чат прячется через display:none —
 * тогда scrollHeight поля = 0, и высота залипает. Плюс чёрные поля по бокам
 * и второй чёрный слой, когда открывают имя чата.
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
const chat = read('src/views/ChatView.tsx')
const app = read('src/App.tsx')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U221a все источники версии синхронизированы', v.ok, v.why)
ok('U221b история README знает 0.221',
  /\*\*0\.221\*\*/.test(readme))
ok('U221c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/scrollHeight|display:none|menu-catcher/.test(notes))
ok('U221d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U221e поле ввода не может сжаться ниже строки',
  /\.composer textarea \{[\s\S]{0,220}min-height: 44px/.test(css)
    && /\.composer-main \{[\s\S]{0,160}min-height: 52px/.test(css))

ok('U221f высота поля не ставится в ноль и пересчитывается, когда чат снова виден',
  /if \(h < 8\) return/.test(chat)
    && /active = true/.test(chat)
    && /active=\{view === 'chat'\}/.test(app)
    && /\[value, active\]/.test(chat))

ok('U221g спрятанный чат не оставляет чёрный слой',
  /\.screen-wrap\.is-away/.test(css)
    && /display: none !important/.test(css)
    && /screen-wrap\$\{view === 'chat' \? '' : ' is-away'\}/.test(app))

ok('U221h меню имени чата без чёрной заливки на весь экран',
  /\.menu-catcher \{[\s\S]{0,220}background: transparent/.test(css))

ok('U221i проверка подключена к общему прогону', /test\/ui221\.test\.js/.test(chain))

console.log('\n✔ 0.221: поле ввода не схлопывается — проверки пройдены')
