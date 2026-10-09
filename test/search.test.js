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

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
