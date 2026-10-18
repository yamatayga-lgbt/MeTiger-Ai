/**
 * 0.219: в приложении интерфейс не проигрывается заново; заставка — иконка.
 *
 * Владелец проверяет не в браузере, а с иконки на экране: экраны «прогружались»,
 * как будто их показывают сначала. Плюс идея — улучшить стартовую заставку
 * иконки. Без стекла и без зацикленного декора.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const css = read('src/styles/index.css')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const html = read('index.html')
const app = read('src/App.tsx')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U219a все источники версии синхронизированы', v.ok, v.why)
ok('U219b «Что нового» и README знают 0.219',
  /\*\*0\.219\*\*/.test(readme) && /version: '0\.219'/.test(notes))
ok('U219c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/screen-wrap|screenFadeIn|hidden=|apple-touch/.test(notes))
ok('U219d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U219e экраны не въезжают заново при каждом открытии',
  !/animation: screenFadeIn/.test(css)
    && !/@keyframes screenFadeIn/.test(css)
    && /\.screen-wrap\[hidden\] \{[\s\S]{0,80}display: none !important/.test(css))

ok('U219f чат при уходе в профиль остаётся смонтированным и только прячется',
  /hidden=\{view !== 'chat'\}/.test(app)
    && /ChatView/.test(app)
    && !/\{view === 'chat' \? \(/.test(app))

ok('U219g стартовая заставка в оболочке — иконка тигра, без пустого #root',
  /id="boot"/.test(html)
    && /icons\/icon-192\.png/.test(html)
    && /<div id="root">[\s\S]{0,200}id="boot"/.test(html)
    && /#boot \{/.test(html)
    && /background: #0A0A0C/.test(html))

ok('U219h у iOS есть заставка с иконкой, а не крошечный значок на пустом кадре',
  /rel="apple-touch-startup-image"/.test(html)
    && (html.match(/apple-touch-startup-image/g) || []).length >= 6
    && existsSync('public/icons/splash-1170x2532.png')
    && existsSync('public/icons/splash-1290x2796.png')
    && existsSync('public/icons/splash-1179x2556.png'))

ok('U219i история и пузыри пользователя больше не каскадом въезжают при каждом показе',
  !/\.history-group \.chat-item \{ animation: itemIn/.test(css)
    && !/\.msg-user \.bubble \{ animation: bubbleIn/.test(css)
    && /\.msg-ai\.msg-arrive \{[^}]*animation: msgArrive 150ms/.test(css))

ok('U219j проверка подключена к общему прогону', /test\/ui219\.test\.js/.test(chain))

console.log('\n✔ 0.219: приложение не проигрывается заново — проверки пройдены')
