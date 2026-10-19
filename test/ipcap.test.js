/**
 * 0.224: суточный потолок на ОДИН адрес (engine/ipcap.js).
 *
 * Проверяем поведение, а не текст: ниже мягкой ступени адрес отвечает как
 * обычно; на мягкой — отвечает, но помечен «урезанным» (дверь по этому флагу
 * снимает совет голов и исследование); на жёсткой — закрыт до полуночи UTC.
 * Отдельно: в хранилище не уезжает сам адрес (только хэш), отказ хранилища не
 * выключает агента, тумблер владельца выключает вторую дверь целиком.
 */
import assert from 'node:assert/strict'
import { createIpCap, ipKeyOf, ipCfg, IP_DAY_CAP_DEFAULT, IP_DAY_HARD_DEFAULT } from '../engine/ipcap.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

/** Файловое хранилище вместо KV: те же get/put, что у байндинга MEMORY. */
function fakeStore() {
  const m = new Map()
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null },
    async put(k, v) { m.set(k, v) },
  }
}

const T0 = Date.UTC(2026, 9, 19, 10, 0, 0)
const now = () => T0

// ── I1: ниже мягкой ступени — обычный ответ ──────────────────────────
{
  const cap = createIpCap({ env: {}, store: fakeStore(), ip: '10.0.0.1', now })
  const st = await cap.check()
  ok('I1: пустой счётчик — адрес отвечает, урезания нет',
    st.allowed === true && st.soft === false && st.blocked === false, st)
}

// ── I2: мягкая ступень — отвечает, но с флагом ───────────────────────
{
  const store = fakeStore()
  const cap = createIpCap({ env: { IP_DAY_CAP: '10', IP_DAY_HARD: '50' }, store, ip: '10.0.0.2', now })
  await cap.take(10)
  await cap.flush()
  const st = await cap.check()
  ok('I2: мягкая ступень включает soft, но не закрывает адрес',
    st.allowed === true && st.soft === true && st.blocked === false, st)
}

// ── I3: жёсткая ступень — закрыт до полуночи ─────────────────────────
{
  const store = fakeStore()
  const cap = createIpCap({ env: { IP_DAY_CAP: '10', IP_DAY_HARD: '20' }, store, ip: '10.0.0.3', now })
  await cap.take(20)
  await cap.flush()
  const st = await cap.check()
  ok('I3: жёсткая ступень закрывает адрес и называет время сброса',
    st.allowed === false && st.blocked === true && st.resetInMs > 0 && st.resetInMs <= 24 * 3600 * 1000, st)
}

// ── I4: списание видно следующему изоляту через хранилище ────────────
{
  const store = fakeStore()
  const cfgEnv = { IP_DAY_CAP: '1000', IP_DAY_HARD: '2000' }
  const a = createIpCap({ env: cfgEnv, store, ip: '10.0.0.4', now })
  await a.take(30)
  await a.flush()
  const b = createIpCap({ env: cfgEnv, store, ip: '10.0.0.4', now })
  const st = await b.check()
  ok('I4: расход одного изолята виден другому — счёт общий, а не локальный',
    st.used >= 30, st)
}

// ── I5: в хранилище нет адреса открытым текстом ──────────────────────
{
  const store = fakeStore()
  const cap = createIpCap({ env: {}, store, ip: '203.0.113.77', now })
  await cap.take(1)
  await cap.flush()
  const keys = [...store.m.keys()].join(' ')
  ok('I5: ключ хранит хэш адреса, а не сам адрес',
    keys.length > 0 && !keys.includes('203.0.113.77') && keys.includes('ipcap:v1:'), keys)
  ok('I5b: ipKeyOf зависит и от дня, и от адреса',
    ipKeyOf('2026-10-19', '1.1.1.1', 'ipcap:v1:') !== ipKeyOf('2026-10-19', '1.1.1.2', 'ipcap:v1:')
      && ipKeyOf('2026-10-19', '1.1.1.1', 'ipcap:v1:') !== ipKeyOf('2026-10-20', '1.1.1.1', 'ipcap:v1:'))
}

// ── I6: отказ хранилища не выключает агента ──────────────────────────
{
  const broken = {
    async get() { throw new Error('KV недоступен') },
    async put() { throw new Error('KV недоступен') },
  }
  const cap = createIpCap({ env: {}, store: broken, ip: '10.0.0.5', now, log: () => {} })
  const st = await cap.check()
  const t = await cap.take(3)
  ok('I6: хранилище упало — адрес всё равно отвечает (fail-open)',
    st.allowed === true && t.allowed !== false, { st, t })
}

// ── I7: тумблер владельца выключает вторую дверь целиком ─────────────
{
  const cap = createIpCap({ env: { IP_DAY_OFF: '1' }, store: fakeStore(), ip: '10.0.0.6', now })
  await cap.take(99999)
  const st = await cap.check()
  ok('I7: IP_DAY_OFF=1 — двери нет, даже при огромном расходе',
    st.allowed === true && st.on === false, st)
}

// ── I8: полночь UTC обнуляет счёт ────────────────────────────────────
{
  const store = fakeStore()
  const env = { IP_DAY_CAP: '10', IP_DAY_HARD: '20' }
  const late = Date.UTC(2026, 9, 19, 23, 59, 0)
  const early = Date.UTC(2026, 9, 20, 0, 1, 0)
  const a = createIpCap({ env, store, ip: '10.0.0.7', now: () => late })
  await a.take(20)
  await a.flush()
  const closed = await a.check()
  const b = createIpCap({ env, store, ip: '10.0.0.7', now: () => early })
  const fresh = await b.check()
  ok('I8: после полуночи UTC адрес снова открыт',
    closed.allowed === false && fresh.allowed === true && fresh.used === 0, { closed, fresh })
}

// ── I9: умолчания разумны для человека ───────────────────────────────
{
  const c = ipCfg({})
  ok('I9: умолчания — 600 мягких и 1500 жёстких попыток, мягкая ниже жёсткой',
    c.soft === IP_DAY_CAP_DEFAULT && c.hard === IP_DAY_HARD_DEFAULT
      && c.soft < c.hard && c.on === true, c)
}

console.log('\n✔ 0.224: суточный потолок адреса — проверки пройдены')
