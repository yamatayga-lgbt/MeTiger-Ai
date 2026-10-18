/**
 * 0.220: запас считается по живым попыткам, не по куску 50 на холодный старт.
 *
 * Владелец посчитал: сегодня 184 запроса, а кольцо показывало 53,3 % запаса.
 * Это 4 200 «списанных» из 9 000 — потому что каждый новый изолят откусывал
 * 50 заранее и умирал, не вернув остаток. Теперь в счётчик уходит факт.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'
import { createDayCap } from '../engine/daycap.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const capSrc = read('engine/daycap.js')
const chat = read('functions/api/chat.js')
const limits = read('src/lib/limits.ts')
const chain = String(pkg.scripts.test || '')
const v = versionsAligned()

function fakeKv() {
  const map = new Map()
  const api = {
    get: async (key, type) => {
      const e = map.get(key)
      if (!e) return null
      if (type === 'json') { try { return JSON.parse(e.value) } catch (err) { return null } }
      return e.value
    },
    put: async (key, value, opts) => {
      api.puts++
      const ttl = opts && opts.expirationTtl
      if (ttl != null && ttl < 60) throw new Error('expirationTtl too short')
      map.set(key, { value, ttl })
    },
    puts: 0,
  }
  return api
}
const storeOfKv = (kv) => ({
  get: (k) => kv.get(k, 'json'),
  put: (k, v, ttl) => kv.put(k, JSON.stringify(v), { expirationTtl: ttl }),
})

ok('U220a все источники версии синхронизированы', v.ok, v.why)
ok('U220b «Что нового» и README знают 0.220',
  /\*\*0\.220\*\*/.test(readme) && /version: '0\.220'/.test(notes))
ok('U220c запись без имён файлов и жаргона',
  !/src\//.test(notes) && !/engine\//.test(notes) && !/DAY_CAP|usedShared|flush\(/.test(notes))
ok('U220d кэш оболочки знает текущую версию',
  sw.includes('v' + String(v.current).replace(/\./g, '')))

{
  const DAY = Date.parse('2026-10-18T12:00:00Z')
  const kv = fakeKv()
  const a = createDayCap({ env: { DAY_CAP: '9000', DAY_CAP_CHUNK: '50' }, store: storeOfKv(kv), now: () => DAY })
  await a.check()
  await a.take(3)
  await a.flush()
  const b = createDayCap({ env: { DAY_CAP: '9000', DAY_CAP_CHUNK: '50' }, store: storeOfKv(kv), now: () => DAY })
  const peek = await b.peek()
  ok('U220e холодный изолят списывает 3 попытки, а не кусок 50',
    peek.used === 3 && peek.remaining === 8997 && kv.puts === 1,
    JSON.stringify({ used: peek.used, remaining: peek.remaining, puts: kv.puts }))

  const kv2 = fakeKv()
  const c = createDayCap({ env: { DAY_CAP: '9000', DAY_CAP_CHUNK: '50' }, store: storeOfKv(kv2), now: () => DAY })
  await c.check()
  ok('U220f проверка двери кусок заранее не откусывает',
    kv2.puts === 0 && c.state().used === 0,
    JSON.stringify({ puts: kv2.puts, used: c.state().used }))
}

ok('U220g после ответа в KV уходит факт, хвост дописывается',
  /cap\.take\(capBill\)\.then\(\(\) => cap\.flush\(\)\)/.test(chat)
    && /async function flush/.test(capSrc))

ok('U220h строка запаса называет и расход, и остаток',
  /израсходовано/.test(limits) && /осталось/.test(limits))

ok('U220i проверка подключена к общему прогону', /test\/ui220\.test\.js/.test(chain))

console.log('\n✔ 0.220: запас по живым попыткам — проверки пройдены')
