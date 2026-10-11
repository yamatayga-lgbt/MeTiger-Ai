#!/usr/bin/env node
/**
 * Стенд свежести поиска (0.163): 20 вопросов, ответы на которые меняются —
 * курсы, цены, версии, новости. Проверяем не «нашлось ли», а СВЕЖЕСТЬ: сколько
 * источников прочитано и у скольких из них есть дата публикации.
 *
 * Зачем отдельный стенд, а не тест в цепочке: тесты не ходят в сеть (иначе красный
 * прогон будет из-за чужого 429, а не из-за нашего кода). Здесь — живые ключи и
 * живые поисковики, поэтому запускать руками:
 *
 *   GEMINI_KEYS=… GROQ_KEYS=… node scripts/search-stand.mjs            # все 20
 *   GEMINI_KEYS=… node scripts/search-stand.mjs --n=5 --deep           # первые 5, глубоко
 *
 * Ключи берутся из окружения или из keys/.secrets.env (он в .gitignore).
 */
import { readFileSync, existsSync } from 'node:fs';
import { smartSearch } from '../engine/search.js';

const QUESTIONS = [
  'курс доллара к рублю сегодня',
  'цена биткоина сегодня',
  'актуальная версия Node.js LTS',
  'последняя версия Android',
  'кто сейчас президент США',
  'погода в Москве на завтра',
  'цена бензина АИ-95 в Беларуси',
  'сколько сейчас стоит подписка ChatGPT Plus',
  'последняя версия Python',
  'когда выйдет следующий iPhone',
  'ставка рефинансирования Нацбанка Беларуси',
  'какие новости в мире технологий сегодня',
  'курс евро к рублю сегодня',
  'тарифы МТС Беларусь интернет',
  'последняя версия Chrome',
  'результаты последнего матча Барселоны',
  'сколько стоит билет Минск Москва',
  'самая новая модель DeepSeek',
  'ставка по вкладам в белорусских банках',
  'пробки в Минске сейчас',
];

function loadSecrets() {
  const out = {};
  const p = 'keys/.secrets.env';
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const args = process.argv.slice(2);
const nArg = args.find((a) => a.startsWith('--n='));
const N = nArg ? Math.max(1, Number(nArg.slice(4)) || 20) : QUESTIONS.length;
const DEEP = args.includes('--deep');
/* --prod: гонять вопросы через живой сайт, а не через локальный движок. Так стенд
   проверяет настоящую дорогу — движок + поиск + ключи из окружения Cloudflare, — и
   не требует ключей на машине. Заголовки браузера обязательны: Cloudflare отвечает
   403 на запросы «из ниоткуда» (проверено на 0.161). */
const PROD = args.includes('--prod');
const PROD_URL = (args.find((a) => a.startsWith('--url=')) || '').slice(6) || 'https://metiger-ai.pages.dev';
const PROD_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/** Один вопрос на живом сайте: ответ, источники, даты. */
async function askProd(q) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const r = await fetch(PROD_URL + '/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: PROD_URL,
        referer: PROD_URL + '/',
        'user-agent': PROD_UA,
      },
      body: JSON.stringify({ text: q, webSearch: true }),
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, why: 'сервер ответил ' + r.status };
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, why: 'ответ не разобрался' };
    return {
      ok: !!j.ok,
      why: j.error,
      reply: String(j.reply || ''),
      sources: Array.isArray(j.sources) ? j.sources : [],
      engine: (j.provider || '') + (j.model ? '/' + j.model : ''),
      ms: j.ms,
    };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

const env = Object.assign({}, loadSecrets(), process.env);
if (!PROD && !env.GEMINI_KEYS && !env.GROQ_KEYS) {
  console.log('нет ключей: задайте GEMINI_KEYS/GROQ_KEYS или положите их в keys/.secrets.env');
  console.log('или гоняйте через живой сайт: node scripts/search-stand.mjs --prod');
  process.exit(1);
}

console.log(PROD ? 'стенд свежести через живой сайт: ' + PROD_URL : 'стенд свежести через локальный движок');
let withDate = 0;
let read = 0;
let ok = 0;
const rows = [];
for (let i = 0; i < Math.min(N, QUESTIONS.length); i++) {
  const q = QUESTIONS[i];
  const t0 = Date.now();
  let res = null;
  try {
    res = PROD ? await askProd(q) : await smartSearch({ q, env, deep: DEEP });
  } catch (e) {
    res = { ok: false, why: String((e && e.message) || e) };
  }
  const ms = Date.now() - t0;
  const src = (res && res.sources) || [];
  const dated = src.filter((s) => s.date);
  const reads = (res && res.reads) || [];
  if (res && res.ok) ok++;
  read += reads.length;
  withDate += dated.length;
  const newest = dated.map((s) => s.date).sort().pop() || '—';
  rows.push({ q, ok: !!(res && res.ok), engine: (res && res.engine) || '', src: src.length, read: reads.length, dated: dated.length, newest, ms });
  console.log(
    (res && res.ok ? '✔' : '✖') + ' ' + String(i + 1).padStart(2) + '. ' + q.padEnd(44)
    + ' источников ' + String(src.length).padStart(2)
    + (PROD ? '' : ' · прочитано ' + reads.length)
    + ' · с датой ' + String(dated.length).padStart(2) + ' · свежайшая ' + newest.padEnd(10)
    + ' ' + String(ms).padStart(6) + ' мс'
    + (PROD ? ' · ответ ' + String(((res && res.reply) || '').length) + ' зн.' : '')
    + (res && res.ok ? '' : '  (' + String((res && res.why) || 'нет ответа').slice(0, 60) + ')'),
  );
}

console.log('\nитого: вопросов ' + rows.length + ', ответили ' + ok
  + ', прочитано страниц ' + read + ', из них с датой ' + withDate
  + (read ? ' (' + Math.round((withDate / read) * 100) + ' %)' : ''));
if (!rows.length || ok < Math.ceil(rows.length * 0.6)) {
  console.log('стенд не пройден: поисковик ответил меньше чем на 60 % вопросов');
  process.exit(1);
}
if (read && withDate / read < 0.5) {
  console.log('внимание: у большинства страниц дата не прочитана — свежесть не видна (проверьте dateOf)');
  process.exit(1);
}
