/**
 * 0.199: оговорка инструмента видна человеку, а не только модели.
 *
 * Случай прода: 17 октября свежий поиск (Gemini + Google Search) отвечал 429 на
 * все модели, Groq — тоже 429, и агент молча отвечал по Википедии. Человек видел
 * «источники» и верил, что это свежий поиск. Хуже: на вопрос «кто президент США»
 * пришёл ответ про Байдена с случайными статьями Википедии в источниках.
 *
 * Теперь инструмент кладёт в блок строку «⚠️ …», движок отдаёт её полем
 * toolNotes, а фронт печатает под «использовал …». Проверки держат всю цепочку:
 * порвётся в любом звене — тест покраснеет.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const tools = readFileSync('engine/tools.js', 'utf8')
const chat = readFileSync('engine/chat.js', 'utf8')
const door = readFileSync('functions/api/chat.js', 'utf8')
const api = readFileSync('src/lib/api.ts', 'utf8')
const mock = readFileSync('src/lib/mock.ts', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const view = readFileSync('src/views/ChatView.tsx', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const chain = String(pkg.scripts.test || '')

/* ── N. Оговорка инструмента ─────────────────────────────────────────────── */

ok('N1 инструмент кладёт предупреждение первой строкой блока',
  /fallbackNote/.test(tools) && /'⚠️ Свежий веб-поиск/.test(tools))

ok('N2 gatherTools собирает пометки из блока и возвращает их полем notes',
  /const noteMatch = \/\^⚠️/.test(tools) && /webSteps, notes, research: researchMeta \}/.test(tools))

ok('N3 движок отдаёт пометки дальше — в обоих исходах попытки и в finish',
  (chat.match(/toolNotes: toolsRes\.notes \|\| \[\],/g) || []).length === 2
    && /toolNotes: hit \? \(hit\.toolNotes \|\| \[\]\) : \[\],/.test(chat))

ok('N4 дверь /api/chat отдаёт toolNotes в JSON',
  /toolNotes: \(r\.toolNotes && r\.toolNotes\.length\) \? r\.toolNotes : undefined/.test(door))

ok('N5 тип ответа и сообщения чата знает toolNotes',
  /toolNotes\?: string\[\]/.test(api) && /toolNotes\?: string\[\]/.test(mock))

ok('N6 App переносит toolNotes из ответа в сообщение',
  /toolNotes: r\.toolNotes && r\.toolNotes\.length \? r\.toolNotes : undefined/.test(app))

ok('N7 ChatView печатает оговорку под «использовал …»',
  /m\.toolNotes\.join\(' · '\)/.test(view) && /className="msg-tool-note"/.test(view))

ok('N8 у строки есть стиль, и он не спорит с подписью',
  /\.msg-tool-note\s*\{/.test(css) && /font-size:\s*12\.5px/.test(css))

ok('N9 тест подключён к цепочке прогона',
  /test\/ui199\.test\.js/.test(chain))
