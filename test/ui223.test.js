/**
 * 0.223: Qwen Chat обойдён как продукт в той же шкале, что DeepSeek.
 * Не как фронтир-модель: окно и флагман у них сильнее.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
const cmp = read('docs/compare/metiger-vs-qwen.md')
const queue = read('docs/compare/очередь-обхода-ИИ.md')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U223a все источники версии синхронизированы', v.ok, v.why)
ok('U223b история README знает 0.223',
  /* «Что нового» держит только текущую версию (правило проекта), поэтому
     строку ищем в истории README — она остаётся навсегда. */
  /\*\*0\.223\*\*/.test(readme))
ok('U223c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/88\/120|fair-use/.test(notes))
ok('U223d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U223e сравнение есть и сумма 88 против 85',
  /\*\*88 \/ 120\*\*/.test(cmp) && /\*\*85 \/ 120\*\*/.test(cmp)
    && /Qwen Chat обойдён как продукт/.test(cmp)
    && /не как\s+фронтир-модель/.test(cmp))

ok('U223f очередь помечает Qwen пройденным',
  /Qwen Chat — пройден по продуктовой сумме/.test(queue)
    && /88\/120 против 85\/120/.test(queue))

ok('U223g «Что нового» не выдаёт победу над моделью',
  !/победили Qwen3|фронтир-модель Qwen|обошли Qwen3/.test(notes))

ok('U223h радар и карточка для телефона на месте',
  existsSync('docs/compare/metiger-vs-qwen-radar.png')
    && existsSync('docs/compare/qwen-bypass.html'))

ok('U223i проверка подключена к общему прогону', /test\/ui223\.test\.js/.test(chain))

console.log('\n✔ 0.223: Qwen Chat обойдён как продукт — проверки пройдены')
