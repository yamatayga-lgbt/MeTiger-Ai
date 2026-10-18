/**
 * 0.202: суточный потолок агента и закрытая дверь GET /api/usage.
 *
 * Две вещи, которые до этой версии молчали и обе стоили денег/доверия:
 *   1. общий запас агента (~9 900 попыток к провайдерам) тратился без суточного
 *      потолка: частотный лимит считает «не части», а не «не всё», и десять адресов
 *      в его ритме выключали бесплатного агента всем до полуночи UTC;
 *   2. /api/usage отдавал наружу имена провайдеров, у кого есть ключ, расход и
 *      паузы — любому, кто откроет адрес (это и нашлось в аудите 17.10.2026).
 *
 * Здесь проверяется не «поле есть», а поведение: без кода владельца раскладки нет,
 * с кодом — есть; потолок тратит единицы записей в KV, а не тысячи; исчерпанный
 * день отвечает 503 с временем сброса, а упавшее KV агента не выключает.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { versionsAligned } from './version-sync.js'
import { onRequestGet as usageGet } from '../functions/api/usage.js'
import { ownerHash } from '../engine/reports.js'
import { createDayCap } from '../engine/daycap.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const pkg = JSON.parse(read('package.json'))
const chain = String(pkg.scripts.test || '')
const door = read('functions/api/usage.js')
const chat = read('functions/api/chat.js')
const capSrc = read('engine/daycap.js')
const client = read('src/lib/usage.ts')
const view = read('src/views/UsageView.tsx')
const ring = read('src/components/LimitsRing.tsx')
const limits = read('src/lib/limits.ts')
const readme = read('README.md')

/* ── Хранилище как настоящий KV: JSON на чтении, TTL на записи ─────────────── */
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
      if (api.fail) throw new Error('KV недоступен')
      const ttl = opts && opts.expirationTtl
      if (ttl != null && ttl < 60) throw new Error('expirationTtl too short')
      map.set(key, { value, ttl })
    },
    delete: async (key) => { map.delete(key) },
    _map: map,
    puts: 0,
    fail: false,
  }
  return api
}
const storeOfKv = (kv) => ({
  get: (k) => kv.get(k, 'json'),
  put: (k, v, ttl) => kv.put(k, JSON.stringify(v), { expirationTtl: ttl }),
})

/* ── Дверь: два яруса ─────────────────────────────────────────────────────── */

const OWNER = 'UI202-OWNER-1'
const OWNER_HASH = await ownerHash(OWNER)
const ENV = { GROQ_KEYS: 'g1,g2', GEMINI_KEYS: 'gm1', REPORT_OWNER_HASH: OWNER_HASH }
const req = (headers) => new Request('https://metiger-ai.pages.dev/api/usage', { headers: headers || {} })

{
  const openRes = await usageGet({ env: ENV, request: req() })
  const open = await openRes.json()
  ok('U202a без кода владельца дверь отвечает «жив/лимит»: процент и время сброса',
    openRes.status === 200 && open.ok === true && open.scope === 'public'
      && typeof open.pool.pct === 'number' && open.cap && open.cap.resetInMs > 0,
    JSON.stringify(open).slice(0, 200))
  ok('U202b без кода наружу не уходит ни один провайдер, ключ или расход',
    !open.providers && !open.totals && !open.failover && !open.precision
      && !/groq|gemini|openrouter|llm7|kilo|inception|ключ/i.test(JSON.stringify(open)),
    JSON.stringify(open).slice(0, 200))
  ok('U202c заголовок x-mt-owner разрешён в CORS — иначе браузер владельца не дойдёт',
    /x-mt-owner/.test(openRes.headers.get('access-control-allow-headers') || ''))

  const own = await (await usageGet({ env: ENV, request: req({ 'x-mt-owner': OWNER }) })).json()
  ok('U202d с кодом владельца приходит полная раскладка: провайдеры, итоги, точность',
    own.scope === 'owner' && Array.isArray(own.providers) && own.providers.length > 0
      && !!own.totals && !!own.precision && !!own.cap && own.cap.max > 0,
    'scope=' + own.scope)

  const wrong = await (await usageGet({ env: ENV, request: req({ 'x-mt-owner': 'NOT-THE-CODE' }) })).json()
  ok('U202e чужой код не открывает раскладку — падает в публичный ярус',
    wrong.scope === 'public' && !wrong.providers, 'scope=' + wrong.scope)

  const byUrl = await (await usageGet({
    env: ENV,
    request: new Request('https://metiger-ai.pages.dev/api/usage?code=' + encodeURIComponent(OWNER)),
  })).json()
  ok('U202f curl получает раскладку через ?code= — заголовок не обязателен',
    byUrl.scope === 'owner' && Array.isArray(byUrl.providers), 'scope=' + byUrl.scope)
}

/* ── Потолок: экономика записей и общий счёт ──────────────────────────────── */

{
  const DAY = Date.parse('2026-10-17T10:00:00Z')
  const kv = fakeKv()
  const cap = createDayCap({ env: {}, store: storeOfKv(kv), now: () => DAY })
  await cap.check()
  for (let i = 0; i < 100; i++) await cap.take(1)
  ok('U202g 100 попыток — две записи в KV (кусками по 50), а не сто',
    kv.puts === 2 && cap.stats().spent === 100, JSON.stringify({ puts: kv.puts, st: cap.stats() }))

  const kv2 = fakeKv()
  const a = createDayCap({ env: { DAY_CAP: '300', DAY_CAP_CHUNK: '100' }, store: storeOfKv(kv2), now: () => DAY })
  const b = createDayCap({ env: { DAY_CAP: '300', DAY_CAP_CHUNK: '100' }, store: storeOfKv(kv2), now: () => DAY })
  const sa = await a.check()
  await a.take(100)
  await a.flush()
  const sb = await b.check()
  ok('U202h потолок общий: второй изолят видит списание первого, а не заранее откусанный кусок',
    sa.allowed === true && sb.allowed === true && sb.used === 100 && sb.remaining === 200,
    JSON.stringify({ a: sa.used, b: sb.used, left: sb.remaining }))
  await b.take(200)
  await b.flush()
  const third = await createDayCap({ env: { DAY_CAP: '300', DAY_CAP_CHUNK: '100' }, store: storeOfKv(kv2), now: () => DAY }).check()
  const fourth = await createDayCap({ env: { DAY_CAP: '300', DAY_CAP_CHUNK: '100' }, store: storeOfKv(kv2), now: () => DAY }).check()
  ok('U202i исчерпанный запас — честный отказ, а не тихое превышение',
    third.allowed === false && third.used === 300 && third.remaining === 0
      && fourth.allowed === false && fourth.blocked === true,
    JSON.stringify({ third: third.allowed, fourth: fourth.allowed, used: third.used }))

  /* Ключ под сутки UTC: завтрашний день не должен видеть сегодняшний расход. */
  ok('U202j ключ потолка — сутки UTC, TTL двое суток',
    /cap:v1:/.test(capSrc) && /DAY_CAP_TTL_SEC/.test(capSrc)
      && [...kv._map.keys()].every((k) => k.indexOf('cap:v1:') === 0),
    [...kv._map.keys()].join(','))

  /* Аварийный тумблер и отказ хранилища: оба случая — «агент работает». */
  const off = createDayCap({ env: { DAY_CAP_OFF: '1' }, store: null, now: () => DAY })
  const offState = await off.check()
  ok('U202k DAY_CAP_OFF=1 — потолка нет, дверь открыта',
    off.cfg.on === false && offState.allowed === true, JSON.stringify(offState))

  const bad = { get: async () => { throw new Error('KV') }, put: async () => { throw new Error('KV') } }
  const deg = createDayCap({ env: { DAY_CAP: '10', DAY_CAP_CHUNK: '5' }, store: bad, now: () => DAY })
  const d1 = await deg.check()
  await deg.take(10)
  const d2 = await deg.check()
  ok('U202l упавшее KV не выключает агента, но потолок держится по памяти изолята',
    d1.allowed === true && deg.state().degraded === true && d2.allowed === false,
    JSON.stringify({ degraded: deg.state().degraded, allowed: d2.allowed }))
}

/* ── Граница чата и фронт ─────────────────────────────────────────────────── */

{
  const c = bare(chat)
  ok('U202m отказ суточного потолка говорит по-человечески и знает время сброса',
    /дневной запас агента/.test(c) && /00:00 UTC/.test(c) && /humanLeft\(/.test(c)
      && /503/.test(c), '')
  ok('U202n потолок проверяется до вложений — исчерпанный день не жжёт распознавание',
    c.indexOf('createDayCap') < c.indexOf('readAttachments'), '')

  const cl = bare(client)
  ok('U202o клиент шлёт код владельца заголовком x-mt-owner',
    /ownerCode/.test(cl) && /x-mt-owner/.test(cl) && /ownerHeaders\(\)/.test(cl), '')
  ok('U202p экран знает про публичный ярус и не рисует раскладку без кода',
    /scope === 'public'/.test(bare(view)) && /Раскладка по источникам скрыта/.test(view), '')
  ok('U202q подпись запаса переносит ответ без абсолютных чисел',
    /осталось .* общего дневного запаса/.test(limits) || /Number\.isFinite\(Number\(pool\.remaining\)\)/.test(limits), '')
  ok('U202r кольцо в шапке по-прежнему живёт одним процентом — без списка провайдеров',
    /data\.pool/.test(ring) && !/data\.providers/.test(bare(ring)), '')
}

{
  const v = versionsAligned()
  ok('U202s версия во всех источниках одна', v.ok, v.why)
  /* 0.203: запись «Что нового» — одна и текущей версии (правило 0.189), 0.202
     уехала в историю README, как все версии до неё (шаблон ui137 и др.). */
  ok('U202t история README содержит 0.202 и объясняет потолок',
    /^> \*\*0\.202\*\*/m.test(readme) && /потолок/i.test(readme), '')
  ok('U202u проверка подключена к общему прогону — иначе «прошла» бы сама по себе',
    /test\/ui202\.test\.js/.test(chain), '')
}
