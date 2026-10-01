/**
 * Инструменты агента — пачка 1 (v0.006).
 *
 * Инструменты не переключаются в настройках: агент сам решает по тексту задачи,
 * нужен ли внешний контекст. Слой честный до конца: ошибка или пустой ответ
 * инструмента — это «нет данных», а не выдумка; движок в этом случае просто
 * спрашивает модель без подсказки.
 *
 * Правила слоя:
 *   • ни один инструмент не бросает исключений — только null/пусто;
 *   • сеть — всегда через внедрённый fetch (в Worker его нет глобально в тестах);
 *   • у каждого запроса жёсткий таймаут: инструмент не имеет права съесть бюджет
 *     ответа модели;
 *   • данные вкладываются в сообщение человека блоком [Инструмент: …], чтобы
 *     модель видела их как источник, а не как свои знания.
 */

const TIMEOUT_MS = 7000;

/* Часть сайтов (включая поисковики) 403-ит запросы из дата-центров без живого
   User-Agent — из Workers это как раз наш случай. UA и Accept ставим всегда. */
const UA = {
  'user-agent': 'Mozilla/5.0 (compatible; MeTigerAi/0.006; +https://metiger-ai.pages.dev)',
  accept: 'application/json, text/html;q=0.9, */*;q=0.5',
};

function fetchT(fetchImpl, url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout || TIMEOUT_MS);
  return fetchImpl(url, {
    ...opts,
    headers: { ...UA, ...(opts.headers || {}) },
    signal: ac.signal,
  }).finally(() => clearTimeout(t));
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Стоп-слова для поисковых запросов: из текста человека остаётся только суть. */
const STOP = new Set([
  'в', 'во', 'на', 'и', 'а', 'но', 'про', 'об', 'о', 'мне', 'найди', 'найти', 'расскажи', 'рассказать',
  'пожалуйста', 'что', 'такое', 'кто', 'такой', 'такая', 'это', 'так', 'как', 'давай', 'будь', 'дай',
  'покажи', 'последние', 'последняя', 'свежие', 'свежие', 'новости', 'новость', 'новых', 'новое',
  'википедии', 'википедия', 'включи', 'поищи', 'погугли', 'интернете', 'интернет', 'сети',
  'информацию', 'информация', 'даннные', 'данные', 'актуальные', 'актуальную', 'сегодня', 'посмотри',
]);

/** Запрос инструмента: значимые слова текста без служебных. */
function queryOf(text, extraStop) {
  const stop = extraStop ? new Set([...STOP, ...extraStop]) : STOP;
  const words = String(text || '')
    .toLowerCase()
    .split(/[^а-яёa-z0-9]+/i)
    .filter((w) => w && w.length > 1 && !stop.has(w));
  return clean(words.join(' ')).slice(0, 120);
}

export const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/* ============================== вычисления ============================== */

/** Рекурсивный спуск: + - * / ^ % ( ), запятая как десятичная точка. Без eval. */
export function evalExpr(src) {
  const s = String(src || '').replace(/,/g, '.').replace(/\s+/g, '');
  if (!s || s.length > 120 || !/\d/.test(s) || !/[+\-*/^%()]/.test(s)) return null;
  if (!/^[\d.+\-*/^%()]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const eat = (ch) => (s[i] === ch ? (i++, true) : false);
  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parsePow();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const r = parsePow();
      if ((op === '/' || op === '%') && r === 0) return NaN;
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parsePow() {
    let v = parseUnary();
    if (eat('^')) v = Math.pow(v, parsePow());
    return v;
  }
  function parseUnary() {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parseAtom();
  }
  function parseAtom() {
    if (eat('(')) {
      const v = parseExpr();
      if (!eat(')')) return NaN;
      return v;
    }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return Number(m[0]);
  }
  const out = parseExpr();
  if (i !== s.length || !Number.isFinite(out)) return null;
  return out;
}

const fmtNum = (n) => {
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
};

/* ============================== дата/время ============================== */

const WEEKDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/* ============================== погода ============================== */

const WMO = {
  0: 'ясно', 1: 'малооблачно', 2: 'переменная облачность', 3: 'пасмурно',
  45: 'туман', 48: 'изморозь', 51: 'морось', 53: 'морось', 55: 'сильная морось',
  61: 'дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'ледяной дождь', 67: 'ледяной дождь',
  71: 'снег', 73: 'снег', 75: 'сильный снег', 77: 'снежные зёрна',
  80: 'ливень', 81: 'ливень', 82: 'сильный ливень', 85: 'снегопад', 86: 'сильный снегопад',
  95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза с градом',
};

/* ============================== инструменты ============================== */

export const TOOLS = [
  {
    id: 'time',
    title: 'Дата и время',
    when: (t) => /который час|какое\s+(сегодня\s+)?(число|время|дата)|какой\s+(сегодня\s+)?(день|дата)|сегодняшн\w+\s+дата|what(?:'s| is)\s+(the\s+)?(time|date)/i.test(t),
    async run({ env }) {
      const tz = (env && env.TZ_NAME) || 'Europe/Minsk';
      const now = new Date();
      const day = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
      const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now));
      const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);
      return `Сейчас ${WEEKDAY[wdIdx < 0 ? 0 : wdIdx]}, ${day}, ${time} (${tz}).`;
    },
  },
  {
    id: 'calc',
    title: 'Калькулятор',
    when: (t) => /посчитай|сколько будет|вычисли|калькулятор/i.test(t) || /\d\s*[-+*/^%(]\s*[\d(]/.test(t),
    async run({ text }) {
      const m = /(?:\d[\d\s.,]*\s*[-+*/^%()]\s*[-+*/^%()\s\d.,+]{1,60})/.exec(String(text || ''));
      const expr = m ? m[0].replace(/\s*=\s*$/, '') : null;
      if (!expr) return null;
      const val = evalExpr(expr);
      if (val === null) return null;
      return `${expr.trim()} = ${fmtNum(val)}`;
    },
  },
  {
    id: 'currency',
    title: 'Курсы валют',
    when: (t) => /курс|валют|обмен/i.test(t) && /доллар|евро|рубл|юан|гривн|злот|фунт|byn|usd|eur|rub|cny|\$/i.test(t),
    async run({ text, fetch: fi }) {
      const base = /рубл/i.test(text) && !/белар|byn/i.test(text) ? 'RUB' : 'BYN';
      const r = await fetchT(fi, `https://open.er-api.com/v6/latest/${base}`);
      const j = await r.json();
      const rates = (j && j.rates) || null;
      if (!rates) return null;
      const want = ['USD', 'EUR', 'BYN', 'RUB', 'CNY', 'PLN', 'UAH'].filter((c) => c !== base);
      /* er-api отдаёт «сколько валюты в 1 единице базы» — для человека переворачиваем:
         «1 USD = X BYN», а не наоборот. */
      const parts = want
        .filter((c) => rates[c] > 0)
        .map((c) => `1 ${c} = ${fmtNum(Math.round((1 / rates[c]) * 10000) / 10000)} ${base}`);
      return parts.length ? `Курсы на сегодня (база ${base}): ${parts.join(', ')}.` : null;
    },
  },
  {
    id: 'random',
    title: 'Случайность',
    when: (t) => /кубик|брось\s+кост|d20|случайное\s+число|рандом|монетк|подбрось/i.test(t),
    async run({ text }) {
      const t = String(text || '');
      const dice = /d(\d{1,3})/i.exec(t) || /кубик\w*\s+на\s+(\d{1,3})/i.exec(t);
      if (dice) {
        const n = Math.max(2, Math.min(1000, Number(dice[1])));
        return `Кубик d${n}: выпало ${1 + Math.floor(Math.random() * n)}.`;
      }
      if (/монетк|подбрось|ор[ёе]л|решк/i.test(t)) {
        return `Монетка: ${Math.random() < 0.5 ? 'орёл' : 'решка'}.`;
      }
      const range = /от\s+(\d+)\s+до\s+(\d+)/i.exec(t);
      const a = range ? Number(range[1]) : 1;
      const b = range ? Number(range[2]) : 100;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return `Случайное число от ${lo} до ${hi}: ${lo + Math.floor(Math.random() * (hi - lo + 1))}.`;
    },
  },
  {
    id: 'weather',
    title: 'Погода',
    when: (t) => /погод|weather/i.test(t) || /температур[аы]\s+(за окном|сейчас|сегодня)/i.test(t),
    async run({ text, env, fetch: fi }) {
      const m = /погод\w*\s+(?:в|во|для)\s+([а-яёa-z][а-яёa-z-]{1,40})/i.exec(String(text || ''));
      const cityRaw = (m && m[1]) || (env && env.WEATHER_CITY) || 'Минск';
      /* «погода в варшаве» — город в падеже; пробуем и как есть, и без типичных окончаний. */
      const candidates = [cityRaw];
      const base = cityRaw.replace(/(е|у|ы|и|ю|я|ой|ей|ем|ом|ах|ях)$/i, '');
      if (base.length >= 3 && base !== cityRaw) candidates.push(base);
      let place = null;
      for (const name of candidates) {
        const g = await fetchT(fi, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=ru`);
        const gj = await g.json().catch(() => null);
        if (gj && gj.results && gj.results[0]) { place = gj.results[0]; break; }
      }
      if (!place) return `Город «${cityRaw}» не нашёл в базе погоды.`;
      const w = await fetchT(fi, `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`);
      const wj = await w.json();
      const c = wj && wj.current;
      const d = wj && wj.daily;
      if (!c) return null;
      const sky = WMO[c.weather_code] || '—';
      const day = d ? `, днём до ${Math.round(d.temperature_2m_max[0])}°C, ночью до ${Math.round(d.temperature_2m_min[0])}°C` : '';
      return `${place.name} сейчас: ${Math.round(c.temperature_2m)}°C (ощущается ${Math.round(c.apparent_temperature)}°C), ${sky}, ветер ${Math.round(c.wind_speed_10m)} м/с, осадки ${c.precipitation} мм${day}.`;
    },
  },
  {
    id: 'wikipedia',
    title: 'Википедия',
    when: (t) => /википед|wikipedia/i.test(t),
    async run({ text, fetch: fi }) {
      const q = queryOf(text);
      if (!q) return null;
      const r = await fetchT(fi, `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
      const j = await r.json().catch(() => null);
      if (!j || !j.extract) return null;
      const url = (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || '';
      return `${j.title}: ${j.extract}${url ? `\nИсточник: ${url}` : ''}`;
    },
  },
  {
    id: 'url',
    title: 'Чтение страницы',
    when: (t) => URL_RE.test(t),
    async run({ text, fetch: fi }) {
      const url = URL_RE.exec(String(text || ''))[0];
      const r = await fetchT(fi, url);
      const html = await r.text();
      if (!html) return null;
      const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
      const desc = clean(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] || '');
      const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#?\w+;/g, ' ');
      const frag = clean(body).slice(0, 3200);
      if (!title && !frag) return null;
      return `Страница: ${title || url}\nURL: ${url}${desc ? `\nОписание: ${desc}` : ''}\nТекст: ${frag}`;
    },
  },
  {
    id: 'news',
    title: 'Новости',
    when: (t) => /новост|news/i.test(t),
    async run({ text, env, fetch: fi }) {
      const q = queryOf(text) || 'последние новости';
      const gkey = env && env.GNEWS_KEY;
      if (gkey) {
        const r = await fetchT(fi, `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=ru&max=5&token=${gkey}`);
        const j = await r.json().catch(() => null);
        const arts = (j && j.articles) || [];
        if (arts.length) {
          return arts.slice(0, 5).map((a, i) =>
            `${i + 1}) ${clean(a.title)} — ${clean(a.description).slice(0, 160)} (${a.publishedAt ? a.publishedAt.slice(0, 10) : '—'}; ${a.url})`).join('\n');
        }
      }
      const nkey = env && env.NEWSDATA_KEY;
      if (nkey) {
        const r = await fetchT(fi, `https://newsdata.io/api/1/latest?language=ru&q=${encodeURIComponent(q)}&apikey=${nkey}`);
        const j = await r.json().catch(() => null);
        const arts = (j && j.results) || [];
        if (arts.length) {
          return arts.slice(0, 5).map((a, i) =>
            `${i + 1}) ${clean(a.title)} — ${clean(a.description).slice(0, 160)} (${a.pubDate ? String(a.pubDate).slice(0, 10) : '—'}; ${a.link})`).join('\n');
        }
      }
      return null;
    },
  },
  {
    id: 'web-search',
    title: 'Веб-поиск',
    when: (t) => /найди в интернете|найди в сети|погугли|поищи|поиск[аи]?\s+в\s+интернете|search\s+the\s+web|найди информацию|актуальн\w*\s+данн|последн\w+\s+(верси|данн|инфо)/i.test(t),
    async run({ text, fetch: fi }) {
      const q = queryOf(text);
      if (!q) return null;
      const out = [];
      /* Источники по порядку надёжности из Workers: поиск Wikimedia REST (тот же
         контур, что у живой вики), потом DDG IA (хорош на английском), потом
         lite-выдача DDG. Action API википедии из CF не отвечает — не используем. */
      const wikiSearch = async (lang) => {
        const r = await fetchT(fi, `https://api.wikimedia.org/core/v1/wikipedia/${lang}/search/page?q=${encodeURIComponent(q)}&limit=5`);
        const j = await r.json();
        const pages = (j && j.pages) || [];
        for (const p of pages) {
          if (out.length >= 5) break;
          const desc = clean(String(p.description || p.excerpt || '').replace(/<[^>]+>/g, ''));
          out.push(`${clean(p.title)}${desc ? `: ${desc}` : ''}`);
        }
      };
      try { await wikiSearch('ru'); } catch { /* источник молчит — пробуем следующий */ }
      if (out.length < 3) {
        try { await wikiSearch('en'); } catch { /* ignore */ }
      }
      if (out.length < 3) {
        try {
          const r = await fetchT(fi, `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`);
          const j = await r.json();
          if (j && j.AbstractText) out.push(`${clean(j.AbstractText)}${j.AbstractURL ? ` (${j.AbstractURL})` : ''}`);
          for (const t of (j && j.RelatedTopics) || []) {
            if (out.length >= 5) break;
            if (t && t.Text) out.push(clean(t.Text));
          }
        } catch { /* ignore */ }
      }
      if (out.length < 3) {
        try {
          const r = await fetchT(fi, `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
          const html = await r.text();
          const links = [...String(html).matchAll(/<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
          const snips = [...String(html).matchAll(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g)];
          for (let i = 0; i < links.length; i++) {
            if (out.length >= 6) break;
            const title = clean(links[i][2]);
            const href = links[i][1];
            const snip = snips[i] ? clean(snips[i][1].replace(/<[^>]+>/g, '')) : '';
            if (title) out.push(`${title}${snip ? ` — ${snip}` : ''} (${href})`);
          }
        } catch { /* ignore */ }
      }
      return out.length ? `Результаты поиска по запросу «${q}»:\n${out.map((s, i) => `${i + 1}) ${s}`).join('\n')}` : null;
    },
  },
];

/**
 * Собрать данные всех сработавших инструментов.
 * Возвращает { used: string[], block: string } — block пустой, если данных нет.
 */
export async function gatherTools(text, env, fetchImpl) {
  const fi = fetchImpl || ((...a) => fetch(...a));
  const used = [];
  const parts = [];
  for (const t of TOOLS) {
    let hit = false;
    try { hit = !!t.when(String(text || ''), env); } catch { hit = false; }
    if (!hit) continue;
    try {
      const data = await t.run({ text, env, fetch: fi });
      if (data) {
        used.push(t.id);
        parts.push(`[Инструмент: ${t.title}]\n${data}`);
      }
    } catch { /* ошибка инструмента — не ошибка чата */ }
  }
  return { used, block: parts.join('\n\n') };
}

export const TOOL_IDS = () => TOOLS.map((t) => t.id);
