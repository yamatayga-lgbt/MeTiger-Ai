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

/* Форматы файла — единый источник правды: у инструмента-указания и у постобработки. */
import { FMT, formatFromText } from './filegen.js';
import { sharedImggen, IMG_DIRECTIVE, wantsImage, lineOf as imgLineOf } from './imggen.js';

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

/**
 * Распаковка редиректов поисковой выдачи (DuckDuckGo Lite прячет прямую ссылку в
 * `//duckduckgo.com/l/?uddg=https%3A%2F%2F...`). Чистая функция: на вход любой
 * href из выдачи, на выход — прямая `https://…` ссылка без промежуточного трекера.
 */
export function unwrapSearchUrl(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  const m = /[?&]uddg=([^&#]+)/i.exec(raw);
  if (m) {
    try {
      const dec = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(dec)) return dec;
    } catch { /* битый процент-код — оставляем исходный адрес */ }
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

/**
 * Собрать проверенные источники `{ title, url }` из текстового блока инструмента.
 * Понимает все наши форматы: нумерованную выдачу `1) Заголовок — сниппет (https://…)`,
 * новости `(дата; https://…)`, карточку страницы `Страница: … / URL: …` и
 * википедию `Заголовок: … / Источник: …`. Дубли по адресу убираются.
 */
export function extractSources(block) {
  const lines = String(block || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (title, rawUrl) => {
    const url = unwrapSearchUrl(String(rawUrl || '').replace(/[),.;]+$/, '').trim());
    if (!/^https?:\/\//i.test(url) || /creativecommons\.org\/licenses/i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    let t = clean(String(title || '').replace(/^\d+\)\s*/, '').replace(/^\[Инструмент:[^\]]*\]\s*/i, ''));
    if (!t || /^https?:\/\//i.test(t)) {
      try { t = new URL(url).hostname.replace(/^www\./i, ''); } catch { t = url; }
    }
    if (t.length > 80) t = t.slice(0, 79).trimEnd() + '…';
    out.push({ title: t, url });
  };
  let prevTitle = '';
  for (const line of lines) {
    if (/^\[Инструмент:/i.test(line) || /^Результаты поиска/i.test(line) || /^Выжимка из источника/i.test(line)) continue;
    const pageMatch = /^Страница:\s*(.+)$/i.exec(line);
    if (pageMatch) { prevTitle = pageMatch[1]; continue; }
    const directMatch = /^(?:Источник|URL):\s*(https?:\/\/\S+)/i.exec(line);
    if (directMatch) {
      add(prevTitle, directMatch[1]);
      prevTitle = '';
      continue;
    }
    const urls = [...line.matchAll(/https?:\/\/[^\s<>"')\];]+/gi)].map((m) => m[0]);
    if (!urls.length) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 80) prevTitle = line.slice(0, colonIdx);
      continue;
    }
    const url = urls[urls.length - 1];
    const head = line
      .replace(/^\d+\)\s*/, '')
      .replace(/\s*\([^()]*https?:\/\/[^()]*\)\s*$/i, '')
      .replace(/https?:\/\/\S+/gi, '')
      .trim();
    const iDash = head.indexOf(' — ');
    const iCol = head.indexOf(': ');
    const sep = iDash > 0 && iCol > 0 ? Math.min(iDash, iCol) : (iDash > 0 ? iDash : iCol);
    const title = sep > 0 && sep < 90 ? head.slice(0, sep) : head;
    add(title || prevTitle, url);
    prevTitle = '';
    if (out.length >= 8) break;
  }
  return out;
}

/** Байты для «честной случайности»: в рантайме Workers crypto есть, в node — из node:crypto. */
function rndBytes(n) {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** ISO 8601: номер недели — по четвергу (модель сама такие вещи считает неверно). */
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}



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

/* Набор шуток — перенос из донора (yama-ai/tools.js). Свои, без интернета и без ключей:
   инструмент объявлен навыком «Анекдоты и шутки», поэтому он обязан существовать, а не
   ссылаться на выдуманный API. 36 штук. */
export const JOKES = [
  { t: 'Программист звонит в библиотеку: — Здравствуйте, у вас есть книга «Как написать код без ошибок»? — Да, но на руки не выдаётся. — Почему? — Её ещё не дописали.', tags: ['программисты', 'код', 'книги'] },
  { t: '— Почему программисты путают Хэллоуин и Рождество? — Потому что 31 OCT = 25 DEC.', tags: ['программисты', 'праздники'] },
  { t: 'Идёт тестировщик по лесу, видит поляну, а на поляне грибы. «Ну, — думает, — это баг, а не фича».', tags: ['тестирование', 'программисты'] },
  { t: 'Жена программиста: — Сходи в магазин, купи хлеб. И если будут яйца — купи десяток. Он вернулся с десятью буханками. — Зачем столько?! — А яйца были.', tags: ['программисты', 'магазин', 'быт'] },
  { t: '— Доктор, я всё время забываю пароли. — Давно это с вами? — Что?', tags: ['память', 'врачи', 'пароль'] },
  { t: 'Муж приходит с работы рано. Жена: — Ты почему так рано? — Начальник сказал: «Или работай, или иди домой». Я выбрал второе: первый вариант был слишком длинным.', tags: ['работа', 'начальник'] },
  { t: 'Учительница: — Вовочка, назови три местоимения. — Кто? Я? А? — Молодец, садись.', tags: ['школа', 'Вовочка'] },
  { t: '— Купил жене на 8 Марта пылесос. — И как, обрадовалась? — Ещё бы: теперь есть три минуты, пока он не разрядится, чтобы сказать мне всё, что она думает.', tags: ['подарки', 'семья'] },
  { t: 'Звонок в техподдержку: — У меня не работает компьютер. — А он включён в розетку? — А как я посмотрю, у меня же монитор чёрный?', tags: ['техподдержка', 'компьютер'] },
  { t: '— Почему ты уволился? — Нашёл работу мечты: платят за то, что я просто сижу. — И где же? — В приёмной у начальника.', tags: ['работа'] },
  { t: 'Кот смотрит, как хозяин печатает. Хозяин: — Не мешай, я работаю. Кот ложится на клавиатуру. Хозяин: — Ну вот, теперь мы оба работаем.', tags: ['коты', 'животные', 'работа'] },
  { t: '— Как называется сыр, который не бывает лишним? — Тот, что в мышеловке.', tags: ['мыши', 'сыр', 'животные'] },
  { t: 'Встречаются два программиста. Один: — Слышал, новый язык программирования вышел? Второй: — Да, но я на старом ещё не договорил.', tags: ['языки', 'программисты'] },
  { t: 'Приходит мужик в банк: — Дайте кредит. — А поручитель есть? — Есть. — Кто? — Я, но только в другой ветке.', tags: ['банк', 'кредит', 'деньги'] },
  { t: '— Что общего между утюгом и понедельником? — Оба гладят только в одну сторону, и обоих хочется выключить.', tags: ['понедельник', 'быт'] },
  { t: '— Почему ты всегда опаздываешь? — Я не опаздываю, я прихожу из будущего.', tags: ['время', 'опоздания'] },
  { t: 'Собрание. Начальник: — У нас две новости: хорошая и плохая. Хорошая — премия будет. Плохая — она уже была.', tags: ['премия', 'работа'] },
  { t: '— Алло, автосервис? Машину починить можете? — Можем. — А быстро? — Быстро — это вчера, сегодня — как получится.', tags: ['авто', 'сервис'] },
  { t: '— Доктор, сколько мне ещё жить? — А вам зачем? — Да хочу знать, стоит ли вторую ипотеку брать.', tags: ['врачи', 'ипотека', 'деньги'] },
  { t: '— Почему бухгалтеры такие спокойные? — Они уже всё посчитали, включая варианты, при которых всё пропало.', tags: ['бухгалтерия', 'работа'] },
  { t: 'Идёт ёжик по лесу, видит — гриб. Ёжик: — О, гриб! А гриб: — Фу, ёжик.', tags: ['животные', 'лес'] },
  { t: '— У нас в офисе кулер сломался. — И как вы живёте? — Собираемся у кулера, обсуждаем.', tags: ['офис', 'работа'] },
  { t: '— Ты почему не спишь? — Думаю: а вдруг я не выключил утюг? — Встань, проверь. — А вдруг я уже сплю?', tags: ['бессонница', 'быт'] },
  { t: '— Как вы находите общий язык с тёщей? — Просто: я говорю «да», она говорит «нет», и мы оба знаем, что будет по-моему.', tags: ['тёща', 'семья'] },
  { t: 'Звонок в доставку: — Я заказывал пиццу час назад! — Да-да, уже едем. — Откуда вы знаете, где я живу? — Пицца сама найдёт героя.', tags: ['доставка', 'еда'] },
  { t: '— Что делает кот, когда хозяин уезжает? — Сначала радуется, потом скучает, потом мстит.', tags: ['коты', 'животные'] },
  { t: '— Почему программисты не любят природу? — Там слишком много багов.', tags: ['природа', 'программисты'] },
  { t: '— У тебя есть хобби? — Да, сплю. — И как успехи? — Стабильно: два-три раза в день.', tags: ['сон', 'хобби'] },
  { t: '— Как понять, что вы работаете в стартапе? — Вам обещают долю, а платят зарплату… когда-нибудь.', tags: ['стартап', 'работа'] },
  { t: '— Почему ты не берёшь трубку? — Я же на совещании. — А почему слышно, как кто-то храпит? — Это я активно слушаю.', tags: ['совещание', 'работа'] },
  { t: '— Как называется человек, который знает три языка? — Полиглот. — А программист? — Полиглот в отпуске.', tags: ['языки', 'программисты'] },
  { t: '— В чём разница между оптимистом и пессимистом? — Пессимист носит зонт, оптимист — запасные носки, а реалист — и то, и другое, и ещё термос.', tags: ['оптимист', 'погода'] },
  { t: '— У нас новый дизайн! — А работать будет? — А кто его спрашивал?', tags: ['дизайн', 'работа'] },
  { t: '— Почему вы перестали ходить в спортзал? — Я туда ходил смотреть на людей, которые занимаются. А они всё время пыхтят.', tags: ['спортзал', 'спорт'] },
  { t: '— Что общего между диетой и понедельником? — Оба начинаются завтра.', tags: ['диета', 'понедельник'] },
  { t: '— У вас Wi-Fi есть? — Есть. — А пароль? — Пароль простой: «нет_интернета_всё_равно».', tags: ['вайфай', 'интернет'] },
];

/* ============================== инструменты ============================== */

export const TOOLS = [
  {
    id: 'time',
    title: 'Время',
    when: (t) => /который час|сколько\s+времени|текущее\s+время|time\s+now/i.test(t),
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
    /* 0.132: подсчёт букв точным кодом. Модель видит не буквы, а куски слов, и на
       «сколько „р“ в „пререкаться“» отвечала «3», а потом на глазах у человека писала
       «подожди, пересчитаем…» (замер MeTiger Bench, вопрос h5). Как калькулятор для
       арифметики: считает код, модель только говорит. */
    id: 'letters',
    title: 'Подсчёт букв',
    when: (t) => LETTERS_ASK.test(t),
    async run({ text }) {
      const r = lettersOf(text);
      return r || null;
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
    when: (t) => /случайное\s+число|рандом|выбери\s+наугад|случайн\w+\s+(элемент|вариант|из\s+списка)|что\s+выбрать\s+наугад/i.test(t),
    async run({ text }) {
      const t = String(text || '');
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
    when: (t) => /найди в интернете|найди в сети|погугли|поищи|поиск[аи]?\s+в\s+интернете|search\s+the\s+web|найди информацию|актуальн\w*\s+данн|последн\w+\s+(верси|данн|инфо|релиз|событ)|в\s+202[4-9]\b|кто\s+(сейчас\s+президент|выиграл|победил|возглавляет)|когда\s+(вышел|вышла|выйдет|состоится)|сколько\s+сейчас\s+стоит|официальн\w+\s+сайт|что\s+(случилось|произошло)\s+с/i.test(t),
    async run({ text, fetch: fi, force, deep }) {
      const q = queryOf(text) || ((force || deep) ? clean(text).slice(0, 120) : '');
      if (!q) return null;
      const out = [];
      const webUrls = [];
      const wikiCap = deep ? 3 : 5;
      /* Источники по порядку надёжности из Workers: поиск Wikimedia REST (тот же
         контур, что у живой вики), потом DDG IA (хорош на английском), потом
         lite-выдача DDG. Action API википедии из CF не отвечает — не используем. */
      const wikiSearch = async (lang) => {
        const r = await fetchT(fi, `https://api.wikimedia.org/core/v1/wikipedia/${lang}/search/page?q=${encodeURIComponent(q)}&limit=5`);
        const j = await r.json();
        const pages = (j && j.pages) || [];
        for (const p of pages) {
          if (out.length >= wikiCap) break;
          const d = clean(String(p.description || '').replace(/<[^>]+>/g, ''));
          const ex = clean(String(p.excerpt || '').replace(/<[^>]+>/g, ''));
          const desc = d && ex && ex.toLowerCase().indexOf(d.toLowerCase()) < 0 ? `${d} — ${ex}` : (d || ex);
          const slug = encodeURIComponent(String(p.key || p.title || '').trim().replace(/\s+/g, '_'));
          const pageUrl = slug ? `https://${lang}.wikipedia.org/wiki/${slug}` : '';
          out.push(`${clean(p.title)}${desc ? `: ${desc}` : ''}${pageUrl ? ` (${pageUrl})` : ''}`);
        }
      };
      try { await wikiSearch('ru'); } catch { /* источник молчит — пробуем следующий */ }
      if (out.length < 3) {
        try { await wikiSearch('en'); } catch { /* ignore */ }
      }
      if (out.length < 3 || deep) {
        try {
          const r = await fetchT(fi, `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`);
          const j = await r.json();
          if (j && j.AbstractText) {
            const absUrl = unwrapSearchUrl(j.AbstractURL || '');
            if (absUrl) webUrls.push(absUrl);
            out.push(`${clean(j.AbstractText)}${absUrl ? ` (${absUrl})` : ''}`);
          }
          for (const t of (j && j.RelatedTopics) || []) {
            if (out.length >= 6) break;
            if (t && t.Text) {
              const u = unwrapSearchUrl(t.FirstURL || '');
              out.push(`${clean(t.Text)}${u ? ` (${u})` : ''}`);
            }
          }
        } catch { /* ignore */ }
      }
      if (out.length < 3 || deep) {
        try {
          const r = await fetchT(fi, `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
          const html = await r.text();
          const links = [...String(html).matchAll(/<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
          const snips = [...String(html).matchAll(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g)];
          for (let i = 0; i < links.length; i++) {
            if (out.length >= 6) break;
            const title = clean(links[i][2].replace(/<[^>]+>/g, ''));
            const href = unwrapSearchUrl(links[i][1]);
            const snip = snips[i] ? clean(snips[i][1].replace(/<[^>]+>/g, '')) : '';
            if (title) {
              if (/^https?:\/\//i.test(href)) webUrls.push(href);
              out.push(`${title}${snip ? ` — ${snip}` : ''}${href ? ` (${href})` : ''}`);
            }
          }
        } catch { /* ignore */ }
      }
      if (!out.length) return null;
      let extra = '';
      /* Глубокий поиск работает автоматически: если нашлась внешняя веб-страница,
         читаем её выжимку внутри бюджета и отдаём модели вместе со ссылками. */
      if (webUrls.length) {
        try {
          const topUrl = webUrls[0];
          const pr = await fetchT(fi, topUrl, { timeout: 3500 });
          const html = await pr.text();
          const body = String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#?\w+;/g, ' ');
          const frag = clean(body).slice(0, 900);
          if (frag.length >= 40) extra = `\nВыжимка из источника (${topUrl}): ${frag}`;
        } catch { /* страница закрыта или медлит — остаётся основная выдача */ }
      }
      return `Результаты поиска по запросу «${q}»:\n${out.map((s, i) => `${i + 1}) ${s}`).join('\n')}${extra}`;
    },
  },

  /* ======================= перенос из донора: бытовые и файловые ======================= */

  {
    id: 'date',
    title: 'Дата',
    /* У донора date — просто «сегодняшняя дата по Минску». Добавили номер недели:
       по нему люди планируют чаще, чем по дате, и считать его руками модель не умеет. */
    when: (t) => /какое\s+(сегодня\s+)?число|какая\s+(сегодня\s+)?дата|какой\s+(сегодня\s+)?(день|число)|день\s+недели|номер\s+недели|какая\s+неделя|сегодняшн\w+\s+дата|what\s+date/i.test(t),
    async run({ env }) {
      const tz = (env && env.TZ_NAME) || 'Europe/Minsk';
      const now = new Date();
      const day = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const week = isoWeek(new Date(iso + 'T12:00:00Z'));
      return `Сегодня ${day}. ISO ${iso}, номер недели ${week} (часовой пояс ${tz}).`;
    },
  },
  {
    id: 'coin',
    title: 'Монетка',
    when: (t) => /монетк|подбрось\s+монет|ор[ёе]л\s+или\s+решк|решк\w*\s+или\s+ор[ёе]л|coin\s*flip/i.test(t),
    async run() {
      /* Честная монетка — crypto, а не Math.random: «случайно» тут спрашивают
         всерьёз, и смещёный генератор был бы обманом. */
      const b = rndBytes(1)[0];
      return `Монетка: ${b % 2 ? 'орёл' : 'решка'} (бросок честный, crypto).`;
    },
  },
  {
    id: 'dice',
    title: 'Кубики',
    when: (t) => /кубик|кост[еи]|брось\s+\d?\s*d\d*|\b\d*d\d+\b|d20|d6|dice|роллик/i.test(t),
    async run({ text }) {
      const rolls = [...String(text || '').matchAll(/(\d*)d(\d{1,3})([+-]\d+)?/gi)].slice(0, 6);
      if (!rolls.length) return 'Кубики: бросок не распознан — напиши формат вроде 2d6+1 или d20.';
      const b = rndBytes(24);
      let k = 0;
      const out = [];
      for (const m of rolls) {
        const n = Math.max(1, Math.min(20, Number(m[1] || 1)));
        const faces = Math.max(2, Math.min(1000, Number(m[2])));
        const mod = m[3] ? Number(m[3]) : 0;
        const dice = [];
        for (let i = 0; i < n; i++) { dice.push(1 + (b[(k++) % b.length] % faces)); }
        const sum = dice.reduce((a, x) => a + x, 0) + mod;
        out.push(`${n}d${faces}${mod ? (mod > 0 ? '+' + mod : mod) : ''}: ${dice.join(' + ')}${mod ? (mod > 0 ? ' + ' + mod : ' - ' + -mod) : ''} = ${sum}`);
      }
      return 'Бросок кубиков (crypto).\n' + out.join('\n');
    },
  },
  {
    id: 'joke',
    title: 'Шутка',
    when: (t) => /анекдот|шутк|пошути|развесели|рассмеши|прикол\b|joke/i.test(t),
    async run({ text }) {
      /* Набор донора (37 штук, свои, без интернета): инструмент обязан существовать,
         а не ссылаться на выдуманный API. */
      const q = String(text || '').toLowerCase();
      const pool = JOKES.filter((j) => !j.tags.some((tag) => /программист|код|тестиров|баг|языки|вайфай|стартап|дизайн|бухгалтер/.test(tag)) || /программист|код|работ|техн|баг|тест|ит\b|компиля|сервер|парол|компьютер/.test(q));
      const list = pool.length ? pool : JOKES;
      const b = rndBytes(2);
      const j = list[(b[0] * 256 + b[1]) % list.length];
      return `Шутка из набора (отдай её дословно, своими словами не пересказывай):\n${j.t}`;
    },
  },
  {
    id: 'image-search',
    title: 'Поиск картинок',
    when: (t) => /(найди|подбери|покажи|поищи).{0,24}(картинк|фото|изображени|иллюстрац|обои|постер)|(картинк|фото|изображени)\s+(по|на)\s+теме|image\s*search|find\s+(an\s+)?image/i.test(t),
    async run({ text, fetch: fi }) {
      const q = queryOf(String(text || '').replace(/(?:найди|найти|покажи|подбери|поищи|погугли|картинк\w*|фото\w*|изображени\w*|иллюстрац\w*|обои|постер|image|picture)/gi, ' '));
      if (!q) return null;
      const out = [];
      /* Сначала Commons: тот же контур, что у живой вики, лицензия указана, ключей
         не просит. Openverse — запасной: он анонимно часто отдаёт 429. */
      try {
        const r = await fetchT(fi, `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640`);
        const j = await r.json();
        const pages = Object.values((j && j.query && j.query.pages) || {});
        pages.sort((a, b) => (a.index || 9) - (b.index || 9));
        for (const pg of pages) {
          const ii = pg.imageinfo && pg.imageinfo[0];
          if (!ii || !/\.(jpe?g|png|webp|gif)$/i.test(ii.url || '')) continue;
          const lic = ii.extmetadata && ii.extmetadata.LicenseShortURL && ii.extmetadata.LicenseShortURL.value;
          const art = ii.extmetadata && ii.extmetadata.Artist && String(ii.extmetadata.Artist.value).replace(/<[^>]+>/g, '').trim();
          out.push(`${clean(pg.title).replace(/^File:/i, '')}: ${ii.thumburl || ii.url}${art ? ` — автор ${clean(art).slice(0, 60)}` : ''}${lic ? ` (${lic})` : ''}`);
          if (out.length >= 5) break;
        }
      } catch { /* источник молчит — пробуем следующий */ }
      if (!out.length) {
        try {
          const r = await fetchT(fi, `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=5&license_type=commercial`);
          const j = await r.json();
          for (const it of (j && j.results) || []) {
            out.push(`${clean(it.title)}: ${it.url}${it.creator ? ` — автор ${clean(it.creator).slice(0, 60)}` : ''}${it.license ? ` (${it.license}${it.license_version ? ' ' + it.license_version : ''})` : ''}`);
            if (out.length >= 5) break;
          }
        } catch { /* ignore */ }
      }
      return out.length
        ? `Картинки по запросу «${q}» — адрес, автор и лицензия; ссылку давай как есть, не выдумывай:\n${out.map((s, i) => `${i + 1}) ${s}`).join('\n')}`
        : null;
    },
  },
  {
    id: 'imggen',
    title: 'Картинки',
    /* Тоже указание, а не данные: генерируем ПОСЛЕ ответа модели (engine/imggen.js),
       по block-у из её текста. Здесь же — честный вердикт источников: если все
       отказывают, модель обязана сказать это словами, а не вставлять чужую ссылку
       и не обещать «вот картинка». */
    kind: 'directive',
    when: (t) => wantsImage(t),
    async run({ text, env, fetch, img }) {
      /* Слой ОДИН на изолят (кэш вердиктов): своя копия не видела бы,
         что источник уже отвечал, и соврала бы про «не проверено». */
      const layer = img || sharedImggen(env, fetch);
      const st = layer.status();
      if (!st.on) return null;
      const ready = st.sources.filter((x) => x.ready);
      const blocked = st.sources.filter((x) => !x.ready && x.blocked);
      if (!ready.length && st.sources.every((x) => x.blocked || !x.edits)) {
        return 'Источник картинок сейчас не отвечает (' + (blocked.map((x) => x.id + ': ' + x.blocked).join('; ') || 'каналы не проверены') +
          '). Так и скажи человеку — коротко и без извинений — и предложи то, что работает: поиск готовых изображений (Поиск картинок) или текст. Ссылки на «сгенерированное» не вставляй.';
      }
      const canEdit = ready.some((x) => x.edits) || st.sources.some((x) => x.edits && !x.blocked);
      return IMG_DIRECTIVE + (canEdit ? '' : '\nПравка приложенной картинки сейчас недоступна: если просят правку — скажи об этом прямо.')
        + '\nСостояние источников: ' + imgLineOf(st);
    },
  },
  {
    id: 'filegen',
    title: 'Файл',
    /* Документ на выход — двусторонний инструмент: здесь модель получает правило
       оформления, а постобработка (engine/filegen.js) вынимает блок и упакovывает
       его в настоящий docx/xlsx/csv/md/html/txt. Блок идёт как «указание», не как
       «данные»: вставить его в [Инструмент: …] означало бы подмешать инструкцию
       в источник фактов. */
    kind: 'directive',
    when: (t) => /оформи[^.\n]{0,24}(файл|docx|csv|xlsx|md|markdown|html|txt)|сделай[^.\n]{0,12}(файл|docx|csv|xlsx)|приложи\w*\s+файл|скача(ть|ту|й)|отправ\w*[^.\n]{0,8}файл|в\s+виде\s+файла|(?:отдай|пришли|скинь|выложи|верни|ответь)[^.\n]{0,14}файлом|документ\s+файлом|\.(docx|csv|xlsx)\b|file\s*(please|for\s+download|format)/i.test(t),
    async run({ text }) {
      const f = formatFromText(text);
      return 'Человек просит файл. Оформляй так: сначала обычный ответ (2-3 предложения, что в файле), затем ОДИН блок\n```file:' + f + '|имя без расширения\n<содержимое: Markdown для docx/md/html, TSV-таблица для xlsx/csv>\n```\nВ файле — только содержимое, без пояснений и без самих кавычек-обратных. Не пиши «я приложил файл» раньше блока: файл появится сам, когда блок разберут. Форматы: ' + Object.keys(FMT).join(', ') + '.';
    },
  },
];

const SOURCE_TOOLS = new Set(['web-search', 'wikipedia', 'news', 'url']);

/**
 * Собрать данные всех сработавших инструментов.
 * Возвращает { used: string[], block: string, directive: string, sources: {title,url}[], webSteps: object[] }.
 */
export async function gatherTools(text, env, fetchImpl, o) {
  const fi = fetchImpl || ((...a) => fetch(...a));
  const opts = o || {};
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
  const force = new Set(opts.force || []);
  if (opts.deep) force.add('web-search');
  const off = new Set(String((env && env.TOOLS_OFF) || '').split(',').map((s) => s.trim()).filter(Boolean));
  const used = [];
  const parts = [];
  const directives = [];
  const srcParts = [];
  const webSteps = [];
  const emitStep = (step) => {
    webSteps.push(step);
    if (onStep) { try { onStep(step); } catch { /* ignore */ } }
  };
  /* Инструменты друг от друга не зависят — запускаем все сработавшие разом, а
     разбираем результаты в прежнем порядке. Раньше шли по очереди: поиск + вики +
     погода складывали свои задержки, теперь ждём только самый медленный. */
  const hits = [];
  for (const t of TOOLS) {
    if (off.has(t.id)) continue;
    let hit = force.has(t.id);
    if (!hit) { try { hit = !!t.when(String(text || ''), env); } catch { hit = false; } }
    if (!hit) continue;
    /* `img` — подменяемый слой картинок: тесты и чужие сборки движка обязаны
       видеть в инструменте ровно тот экземпляр, что у движка, а не модульный. */
    let run;
    try { run = Promise.resolve(t.run({ text, env, fetch: fi, force: force.has(t.id), deep: !!opts.deep, img: opts.img })); }
    catch (e) { run = Promise.reject(e); }
    run.catch(() => {});
    hits.push({ t, run });
  }
  for (const { t, run } of hits) {
    try {
      const data = await run;
      if (!data) continue;
      used.push(t.id);
      if (SOURCE_TOOLS.has(t.id)) {
        srcParts.push(data);
        const toolSources = extractSources(data);
        if (t.id === 'url') {
          const uMatch = /URL:\s*(https?:\/\/\S+)/i.exec(data);
          const tMatch = /Страница:\s*([^\n]+)/i.exec(data);
          const fetchedUrl = (uMatch && uMatch[1]) || (toolSources[0] && toolSources[0].url) || '';
          if (fetchedUrl) {
            emitStep({ kind: 'fetch', url: fetchedUrl, title: (tMatch && tMatch[1]) || fetchedUrl });
          }
        } else {
          const qMatch = /по запросу «([^»]+)»/.exec(data);
          const q = (qMatch && qMatch[1]) || queryOf(text) || clean(String(text || '')).slice(0, 90);
          if (q) {
            emitStep({ kind: 'search', query: q, results: toolSources.slice(0, 5) });
          }
          const excerptUrl = (/Выжимка из источника \((https?:\/\/[^)\s]+)\)/.exec(data) || [])[1]
            || (/Источник:\s*(https?:\/\/\S+)/.exec(data) || [])[1]
            || (toolSources[0] && toolSources[0].url)
            || '';
          if (excerptUrl) {
            const found = toolSources.find((s) => s.url === excerptUrl);
            emitStep({ kind: 'fetch', url: excerptUrl, title: (found && found.title) || excerptUrl });
          }
        }
      }
      /* kind: 'directive' — правило для модели, а не внешние данные. */
      (t.kind === 'directive' ? directives : parts).push(
        t.kind === 'directive' ? `【${t.title}】\n${data}` : `[Инструмент: ${t.title}]\n${data}`);
    } catch { /* ошибка инструмента — не ошибка чата */ }
  }
  const sources = srcParts.length ? extractSources(srcParts.join('\n')) : [];
  return { used, block: parts.join('\n\n'), directive: directives.join('\n\n'), sources, webSteps };
}


/* ─────────── подсчёт букв (инструмент letters) ─────────── */
const Q = '[«"\'„“”]?';
export const LETTERS_ASK = /(сколько\s+(?:раз\s+)?(?:букв|гласн|согласн|слог)|how\s+many\s+(?:letters|\w'?s\b|times\s+(?:does\s+)?(?:the\s+)?letter)|count\s+the\s+letter)/i;
export function lettersOf(text) {
  const t = String(text || '');
  const word = (t.match(new RegExp('(?:в\\s+слове|in\\s+(?:the\\s+word\\s+)?)\\s*' + Q + '([A-Za-zА-Яа-яЁё-]{2,40})' + Q, 'i')) || [])[1];
  if (!word) return null;
  const w = word.toLowerCase();
  const letters = [...w].filter((c) => /[a-zа-яё]/.test(c));
  const VOW = 'аеёиоуыэюяaeiouy';
  const out = [`Слово «${word}»: ${letters.length} букв (по буквам: ${letters.join('-')}).`];
  /* какую букву спрашивают: «букв „р“», «буква р», «how many r's», «letter r» */
  const m = t.match(new RegExp('(?:букв[аы]?|буква|letter)\\s*[«"\'„“]([A-Za-zА-Яа-яЁё])[»"\'”“]', 'i'))
    || t.match(/(?:букв[аы]?|буква|letter)\s+([A-Za-zА-Яа-яЁё])\s+(?:в\s+слове|in\s)/i)
    || t.match(/how\s+many\s+([a-z])'?s\b/i);
  if (m) {
    const ch = m[1].toLowerCase();
    const pos = [];
    letters.forEach((c, i) => { if (c === ch || (ch === 'е' && c === 'ё')) pos.push(i + 1); });
    out.push(`Буква «${ch}» встречается ${pos.length} раз${pos.length ? ` (позиции: ${pos.join(', ')})` : ''}.`);
  }
  if (/гласн|слог/i.test(t)) {
    const v = letters.filter((c) => VOW.includes(c)).length;
    out.push(`Гласных: ${v}${/слог/i.test(t) ? ` — значит, слогов: ${v}` : ''}.`);
  }
  if (/согласн/i.test(t)) out.push(`Согласных: ${letters.filter((c) => !VOW.includes(c) && c !== 'ь' && c !== 'ъ').length}.`);
  return out.join(' ');
}

export const TOOL_IDS = () => TOOLS.map((t) => t.id);

/** Заголовки инструментов — блок навыков показывает человеку то же, что видит модель. */
export const TOOL_TITLES = Object.fromEntries(TOOLS.map((x) => [x.id, x.title]));
