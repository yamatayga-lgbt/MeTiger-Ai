/**
 * Вложения на входе: картинка → зрение, документ → текст, голосовое → расшифровка.
 *
 * Слой один на весь вход сайта: у `functions/api/chat.js` нет своей copies правил,
 * иначе фронту и эндпоинту легко разъезжаться (фото начало работать в веб-чате и
 * ломаться в боте — ровно так, когда правила дублируют).
 *
 * Что важно здесь:
 *   • картинка — это `image/*` по MIME ИЛИ совпавшее расширение имени, ИЛИ сигнатура
 *     байтов: галерея и iPhone отдают пустой тип или `image/heic`, и фильтр по одному
 *     только MIME тихо съедал файл;
 *   • лимиты на входе обязательны: документ в 8 МБ и фото в 5 МБ — потолок, иначе
 *     один присланный файл снимает изолят вместе с распаковкой ZIP;
 *   • любой отказ называется словами. Молча вернуть пустоту — дефект: человек
 *     думает, что картинку не рассмотрели, а её не прочитали.
 */

import { parse as parseDoc, describeLine, MAX_BYTES as DOC_MAX } from './docparse.js';

/** Имя вместо MIME: галерея и iOS частенько отдают `application/octet-stream`. */
export const IMAGE_NAME = /\.(png|jpe?g|jpeg|webp|gif|bmp|avif|heic|heif|tif|tiff|jfif)$/i;

/** Картинка по содержимому. Правило живёт здесь, а не продублировано в веб-слое:
 *  фронт (`src/lib/images.ts`) и эндпоинт обязаны пускать и не пускать одно и то же. */
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
export const MAX_IMAGES = 2;   /* тот же потолок, что у фронта (src/lib/images.ts) и у /api/chat */                       /* ровно столько же, сколько принимает чат */

const capBytes = (n, max) => (n > max ? Math.round(max / 1024 / 1024 * 10) / 10 + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');

/**
 * Байты документа → блок для движка. Одна функция на все каналы (файл из веб):
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
