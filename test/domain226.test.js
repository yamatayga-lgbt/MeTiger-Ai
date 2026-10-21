/**
 * 0.226: свой адрес — чтобы приложение открывалось без VPN и чужих DNS.
 *
 * Живой случай: сервер отвечал за две секунды, а на телефоне человек читал
 * «сеть недоступна» — провайдер резал имя *.pages.dev. Свой домен уходит от
 * фильтра: имя другое, отдаёт тот же Cloudflare.
 *
 * Проверки здесь про то, что вокруг этого не сломается: команда привязки есть и
 * не печатает секретов, привязка идёт через проект Pages, а текст ошибки теперь
 * различает «нет связи» и «адрес не открывается».
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const script = read('scripts/domain.sh')
const api = read('src/lib/api.ts')
const pkg = JSON.parse(read('package.json'))
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const sw = read('public/sw.js')
const v = versionsAligned()

ok('U226a все источники версии синхронизированы', v.ok, v.why)
ok('U226b история README и «Что нового» знают 0.226',
  /\*\*0\.226\*\*/.test(readme) && /version: '0\.226'/.test(notes))
ok('U226c в записи нет имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/CNAME|pages\.dev|DNS/.test(notes))
ok('U226d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

/* ── команда привязки ───────────────────────────────────────────────────── */

ok('U226e команда есть и запускается с телефона одной строкой',
  pkg.scripts.domain === 'bash scripts/domain.sh'
    && existsSync('scripts/domain.sh')
    && (statSync('scripts/domain.sh').mode & 0o111) !== 0)

ok('U226f привязка идёт через проект Pages, а не «просто DNS»',
  /pages\/projects\/\$\{PROJECT\}\/domains/.test(script)
    && /api POST "\$API"/.test(script)
    && /CNAME/.test(script) && /pages\.dev/.test(script))

ok('U226g скрипт отказывается привязывать сам pages.dev и мусор',
  /\*\.pages\.dev\) die/.test(script) && /это не похоже на домен/.test(script))

ok('U226h секреты не печатаются: в выводе нет ни токена, ни его значения',
  !/echo .*CLOUDFLARE_API_TOKEN/.test(script)
    && !/printf .*(CF_TOKEN|CLOUDFLARE_API_TOKEN)/.test(script)
    && /Authorization: Bearer \$CLOUDFLARE_API_TOKEN/.test(script))

ok('U226i ждёт активации и проверяет уже живой адрес, а не только статус',
  /\/api\/usage/.test(script) && /--status/.test(script) && /--remove/.test(script))

/* ── текст ошибки ───────────────────────────────────────────────────────── */

ok('U226j «сеть недоступна» объясняет, что именно случилось',
  /export function netError/.test(api)
    && /устройство без интернета/.test(api)
    && /интернет есть, но адрес/.test(api)
    && /error: stopped \? 'остановлено' : aborted \? 'время вышло' : netError\(\)/.test(api))

ok('U226k начало строки прежнее — повтор и распознавание обрыва не сломались',
  /return 'сеть недоступна — интернет есть/.test(api)
    && /const TRANSPORT_BREAK = \/время вышло\|связь оборвалась\|оборвался\|сеть недоступна\//.test(read('src/App.tsx')))

ok('U226l текст не пугает техническими деталями: только связь, адрес и что делать',
  !/HTTP|fetch|AbortError|CORS/.test(api.slice(api.indexOf('export function netError'), api.indexOf('export function netError') + 600)))

console.log('\n✔ 0.226: свой адрес и понятная причина отказа — проверки пройдены')
