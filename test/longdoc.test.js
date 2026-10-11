/**
 * Большие документы (engine/longdoc.js): деление, выбор частей по вопросу, сборка
 * выписок и запасной путь без модели. Чистые функции — сети и ключей здесь нет.
 * Запуск: node test/longdoc.test.js
 */
import * as longdoc from '../engine/longdoc.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

console.log('L — большие документы: чтение по частям');

/* Документ, как он приходит от читалки: заголовки, абзацы, ключевое — в середине. */
const PAGE = (i) => 'Раздел ' + i + '. '
  + ('Обычные условия поставки и приёмки товара, порядок подписания документов, порядок\n'
    + 'согласования заявок, ответственность сторон и прочие условия сделки. ').repeat(30)
  + '\n\n';
const KEYSENT = 'Пункт 7.3. Срок оплаты по договору — 42 календарных дня с даты приёмки.';
const DOC = PAGE(1) + PAGE(2) + PAGE(3) + PAGE(4) + PAGE(5) + KEYSENT + '\n\n' + PAGE(6) + PAGE(7) + PAGE(8);

{
  const parts = longdoc.splitParts(DOC, 900);
  ok('L1: части делят документ без потерь и в исходном порядке',
    parts.length > 3 && parts.join('').replace(/\s+/g, ' ').trim() === DOC.replace(/\s+/g, ' ').trim(),
    JSON.stringify({ n: parts.length, same: parts.join('').length, src: DOC.length }));
  ok('L2: ни одна часть не длиннее заданного размера (кроме неделимого куска)',
    parts.every((p) => p.length <= 4600), JSON.stringify(parts.map((p) => p.length)));
}

{
  const ts = longdoc.terms('какой срок оплаты по договору?');
  ok('L3: слова вопроса вытащены, служебные выброшены',
    ts.indexOf('оплаты') >= 0 && ts.indexOf('договору') >= 0 && ts.indexOf('какой') < 0, JSON.stringify(ts));
  const full = longdoc.plan(DOC, ts, { partChars: 4000, maxParts: 3, terms: ts });
  ok('L4: частей больше потолка — берём близкие к вопросу, остальные не читаем',
    full.total > 3 && full.kept === 3 && full.dropped === full.total - 3, JSON.stringify({ total: full.total, kept: full.kept }));
  ok('L5: выбранные части идут в порядке файла и вопрос найден',
    full.parts.every((p, i) => i === 0 || p.i > full.parts[i - 1].i)
      && full.parts.some((p) => p.text.indexOf('42 календарных дня') >= 0),
    JSON.stringify(full.parts.map((p) => p.i)));
  const all = longdoc.plan(DOC, ts, { partChars: 4000, maxParts: 20, terms: ts });
  ok('L6: влезло целиком — читаем всё, «не прочитано» не пишем',
    all.kept === all.total && all.dropped === 0, JSON.stringify({ kept: all.kept, total: all.total }));
}

{
  /* Ни одного слова вопроса в документе: брать первые страницы — значит отвечать по
     началу. Части берём равномерно: ответ может быть где угодно. */
  const ts = longdoc.terms('квантовый редуктор Зюсанна');
  const pl = longdoc.plan(DOC, ts, { partChars: 4000, maxParts: 3, terms: ts });
  const at = pl.parts.map((p) => p.i);
  ok('L7: совпадений нет — части берём по всему документу, а не с начала',
    pl.kept === 3 && at[0] <= 2 && at[at.length - 1] >= pl.total - 2, JSON.stringify({ at, total: pl.total }));
}

{
  const pick = longdoc.localPick(DOC, longdoc.terms('срок оплаты'), 900);
  ok('L8: без модели нужное место всё равно найдено (запасной путь)',
    pick.indexOf('42 календарных дня') >= 0 && pick.length <= 1400, String(pick.length));
  ok('L9: пустая выписка распознаётся («НЕТ» — это «ничего по вопросу»)',
    longdoc.isEmptyExtract('НЕТ') && longdoc.isEmptyExtract('нет.') && !longdoc.isEmptyExtract('Пункт 7.3: 42 дня'));
}

{
  const block = longdoc.blockOf({
    name: 'договор.pdf', line: 'pdf · 180 000 симв.', total: 12, dropped: 5,
    reads: [{ i: 3, text: 'Пункт 7.3. Срок оплаты — 42 дня.' }, { i: 7, text: 'Пункт 9.1. Приёмка по акту.' }],
  });
  ok('L10: в шапке блока честно: сколько частей из скольких прочитано',
    block.indexOf('[Файл: договор.pdf · pdf · 180 000 симв., прочитан по частям: 2 из 12]') >= 0,
    block.slice(0, 120));
  ok('L11: выписки помечены номерами фрагментов, непрочитанное названо словами',
    block.indexOf('— фрагмент 3 из 12 —') >= 0 && /не попали части/.test(block), block.slice(-160));
  ok('L12: строка для списка прочитанного — «прочитан по частям (2 из 12)»',
    longdoc.lineOf({ line: 'pdf · 180 000 симв.', kept: 2, total: 12 }) === 'pdf · 180 000 симв. · прочитан по частям (2 из 12)',
    longdoc.lineOf({ line: 'pdf · 180 000 симв.', kept: 2, total: 12 }));
  ok('L13: целиком прочитанный файл строку не удлиняет',
    longdoc.lineOf({ line: 'txt · 900 симв.', kept: 1, total: 1 }) === 'txt · 900 симв.');
  const pr = longdoc.readPrompt('договор.pdf', 'какой срок оплаты?', { i: 3, total: 12, text: KEYSENT });
  ok('L14: задание части содержит имя файла, вопрос и границы фрагмента',
    pr.indexOf('договор.pdf') >= 0 && pr.indexOf('какой срок оплаты?') >= 0
      && pr.indexOf('--- начало фрагмента ---') >= 0 && pr.indexOf('42 календарных дня') >= 0);
  ok('L15: короткий документ части не плодит (одна часть — не «по частям»)',
    longdoc.splitParts('маленький файл', 4000).length === 1 && longdoc.blockOf({ name: 'x.txt', total: 1, reads: [{ i: 1, text: 'т' }] }).indexOf('по частям') < 0);
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
