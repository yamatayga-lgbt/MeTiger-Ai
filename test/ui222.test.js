/**
 * 0.222: сегодняшняя дата настоящая; таблица с суммой без «головы не сошлись».
 *
 * Замер vs GigaChat, 19.10.2026: сумма 1 253 750,50 верная, дата уехала в
 * 09.06.2025; 46,00 верные, человеку написали «число спорное». Плюс «сложи A и B»
 * не будило калькулятор, а «сегодняшняя дата» не будила date: \w не видит «я».
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
const locale = read('engine/locale.js')
const tools = read('engine/tools.js')
const ens = read('engine/ensemble.js')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

ok('U222a все источники версии синхронизированы', v.ok, v.why)
ok('U222b «Что нового» и README знают 0.222',
  /\*\*0\.222\*\*/.test(readme) && /version: '0\.222'/.test(notes))
ok('U222c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes)
    && !/scrollHeight|answerKey|parseLooseNum/.test(notes))
ok('U222d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

ok('U222e русская подсказка называет сегодняшнюю дату',
  /function todayRu/.test(locale) && /Сегодня ' \+ todayRu/.test(locale))

ok('U222f «сегодняшняя дата» будит инструмент даты кириллицей, не \\w',
  tools.includes('сегодняшн[а-яё]*') && !/сегодняшн\\w/.test(tools))

ok('U222g калькулятор складывает «A и B» и таблицу шт×цена',
  /function addTwoRu/.test(tools) && /function sumQtyPrice/.test(tools)
    && /сложи\|сложить/.test(tools))

ok('U222h совет не голосует за шапку «Итог» и не спорит сумму со средним',
  /итого\|вывод\|answer\|result\|сумма/.test(ens)
    && /сумм\\w\*\.\{0,80\}средн/.test(ens))

ok('U222i проверка подключена к общему прогону', /test\/ui222\.test\.js/.test(chain))

console.log('\n✔ 0.222: сегодняшняя дата настоящая — проверки пройдены')
