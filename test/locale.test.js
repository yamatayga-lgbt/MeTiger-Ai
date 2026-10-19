/**
 * Русский слой (engine/locale.js, 0.215): страна, таблица, подсказки, проводка.
 *
 * Слой сам по себе не ходит в сеть. Здесь проверяем, что маркеры страны не
 * путают Минск с Москвой, сравнение просит таблицу, а chat/search/webrules
 * и курсы реально зовут этот слой — иначе файл станет мёртвым комментарием.
 *
 *   node test/locale.test.js
 */
import { readFileSync } from 'node:fs';
import { regionOf, wantsTable, hint, searchPrompt } from '../engine/locale.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

console.log('\nL — русский слой: страна, таблица, проводка');

ok('L1: «цены на бензин в Беларуси» — Беларусь, не Россия', regionOf('цены на бензин в Беларуси') === 'by');
ok('L2: «ставка ЦБ РФ» — Россия', regionOf('ставка ЦБ РФ') === 'ru');
ok('L3: «курс доллара» без страны — не угадываем', regionOf('курс доллара') === '');
ok('L4: Гомель важнее общих слов', regionOf('погода в Гомеле') === 'by');
ok('L5: «в Москве» — Россия, даже если вопрос по-русски', regionOf('пробки в Москве сейчас') === 'ru');

ok('L6: сравнение просит таблицу', wantsTable('в чём разница между TCP и UDP') && wantsTable('сравни тарифы МТС и A1'));
ok('L7: «что такое гравитация» таблицу не просит', !wantsTable('что такое гравитация'));
ok('L8: вынутый xlsx с табами — это таблица', wantsTable('товар\tцена\tдата\nМолоко\t1.5\t01.01.2026'));

{
  const h = hint('сравни тарифы МТС и A1 в Минске');
  ok('L9: русская подсказка — числа, даты, не путать страны',
    /1 234,50/.test(h) && /ДД\.ММ\.ГГГГ/.test(h) && /BYN и RUB/.test(h), h.slice(0, 180));
  ok('L10: сравнение — markdown-таблица, не абзац',
    /markdown-таблиц/.test(h) && /\|---\|/.test(h), h.slice(0, 220));
  ok('L11: английский код без кириллицы — без подсказки', hint('write a python sort function') === '');
  ok('L22: в русской подсказке есть сегодняшняя дата, не 2025 год',
    /Сегодня \d{2}\.\d{2}\.\d{4}/.test(h) && !/09\.06\.2025/.test(h), h.slice(0, 220));
}

{
  const by = searchPrompt('курс доллара в Беларуси');
  const ru = searchPrompt('ключевая ставка ЦБ РФ');
  const bare = searchPrompt('курс доллара сегодня');
  const en = searchPrompt('latest rust release');
  ok('L12: поиск по РБ указывает nbrb.by и запрещает ЦБ РФ',
    /nbrb\.by/.test(by) && /не ЦБ РФ/.test(by) && /pravo\.by/.test(by), by.slice(0, 200));
  ok('L13: поиск по РФ указывает cbr.ru и запрещает НБРБ',
    /cbr\.ru/.test(ru) && /не Нацбанк/.test(ru), ru.slice(0, 200));
  ok('L14: без страны — оба курса отдельно, не одно число',
    /НБРБ/.test(bare) && /ЦБ РФ/.test(bare) && /отдельно/.test(bare), bare.slice(0, 200));
  ok('L15: латиница не засоряет поисковый промпт', en === '');
}

ok('L16: chat.js вкладывает locale.hint в system',
  /import \* as locale from '\.\/locale\.js'/.test(src('engine/chat.js'))
    && /locale\.hint\(/.test(src('engine/chat.js')));
ok('L17: search.js дописывает locale.searchPrompt в Gemini и Groq',
  /import \* as locale from '\.\/locale\.js'/.test(src('engine/search.js'))
    && (src('engine/search.js').match(/locale\.searchPrompt/g) || []).length >= 2);
ok('L18: авто-веб ловит ЕРИП, ЖКХ, госуслуги, каникулы, пенсию',
  /ерип\|жкх\|госуслуг/.test(src('engine/webrules.js'))
    && /пенси\[яи\]/.test(src('engine/webrules.js'))
    && /каникул/.test(src('engine/webrules.js')));
ok('L19: курс BYN берётся у Нацбанка, не только у er-api',
  /api\.nbrb\.by\/exrates\/rates/.test(src('engine/tools.js')));
ok('L20: xlsx читает дату из стиля, а не сырой serial',
  /function dateXf/.test(src('engine/docparse.js'))
    && /excelSerial/.test(src('engine/docparse.js')));
ok('L21: GFM-таблица в обёртке с прокруткой',
  /className="md-table"/.test(src('src/components/Markdown.tsx'))
    && /\.md-table \{/.test(src('src/styles/index.css')));

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
