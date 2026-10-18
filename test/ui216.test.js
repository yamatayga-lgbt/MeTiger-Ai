/**
 * 0.216: тёмные карточки профиля — серые, запас в строке «Использование и лимиты».
 *
 * Владелец прислал снимок тёмной темы: карточки белые, подписи чёрные. Просил
 * мягкий серый фон и белый текст, как у заголовков разделов. Заодно — одну
 * цифру запаса на шапке, в профиле и на экране лимитов, без расхождения.
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
const css = read('src/styles/index.css')
const profile = read('src/views/ProfileView.tsx')
const view = read('src/views/UsageView.tsx')
const ring = read('src/components/LimitsRing.tsx')
const lib = read('src/lib/limits.ts')
const chain = String(pkg.scripts.test || '')
const sw = read('public/sw.js')
const v = versionsAligned()

ok('U216a все источники версии синхронизированы', v.ok, v.why)
ok('U216b «Что нового» и README знают 0.216',
  /\*\*0\.216\*\*/.test(readme) && /version: '0\.216'/.test(notes))
ok('U216c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/reservePct|rows-row/.test(notes))
ok('U216d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

const rowsRule = (css.match(/\.rows-row \{[\s\S]*?\n\}/) || [])[0] || ''
ok('U216e строка профиля берёт цвет темы, а не чёрный на белом',
  /color: var\(--text\)/.test(rowsRule) && !/color: black/.test(rowsRule)
    && /background: transparent/.test(rowsRule) && !/background: white/.test(rowsRule),
  rowsRule.slice(0, 180))
ok('U216f иконка строки того же цвета, что и подпись',
  /\.rows-ic \{[\s\S]*?color: var\(--text\)/.test(css) && !/\.rows-ic \{[\s\S]*?color: black/.test(css))
ok('U216g в тёмной теме карточка — мягкий серый, не белая',
  /\[data-theme='dark'\] \.rows-card \{[\s\S]*?background: #2c2c34/.test(css)
    && /\[data-theme='dark'\] \.usage-pool \{[\s\S]*?background: #2c2c34/.test(css))

ok('U216h запас считается одной функцией reservePct',
  /export function reservePct/.test(lib)
    && /reservePct\(data\)/.test(ring) && /reservePct\(data\)/.test(view)
    && /reservePct\(data\)/.test(profile))
ok('U216i в профиле запас виден в самой строке «Использование и лимиты»',
  /function UsageLimitsRow/.test(profile)
    && /label="Использование и лимиты"/.test(profile)
    && /fmtPct\(pct\)/.test(profile)
    && /onNavigate\('usage'\)/.test(profile))

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.log('✖ 0.216: esbuild не найден — проверки reservePct НЕ выполнены. Нужно `npm install`.')
  process.exit(1)
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-limits216')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const out = join(dir, 'limits.mjs')
execFileSync(bin, ['src/lib/limits.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' })
const { reservePct, fmtPct } = await import(out)

ok('U216j при включённом потолке запас — его процент, не сумма квот',
  reservePct({ cap: { on: true, pct: 62.222 }, pool: { pct: 98 } }) === 62.222)
ok('U216k без потолка — процент пула; пустые данные — честный null',
  reservePct({ cap: { on: false, pct: 10 }, pool: { pct: 80 } }) === 80
    && reservePct(null) === null && reservePct({}) === null)
ok('U216l процент в строке профиля — тот же формат, что в шапке',
  fmtPct(62.222) === '62,2\u00a0%')

ok('U216m проверка подключена к общему прогону', /test\/ui216\.test\.js/.test(chain))

console.log('\n✔ 0.216: тёмные карточки серые, запас в профиле — проверки пройдены')
