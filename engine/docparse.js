/**
 * Чтение документов, присланных человеком (docparse).
 *
 * Зачем: файлы прилетают в чат постоянно — «вот договор, посмотри»,
 * «разбери таблицу», «что в пдф». Раньше движок видел только картинки и текст,
 * поэтому на документ отвечал по названию файла — то есть врал. Здесь байты
 * разбираются на текст собственными силами: DOCX/XLSX/PPTX — это ZIP с XML
 * (engine/inflate.js), PDF — потоки с FlateDecode, остальное — текст.
 *
 * Никаких зависимостей и никакого node:zlib: Pages Functions живут без
 * nodejs_compat (тот же мотив, что у engine/filegen.js). Всё на Uint8Array.
 *
 * Честность важнее полноты: если текст вынуть нечем (скан без текстового слоя,
 * шрифт без кодовой таблицы, ODT/RTF, архив неизвестного вида) — в `why`
 * написано, что именно не так, и модель обязана сказать это человеку, а не
 * пересказывать имя файла.
 */

import { inflateAuto, zipEntries, zipRead, zipFind, decodeUtf8 } from './inflate.js';

export const MAX_BYTES = 8 * 1024 * 1024;      /* вход: больше в чате не живёт и не читается */
export const MAX_OUT = 200000;                 /* текста на один ответ (ровно потолок filegen) */
export const ENTRY_LIMIT = 24 * 1024 * 1024;   /* потолок распаковки одной записи — против zip-бомбы */

/* что мы вообще готовы читать как текст: значение — семейство разбора */
const TEXTISH = {
  txt: 'text', text: 'text', md: 'md', markdown: 'md', log: 'log', rtf: 'rtf',
  csv: 'csv', tsv: 'tsv', json: 'json', xml: 'xml', html: 'html', htm: 'html',
  srt: 'srt', vtt: 'vtt', yml: 'yml', yaml: 'yaml', ini: 'ini',
};

/* ============================== утилиты ============================== */

const clean = (s) => String(s == null ? '' : s)
  .replace(/\r\n/g, '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const unesc = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => (Number(n) < 1114112 ? String.fromCodePoint(Number(n)) : m))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

/** UTF-16 без BOM: старшие байты пар часто лежат в узком диапазоне текста. */
function looksUtf16(b, le) {
  const n = Math.min(b.length - (b.length % 2), 400);
  if (n < 8) return false;
  const pairs = Math.floor(n / 2);
  let okN = 0;
  for (let i = 0; i < pairs; i++) {
    const hi = le ? b[i * 2 + 1] : b[i * 2];
    const lo = le ? b[i * 2] : b[i * 2 + 1];
    /* В расширенной версии учитываем все частые BMP-письменности с верхним
       байтом 0x01–0x1F: греческую, арабскую, иврит, индийские и др. */
    if ((hi === 0x00 && lo >= 9) || (hi >= 0x01 && hi <= 0x1f)) okN++;
  }
  return pairs > 0 && okN / pairs >= 0.85;
}
function utf16(b, le) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? (b[i] | (b[i + 1] << 8)) : ((b[i] << 8) | b[i + 1]));
  return s;
}

/** Байты → строка с определением UTF-16 (его любят Word и Excel). */
function toText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes.subarray(2), true);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), false);
  /* UTF-16 без BOM — частый гость в csv и txt из Excel и Notepad. Считать «много
     нулей» наивного мало: у многих письменностей верхний байт ненулевой. Проверяем,
     что старшие байты пар часто попадают в диапазон BMP-текста, а не выглядят как UTF-8. */
  if (looksUtf16(bytes, true)) return utf16(bytes, true);
  if (looksUtf16(bytes, false)) return utf16(bytes, false);
  const raw = decodeUtf8(bytes);
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/** Посбайтовая проекция: только для поиска ключевых слов и индексов. */
/**
 * Посбайтовая проекция файла: ровно один символ на байт, никаких замен.
 * Нужна только чтобы искать ключевые слова и позиции; текст из потока потом
 * декодируется отдельно (там уже важна кодировка).
 * TextDecoder для этого не годится: windows-1252 съедает 0x80–0x9F, а latin1
 * теряет управляющие байты — и те, и другие в PDF встречаются.
 */
function decodeLatin1(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const CH = 8192;
  if (b.length <= CH) return String.fromCharCode.apply(null, b);
  let s = '';
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return s;
}

/** data-URL или base64 → Uint8Array (то, что приходит из веба и из Telegram). */
export function bytesFrom(src) {
  if (src == null) throw new Error('нет данных');
  if (src instanceof Uint8Array) return src;
  if (typeof src === 'string') {
    const b64 = src.replace(/^data:[^,;]*;base64,/i, '').replace(/\s+/g, '');
    if (!b64) throw new Error('данные пустые');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  throw new Error('не понял, что за данные прислали');
}

/* ============================== формат по содержимому ============================== */

export function sniff(bytes, name) {
  const ext = extOf(name);
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  /* старый OLE-контейнер узнаётся по магрии — расширение человек мог любое написать */
  if (bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'ole';
  if (isPdf) return 'pdf';
  /* расширение говорит «odf/ole» — верим ему: внутри zip-архива эти форматы
     не отличить от чужого архива, а причина отказа должна быть точной */
  if (ext === 'doc' || ext === 'ppt' || ext === 'xls') return 'ole';
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') return 'odf';
  if (isZip) {
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
    if (ext === 'pptx') return 'pptx';
    if (ext === 'docx') return 'docx';
    return 'zip';   /* имена записей решат ниже */
  }
  if (TEXTISH[ext]) return ext;
  /* без расширения: пахнет текстом, если управляющих байтов почти нет */
  let ctl = 0;
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b < 9 || (b > 13 && b < 32)) ctl++;
  }
  if (n && ctl / n < 0.02) return 'text';
  return ext || 'неизвестно';
}

/* ============================== OOXML ============================== */

function docx(bytes) {
  const ents = zipEntries(bytes);
  const main = zipFind(ents, 'word/document.xml');
  if (!main) throw new Error('внутри нет word/document.xml — это не Word-документ');
  const xml = toText(zipRead(bytes, main, { maxOut: ENTRY_LIMIT }));
  const text = unesc(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:(br|cr)[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<[^>]+>/g, '')
  );
  const meta = {};
  const core = zipFind(ents, 'docProps/core.xml');
  if (core) {
    const c = toText(zipRead(bytes, core, { maxOut: 1024 * 1024 }));
    const title = /<dc:title[^>]*>([^<]{0,200})</.exec(c);
    const author = /<dc:creator[^>]*>([^<]{0,120})</.exec(c);
    if (title && title[1].trim()) meta.title = title[1].trim();
    if (author && author[1].trim()) meta.author = author[1].trim();
  }
  /* табы и переводы строк внутри абзаца — форматирование документа (таблицы,
     отступы), их схлопывать нельзя; лишние пробелы — можно. */
  const paras = text.split('\n').map((x) => x.replace(/ {2,}/g, ' ').replace(/[\t ]*\n/g, '\n').trim()).filter(Boolean);
  meta.paragraphs = paras.length;
  return { text: paras.join('\n'), kind: 'docx', meta };
}

function pptx(bytes) {
  const ents = zipEntries(bytes);
  const slides = ents.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/slide(\d+)/.exec(a.name)[1]) - Number(/slide(\d+)/.exec(b.name)[1]));
  if (!slides.length) throw new Error('внутри нет слайдов');
  const parts = [];
  for (let i = 0; i < slides.length; i++) {
    const xml = toText(zipRead(bytes, slides[i], { maxOut: ENTRY_LIMIT }));
    const txt = unesc(xml.replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ' '))
      .split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    parts.push('— слайд ' + (i + 1) + ' —\n' + (txt || '(пусто)'));
  }
  return { text: parts.join('\n\n'), kind: 'pptx', meta: { slides: slides.length } };
}

const colIndex = (ref) => {
  const m = /^([A-Z]{1,3})/.exec(String(ref || ''));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function sharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    out.push(clean(unesc(m[1].replace(/<\/t>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n/g, ' ')));
  }
  return out;
}

function sheet(xml, sst) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const t = /t="([^"]+)"/.exec(attrs);
      const type = t ? t[1] : '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
      let val = '';
      if (type === 's' && v) val = sst[Number(v[1])] || '';
      else if (type === 'inlineStr') val = clean(unesc((body.replace(/<[^>]+>/g, ' '))));
      else if (type === 'b' && v) val = v[1].trim() === '1' ? 'ИСТИНА' : 'ЛОЖЬ';
      else if (v) val = unesc(v[1]).trim();
      const idx = ref ? colIndex(ref[1]) : cells.length;
      if (idx < 0) continue;
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    const line = cells.map((x) => String(x).replace(/\s+/g, ' ').trim()).join('\t').replace(/\t+$/, '');
    if (line.trim()) rows.push(line);
    if (rows.length >= 4000) break;
  }
  return rows;
}

function xlsx(bytes) {
  const ents = zipEntries(bytes);
  const wb = zipFind(ents, 'xl/workbook.xml');
  const names = [];
  if (wb) {
    const xml = toText(zipRead(bytes, wb, { maxOut: 4 * 1024 * 1024 }));
    const re = /<sheet[^>]*name="([^"]{1,80})"/g;
    let m;
    while ((m = re.exec(xml))) names.push(unesc(m[1]));
  }
  const sstEnt = zipFind(ents, 'xl/sharedStrings.xml');
  const sst = sstEnt ? sharedStrings(toText(zipRead(bytes, sstEnt, { maxOut: ENTRY_LIMIT }))) : [];
  const sheets = ents.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name))
    .sort((a, b) => Number(/(\d+)(?:\.xml)?$/.exec(a.name)[1] || 0) - Number(/(\d+)(?:\.xml)?$/.exec(b.name)[1] || 0));
  if (!sheets.length) throw new Error('в книге нет ни одного листа');
  const parts = [];
  for (let i = 0; i < sheets.length; i++) {
    const rows = sheet(toText(zipRead(bytes, sheets[i], { maxOut: ENTRY_LIMIT })), sst);
    parts.push('лист «' + (names[i] || sheets[i].name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, '')) + '» (' + rows.length + ' строк)\n' + rows.join('\n'));
  }
  return {
    text: parts.join('\n\n'),
    kind: 'xlsx',
    meta: { sheets: sheets.length, strings: sst.length, names: names.slice(0, 12) },
  };
}

/* ============================== PDF ============================== */

const pdfUnescape = (s) => String(s)
  .replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || ''))
  .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));

function hexBytes(h) {
  const out = new Uint8Array(Math.floor(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16) || 0;
  return out;
}

/**
 * Текст из последовательности содержимого: Tj / TJ / ' / " дают строки,
 * Td TD T* Tj ET двигают каретку. Шрифты с подстановкой (Identity-H) дают
 * мусор — по доле непечатаемых символов это видно, и тогда ответ честный.
 */
/**
 * Текст из последовательности содержимого: `Tj`/`TJ`/`'`/`"` дают строки, `BT ET
 * Td TD T*` — начало и переходы. Числа внутри `TJ`-массива — разрядка в
 * тысячных долях кегля: -160 это пробел между частями, а не склейка букв.
 */
function contentText(s) {
  const bits = [];
  let line = [];
  const flush = () => { if (line.length) { bits.push(line.join('')); line = []; } };
  const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[|\]|BT|ET|T\*|Td|TD|Tj|TJ|'|"|-?\d+(?:\.\d+)?)/g;
  let m;
  let inArr = false;
  while ((m = re.exec(s))) {
    const tok = m[1];
    const c0 = tok[0];
    if (c0 === '(') { line.push(pdfUnescape(tok.slice(1, -1))); continue; }
    if (c0 === '<') {
      try { line.push(decodeUtf8(hexBytes(tok.slice(1, -1).replace(/\s+/g, '')))); } catch { /* битый hex — молча пропускаем токен */ }
      continue;
    }
    if (tok === '[') { inArr = true; continue; }
    if (tok === ']') { inArr = false; flush(); continue; }
    if (inArr && (c0 === '-' || (c0 >= '0' && c0 <= '9'))) {
      if (Number(tok) <= -90) line.push(' ');
      continue;
    }
    if (tok === 'BT') { flush(); continue; }
    if (tok === 'ET' || tok === 'T*' || tok === 'Td' || tok === 'TD') { flush(); bits.push('\n'); continue; }
    if (tok === 'Tj' || tok === 'TJ' || tok === "'" || tok === '"') { flush(); continue; }
  }
  flush();
  return bits.join('\n').replace(/\n{3,}/g, '\n\n');
}

function pdf(bytes) {
  const latin = decodeLatin1(bytes);
  const total = Math.min(bytes.length, MAX_BYTES);
  const out = [];
  let pages = 0;
  const pagesRe = /\/Type\s*\/Page[^sA-Za-z]/g;
  while (pagesRe.exec(latin.slice(0, total))) pages++;

  let p = 0;
  let scanned = 0;
  while (p < total && out.length < 400) {
    const s = latin.indexOf('stream', p);
    if (s < 0) break;
    const before = latin[s - 1];
    if (before && before !== '\n' && before !== '\r' && before !== '>' && before !== ' ') { p = s + 6; continue; }
    let start = s + 6;
    if (latin[start] === '\r') start++;
    if (latin[start] === '\n') start++;
    const e = latin.indexOf('endstream', start);
    if (e < 0) break;
    const dict = latin.slice(Math.max(0, s - 900), s);
    scanned++;
    let data = bytes.subarray(start, e);
    if (/FlateDecode/.test(dict)) {
      try { data = inflateAuto(data, { maxOut: ENTRY_LIMIT }); } catch { p = e + 9; continue; }
    } else if (/\/Encrypt\b|\/Crypt\b/.test(dict)) { p = e + 9; continue; }
    const txt = contentText(streamText(data));
    if (/(BT|Tj|TJ)/.test(txt) || /\)\s*Tj/.test(streamHead(data))) out.push(txt);
    p = e + 9;
  }
  if (!scanned) throw new Error('в файле нет ни одного потока содержимого — пустой или повреждённый PDF');
  const text = clean(out.join('\n'));
  if (!text) {
    const images = /\/Subtype\s*\/Image|\/Image\b|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/JBIG2Decode/.test(latin.slice(0, total));
    throw new Error(images
      ? 'в файле только картинки: текстового слоя нет — распознавание символов (OCR) нам делать нечем'
      : 'текст не извлечён: потоки содержимого не читаются (возможно, файл защищён или шрифт без кодовой таблицы)');
  }
  return { text, kind: 'pdf', meta: { pages: pages || undefined, streams: scanned } };
}

/** Начало потока — чтобы понять, есть ли тут вообще текстовые операторы. */
function streamHead(bytes) {
  return decodeLatin1(bytes.subarray(0, Math.min(400, bytes.length)));
}

/**
 * Текст потока: UTF-16BE (BOM FE FF) → как есть, валидный UTF-8 → как есть,
 * иначе — cp1251 (так до сих пор сохраняют русские PDF в Word 97-2003 и
 * Foxit). Без этой ветки кириллица превращалась в «ÃÑÑÂ».
 */
function streamText(bytes) {
  if (bytes.length > 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  const latin = decodeLatin1(bytes);
  if (!/[\u0080-\u00ff]/.test(latin)) return latin;
  try {
    const u = decodeUtf8(bytes);
    if (!u.includes('\ufffd')) return u;
  } catch { /* не utf-8 — идём в cp1251 */ }
  let s = '';
  for (let i = 0; i < latin.length; i++) {
    const c = latin.charCodeAt(i);
    s += c >= 0x80 && c <= 0xff ? String.fromCharCode(CP1251[c - 0x80]) : latin[i];
  }
  return s;
}

/* верхняя половина windows-1251 (0x80…0xFF). Таблица снята с кодовой страницы,
   а не написана по памяти: на «ё» (0xA8) рукописный вариант давал «Ќ». */
const CP1251 = [
  0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021, 0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
  0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x0098, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
  0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7, 0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
  0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7, 0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F,
  0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042A, 0x042B, 0x042C, 0x042D, 0x042E, 0x042F,
  0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044A, 0x044B, 0x044C, 0x044D, 0x044E, 0x044F,
];

/* ============================== текст, таблицы, разметка ============================== */

function plainText(bytes, kind) {
  let s = toText(bytes);
  if (kind === 'html' || kind === 'htm') {
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|br|li|tr|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    s = unesc(s);
  }
  s = clean(s);
  if (!s) throw new Error('в файле нет текста — только служебные символы');
  const meta = {};
  if (kind === 'csv' || kind === 'tsv' || s.indexOf('\t') >= 0) {
    const sep = kind === 'tsv' || (s.split('\n')[0].indexOf('\t') >= 0 && kind !== 'csv') ? '\t' : ',';
    const rows = s.split('\n').slice(0, 500);
    meta.columns = Math.max(...rows.map((r) => r.split(sep).length));
    meta.rows = s.split('\n').length;
    meta.separator = sep === '\t' ? 'табуляция' : 'запятая';
  }
  return { text: s, kind: kind || 'text', meta };
}

const ODF_WHY = 'OpenDocument (odt/ods) мы не читаем: формат тот же ZIP с XML, но пути внутри другие — скажи, и добавим в следующий раз';

/**
 * Разобрать присланный файл. src — Uint8Array, ArrayBuffer, base64 или data-URL.
 * → { ok, text, kind, chars, truncated, meta } либо { ok:false, why }.
 * Ошибкой наружу не бросаем никогда: вход — файл из чата, а не наш код.
 */
export function parse(src, o) {
  const opts = o || {};
  const name = String(opts.name || '');
  try {
    const bytes = bytesFrom(src);
    if (!bytes.length) return { ok: false, why: 'файл пустой', name };
    if (bytes.length > MAX_BYTES) {
      return { ok: false, name, why: 'файл ' + Math.round(bytes.length / 1024 / 1024 * 10) / 10 + ' МБ — больше ' + Math.round(MAX_BYTES / 1024 / 1024) + ' МБ, читать не будем' };
    }
    let kind = opts.kind && opts.kind !== 'zip' ? opts.kind : '';
    if (!kind) {
      kind = sniff(bytes, name);
      if (kind === 'zip') {
        /* имя врёт или его нет — решает содержимое: document.xml vs worksheet.xml,
           а у OpenDocument внутри лежит файл mimetype с точным типом */
        const ents0 = zipEntries(bytes);
        const mt = zipFind(ents0, 'mimetype');
        if (mt) {
          const type = toText(zipRead(bytes, mt, { maxOut: 4096 })).trim();
          if (/^application\/vnd\.oasis\.opendocument/.test(type)) return { ok: false, name, kind: 'odf', why: ODF_WHY };
        }
        const names = ents0.map((e) => e.name);
        if (names.some((n) => /^word\/document\.xml$/.test(n))) kind = 'docx';
        else if (names.some((n) => /^xl\/workbook\.xml$/.test(n))) kind = 'xlsx';
        else if (names.some((n) => /^ppt\/presentation\.xml$/.test(n))) kind = 'pptx';
        else kind = 'zip';
      }
    }
    let res;
    switch (kind) {
      case 'docx': res = docx(bytes); break;
      case 'xlsx': case 'xlsm': res = xlsx(bytes); break;
      case 'pptx': res = pptx(bytes); break;
      case 'pdf': res = pdf(bytes); break;
      case 'text': case 'txt': case 'csv': case 'tsv': case 'json': case 'xml': case 'html': case 'htm':
      case 'md': case 'markdown': case 'log': case 'srt': case 'vtt': case 'yml': case 'yaml': case 'ini':
      case 'rtf':
        res = plainText(bytes, kind === 'rtf' ? 'text' : kind); break;
      case 'odf':
        return { ok: false, name, kind, why: ODF_WHY };
      case 'ole':
        return { ok: false, name, kind, why: 'старый бинарный формат (.doc/.xls/.ppt, OLE) не читаем — сохрани как .docx/.xlsx или пришли текстом' };
      case 'zip':
        return { ok: false, name, kind, why: 'обычный архив: внутри нет Word/Excel — распаковкой архивов движок не занимается' };
      default:
        return { ok: false, name, kind, why: 'не понял формат' + (name ? ' файла «' + name + '»' : '') + ' — пришли текстом, .md, .csv, .docx, .xlsx или .pdf' };
    }
    let text = clean(res.text);
    const truncated = text.length > MAX_OUT;
    if (truncated) text = text.slice(0, MAX_OUT) + '\n…';
    if (!text) return { ok: false, name, kind: res.kind, why: 'файл читается, но текста в нём нет' };
    return {
      ok: true, text, kind: res.kind, chars: text.length, truncated,
      name: name || undefined, meta: res.meta || {},
    };
  } catch (e) {
    return { ok: false, name: name || undefined, why: 'файл не разобран: ' + String((e && e.message) || e).slice(0, 200) };
  }
}

/** Одна строка для человека и для логов: что прочитали или почему нет. */
export function describeLine(res) {
  if (!res) return 'файла нет';
  if (!res.ok) return 'не прочитан: ' + (res.why || 'неизвестно');
  const bits = [res.kind, (res.chars || 0) + ' симв.'];
  const m = res.meta || {};
  if (m.paragraphs) bits.push(m.paragraphs + ' абз.');
  if (m.sheets) bits.push(m.sheets + ' лист.');
  if (m.slides) bits.push(m.slides + ' слайд.');
  if (m.pages) bits.push('~' + m.pages + ' стр.');
  if (m.columns) bits.push(m.columns + ' кол.');
  if (res.truncated) bits.push('обрезано до ' + MAX_OUT);
  return bits.join(' · ');
}

/** Блок для сообщения модели: данные файла, отделённые от слов человека. */
export function blockOf(res, name) {
  if (!res || !res.ok) return '';
  const head = '[Файл: ' + (name || res.name || 'без имени') + ' · ' + describeLine(res) + ']';
  return head + '\n' + res.text;
}

export function stats(o) {
  const opts = o || {};
  return {
    on: opts.on !== false,
    formats: ['docx', 'xlsx', 'pptx', 'pdf', 'csv', 'tsv', 'md', 'txt', 'json', 'xml', 'html', 'log', 'srt', 'yml'],
    maxBytes: MAX_BYTES,
    maxOut: MAX_OUT,
    note: 'свой DEFLATE: node:zlib в Pages Functions нет',
  };
}
