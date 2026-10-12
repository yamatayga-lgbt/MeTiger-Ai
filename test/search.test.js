/** 0.133: умный поиск (Gemini grounding → Groq) с чтением страниц. Сеть подменена. */
import assert from 'node:assert';
import { smartSearch, searchBlock, SEARCH_DIRECTIVE } from '../engine/search.js';
import { extractSources } from '../engine/tools.js';
import { execFileSync } from 'node:child_process';
const citeOut = '/tmp/cite-test.mjs';
execFileSync('node_modules/.bin/esbuild', ['src/lib/cite.ts', '--format=esm', '--outfile=' + citeOut, '--log-level=error']);
const { linkCitations } = await import(citeOut);

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✖ ' + n + (x ? ' — ' + x : '')); } };

const PAGE = '<html><body><p>Официальный курс доллара на 9 октября 2026 года составил 3,0637 белорусского рубля по данным Нацбанка.</p></body></html>';
function fakeFetch(calls, { gemini = true } = {}) {
  return async (url, init) => {
    url = String(url); calls.push(url);
    if (url.includes('generativelanguage')) {
      if (!gemini) return new Response('{}', { status: 429 });
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Курс доллара — 3,0637 BYN.' }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://nbrb.by/rates', title: 'nbrb.by' } }, { web: { uri: 'https://myfin.by/usd', title: 'myfin.by' } }] } }] });
    }
    if (url.includes('groq.com')) return Response.json({ choices: [{ message: { content: 'Курс 3,0637【1】', executed_tools: [{ search_results: { results: [{ title: 'НБРБ', url: 'https://nbrb.by/x', content: 'курс доллара 3,0637' }] } }] } }] });
    return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
  };
}

const c1 = [];
const r1 = await smartSearch({ q: 'курс доллара нбрб сегодня', env: { GEMINI_KEYS: 'k1' }, fetch: fakeFetch(c1) });
ok('S133a Gemini даёт источники', r1.ok && r1.sources.length === 2, JSON.stringify(r1).slice(0, 300));
ok('S133b страницы прочитаны', (r1.reads || []).length >= 1 && /3,0637/.test(r1.reads[0].passages.join(' ')));
const block = searchBlock('курс доллара', r1);
const src = extractSources(block);
ok('S133c нумерация блока = порядок плашек', src[0] && src[0].url === 'https://nbrb.by/rates' && src[1].url === 'https://myfin.by/usd', JSON.stringify(src));
ok('S133d директива про сноски', /\[1\]/.test(SEARCH_DIRECTIVE));

/* ── 0.180 «Свежесть»: дата источника, давние пометки, просьба о свежем ─────── */
{
  const src = await import('node:fs').then((m) => m.readFileSync(new URL('../engine/search.js', import.meta.url), 'utf8'));
  ok('S180e поиск просит свежие и официальные источники и дату данных',
    /Отдавай предпочтение свежим и официальным источникам/.test(src)
      && /обязательно указывай, на какую дату/.test(src)
      && /предпочитай официальные источники и назови, на какую дату данные/.test(src));
  ok('S180f живой вопрос отвечает умная полоса, а не крошечная модель',
    /needsWeb\(String\(norm\.text \|\| text \|\| ''\)\)\.need/.test(
      await import('node:fs').then((m) => m.readFileSync(new URL('../functions/api/chat.js', import.meta.url), 'utf8'))
    ));
}

const c2 = [];
const r2 = await smartSearch({ q: 'другой запрос про курс', env: { GEMINI_KEYS: 'k1', GROQ_KEYS: 'g1' }, fetch: fakeFetch(c2, { gemini: false }) });
ok('S133e запасной Groq', r2.ok && r2.sources[0].url === 'https://nbrb.by/x' && !/【/.test(r2.summary), JSON.stringify(r2).slice(0, 300));
const c3 = [];
const r3 = await smartSearch({ q: 'курс доллара нбрб сегодня', env: { GEMINI_KEYS: 'k1' }, fetch: fakeFetch(c3) });
ok('S133f кэш', r3.ok && c3.length === 0);
const r4 = await smartSearch({ q: 'x', env: { SMART_SEARCH: 'off' }, fetch: fakeFetch([]) });
ok('S133g выключатель', !r4.ok);

const S = [{ url: 'https://a.by' }, { url: 'https://b.by' }];
ok('S133h сноски → ссылки', linkCitations('Факт [1], ещё [2][1].', S) === 'Факт [\\[1\\]](https://a.by), ещё [\\[2\\]](https://b.by)[\\[1\\]](https://a.by).', linkCitations('Факт [1], ещё [2][1].', S));
ok('S133i код и чужие номера не трогаем', linkCitations('`a[1]` и [5] и [x](y)', S) === '`a[1]` и [5] и [x](y)');

/* ── 0.163: даты источников ──────────────────────────────────────────────────── */
console.log('\nS163 — свежесть источников');
{
  const { dateOf } = await import('../engine/search.js');
  const META = '<html><head><meta property="article:published_time" content="2026-10-05T08:30:00+03:00"></head><body>новость</body></html>';
  const TIME = '<html><body><article><time datetime="2026-09-30">30 сентября</time></article></body></html>';
  const REV = '<html><head><meta content="2025-02-14" name="date"></head><body>x</body></html>';
  const LD = '<html><body><script type="application/ld+json">{"datePublished":"2026-01-09T10:00:00"}</script></body></html>';
  /* Строку «обновлено …» ищем в начале текста страницы, а pageText оставляет
     только содержательные строки (длиннее 40 знаков) — в жизни подпись даты
     всегда стоит рядом с текстом, поэтому и в проверке она рядом с ним. */
  const TXT = '<html><body><article><p>Обновлено 11.10.2026, добавлены условия поставки и порядок оплаты по договору.</p></article></body></html>';
  const NONE = '<html><body><p>просто текст без даты</p></body></html>';
  const JUNK = '<html><head><meta property="article:published_time" content="1971-01-01"></head><body>x</body></html>';
  ok('S163a дата из мета-тега публикации', dateOf(META) === '2026-10-05', dateOf(META));
  ok('S163b дата из <time datetime>', dateOf(TIME) === '2026-09-30', dateOf(TIME));
  ok('S163c дата из меты, где атрибуты в обратном порядке', dateOf(REV) === '2025-02-14', dateOf(REV));
  ok('S163d дата из микроразметки страницы', dateOf(LD) === '2026-01-09', dateOf(LD));
  ok('S163e дата из подписи «обновлено …» в начале текста', dateOf(TXT) === '2026-10-11', dateOf(TXT));
  ok('S163f нет даты — честно пусто, а не выдуманная дата', dateOf(NONE) === '', dateOf(NONE));
  ok('S163g нелепый год (1971) не показываем: битая разметка не должна выглядеть свежестью', dateOf(JUNK) === '', dateOf(JUNK));

  /* Дата доезжает до списка источников и до блока, который видит модель. */
  const html = '<html><head><meta property="article:published_time" content="2026-10-04"></head><body><p>' + 'курс доллара обновлён и составляет 3,0637 рубля. '.repeat(6) + '</p></body></html>';
  const fi = async (url) => {
    if (/generativelanguage/.test(String(url))) {
      return { status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'сводка' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'Курс доллара', uri: 'https://myfin.by/usd' } }] } }] }) };
    }
    return { status: 200, headers: { get: () => 'text/html' }, text: async () => html };
  };
  const sr = await smartSearch({ q: 'курс доллара на сегодня 77', env: { GEMINI_KEYS: 'g1' }, fetch: fi });
  const block = searchBlock('курс доллара', sr);
  ok('S163h дата прочитанной страницы приклеивается к источнику', sr.ok && sr.sources[0] && sr.sources[0].date === '2026-10-04', JSON.stringify(sr.sources && sr.sources[0]));
  ok('S163i в блоке для модели дата названа словами «· от»', /· от 2026-10-04/.test(block), block.split('\n').slice(1, 3).join(' | '));
  ok('S163j модели сказано, что делать со старыми данными', /больше года/.test(block));

  /* ── 0.180: свежесть названа возрастом, а не только датой ─────────────────── */
  const { sourceAge, STALE_DAYS } = await import('../engine/search.js');
  const NOW = Date.UTC(2026, 9, 12);
  const юное = sourceAge('2026-10-05', NOW);
  const старое = sourceAge('2019-04-02', NOW);
  ok('S180a возраст источника считается в днях, месяцах и годах',
    юное.days === 7 && юное.old === false && старое.years === 7 && старое.months > 80,
    JSON.stringify([юное, старое]));
  ok('S180b «давний» — полтора года, а не год: свежие обзоры и цены за прошлый сезон не пугают зря',
    STALE_DAYS === 545 && sourceAge('2025-06-01', NOW).old === false && sourceAge('2024-10-01', NOW).old === true
      && sourceAge('', NOW).old === false && sourceAge('не дата', NOW).old === false,
    JSON.stringify([sourceAge('2025-06-01', NOW), sourceAge('2024-10-01', NOW)]));

  /* Дата-обманка: модель видит пометку там же, где берёт факты, — в строке источника. */
  const oldBlock = searchBlock('ставка рефинансирования', {
    engine: 'google', summary: 'сводка', sources: [{ title: 'Старая статья', url: 'https://a.by/x', date: '2019-04-02' },
      { title: 'Свежая статья', url: 'https://b.by/y', date: '2026-10-09' }], reads: [],
  });
  ok('S180c давний источник помечен в строке, свежий — нет',
    /https:\/\/a\.by\/x · от 2019-04-02 · ДАВНИЙ/.test(oldBlock)
      && /https:\/\/b\.by\/y · от 2026-10-09\)/.test(oldBlock) && !/b\.by\/y[^\n]*ДАВНИЙ/.test(oldBlock),
    oldBlock.split('\n').slice(1, 3).join(' | '));
  ok('S180d модели сказано, что делать с пометкой «ДАВНИЙ»', /ДАВНИЙ» свежесть под вопросом/.test(oldBlock));
}

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
