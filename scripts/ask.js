#!/usr/bin/env node
/*
 * Живая проверка прода: один вопрос — и видно, чем answered и что помнят.
 *
 *   node scripts/ask.js "запомни число 4242" tester
 *   node scripts/ask.js "какое число я просил запомнить?" tester
 *   CUT=1200 npm run ask -- "объясни коротко, что такое KV"
 *
 * Адрес по умолчанию — прод, переопределяется METIGER_URL (например адрес сборки
 * https://abc123.metiger-ai.pages.dev, чтобы проверить конкретный деплой).
 */
const url = new URL(process.env.METIGER_URL || 'https://metiger-ai.pages.dev')
const [msg, chatId] = process.argv.slice(2)
if (!msg) {
  console.error('употребление: node scripts/ask.js "вопрос" [chatId]')
  process.exit(2)
}
const cut = Number(process.env.CUT || 800)
const body = JSON.stringify({ text: msg, chatId: chatId || 'live' })

// пакет живёт на ESM («type: module»), поэтому импорт, а не require
const mod = url.protocol === 'http:' ? await import('node:http') : await import('node:https')
const r = mod.default.request(
  {
    hostname: url.hostname,
    port: url.port || undefined,
    path: '/api/chat',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  },
  (res) => {
    let s = ''
    res.on('data', (d) => (s += d))
    res.on('end', () => {
      let d
      try {
        d = JSON.parse(s)
      } catch {
        console.log('не json (' + res.statusCode + '): ' + s.slice(0, 300))
        return
      }
      const mem = d.memory || {}
      const rate = d.rate || {}
      console.log('вопрос: «' + msg + '» · чат ' + (chatId || 'live'))
      console.log(
        'ответ: ' + String(d.reply ?? d.error ?? '(пусто)').slice(0, cut).replace(/\n/g, '\n       '),
      )
      console.log(
        'кто ответил: ' +
          [d.provider, d.model, d.intent && 'intent ' + d.intent, d.tier, d.ms + ' мс']
            .filter(Boolean)
            .join(' · '),
      )
      console.log(
        'память: ' +
          (mem.on ? 'включена · сообщений ' + mem.messages + ', обращений ' + (mem.hits ?? 0) : 'нет (' + (mem.why || 'не подключена') + ')') +
          ' · лимит: ' + (rate.max ? rate.n + '/' + rate.max + (rate.shared ? ' (общий)' : ' (изолятор)') : '—'),
      )
      if (d.gender !== undefined) console.log('род: ' + d.gender)
    })
  },
)
r.on('error', (e) => console.log('ошибка: ' + e.message))
r.setTimeout(240000, () => {
  console.log('таймаут')
  r.destroy()
})
r.write(body)
r.end()
