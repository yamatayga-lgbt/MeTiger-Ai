/**
 * Telegram-сторона бота: разбор апдейта, правила «отвечать или молчать», разбивка
 * ответа и отправка. Чистая логика, без Pages и без сети: и «мозг» (ask), и транспорт
 * (post) приходят параметрами — поэтому тесты гоняют поведение целиком, не поднимая
 * ни Telegram, ни провайдеров.
 *
 * Почему это не отдельный движок: ответы бота и ответы веб-чата обязаны совпадать.
 * Поэтому ask() в проде вызывает тот же onRequestPost из functions/api/chat.js —
 * память, советы голов, карантин и лимиты достаются боту бесплатно, и расхождение
 * между «в браузере» и «в телеграме» невозможно по устройству.
 */

/* Предел Bot API — 4096 символов; 3900 — с запасом на то, что Telegram считает
   символы не так, как JS (суррогатные пары), и на служебную строку внизу. */
export const TG_LIMIT = 3900;

const GROUPS = ['group', 'supergroup'];

/** Кто говорит и куда отвечать. Память привязана к беседе, а не к человеку:
 *  в группе общий контекст, и это правильно — там разговор один на всех. */
export function memoryChatId(chat) {
  const id = chat && chat.id != null ? String(chat.id) : 'anon';
  return ('tg_' + id).slice(0, 80);
}

/** Что из апдейта важнее всего: текст, карточки команд, упоминания, реплай. */
export function parseUpdate(update) {
  const m = update && (update.message || update.edited_message);
  const out = {
    kind: update && update.edited_message ? 'edited' : m ? 'message' : update && update.callback_query ? 'callback' : 'other',
    chat: m ? m.chat : null,
    from: m ? m.from : null,
    text: m && typeof m.text === 'string' ? m.text : (m && typeof m.caption === 'string' ? m.caption : ''),
    entities: (m && Array.isArray(m.entities)) ? m.entities : [],
    replyTo: (m && m.reply_to_message) || null,
    hasVoice: !!(m && m.voice),
    hasPhoto: !!(m && Array.isArray(m.photo) && m.photo.length),
    message_id: m ? m.message_id : null,
  };
  out.isGroup = !!(out.chat && GROUPS.indexOf(out.chat.type) >= 0);
  out.isPrivate = !!(out.chat && out.chat.type === 'private');
  out.mentioned = false;
  out.repliedToBot = !!(out.replyTo && out.replyTo.from && out.replyTo.from.is_bot);
  return out;
}

/** Упоминание бота: либо сущность mention, либо текст с @username. */
export function hasMention(parsed, username) {
  const u = String(username || '').replace(/^@/, '').toLowerCase();
  if (!u) return false;
  if (parsed.entities.some((e) => e.type === 'mention' && String(e.text || '').toLowerCase().includes(u))) return true;
  return new RegExp('@' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9_])', 'i').test(parsed.text || '');
}

/** Отвечать ли на это сообщение. В группе — только по обращению, иначе бот
 *  превращается в участника каждой беседы и жжёт квоту бесплатных моделей. */
export function shouldRespond(parsed, username) {
  if (parsed.kind !== 'message') return false;
  if (parsed.isPrivate) return true;
  if (!parsed.isGroup) return false;
  if (parsed.repliedToBot) return true;
  return hasMention(parsed, username);
}

/** Команды. Возвращает текст ответа или null — значит это не команда. */
export function commandReply(parsed, env) {
  const t = String(parsed.text || '').trim();
  if (t[0] !== '/') return null;
  const head = t.slice(1).split(/[\s@]/)[0].toLowerCase();
  if (head === 'start') {
    return 'Привет. Я MeTiger — отвечаю по делу и помню, о чём мы говорили.\n\n'
      + '/id — с identifier этой беседы (память привязана к нему)\n'
      + '/forget — я забываю этот чат целиком\n'
      + '/help — что я умею и чего не умею';
  }
  if (head === 'help') {
    return 'Пиши как в обычном чате: спрашиваю — отвечаю, считаю — считаю.\n\n'
      + 'Что умею: помнить разговор, уточнять цифры по внешним данным, сверять спорное несколькими моделями.\n'
      + 'Чего пока не умею: слушать голосовые и смотреть фотографии — для этого я ещё не подключён.\n'
      + 'В группах молчу, пока не позовёшь: @' + String((env && env.TELEGRAM_BOT_USERNAME) || 'Metigerai_bot').replace(/^@/, '') + ' или ответом на моё сообщение.';
  }
  if (head === 'id') {
    return 'chat id: ' + (parsed.chat && parsed.chat.id != null ? parsed.chat.id : '?')
      + '\nключ памяти: ' + memoryChatId(parsed.chat);
  }
  if (head === 'forget') return '__forget__';
  return null;
}

/* Telegram режет строку по байтам-символам, и разрез посреди эмодзи даёт битую
   пару суррогатов. Режем по границам абзацев, а если абзац длиннее лимита —
   по пробелу, и только потом уже по кодовой точке. */
export function chunkText(text, limit) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  if (!src.trim()) return [];
  const cap = Math.max(200, Number(limit) || TG_LIMIT);
  const out = [];
  let buf = '';
  const push = (s) => { const v = s.trim(); if (v) out.push(v); };
  for (const para of src.split(/\n{2,}/)) {
    let piece = para;
    while (piece.length > cap) {
      let cut = piece.lastIndexOf(' ', cap);
      if (cut < cap * 0.4) cut = piece.indexOf(' ', cap);
      if (cut < 0 || cut > cap) cut = safeCut(piece, cap);
      push(buf + piece.slice(0, cut));
      buf = '';
      piece = piece.slice(cut).replace(/^[ \t]+/, '');
    }
    const joined = buf ? buf + '\n\n' + piece : piece;
    if (joined.length > cap) { push(buf); buf = piece; } else buf = joined;
  }
  push(buf);
  return out;
}

/* Граница, не разрушающая суррогатную пару. */
export function safeCut(s, n) {
  let i = Math.min(n, s.length);
  const code = s.charCodeAt(i - 1);
  if (code >= 0xd800 && code <= 0xdbff) i -= 1;
  return i;
}

/**
 * Служебная строка «кто ответил». По умолчанию выключена: человеку в Telegram
 * она мешает, а владельцу нужна — включается TELEGRAM_META=1.
 */
export function metaLine(json) {
  const bits = [];
  if (json && json.provider) bits.push(json.provider + '/' + json.model);
  if (json && json.ensemble) bits.push(json.ensemble);
  if (json && json.ms != null) bits.push(Math.round(json.ms / 100) / 10 + ' с');
  if (json && json.memory && json.memory.on && json.memory.messages) {
    bits.push('память: ' + json.memory.messages + ' репл. / ' + (json.memory.facts || 0) + ' факт.');
  }
  return bits.length ? '· ' + bits.join(' · ') : '';
}

/**
 * Главный вход. ask(payload) → Response-подобный объект {status, json()};
 * post(method, payload) → отправка в Telegram.
 */
export async function handleUpdate(opts) {
  const update = (opts.update && typeof opts.update === 'object') ? opts.update : {};
  const env = opts.env || {};
  const ask = opts.ask;
  const post = opts.post || (async () => ({ ok: true }));
  const username = env.TELEGRAM_BOT_USERNAME || 'Metigerai_bot';
  const parsed = parseUpdate(update);
  const res = { status: 200, answered: false, chunks: 0, ignored: '', sent: [] };
  if (parsed.kind !== 'message') {
    res.ignored = parsed.kind === 'edited' ? 'правку сообщения не переигрываем' : 'не сообщение';
    return res;
  }
  if (!shouldRespond(parsed, username)) {
    res.ignored = 'группа, обращения не было';
    return res;
  }

  const cmd = commandReply(parsed, env);
  const chatId = memoryChatId(parsed.chat);
  if (cmd && cmd !== '__forget__') {
    const parts = chunkText(cmd);
    for (const p of parts) { await post('sendMessage', { chat_id: parsed.chat.id, text: p }); res.sent.push(p); res.chunks++; }
    res.answered = true;
    return res;
  }
  if (env.TELEGRAM_TYPING !== '0' && parsed.chat && parsed.chat.id != null) {
    try { await post('sendChatAction', { chat_id: parsed.chat.id, action: 'typing' }); } catch (e) { /* украшение, не суть */ }
  }

  const payload = { chatId };
  if (cmd === '__forget__') {
    /* Текст при забвении обязателен: вход /api/chat отсекает пустой запрос раньше,
       чем доходит до ветки forget, и команда «забудь» тихо превращалась в 400
       с несёркнутой памятью. До моделей при этом не доходит — forget возвращается
       до createEngine, квота не горит. */
    payload.text = '/forget';
    payload.forget = true;
  } else if (parsed.hasVoice) {
    res.ignored = 'голос пока не слушаю';
    const text = 'Голосовые пока не слушаю — перепиши текстом, я не потеряю нитку разговора.';
    await post('sendMessage', { chat_id: parsed.chat.id, text });
    res.sent.push(text); res.chunks++; res.answered = true;
    return res;
  } else if (parsed.hasPhoto && !parsed.text) {
    res.ignored = 'фото пока не смотрю';
    const text = 'Фотографии в боте я пока не вижу — эта часть движка к Telegram ещё не подключена. Опиши словами или кинь то же в веб-чат.';
    await post('sendMessage', { chat_id: parsed.chat.id, text });
    res.sent.push(text); res.chunks++; res.answered = true;
    return res;
  } else {
    payload.text = parsed.text;
  }

  let json = null;
  try {
    const r = await ask(payload);
    json = r && typeof r.json === 'function' ? await r.json() : r;
  } catch (e) {
    json = { ok: false, error: 'внутри движка что-то упало: ' + String((e && e.message) || e) };
  }
  const body = (json && (json.reply || json.error)) ? (json.reply || json.error)
    : 'Модели сейчас молчат (' + ((json && json.tried && json.tried.length) || 0) + ' попыток). Ни одна не ответила — попробуй через минуту.';
  const meta = String(env.TELEGRAM_META || '0') === '1' ? metaLine(json) : '';
  const full = meta ? body + '\n\n' + meta : body;
  for (const p of chunkText(full)) {
    await post('sendMessage', { chat_id: parsed.chat.id, text: p, reply_to_message_id: parsed.message_id });
    res.sent.push(p); res.chunks++;
  }
  res.answered = true;
  res.meta = meta;
  res.forget = cmd === '__forget__';
  return res;
}

/** Реальная отправка в Bot API. Отдельно и тупо — чтобы подмена в тестах была тривиальной. */
export function telegramPoster(env, fetchImpl) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '');
  const base = String(env.TELEGRAM_API_BASE || 'https://api.telegram.org');
  return async function post(method, payload) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан');
    const doFetch = fetchImpl || ((u, i) => fetch(u, i));
    const r = await doFetch(base + '/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  };
}

/** Проверка секрета вебхука. Без неё любой, кто знает URL, заставит бота
 *  отвечать от имени владельца и сливать квоту бесплатных моделей. */
export function secretOk(header, env) {
  const want = String(env.TELEGRAM_WEBHOOK_SECRET || '');
  if (!want) return { ok: false, why: 'секрет вебхука не настроен (TELEGRAM_WEBHOOK_SECRET)' };
  if (String(header || '') !== want) return { ok: false, why: 'секрет не совпал' };
  return { ok: true };
}
