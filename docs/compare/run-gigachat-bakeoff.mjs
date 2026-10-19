#!/usr/bin/env node
/**
 * Живой прогон MeTiger по замороженным вопросам bake-off vs GigaChat.
 * Сторону GigaChat этот скрипт не вызывает: нет ключа и нужен RU IP + Сбер ID.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const URL_BASE = 'https://metiger-ai.pages.dev'
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const HEADERS = {
  'content-type': 'application/json',
  origin: URL_BASE,
  referer: URL_BASE + '/',
  'user-agent': UA,
}

const pack = JSON.parse(readFileSync(new URL('./gigachat-bakeoff-questions.json', import.meta.url), 'utf8'))
mkdirSync(new URL('./gigachat-bakeoff', import.meta.url), { recursive: true })

async function ask(text) {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 180000)
  try {
    const r = await fetch(URL_BASE + '/api/chat', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text, chatId: 'bakeoff_giga_2026_10_19', history: [] }),
      signal: ctrl.signal,
    })
    const ms = Date.now() - t0
    const raw = await r.text()
    let j = null
    try { j = JSON.parse(raw) } catch { /* keep raw */ }
    return { ok: r.ok, status: r.status, ms, j, raw: raw.slice(0, 8000) }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e) }
  } finally {
    clearTimeout(t)
  }
}

const out = { frozenAt: pack.frozenAt, ranAt: new Date().toISOString(), nbrbUsd: 3.0098, results: [] }

for (const task of pack.tasks) {
  process.stdout.write(`→ ${task.id} ${task.axis} … `)
  const r = await ask(task.text)
  const reply = r.j && (r.j.reply || r.j.text || '')
  const row = {
    id: task.id,
    axis: task.axis,
    text: task.text,
    pass: task.pass,
    ok: r.ok,
    status: r.status,
    ms: r.ms,
    provider: r.j && r.j.provider,
    model: r.j && r.j.model,
    intent: r.j && r.j.intent,
    attempts: r.j && r.j.attempts,
    reply: String(reply || '').slice(0, 4000),
    error: r.error || (r.ok ? null : String(r.raw || '').slice(0, 400)),
  }
  out.results.push(row)
  console.log(`${r.ok ? 'ok' : 'fail'} ${Math.round(r.ms / 1000)}с ${(row.provider || '')} ${(row.model || '')}`)
  await new Promise((x) => setTimeout(x, 800))
}

writeFileSync(new URL('./gigachat-bakeoff/metiger-live.json', import.meta.url), JSON.stringify(out, null, 2))
console.log('записано docs/compare/gigachat-bakeoff/metiger-live.json')
