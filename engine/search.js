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
import { mapLimit, netCfg } from './netpool.js';
import * as locale from './locale.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE = new Map();             /* запрос → { at, res } на изолят */
/* Час, а не десять минут: человек спрашивает «курс доллара сегодня» трижды за
   вечер, и каждый раз платить за это тремя прочитанными страницами незачем.
   Свежесть при этом не страдает: число, увиденное час назад, — всё ещё «сегодня».
   Живой стенд (scripts/search-stand.mjs) гоняет вопросы по одному разу, кэш ему
   не мешает, а вот второй заход в тот же час был бы уже про кэш, а не про поиск. */
const CACHE_MS = 60 * 60 * 1000;
let keyTurn = 0;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function fetchT(fi, url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
  try { return await fi(url, Object.assign({}, init || {}, { signal: ctrl.signal })); }
  finally { clearTimeout(t); }
}

const clampSearchInt = (v, min, max, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/**
 * Профиль поиска (0.212). Раньше «глубокий» значил только 5 страниц вместо 3:
 * надпись была шире работы. Теперь у каждого уровня свой полный бюджет —
 * источники, страницы, выдержки и длина сводки; исследование получает ещё и
 * несколько подзапросов в `researchSearch` ниже.
 */
export function searchProfile(env, levelOrProfile) {
  const given = levelOrProfile && typeof levelOrProfile === 'object' ? levelOrProfile : {};
  const level = typeof levelOrProfile === 'string'
    ? levelOrProfile
    : String(given.level || 'standard');
  const base = level === 'research'
    ? { level, queries: 4, maxSources: 14, pages: 8, passages: 3, passageChars: 700, summaryChars: 6500, readMs: 6500 }
    : level === 'deep'
      ? { level, queries: 1, maxSources: 10, pages: 6, passages: 3, passageChars: 560, summaryChars: 4000, readMs: 5000 }
      : { level: 'standard', queries: 1, maxSources: 8, pages: 3, passages: 2, passageChars: 420, summaryChars: 2500, readMs: 3000 };
  const e = env || {};
  return {
    ...base,
    queries: clampSearchInt(given.queries ?? e.SEARCH_RESEARCH_QUERIES, 1, 6, base.queries),
    maxSources: clampSearchInt(given.maxSources ?? e.SEARCH_MAX_SOURCES, 1, 24, base.maxSources),
    pages: clampSearchInt(given.pages ?? e.SEARCH_READ_PAGES, 0, 12, base.pages),
    passages: clampSearchInt(given.passages, 1, 5, base.passages),
    passageChars: clampSearchInt(given.passageChars, 160, 1200, base.passageChars),
    summaryChars: clampSearchInt(given.summaryChars, 500, 12000, base.summaryChars),
    readMs: clampSearchInt(given.readMs ?? given.ms, 800, 12000, base.readMs),
  };
}

/* ─────────────── 1) Gemini + Google Search ─────────────── */

export async function geminiSearch({ q, env, fetch: fi, ms, maxSources, resolveSources = true }) {
  /* Ключ ПОИСКА отдельно от ключа чата (0.199). На проде 17.10 разговорная
     модель отвечала из той же квоты Gemini, что и google_search: поиск выедал
     её первым и падал в 429 — а вместе с ним «свежесть» всего приложения.
     Свои GEMINI_SEARCH_KEYS/KEY разводят квоты; без них — прежний общий ключ. */
  const own = envKeys(env, 'GEMINI_SEARCH');
  const keys = own.length ? own : envKeys(env, 'GEMINI');
  if (!keys.length) return { ok: false, why: 'нет ключа Gemini' };
  const models = String((env && env.SEARCH_GEMINI_MODELS) || 'gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-2.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const loc = locale.searchPrompt(q);
  const prompt = `Сегодня ${today}. Найди в интернете самую свежую и точную информацию по запросу и изложи найденные факты: `
    + `коротко, пунктами (до 10), с цифрами, датами и названиями, без воды и без советов. Если источники расходятся — скажи. `
    /* Живой стенд 12 окт: по белорусским темам выдача уходила в энциклопедию —
       «цена бензина» приводила к статьям про кризис 2011 года. Просим отдавать
       предпочтение свежему и официальному и называть, на какую дату данные: это
       меняет и выбор страниц, и то, что модель говорит человеку. */
    + `Отдавай предпочтение свежим и официальным источникам (сайты ведомств, банков, статистики, погодных служб, новости этого года) `
    + `и в ответе обязательно указывай, на какую дату (число, месяц, год) приведены данные. `
    + `Отвечай на языке запроса.`
    + (loc ? ' ' + loc : '')
    + `\n\nЗапрос: ${q}`;
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
        if (r.status >= 400) {
          last += 'gemini ' + model + ' http ' + r.status + ' ' + txt.slice(0, 120).replace(/\s+/g, ' ') + '; ';
          /* 404/410 — модели больше нет в каталоге: пробуем СЛЕДУЮЩУЮ. Комментарий
             обещал это с самого начала, а `break` сдавался после первой же: одна
             снятая модель из списка гасила весь путь Gemini + Google Search. */
          if (r.status === 404 || r.status === 410) continue;
          break;
        }
        const d = JSON.parse(txt);
        const c = (d.candidates || [])[0] || {};
        const text = ((c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
        const gm = c.groundingMetadata || {};
        const chunks = (gm.groundingChunks || []).map((x) => x.web).filter(Boolean);
        if (!text || !chunks.length) { last += 'gemini ' + model + ': без источников; '; break; }
        keyTurn++;
        const rawSources = chunks.map((w) => ({ title: clean(w.title), url: w.uri }));
        /* Исследование сначала сливает подзапросы и только потом разрешает
           редиректы у финальных кандидатов. Разрешение внутри каждого
           подзапроса стоило до 14 fetch на запрос: четыре подзапроса съедали
           лимит подзапросов Pages ещё до первого вызова модели. */
        const sources = resolveSources
          ? await resolveAll(fi, rawSources, maxSources)
          : rawSources.slice(0, clampSearchInt(maxSources, 1, 24, 8));
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
async function resolveAll(fi, list, maxSources) {
  const cap = clampSearchInt(maxSources, 1, 24, 8);
  const out = await Promise.all(list.slice(0, cap).map(async (s) => {
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

export async function groqSearch({ q, env, fetch: fi, ms, maxSources }) {
  /* Тот же принцип: browser_search дорог по дневным токенам, ему — свой ключ. */
  const ownG = envKeys(env, 'GROQ_SEARCH');
  const keys = ownG.length ? ownG : envKeys(env, 'GROQ');
  if (!keys.length) return { ok: false, why: 'нет ключа Groq' };
  const loc = locale.searchPrompt(q);
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
          messages: [{ role: 'user', content: `Найди в интернете свежую точную информацию и перечисли факты пунктами с цифрами и датами; предпочитай официальные источники и назови, на какую дату данные.${loc ? ' ' + loc : ''} Запрос: ${q}` }],
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
      return { ok: true, engine: 'groq', model: 'gpt-oss-120b', summary, queries: [], sources: sources.slice(0, clampSearchInt(maxSources, 1, 24, 8)) };
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
/**
 * Дата публикации или обновления страницы — из её же разметки (0.163).
 *
 * Зачем: «свежие данные» — то, ради чего человек идёт в поиск, а поисковик даёт
 * ссылки без дат. Без даты модель не отличает вчерашнюю новость от статьи
 * трёхлетней давности и отвечает по устаревшему как по текущему.
 *
 * Правило одно: дату берём ТОЛЬКО из разметки страницы (мета-теги, <time>,
 * микроразметка) или из подписи «обновлено …» рядом с началом текста. Не нашли —
 * пусто: выдуманная дата хуже отсутствия даты.
 */
export function dateOf(html) {
  const h = String(html || '');
  const raw = (re) => {
    const m = re.exec(h);
    return m && m[1] ? saneDate(m[1]) : '';
  };
  let d = raw(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|article:modified_time|og:updated_time|datePublished|dateModified|pubdate|date|last-modified)["'][^>]*content=["']([^"']+)["']/i);
  if (!d) d = raw(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|article:modified_time|og:updated_time|datePublished|dateModified|pubdate|date)["']/i);
  if (!d) d = raw(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (!d) d = raw(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (!d) d = raw(/"dateModified"\s*:\s*"([^"]+)"/i);
  if (!d) {
    const txt = pageText(h).slice(0, 3000);
    const m = /(?:обновлено|опубликовано|дата)[^0-9]{0,25}(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i.exec(txt);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return m[3] + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
    }
  }
  return d;
}

/** С какого возраста источник считается давним: полтора года. */
export const STALE_DAYS = 545;

/**
 * Дата из адреса страницы (0.231): `react.dev/blog/2026/09/09/react-19-3` — это
 * 2026-09-09, а мета-тега с датой на странице может не быть вовсе. Год берём
 * только явным сегментом пути: «/20» внутри id — не дата.
 */
export function dateFromUrl(url) {
  const u = String(url || '');
  const full = /(?:^|[^0-9])(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:[^0-9]|$)/.exec(u);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y <= new Date().getFullYear() + 1) {
      return full[1] + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }
  /* Месяц без дня: «/2020/05/hello» — это май 2020-го. Число месяца не выдумываем,
     ставим первое: для возраста источника точность до дня не нужна. */
  const month = /(?:^|[^0-9])(20\d{2})[/-](\d{1,2})(?:[/-]|[^0-9]|$)/.exec(u);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    if (y >= 1995 && y <= new Date().getFullYear() + 1 && m >= 1 && m <= 12) {
      return month[1] + '-' + String(m).padStart(2, '0') + '-01';
    }
  }
  const year = /(?:^|\/(?:blog|news|posts?|articles?|p)?[/-]?)(20\d{2})(?:[/?&#-]|$)/i.exec(u);
  if (year) {
    const y = Number(year[1]);
    if (y >= 1995 && y <= new Date().getFullYear() + 1) return String(y) + '-01-01';
  }
  return '';
}

/**
 * Возраст источника по дате страницы (0.180 «Свежесть»).
 *
 * Зачем. Дата у ссылки уже была, но человек читал «· от 2019-04-02» и не понимал,
 * свежие это сведения или нет — а разница между вчера и семь лет назад в ответе
 * про цены и законы решающая. Считаем возраст и прямо называем старый источник
 * старым: и человеку в ответе, и модели в блоке (ей сказано сказать об этом
 * человеку). `old` — не «плохой», а «проверь, прежде чем опираться».
 */
export function sourceAge(dateISO, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || '').trim());
  if (!m) return { days: 0, months: 0, years: 0, old: false };
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.max(0, Math.floor(((Number(now) || Date.now()) - t) / 86400000));
  return { days, months: Math.floor(days / 30.44), years: Math.floor(days / 365.25), old: days >= STALE_DAYS };
}

/**
 * Сноски `[N]` без источника (0.231).
 *
 * Голова иногда ставит номер, которого в списке нет («[6]» при пяти плашках), и
 * человек видит серую цифру, ведущую в никуда. Клиент такую сноску оставлял
 * текстом намеренно — но лучше её не показывать вовсе: у неё нет адреса.
 * Сверяем номера с настоящим числом источников и снимаем только выходящие за
 * список; ссылки `[1](url)` не трогаем, это готовая разметка.
 */
export function cleanCitations(reply, count) {
  const n = Math.max(0, Number(count) || 0);
  const text = String(reply || '');
  if (!text) return text;
  return text
    .replace(/\[(\d{1,2})\](?!\()/g, (m, d) => {
      const k = Number(d);
      return k >= 1 && k <= n ? m : '';
    })
    /* «факт [6] .» и «факт [6],» — после снятия номера лишний пробел перед знаком
       остаётся висеть. */
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/([(\[])[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}

/** Строка даты в безопасный вид: только разумные годы, иначе пусто. */
function saneDate(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const y = m ? Number(m[1]) : (/^\d{4}$/.test(t) ? Number(t) : 0);
  if (!y || y < 1995 || y > new Date().getFullYear() + 1) return '';
  if (m && (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31)) return '';
  return m ? m[1] + '-' + m[2] + '-' + m[3] : String(y) + '-01-01';
}

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
      const passages = bestPassages(pageText(html), q, opts.passages || 2, opts.passageChars || 420);
      const date = dateOf(html) || dateFromUrl(s.url);
      return passages.length ? { url: s.url, passages, date } : null;
    } catch { return null; }
  }));
  return res.filter(Boolean);
}

/* ─────────────── всё вместе ─────────────── */

function attachDates(res) {
  /* Дата прочитанной страницы приклеивается к источнику: под ответом и в самом
     блоке поиска человек и модель видят, насколько сведения свежие. Если мета-тега
     на странице нет, дату берём из адреса (0.231). Заодно источники схлопываются
     по адресу: две записи на одну страницу ломали нумерацию — голова ставила «[6]»
     по строке блока, а плашек под ответом было пять. */
  const out = [];
  const seen = new Set();
  for (const s of res.sources || []) {
    if (!s || !s.url) continue;
    const key = canonicalUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const r = (res.reads || []).find((x) => canonicalUrl(x.url) === key);
    if (r && r.date) s.date = r.date;
    else if (!s.date) {
      const d = dateFromUrl(s.url);
      if (d) s.date = d;
    }
    out.push(s);
  }
  res.sources = out;
  return res;
}

async function searchOnce({ q, env, fetch: f, profile, resolveSources = true }) {
  let res = await geminiSearch({ q, env, fetch: f, maxSources: profile.maxSources, resolveSources });
  const why = [];
  if (!res.ok) {
    why.push(res.why);
    res = await groqSearch({ q, env, fetch: f, maxSources: profile.maxSources });
  }
  if (!res.ok) { why.push(res.why); return { ok: false, why: why.join('; ') }; }
  return res;
}

function cacheKey(prefix, value, profile) {
  return prefix + ':' + profile.level + ':' + profile.maxSources + '/' + profile.pages + '/' + profile.passages
    + ':' + String(value || '').toLowerCase().trim();
}

function remember(key, res) {
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(key, { at: Date.now(), res });
  return res;
}

/**
 * Поиск с чтением. Возвращает { ok, engine, summary, sources:[{title,url}], reads:[{url,passages}] }
 * или { ok:false, why }. Порядок: Gemini → Groq. Кэш — час на изолят и
 * ОТДЕЛЬНО на уровень: обычный результат больше не подменяет глубокий.
 */
export async function smartSearch({ q, env, fetch: fi, deep, level, profile: givenProfile }) {
  const e = env || {};
  if (String(e.SMART_SEARCH || '') === 'off') return { ok: false, why: 'SMART_SEARCH=off' };
  const profile = searchProfile(e, givenProfile || level || (deep ? 'deep' : 'standard'));
  const key = cacheKey('one', q, profile);
  if (!String(q || '').trim()) return { ok: false, why: 'пустой запрос' };
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.res);
  const f = fi || ((...a) => fetch(...a));
  const res = await searchOnce({ q, env: e, fetch: f, profile });
  if (!res.ok) return res;
  res.reads = await readPages(f, res.sources, q, {
    pages: profile.pages, ms: profile.readMs,
    passages: profile.passages, passageChars: profile.passageChars,
  });
  res.profile = profile;
  return remember(key, attachDates(res));
}

function canonicalUrl(raw) {
  const s = String(raw || '').trim();
  try {
    const u = new URL(s);
    u.hash = '';
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^utm_/i.test(k) || /^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return s.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function mergeResearchSources(parts, maxSources) {
  const byUrl = new Map();
  let seenAt = 0;
  for (const part of parts) {
    const sources = (part.res && part.res.sources) || [];
    sources.forEach((s, rank) => {
      if (!s || !s.url) return;
      const key = canonicalUrl(s.url);
      const prev = byUrl.get(key);
      const official = /(^|\.)gov(\.|$)|(^|\.)edu(\.|$)|(^|\.)gov\.[a-z]{2}$/i.test(key) ? 2 : 0;
      const score = Math.max(0, 12 - rank) + official;
      if (!prev) {
        byUrl.set(key, { title: s.title || s.url, url: s.url, score, seenAt: seenAt++, queries: new Set([part.query]) });
      } else {
        prev.score += score + 5;              /* независимые подзапросы сошлись на одном источнике */
        prev.queries.add(part.query);
        if ((!prev.title || prev.title === prev.url) && s.title) prev.title = s.title;
      }
    });
  }
  return Array.from(byUrl.values())
    .sort((a, b) => (b.score - a.score) || (a.seenAt - b.seenAt))
    .slice(0, maxSources)
    .map(({ title, url }) => ({ title, url }));
}

/** Разрешить финальных кандидатов порциями и остановиться на нужном числе
 * уникальных страниц. Разные grounding-редиректы могут вести на один URL:
 * порции позволяют добрать следующий кандидат, не оплачивая разрешение всего
 * сырого пула каждого подзапроса. */
async function resolveResearchCandidates(fi, candidates, maxSources) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < candidates.length && out.length < maxSources; i += 4) {
    const batch = await resolveAll(fi, candidates.slice(i, i + 4), 4);
    for (const s of batch) {
      const key = canonicalUrl(s.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= maxSources) break;
    }
  }
  return out;
}

/**
 * Глубокое исследование (0.212): несколько подзапросов → один очищенный список
 * источников → чтение страниц один раз. Важен именно порядок: если читать
 * страницы внутри каждого подзапроса, дубли съедят бюджет, а модель получит
 * четыре пересказа одной страницы вместо широкой картины.
 */
export async function researchSearch({ q, queries, env, fetch: fi, profile: givenProfile }) {
  const e = env || {};
  if (String(e.SMART_SEARCH || '') === 'off') return { ok: false, why: 'SMART_SEARCH=off' };
  const profile = searchProfile(e, givenProfile || 'research');
  const qs = Array.from(new Set((Array.isArray(queries) && queries.length ? queries : [q])
    .map((x) => clean(x)).filter(Boolean))).slice(0, profile.queries);
  if (!qs.length) return { ok: false, why: 'пустой запрос' };
  const key = cacheKey('research', qs.join('\n'), profile);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.res);

  const f = fi || ((...a) => fetch(...a));
  const parts = await mapLimit(qs, netCfg(e).search, async (query) => {
    try { return { query, res: await searchOnce({ q: query, env: e, fetch: f, profile, resolveSources: false }) }; }
    catch (err) { return { query, res: { ok: false, why: String((err && err.message) || err) } }; }
  });
  const good = parts.filter((p) => p.res && p.res.ok && Array.isArray(p.res.sources) && p.res.sources.length);
  if (!good.length) {
    return { ok: false, why: parts.map((p) => p.query + ': ' + (p.res && p.res.why || 'нет источников')).join('; ') };
  }

  /* Кандидатов берём с запасом на дубли после разрешения редиректов, но с
     жёстким сетевым потолком 24: исследование не должно съесть лимит
     подзапросов до вызова модели. Разрешение идёт порциями и останавливается,
     как только уникальных источников достаточно. */
  const candidateCap = Math.min(24, profile.maxSources + 10);
  const candidates = mergeResearchSources(good, candidateCap);
  const sources = await resolveResearchCandidates(f, candidates, profile.maxSources);
  const reads = await readPages(f, sources, [q].concat(qs).join('\n'), {
    pages: profile.pages, ms: profile.readMs,
    passages: profile.passages, passageChars: profile.passageChars,
  });
  const engines = Array.from(new Set(good.map((p) => p.res.engine).filter(Boolean)));
  const res = {
    ok: true,
    research: true,
    engine: engines.length === 1 ? engines[0] : 'research',
    engines,
    queries: qs,
    summaries: good.map((p) => ({ query: p.query, summary: String(p.res.summary || '') })),
    gaps: parts.filter((p) => !(p.res && p.res.ok)).map((p) => p.query),
    summary: good.map((p) => String(p.res.summary || '')).join('\n'),
    sources,
    reads,
    profile,
  };
  return remember(key, attachDates(res));
}

/** Возраст источника словами: «6 лет назад», «8 месяцев назад», «3 недели назад». */
export function ageWords(age) {
  const a = age || {};
  const years = Number(a.years) || 0;
  const months = Number(a.months) || 0;
  const days = Number(a.days) || 0;
  if (years >= 1) return years + ' ' + (years % 10 === 1 && years % 100 !== 11 ? 'год' : (years % 10 >= 2 && years % 10 <= 4 && (years % 100 < 10 || years % 100 >= 20) ? 'года' : 'лет')) + ' назад';
  if (months >= 1) return months + ' мес. назад';
  if (days >= 14) return Math.floor(days / 7) + ' нед. назад';
  if (days >= 1) return days + ' дн. назад';
  return 'этого дня';
}

/** Блок для модели: источники пронумерованы так же, как плашки под ответом. */
export function searchBlock(q, res) {
  const profile = res.profile || {};
  const lines = [res.research
    ? `Глубокое исследование по запросу «${q}» (поисковик: ${res.engine === 'google' ? 'Google' : 'несколько поисков'}):`
    : `Результаты поиска по запросу «${q}» (поисковик: ${res.engine === 'google' ? 'Google' : 'веб'}):`];
  if (res.research && Array.isArray(res.queries) && res.queries.length) {
    lines.push('Проверенные подзапросы:');
    for (const query of res.queries) lines.push('• ' + query);
    lines.push('');
  }
  res.sources.forEach((s, i) => {
    const read = (res.reads || []).find((r) => r.url === s.url);
    /* Давний источник помечаем прямо в строке: модель видит пометку там же, где
       берёт факты, — иначе «• от 2019-…» проходит мимо неё так же, как мимо глаза. */
    const age = s.date ? sourceAge(s.date) : null;
    const when = age ? ' · ' + ageWords(age) : '';
    const mark = age && age.old ? ' · ДАВНИЙ источник: данные могли устареть' : '';
    lines.push(`${i + 1}) ${s.title || s.url} (${s.url}${s.date ? ' · от ' + s.date + when : ''}${mark})`);
    if (read) for (const p of read.passages) lines.push(`   выдержка: ${p}`);
  });
  lines.push('', 'У источников через «· от» указана дата публикации или обновления, где она есть. '
    + 'Если данные явно старые (больше года) — скажи об этом человеку словами: на какой год они актуальны. '
    + 'У источника с пометкой «ДАВНИЙ» свежесть под вопросом: опирайся на более свежие источники, '
    + 'а если свежих нет — честно предупреди, что сведения старого года.');

  if (res.research && Array.isArray(res.summaries) && res.summaries.length) {
    const total = profile.summaryChars || 6500;
    const each = Math.max(700, Math.floor(total / res.summaries.length));
    lines.push('', 'Сводки по подзапросам (сверяй их с выдержками, а не пересказывай по очереди):');
    for (const x of res.summaries) {
      lines.push('— ' + x.query + ':', String(x.summary || '').slice(0, each));
    }
    if (Array.isArray(res.gaps) && res.gaps.length) {
      lines.push('', 'Не удалось проверить подзапросы: ' + res.gaps.join('; ') + '. Назови этот пробел человеку, а не заполняй его догадкой.');
    }
  } else {
    lines.push('', 'Сводка поисковика (опирайся на неё и на выдержки):', String(res.summary || '').slice(0, profile.summaryChars || 2500));
  }
  for (const r of res.reads || []) lines.push(`Выжимка из источника (${r.url}): ${r.passages[0].slice(0, res.research ? 240 : 200)}`);
  return lines.join('\n');
}

export const SEARCH_DIRECTIVE = 'Отвечай по результатам поиска. После каждого факта ставь сноску с номером источника в квадратных скобках — [1], [2] — номера строго из списка источников. Не выдумывай того, чего нет в результатах; если данных нет или они расходятся, так и скажи. Сначала прямой ответ одной-двумя фразами, потом детали.';

export const RESEARCH_DIRECTIVE = 'Это глубокое исследование, а не один поиск. Сначала дай короткий вывод, затем доказательства по подвопросам, отдельно — где источники расходятся и что проверить не удалось. После каждого проверяемого факта ставь [номер] строго из списка, даты называй явно. Пересказы одного первоисточника не выдавай за независимые подтверждения; чего в результатах нет, не выдумывай.';
