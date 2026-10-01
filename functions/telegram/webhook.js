/**
 * POST /telegram/webhook — Telegram-вебхук бота @Metigerai_bot.
 *
 * Страницы Pages Function: Telegram ходит сюда напрямую, без воркера. Ответ всегда
 * 200 (кроме неверного секрета), иначе Telegram решит, что доставка не удалась, и
 * начнёт слать апдейт заново по несколько раз — а каждый повтор это живой запрос
 * к моделям за квоту.
 *
 * Внутри вызывается ТОТ ЖЕ onRequestPost, что у /api/chat: движок, память, советы
 * голов, карантин провайдеров и лимиты достаются боту без дублирования кода.
 */
import { onRequestPost as chatPost, memoryStore } from '../api/chat.js';
import { handleUpdate, secretOk, telegramPoster } from '../../engine/telegram.js';
import { freedomInfo } from '../../engine/freedom.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/* Внутренний вызов основного входа. Ip-заголовок подставляем «tg:<чат>», чтобы
   ограничитель частоты считал каждый чат отдельно: иначе весь телеграм попадал
   в одну корзину на 12 запросов в минуту и первые же три собеседника
   закрывали бота остальным. */
export function askEngine(context, payload) {
  const request = new Request('https://internal/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': 'tg:' + String(payload.chatId || 'anon'),
    },
    body: JSON.stringify(payload),
  });
  return chatPost({ request, env: context.env, waitUntil: context.waitUntil });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const sec = secretOk(request.headers.get('x-telegram-bot-api-secret-token'), env);
  if (!sec.ok) return new Response(JSON.stringify({ ok: false, error: sec.why }), { status: 403, headers: JSON_HEADERS });

  let update = null;
  try {
    update = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'тело не JSON' }), { status: 400, headers: JSON_HEADERS });
  }

  const post = telegramPoster(env, (u, i) => fetch(u, i));
  const out = await handleUpdate({ update, env, ask: (payload) => askEngine(context, payload), post });
  return new Response(JSON.stringify({ ok: true, ...out }), { status: 200, headers: JSON_HEADERS });
}

/* GET — диагностика без секретов: видно, настроен ли вебхук вообще и есть ли память. */
export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(JSON.stringify({
    ok: true,
    route: '/telegram/webhook',
    secret: env.TELEGRAM_WEBHOOK_SECRET ? 'задан' : '❌ не задан — вебхук не примут',
    token: env.TELEGRAM_BOT_TOKEN ? 'задан' : '❌ не задан',
    username: env.TELEGRAM_BOT_USERNAME || 'Metigerai_bot',
    meta: String(env.TELEGRAM_META || '0') === '1',
    memory: memoryStore(env) ? 'подключена' : 'нет связки MEMORY — бот отвечает без памяти',
    /* Свобода ответа — видно без чтения кода: какой режим и сколько везём. */
    freedom: (() => {
      const f = freedomInfo(env);
      return f.on
        ? f.mode + ' · блоков в данных ' + f.blocks.length + ' · полная пачка ' + f.full + ' симв.'
        : 'off (FREEDOM=0)';
    })(),
    jailbreak: (() => {
      const j = freedomInfo(env).jailbreak || {};
      return j.mode === 'off' ? 'off (JAILBREAK=0)'
        : j.mode + ' · блок ' + j.chars + ' симв. · метка ' + (j.mark ? 'да' : 'нет');
    })(),
  }), { status: 200, headers: JSON_HEADERS });
}
