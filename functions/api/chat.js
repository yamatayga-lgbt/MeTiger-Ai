/**
 * POST /api/chat — вход в двигатель (Этап 1 переноса из Yama AI).
 *
 * Pages Function: тот же движок, что и в Worker, без отдельного сервиса.
 * Ключи лежат в секретах Pages (`wrangler pages secret put`), в коде их нет.
 *
 *   { text, history?: [{ role, text }], images?: [dataUrl], provider?, temperature? }
 *   → { ok, reply, provider, model, intent, tier, ms, tried }
 *
 * Ошибку не прячем: если ни один провайдер не ответил, приходит 503 со списком
 * попыток — фронт по нему и решает, показывать моку или честное «сервис не отвечает».
 */
import { createEngine, PERSONA_SYSTEM } from '../../engine/chat.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

/* Простейший ограничитель на изолят: 12 запросов в минуту на ip.
   Полноценный лимит будет на KV (Этап 3) — здесь цель одна: не давить квоты
   бесплатных провайдеров с одного клиента. */
const buckets = new Map();
function limited(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { n: 0, t: now };
  if (now - b.t > 60000) { b.n = 0; b.t = now; }
  b.n += 1;
  buckets.set(ip, b);
  return b.n > 12;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'нужен JSON' }, 400); }

  const text = String((body && body.text) || '').trim();
  if (!text) return json({ ok: false, error: 'пустой запрос' }, 400);
  if (text.length > 24000) return json({ ok: false, error: 'слишком длинный запрос' }, 413);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anon';
  if (env.RATE_LIMIT !== '0' && limited(ip)) return json({ ok: false, error: 'слишком часто — подожди минуту' }, 429);

  const engine = createEngine({ env, fetch: (u, i) => fetch(u, i) });
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).filter((m) => m && m.text).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 4000) }))
    : [];

  const r = await engine.run({
    text, history,
    images: Array.isArray(body.images) ? body.images.slice(0, 2) : [],
    tier: body.tier === 'fast' || body.tier === 'smart' ? body.tier : undefined,
    only: body.provider || undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    system: typeof body.system === 'string' && body.system ? body.system : PERSONA_SYSTEM,
    deadlineMs: Number(env.CHAT_DEADLINE_MS || 50000),
  });

  if (!r.ok) return json({ ok: false, error: r.error, intent: r.intent, tier: r.tier, ms: r.ms, tried: r.tried.slice(0, 10) }, 503);
  return json({
    ok: true, reply: r.reply, reasoning: r.reasoning || '',
    provider: r.provider, model: r.model, intent: r.intent, tier: r.tier, ms: r.ms,
    tried: r.tried.slice(0, 6),
  });
}

export async function onRequestGet(context) {
  const engine = createEngine({ env: context.env, fetch: (u, i) => fetch(u, i) });
  return json({ ok: true, alive: engine.alive(), providers: Object.keys(engine.providers).length });
}
