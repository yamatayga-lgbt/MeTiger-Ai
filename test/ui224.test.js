/**
 * 0.224: «читается с телефона» — аудит живой версии 19.10.2026, P1 и P2.
 *
 * Что проверяем словами владельца: строка лимитов в профиле не обрезается,
 * панель на 320 px не рассыпается, мелкие подписи читаются (норма AA считается
 * в тесте, а не берётся на глаз), вопрос по приложенному файлу не ищет в
 * интернете, шаги подготовки ответа по-русски, совет голов без служебных имён,
 * длинная формула прокручивается, в панели видно остаток в сообщениях.
 *
 * Вторая половина — дверь запаса: суточный потолок на адрес (engine/ipcap.js)
 * и его собственный прогон в test/ipcap.test.js.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'
import { needsWeb } from '../engine/webrules.js'
import { gatherTools } from '../engine/tools.js'
import { detect as detectSkills, toolsOf as skillTools } from '../engine/skills.js'
import { lineOf } from '../engine/ensemble.js'
import { messagesLeft } from '../engine/daycap.js'

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
const chatView = read('src/views/ChatView.tsx')
const api = read('src/lib/api.ts')
const usage = read('functions/api/usage.js')
const chatFn = read('functions/api/chat.js')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U224a все источники версии синхронизированы', v.ok, v.why)
ok('U224b история README знает 0.224',
  /* «Что нового» держит только текущую версию — правило проекта: в 0.225 запись
     сменилась, а строка истории в README остаётся навсегда. */
  /\*\*0\.224\*\*/.test(readme))
ok('U224c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/ipcap|webrules|max-width/.test(notes))
ok('U224d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── профиль и узкий экран ─────────────────────────────────────────── */

ok('U224e значение строки профиля не сжимается, а подпись переносится целиком',
  /\.rows-val\s*\{[^}]*flex:\s*0\s+0\s+auto/.test(css)
    && /\.rows-val\s*\{[^}]*max-width:\s*none/.test(css)
    /* 0.224: после первой правки цифра перестала резаться, но название ещё
       обрезалось («Использование и ли…»). Теперь строка со значением разрешает
       перенос подписи, и на 390 px видно и название, и запас. */
    && /\.rows-row\.is-wrap \.rows-name\s*\{[^}]*white-space:\s*normal/.test(css)
    && /label="Использование и лимиты"[\s\S]{0,120}?wrap\n/.test(read('src/views/ProfileView.tsx')))

/* Блоков с таким запросом два: старый (процент у кольца) и новый (панель).
   Берём тот, где живут правила панели. */
const narrowMark = css.indexOf('.usage-live .usage-dim')
const narrow = narrowMark >= 0 ? css.slice(Math.max(0, narrowMark - 400), narrowMark + 900) : ''
ok('U224f на 320 px процент в поле ввода спрятан, но панель не рассыпается',
  narrow.length > 0
    && /\.usage-live \.usage-dim\s*\{\s*display:\s*none/.test(narrow)
    && /\.usage-num\s*\{[^}]*white-space:\s*nowrap/.test(narrow)
    && /\.topbar-pill\s*\{\s*font-size:\s*16px/.test(narrow))

/* Контраст считаем сами: «на глаз» — это и была ошибка, из-за которой подписи
   в 2,59:1 дожили до аудита. */
const lum = (hexColor) => {
  const h = String(hexColor).replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const x = parseInt(h.slice(i, i + 2), 16) / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const L1 = lum(a); const L2 = lum(b)
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
}
const pick = (block, name) => {
  const m = new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})').exec(block)
  return m ? m[1] : ''
}
const lightBlock = (/\[data-theme='light'\] \{[\s\S]*?\n\}/.exec(css) || [''])[0]
const darkBlock = (/\[data-theme='dark'\] \{[\s\S]*?\n\}/.exec(css) || [''])[0]
const lightBg = pick(lightBlock, '--bg')
const darkBg = pick(darkBlock, '--bg')
const lightT3 = pick(lightBlock, '--text-3')
const darkT3 = pick(darkBlock, '--text-3')
const lightCard = pick(lightBlock, '--surface')
const darkCard = pick(darkBlock, '--surface-2')
ok('U224g третичный текст проходит норму AA (4,5:1) в обеих темах',
  ratio(lightT3, lightBg) >= 4.5 && ratio(lightT3, lightCard) >= 4.5
    && ratio(darkT3, darkBg) >= 4.5 && ratio(darkT3, darkCard) >= 4.5,
  {
    light: { ink: lightT3, onPage: +ratio(lightT3, lightBg).toFixed(2), onCard: +ratio(lightT3, lightCard).toFixed(2) },
    dark: { ink: darkT3, onPage: +ratio(darkT3, darkBg).toFixed(2), onCard: +ratio(darkT3, darkCard).toFixed(2) },
  })

/* ── поиск не спорит с файлом ──────────────────────────────────────── */

const FILE_Q = 'Сколько стоит аренда в месяц и на сколько её повысят? Ответь одной строкой.'
ok('U224h одна примета «живого» больше не включает поиск при документе',
  needsWeb(FILE_Q).need === true
    && needsWeb(FILE_Q, { doc: true }).need === false
    && needsWeb('какой курс доллара сегодня', { doc: true }).need === true,
  { noDoc: needsWeb(FILE_Q), withDoc: needsWeb(FILE_Q, { doc: true }) })

/* Навык «свежий поиск» форсирует инструмент в обход правила — именно он и позвал
   поиск в живом прогоне. Считаем обращения к сети, а не список инструментов:
   упавшая сеть не должна прятать факт вызова. */
async function netCalls(text, opts) {
  let n = 0
  const env = { TOOLS_OFF: 'news,wikipedia,url,weather,currency,date,time,calc,random,coin,dice,joke,chart,filegen,image-search,imggen,letters' }
  await gatherTools(text, env, () => { n++; return Promise.reject(new Error('нет сети')) }, opts)
  return n
}
const forcedBySkill = skillTools(detectSkills(FILE_Q, {}))
ok('U224i навык «свежий поиск» молчит с файлом, но слушается «поищи» и глубокого режима',
  forcedBySkill.includes('web-search')
    && (await netCalls(FILE_Q, { force: forcedBySkill, hasDocs: true })) === 0
    && (await netCalls(FILE_Q, { force: forcedBySkill, hasDocs: false })) > 0
    && (await netCalls('поищи в интернете цену аренды', { force: ['web-search'], hasDocs: true })) > 0
    && (await netCalls(FILE_Q, { force: ['web-search'], hasDocs: true, deep: true })) > 0)

/* ── русский слой и совет голов ────────────────────────────────────── */

ok('U224j совет голов без служебных имён и без «3/3»',
  lineOf({ agreed: true, total: 3, votes: [{ n: 3, providers: ['author', 'inception', 'zai'] }] }) === 'сошлись 3 из 3'
    && lineOf({ agreed: false, total: 3, votes: [{ n: 2, providers: ['a', 'b'] }] }) === 'разошлись 2 из 3')

ok('U224k шаги подготовки ответа по-русски, служебные имена инструментов переведены',
  !/Explored \{n\}|'Read '|"Couldn't read "|Write <span/.test(chatView)
    && /Прочитал \{pluralRu\(n, 'файл', 'файла', 'файлов'\)\}/.test(chatView)
    && /Создал <span className="write-file-name">/.test(chatView)
    && /imggen: 'рисование'/.test(api))

/* ── формула и панель ─────────────────────────────────────────────── */

ok('U224l длинная выключная формула прокручивается, а не рвётся на куски',
  /\.math-fx\.is-block\s*\{[^}]*flex-wrap:\s*nowrap/.test(css)
    && /\.math-fx\.is-block\s*\{[^}]*overflow-x:\s*auto/.test(css)
    && /tex\.length > 64/.test(read('src/components/Markdown.tsx')))

ok('U224m публичная панель называет остаток в сообщениях и «запас ниже 20 %»',
  /left:\s*capPeek\.on \? messagesLeft\(capPeek\.remaining\)/.test(usage)
    && /low:\s*capPct != null && capPct < 20/.test(usage))

ok('U224n остаток в сообщениях округляется вниз и не выглядит точнее, чем есть',
  messagesLeft(9000) === 4500 && messagesLeft(3801) === 1900 && messagesLeft(9) === 4 && messagesLeft(0) === 0,
  { a: messagesLeft(9000), b: messagesLeft(3801), c: messagesLeft(9) })

/* ── дверь адреса подключена к двери чата ─────────────────────────── */

ok('U224o суточный потолок адреса стоит до движка и списывается фоном',
  /createIpCap\(/.test(chatFn)
    && /ipCap\.check\(\)/.test(chatFn)
    && /ipCap\.take\(capBill\)/.test(chatFn)
    && /noCouncils: !!norm\.model \|\| !!ipNow\.soft/.test(chatFn)
    && /test\/ui224\.test\.js/.test(chain)
    && /test\/ipcap\.test\.js/.test(chain))

console.log('\n✔ 0.224: читается с телефона — проверки пройдены')
