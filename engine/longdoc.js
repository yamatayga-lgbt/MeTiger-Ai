/**
 * Большие документы: чтение по частям (0.161).
 *
 * Задача, ради которой файл и появился. У DeepSeek реклама строится на одном
 * примере: «загрузите договор на сто страниц и спросите про пункт в середине».
 * У нас документ доезжал до модели обрезанным (ATTACH_DOC_CHARS), а если и
 * проходил целиком — окно бесплатной головы резало его ещё раз. Человек получал
 * ответ по началу файла и не знал об этом.
 *
 * Решение — как читает человек: поделить документ на части, по каждой части
 * выписать то, что относится к вопросу, и отвечать по выпискам. Модель на каждом
 * шаге видит ОДНУ часть и вопрос, поэтому размер окна перестаёт быть потолком
 * для размера файла.
 *
 * Здесь только чистые функции: деление, оценка важности, сборка выписок. Сами
 * вызовы моделей — в engine/chat.js (у него ключи, очередь и бюджет времени), а
 * этот файл обязан оставаться проверяемым без сети.
 */

/** Системная строка для вызова-выписки: одна часть, один вопрос, никакой отсебятины. */
export const MAP_SYSTEM = 'Ты читаешь ОДИН фрагмент большого документа и выписываешь из него только то, '
  + 'что относится к вопросу. Пиши короткими дословными выписками: цифры, даты, суммы, номера пунктов, '
  + 'условия, имена. Ничего не додумывай и не отвечай на вопрос целиком — только выписка. '
  + 'Если во фрагменте нет ничего по вопросу, ответь ровно одним словом: НЕТ';

/** Сколько знаков выписки по одной части доезжает до итогового ответа. */
export const EXTRACT_CHARS = 1400;
/**
 * Нижний порог части. Больше него — уже чтение, меньше — дёрганье модели на каждый
 * абзац: 2 000 знаков ≈ 770 токенов кириллицы, это самый маленький осмысленный
 * кусок. Порог не 4 000, потому что узкие бесплатные головы (окно 8К) с частью в
 * 4 000 знаков оставляют вопросу и выписке чуть больше половины окна.
 */
export const MIN_PART_CHARS = 2000;
/** Потолок частей: больше — это уже «просмотреть», а не «прочитать». */
export const MAX_PARTS = 8;

/** Пустая выписка: модель честно сказала, что по вопросу во фрагменте ничего нет. */
export function isEmptyExtract(s) {
  return /^(нет|no)[.!]?$/i.test(String(s == null ? '' : s).replace(/\s+/g, ' ').trim());
}

const STOP = new Set([
  'какой', 'какая', 'какие', 'какое', 'каком', 'каких', 'сколько', 'почему', 'зачем', 'куда',
  'этот', 'эта', 'это', 'эти', 'если', 'чтобы', 'когда', 'только', 'очень', 'также', 'можно',
  'нужно', 'надо', 'есть', 'было', 'были', 'был', 'была', 'меня', 'мне', 'тебе', 'вами', 'него',
  'неё', 'или', 'для', 'как', 'что', 'чем', 'про', 'его', 'её', 'мной', 'всё', 'все', 'там',
  'that', 'this', 'with', 'from', 'what', 'when', 'have', 'about', 'your',
]);

/** Слова вопроса, по которым ищем нужное в тексте: длинные и с цифрами («п. 7.3»). */
export function terms(ask) {
  const out = [];
  const src = String(ask || '').toLowerCase().replace(/ё/g, 'е');
  for (const raw of src.split(/[^a-zа-я0-9.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, '');
    if (w.length < 4 && !/\d/.test(w)) continue;
    if (STOP.has(w)) continue;
    if (out.indexOf(w) < 0) out.push(w);
    if (out.length >= 24) break;
  }
  return out;
}

/** Насколько часть отвечает на вопрос: число совпадений слов, у длинных слов вес выше. */
export function relevance(part, ask) {
  const ts = Array.isArray(ask) ? ask : terms(ask);
  if (!ts.length) return 0;
  const low = String(part || '').toLowerCase().replace(/ё/g, 'е');
  let score = 0;
  for (const t of ts) {
    let at = low.indexOf(t);
    let n = 0;
    while (at >= 0 && n < 40) { n++; at = low.indexOf(t, at + t.length); }
    if (n) score += n * Math.min(3, t.length / 5);
  }
  return Math.round(score * 10) / 10;
}

/**
 * Деление файла на части. Режем по пустым строкам (границы разделов и абзацев),
 * внутри абзаца — по строкам, в крайнем случае по предложениям: разрезать посреди
 * слова значит потерять его и своё же число прочитать неверно.
 */
export function splitParts(text, size) {
  const src = String(text || '');
  const step = Math.max(MIN_PART_CHARS, Math.floor(Number(size) || MIN_PART_CHARS));
  const out = [];
  if (!src) return out;
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur); cur = ''; };
  /* Абзац: разделитель остаётся в тексте куска — по нему видно, где кончалось. */
  const paras = src.split(/(?<=\n)\s*\n+/);
  for (const p of paras) {
    if (p.length > step) {
      /* Абзац длиннее части: делим по строкам, затем по точкам. */
      push();
      const lines = p.split(/(?<=\n)/);
      for (const ln of lines) {
        if (ln.length > step) {
          push();
          const sents = ln.split(/(?<=[.!?])\s+/);
          for (const s of sents) {
            if (cur.length + s.length > step) push();
            cur += s + ' ';
          }
          push();
          continue;
        }
        if (cur.length + ln.length > step) push();
        cur += ln;
      }
      push();
      continue;
    }
    if (cur.length + p.length > step) push();
    cur += p + '\n\n';
  }
  push();
  return out;
}

/**
 * План чтения: какие части показывать голове и в каком порядке.
 *
 * Частей больше потолка — берём самые близкие к вопросу, но показываем их в
 * порядке файла (модель должна видеть документ, а не подборку). Совпадений нет
 * вовсе — берём равномерно по всему файлу: «ничего не нашли» не повод отвечать
 * по первой странице.
 */
export function plan(text, ask, opts) {
  const o = opts || {};
  const ts = Array.isArray(o.terms) ? o.terms : terms(ask);
  const maxParts = Math.max(1, Math.min(24, Math.floor(Number(o.maxParts) || MAX_PARTS)));
  const all = splitParts(text, o.partChars);
  const scored = all.map((t, i) => ({ i: i + 1, text: t, score: relevance(t, ts) }));
  const total = scored.length;
  if (total <= maxParts) return { parts: scored, total, kept: total, dropped: 0 };
  let keep = scored.slice().sort((a, b) => (b.score - a.score) || (a.i - b.i)).slice(0, maxParts);
  if (!keep.some((p) => p.score > 0)) {
    keep = [];
    const seen = new Set();
    for (let k = 0; k < maxParts; k++) {
      const at = Math.floor((k * (total - 1)) / Math.max(1, maxParts - 1));
      if (seen.has(at)) continue;
      seen.add(at);
      keep.push(scored[at]);
    }
  }
  keep = keep.sort((a, b) => a.i - b.i).map((p, _i) => p);
  return { parts: keep, total, kept: keep.length, dropped: total - keep.length };
}

/** Задание на одну часть: вопрос + фрагмент + требование выписки. */
export function readPrompt(name, ask, part) {
  return 'Документ «' + String(name || 'файл') + '», фрагмент ' + part.i + ' из ' + part.total + '.\n\n'
    + 'Вопрос человека: ' + String(ask || '').trim() + '\n\n'
    + '--- начало фрагмента ---\n' + String(part.text || '') + '\n--- конец фрагмента ---\n\n'
    + 'Выпиши то, что нужно для ответа: цифры, даты, суммы, номера пунктов, условия, имена. '
    + 'Нет ничего по делу — ответь ровно: НЕТ';
}

/**
 * Выбор кусков без модели (модель не ответила или вышел бюджет времени): берём
 * абзацы с наибольшим числом слов вопроса. Это не «прочитал файл», но это честно
 * найденное по вопросу место — лучше, чем совсем без файла.
 */
export function localPick(text, ask, budgetChars) {
  const ts = Array.isArray(ask) ? ask : terms(ask);
  const budget = Math.max(400, Math.floor(Number(budgetChars) || 2400));
  const paras = String(text || '').split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
  const scored = paras.map((t, i) => ({ i, t, score: relevance(t, ts) + (ts.length ? 0 : 1) }));
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  const take = [];
  let used = 0;
  for (const p of scored) {
    if (used >= budget) break;
    if (p.score <= 0 && take.length) continue;      /* нулевые — только когда ничего не нашлось */
    take.push(p);
    used += p.t.length;
  }
  if (!take.length) return String(text || '').slice(0, budget);
  take.sort((a, b) => a.i - b.i);
  const out = [];
  used = 0;
  for (const p of take) {
    const room = budget - used;
    if (room <= 200) break;
    out.push(p.t.length > room ? p.t.slice(0, room) + '…' : p.t);
    used += Math.min(p.t.length, room);
  }
  return out.join('\n…\n');
}

/**
 * Блок выписок для промпта: то, что модель увидит вместо целого файла. В шапке —
 * честно: сколько частей из скольких прочитано, иначе модель думает, что держит
 * документ целиком, и отвечает «в файле этого нет» про непрочитанную часть.
 */
export function blockOf(d) {
  const o = d || {};
  const reads = (o.reads || []).filter((r) => r && String(r.text || '').trim());
  const total = Math.max(1, Number(o.total) || reads.length || 1);
  const kept = reads.length;
  const head = '[Файл: ' + String(o.name || 'файл')
    + (o.line ? ' · ' + o.line : '')
    + (total > 1 ? ', прочитан по частям: ' + kept + ' из ' + total : '')
    + ']';
  const body = reads.map((r) => '— фрагмент ' + r.i + ' из ' + total + ' —\n'
    + String(r.text).trim().slice(0, EXTRACT_CHARS)).join('\n');
  const tail = (o.dropped > 0)
    ? '\nВ выписки не попали части, где ничего не нашлось по вопросу (' + o.dropped + ' шт.) — '
      + 'если ответа в выписках нет, так и скажи, не выдумывай.'
    : '';
  return '\n\n' + head + '\n' + (body || '(выписок нет)') + tail;
}

/** Строка для списка прочитанного под ответом («Explored reads»): без отчётного шума. */
export function lineOf(d) {
  const o = d || {};
  const total = Math.max(1, Number(o.total) || 1);
  if (total <= 1) return String(o.line || '');
  return String(o.line || '') + (o.line ? ' · ' : '') + 'прочитан по частям (' + (Number(o.kept) || 0) + ' из ' + total + ')';
}
