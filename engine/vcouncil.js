/**
 * 👁 Совет зрячих голов (порт с Этапа 2 из Yama AI 1.0.228).
 *
 * Одна зрячая голова на фактологическом вопросе к картинке — рулетка: «сколько
 * объектов», «что там написано», «какой номер» модель берёт из одного взгляда и
 * уверенно ошибается. Бесплатные VL ошибаются так же часто, как платные, — но НЕ ТЕМИ
 * ЖЕ ошибками. Поэтому здесь не «ищем модель умнее», а складываем независимые взгляды
 * и берём то, на чём сошлись: этим приёмом и обходят сильную одиночную голову на её
 * же поле (в частности — «бесплатного лидера» с 1M контекста).
 *
 * Работает только там, где у ответа есть правильная сторона: число, слово с картинки,
 * цвет, номер. На «опиши настроение» голосование запрещено — там большинство значит
 * усреднение, а не истину.
 *
 * Арбитраж исполнением тут не подменишь (картинку в песочнице не пересчитать), поэтому
 * второй проход — сверка: голове показывают САМ вопрос и ДВА разошедшихся ответа, и она
 * выбирает, а не сочиняет. Не выбрала — человек видит оба варианта, а не один наугад.
 */

import { answerKey, tally } from './ensemble.js';

export function cfgOf(env) {
  const e = env || {};
  return {
    on: e.VCOUNCIL !== '0',
    k: Math.max(2, Math.min(4, Number(e.VCOUNCIL_K) || 3)),
    ms: Math.max(8000, Number(e.VCOUNCIL_MS) || 30000),
  };
}

/* ---- ключ ответа именно для зрения ----
   Тот, что в ансамбле, сравнивает ЦИФРЫ и СЛОВА раздельно: для арифметики так и надо,
   но «три машины» и «3» на картинке — один и тот же факт, и без сведения к числу
   большинство рассыпалось бы на синтаксисе. Род/число прилагательных тоже не важны. */
const WORD_NUM = {
  'ноль': 0, 'ноля': 0, 'нула': 0, 'один': 1, 'одна': 1, 'одно': 1, 'одни': 1, 'два': 2, 'две': 2, 'три': 3,
  'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
  'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15, 'дюжина': 12,
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
  'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
};
/* Десятки складываются со следующим за ними числом: «двадцать один» = 21, иначе
   «21» и «двадцать один» поссорились бы на пустом месте. */
const TENS = {
  'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50, 'шестьдесят': 60, 'семьдесят': 70,
  'восемьдесят': 80, 'девяносто': 90, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
  'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
};
const WORD_ALL = Object.assign({}, TENS, WORD_NUM);
const TENS_UNITS_RE = new RegExp('(^|\\s)(' + Object.keys(TENS).join('|') + ')\\s+(один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять)(?![а-яёa-z0-9])', 'gi');
const NUMWORD_RE = new RegExp('(^|[^а-яёa-z])(' + Object.keys(WORD_ALL).sort((a, b) => b.length - a.length).join('|') + ')(?![а-яёa-z0-9])', 'gi');

/* Признание «не разглядел» — тоже голос, и он должен считаться: два честных «не вижу»
   сильнее одной уверенной догадки. Догадка на фактологическом вопросе — это ровно то,
   за что ругают и платные модели (у DeepSeek V4 Pro на AA-Omniscience ~94% ответов
   «из головы»); ловить это надо слоем, а не надеждой на модель. */
const ABSTAIN = /(не (?:разглядел|разгляжу|видно|видать|читается|читаемо|удается|удаётся|получается|разобрал|разобрать|знаю точно|могу (?:разглядеть|прочитать|сказать точно|определить))|нечитаем\w*|не разбер\w*|размыт\w*|плохо (?:видно|различимо|различается|читается|разборчиво)|текст не (?:читается|разборчив|виден)|слиш\w*ком|на фото(?:е)? (?:этого )?нет|изображение не (?:содержит|позволяет)|cannot (?:see|read|tell|determine|make out)|not (?:visible|readable|legible|determinable)|illegible|unclear|can'?t tell)/i;

export function vkey(text) {
  const raw = String(text || '');
  if (ABSTAIN.test(raw)) return 'w:не_разглядел';
  const line = answerKey(text);
  if (!line) return '';
  if (line.slice(0, 2) === 'n:') return line;
  const words = raw.toLowerCase().replace(/[^а-яёa-z0-9\s]/gi, ' ');
  const spelled = words
    .replace(TENS_UNITS_RE, (m, pre, tens, unit) => pre + (TENS[tens.toLowerCase()] + (WORD_NUM[unit.toLowerCase()] || 0)) + ' ')
    .replace(NUMWORD_RE, (m, pre, w) => pre + WORD_ALL[w] + ' ');
  const num = spelled.match(/(?:^|\s)(\d{1,9})(?![.,\d])/);
  if (num) return 'n:' + num[1];
  const w = words.split(/\s+/).filter((x) => x.length > 2)[0] || '';
  return w ? 'w:' + w.slice(0, 5) : '';
}

/* Вопросы, у которых есть верный ответ — по ним и голосуем. */
export const FACTOID = /(сколько (?:там|на фото|на картинке|на снимке|объект|человек|людей|машин|надпис|строк|символ|пункт|ошибок|размеров)|посчитай|пересчитай|что (?:на )?(?:фото|картинке|изображении|экране|снимке)? ?(?:написано|написан|указано|вижу|видно|изображено)|что написано|надпис[ьи]?|какой (?:цвет|номер|адрес|текст|год|размер|status|статус)|написано (?:ли|там|на)|распознай|прочесть|снимок экрана|скриншот|таблиц|график|число на|цифры на|выведи текст|список на фото|что в поле|какое значение|ошибк[аи] в (?:код[еу]|тексте))/i;

export function shouldCouncil(goal, images, env) {
  if (!cfgOf(env).on) return false;
  if (!images || !images.length) return false;
  return FACTOID.test(String(goal || ''));
}

/** Второй проход: не сочинять, а выбирать между двумя уже написанными ответами. */
export function judgePrompt(goal, a, b) {
  return 'Вопрос к изображению: ' + String(goal || '').slice(0, 1500) + '\n\n'
    + 'Два наблюдателя ответили по-разному:\n'
    + 'A) ' + String(a || '').slice(0, 600) + '\n'
    + 'B) ' + String(b || '').slice(0, 600) + '\n\n'
    + 'Посмотри на изображение ещё раз и выбери, какой ответ верный. '
    + 'Формат: одна строка «A», «B» или «ни один», затем короткое обоснование и правильный ответ.';
}

async function firstPass({ goal, images, ask, k, onEvent }) {
  const n = Math.max(1, k);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(Promise.resolve()
      .then(() => ask(i, { images, goal }))
      .then((r) => (r && r.reply ? { reply: String(r.reply), provider: r.provider || ('head' + i), key: vkey(r.reply) } : null))
      .catch(() => null));
  }
  const cands = (await Promise.all(jobs)).filter(Boolean);
  if (onEvent) { try { onEvent({ type: 'observe', name: 'vcouncil', text: 'зрячих голов: ' + cands.length + ' из ' + n }); } catch (e) {} }
  return cands;
}

/**
 * Врата. `answer` — то, что уже выдал основной обход: он участвует в голосовании
 * на равных, иначе «большинство» было бы мнением двух проверяющих без автора.
 * null — совет не нужен; { status:'skip', why } — нужен, но нечем (словами, не молча).
 */
export async function gate({ goal, images, answer, ask, judge, env, onEvent }) {
  const c = cfgOf(env);
  if (!shouldCouncil(goal, images, env)) return null;
  if (typeof ask !== 'function') return { answer, changed: false, status: 'skip', why: 'нет голов для совета' };

  const first = await firstPass({ goal, images, ask, k: c.k - 1, onEvent });
  const votes = [{ reply: String(answer || ''), provider: 'author', key: vkey(answer) }].concat(first);
  if (!first.length) return { answer, changed: false, status: 'skip', why: 'зрячие головы не ответили' };
  const t = tally(votes);
  if (!t.total) return { answer, changed: false, status: 'skip', why: 'отвечать было нечем' };

  if (t.agreed) {
    const won = t.winner.reply === String(answer || '');
    if (onEvent) { try { onEvent({ type: 'observe', name: 'vcouncil', text: won ? 'головы сошлись на моём ответе' : 'большинство видит другое — беру их ответ' }); } catch (e) {} }
    return { answer: t.winner.reply, changed: !won, status: won ? 'confirmed' : 'overruled', votes: t.votes, total: t.total };
  }

  const by = {};
  votes.forEach((v) => { by[v.key] = v; });
  const authorKey = vkey(answer);
  const alt = (t.votes || []).map((v) => v.key).filter((k) => k !== authorKey);
  /* Единственное мнение за «большинство» не выдаём, и совет на пустом месте не
     выдумываем: если альтернативы нет — суда не было. */
  if (!alt.length) return { answer, changed: false, status: 'skip', why: 'мнение осталось единственным', votes: t.votes, total: t.total };
  /* A — моё, B — самый поддержанный альтернативный вариант. Порядок фиксирован,
     иначе «B» у судьи означало бы «что попало из списка». */
  const keys = [authorKey].concat(alt.slice(0, 1));
  const a = (by[keys[0]] || {}).reply || String(answer || '');
  const b = (by[keys[1]] || {}).reply;
  let verdict = null;
  if (judge && a && b) { try { verdict = await judge(judgePrompt(goal, a, b)); } catch (e) { verdict = null; } }
  if (verdict && verdict.reply) {
    const pick = /^\s*B\b/i.test(verdict.reply) ? b : /^\s*A\b/i.test(verdict.reply) ? a : null;
    if (pick) {
      if (onEvent) { try { onEvent({ type: 'observe', name: 'vcouncil', text: 'головы разошлись — рассудил проверяющий' }); } catch (e) {} }
      return { answer: pick, changed: pick !== String(answer || ''), status: 'judged', votes: t.votes, total: t.total };
    }
  }

  /* Честный провал: не гадаем. Человек видит оба варианта. */
  if (onEvent) { try { onEvent({ type: 'observe', name: 'vcouncil', text: 'головы разошлись — говорю оба варианта' }); } catch (e) {} }
  const shown = keys.map((k, i) => (i === 0 ? 'А' : 'Б') + ') ' + String((by[k] || {}).reply || '').replace(/\s+/g, ' ').slice(0, 200)).join('\n');
  return {
    answer: String(answer || '') + '\n\n👁 Взгляды на картинку разошлись:\n' + shown
      + '\nВторой взгляд по этому же вопросу не рассудил — не выдаю догадку за факт.',
    changed: true, status: 'split', votes: t.votes, total: t.total,
  };
}

/** Строка для API: тот же принцип, что у ансамбля — молчание должно быть объяснено. */
export function visionLine(t) {
  if (!t) return '';
  if (t.status === 'skipped') return 'пропущено: ' + (t.why || '');
  return t.status + ' ' + (t.votes && t.votes[0] ? String(t.votes[0]).split(':')[0] : 0)
    + '/' + (t.total || 0) + (t.heads && t.heads.length ? ' (' + t.heads.join(',') + ')' : '');
}
