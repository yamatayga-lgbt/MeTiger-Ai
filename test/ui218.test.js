/**
 * 0.218: поле ввода откликается, черновик не теряется, свайп назад.
 *
 * Владелец с телефона: четыре микро-взаимодействия сразу, плюс «черновик не
 * теряется» (уход в профиль опустошал поле) и свайп назад на вложенных экранах.
 * Без стекла и без зацикленного декора.
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
const swipe = read('src/hooks/useSwipeBack.ts')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U218a все источники версии синхронизированы', v.ok, v.why)
ok('U218b «Что нового» и README знают 0.218',
  /\*\*0\.218\*\*/.test(readme) && /version: '0\.218'/.test(notes))
ok('U218c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/draftOnce|BACK_TO|msg-arrive|localStorage/.test(notes))
ok('U218d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U218e кнопка отправки: серая пустая, с текстом чуть крупнее, нажатие сжимает, без мигания',
  /\.composer \.send-btn:not\(:disabled\) \{[\s\S]{0,80}transform: scale\(1\.08\)/.test(css)
    && /\.composer \.send-btn:not\(:disabled\):active \{[\s\S]{0,80}transform: scale\(0\.92\)/.test(css)
    && /\.composer \.send-btn:disabled \{[\s\S]{0,120}background: var\(--surface-2\)/.test(css)
    && !/@keyframes send/.test(css))

ok('U218f поле в фокусе чуть выше и с более яркой рамкой',
  /\.composer:focus-within \{[\s\S]{0,200}border-color: var\(--accent-border\)/.test(css)
    && /\.composer:focus-within \{[\s\S]{0,200}transform: translateY\(-3px\)/.test(css))

ok('U218g первая строка ответа — один подъём 150 мс, не на всю переписку и не на каждый кусок',
  /\.msg-ai\.msg-arrive \{[^}]*animation: msgArrive 150ms/.test(css)
    && /className="msg msg-ai msg-arrive"/.test(chat)
    && !/\.msg \{[^}]*animation: msgIn/.test(css)
    && (chat.match(/className="msg msg-ai"/g) || []).length >= 1)

ok('U218h меню «+» раскрывается от кнопки, а не сбоку',
  /\.attach-menu \{[\s\S]{0,500}transform-origin: 28px 100%/.test(css)
    && /animation: attachFromPlus/.test(css)
    && /@keyframes attachFromPlus/.test(css)
    && !/\.attach-menu \{[\s\S]{0,400}animation: pickerPop/.test(css))

ok('U218i черновик подставляется при каждом открытии чата, а не один раз за жизнь вкладки',
  /localStorage\.getItem\(DRAFT_KEY\)/.test(chat)
    && !/draftOnce/.test(chat)
    && /const draftSkip = useRef\(true\)/.test(chat))

ok('U218j свайп назад на вложенных экранах идёт тем же путём, что стрелка',
  /useSwipeBack/.test(app)
    && /Boolean\(BACK_TO\[view\]\)/.test(app)
    && /const EDGE = 32/.test(swipe)
    && /const THRESHOLD = 64/.test(swipe)
    && /touchedOverlay/.test(swipe)
    && /pageGestureLocked/.test(swipe)
    && /clientX > EDGE/.test(swipe))

ok('U218k уменьшенное движение выключает подъём поля, сжатие кнопки, въезд меню и появление ответа',
  /prefers-reduced-motion: reduce/.test(css)
    && /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,600}\.composer:focus-within,/.test(css)
    && /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,800}transform: none !important/.test(css)
    && /\.attach-menu \{ animation: none !important/.test(css)
    && /\.msg-ai\.msg-arrive/.test(css))

ok('U218l проверка подключена к общему прогону', /test\/ui218\.test\.js/.test(chain))

console.log('\n✔ 0.218: поле ввода откликается — проверки пройдены')
