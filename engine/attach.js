/**
 * Вложения из Telegram: фото → зрение, документ → текст, голосовое → расшифровка.
 *
 * До сих пор бот на всё это отвечал заготовками («голос не слушаю», «фото не вижу»),
 * хотя движок умеет и картинки принимать (input.images), и документ читать
 * (engine/docparse.js), и голос расшифровывать (engine/voicein.js). Не хватало
 * одного куска: файлы из Telegram надо скачать. Bot API отдаёт на это два шага —
 * getFile (по file_id → путь) и GET file/bot<токен>/<путь> — и их делает только сам
 * бот своим ключом; новых ключей и хранилищ здесь не появляется.
 *
 * Что важно в этом слое:
 *   • сеть трогается только когда вложение есть и резолвер передан — тесты движка
 *     остаются офлайн (тот же принцип, что у telegramPoster);
 *   • лимиты на входе обязательны: документ в 8 МБ и фото в 5 МБ — потолок, иначе
 *     один присланный файл снимает изолят вместе с распаковкой ZIP;
 *   • в ошибки наружу URL не попадает: он содержит токен бота.
 */

import { parse as parseDoc, describeLine, MAX_BYTES as DOC_MAX } from './docparse.js';

export const MAX_PHOTO = 5 * 1024 * 1024;
export const MAX_AUDIO = 8 * 1024 * 1024;
export const MAX_DOC_BYTES = DOC_MAX;              /* 8 МБ — тот же потолок, что у читалки */
export const DOC_CHARS = 24000;                    /* сколько текста файла показывать модели */
export const MAX_IMAGES = 3;                       /* ровно столько же, сколько принимает чат */

const b64enc = (bytes) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};

/**
 * Что в сообщении есть из вложений. Отдельно от скачивания: это дешёвый разбор,
 * по нему уже понятно, надо ли вообще лезть в сеть.
 */
export function parseMedia(update) {
  const m = update && (update.message || update.edited_message);
  const out = { has: false, photos: [], document: null, audio: null, voice: null, video: null, other: [] };
  if (!m) return out;
  if (Array.isArray(m.photo) && m.photo.length) {
    /* Telegram отдаёт все размеры; берём самый большой, но не больше нашего потолка */
    out.photos = m.photo.slice().sort((a, b) => (b.file_size || 0) - (a.file_size || 0)).map((p) => ({ id: p.file_id, size: p.file_size || 0 }));
  }
  if (m.document) {
    const d = m.document;
    const mime = String(d.mime_type || '');
    const name = String(d.file_name || 'файл');
    /* гифку и картинку в document Telegram носит как файл — читалка документов на
       них справедливо ругается, поэтому картинку отправляем зрению, а не парсеру */
    if (/^image\//.test(mime) || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
      out.photos = out.photos.concat([{ id: d.file_id, size: d.file_size || 0, fromDocument: true, mime }]);
    } else out.document = { id: d.file_id, name, mime, size: d.file_size || 0 };
  }
  if (m.voice) out.voice = { id: m.voice.file_id, seconds: Number(m.voice.duration) || 0, mime: m.voice.mime_type || 'audio/ogg', size: m.voice.file_size || 0 };
  if (m.audio) out.audio = { id: m.audio.file_id, seconds: Number(m.audio.duration) || 0, mime: m.audio.mime_type || 'audio/mpeg', size: m.audio.file_size || 0, name: m.audio.file_name || '' };
  if (m.video || m.video_note) out.video = { id: (m.video || m.video_note).file_id, size: (m.video || m.video_note).file_size || 0 };
  if (m.sticker) out.other.push('стикер');
  if (m.contact) out.other.push('визитку');
  if (m.poll) out.other.push('опрос');
  out.has = !!(out.photos.length || out.document || out.voice || out.audio || out.video || out.other.length);
  return out;
}

const capBytes = (n, max) => (n > max ? Math.round(max / 1024 / 1024 * 10) / 10 + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');

/**
 * Резолвер вложений. o: { env, fetch, log, stt, max } — `stt` создаётся снаружи
 * (engine/voicein.js), чтобы тесты могли подставить поддельную расшифровку.
 */
export function createAttach(o) {
  const opts = o || {};
  const env = opts.env || {};
  const log = opts.log || (() => {});
  const fetchImpl = opts.fetch || ((...a) => fetch(...a));
  const base = String(env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const token = String(env.TELEGRAM_BOT_TOKEN || '');
  const on = String(env.ATTACH || '') !== 'off';
  const stt = opts.stt || null;
  const limits = {
    photo: Math.max(64 * 1024, Number(env.ATTACH_MAX_PHOTO) || MAX_PHOTO),
    audio: Math.max(64 * 1024, Number(env.ATTACH_MAX_AUDIO) || MAX_AUDIO),
    doc: Math.max(64 * 1024, Number(env.ATTACH_MAX_DOC) || MAX_DOC_BYTES),
    chars: Math.max(2000, Number(env.ATTACH_DOC_CHARS) || DOC_CHARS),
  };

  const call = async (method, params) => {
    const qs = Object.entries(params || {}).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const r = await fetchImpl(base + '/bot' + token + '/' + method + (qs ? '?' + qs : ''), { method: 'GET' });
    let j = null;
    try { j = await r.json(); } catch { /* не json */ }
    if (!r.ok || !j || !j.ok) {
      const why = (j && j.description) || ('http ' + r.status);
      throw new Error(String(why).slice(0, 120));
    }
    return j.result;
  };

  /** file_id → байты. Ошибку отдаём строкой БЕЗ url: в нём токен. */
  async function pull(fileId, maxBytes, label) {
    if (!token) return { ok: false, why: 'ключа бота нет — файлы не скачать' };
    let path = '';
    try {
      const info = await call('getFile', { file_id: fileId });
      path = String((info && info.file_path) || '');
    } catch (e) {
      return { ok: false, why: (label || 'файл') + ' не получен: ' + String((e && e.message) || e) };
    }
    if (!path) return { ok: false, why: (label || 'файл') + ': Telegram не вернул путь к файлу' };
    try {
      const r = await fetchImpl(base + '/file/' + path.replace(/^\/+/, ''), { method: 'GET' });
      if (!r.ok) return { ok: false, why: (label || 'файл') + ' не скачался: http ' + r.status };
      const len = Number(r.headers && r.headers.get ? r.headers.get('content-length') : 0) || 0;
      if (len > maxBytes) return { ok: false, why: (label || 'файл') + ' весит ' + capBytes(len, maxBytes) + ' — потолок ' + capBytes(maxBytes, maxBytes) };
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length) return { ok: false, why: (label || 'файл') + ' пустой' };
      if (bytes.length > maxBytes) return { ok: false, why: (label || 'файл') + ' весит ' + capBytes(bytes.length, maxBytes) + ' — больше ' + capBytes(maxBytes, maxBytes) + ' не берём' };
      return { ok: true, bytes, name: (path.split('/').pop() || '').replace(/^[0-9a-f-]{20,}\./i, '') };
    } catch (e) {
      return { ok: false, why: (label || 'файл') + ' не скачался: ' + String((e && e.message) || e).slice(0, 120) };
    }
  }

  /**
   * Собрать всё, что человек приложил.
   * → { images: [dataURL], docs: [{name, ok, text|why, line}], voiceText, notes: [] }
   */
  async function take(media) {
    const out = { images: [], docs: [], voiceText: '', notes: [], tried: 0 };
    if (!on) { out.notes.push('вложения выключены (ATTACH=off)'); return out; }
    if (!media || !media.has) return out;

    for (const p of (media.photos || []).slice(0, MAX_IMAGES)) {
      const got = await pull(p.id, limits.photo, 'фото');
      out.tried++;
      if (!got.ok) { out.notes.push(got.why); continue; }
      const mime = /\.png$/i.test(got.name) ? 'image/png' : /\.webp$/i.test(got.name) ? 'image/webp' : /\.gif$/i.test(got.name) ? 'image/gif' : 'image/jpeg';
      out.images.push('data:' + mime + ';base64,' + b64enc(got.bytes));
    }
    if ((media.photos || []).length > MAX_IMAGES) out.notes.push('фото ' + media.photos.length + ' штук — смотрю первые ' + MAX_IMAGES);

    if (media.document) {
      const d = media.document;
      const got = await pull(d.id, limits.doc, 'файл');
      out.tried++;
      if (!got.ok) { out.docs.push({ name: d.name, ok: false, why: got.why }); }
      else {
        const res = parseDoc(got.bytes, { name: d.name, kind: undefined });
        if (!res.ok) out.docs.push({ name: d.name, ok: false, kind: res.kind, why: res.why });
        else {
          const text = res.text.length > limits.chars ? res.text.slice(0, limits.chars) + '\n…(дальше файл не показываем)' : res.text;
          out.docs.push({ name: d.name, ok: true, kind: res.kind, chars: res.chars, text, line: describeLine(res), meta: res.meta });
        }
      }
    }

    const audio = media.voice || media.audio;
    if (audio) {
      const got = await pull(audio.id, limits.audio, 'запись');
      out.tried++;
      if (!got.ok) out.notes.push(got.why);
      else if (!stt) out.notes.push('распознавание голоса не подключено (слоя STT нет)');
      else {
        try {
          const r = await stt.transcribe({ bytes: got.bytes, mime: audio.mime });
          if (r.ok) out.voiceText = r.text;
          else out.notes.push('запись не расшифрована: ' + (r.why || 'пусто') + (r.via ? ' [' + r.via + ']' : ''));
        } catch (e) {
          out.notes.push('запись не расшифрована: ' + String((e && e.message) || e).slice(0, 120));
        }
      }
    }
    if (media.video) out.notes.push('видео ' + capBytes(media.video.size || 0, limits.doc) + ' я не смотрю — только кадр нельзя вынуть без серверной обработки');
    for (const kind of (media.other || [])) out.notes.push(kind + ' разбираю не умею — опиши словами');
    return out;
  }

  return {
    take,
    pull,
    limits,
    stats: () => ({
      on,
      token: !!token,
      photos: MAX_IMAGES,
      maxBytes: limits,
      docFormats: ['docx', 'xlsx', 'pptx', 'pdf', 'csv', 'md', 'txt', 'json', 'xml', 'html'],
    }),
  };
}

/**
 * Как из вложений и слов собрать то, что уйдёт движку. Чистой функцией — чтобы
 * порядок («сначала голос, потом подпись, блок файла в конце») можно было
 * проверить без сети.
 */
export function compose(media, got, text) {
  const base = String(text || '').trim();
  const parts = [];
  const spoken = got && got.voiceText ? String(got.voiceText).trim() : '';
  /* Голос плюс подпись — это один ход: и то и другое должно дойти до модели.
     Раньше при наличии расшифровки подпись человека терялась. */
  if (spoken) parts.push(base ? '[Голосом: ' + spoken + ']\n' + base : spoken);
  else if (base) parts.push(base);
  else if (got && (got.notes || []).length) parts.push('(ни слов, ни расшифровки — смотри примечание)');

  const blocks = [];
  for (const d of ((got && got.docs) || [])) {
    blocks.push(d.ok
      ? '[Файл: ' + d.name + ' · ' + d.line + ']\n' + d.text
      : '[Файл: ' + d.name + ' — ' + (d.why || 'не прочитан') + ']');
  }
  const notes = ((got && got.notes) || []).map((n) => '· ' + n);
  let out = parts.join('\n\n');
  if (blocks.length) out = (out ? out + '\n\n' : '') + blocks.join('\n\n');
  if (notes.length) out = (out ? out + '\n\n' : '') + notes.join('\n');
  if (!out) out = 'Посмотри, что в вложении, и скажи по делу.';
  const images = (got && got.images) || [];
  return { text: out.slice(0, 120000), images, files: blocks.length, notes };
}
