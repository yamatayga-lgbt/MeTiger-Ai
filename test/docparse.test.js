/**
 * Чтение документов (engine/docparse.js) — docx/xlsx/pptx/pdf/текст и честные отказы.
 *
 * DOCX, XLSX и PDF в тесте — не «наши же файлы», а настоящие архивы, записанные
 * чужим упаковщиком (python zipfile, deflate) и PDF с текстом в cp1251: читалка
 * обязана работать на том, что присылает человек, а не на том, что удобно нам.
 * Запуск: node test/docparse.test.js
 */
import zlib from 'node:zlib';
import { parse, describeLine, blockOf, sniff, stats, MAX_OUT, MAX_BYTES } from '../engine/docparse.js';
import { inflateAuto } from '../engine/inflate.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 180) : '')); }
}

const DOCX = [
  'UEsDBBQAAAAIAIg2Ql3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAiDZC',
  'XQwUyRJnAQAAjwIAABEAAAB3b3JkL2RvY3VtZW50LnhtbHVSTU7CQBjde4pJF+5kiglqkJadJ9ADlHZEknam6VSRHaDRhSaY',
  'aNxyBdCi+EO9wjdX8CR+MwUTBRb9MvPNvPe996a1+nkUkjOWyJbgjlUu2RZh3BdBizcd6+jwYGvPIjL1eOCFgjPH6jBp1d2N',
  'WrsaCP80YjwlyMBlte1YJ2kaVymV/gmLPFkSMeN4diySyEtxmzRpWyRBnAifSYkDopBu2/YOjbwWt1ykbIigY7hjvUt0SV14',
  'gBye8XuCXHUJjFQXJjCDTN2Q78vH3RrVt3RNTI2XGe4WEAT3C5YcxmoAr+oCJqqvempA4As+zPkUG7fkD+0vVblCbNsmm14U',
  '75MKrlQXKcaInMDbSojXoHMVGeSkQtQ1DujpUauFp43Q3C/Qvvvfy9B4yeBTC1+mMB1/DfbehDeCl/U4WoymhZClJIcYXIZJ',
  'aQtTgrmZOLE5m1PiIyYLw++6jzKvVjml8+fWi8Wv5P4AUEsDBBQAAAAIAIg2Ql0Vp0PyjgAAALAAAAARAAAAZG9jUHJvcHMv',
  'Y29yZS54bWxlzr0NwjAQQOFVLA/gIxWS5TgrsAJyTmDJia3zgSgZgZKOFSIEZXY4NuJHgob6fcVz3WFIao9UYx5b3ZiF7rwL',
  'xYZMuKJckDhiVS81VtuHVm+ZiwUoO0om0wb6AJhwwJErNKYB7V0fLEdO6OX0OMpdZrnJpJYOfuFNAuGaM3k5y1UmmZVczId8',
  'g4O/D/8EUEsBAhQDFAAAAAgAiDZCXcccFzwKAAAACAAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQ',
  'SwECFAMUAAAACACINkJdDBTJEmcBAACPAgAAEQAAAAAAAAAAAAAAgAE7AAAAd29yZC9kb2N1bWVudC54bWxQSwECFAMUAAAA',
  'CACINkJdFadD8o4AAACwAAAAEQAAAAAAAAAAAAAAgAHRAQAAZG9jUHJvcHMvY29yZS54bWxQSwUGAAAAAAMAAwC/AAAAjgIA',
  'AAAA',
].join('');
const XLSX = [
  'UEsDBBQAAAAIAIg2Ql3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAiDZC',
  'Xf8DDXaYAAAAtAAAAA8AAAB4bC93b3JrYm9vay54bWw1jrENwjAQRXumsG6AXEJBETlOnTEMPkiU2I58FlCyCStQIETFDGYj',
  'rADd///pS0+2ZzuJIwUevGugKkpolTz5MG69H0WGjhvoY5xrRN71ZDUXfiaXyd4Hq2Ou4YA8B9KGe6JoJ1yX5QatHhwouWys',
  'Vt8gnLbUQLq+L+mV7umWHukJYmGdyQIgQj3kEDpTASqJv7/Ev5T6AFBLAwQUAAAACACINkJduXXIJ7cAAAD0AAAAFAAAAHhs',
  'L3NoYXJlZFN0cmluZ3MueG1sZY+/DoIwEId3n6Lp4EjRGActZfBJGqxCQgv2inE0Dj6FqzuYsGjgGY43siYaEx1u+H3f/cnx',
  '+KBzslcWssJEdBKENBYcwBHPDUQ0da5cMAZJqrSEoCiV8WZTWC2dj3bLoLRKriFVyumcTcNwzrTMDCVJURkX0Rkllcl2lVp9',
  'shhxyAR3YjhhjzeshyNnTnD2om9zxhY7rH85XvzEw9cd+z939abFhoylLpcEG7/4daD7NjL/mXgCUEsDBBQAAAAIAIg2Ql1i',
  'ha55vgAAAIkBAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sdZBNDoIwEIX3nqLpASi0uBtKRG7gCZA0sREhaRtg641c',
  'uDCeAm9kAS3gz6aZvjfzvcxA3J4KVAulZVVGOPB8HHNoKnXUByEMsm6pI9xiDoOQZibjK1BVg5Rtt3LeF5sAIxNhbf8194HU',
  'HEj+8pK5FziPWMZEoo5EZ930g0RHhrde6uk4I8tClmJnlO2SmoPhj3N3727d1b4XIMaO9Pp3OnPpbJbOlilbNqgh/bNC+IYk',
  '4QDZ/16YTHcE4g7Nn1BLAQIUAxQAAAAIAIg2Ql3HHBc8CgAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBl',
  'c10ueG1sUEsBAhQDFAAAAAgAiDZCXf8DDXaYAAAAtAAAAA8AAAAAAAAAAAAAAIABOwAAAHhsL3dvcmtib29rLnhtbFBLAQIU',
  'AxQAAAAIAIg2Ql25dcgntwAAAPQAAAAUAAAAAAAAAAAAAACAAQABAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAI',
  'AIg2Ql1iha55vgAAAIkBAAAYAAAAAAAAAAAAAACAAekBAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAQABAAG',
  'AQAA3QIAAAAA',
].join('');
const PDF = [
  'JVBERi0xLjcKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5',
  'cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu',
  'dCAyIDAgUiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMzkgL0ZpbHRlciAvRmxhdGVE',
  'ZWNvZGUgPj4Kc3RyZWFtCnicXcy9CsIwFIbh3av43BKpNKnSOhfq4Hw2cRMHr9DZGxDvIBQCMdU0OSDd/KHg4vjCy1MT8rWG',
  'LkAHVAUqpUB7iEt0reUMgYcTTyXoCJpBnDlE80biGLxBwuBSF+5YZHo5Pg1N6j+xXI3iVlx7l4KXmOtSQfCrsw93+2ULb3tv',
  'nnIH2nyZD2/BQnUKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXIKPDwgL1Np',
  'emUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMAolJUVPRgo=',
].join('');

const b2u = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const enc = (s) => new TextEncoder().encode(s);
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** свой zip для случаев, которые чужим упаковщиком не сделать (бомба, пустой каталог) */
function zip(files, method = 'deflate') {
  const e = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const nm = e.encode(f.name); const raw = typeof f.data === 'string' ? e.encode(f.data) : f.data;
    const body = method === 'deflate' ? new Uint8Array(zlib.deflateRawSync(Buffer.from(raw))) : raw; const crc = crc32(raw);
    const lh = new Uint8Array(30 + nm.length); const d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(8, method === 'deflate' ? 8 : 0, true); d.setUint32(14, crc, true);
    d.setUint32(18, body.length, true); d.setUint32(22, raw.length, true); d.setUint16(26, nm.length, true); lh.set(nm, 30);
    parts.push(lh, body);
    const ch = new Uint8Array(46 + nm.length); const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(10, method === 'deflate' ? 8 : 0, true); c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); ch.set(nm, 46);
    central.push(ch); off += lh.length + body.length;
  }
  const cat = new Uint8Array(central.reduce((a, x) => a + x.length, 0)); let p = 0;
  for (const x of central) { cat.set(x, p); p += x.length; }
  const eo = new Uint8Array(22); const v = new DataView(eo.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
  v.setUint32(12, cat.length, true); v.setUint32(16, off, true);
  const all = [...parts, cat, eo]; const size = all.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(size); let q = 0; for (const x of all) { out.set(x, q); q += x.length; }
  return out;
}

console.log('F — документы: читаем то, что прислал человек');

{
  const r = parse(b2u(DOCX), { name: 'договор.docx' });
  ok('F1: docx чужой упаковки читается целиком', r.ok && /Договор аренды №7/.test(r.text), r.why || r.kind);
  ok('F2: сущности XML разворачиваются, a "&" не теряется', /15 000 & 500 рублей/.test(r.text), JSON.stringify(r.text).slice(0, 160));
  ok('F3: таблица и отступы остаются структурой (tab, перевод строки)', /\tдо 5 числа/.test(r.text) && /Предмет/.test(r.text) && /Гараж/.test(r.text), JSON.stringify(r.text).slice(-140));
  ok('F4: заголовок и автор из docProps доезжают в meta', r.meta && r.meta.title === 'Аренда 7' && r.meta.author === 'Иван П.', JSON.stringify(r.meta));
  ok('F5: kind и число знаков честные', r.kind === 'docx' && r.chars === r.text.length && r.chars > 60, [r.kind, r.chars].join('/'));
  ok('F6: блок для модели подписан именем файла', /^\[Файл: договор\.docx · docx/.test(blockOf(r)), blockOf(r).split('\n')[0]);
}
{
  const r = parse(b2u(XLSX), { name: 'a.xlsx' });
  ok('F7: xlsx — общие строки подставлены по индексам', r.ok && /товар\tцена/.test(r.text) && /Молоко\t1\.5/.test(r.text), JSON.stringify(r.text || r.why).slice(0, 200));
  ok('F8: пустые ячейки сохраняют колонки (C3 не уезжает в B3)', /Хлеб & батон\t\t42/.test(r.text), JSON.stringify(r.text.split('\n')[2]));
  ok('F9: inlineStr, булево и имя листа учтены', /скидка/.test(r.text) && /ИСТИНА/.test(r.text) && /лист «Продажи»/.test(r.text), r.text.split('\n')[0]);
  ok('F10: describeLine в одну строку — для человека и логов', /xlsx · \d+ симв\. · 1 лист\./.test(describeLine(r)), describeLine(r));
}
{
  const r = parse(b2u(PDF), { name: 'отчёт.pdf' });
  ok('F11: pdf — текст из FlateDecode-потока', r.ok && /отчёт/.test(r.text) && /3,14/.test(r.text), JSON.stringify(r.text || r.why).slice(0, 200));
  ok('F12: кириллица в cp1251 не превращается в «ÃÑÑÂ»', /Привет/.test(r.text) && !/[ÃÑ]{2}/.test(r.text), JSON.stringify(r.text).slice(0, 80));
  ok('F13: массив TJ с разрядкой читается словами, а не слитно', /Список тюлений в кепках/.test(r.text.replace(/\s+/g, ' ')), JSON.stringify(r.text).slice(0, 140));
  ok('F14: число страниц посчитано', r.meta && r.meta.pages === 1, JSON.stringify(r.meta));
  const scan = enc('%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R /XObject << /Im0 3 0 R >> >>\nendobj\n2 0 obj\n<< /Length 34 >>\nstream\nq 595 0 0 842 0 0 cm /Im0 Do Q\nendstream\nendobj\n3 0 obj\n<< /Subtype /Image /Filter /DCTDecode /Length 8 >>\nstream\n........\nendstream\nendobj\n%%EOF');
  const rs = parse(scan, { name: 'скан.pdf' });
  ok('F15: скан без текстового слоя — честное «OCR нам делать нечем»', !rs.ok && /OCR/.test(rs.why), rs.why);
}
{
  const r = parse(enc('\ufeffтовар;цена\nмолоко,1.5\nхлеб,2\n'), { name: 'a.csv' });
  ok('F16: csv — BOM срезан, kind и строки посчитаны', r.ok && r.kind === 'csv' && /^товар;цена/.test(r.text) && r.meta.rows === 3, JSON.stringify({ k: r.kind, m: r.meta }));
  const s16 = 'товар,цена\nмолоко,1.5\n';
  const u16 = new Uint8Array(s16.length * 2);
  for (let i = 0; i < s16.length; i++) { const c = s16.charCodeAt(i); u16[i * 2] = c & 0xff; u16[i * 2 + 1] = c >> 8; }
  const u = parse(u16, { name: 'xls.csv' });
  ok('F17: UTF-16LE без BOM (экселевский csv) угадан, а не выдан за мусор',
    u.ok && /^товар,цена/.test(u.text) && u.text.indexOf('\u0000') < 0, JSON.stringify(u.text));
  const not16 = parse(new TextEncoder().encode('обычная строка в utf-8, ни одного нуля\n'), { name: 'utf8.txt' });
  ok('F17a: обычную utf-8 кириллицу за utf-16 не принимаем', not16.ok && /^обычная строка/.test(not16.text), JSON.stringify(not16.text || not16.why).slice(0, 80));
  const utf16 = (text, little, bom) => {
    const out = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
    let p = 0;
    if (bom) { out[0] = little ? 0xff : 0xfe; out[1] = little ? 0xfe : 0xff; p = 2; }
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      out[p + i * 2] = little ? c & 255 : c >> 8;
      out[p + i * 2 + 1] = little ? c >> 8 : c & 255;
    }
    return out;
  };
  const leBom = parse(utf16('你好, 世界', true, true), { name: 'chinese.txt' });
  ok('F17b: UTF-16LE BOM не декодируется как UTF-8 — китайский текст остаётся точным',
    leBom.ok && leBom.text === '你好, 世界', JSON.stringify(leBom.text || leBom.why));
  const beBom = parse(utf16('Καλημέρα', false, true), { name: 'greek.txt' });
  ok('F17c: UTF-16BE BOM сохраняет греческие буквы и диакритику',
    beBom.ok && beBom.text === 'Καλημέρα', JSON.stringify(beBom.text || beBom.why));
  const greekNoBom = parse(utf16('Καλημέρα', true, false), { name: 'greek.txt' });
  const arabicNoBom = parse(utf16('مرحبا بكم', true, false), { name: 'arabic.txt' });
  ok('F17d: UTF-16 без BOM определяется не только по латинице и кириллице',
    greekNoBom.ok && greekNoBom.text === 'Καλημέρα' && arabicNoBom.ok && arabicNoBom.text === 'مرحبا بكم',
    JSON.stringify([greekNoBom.text || greekNoBom.why, arabicNoBom.text || arabicNoBom.why]));
  const m = parse(enc('# Заголовок\n\nтекст **жирным**\n'), { name: 'заметки.md' });
  ok('F18: markdown читается как есть (разметку режем не мы, а модель)', m.ok && /\*\*жирным\*\*/.test(m.text), m.why || '');
  const h = parse(enc('<html><body><style>p{color:red}</style><p>Привет</p><br><p>Мир</p></body></html>'), { name: 'a.html' });
  ok('F19: html — теги и <style> вычищены, текст цел', h.ok && /Привет/.test(h.text) && !/color:red/.test(h.text) && !/<p>/.test(h.text), JSON.stringify(h.text));
  const j = parse(enc('{"a": 1, "b": "текст"}'), { name: 'a.json' });
  ok('F20: json читается как текст и не считается неизвестным форматом', j.ok && /"b": "текст"/.test(j.text), j.why || j.kind);
}
{
  const zipped = parse(zip([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' }, { name: 'content.xml', data: '<text:p>данные</text:p>' }]), { name: 'без-имени.bin' });
  ok('F21: odt без расширения узнан по файлу mimetype и честно отклонён', !zipped.ok && /OpenDocument/.test(zipped.why), zipped.why);
  const ole = parse(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), { name: 'старый.doc' });
  ok('F22: старый OLE (.doc) — причина и совет, как обойти', !ole.ok && /OLE|сохрани как/.test(ole.why), ole.why);
  const foreign = parse(zip([{ name: 'readme.md', data: 'просто архив' }]), { name: 'архив.zip' });
  ok('F23: обычный архив не притворяется документом', !foreign.ok && /архив/.test(foreign.why), foreign.why);
  const emptyZip = parse(zip([]), { name: 'a.docx' });
  ok('F24: zip без word/document.xml не врёт «прочесть не удалось», а объясняет', !emptyZip.ok && /document\.xml|каталог/.test(emptyZip.why), emptyZip.why);
}
{
  const big = parse(enc('x'.repeat(MAX_OUT + 5000)), { name: 'длинный.txt' });
  ok('F25: длинный текст обрезается по потолку и это помечено', big.ok && big.truncated === true && big.text.endsWith('…') && big.chars <= MAX_OUT + 8, [big.chars, MAX_OUT].join('/'));
  const huge = parse(new Uint8Array(MAX_BYTES + 10), { name: 'гигант.pdf' });
  ok('F26: файл больше потолка не читается вовсе — и это сказано числом', !huge.ok && /8 МБ/.test(huge.why), huge.why);
  const nul = parse(enc(''), { name: 'пусто.txt' });
  ok('F27: пустой файл — отказ словом', !nul.ok && /пустой/.test(nul.why), nul.why);
  const bin = parse(new Uint8Array(Array.from({ length: 4000 }, (_, i) => (i * 37) % 256)), { name: 'мусор.dat' });
  ok('F28: двоичный мусор не притворяется текстом', !bin.ok, JSON.stringify({ ok: bin.ok, kind: bin.kind }).slice(0, 80));
  for (const [label, v] of [['null', null], ['undefined', undefined], ['не base64', '?!'], ['объект', { a: 1 }], ['число', 42], ['пустой массив', new Uint8Array(0)], ['data-URL без тела', 'data:text/plain;base64,']]) {
    const r = parse(v, { name: label });
    ok('F29: непотребный вход (' + label + ') не бросает, а отвечает why', r && r.ok === false && !!r.why, JSON.stringify(r).slice(0, 90));
  }
  const bad = parse(zip([{ name: 'word/document.xml', data: new Uint8Array(6 * 1024 * 1024) }]), { name: 'бомба.docx' });
  ok('F30: распаковка внутри docx ограничена (zip-бомба не роняет разбор)', !bad.ok || bad.chars <= MAX_OUT, JSON.stringify(bad).slice(0, 120));
}
{
  ok('F31: sniff определяет формат по магрии, а не по имени', sniff(b2u(DOCX), 'название.txt') === 'docx' || sniff(b2u(DOCX), 'название.txt') === 'zip', sniff(b2u(DOCX), 'название.txt'));
  ok('F32: pdf узнаётся по байтам %PDF без расширения', sniff(b2u(PDF), '') === 'pdf');
  ok('F33: текст без расширения определяется как текст, а не как «неизвестно»', sniff(enc('привет, это текст'), '') === 'text');
  const st = stats({});
  ok('F34: сводка для диагностики — форматы и лимиты', st.formats.includes('docx') && st.maxBytes === MAX_BYTES && /DEFLATE/.test(st.note), JSON.stringify(st).slice(0, 120));
  ok('F35: describeLine на отказе — тоже человекочитаемая строка', /не прочитан: /.test(describeLine({ ok: false, why: 'нет текста' })), describeLine({ ok: false, why: 'нет текста' }));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
