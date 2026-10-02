/**
 * Raw DEFLATE (RFC 1951) — распаковка без единой зависимости.
 *
 * Зачем свой: Pages Functions работают БЕЗ `nodejs_compat`, поэтому `node:zlib`
 * в рантайме нет (тот же мотив, из-за которого engine/filegen.js пишет ZIP сам и
 * считает CRC вручную). А читать документы всё равно надо: DOCX и XLSX — это ZIP
 * с deflate-потоками, PDF — потоки с FlateDecode. Писать мы их умеем без сжатия,
 * чужие — нет.
 *
 * Поддерживается: блоки stored (0), fixed (1) и dynamic (2), канонические коды
 * Хаффмана, копирование с перекрытием (LZ77), обёртки gzip и zlib (у PDF-потоков
 * встречаются обе). Таблицы строятся как в puff.c: count[length] + symbol[].
 *
 * Защита от zip-бомбы обязательна: потолок maxOut обрывает распаковку ошибкой,
 * а не памятью воркера — иначе присланный в чат файл на 40 КБ укладывает изолят.
 */

const MAX_BITS = 15;
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/* порядок, в котором в dynamic-блоке приходят длины кодов алфавита Хаффмана */
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Каноническое дерево: count[length] + symbol[] (символы в порядке возрастания длины). */
function buildTree(lengths, n) {
  const count = new Int32Array(MAX_BITS + 1);
  const total = n == null ? lengths.length : n;
  for (let i = 0; i < total; i++) {
    const l = lengths[i];
    if (l > MAX_BITS) throw new Error('код Хаффмана длиннее 15 бит');
    if (l) count[l]++;
  }
  const offs = new Int32Array(MAX_BITS + 2);
  let sum = 0;
  for (let b = 1; b <= MAX_BITS; b++) { offs[b] = sum; sum += count[b]; }
  const symbol = new Int32Array(sum);
  const cur = Int32Array.from(offs);
  for (let i = 0; i < total; i++) {
    const l = lengths[i];
    if (l) symbol[cur[l]++] = i;
  }
  return { count, symbol };
}

function Reader(bytes) {
  this.a = bytes;
  this.p = 0;
  this.bpos = 0;
}
Reader.prototype.bit = function () {
  if (this.p >= this.a.length) throw new Error('поток оборвался');
  const b = (this.a[this.p] >>> this.bpos) & 1;
  if (++this.bpos === 8) { this.bpos = 0; this.p++; }
  return b;
};
Reader.prototype.bits = function (n) {
  let v = 0;
  for (let i = 0; i < n; i++) v |= this.bit() << i;
  return v;
};
Reader.prototype.align = function () { if (this.bpos) { this.bpos = 0; this.p++; } };
Reader.prototype.take = function (n) {
  if (this.p + n > this.a.length) throw new Error('поток оборвался');
  const out = this.a.subarray(this.p, this.p + n);
  this.p += n;
  return out;
};
/**
 * Следующий символ по дереву Хаффмана — дословно обход из puff.c: коды текущей
 * длины лежат в диапазоне [first, first+count), поэтому «не дотянули» = идём на
 * длину больше, сдвинув и code, и first. Ошибка в этой формуле (код с +1 вместо
 * сдвига) ломает ровно сжатые данные и оставляет stored — по ней и проверял.
 */
Reader.prototype.code = function (tree) {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= MAX_BITS; len++) {
    code |= this.bit();
    const count = tree.count[len];
    if (code - count < first) return tree.symbol[index + (code < first ? 0 : code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('битый код Хаффмана');
};

let FIXED_LIT = null, FIXED_DIST = null;
function fixedTrees() {
  if (FIXED_LIT) return [FIXED_LIT, FIXED_DIST];
  const lit = new Uint8Array(288);
  for (let i = 0; i < 144; i++) lit[i] = 8;
  for (let i = 144; i < 256; i++) lit[i] = 9;
  for (let i = 256; i < 280; i++) lit[i] = 7;
  for (let i = 280; i < 288; i++) lit[i] = 8;
  const dist = new Uint8Array(30);
  dist.fill(5);
  FIXED_LIT = buildTree(lit);
  FIXED_DIST = buildTree(dist);
  return [FIXED_LIT, FIXED_DIST];
}

function dynamicTrees(r) {
  const nLen = r.bits(5) + 257;
  const nDist = r.bits(5) + 1;
  const nClen = r.bits(4) + 4;
  if (nLen > 288 || nDist > 30) throw new Error('алфавиты в dynamic-блоке больше допустимых');
  const cl = new Uint8Array(19);
  for (let i = 0; i < nClen; i++) cl[CLEN_ORDER[i]] = r.bits(3);
  const clTree = buildTree(cl);
  const lengths = new Uint8Array(nLen + nDist);
  let i = 0;
  while (i < lengths.length) {
    const sym = r.code(clTree);
    if (sym < 16) { lengths[i++] = sym; continue; }
    if (sym === 16) {
      if (!i) throw new Error('повтор длины до первого значения');
      const prev = lengths[i - 1];
      let n = 3 + r.bits(2);
      while (n-- > 0 && i < lengths.length) lengths[i++] = prev;
    } else if (sym === 17) {
      let n = 3 + r.bits(3);
      while (n-- > 0 && i < lengths.length) lengths[i++] = 0;
    } else {
      let n = 11 + r.bits(7);
      while (n-- > 0 && i < lengths.length) lengths[i++] = 0;
    }
  }
  return [buildTree(lengths, nLen), buildTree(lengths.subarray(nLen), nDist)];
}

/** Растущий выход: один массив, чтения на расстояние из него же (LZ77 с перекрытием). */
function Sink(maxOut) {
  this.a = new Uint8Array(4096);
  this.n = 0;
  this.limit = maxOut;
}
Sink.prototype.ensure = function (extra) {
  const need = this.n + extra;
  if (need <= this.a.length) return;
  if (need > this.limit) throw new Error('распакованный файл больше ' + Math.round(this.limit / 1048576) + ' МБ — не распаковываем');
  let cap = this.a.length;
  while (cap < need) cap *= 2;
  if (cap > this.limit) cap = Math.max(need, this.limit);
  const b = new Uint8Array(cap);
  b.set(this.a.subarray(0, this.n));
  this.a = b;
};
Sink.prototype.put = function (byte) { this.ensure(1); this.a[this.n++] = byte; };
/* Чтение для LZ77-копии: ограничение — только сам буфер. Позиции выше this.n
   уже записаны нами (копирование с перекрытием пишет по байту и читает то, что
   только что положил), поэтому отсекать их по this.n нельзя — на этом
   «text» и расходился: длины совпадали, содержимое нет. */
Sink.prototype.at = function (i) { return i < 0 ? 0 : this.a[i]; };
Sink.prototype.view = function () { return this.a.subarray(0, this.n); };

/**
 * Распаковать raw DEFLATE. o: { maxOut } — потолок результата, по умолчанию 24 МБ.
 * Бросает Error с человеческой причиной — что именно побито и почему распаковку дальше вести нельзя.
 */
export function inflate(data, o) {
  const opts = o || {};
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  const maxOut = Math.max(1024, Number(opts.maxOut) || 24 * 1024 * 1024);
  const r = new Reader(bytes);
  const out = new Sink(maxOut);

  for (; ;) {
    const last = r.bit();
    const type = r.bits(2);
    if (type === 0) {
      r.align();
      const len = r.bits(16);
      const nlen = r.bits(16);
      if ((len ^ 0xffff) !== nlen) throw new Error('stored-блок побит: длина не сходится с инверсной');
      const part = r.take(len);
      out.ensure(len);
      out.a.set(part, out.n);
      out.n += len;
    } else if (type === 1 || type === 2) {
      const trees = type === 1 ? fixedTrees() : dynamicTrees(r);
      const litTree = trees[0], distTree = trees[1];
      for (; ;) {
        const sym = r.code(litTree);
        if (sym < 256) out.put(sym);
        else if (sym === 256) break;
        else {
          const s = sym - 257;
          if (s >= LENGTH_BASE.length) throw new Error('недопустимая длина копирования');
          const len = LENGTH_BASE[s] + (LENGTH_EXTRA[s] ? r.bits(LENGTH_EXTRA[s]) : 0);
          const d = r.code(distTree);
          if (d >= DIST_BASE.length) throw new Error('недопустимое расстояние копирования');
          const dist = DIST_BASE[d] + (DIST_EXTRA[d] ? r.bits(DIST_EXTRA[d]) : 0);
          if (dist > out.n) throw new Error('копирование раньше, чем данные получены');
          out.ensure(len);
          for (let i = 0; i < len; i++) out.a[out.n + i] = out.at(out.n - dist + i);
          out.n += len;
        }
      }
    } else throw new Error('неизвестный тип блока DEFLATE');
    if (last) break;
  }
  return out.view();
}

/** Определить обёртку: gzip (1f 8b) и zlib (78 ..) срезаем, raw оставляем как есть. */
export function inflateAuto(data, o) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (b.length > 18 && b[0] === 0x1f && b[1] === 0x8b) {
    let p = 10;
    const flg = b[3];
    if (flg & 4) { const x = b[p] | (b[p + 1] << 8); p += 2 + x; }
    if (flg & 8) { while (p < b.length && b[p] !== 0) p++; p++; }
    if (flg & 16) { while (p < b.length && b[p] !== 0) p++; p++; }
    if (flg & 2) p += 2;
    /* 8 последних байт — CRC32 и размер: они не часть потока */
    return inflate(b.subarray(p, Math.max(p, b.length - 8)), o);
  }
  if (b.length > 2 && b[0] === 0x78) {
    const flg = b[1];
    /* FDICT (5-й бит FLG) — после заголовка лежит 4-байтный словарный id */
    return inflate(b.subarray(flg & 0x20 ? 6 : 2), o);
  }
  return inflate(b, o);
}

/* ============================== ZIP (по центральному каталогу) ============================== */

const le16 = (a, i) => a[i] | (a[i + 1] << 8);
const le32 = (a, i) => ((a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0);

/**
 * Записи ZIP: [{ name, method, compSize, size, offset }].
 * Читаем центральный каталог, а не локальные заголовки: у файлов с data
 * descriptor размеры в локальном заголовке нулевые, и такой docx «не открылся» бы.
 */
export function zipEntries(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  if (a.length < 22) throw new Error('файл короче конца центрального каталога');
  let eocd = -1;
  const stop = Math.max(0, a.length - 66000);
  for (let i = a.length - 22; i >= stop; i--) {
    if (le32(a, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('внутри не ZIP: нет конца центрального каталога');
  const n = le16(a, eocd + 10);
  let p = le32(a, eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (p + 46 > a.length || le32(a, p) !== 0x02014b50) break;
    const nameLen = le16(a, p + 28);
    const extraLen = le16(a, p + 30);
    const cmtLen = le16(a, p + 32);
    const rec = {
      name: decodeUtf8(a.subarray(p + 46, p + 46 + nameLen)),
      method: le16(a, p + 10),
      compSize: le32(a, p + 20),
      size: le32(a, p + 24),
      offset: le32(a, p + 42),
    };
    out.push(rec);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  if (!out.length) throw new Error('каталог внутри архива пуст');
  return out;
}

/** Содержимое записи: stored — как есть, deflate — через inflate(). */
export function zipRead(buf, entry, o) {
  const opts = o || {};
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  if (entry == null) throw new Error('записи нет в архиве');
  const p = entry.offset;
  if (p + 30 > a.length || le32(a, p) !== 0x04034b50) throw new Error('локальный заголовок записи не найден');
  const nameLen = le16(a, p + 26);
  const extraLen = le16(a, p + 28);
  /* размер из локального заголовка надёжнее, когда в каталоге стоит ноль */
  const cSize = le32(a, p + 18) || entry.compSize;
  const start = p + 30 + nameLen + extraLen;
  const end = start + cSize;
  if (end > a.length) throw new Error('данные записи вылезли за конец файла');
  const raw = a.subarray(start, end);
  const method = le16(a, p + 8) || entry.method;
  if (method === 0) return raw;
  if (method === 8) return inflate(raw, { maxOut: opts.maxOut || 32 * 1024 * 1024 });
  throw new Error('метод сжатия ' + method + ' мы не читаем — нужен stored или deflate');
}

/** Запись по точному имени, а не по суффиксу — иначе «sheet1.xml» найдёт чужой лист. */
export function zipFind(entries, name) {
  const want = String(name || '');
  return entries.find((e) => e.name === want) || null;
}

let TD = null;
export function decodeUtf8(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof TextDecoder !== 'undefined') {
    TD = TD || new TextDecoder('utf-8', { fatal: false });
    return TD.decode(b);
  }
  /* узкого пути в нашем рантайме нет, но модуль живёт и в тестах без TextDecoder */
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
