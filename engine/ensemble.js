/**
 * 🗳 Ансамбль голов для задач с проверяемым ответом (порт с Этапа 2 из Yama AI 1.0.227).
 *
 * Смысл ровно один: у одной головы ошибка системная (недочитал условие, перепутал
 * знак), а у трёх независимых она должна СОВПАСТЬ, чтобы стать ответом. Разные
 * провайдеры = разные веса = разные типовые ошибки, поэтому большинство по задаче
 * с одним верным числом поднимает точность измеримо, а не «по ощущению».
 *
 * Куда это совать НЕЛЬЗЯ: болтовня, творчество, откровенные сцены — там «большинство»
 * означает усреднение голоса, а усреднение стиля нам не нужно. Поэтому вход открыт
 * только задачам с верным ответом, и решение принимается по факту сходимости.
 *
 * Отличие от Yama (важное, оно выросло из жалобы владельца на 1.0.227):
 *   в Yama при расхождении голосов брался текст головы-победителя — и человек
 *   терял манеру речи агента ради чужого «11». Здесь по умолчанию режим `verify`:
 *   если большинство согласно с основным ответом — остаётся ТЕКСТ основного ответа
 *   (он и есть голос автора), меняется только то, что действительно разошлось.
 *   Режим `majority` возвращает прежнее поведение, включается переменной.
 */

import { WORD_PROBLEM } from './route.js';

export const MIN_ALIVE = 2;   /* большинство из одного — не большинство */

/** Конфиг из окружения (в Worker нет process.env, поэтому env приходит параметром). */
export function cfgOf(env) {
  const e = env || {};
  return {
    on: e.ENSEMBLE !== '0',
    k: Math.max(1, Math.min(5, Number(e.ENSEMBLE_K) || 3)),
    mode: e.ENSEMBLE_TAKE === 'majority' ? 'majority' : 'verify',
    ms: Math.max(8000, Number(e.ENSEMBLE_MS) || 30000),
  };
}

const INTENTS = { math: 1, reasoning: 1 };

/* Явные приметы задачи с одним верным ответом. Нужны, потому что classifyTask — тоже
   классификатор и тоже ошибается в обе стороны: силлогизм «если все коты…, следует ли»
   он отдаёт в fast, а это ровно тот случай, где большинство поднимает точность. */
export const LOGIC_MARKS = /(следует ли|верно ли|неверно ли|докажи|опровергн|парадокс|логическ|силлогизм|какой вариант|который из(?: них)? верн|посчитай|рассчитай|вычисли|сколько будет|сколько (?:осталось|всего|лишних|прошло|им \w+|\w+ \w+\??$)|какая вероятность|каков шанс|найти ошибку в|процент|одна (?:половин|четвер|трет)|\d+\s*[+\-*/×÷^]\s*\d+|если .{0,80}, то)/i;

/* Арифметическая задача текстом: два числа и слово про количество. Роутер такие
   короткие формулировки отдаёт в fast («сколько осталось» — не «посчитай»), а это
   ровно тот класс, где большинство дешевле всего поднимает точность. */
/* Тот же признак, что и у классификатора: единый источник правды. */
export const TWO_NUMBERS = /\d+[^\n]{0,80}\d+/;

/**
 * Ключ ответа — то, по чему сверяемся. Число из строки с итогом («Ответ: 42», «**42**»),
 * иначе последняя цифра ответа, иначе первая строка (для «какой вариант верный»).
 * Разделители тысяч и десятичная запятая нормализуются, чтобы «1,234.5» и «1234.5»
 * сошлись, а не дали два разных голоса.
 */
export function answerKey(text) {
  const s = String(text || '').replace(/\*/g, '').replace(/`/g, '');
  if (!s.trim()) return '';
  const tail = (s.match(/(?:ответ|итог|вывод|answer|result)\s*[:\-—]?\s*([^\n]+)/i) || [])[1]
    || s.trim().split('\n').filter(Boolean).pop() || '';
  const nums = tail.replace(/[\s\u00a0](?=\d)/g, '').replace(/(\d),(\d{3}\b)/g, '$1$2').replace(/(\d)\.(\d{3}\b)/g, '$1$2')
    .match(/-?\d+(?:[.,]\d+)?/g);
  if (nums && nums.length) return 'n:' + normNum(nums[nums.length - 1]);
  const words = tail.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, ' ').trim();
  return words ? 'w:' + words.split(/\s+/).slice(0, 6).join(' ') : '';
}

export function normNum(x) {
  let v = String(x).trim().toLowerCase();
  if (/,/.test(v) && /\.\d/.test(v)) v = v.replace(/,/g, '');   // 1,234.56
  else v = v.replace(',', '.');                                   // 12,5
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : v;
}

/** Большинство по ключам. agreed — есть строгое большинство и голов минимум две. */
export function tally(cands) {
  const list = (cands || []).filter((c) => c && c.reply && c.key);
  const by = {};
  list.forEach((c) => { (by[c.key] = by[c.key] || []).push(c); });
  const keys = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
  if (!keys.length) return { winner: null, votes: [], total: 0, agreed: false };
  const best = by[keys[0]];
  return {
    winner: best[0],
    total: list.length,
    agreed: best.length >= MIN_ALIVE && best.length > list.length / 2 - 0.001,
    votes: keys.map((k) => ({ key: k, n: by[k].length, providers: by[k].map((c) => c.provider) })),
  };
}

/** Стоит ли тратить K вызовов на эту задачу. `classify` внедряется движком — здесь нет сети. */
export function shouldPoll(goal, opts) {
  const c = cfgOf(opts && opts.env);
  if (!c.on || c.k < 2) return false;
  const t = String(goal || '');
  if (!t.trim()) return false;
  /* просил код — не сюда: там арбитр — прогон в песочнице (Этап 5), он сильнее голоса */
  if (typeof (opts && opts.wantsCode) === 'function' && opts.wantsCode(t)) return false;
  let intent = '';
  try { intent = (opts && opts.classify ? opts.classify(t, null) : '') || ''; } catch (e) { intent = ''; }
  if (intent === 'code') return false;
  if (INTENTS[intent] || LOGIC_MARKS.test(t)) return true;
  /* fast-вердикт роутера — не приговор: смотрим на структуру задачи */
  return (intent === 'fast' || intent === '') && TWO_NUMBERS.test(t) && WORD_PROBLEM.test(t);
}

/**
 * Опрос. `ask(i)` → Promise<{reply, provider}> внедряется движком: здесь ни сети,
 * ни циклических зависимостей. Возвращает null — идти обычным путём, либо
 * { skip: 'причина словами' } — чтобы «не настроено» и «не тот тип задачи» можно
 * было отличить друг от друга без угадывания (этот вывод обошёлся в Yama вечер отладки).
 */
export async function poll({ goal, ask, env, onEvent, wantsCode, classify, authorReply, k }) {
  const c = cfgOf(env);
  if (!c.on || c.k < 2) return { skip: 'ансамбль выключен' };
  if (!shouldPoll(goal, { env, wantsCode, classify })) return { skip: 'задача не для подсчёта голосов' };
  if (typeof ask !== 'function') return { skip: 'нет голов для опроса' };
  /* n — число голов. Движок передаёт его равным числу ЖИВЫХ провайдеров, поэтому
     резать обратно по ENSEMBLE_K нельзя: при 1:1 именно это молча убивало вторую
     волну опроса. Два голоса от одного провайдера — не большинство, повторы жгут
     квоту, и то и другое учтено тем, что список голов строится без повторов. */
  const n = Math.max(1, Math.min(5, k != null ? k : c.k));
  /* Ответ основной головы — голос на равных: без него «большинство» было бы
     мнением проверяющих, а не сверкой. */
  const author = authorReply ? { reply: String(authorReply), provider: 'author', key: answerKey(authorReply) } : null;
  const mine = () => (author ? [author] : []).concat(slots.filter(Boolean));
  /* slot: undefined — голова ещё молчит, null — ответила нечитаемо, объект — голос. */
  const slots = new Array(n).fill(undefined);
  const remaining = () => slots.reduce((a, v) => a + (v === undefined ? 1 : 0), 0);
  /* Досчитывать смысла нет, когда перевес больше, чем все оставшиеся голоса
     вместе: победителя уже не догнать и не сравнять. Это и есть повод не
     ждать самого медленного провайдера ради результата, который он не меняет. */
  const locked = () => {
    const t = tally(mine());
    if (!t.votes.length) return false;
    const lead = t.votes[0].n - (t.votes[1] ? t.votes[1].n : 0);
    return lead > remaining();
  };

  let wake = null;
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(Promise.resolve()
      .then(() => ask(i))
      .then((r) => (r && r.reply
        ? { reply: String(r.reply), provider: r.provider || ('head' + i), key: answerKey(r.reply), head: true }
        : null))
      .catch(() => null)
      .then((v) => {
        slots[i] = v || null;
        if (wake) { const f = wake; wake = null; f(); }
      }));
  }
  for (;;) {
    if (remaining() === 0 || locked()) break;
    /* ask обязан разрешиться (движок даёт каждой голове её дедлайн) */
    await new Promise((r) => { wake = r; });
  }
  const heads = slots.filter(Boolean);
  emit(onEvent, 'независимых голов: ' + heads.length + ' из ' + n + (remaining() ? ' (остальных не ждём)' : ''));
  if (!heads.length) return { skip: 'головы не ответили' };
  const cands = mine();
  if (cands.length < MIN_ALIVE) return { skip: 'живых голов: ' + heads.length };
  const t = tally(cands);
  if (!t.winner) return { skip: 'головы не ответили' };
  return { agreed: t.agreed, votes: t.votes, total: t.total, winner: t.winner, mode: c.mode, authorKey: author ? author.key : '' };
}

/**
 * Что показать человеку. `authorReply` — текст, который уже получен основным обходом.
 * verify: его и оставляем, когда большинство согласно (манера речи важнее «победителя»);
 * majority: берём текст головы-победителя, как это делал Yama 1.0.227.
 */
export function decide({ authorReply, result }) {
  if (!result || result.skip || !result.winner) return { reply: authorReply, applied: false, status: 'skip', why: result && result.skip };
  const authorKey = result.authorKey || answerKey(authorReply);
  const won = result.winner.key === authorKey;
  if (result.mode === 'verify') {
    /* Статусы: confirmed — большинство реально сошлось и на авторе; overruled —
       сошлись против автора; split — сошиться не смогли (в т.ч. 1:1). Split помечает
       ответ спорным, а не «проверенным»: это ровно тот случай, в котором первая
       версия слоя оставила человеку неправильное число со словом «подтверждено». */
    const agreedWithAuthor = won && result.agreed;
    const agreedAgainst = !won && result.agreed;
    if (agreedWithAuthor) {
      return { reply: authorReply, applied: false, status: 'confirmed', agreed: true, votes: result.votes, total: result.total };
    }
    if (agreedAgainst) {
      return { reply: result.winner.reply, applied: true, status: 'overruled', agreed: true, votes: result.votes, total: result.total };
    }
    const shown = (result.votes || []).slice(0, 3).map((v, i) =>
      String.fromCharCode(1040 + i) + ') ' + v.providers.join(',') + ' → ' + v.key.replace(/^n:/, '').replace(/^w:/, '')).join(', ');
    return {
      reply: authorReply + '\n\n⚖️ Головы не сошлись (' + shown + ') — число спорное, я не выбираю наугад.',
      applied: true, status: 'split', agreed: false, votes: result.votes, total: result.total, retry: true,
    };
  }
  return {
    reply: result.winner.reply,
    applied: result.winner.reply !== authorReply,
    status: won ? 'confirmed' : (result.agreed ? 'overruled' : 'split'),
    agreed: result.agreed,
    votes: result.votes,
    total: result.total,
  };
}

/** Строка для API/человека: сходимость и голоса — наблюдаемость важнее красоты. */
export function lineOf(d) {
  if (!d || d.status === 'skip') return d && d.why ? 'пропущено: ' + d.why : '';
  const top = d.votes && d.votes[0] ? d.votes[0].n : 0;
  const heads = ((d.votes && d.votes[0] && d.votes[0].providers) || []).join(',');
  return (d.agreed ? 'сошлись ' : 'разошлись ') + top + '/' + (d.total || 0) + (heads ? ' (' + heads + ')' : '');
}

function emit(onEvent, text) {
  if (!onEvent) return;
  try { onEvent({ type: 'observe', name: 'ensemble', text }); } catch (e) { /* наблюдение не должно ломать ответ */ }
}
