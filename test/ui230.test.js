/**
 * 0.230: сноски — рядом со словом, а не столбиком цифр между абзацами.
 *
 * Как это выглядело на проде. Ответ с четырьмя источниками читался так:
 *
 *     … точно оценивать пространство
 *
 *                        1
 *
 *                        2
 *
 *     .
 *
 * То есть человек видел три пустые строки посреди ответа, а сам номер источника
 * уезжал куда-то вбок. Причина была не в вёрстке, а в том, КАК ставились сноски:
 * подстановщик правил строку ответа и превращал `[1]` в `[\[1\]](url)` — скобки
 * экранировались, чтобы Markdown не съел их как ссылку. А пара `\[ … \]` — это
 * ещё и выключная формула LaTeX, и наш собственный разбор формул честно рисовал
 * цифру как формулу: отдельной строкой, по центру.
 *
 * Теперь сноски ставятся плагином на уровне дерева Markdown: обычный текст
 * режется на куски, номер становится настоящей ссылкой, в текст ничего не
 * дописывается и ничего не экранируется. Плюс защита на стороне формул: `\[1\]`,
 * доставшееся от старых сохранённых ответов, формулой больше не считается.
 *
 * Проверки ниже стерегут именно поведение — то, что человек видит.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
const markdownSrc = read('src/components/Markdown.tsx')
const citeSrc = read('src/lib/cite.ts')
const mathSrc = read('src/lib/mathfmt.ts')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U230a все источники версии синхронизированы', v.ok, v.why)
ok('U230b история README знает 0.230', /\*\*0\.230\*\*/.test(readme))
ok('U230c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/linkCitations|remark|LaTeX|ui230/.test(notes))
ok('U230d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── сноски ставятся деревом, а не правкой строки ─────────────────────── */

ok('U230e сноски расставляет плагин разбора, и строка ответа больше не правится',
  /export function remarkCitations/.test(citeSrc)
    && /remarkCitations\(sources\)/.test(markdownSrc)
    && !/linkCitations/.test(markdownSrc)
    /* Никакого экранирования скобок в тексте ответа: именно оно и превращало
       сноску в формулу. */
    && !/\\\\\[\\\\\[/.test(citeSrc))

/* Функция называется и вызывается — по исходнику; а что она делает, видно
   ниже, на живом рендере (U230h): формул из «\[1\]» больше не получается. */
ok('U230f экранированная сноска из старых ответов формулой больше не считается',
  /function isFootnoteLike/.test(mathSrc)
    && /if \(!isFootnoteLike\(body\)\) \{/.test(mathSrc)
    && /\\d\{1,2\}/.test(mathSrc))

/* ── то, что видит человек ─────────────────────────────────────────────── */

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.log('✖ сноски: esbuild не найден (' + bin + ') — проверки НЕ выполнены. Нужно `npm install`.')
  process.exit(1)
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui230')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const out = join(dir, 'markdown.mjs')
execFileSync(bin, ['src/components/Markdown.tsx', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--loader:.png=dataurl', '--outfile=' + out, '--log-level=error'], { stdio: 'inherit' })

const { renderToStaticMarkup } = await import('react-dom/server')
const React = (await import('react')).default
const { Markdown } = await import(out)

const SOURCES = [
  { title: 'purina.ru', url: 'https://www.purina.ru/a' },
  { title: 'royalcanin.com', url: 'https://www.royalcanin.com/b' },
]
const html = (text, sources = SOURCES) =>
  renderToStaticMarkup(React.createElement(Markdown, { text, sources }))

{
  const h = html('Пространство вокруг [1][2]. Дальше текст.')
  ok('U230g сноска в тексте — ссылка-номер рядом со словом, точкой и остальным текстом',
    /Пространство вокруг <a class="cite" href="https:\/\/www\.purina\.ru\/a"[^>]*>1<\/a>/.test(h)
      && /<a class="cite" href="https:\/\/www\.royalcanin\.com\/b"[^>]*>2<\/a>\. Дальше текст\./.test(h),
    h)

  ok('U230h выключной формулы из сноски не получается — цифра не стоит отдельной строкой по центру',
    !/math-fx/.test(h) && !/role="math"/.test(h), h)

  const noSrc = html('Пространство [1] без источников.', [])
  ok('U230i без источников сноска остаётся текстом «[1]», а не пустой ссылкой',
    !/class="cite"/.test(noSrc) && /\[1\]/.test(noSrc), noSrc)

  const odd = html('Ссылка на пятый [5] источник.')
  ok('U230j номер без источника — как написан текст, без выдуманной ссылки',
    !/class="cite"/.test(odd) && /\[5\]/.test(odd), odd)

  const code = html('Код `arr[1]` и блок:\n\n```js\nconst a = arr[1];\n```\n\nи сноска [1].')
  ok('U230k в коде сноска остаётся кодом, а в тексте — ссылкой',
    /arr\[1\]/.test(code) && !/arr<a class="cite"/.test(code) && /class="cite"/.test(code), code)

  const math = html('Площадь \\[ x^2 + 1 \\] и сноска [1].')
  ok('U230l настоящая формула в \\[…\\] рисуется формулой, а сноска рядом — ссылкой',
    /math-fx is-block/.test(math) && /class="cite"/.test(math), math)
}

ok('U230m сноски подряд стоят связкой, а не двумя чужими чипами',
  /\.msg-text a\.cite \+ a\.cite/.test(css))

ok('U230n проверка подключена к общему прогону', /node test\/ui230\.test\.js/.test(chain))

console.log('\n✔ 0.230: сноски рядом со словом — проверки пройдены')
