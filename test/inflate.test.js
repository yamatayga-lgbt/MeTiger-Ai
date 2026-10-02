/**
 * DEFLATE и ZIP (engine/inflate.js) — паритет с node:zlib и чтение реальных архивов.
 * Проверка «своё ↔ чужое»: если наш распаковщик расходится с zlib хотя бы на байт,
 * документ будет прочитан неправильно, и это надо увидеть здесь, а не в чате.
 * Запуск: node test/inflate.test.js
 */
import assert from 'node:assert';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { inflate, inflateAuto, zipEntries, zipRead, zipFind, decodeUtf8 } from '../engine/inflate.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Мини-архиватор для фикстур: stored и deflate, как пишут реальные редакторы. */
function makeZip(files, method) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const body = method === 'deflate' ? new Uint8Array(zlib.deflateRawSync(Buffer.from(raw))) : raw;
    const crc = crc32(raw);
    const lh = new Uint8Array(30 + name.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, method === 'deflate' ? 8 : 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, body.length, true); dv.setUint32(22, raw.length, true);
    dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    chunks.push(lh, body);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, method === 'deflate' ? 8 : 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, off, true);
    ch.set(name, 46);
    central.push(ch);
    off += lh.length + body.length;
  }
  const cat = new Uint8Array(central.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of central) { cat.set(c, p); p += c.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cat.length, true); ev.setUint32(16, off, true);
  return new Uint8Array([...chunks.flat(), ...central, eocd].reduce((acc, part) => { const o = new Uint8Array(acc.length + part.length); o.set(acc); o.set(part, acc.length); return o; }, new Uint8Array(0)));
}

console.log('Z — распаковка: паритет с node:zlib и чтение ZIP');

const bodies = {
  'текст с кириллицей': Buffer.from('кот '.repeat(20000)),
  'двоичные данные': new Uint8Array(crypto.randomBytes(150000)),
  'нуля (максимальное сжатие)': new Uint8Array(400000),
  'повторы': Buffer.from('aaaaab'.repeat(9000)),
  'один байт': Buffer.from('a'),
  'двухбайтный пробег': Buffer.from('аб'.repeat(3)),
};
for (const [label, v] of Object.entries(bodies)) {
  for (const lvl of [1, 6, 9]) {
    const raw = zlib.deflateRawSync(Buffer.from(v), { level: lvl });
    try {
      const got = Buffer.from(inflate(new Uint8Array(raw)));
      ok('паритет: ' + label + ' (level ' + lvl + ')', got.equals(Buffer.from(v)), got.length + ' vs ' + v.length);
    } catch (e) { ok('паритет: ' + label + ' (level ' + lvl + ')', false, e.message); }
  }
}

const s50 = 'данные данные данные'.repeat(50);
ok('обёртка gzip снимается сама', Buffer.from(inflateAuto(new Uint8Array(zlib.gzipSync(s50)))).toString() === s50);
ok('обёртка zlib снимается сама', Buffer.from(inflateAuto(new Uint8Array(zlib.deflateSync('abc'.repeat(1000))))).toString() === 'abc'.repeat(1000));
ok('gzip с флагами имени и комментария читается', (() => {
  const g = zlib.gzipSync(Buffer.from('тело'), { name: 'x.txt', comment: 'примечание' });
  return Buffer.from(inflateAuto(new Uint8Array(g))).toString() === 'тело';
})());

const zip = makeZip([
  { name: 'word/document.xml', data: '<?xml version="1.0"?><w:document>' + 'договор '.repeat(3000) + '</w:document>' },
  { name: 'word/styles.xml', data: '<styles/>' + 'x'.repeat(5000) },
], 'deflate');
const ents = zipEntries(zip);
ok('центральный каталог прочитан', ents.length === 2 && ents[0].name === 'word/document.xml', JSON.stringify(ents.map((e) => e.name)));
const back = decodeUtf8(zipRead(zip, ents[0], { maxOut: 8 * 1024 * 1024 }));
ok('deflate-запись = оригинал целиком (начало, середина, конец)', back.startsWith('<?xml') && back.includes('договор договор') && back.endsWith('</w:document>'), back.length);
ok('stored-запись читается без распаковки', (() => {
  const z = makeZip([{ name: 'a.txt', data: 'привол' }], 'stored');
  return decodeUtf8(zipRead(z, zipEntries(z)[0])) === 'привол';
})());
ok('zipFind ищет по точному имени, а не по подстроке', zipFind(ents, 'word/styles.xml') !== null && zipFind(ents, 'styles.xml') === null);

const bomb = makeZip([{ name: 'big.bin', data: new Uint8Array(30 * 1024 * 1024) }], 'deflate');
let bombWhy = '';
try { zipRead(bomb, zipEntries(bomb)[0], { maxOut: 2 * 1024 * 1024 }); } catch (e) { bombWhy = e.message; }
ok('zip-бомба останавливается лимитом, а не памятью воркера', /МБ/.test(bombWhy), bombWhy);

ok('битый поток — ошибка словами, а не молчание', (() => {
  try { inflate(new Uint8Array([0x00, 0x01, 0x02])); return false; } catch (e) { return /поток оборвался|Хаффман|типа блока|не сходится/.test(e.message); }
})());
ok('stored-блок с побитой длиной отклонён', (() => {
  try { inflate(new Uint8Array([0x01, 0x00, 0x05, 0x00, 0x00, 0x00, 1, 2])); return false; } catch (e) { return /длина не сходится/.test(e.message); }
})());
ok('decodeUtf8 справляется с UTF-8 и не падает на мусоре', decodeUtf8(new Uint8Array([0xd0, 0xba])) === 'к' && typeof decodeUtf8(new Uint8Array([0xff, 0xfe, 0x00])) === 'string');
ok('пустые и мусорные входы не бросают наружу', (() => {
  try { zipEntries(new Uint8Array(4)); return false; } catch (e) { return /короче/.test(e.message); }
})());

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
void assert;
