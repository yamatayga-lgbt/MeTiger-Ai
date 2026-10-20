/**
 * Подписки на уведомления (0.225).
 *
 * Одна запись на человека: `push:sub:<id>` в том же KV, что и память с профилем.
 * Внутри — endpoint push-сервиса и два открытых ключа браузера; ничего секретного,
 * но и ничего лишнего: ни адреса, ни имени устройства.
 *
 * Три правила, которые здесь важнее удобства:
 *
 *   · мёртвая подписка удаляется. Push-сервис отвечает 404/410, когда человек
 *     переустановил приложение или отозвал разрешение; хранить такую запись —
 *     значит вечно слать в пустоту и считать, что уведомления работают;
 *   · у записи есть срок (180 дней). Приложение, которым не пользовались полгода,
 *     не должно получать пуши после возвращения без нового разрешения;
 *   · любая ошибка уведомления не ломает ответ. Человек уже получил текст;
 *     уведомление — удобство, а не условие.
 */
import { kvKey } from './kvkey.js';
import { sendPush } from './webpush.js';

export const PUSH_TTL_SEC = 60 * 60 * 24 * 180;
/** Сколько ждать, прежде чем будить: человек мог вернуться сам, пока ответ досчитывался. */
export const PUSH_GRACE_MS = 2000;

const kvOf = (env) => (env && env.MEMORY && typeof env.MEMORY.put === 'function' ? env.MEMORY : null);

export function pushKeyOf(userId) {
  const uid = String(userId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(uid)) return '';
  return kvKey('push:sub', uid);
}

export async function saveSubscription(env, userId, sub, ua) {
  const kv = kvOf(env);
  const key = pushKeyOf(userId);
  if (!kv) return { ok: false, why: 'хранилища нет' };
  if (!key) return { ok: false, why: 'нет идентификатора устройства' };
  const value = JSON.stringify({
    endpoint: sub.endpoint,
    keys: sub.keys,
    ua: String(ua || '').slice(0, 120),
    at: Date.now(),
  });
  await kv.put(key, value, { expirationTtl: PUSH_TTL_SEC });
  return { ok: true };
}

export async function readSubscription(env, userId) {
  const kv = kvOf(env);
  const key = pushKeyOf(userId);
  if (!kv || !key) return null;
  try {
    const raw = await kv.get(key, 'json');
    if (!raw || !raw.endpoint || !raw.keys) return null;
    return { endpoint: String(raw.endpoint), keys: raw.keys };
  } catch (e) {
    return null;
  }
}

export async function forgetSubscription(env, userId) {
  const kv = kvOf(env);
  const key = pushKeyOf(userId);
  if (!kv || !key) return false;
  try { await kv.delete(key); return true; } catch (e) { return false; }
}

/**
 * Текст уведомления: первая осмысленная строка ответа без разметки.
 *
 * В шторке видно две строки — заголовок и тело. Заголовок говорит, что произошло,
 * тело — что именно готово. Markdown, звёздочки и таблицы в шторке выглядят мусором,
 * поэтому вычищаем, а не показываем как есть.
 */
export function pushText(reply, ok) {
  const raw = String(reply || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return ok === false ? 'Ответ не получился — загляните в чат' : 'Ответ готов';
  const cut = raw.length > 140 ? raw.slice(0, 137).replace(/[\s,.;:—-]+$/, '') + '…' : raw;
  return cut;
}

/** Заголовок один и тот же: человек должен узнавать уведомление, не читая тело. */
export function pushTitle(ok) {
  return ok === false ? 'MeTiger Ai — не получилось' : 'MeTiger Ai — ответ готов';
}

/**
 * Уведомить о готовом ответе.
 *
 * `opts.fetch` — подмена для тестов. Мёртвая подписка (404/410) удаляется сразу:
 * иначе счётчик «уведомления включены» врал бы.
 */
export async function notifyAnswer(env, userId, opts) {
  const o = opts || {};
  const sub = await readSubscription(env, userId);
  if (!sub) return { ok: false, why: 'нет подписки' };
  const payload = {
    title: pushTitle(o.ok),
    body: pushText(o.reply, o.ok),
    chatId: o.chatId ? String(o.chatId).slice(0, 80) : '',
    at: Date.now(),
  };
  let res;
  try {
    res = await sendPush(sub, payload, env, { fetch: o.fetch, urgency: 'normal', ttl: 3600 });
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e).slice(0, 120) };
  }
  if (res && res.gone) await forgetSubscription(env, userId);
  return { ok: !!(res && res.ok), status: res && res.status, gone: !!(res && res.gone) };
}

/** Пауза перед уведомлением: не будить того, кто уже вернулся и читает ответ. */
export function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
