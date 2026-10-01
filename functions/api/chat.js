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
import { createEngine, PERSONA_SYSTEM, ensemble, vcouncil } from '../../engine/chat.js';
import { TOOL_IDS } from '../../engine/tools.js';

/* Карантин мёртвых провайдеров держим НАД движком: движок создаётся под каждый
   запрос, а «токен не принят» и «нет баланса» за одну request'у не лечатся.
   Без этой карты каждый запрос заново стучится в закрытую дверь и отдаёт под
   это время совета — те самые секунды, которые человек ждёт ответа. */
const QUARANTINE = new Map();

const MAX_IMG_BYTES = 4 * 1024 * 1024;

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

  /* Картинки: ровно столько, сколько принимает движок (две), и с потолком веса.
     Бесплатный провайдер обрезает тело запроса раньше, чем мы успеем спросить,
     а_pages function упирается в лимит запроса — лучше отказать словами сразу. */
  /* Форму data URL проверяет движок (parseDataUrl), здесь — только тип и количество:
     «длина больше 32» отрезало крошечные, но настоящие картинки и молча убивало
     весь смысл запроса «что на фото». */
  const images = Array.isArray(body.images)
    ? body.images.filter((x) => typeof x === 'string' && x.indexOf('data:') === 0)
    : [];
  if (images.length > 2) return json({ ok: false, error: 'больше двух картинок я не спрашиваю' }, 413);
  for (const im of images) {
    if (im.length * 0.74 > MAX_IMG_BYTES) return json({ ok: false, error: 'картинка тяжелее ' + Math.round(MAX_IMG_BYTES / 1024 / 1024) + ' МБ — сожми её' }, 413);
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anon';
  if (env.RATE_LIMIT !== '0' && limited(ip)) return json({ ok: false, error: 'слишком часто — подожди минуту' }, 429);

  const engine = createEngine({ env, fetch: (u, i) => fetch(u, i), quarantine: QUARANTINE });
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).filter((m) => m && m.text).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 4000) }))
    : [];

  const r = await engine.run({
    text, history,
    images,
    tier: body.tier === 'fast' || body.tier === 'smart' ? body.tier : undefined,
    only: body.provider || undefined,
    /* Человек выбрал модель в окне ввода — она и отвечает. Советы голов в этом
       режиме выключены: «взято большинство» переписало бы ответ той самой модели,
       которую человек и просил. */
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    noCouncils: !!(typeof body.model === 'string' && body.model.trim()),
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    system: typeof body.system === 'string' && body.system ? body.system : PERSONA_SYSTEM,
    deadlineMs: Number(env.CHAT_DEADLINE_MS || 50000),
  });

  if (!r.ok) return json({ ok: false, error: r.error, intent: r.intent, tier: r.tier, ms: r.ms, tried: r.tried.slice(0, 10) }, 503);
  return json({
    ok: true, reply: r.reply, reasoning: r.reasoning || '',
    provider: r.provider, model: r.model, intent: r.intent, tier: r.tier, ms: r.ms,
    /* Какие инструменты реально накормили ответ — видно в подписи под пузырём. */
    tools: r.tools || [],
    reframed: !!r.reframed,
    freedomCleaned: !!r.freedomCleaned,
    tried: r.tried.slice(0, 6),
    /* Советы голов (Этап 2) — строками, чтобы их было видно из фронтенда и из curl:
       «сошлись 2/3 (groq,cloudflare)» и «confirmed 3/3» означают, что факт проверен
       большинством; «пропущено: …» — что проверка не настроена или не к месту.
       Пустая строка — молчание контура, а оно в проде неотличимо от поломки (урок
       Yama 1.0.227: ансамбль «не работал» ровно потому, что молчал). */
    ensemble: r.ensemble ? ensemble.lineOf(r.ensemble) + (r.ensembleApplied ? ' → взято большинство' : '')
      : (r.ensembleSkip ? 'пропущено: ' + r.ensembleSkip : ''),
    vision: r.vision ? vcouncil.visionLine(r.vision) + (r.visionApplied ? ' → взято большинство' : '')
      : (r.visionSkip ? 'пропущено: ' + r.visionSkip : ''),
  });
}

export async function onRequestGet(context) {
  const engine = createEngine({ env: context.env, fetch: (u, i) => fetch(u, i), quarantine: QUARANTINE });
  return json({
    ok: true, alive: engine.alive(), providers: Object.keys(engine.providers).length,
    tools: TOOL_IDS(),
    /* чем именно движок считает мёртвым — чтобы не гадать по логам */
    dead: engine.quarantine(),
  });
}
