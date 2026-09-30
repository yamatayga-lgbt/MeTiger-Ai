// MeTiger Ai — счётчик реальных запусков с уникальных устройств.
// Хранение: Durable Object (SQLite) внутри воркера — без внешних сервисов.
// GET /hit?id=<deviceId> — отметить запуск, получить число уникальных устройств.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS })
      }
      const url = new URL(request.url)
      if (url.pathname !== '/hit') {
        return json({ error: 'not found' }, 404)
      }
      const id = (url.searchParams.get('id') || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64)
      const stub = env.COUNTER.get(env.COUNTER.idFromName('launches-v1'))
      const res = await stub.fetch('https://counter/hit?id=' + encodeURIComponent(id))
      const data = await res.json()
      return json(data)
    } catch (e) {
      return json({ error: String((e && e.message) || e), stack: String((e && e.stack) || '') }, 500)
    }
  },
}

export class Counter {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    try {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') || ''
      if (url.pathname === '/hit' && id) {
        const key = 'dev:' + id
        const seen = await this.state.storage.get(key)
        if (!seen) {
          await this.state.storage.put(key, Date.now())
        }
      }
      const devices = await this.state.storage.list({ prefix: 'dev:' })
      return json({ devices: devices.size })
    } catch (e) {
      return json({ error: String((e && e.message) || e), stack: String((e && e.stack) || '') }, 500)
    }
  }
}
