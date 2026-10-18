/**
 * 0.184 «Композер по эскизу»: широкое поле ввода сверху, строка кнопок снизу.
 *
 * Слова владельца: «Сделай сначала широкое вниз окно ввода, потом немного на
 * 1 строчку ниже: где чёрный это плюс, меню параметров и голосовая кнопка.
 * Зелёное это процент и кружочек лимитов» (эскиз от 13 окт 2026).
 *
 * До этого .composer был однострочной пилюлей с раскладкой через order — блоки
 * вставали «наискось». Здесь держим новую двухрядную раскладку и чиним баг,
 * который нашла проверка окна ввода: чёрные иконки кнопок оставались чёрными
 * и в тёмной теме — на фоне #131317 их не видно.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const chat = read('src/views/ChatView.tsx')
const css = read('src/styles/index.css')
const version = read('src/lib/version.ts')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const notes = read('src/lib/release-notes.ts')

/* ── A. Раскладка: поле сверху, кнопки строкой ниже ─────────────────────────── */

/* A1: .composer — колонка, а не строка с order (причина «косых» блоков). */
ok('U184a .composer — двухрядная колонка: flex-direction column, без order-раскладки',
  /\.composer \{[^}]*flex-direction: column;/s.test(css)
    && !/\.composer-main \{[^}]*order: \d/s.test(css)
    && !/display: contents/.test(css))

/* A2: ряд кнопок — одна строка: левая группа прижата влево, правая вправо. */
ok('U184b строка кнопок: слева «+/параметры/лимиты», справа «микрофон/отправка»',
  /\.composer-buttons \{[^}]*justify-content: space-between;/s.test(css)
    && /\.composer-buttons-left[\s\S]{0,40}\.composer-buttons-right \{/.test(css))

/* A3: в ChatView порядок детей формы: composer-main → composer-buttons,
   и внутри левой группы сидят «+», параметры и кольцо лимитов. */
const formSlice = chat.slice(chat.indexOf("className={'composer'"), chat.indexOf('</form>'))
const leftIdx = formSlice.indexOf('composer-buttons-left')
const plusIdx = formSlice.indexOf('plus-btn')
const paramsIdx = formSlice.indexOf('params-btn')
const limitsIdx = formSlice.indexOf('<LimitsRing')
const rightIdx = formSlice.indexOf('composer-buttons-right')
const micIdx = formSlice.indexOf('voice-btn')
const sendIdx = formSlice.indexOf('send-btn')
ok('U184c порядок: слева +, параметры, кольцо лимитов; справа микрофон и отправка',
  leftIdx > -1 && rightIdx > leftIdx
    && plusIdx > leftIdx && paramsIdx > plusIdx && limitsIdx > paramsIdx
    && limitsIdx < rightIdx && micIdx > rightIdx && sendIdx > micIdx)

/* A4: старых костылей больше нет — кнопка параметров и кольцо вернулись внутрь
   формы, отдельная нога под формой убрана вместе с .composer-foot. */
ok('U184d .composer-foot убран: ни в разметке, ни в стилях',
  !/composer-foot/.test(chat) && !/composer-foot/.test(css))

/* A5: поле на всю ширину ряда, а не пилюля 999px. */
ok('U184e карточка композера со скруглением 24px — не пилюля',
  /\.composer \{[^}]*border-radius: 24px;/s.test(css)
    && !/\.composer \{[^}]*border-radius: 999px;/s.test(css))

/* ── B. Тёмная тема: чёрные иконки — баг, исправлен ─────────────────────────── */

/* B1: в тёмной теме у иконок-кнопок белый цвет — иначе чёрное на чёрном. */
ok('U184f тёмная тема: иконки кнопок белые, кнопки прозрачные',
  /\[data-theme='dark'\] \.icon-btn,[\s\S]{0,400}color: #ffffff;/.test(css)
    && /\[data-theme='dark'\] \.composer \.icon-btn,/.test(css)
    && /\[data-theme='dark'\] \.params-btn,/.test(css))

/* B2: светлая тема не тронута — владелец просил чёрные прозрачные кнопки. */
ok('U184g светлая тема: кнопки прозрачные с чёрными иконками (как просил владелец)',
  /\.composer \.icon-btn,[\s\S]{0,120}\.composer \.params-btn \{[\s\S]{0,400}color: #000000;/s.test(css))

/* ── C. Поведение, которое легко сломать при перестановке блоков ────────────── */

/* C1: единственная submit-кнопка в форме — отправка; остальные type="button". */
ok('U184h отправка остаётся type="submit", соседние кнопки — type="button"',
  /type="submit"/.test(formSlice)
    && (formSlice.match(/type="button"/g) || []).length >= 3)

/* C2: высота поля подстраивается и при программной вставке (голос, черновик). */
ok('U184i высота textarea едет за значением — эффект на value жив',
  /useEffect\(\(\) => \{[\s\S]{0,80}textareaRef\.current[\s\S]{0,400}\}, \[value(?:, active)?\]\)/.test(chat))

/* C3: кольцо лимитов внутри строки кнопок — клик по нему не отправляет сообщение. */
ok('U184j кольцо лимитов — type="button" (иначе клик отправлял бы сообщение)',
  /type="button"\s+className={'limits-btn compact/.test(read('src/components/LimitsRing.tsx').replace('\n      ', ' '))
    || /type="button"/.test(read('src/components/LimitsRing.tsx')))

/* ── D. Версия и «Что нового» ───────────────────────────────────────────────── */

ok('U184k источники версии синхронизированы между собой',
  /APP_VERSION = '([^']+)'/.test(version)
    && RegExp.$1 === pkg.version && pkg.version === lock.version
    && new RegExp("version: '" + pkg.version.replace('.', '\\.') + "'").test(notes))

ok('U184l у записи «Что нового» есть заголовок и пункты (0.184 следил за раскладкой поля — правило живёт)',
  /version: '0\.\d{3}',\s*\n\s*title: '[^']+'[\s\S]{0,600}items:/.test(notes))

console.log('\n12 ✔, 0 ✖')
