/**
 * Поиск «как у Perplexity» (0.133): настоящий поисковик → чтение страниц → выдержки
 * под вопрос → ответ со сносками [n].
 *
 * Почему не скрейпинг выдачи. Замер из Cloudflare Workers 09.10.2026 (временный
 * воркер metiger-probe): DuckDuckGo html/lite отдают 202-заглушку проверки, Bing
 * HTML — страницу без результатов, Bing RSS — мусор не по теме (на «курс доллара» —
 * карточки Steam), Startpage — капчу, Qwant/Mojeek/Yep — 403, публичные SearXNG —
 * 429, Google — 429. Работают только поисковики, встроенные в модели, к которым у
 * проекта уже есть ключи:
 *   1) Gemini + инструмент google_search — выдача Google, ссылки и сводка за 3–6 с;
 *   2) Groq gpt-oss-120b + browser_search — сам ищет и открывает страницы, но ~15 с и
 *      дорого по дневным токенам (200k/сутки на ключ) — поэтому запасной.
 * Википедия (api.wikimedia.org) остаётся дополнением в tools.js.
 */
import { envKeys } from './providers.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE = new Map();             /* запрос → { at, res } на изолят */
const CACHE_MS = 10 * 60 * 1000;
let keyTurn = 0;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function fetchT(fi, url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
  try { return await fi(url, Object.assign({}, init || {}, { signal: ctrl.signal })); }
  finally { clearTimeout(t); }
}

/* ─────────────── 1) Gemini + Google Search ─────────────── */

export async function geminiSearch({ q, env, fetch: fi, ms }) {
  const keys = envKeys(env, 'GEMINI');
  if (!keys.length) return { ok: false, why: 'нет ключа Gemini' };
  const models = String((env && env.SEARCH_GEMINI_MODELS) || 'gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-2.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Сегодня ${today}. Найди в интернете самую свежую и точную информацию по запросу и изложи найденные факты: `
    + `коротко, пунктами (до 10), с цифрами, датами и названиями, без воды и без советов. Если источники расходятся — скажи. `
    + `Отвечай на языке запроса.\n\nЗапрос: ${q}`;
  let last = '';
  for (const model of models) {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[(keyTurn + k) % keys.length];
      try {
        const r = await fetchT(fi, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: Object.assign({ temperature: 0.2, maxOutputTokens: 900 }, /2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          }),
        }, ms || 9000);
        const txt = await r.text();
        if (r.status === 429 || r.status === 403 || r.status === 401) { last += 'gemini ' + model + ' http ' + r.status + ' ' + txt.slice(0, 120).replace(/\s+/g, ' ') + '; '; continue; }
        if (r.status >= 400) { last += 'gemini ' + model + ' http ' + r.status + ' ' + txt.slice(0, 120).replace(/\s+/g, ' ') + '; '; break; }  /* 404 — модель снята, пробуем следующую */
        const d = JSON.parse(txt);
        const c = (d.candidates || [])[0] || {};
        const text = ((c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
        const gm = c.groundingMetadata || {};
        const chunks = (gm.groundingChunks || []).map((x) => x.web).filter(Boolean);
        if (!text || !chunks.length) { last += 'gemini ' + model + ': без источников; '; break; }
        keyTurn++;
        const sources = await resolveAll(fi, chunks.map((w) => ({ title: clean(w.title), url: w.uri })));
        return { ok: true, engine: 'google', model, summary: text, queries: gm.webSearchQueries || [], sources };
      } catch (e) {
        last = 'gemini ' + model + ': ' + String((e && e.message) || e).slice(0, 60);
      }
    }
  }
  return { ok: false, why: last || 'gemini молчит' };
}

/* Ссылки Gemini — переадресация vertexaisearch.cloud.google.com/grounding-api-redirect/…;
   человеку нужен настоящий адрес. Читаем Location без перехода (быстро, ~0,2 с). */
async function resolveAll(fi, list) {
  const out = await Promise.all(list.slice(0, 8).map(async (s) => {
    if (!/grounding-api-redirect/.test(s.url)) return s;
    try {
      const r = await fetchT(fi, s.url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA } }, 2500);
      const loc = r.headers && r.headers.get && r.headers.get('location');
      if (loc && /^https?:\/\//.test(loc)) return { title: s.title, url: loc };
    } catch { /* остаётся переадресация — она тоже открывается */ }
    return s;
  }));
  const seen = new Set();
  return out.filter((s) => { if (!s.url || seen.has(s.url)) return false; seen.add(s.url); return true; });
}

/* ─────────────── 2) Groq gpt-oss-120b + browser_search (запасной) ─────────────── */

export async function groqSearch({ q, env, fetch: fi, ms }) {
  const keys = envKeys(env, 'GROQ');
  if (!keys.length) return { ok: false, why: 'нет ключа Groq' };
  let last = '';
  for (let k = 0; k < keys.length; k++) {
    const key = keys[(keyTurn + k) % keys.length];
    try {
      const r = await fetchT(fi, 'https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          reasoning_effort: 'low',
          max_completion_tokens: 900,
          tools: [{ type: 'browser_search' }],
          messages: [{ role: 'user', content: `Найди в интернете свежую точную информацию и перечисли факты пунктами с цифрами и датами. Запрос: ${q}` }],
        }),
      }, ms || 20000);
      const txt = await r.text();
      if (r.status === 429 || r.status === 401 || r.status === 403) { last = 'groq http ' + r.status; continue; }
      if (r.status >= 400) { last = 'groq http ' + r.status; break; }
      const d = JSON.parse(txt);
      const m = (d.choices && d.choices[0] && d.choices[0].message) || {};
      const sources = [];
      const seen = new Set();
      for (const t of m.executed_tools || []) {
        for (const x of ((t.search_results && t.search_results.results) || [])) {
          if (x.url && !seen.has(x.url) && /^https?:/.test(x.url)) { seen.add(x.url); sources.push({ title: clean(x.title).replace(/\s*-\s*viewing lines.*$/i, ''), url: x.url }); }
        }
      }
      const summary = String(m.content || '').replace(/【[^】]*】/g, '').trim();
      if (!summary) { last = 'groq: пусто'; continue; }
      return { ok: true, engine: 'groq', model: 'gpt-oss-120b', summary, queries: [], sources: sources.slice(0, 8) };
    } catch (e) {
      last = 'groq: ' + String((e && e.message) || e).slice(0, 60);
    }
  }
  return { ok: false, why: last || 'groq молчит' };
}

/* ─────────────── 3) чтение страниц и выдержки под вопрос ─────────────── */

export function pageText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&#?\w+;/g, ' ')
    .split('\n').map(clean).filter((l) => l.length > 40).join('\n');
}

const STOP = new Set('что как где кто когда какой какая какие какое это для или при над под про сколько сейчас сегодня есть был была были будет the and for with what how who when which from this that'.split(' '));
export function terms(q) {
  return String(q || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 6 ? w.slice(0, w.length - 2) : w));
}

/** Лучшие абзацы страницы под запрос: по совпадению основ слов, цифры — в плюс. */
export function bestPassages(text, q, n, max) {
  const ts = terms(q);
  if (!ts.length) return [];
  const paras = String(text || '').split('\n');
  const scored = paras.map((p, i) => {
    const low = p.toLowerCase();
    let s = 0;
    for (const t of ts) if (low.indexOf(t) >= 0) s += 1;
    if (/\d/.test(p)) s += 0.3;
    return { p, i, s };
  }).filter((x) => x.s >= Math.min(2, ts.length));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, n || 2).sort((a, b) => a.i - b.i).map((x) => (x.p.length > (max || 420) ? x.p.slice(0, max || 420).replace(/\s\S*$/, '') + '…' : x.p));
}

export async function readPages(fi, sources, q, o) {
  const opts = o || {};
  const top = sources.filter((s) => !/grounding-api-redirect|youtube\.com|vk\.com|t\.me\//.test(s.url)).slice(0, opts.pages || 3);
  const res = await Promise.all(top.map(async (s) => {
    try {
      const r = await fetchT(fi, s.url, { headers: { 'user-agent': UA, 'accept-language': 'ru,en;q=0.8', accept: 'text/html' } }, opts.ms || 3000);
      if (r.status >= 400) return null;
      const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (ct && !/html|text/.test(ct)) return null;
      const html = (await r.text()).slice(0, 600000);
      const passages = bestPassages(pageText(html), q, 2, 420);
      return passages.length ? { url: s.url, passages } : null;
    } catch { return null; }
  }));
  return res.filter(Boolean);
}

/* ─────────────── всё вместе ─────────────── */

/**
 * Поиск с чтением. Возвращает { ok, engine, summary, sources:[{title,url}], reads:[{url,passages}] }
 * или { ok:false, why }. Порядок: Gemini → Groq. Кэш 10 минут на изолят.
 */
export async function smartSearch({ q, env, fetch: fi, deep }) {
  const e = env || {};
  if (String(e.SMART_SEARCH || '') === 'off') return { ok: false, why: 'SMART_SEARCH=off' };
  const key = String(q || '').toLowerCase().trim();
  if (!key) return { ok: false, why: 'пустой запрос' };
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.res);
  const f = fi || ((...a) => fetch(...a));
  let res = await geminiSearch({ q, env: e, fetch: f });
  const why = [];
  if (!res.ok) { why.push(res.why); res = await groqSearch({ q, env: e, fetch: f }); }
  if (!res.ok) { why.push(res.why); return { ok: false, why: why.join('; ') }; }
  res.reads = await readPages(f, res.sources, q, { pages: deep ? 5 : 3, ms: deep ? 4000 : 3000 });
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(key, { at: Date.now(), res });
  return res;
}

/** Блок для модели: источники пронумерованы так же, как плашки под ответом. */
export function searchBlock(q, res) {
  const lines = [`Результаты поиска по запросу «${q}» (поисковик: ${res.engine === 'google' ? 'Google' : 'веб'}):`];
  res.sources.forEach((s, i) => {
    const read = (res.reads || []).find((r) => r.url === s.url);
    lines.push(`${i + 1}) ${s.title || s.url} (${s.url})`);
    if (read) for (const p of read.passages) lines.push(`   выдержка: ${p}`);
  });
  lines.push('', 'Сводка поисковика (опирайся на неё и на выдержки):', res.summary.slice(0, 2500));
  for (const r of res.reads || []) lines.push(`Выжимка из источника (${r.url}): ${r.passages[0].slice(0, 200)}`);
  return lines.join('\n');
}

export const SEARCH_DIRECTIVE = 'Отвечай по результатам поиска. После каждого факта ставь сноску с номером источника в квадратных скобках — [1], [2] — номера строго из списка источников. Не выдумывай того, чего нет в результатах; если данных нет или они расходятся, так и скажи. Сначала прямой ответ одной-двумя фразами, потом детали.';
