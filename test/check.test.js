/**
 * Самопроверка ответа (0.124) — агент сверяет, что написал, с тем, о чём просили.
 *
 * Сети нет: первый проход слоя бесплатный и работает на строках (вопрос, ответ,
 * блок данных инструмента). Платный проход (одна голова на починку) здесь
 * проверяется по решению, а не по вызову — сам вызов сторожит chat.test.js.
 *
 * Отдельно меряется то, что важнее всего: слой НЕ должен находить зацепки там, где
 * их нет. Ложная тревога стоит человеку лишнего прогона и подписи «ответ неполный»
 * под нормальным ответом, поэтому на каждый положительный случай здесь по два
 * отрицательных.
 *
 * Запуск: node test/check.test.js
 */
import {
  askedPoints, cfgOf, coveredShare, decide, findIssues, isRefusalAnswer,
  keywords, lineOf, looksCut, numberShare, promisedButEmpty, repairPrompt,
  toolNumbers, MIN_QUESTIONS,
} from '../engine/check.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('П — самопроверка: агент сверяет ответ с вопросом');

/* ── разбор вопроса на темы ── */
{
  ok('П1: два вопроса в одну строку — две темы, а не одна',
    askedPoints('Сколько будет 2+2? И почему так?').length === 2,
    JSON.stringify(askedPoints('Сколько будет 2+2? И почему так?')));

  ok('П2: нумерованный список в одну строку разбирается на пункты',
    askedPoints('1. Посчитай бюджет. 2. Сравни с прошлым годом.').length === 2
      && askedPoints('1) Посчитай налог 2) Объясни вычет 3) Покажи пример').length === 3,
    JSON.stringify(askedPoints('1) Посчитай налог 2) Объясни вычет 3) Покажи пример')));

  ok('П3: список с переносами — те же пункты',
    askedPoints('- посчитай налог\n- объясни вычет\n- покажи пример').length === 3,
    JSON.stringify(askedPoints('- посчитай налог\n- объясни вычет\n- покажи пример')));

  ok('П4: один вопрос остаётся одной темой — полнота не проверяется на пустом месте',
    askedPoints('привет').length === 0
      && askedPoints('Расскажи про котов.').length === 1
      && askedPoints('докажи, что корень из 2 иррационален').length === 1,
    JSON.stringify(askedPoints('Расскажи про котов.')));

  ok('П5: десятичная дробь и арифметика не режут вопрос пополам',
    askedPoints('Курс 3.42 рубля, сколько это в долларах?').length === 1
      && askedPoints('Сколько будет 17*23? Проверь и объясни, как считал.').length === 2,
    JSON.stringify(askedPoints('Курс 3.42 рубля, сколько это в долларах?')));

  ok('П6: перечисление однородных — запасной путь, когда предложений не нашлось',
    askedPoints('посчитай расход, сравни с прошлым месяцем и объясни разницу').length >= 1
      && askedPoints('Сравни SQLite и Postgres? Чем они отличаются? Что выбрать?').length === 3);

  ok('П7: мусор и повторы буквы не становятся темами, а числа — становятся',
    keywords('аааа').length === 0 && keywords('2+2').length === 2
      && keywords('Что такое база данных').indexOf('база') >= 0
      /* Двухбуквенные сокращения темой не считаются: по «kv» совпадение ловилось
         бы на любом слове с этими буквами внутри. */
      && keywords('Что такое KV и зачем').indexOf('kv') < 0
      /* Знаки препинания снимаются ДО разбора: «Postgres?» обязан совпасть с
         «Postgres» в ответе, иначе тема считалась бы нераскрытой. */
      && keywords('Сравни SQLite и Postgres?').indexOf('postgres') >= 0,
    JSON.stringify(keywords('Сравни SQLite и Postgres?')));
}

/* ── данные инструмента ── */
{
  const block = '[Инструмент: Валюта]\nUSD/BYN = 3,4210 на 9 октября\n[Инструмент: Поиск]\nИнфляция 7,5% за год';
  ok('П8: числа из блока инструмента находятся и нормализуются (запятая → точка)',
    toolNumbers(block).length >= 2 && toolNumbers(block).indexOf('3.4210') >= 0,
    JSON.stringify(toolNumbers(block)));

  ok('П9: без блока инструмента чисел нет — и зацепки не будет',
    toolNumbers('обычный текст без инструментов').length === 0
      && toolNumbers('').length === 0);

  ok('П10: доля чисел в ответе считается честно',
    numberShare(['3.4210', '7.5'], 'Курс 3,4210, инфляция 7,5%') === 1
      && numberShare(['3.4210', '7.5'], 'Курс около трёх') === 0
      && numberShare([], 'что угодно') === 1);

  ok('П11: «данные инструмента не дошли» — зацепка, а дошли — нет',
    /не дошли/.test((findIssues({
      text: 'какой курс и инфляция', reply: 'Курс около трёх рублей, инфляция небольшая',
      block, ok: true,
    }).notes || []).join(' '))
      && findIssues({ text: 'какой курс и инфляция', reply: 'Курс 3,4210 рубля, инфляция 7,5%', block, ok: true }).notes.length === 0,
    JSON.stringify(findIssues({ text: 'какой курс', reply: 'около трёх', block, ok: true })));
  ok('П11б: арифметику с калькулятором правило чисел не трогает — верный ответ «11» не зацепка',
    findIssues({
      text: 'посчитай 24 - 8 - 5', ok: true, reply: 'Ответ: 11',
      block: '[Инструмент: Калькулятор]\n24 - 8 - 5 = 11', tools: ['calc'],
    }).notes.length === 0
      /* без калькулятора те же числа — уже зацепка: данные пришли не оттуда, где их
         посчитали, и «около трёх» вместо 3,4210 человек увидит как ответ */
      && findIssues({
        text: 'какой курс и инфляция', ok: true, reply: 'Курс около трёх',
        block: '[Инструмент: Валюта]\nUSD/BYN = 3,4210\nИнфляция 7,5%', tools: ['currency'],
      }).notes.length > 0,
    JSON.stringify(findIssues({ text: 'посчитай 24 - 8 - 5', ok: true, reply: '11', block: '[Инструмент: Калькулятор]\n24 - 8 - 5 = 11', tools: ['calc'] }).notes));
}

/* ── обещанное и оборванное ── */
{
  ok('П12: обещан план без пунктов — зацепка; план с пунктами — нет',
    /обещан «план»/.test(promisedButEmpty('Вот план:'))
      && promisedButEmpty('Вот план:\n1. Снять бекап\n2. Перенести базу\n3. Проверить DNS') === '',
    JSON.stringify(promisedButEmpty('Вот план:\n1. Снять бекап')));

  ok('П13: незакрытая скобка, кавычка или висячий союз — ответ обрывается',
    looksCut('Формула выглядит так: (a + b') === true
      && looksCut('Он сказал «пойдём') === true
      && looksCut('Это работает потому что') === true
      && looksCut('Это работает, потому что поток живой.') === false
      && looksCut('Коротко (да).') === false);

  ok('П14: отказ или отписка вместо ответа — зацепка, настоящий короткий ответ — нет',
    isRefusalAnswer('Я не могу помочь с этим запросом, так как языковая модель', 'объясни, как устроен протокол') === true
      && isRefusalAnswer('4', 'сколько будет 2+2') === false
      && isRefusalAnswer('Да, это верно: корень из двух иррационален.', 'верно ли это') === false);
}

/* ── полнота ответа ── */
{
  const q = 'Сравни SQLite и Postgres? Чем они отличаются? Что выбрать для мобильного приложения?';
  ok('П15: спрошено три — отвечено на одну: зацепка названа словами и показывает, что пропущено',
    (() => {
      const r = findIssues({ text: q, ok: true, reply: 'SQLite — это встроенная база данных, которая хранится в одном файле и не требует сервера.' });
      return r.notes.some((n) => /спрошено 3, отвечено на 1/.test(n)) && /без ответа/.test(r.notes.join(' '));
    })(),
    JSON.stringify(findIssues({ text: q, ok: true, reply: 'SQLite — встроенная база в одном файле.' }).notes));

  ok('П16: отвечено на всё — зацепок нет (ложная тревога дороже пропуска)',
    findIssues({
      text: q, ok: true,
      reply: 'Сравнение SQLite и Postgres: первая встраивается в приложение и хранится файлом, вторая требует сервера. Отличаются они масштабом и конкуренцией за запись. Для мобильного приложения выбрать стоит SQLite.',
    }).notes.length === 0,
    JSON.stringify(findIssues({ text: q, ok: true, reply: 'Сравнение SQLite и Postgres: первая встраивается, вторая требует сервера. Отличаются масштабом. Выбрать для мобильного приложения стоит первую.' }).notes));

  ok('П17: покрытость темы считается по основам слов, а не по точным совпадениям',
    coveredShare('проверить договор аренды', 'В договоре аренды проверь пункты о залоге') >= 0.6
      && coveredShare('проверить договор аренды', 'Погода сегодня ясная') === 0);

  ok('П18: порог перечисления — переменная, а не догадка',
    MIN_QUESTIONS === 2 && cfgOf({ CHECK_MIN_QUESTIONS: 4 }).minQuestions === 4
      && cfgOf({}).minQuestions === 2);
}

/* ── решение и починка ── */
{
  const q = 'Посчитай налог? Объясни вычет? Покажи пример расчёта?';
  const short = 'Налог считается по ставке.';
  ok('П19: decide называет зацепки словами и просит починку, когда бюджет разрешает',
    (() => {
      const d = decide({ text: q, reply: short, ok: true, spent: 0, env: {} });
      return d.notes.length > 0 && d.needFix === true && d.why.length > 10 && !/CHECK|budget/i.test(d.why);
    })(),
    JSON.stringify(decide({ text: q, reply: short, ok: true, spent: 0 })));

  ok('П20: бюджет истрачен — починки нет, но зацепки человеку всё равно видны',
    decide({ text: q, reply: short, ok: true, spent: 5, env: {} }).needFix === false
      && decide({ text: q, reply: short, ok: true, spent: 5, env: {} }).notes.length > 0
      && /не разрешена бюджетом/.test(decide({ text: q, reply: short, ok: true, spent: 5, env: {} }).why));

  ok('П21: CHECK=off — слой молчит, CHECK=free — проверяет, но не чинит',
    decide({ text: q, reply: short, ok: true, env: { CHECK: 'off' } }).notes.length === 0
      && decide({ text: q, reply: short, ok: true, env: { CHECK: 'free' } }).needFix === false
      && decide({ text: q, reply: short, ok: true, env: { CHECK: 'free' } }).notes.length > 0);

  ok('П22: на отказе движка проверять нечего — зацепок нет',
    decide({ text: q, reply: '', ok: false, env: {} }).notes.length === 0
      && findIssues({ text: q, reply: '', ok: false }).notes.length === 0);

  ok('П23: текст досыла несёт вопрос, собственный ответ и зацепки — и просит дописать, а не переписать',
    (() => {
      const p = repairPrompt({ text: q, reply: short, notes: ['спрошено 3, отвечено на 1'] });
      return p.indexOf(q) >= 0 && p.indexOf(short) >= 0 && p.indexOf('спрошено 3') >= 0
        && /только недостающее/.test(p) && /без повтора/.test(p);
    })(),
    repairPrompt({ text: q, reply: short, notes: ['x'] }).slice(0, 60));

  ok('П24: длинный вопрос и ответ не утаскивают в досыл целиком — есть потолок',
    repairPrompt({ text: 'вопрос '.repeat(900), reply: 'ответ '.repeat(1900), notes: ['x'] }).length < 9000);
}

/* ── что видит человек ── */
{
  const d = decide({
    text: 'Посчитай налог? Объясни вычет? Покажи пример расчёта?',
    reply: 'Налог считается по ставке.', ok: true, env: {},
  });
  ok('П25: подпись под ответом читается и отличается для починенного и непочиненного',
    lineOf({ notes: d.notes, fixed: false }).indexOf(' · самопроверка: ') === 0
      && /дописано/.test(lineOf({ notes: d.notes, fixed: true }))
      && lineOf({ notes: [] }) === '' && lineOf(null) === ''
      && !/undefined|null/.test(lineOf({ notes: d.notes })),
    lineOf({ notes: d.notes }));

  ok('П26: зацепок не больше трёх — подпись не должна съедать ответ',
    decide({
      text: 'Посчитай налог? Объясни вычет? Покажи пример? Перечисли ставки? Опиши порядок?',
      reply: 'Налог считается по ставке.', ok: true, env: {},
    }).notes.length <= 3);
}

/* ── слой не имеет права упасть ── */
{
  const мусор = [undefined, null, '', {}, { text: null }, { reply: 123 }, { text: 'вопрос', reply: null, block: null }];
  ok('П27: мусор на входе не роняет слой и не выдумывает зацепки',
    мусор.every((x) => {
      try { const r = findIssues(x); return r && Array.isArray(r.notes); } catch (e) { return false; }
    }) && findIssues({}).notes.length === 0
      && (() => { try { decide(undefined); decide(null); return true } catch (e) { return false } })());
}

{
  const block = '[Инструмент: Веб-поиск]\nПариж: население 2 102 650, площадь 105,4 км², с 1789 года';
  ok('C-search1: на «Столица Франции?» верный ответ «Париж.» без чисел из поиска не считается провалом (раньше досыл стирал «Париж»)',
    findIssues({ text: 'Столица Франции?', reply: 'Париж.', block, tools: ['web-search'], ok: true }).notes.length === 0);
  ok('C-search2: если вопрос про число — числа из поиска по-прежнему обязаны дойти',
    /не дошли/.test(findIssues({ text: 'Сколько людей живёт в Париже?', reply: 'Очень много людей, это большой город.', block, tools: ['web-search'], ok: true }).notes.join(' ')));
}

{
  ok('C128a: условие задачи — не второй подвопрос («У Пети 5 яблок… Сколько стало?» — один вопрос)',
    askedPoints('У Пети 5 яблок, он отдал 2 и купил 7. Сколько стало?').length === 1);
  ok('C128b: просьба-глагол рядом с вопросом остаётся темой',
    askedPoints('Посчитай бюджет. Сравни с прошлым годом?').length === 2);
  const block = '[Инструмент: Курсы валют]\nUSD 3,2710 BYN, EUR 3,5320 BYN на 09.10.2026';
  ok('C128c: инструмент сработал мимо вопроса (курс на «рекурсию») — его числа ответ не обязан нести',
    findIssues({ text: 'Объясни, что такое рекурсия, в двух предложениях', reply: 'Рекурсия — это когда функция вызывает саму себя.', block, tools: ['currency'], ok: true }).notes.length === 0);
}

{
  const { exactCountIssue } = await import('../engine/check.js');
  ok('C132a: «ровно 5 слов» и 4 слова в ответе — зацепка словами', /ровно 5 слов, в ответе 4/.test(exactCountIssue('Напиши предложение, в котором ровно 5 слов.', 'Кошка спит на окне.')));
  ok('C132b: попал в счёт — зацепки нет', exactCountIssue('Напиши предложение, в котором ровно 5 слов.', 'Кошка спит на тёплом окне.') === '');
  ok('C132c: «ровно 3 фрукта» и список из двух — зацепка', /ровно 3/.test(exactCountIssue('Перечисли ровно 3 фрукта', '1. Яблоко\n2. Груша')));
  ok('C132d: без «ровно» число — ориентир, не условие', exactCountIssue('Напиши 5 советов', '1. а') === '');
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
