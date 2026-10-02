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
import { normalize as normalizeGender, label as genderLabel } from './gender.js';
import { parseMedia, compose as composeAttach } from './attach.js';

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
    /* что именно приложено — см. engine/attach.js: фото идут в зрение, документы
       читаются, голосовое расшифровывается. Пустой объект значит «ничего». */
    media: parseMedia(update),
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
export function commandReply(parsed, env, prefs) {
  const t = String(parsed.text || '').trim();
  if (t[0] !== '/') return null;
  const head = t.slice(1).split(/[\s@]/)[0].toLowerCase();
  if (head === 'start') {
    return 'Привет. Я MeTiger — отвечаю по делу и помню, о чём мы говорили.\n\n'
      + '/id — с identifier этой беседы (память привязана к нему)\n'
      + '/forget — я забываю этот чат целиком\n'
      + '/род — как мне о себе писать: авто · м · ж\n'
      + '/help — что я умею и чего не умею';
  }
  if (head === 'help') {
    return 'Пиши как в обычном чате: спрашиваю — отвечаю, считаю — считаю.\n\n'
      + 'Настройки: /род — как мне о себе писать (авто · м · ж), /forget — забыть чат, /id — ключ памяти.\n'
      + 'Что умею: помнить разговор, уточнять цифры по внешним данным, сверять спорное несколькими моделями.\n'
      + 'Чего пока не умею: слушать голосовые и смотреть фотографии — для этого я ещё не подключён.\n'
      + 'В группах молчу, пока не позовёшь: @' + String((env && env.TELEGRAM_BOT_USERNAME) || 'Metigerai_bot').replace(/^@/, '') + ' или ответом на моё сообщение.';
  }
  if (head === 'id') {
    return 'chat id: ' + (parsed.chat && parsed.chat.id != null ? parsed.chat.id : '?')
      + '\nключ памяти: ' + memoryChatId(parsed.chat);
  }
  if (head === 'род' || head === 'gender') {
    const arg = t.split(/\s+/).slice(1).join(' ').trim();
    const key = memoryChatId(parsed.chat);
    if (!arg) {
      const cur = prefs && prefs.get ? prefs.get(key) : '';
      return 'Род агента: ' + genderLabel(cur) + '.\n'
        + '/род авто · /род м · /род ж\n'
        + 'В боте выбор живёт, пока тёплый воркер; постоянно — Настройки → Ассистент в приложении.';
    }
    const val = normalizeGender(arg);
    if (prefs && prefs.set) prefs.set(key, val);
    return 'Ок. Род агента: ' + genderLabel(val)
      + (val === 'auto' ? ' — сам определю по разговору.' : ' — так и буду писать о себе.');
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
  /* prefs — хранилище настройки «род агента» для этого чата (get/set). В воркере это Map,
     живущий, пока тёплый изолятор: постоянной настройку делает приложение. */
  const prefs = (opts || {}).prefs || null;
  const update = (opts.update && typeof opts.update === 'object') ? opts.update : {};
  const env = opts.env || {};
  const ask = opts.ask;
  const post = opts.post || (async () => ({ ok: true }));
  /* лог — необязательный: в тестах и в чужом хосте его нет, и молчание в логе
     не имеет права ронять обработку апдейта */
  const log = opts.log || (() => {});
  const username = env.TELEGRAM_BOT_USERNAME || 'Metigerai_bot';
  const parsed = parseUpdate(update);
  const res = { status: 200, answered: false, chunks: 0, ignored: '', sent: [], files: [] };
  if (parsed.kind !== 'message') {
    res.ignored = parsed.kind === 'edited' ? 'правку сообщения не переигрываем' : 'не сообщение';
    return res;
  }
  if (!shouldRespond(parsed, username)) {
    res.ignored = 'группа, обращения не было';
    return res;
  }

  const cmd = commandReply(parsed, env, prefs);
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
  } else if (parsed.media && parsed.media.has && opts.attach) {
    /* Есть вложение и есть чем его достать → тащим. Резолвер (opts.attach) даёт
       webhook: он один знает про токен и про то, что сеть может не ответить. */
    let got = null;
    try { got = await opts.attach(parsed.media); } catch (e) {
      res.attachError = String((e && e.message) || e).slice(0, 140);
      log('attach', 'fail', res.attachError);
      /* Молча ответить на подпись, не зная о потерянном файле, — значит выдать
         уверенный ответ про то, чего не читали. Причина идёт в текст хода. */
      got = { images: [], docs: [], voiceText: '', tried: 0, notes: ['вложение получить не вышло: ' + res.attachError] };
    }
    const made = composeAttach(parsed.media, got, parsed.text);
    const nothing = !got || (!got.images.length && !got.docs.some((d) => d.ok) && !got.voiceText);
    if (nothing && !parsed.text) {
      /* ни слов, ни добытого текста — спрашивать модель не о чем, и человек
         получает причину, а не тишину */
      const text = (made.notes.length ? made.notes.join('\n') : 'Вложение разобрать не вышло.') + '\nПереспроси текстом — я не потеряю нитку.';
      const parts = chunkText(text);
      for (const c of parts) { await post('sendMessage', { chat_id: parsed.chat.id, text: c }); res.sent.push(c); res.chunks++; }
      res.answered = true; res.ignored = 'вложение не разобрано';
      return res;
    }
    payload.text = made.text;
    if (made.images.length) payload.images = made.images;
    if (made.files) res.docs = made.files;
    if (got && got.voiceText) res.voice = true;
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
    if (prefs && prefs.get) {
      const g = normalizeGender(prefs.get(chatId));
      if (g !== 'auto') payload.gender = g;
    }
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

  /* Файлы, которые модель оформила блоком (engine/filegen.js), уезжают следом за
     текстом: человек в Telegram не увидит data-ссылку, им нужен настоящий документ.
     Не больше трёх — столько же отдаёт и веб-чат, чтобы каналы не расходились. */
  const files = Array.isArray(json && json.files) ? json.files.slice(0, 3) : [];
  for (const f of files) {
    const name = String((f && f.name) || 'файл').slice(0, 100);
    const mime = String(f && f.mime || 'application/octet-stream');
    /* Картинку отдаём картинкой: sendPhoto ставит её в ленту просматриваемой,
       sendDocument — это вечно «скачай и открой». Документом идёт всё остальное. */
    const isImg = (f && f.kind === 'image') || /^image\//.test(mime);
    try {
      const bytes = fromB64(String((f && f.b64) || ''));
      if (!bytes.length) throw new Error('пустой файл');
      await post(isImg ? 'sendPhoto' : 'sendDocument', {
        chat_id: parsed.chat.id,
        caption: name + ' · ' + sizeLine(Number(f.size) || bytes.length) + '\n' + (meta ? meta.replace(/^· /, '') : ''),
      }, { filename: name, type: mime, bytes, field: isImg ? 'photo' : 'document' });
      res.files.push(name);
      if (isImg) res.photos = (res.photos || 0) + 1;
    } catch (e) {
      const text = (isImg ? 'Картинку «' : 'Файл «') + name + '» отправить не вышло: ' + String((e && e.message) || e) + '. Текст ответа выше — он полный.';
      await post('sendMessage', { chat_id: parsed.chat.id, text });
      res.sent.push(text); res.chunks++;
      res.fileError = String((e && e.message) || e);
    }
  }
  return res;
}

/** base64 → байты (atob есть и в workerd, и в node 18+). */
export function fromB64(s) {
  const bin = atob(String(s || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sizeLine(n) {
  return n < 1024 ? n + ' б' : String((n / 1024).toFixed(1)).replace('.', ',') + ' КБ';
}

/** Реальная отправка в Bot API. Отдельно и тупо — чтобы подмена в тестах была тривиальной. */
export function telegramPoster(env, fetchImpl) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '');
  const base = String(env.TELEGRAM_API_BASE || 'https://api.telegram.org');
  return async function post(method, payload, file) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан');
    const doFetch = fetchImpl || ((u, i) => fetch(u, i));
    /* Документ уходит multipart-ом: Bot API принимает файл только так, JSON-ом
       можно передать лишь ссылку, а ссылаться не на что — хранилища под выдачу нет. */
    if (file && file.bytes && file.bytes.length) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload || {})) if (v != null && v !== '') fd.append(k, String(v));
      fd.append('disable_notification', 'true');
      fd.append(file.field || 'document', new Blob([file.bytes], { type: file.type || 'application/octet-stream' }), file.filename || 'файл');
      const r = await doFetch(base + '/bot' + token + '/' + method, { method: 'POST', body: fd });
      return { status: r.status, body: await r.text().catch(() => '') };
    }
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
