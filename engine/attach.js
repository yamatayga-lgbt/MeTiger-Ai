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

/** Имя вместо MIME: галерея и Telegram частенько отдают `application/octet-stream`. */
export const IMAGE_NAME = /\.(png|jpe?g|jpeg|webp|gif|bmp|avif|heic|heif|tif|tiff|jfif)$/i;

/** Картинка по содержимому. Правило живёт здесь, а не продублировано в веб-слое:
 *  два пути (Telegram и /api/chat) обязаны пускать и не пускать одно и то же. */
export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return '';
  const at = (i) => bytes[i];
  const tag = (o) => String.fromCharCode(at(o), at(o + 1), at(o + 2), at(o + 3));
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'image/webp';
  if (tag(0) === 'GIF8') return 'image/gif';
  if (at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp';   /* 'BM' — два байта, не четыре */
  if (tag(0) === 'II\u002a\u0000' || tag(0) === 'MM\u0000\u002a') return 'image/tiff';
  if (tag(4) === 'ftyp' && /heic|heix|mif1|hevx|heim/.test(tag(8) + String.fromCharCode(at(12), at(13), at(14), at(15)))) return 'image/heic';
  if (tag(4) === 'ftyp' && /^avif|^avis/.test(tag(8))) return 'image/avif';   /* ISO-BMFF: бренд в байтах 8..11 */
  return '';
}

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
    if (/^image\//.test(mime) || IMAGE_NAME.test(name)) {
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
 * Байты документа → блок для движка. Одна функция на оба канала (Telegram и веб):
 * лимит, пометка об обрезке и описание строкой обязаны совпадать, иначе человек
 * получает разный текст за один и тот же файл в зависимости от того, откуда он
 * его прислал. o: { chars } — потолок знаков (env ATTACH_DOC_CHARS).
 */
export function readDocBytes(bytes, name, o) {
  const opts = o || {};
  const chars = Math.max(2000, Number(opts.chars) || DOC_CHARS);
  const res = parseDoc(bytes, { name: String(name || 'файл'), kind: undefined });
  if (!res.ok) return { name: String(name || 'файл'), ok: false, kind: res.kind, why: res.why };
  const text = res.text.length > chars ? res.text.slice(0, chars) + '\n…(дальше файл не показываем)' : res.text;
  return { name: String(name || 'файл'), ok: true, kind: res.kind, chars: res.chars, bytes: bytes ? bytes.length : 0, text, line: describeLine(res), meta: res.meta };
}

/**
 * Байты записи → текст. `stt` отсутствует или отказал — причина строкой: и в боте,
 * и в вебе человек должен читать одно и то же.
 */
export async function readVoiceBytes(bytes, mime, o) {
  const opts = o || {};
  const stt = opts.stt || null;
  const log = opts.log || (() => {});
  if (!bytes || !bytes.length) return { ok: false, why: 'запись пустая' };
  if (!stt) return { ok: false, why: 'распознавание голоса не подключено (слоя STT нет)' };
  try {
    const r = await stt.transcribe({ bytes, mime });
    if (r && r.ok) return { ok: true, text: r.text, via: r.via };
    return { ok: false, why: (r && r.why) || 'пусто', via: r && r.via };
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 120);
    log('stt', 'boom', why);
    return { ok: false, why };
  }
}

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
      /* Формат — по первым байтам, а не по имени: Telegram подписывает скачанный файл как
             photos/file_12.jpg независимо от того, что внутри, и прежняя разметка «иначе
             jpeg» отправляла HEIC под ярлыком image/jpeg. Модель отвечала «картинки не
             вижу», и по логу было не понять, кто сломался. */
      const mime = sniffImageMime(got.bytes)
        || (/\.png$/i.test(got.name) ? 'image/png' : /\.webp$/i.test(got.name) ? 'image/webp' : /\.gif$/i.test(got.name) ? 'image/gif' : (p.mime || 'image/jpeg'));
      if (/^image\/(heic|heif|tiff?|avif)$/i.test(mime)) {
        out.notes.push('формат ' + mime.slice(6).toUpperCase() + ' модель не читает — пришлите JPEG или PNG');
        continue;
      }
      out.images.push('data:' + mime + ';base64,' + b64enc(got.bytes));
    }
    if ((media.photos || []).length > MAX_IMAGES) out.notes.push('фото ' + media.photos.length + ' штук — смотрю первые ' + MAX_IMAGES);

    if (media.document) {
      const d = media.document;
      const got = await pull(d.id, limits.doc, 'файл');
      out.tried++;
      if (!got.ok) { out.docs.push({ name: d.name, ok: false, why: got.why }); }
      else out.docs.push(readDocBytes(got.bytes, d.name, { chars: limits.chars }));
    }

    const audio = media.voice || media.audio;
    if (audio) {
      const got = await pull(audio.id, limits.audio, 'запись');
      out.tried++;
      if (!got.ok) out.notes.push(got.why);
      else {
        const v = await readVoiceBytes(got.bytes, audio.mime, { stt, log });
        if (v.ok) out.voiceText = v.text;
        else if (/слоя STT нет/.test(v.why)) out.notes.push(v.why);
        else out.notes.push('запись не расшифрована: ' + v.why + (v.via ? ' [' + v.via + ']' : ''));
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
