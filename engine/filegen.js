/**
 * Генерация файлов — перенос mechanism'а донора (yama-ai/filegen.js, 488 строк).
 *
 * Никаких сторонних библиотек: ZIP «stored» (без сжатия) собирается руками, DOCX —
 * минимальный валидный OOXML, XLSX — лист с inlineStr и числами, CSV — UTF-8 BOM и
 * отсечением формул (Excel и «открой в телефоне» должны вести себя предсказуемо).
 * Контент пишет модель (Markdown для docx/md/html, TSV для xlsx/csv) — модуль только
 * упаковывает и ничего не выдумывает.
 *
 * Против донора изменено два места, и оба — из-за среды:
 *   • Buffer заменён на Uint8Array + DataView: Pages Functions работают без nodejs_compat;
 *   • очередь готовых файлов (модульный genQueue) убрана: в Function один модуль живёт
 *     на все запросы сразу, складывать результат в переменную модуля — значит отдавать
 *     чужой файл чужому человеку. Файлы возвращаются вызывающему.
 */

const MAX_CONTENT = 200000;   /* символов контента от модели */
const MAX_BUF = 512 * 1024;   /* готовый файл: b64 ~700 КБ — проходит в ответ и в Telegram */

/* ===================== байты без Buffer (workerd без nodejs_compat) ===================== */

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesOf = (x) => (x instanceof Uint8Array ? x : enc.encode(String(x)));
const catBytes = (parts) => {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
/** Заголовки ZIP: little-endian, ровно то, что делал Buffer.writeUIntNLE. */
function head30() { const a = new Uint8Array(30); return [a, new DataView(a.buffer)]; }
function head46() { const a = new Uint8Array(46); return [a, new DataView(a.buffer)]; }
function head22() { const a = new Uint8Array(22); return [a, new DataView(a.buffer)]; }
const b64s = (bytes) => {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const t = d || new Date();
  const time = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
  const date = (((t.getFullYear() - 1980) & 0x7f) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
  return { time, date };
}

/** files: [{ name, data }] → ZIP (всё uncompressed). */
function zipStore(files) {
  const { time, date } = dosDateTime();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const data = bytesOf(f.data);
    const crc = crc32(data);

    const [lh, lv] = head30();
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            /* version needed */
    lv.setUint16(6, 0x0800, true);        /* flags: UTF-8 имена */
    lv.setUint16(8, 0, true);             /* method: stored */
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameB.length, true);
    lv.setUint16(28, 0, true);
    locals.push(catBytes([lh, nameB, data]));

    const [ch, cv] = head46();
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);            /* version made by */
    cv.setUint16(6, 20, true);            /* version needed */
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    /* 30..42: extraLen=0, commentLen=0, disk=0, intAttr=0 */
    cv.setUint32(38, 0, true);            /* extAttr */
    cv.setUint32(42, offset, true);       /* offset локальной головки */
    central.push(catBytes([ch, nameB]));
    offset += lh.length + nameB.length + data.length;
  }
  const cd = catBytes(central);
  const [eocd, ev] = head22();
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return catBytes([...locals, cd, eocd]);
}

/* ================= Мини-разбор Markdown (то, что пишет модель) ================= */

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Жирные **…*** внутри строки → сегменты [{t, b}]. */
function boldRuns(line) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ t: line.slice(last, m.index), b: false });
    out.push({ t: m[1], b: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ t: line.slice(last), b: false });
  return out.length ? out : [{ t: line, b: false }];
}

/**
 * Markdown → блоки:
 *  {k:'h1'|'h2'|'h3'|'p'|'li'|'ni', text} и {k:'table', rows: [[..]]}.
 * Таблицы: строки «| a | b |», разделитель «|---|---|» пропускаем.
 */
function mdBlocks(md) {
  const blocks = [];
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; /* разделитель таблицы */
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const prev = blocks[blocks.length - 1];
      if (prev && prev.k === 'table') prev.rows.push(cells);
      else blocks.push({ k: 'table', rows: [cells] });
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/);
    if (h) { blocks.push({ k: 'h' + h[1].length, text: h[2] }); continue; }
    const li = line.match(/^\s*[-*•]\s+(.*)$/);
    if (li) { blocks.push({ k: 'li', text: li[1] }); continue; }
    const ni = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ni) { blocks.push({ k: 'ni', n: Number(ni[1]), text: ni[2] }); continue; }
    blocks.push({ k: 'p', text: line });
  }
  return blocks;
}

/* ================= DOCX ================= */

function docxRuns(text) {
  return boldRuns(text).map((r) =>
    `<w:r>${r.b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.t)}</w:t></w:r>`
  ).join('');
}

function docxPara(text, opts) {
  const o = opts || {};
  let pPr = '';
  if (o.style) pPr += `<w:pStyle w:val="${o.style}"/>`;
  if (o.numId) pPr += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.numId}"/></w:numPr>`;
  if (o.spaceBefore) pPr += `<w:spacing w:before="${o.spaceBefore}"/>`;
  return `<w:p>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${docxRuns(text)}</w:p>`;
}

function docxTable(rows) {
  const border = '<w:top w:val="single" w:sz="4" w:color="9AA0A6"/><w:bottom w:val="single" w:sz="4" w:color="9AA0A6"/><w:left w:val="single" w:sz="4" w:color="9AA0A6"/><w:right w:val="single" w:sz="4" w:color="9AA0A6"/>';
  const tr = rows.map((cells, ri) =>
    '<w:tr>' + cells.map((c) =>
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${docxPara(c, ri === 0 ? { bold: true } : {})}</w:tc>`
    ).join('') + '</w:tr>'
  ).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${tr}</w:tbl>`;
}

function makeDocx(md) {
  const blocks = mdBlocks(md);
  let body = '';
  let numId = 0;
  let inNum = false;
  for (const b of blocks) {
    if (b.k === 'h1') { if (inNum) { inNum = false; } body += docxPara(b.text, { style: 'Heading1' }); }
    else if (b.k === 'h2') { if (inNum) { inNum = false; } body += docxPara(b.text, { style: 'Heading2' }); }
    else if (b.k === 'h3') { if (inNum) { inNum = false; } body += docxPara(b.text, { style: 'Heading3' }); }
    else if (b.k === 'li') { if (inNum) inNum = false; body += docxPara('•  ' + b.text, { spaceBefore: 20 }); }
    else if (b.k === 'ni') {
      if (!inNum) { numId++; inNum = true; }
      /* Без numbering.xml нумерацию не завести честно — рендерим «1. » текстом */
      body += docxPara(`${b.n}.  ${b.text}`, { spaceBefore: 20 });
    }
    else if (b.k === 'table') { if (inNum) inNum = false; body += docxTable(b.rows); body += docxPara('', {}); }
    else body += docxPara(b.text, { spaceBefore: 40 });
  }
  body += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + '</w:body></w:document>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
    '</w:styles>';

  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  return zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ]);
}

/* ================= XLSX ================= */

function colName(i) { /* 0 → A, 25 → Z, 26 → AA */
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* Разбирает TSV (табы), CSV (запятые) и Markdown-таблицы («| a | b |») —
   модель любит Markdown, а для xlsx/csv ему проще не объяснить. */
function parseTsv(tsv) {
  return String(tsv || '').replace(/\r\n/g, '\n').split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .map((l) => {
      let cells;
      if (/^\s*\|.*\|\s*$/.test(l)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) return null; /* разделитель таблицы */
        cells = l.trim().replace(/^\||\|$/g, '').split('|');
      } else if (l.includes('\t')) cells = l.split('\t');
      else if (l.includes(',')) cells = l.split(',');
      else cells = [l];
      return cells.map((c) => c.trim());
    })
    .filter((cells) => cells !== null);
}

/** Простые формулы «=A1*B2», «=SUM(D1:D4)» и «=A1+B2» решаем по разобранной
    сетке: файл не должен содержать несчитанные формулы. Нерешаемое — как текст. */
function resolveFormula(formula, grid) {
  const expr = String(formula || '').replace(/^=/, '');
  const sum = expr.match(/^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i);
  if (sum) {
    const c1 = sum[1].toUpperCase(), r1 = Number(sum[2]), c2 = sum[3].toUpperCase(), r2 = Number(sum[4]);
    let total = 0;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let ci = 0; ci < 26; ci++) {
        const col = String.fromCharCode(65 + ci);
        if ((col < c1 || col > c2) && (col < c2 || col > c1)) continue;
        const v = Number((grid[r - 1] || [])[colNameIdx(col)]);
        if (Number.isFinite(v)) total += v;
      }
    }
    return String(total);
  }
  const bin = expr.match(/^([A-Z]+\d+)\s*([+\-*/])\s*([A-Z]+\d+)$/i);
  if (bin) {
    const get = (ref) => {
      const m = ref.toUpperCase().match(/^([A-Z]+)(\d+)$/);
      const v = Number((grid[Number(m[2]) - 1] || [])[colNameIdx(m[1])]);
      return Number.isFinite(v) ? v : NaN;
    };
    const a = get(bin[1]), b = get(bin[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return String(formula);
    const v = bin[2] === '+' ? a + b : bin[2] === '-' ? a - b : bin[2] === '*' ? a * b : (b !== 0 ? a / b : NaN);
    return Number.isFinite(v) ? String(v) : String(formula);
  }
  return String(formula);
}
function colNameIdx(col) { /* 'A' → 0, 'B' → 1 … */
  let n = 0;
  for (const ch of String(col).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function makeXlsx(tsv, sheetName) {
  const rows = parseTsv(tsv);
  if (!rows.length) throw new Error('пустая таблица');
  const maxC = Math.min(12, Math.max(...rows.map((r) => r.length)));
  const grid = rows.map((r) => Array.from({ length: maxC }, (_, ci) => (r[ci] == null ? '' : String(r[ci]))));
  /* Формулы решаем до фикс-точки: SUM может стоять раньше формульных ячеек,
     на которые ссылается, — тогда второй проход её уже считает по числам. */
  let changed = true, guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    for (let ri = 0; ri < grid.length; ri++) {
      for (let ci = 0; ci < grid[ri].length; ci++) {
        const v = grid[ri][ci];
        if (/^=/.test(v)) {
          const resolved = resolveFormula(v, grid);
          if (resolved !== v && !/^=/.test(resolved)) { grid[ri][ci] = resolved; changed = true; }
        }
      }
    }
  }
  const body = grid.map((r, ri) => {
    const cells = [];
    for (let ci = 0; ci < maxC; ci++) {
      const v = r[ci];
      const ref = colName(ci) + (ri + 1);
      if (v !== '' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) cells.push(`<c r="${ref}"><v>${escXml(v)}</v></c>`);
      else if (v !== '') cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`);
    }
    return `<row r="${ri + 1}">${cells.join('')}</row>`;
  }).join('');
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`;
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escXml((sheetName || 'Лист 1').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '</styleSheet>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  return zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: styles },
  ]);
}

/* ================= CSV / TXT / MD / HTML ================= */

/** Экранирование CSV: кавычки, запятая; формулы-вjections режем апострофом. */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function makeCsv(rows) {
  const lines = rows.map((r) => r.map(csvCell).join(','));
  /* BOM руками: без Buffer. */
  return catBytes([new Uint8Array([0xef, 0xbb, 0xbf]), enc.encode(lines.join('\n') + '\n')]);
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function htmlBlocks(md) {
  const blocks = mdBlocks(md);
  return blocks.map((b) => {
    if (b.k === 'h1') return `<h1>${escHtml(b.text)}</h1>`;
    if (b.k === 'h2') return `<h2>${escHtml(b.text)}</h2>`;
    if (b.k === 'h3') return `<h3>${escHtml(b.text)}</h3>`;
    if (b.k === 'li') return `<ul><li>${escHtml(b.text)}</li></ul>`;
    if (b.k === 'ni') return `<p class="ni">${b.n}. ${escHtml(b.text)}</p>`;
    if (b.k === 'table') {
      const [head, ...rest] = b.rows;
      return '<table><thead><tr>' + head.map((c) => `<th>${escHtml(c)}</th>`).join('') +
        '</tr></thead><tbody>' + rest.map((r) => '<tr>' + r.map((c) => `<td>${escHtml(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>';
    }
    const runs = boldRuns(b.text).map((r) => (r.b ? `<strong>${escHtml(r.t)}</strong>` : escHtml(r.t))).join('');
    return `<p>${runs}</p>`;
  }).join('\n');
}

function makeHtml(md, title) {
  const inner = htmlBlocks(md);
  return enc.encode(
    '<!DOCTYPE html>\n<html lang="ru"><head><meta charset="utf-8"/>' +
    `<title>${escHtml(title || 'Документ')}</title>` +
    '<style>' +
    'body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#14161a;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.55}' +
    'h1{font-size:26px;border-bottom:2px solid #e3e6ea;padding-bottom:10px}' +
    'h2{font-size:20px;margin-top:26px}h3{font-size:17px;margin-top:20px}' +
    'table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}' +
    'th,td{border:1px solid #d6dae0;padding:7px 10px;text-align:left}th{background:#f2f4f7}' +
    'p.ni{margin:4px 0 4px 18px}' +
    '@media print{body{margin:0}a{color:inherit}}' +
    '</style></head><body>\n' + inner +
    '\n</body></html>');
}

/* ================= Фасад ================= */

const FMT = {
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv:  { ext: 'csv',  mime: 'text/csv' },
  txt:  { ext: 'txt',  mime: 'text/plain' },
  md:   { ext: 'md',   mime: 'text/markdown' },
  html: { ext: 'html', mime: 'text/html' },
};

/**
 * Сгенерировать файл. opts: { format, name, content }.
 * Возвращает { name, mime, buf, b64, size }. Бросает Error с честной причиной.
 */
function generate(opts) {
  const o = opts || {};
  const fmt = String(o.format || '').toLowerCase().trim();
  const meta = FMT[fmt];
  if (!meta) throw new Error('неизвестный формат: ' + fmt + ' (есть: ' + Object.keys(FMT).join(', ') + ')');
  const content = String(o.content || '');
  if (!content.trim()) throw new Error('пустое содержимое файла');
  if (content.length > MAX_CONTENT) throw new Error('контент длиннее, чем я упаковываю (до ~200 тыс. символов) — попроси короче');

  /* Модель частенько кладёт расширение в имя («Смета.xlsx») — режем, чтобы
     не вышло «Смета.xlsx.xlsx»; чистое имя идёт и в лист xlsx. */
  const rawName = String(o.name || 'файл').trim().replace(/\.(docx|xlsx|csv|txt|md|html?)$/i, '');
  const base = rawName.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 80) || 'файл';

  let buf;
  if (fmt === 'docx') buf = makeDocx(content);
  else if (fmt === 'xlsx') buf = makeXlsx(content, o.sheet || rawName);
  else if (fmt === 'csv') buf = makeCsv(parseTsv(content));
  else if (fmt === 'html') buf = makeHtml(content, rawName);
  else buf = enc.encode(content);

  if (buf.length > MAX_BUF) throw new Error('файл получился больше, чем я отправляю (до 512 КБ) — попроси короче');
  return {
    name: base + '.' + meta.ext,
    mime: meta.mime,
    buf,
    b64: b64s(buf),
    size: buf.length,
  };
}


/* ===================== блоки файла в ответе модели ===================== */

/**
 * Как модель отдаёт файл: fenced-блок с указанием формата и имени.
 * Формат — после «file:», имя — после «|». Оба необязательны: «```file» тоже читается.
 */
export const FILE_BLOCK_RE = /```[ \t]*file(?:[ \t]*:[ \t]*([a-z0-9+]{1,10}))?(?:[ \t]*\|[ \t]*([^\n`]{0,80}))?[ \t]*\r?\n([\s\S]*?)```/gi;

const FORMATS = Object.keys(FMT);

/** Формат по просьбе человека: docx/xlsx/csv/html/md/txt (по умолчанию docx). */
export function formatFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/xlsx|эксель|таблиц[^\s]{0,8}(файлом|в файл)/.test(t) || /\bxls\b/.test(t)) return 'xlsx';
  if (/\bcsv\b|запят[а-яё]*\s+csv/.test(t)) return 'csv';
  if (/html|htm\b|страниц[а-яё]\s+файлом/.test(t)) return 'html';
  if (/\btxt\b|простым\s+текстом|голым\s+текстом|голый\s+текст/.test(t)) return 'txt';
  if (/markdown|\bmd\b/.test(t)) return 'md';
  return 'docx';
}

/** Имя файла по просьбе: «оформи в файл смету на ремонт» → «смета на ремонт». */
export function nameFromText(text) {
  const raw = String(text || '')
    .replace(/^\s*(и|также|ещё|пожалуйста)[,.\s]+/i, '')
    .replace(/оформи|сделай|приложи|отправ|отдай|пришли|скинь|выложи|верни|напиши|файлом|файл|docx|xlsx|csv|html|markdown|\bmd\b|\btxt\b|документ(ом)?|таблиц[а-яё]+|пожалуйста/gi, ' ')
    .replace(/^[^а-яёa-z0-9]+|[^а-яёa-z0-9]+$/gi, '')
    .replace(/^(?:в|на|из|до|для|о|об|как|с)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return raw || 'ответ агента';
}

const cleanRest = (s) => String(s).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Вынуть файлы из ответа. Возвращает { reply, files, notes }.
 *   • блоки изымаются из текста: человеку не нужно читать свой docx в чате;
 *   • если файл просили, а блока нет — упаковываем весь ответ (честь поговорки
 *     «сказал — сделал»), но только когда есть что паковать;
 *   • битый блок не молчит: остаётся причина, а текст ответа не портится.
 */
export function packFiles(answer, o) {
  const opts = o || {};
  const src = String(answer || '');
  const files = [];
  const notes = [];
  let reply = src;
  let last = null;
  FILE_BLOCK_RE.lastIndex = 0;
  const seen = [];
  reply = src.replace(FILE_BLOCK_RE, (all, fmt, name, content) => {
    seen.push(all);
    const format = (String(fmt || opts.format || 'md').toLowerCase().trim());
    if (!FMT[format]) {
      notes.push('формат «' + format + '» не упакован: есть только ' + FORMATS.join(', '));
      return '';
    }
    try {
      const f = generate({ format, name: cleanName(String(name || '').trim() || opts.name || 'файл'), content });
      if (files.length >= 3) { notes.push('больше трёх файлов за ответ не отдаём, остальные приложены текстом'); return all; }
      files.push(f);
      last = f;
      return '';
    } catch (e) {
      notes.push('файл не собран: ' + (e && e.message ? e.message : e));
      return '';
    }
  });
  reply = cleanRest(reply);

  /* Просили файл, блока нет — упаковываем ответ целиком. */
  if (!files.length && opts.wanted && reply.length >= 40) {
    const format = FMT[opts.format] ? opts.format : 'docx';
    try {
      const f = generate({ format, name: cleanName(opts.name || nameFromText(opts.text || '')), content: reply });
      files.push(f); last = f;
    } catch (e) { notes.push('файл не собран: ' + (e && e.message ? e.message : e)); }
  }
  /* Модель решила ограничиться блоком и не сказала ни слова — подтверждаем коротко. */
  if (!reply && last) reply = 'Готово: ' + last.name + ' (' + sizeOf(last.size) + ').';
  if (notes.length) reply = (reply ? reply + '\n\n' : '') + '· ' + notes.join('\n· ');
  return { reply, files, notes };
}

/** Вес файла по-человечески: байты не округляем до «0 КБ». */
function sizeOf(n) {
  return n < 1024 ? n + ' б' : String((n / 1024).toFixed(1)).replace('.', ',') + ' КБ';
}
export { sizeOf };

function cleanName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'файл';
}

export { generate, zipStore, crc32, mdBlocks, makeDocx, makeXlsx, makeCsv, makeHtml, parseTsv, colName, csvCell, boldRuns, htmlBlocks, FMT, bytesOf, catBytes, b64s, dec, enc };
