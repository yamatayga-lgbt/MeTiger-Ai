/**
 * GET  /api/push?id=<устройство> — можно ли будить это устройство и каким ключом.
 * POST /api/push                — подписаться, отписаться, проверить, уведомить.
 *
 * Дверь нарочно маленькая: она не умеет слать уведомления кому угодно, только
 * на подписку того же устройства, которое пришло со своим id. Иначе получился бы
 * открытый релей «разбуди любого» — и первый же, кто нашёл адрес, разослал бы
 * рекламу от имени агента.
 *
 *   GET  ?id=…            → { ok, key, on, why }   (key — публичный ключ VAPID)
 *   POST { id, action }
 *     subscribe   + subscription { endpoint, keys: { p256dh, auth } }
 *     unsubscribe
 *     test                         — прислать проверочное уведомление себе
 *     notify      + text           — «ответ готов, пока вас не было» (вкладка жива,
 *                                    но скрыта: сервер об этом не знает, знает клиент)
 */
import { vapidFromEnv, parseSubscription } from '../../engine/webpush.js';
import {
  saveSubscription, readSubscription, forgetSubscription, notifyAnswer, pause,
} from '../../engine/pushstore.js';
import { sanitizeUserId } from '../../engine/profile.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Ограничитель на изолят: у Cloudflare нет общего счётчика, но и одного изолята
 * хватает, чтобы «проверить уведомление» не превратилось в сотню пушей подряд.
 */
const HITS = new Map();
const HITS_MAX = 30;
const HITS_WINDOW_MS = 60 * 1000;
function allow(ip) {
  const now = Date.now();
  const slot = HITS.get(ip);
  if (!slot || now - slot.at > HITS_WINDOW_MS) {
    HITS.set(ip, { at: now, n: 1 });
    if (HITS.size > 5000) HITS.clear();
    return true;
  }
  slot.n += 1;
  return slot.n <= HITS_MAX;
}

const ipOf = (request) =>
  String((request && request.headers && (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for'))) || 'anon')
    .split(',')[0].trim().slice(0, 60);

export async function onRequestGet(context) {
  const { request, env } = context;
  const id = sanitizeUserId(new URL(request.url).searchParams.get('id'));
  const v = vapidFromEnv(env);
  if (!v.ok) {
    /* Не 500: продукт жив, просто уведомления ещё не настроены. Фронт по этому
       ответу честно пишет «пока недоступно», а не «ошибка сервера». */
    return json({ ok: true, on: false, key: '', why: v.why });
  }
  const sub = id ? await readSubscription(env, id) : null;
  return json({ ok: true, on: !!sub, key: v.publicKey, why: sub ? '' : 'устройство не подписано' });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'тело не JSON' }, 400); }
  const id = sanitizeUserId(body && body.id);
  const action = String((body && body.action) || '').toLowerCase();
  if (!id) return json({ ok: false, error: 'нужен идентификатор устройства' }, 400);
  if (!allow(ipOf(request))) return json({ ok: false, error: 'слишком часто — подождите минуту' }, 429);

  const v = vapidFromEnv(env);
  if (!v.ok) return json({ ok: false, error: v.why, configured: false }, 501);

  if (action === 'subscribe') {
    const sub = parseSubscription(body.subscription);
    if (!sub) return json({ ok: false, error: 'подписка не похожа на настоящую: нужны endpoint https и ключи p256dh/auth' }, 400);
    const saved = await saveSubscription(env, id, sub, request.headers.get('user-agent'));
    if (!saved.ok) return json({ ok: false, error: saved.why }, 503);
    return json({ ok: true, on: true });
  }

  if (action === 'unsubscribe') {
    const gone = await forgetSubscription(env, id);
    return json({ ok: true, on: false, removed: gone });
  }

  if (action === 'test') {
    const sent = await notifyAnswer(env, id, { ok: true, reply: 'Проверка связи: уведомления доходят. Дальше буду молчать, пока вы в чате.', chatId: '' });
    if (!sent.ok) return json({ ok: false, error: sent.why || 'push-сервис отказал', status: sent.status }, 502);
    return json({ ok: true, sent: true });
  }

  if (action === 'notify') {
    /* Вкладка жива, но человек её не видит — сервер об этом не догадается, поэтому
       решает клиент. Пауза та же, что и при досчёте: вернулся и смотришь — не будим. */
    const text = String((body && body.text) || '').slice(0, 400);
    if (body && body.grace !== false) await pause(1200);
    const sent = await notifyAnswer(env, id, { ok: true, reply: text, chatId: body && body.chatId });
    if (!sent.ok) return json({ ok: false, error: sent.why || 'push-сервис отказал', status: sent.status }, 502);
    return json({ ok: true, sent: true });
  }

  return json({ ok: false, error: 'неизвестное действие: ' + (action || '(пусто)') }, 400);
}
