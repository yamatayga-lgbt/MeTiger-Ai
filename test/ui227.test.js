/**
 * 0.227: настройки читаются с узкого экрана.
 *
 * Аудит живой версии 21.10.2026 глазами телефона (390×844, 360×800 и 320×640,
 * светлая и тёмная тема). Что нашлось и что проверяем здесь словами человека:
 *
 *   • в профиле на 320 px «Уведомления» сжимались до многоточия, а рядом стояло
 *     «запрещены в браузере» — название исчезало, объяснение занимало строку;
 *   • в «Информации» «Версия» ужималась до 18 px (и один раз сложилась в
 *     столбик по букве), хвост «моделей доступно: 84» вылезал за карточку;
 *   • в «Персонализации» подпись «Род агента» выдавливалась переключателем в
 *     столбик по два слова;
 *   • в меню команд восьмой пункт обрезался пополам, подсказка в поле резалась;
 *   • в «Использовании» число «14 ч 30 мин» упиралось в край карточки.
 *
 * Проверки — по исходникам, не по скриншотам: живой прогон глазами сделан
 * отдельно, а тест должен ловить возврат правки, не требуя браузера.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const profile = read('src/views/ProfileView.tsx')
const info = read('src/views/InfoView.tsx')
const paletteTsx = read('src/components/CommandPalette.tsx')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U227a все источники версии синхронизированы', v.ok, v.why)
ok('U227b история README знает 0.227', /\*\*0\.227\*\*/.test(readme))
ok('U227c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/rows-name|line-clamp|min-width|is-wrap/.test(notes))
ok('U227d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── подпись строки ──────────────────────────────────────────────────── */

const rowsName = (css.match(/\.rows-name \{[\s\S]*?\n\}/) || [])[0] || ''

ok('U227e подпись строки не сжимается в огрызок: у неё есть нижняя планка ширины',
  /min-width:\s*5\.5em/.test(rowsName),
  rowsName.slice(0, 200))

ok('U227f подпись переносится по словам, а не рвётся посередине',
  /white-space:\s*normal/.test(rowsName)
    && /overflow-wrap:\s*normal/.test(rowsName)
    && !/overflow-wrap:\s*break-word/.test(rowsName)
    && /-webkit-line-clamp:\s*2/.test(rowsName))

ok('U227g на 320 px подпись и значение чуть мельче — длинное слово влезает целиком',
  /@media \(max-width: 359px\) \{\s*\n\s*\.rows-name \{ font-size: 14\.5px; \}/.test(css)
    && /\.rows-val \{ font-size: 12\.5px; \}/.test(css))

ok('U227h тяжёлый хвост строки переносится отдельным классом, а не у всех строк подряд',
  /\.rows-row\.is-stack \{[\s\S]*?flex-wrap:\s*wrap/.test(css)
    && !/\.rows-row\.is-wrap \{[\s\S]{0,120}?flex-wrap:\s*wrap/.test(css))

ok('U227i в «Информации» номер версии и число моделей живут в переносящейся строке',
  (info.match(/rows-row is-wrap is-stack/g) || []).length >= 2)

/* ── уведомления ─────────────────────────────────────────────────────── */

ok('U227j «Уведомления» отвечают коротким словом, а не фразой на полстроки',
  /'запрещены'/.test(profile) && !/rows-val[^>]*>\{?[^}]*запрещены в браузере/.test(profile))

ok('U227k почему включить нельзя — сказано словами под строкой',
  /const why =/.test(profile)
    && /Разрешите их в настройках сайта/.test(profile)
    && /добавьте приложение на главный экран/.test(profile)
    && /\{why \? \(/.test(profile))

/* ── строки настроек ─────────────────────────────────────────────────── */

ok('U227l в строке настроек подпись не сжимается в столбик: у неё есть нижняя планка',
  /\.settings-row \.grow \{[\s\S]*?flex:\s*1 1 160px/.test(css))

ok('U227m пояснение занимает всю ширину строки, а не висит справа',
  /\.rows-hint \{[\s\S]*?flex:\s*1 1 100%/.test(css))

/* ── меню команд и панель ────────────────────────────────────────────── */

ok('U227n в меню команд виден последний пункт: список выше и привязан к высоте экрана',
  /\.palette-list \{[\s\S]*?max-height:\s*min\(420px, calc\(100svh - 190px\)\)/.test(css))

ok('U227o подсказка в поле ввода умещается на телефоне',
  /placeholder="Команда или раздел…"/.test(paletteTsx)
    && !/Введите команду или раздел/.test(paletteTsx))

ok('U227p число «до сброса» не упирается в край карточки на 320 px',
  /\.speed-grid \.usage-num \{ font-size: 16px/.test(css))

ok('U227q проверки подключены к общему прогону', chain.includes('test/ui227.test.js'))
