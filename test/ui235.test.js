/**
 * Проверки 0.235 — следующая ступень «Очереди обхода ИИ» (Mistral Le Chat / Perplexity / GigaChat).
 *
 * 1) Песочница кода и виджетов на телефоне (Mistral Le Chat):
 *    - buildHtmlDoc добавляет мобильный viewport и адаптивную обёртку для HTML/SVG/CSS;
 *    - Pyodide автоподгружает научные пакеты (loadPackagesFromImports) и снимает PNG-графики matplotlib;
 *    - CodeRunner даёт кнопки «Развернуть»/«Скрыть» превью и «Исправить код» при ошибке,
 *      а Markdown — «Копировать» в шапке кода и «Скачать CSV» у таблиц.
 * 2) Быстрый поиск и точность цифр по сноскам (Perplexity):
 *    - smartSearch запускает чтение страниц и добор дат остальных ссылок параллельно (без двойного обхода);
 *    - bestPassages поднимает абзацы с точными цифрами и единицами и не выбрасывает страницу при 1 совпавшей основе;
 *    - searchBlock выводит числовые якоря источника с его точным номером [N].
 * 3) Офисные файлы и таблицы РФ/РБ на телефоне (GigaChat):
 *    - filegen разбирает точку с запятой (;), русские десятичные дроби с пробелами («1 250,50»),
 *      русские формулы (=СУММ, =СРЗНАЧ, =B2*1,2), до 26 колонок, автоширину и жирную шапку;
 *    - docparse читает выгрузки 1С и банков в Windows-1251 (русская и белорусская кириллица: Ў/ў, І/і, Ё/ё, №).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { smartSearch, bestPassages, extractFactHints, searchBlock } from '../engine/search.js';
import { generate, formatFromText } from '../engine/filegen.js';
import { parse as parseDoc, decodeCp1251 } from '../engine/docparse.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('\n── 1. Песочница кода, графики Python и мобильное превью (Mistral Le Chat) ──');
{
  const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
  const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-235');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync(bin, ['src/lib/sandbox.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + join(dir, 'sb.mjs')], { stdio: 'pipe' });
  execFileSync(bin, ['src/lib/pysandbox.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + join(dir, 'py.mjs')], { stdio: 'pipe' });
  const SB = await import(join(dir, 'sb.mjs'));
  const PY = await import(join(dir, 'py.mjs'));

  const htmlFrag = SB.buildHtmlDoc('<div>Калькулятор</div>', 'html');
  const svgDoc = SB.buildHtmlDoc('<svg viewBox="0 0 100 50"><rect width="100" height="50"/></svg>', 'svg');
  ok('T235a-1: buildHtmlDoc ставит мобильный viewport и адаптивный SVG без обрезки по краям',
    /name="viewport"/.test(htmlFrag) && /max-width:100%/.test(svgDoc) && /<svg/.test(svgDoc));

  const pyDoc = PY.buildPySrcDoc();
  const pyPlot = PY.normalizePy({ logs: [], value: null, images: ['data:image/png;base64,iVBORw0KGgo='], ms: 120 });
  ok('T235a-2: Pyodide автоподгружает пакеты (loadPackagesFromImports) и передаёт графики matplotlib',
    /loadPackagesFromImports/.test(pyDoc) && /matplotlib/.test(pyDoc)
    && pyPlot.ok && Array.isArray(pyPlot.images) && pyPlot.images.length === 1 && pyPlot.output === '',
    JSON.stringify(pyPlot));

  const runnerSrc = readFileSync(join(process.cwd(), 'src/components/CodeRunner.tsx'), 'utf8');
  const mdSrc = readFileSync(join(process.cwd(), 'src/components/Markdown.tsx'), 'utf8');
  const chatSrc = readFileSync(join(process.cwd(), 'src/views/ChatView.tsx'), 'utf8');
  ok('T235a-3: CodeRunner умеет Развернуть/Скрыть превью и Исправить код одним нажатием',
    /Развернуть/.test(runnerSrc) && /Скрыть/.test(runnerSrc) && /Исправить код/.test(runnerSrc) && /run-plot-img/.test(runnerSrc));
  ok('T235a-4: Markdown даёт копирование кода и выгрузку таблиц в CSV, а карточки файлов — Поделиться',
    /Копировать/.test(mdSrc) && /Скачать CSV/.test(mdSrc) && /className="md-table"/.test(mdSrc) && /Поделиться/.test(chatSrc));
}

console.log('\n── 2. Параллельный поиск и точность цифр по сноскам (Perplexity) ──');
{
  let active = 0, maxConcurrent = 0;
  const fetchedUrls = [];
  const slowFetch = async (url) => {
    const u = String(url);
    if (u.includes('generativelanguage')) {
      return Response.json({
        candidates: [{
          content: { parts: [{ text: 'Ставка — 9,5%.' }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://nbrb.by/rate-235', title: 'НБРБ' } },
              { web: { uri: 'https://belstat.gov.by/stat-235', title: 'Белстат' } },
              { web: { uri: 'https://pravo.by/doc-235', title: 'Pravo.by' } },
              { web: { uri: 'https://myfin.by/news-235', title: 'Myfin' } },
            ],
          },
        }],
      });
    }
    fetchedUrls.push(u);
    active++;
    if (active > maxConcurrent) maxConcurrent = active;
    await new Promise((r) => setTimeout(r, 120));
    active--;
    return new Response(
      '<html><head><meta property="article:published_time" content="2026-10-20"></head><body><p>Ставка рефинансирования Нацбанка с 20 октября 2026 года составляет 9,5% годовых по решению правления.</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    );
  };
  const t0 = Date.now();
  const sr = await smartSearch({ q: 'ставка рефинансирования нацбанка беларуси 235', env: { GEMINI_KEYS: 'k1', SEARCH_READ_PAGES: '2' }, fetch: slowFetch });
  const elapsed = Date.now() - t0;
  ok('T235b-1: чтение первых страниц и добор дат остальных ссылок идут параллельно и без дублей',
    sr.ok && maxConcurrent >= 3 && elapsed < 350 && new Set(fetchedUrls).size === fetchedUrls.length,
    JSON.stringify({ elapsed, maxConcurrent, fetchedUrls }));

  const passages = bestPassages(
    'Общие сведения о банковской системе страны и истории регулирования.\nСтавка по кредитам овернайт установлена на уровне 10,75% годовых с 15.10.2026.',
    'какая ставка овернайт центрального банка',
    1,
    300,
  );
  ok('T235b-2: bestPassages выбирает абзац с точной цифрой и единицей измерения',
    passages.length === 1 && /10,75%/.test(passages[0]), JSON.stringify(passages));

  const hints = extractFactHints(['Курс составил 3,2450 BYN, рост на 1,4% к 20.10.2026.']);
  const sb = searchBlock('курс рубля', sr);
  ok('T235b-3: extractFactHints и searchBlock привязывают точные цифры к номеру источника [N]',
    hints.some((h) => /3,2450 BYN/.test(h)) && /точные цифры \[1\]:.*9,5%/.test(sb),
    JSON.stringify({ hints, sbHead: sb.slice(0, 320) }));
}

console.log('\n── 3. Офисные файлы и выгрузки РФ/РБ (GigaChat) ──');
{
  /* 14 колонок (Статья + 12 месяцев + Итого), разделитель «;», русские дроби «1 250,50» и =СУММ */
  const header = ['Статья', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек', 'Итого'].join(';');
  const row1 = ['Аренда', '1 000,50', '1 000,50', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '=СУММ(B2:M2)'].join(';');
  const row2 = ['НДС 20%', '=B2*0,2', '200,1', '200', '200', '200', '200', '200', '200', '200', '200', '200', '200', '=СУММ(B3:M3)'].join(';');
  const xlsx = generate({ format: 'xlsx', name: 'Бюджет 2026', content: [header, row1, row2].join('\n') });
  const parsed = parseDoc(xlsx.buf, { name: xlsx.name });
  ok('T235c-1: xlsx сохраняет все 14 колонок (не режет после 12), считает =СУММ и =B2*0,2 по русским числам',
    parsed.ok && /Ноя\tДек\tИтого/.test(parsed.text) && /12001/.test(parsed.text) && /200\.1/.test(parsed.text),
    parsed.text);
  ok('T235c-2: formatFromText узнаёт русские просьбы про смету/ведомость/прайс в таблице или Excel',
    formatFromText('собери смету в таблицу на телефон') === 'xlsx'
    && formatFromText('выгрузи прайс в excel') === 'xlsx');

  /* Windows-1251 с русскими и белорусскими буквами (Ў, ў, І, і, Ё, №) */
  const encode1251 = (str) => {
    const rev = new Map();
    for (let b = 0; b < 256; b++) rev.set(decodeCp1251(new Uint8Array([b])), b);
    return new Uint8Array(Array.from(str, (ch) => rev.get(ch) ?? 0x3f));
  };
  const sample1251 = '№ п/п;Контрагент;Сумма BYN\n1;ТАА «БелЎраджай» (Мінск, вул. Інтэрнацыянальная);4 520,80\n2;ИП Семёнов;1 100,00\n';
  const doc1251 = parseDoc(encode1251(sample1251), { name: 'выписка_1с.csv' });
  ok('T235c-3: docparse автоматически читает CSV из 1С/банка в Windows-1251 (включая Ў, І, Ё и №)',
    doc1251.ok && /БелЎраджай/.test(doc1251.text) && /Інтэрнацыянальная/.test(doc1251.text) && /Семёнов/.test(doc1251.text) && /№ п\/п/.test(doc1251.text),
    doc1251.text);
}

console.log(`\nИтог 0.235: ${pass} зелёных, ${fail} красных.`);
if (fail) process.exit(1);
