/**
 * 0.200: интерфейс на телефоне — то, что мешало пользоваться.
 *
 * Три находки живого прогона 17.10.2026 (Chromium, 390×844, касания):
 *
 *   1. Лента замирала. «Был ли я внизу» считалось ПОСЛЕ того, как сообщение уже
 *      раздуло ленту, — после первого же длинного ответа условие становилось
 *      ложным навсегда, и новые реплики с потоком ответа оставались под сгибом.
 *      Хуже: ответ печатается из отдельного состояния (draft), поэтому даже
 *      «липкий» эффект на числе сообщений не ловил роста.
 *
 *   2. Карточка «Персонализации» ломалась от залипшего :hover. Заливка наведения
 *      внутри .persona-card была прямоугольной, а карточка — со скруглением:
 *      после касания над ней висел серый прямоугольник с прямыми углами.
 *
 *   3. Поле палитры команд при открытии получало фокус, и кольцо :focus-visible
 *      ложилось на рамку строки вторым прямоугольником — на телефоне это
 *      читалось как чужой чёрный бордюр вокруг поля.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const view = readFileSync('src/views/ChatView.tsx', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const info = readFileSync('src/views/InfoView.tsx', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const chain = String(pkg.scripts.test || '')

/* ── S. Лента: липнет ко дну, пока человек сам не отлистал ──────────────── */

ok('S1 автоскролл помнит «внизу» по событию прокрутки, а не по замеру после роста',
  /stickToBottomRef/.test(view) && /addEventListener\('scroll'/.test(view))

ok('S2 растёт лента — листаем по факту изменения содержимого (MutationObserver)',
  /new MutationObserver\(follow\)/.test(view)
    && /childList: true, subtree: true, characterData: true/.test(view))

ok('S3 свою прокрутку не считаем за «человек отлистал» — окно блокировки',
  /let lock = 0/.test(view) && /Date\.now\(\) < lock/.test(view))

ok('S4 своя отправка всегда возвращает к низу',
  /stickToBottomRef\.current = true\s*\n\s*haptic\('medium'\)/.test(view))

ok('S5 старого замера «после роста» больше нет',
  !/isAtBottom/.test(view) && !/scrollHeight - \(scrollTop \+ clientHeight\) < 100/.test(view))

/* ── T. Персонализация: скругления и наведение только с мышью ───────────── */

ok('T1 углы строк идут за углами карточки',
  /\.persona-card \.persona-select:first-child \.persona-row/.test(css)
    && /\.persona-card \.persona-select:last-child \.persona-row/.test(css))

ok('T2 наведение — только там, где есть мышь (на телефоне :hover залипает)',
  /@media \(hover: hover\) \{\s*\n\s*\.persona-row:hover \{/.test(css))

ok('T3 открытое меню по-прежнему подсвечено — уже без :hover',
  /\.persona-row\.is-open \{\s*\n\s*background: var\(--surface-hover\)/.test(css))

/* ── U. Палитра команд на телефоне ──────────────────────────────────────── */

ok('U1 у поля палитры нет кольца фокуса — второго прямоугольника больше нет',
  /\.palette-input-row input:focus,\s*\n\.palette-input-row input:focus-visible \{\s*\n\s*outline: none/.test(css))

ok('U2 подсказки про клавиши скрыты там, где нет мыши',
  /@media \(hover: none\) and \(pointer: coarse\) \{\s*\n\s*\.palette-foot \{\s*\n\s*display: none/.test(css))

/* ── V. «Информация»: дверь в панель ведёт в панель ─────────────────────── */

ok('V1 владелец на устройстве видит живую строку «Панель управления»',
  /ownerSeen/.test(info) && /onNavigate\('admin'\)/.test(info))

ok('V2 остальным — «Скоро»: чужому человеку вход не обещаем',
  /Badge tone="blue">Скоро<\/Badge>/.test(info))

ok('V3 новому тесту место в общей цепочке прогона',
  /test\/ui200\.test\.js/.test(chain))
