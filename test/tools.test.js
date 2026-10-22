/**
 * Инструменты агента — триггеры, разбор ответов, тишина при пустоте.
 * Сети нет: fetch внедряется и отвечает заглушками.
 * Запуск: node test/tools.test.js
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { gatherTools, evalExpr, TOOL_IDS, JOKES, isoWeek, unwrapSearchUrl, extractSources } from '../engine/tools.js';
import { formatFromText, nameFromText } from '../engine/filegen.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** fetch-заглушка: по подстроке URL отдаёт объект (или текст). */
function fakeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, payload] of Object.entries(routes)) {
      if (u.includes(needle)) {
        if (payload instanceof Error) throw payload;
        /* payload-функция получает URL: так мок отвечает ПО ЗАПРОСУ, а не «на любой
           геокодер». Прежний статичный ответ делал T9 зелёным при сломанном
           извлечении города — ровно тот случай, что чинили в 0.199. */
        const body = typeof payload === 'function' ? payload(u) : payload;
        if (body instanceof Error) throw body;
        return {
          ok: true, status: 200,
          json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
          text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        };
      }
    }
    throw new Error('нет маршрута для ' + u);
  };
}

console.log('T — калькулятор и случайности (без сети)');
ok('T1: evalExpr считает приоритет: 2+2*3 = 8', evalExpr('2+2*3') === 8);
ok('T2: скобки и степень: (1+2)^2 = 9', evalExpr('(1+2)^2') === 9);
ok('T3: запятая как точка: 3,5*2 = 7', evalExpr('3,5*2') === 7);
ok('T4: мусор и деление на ноль → null', evalExpr('привет') === null && evalExpr('5/0') === null);
/* 0.196: калькулятор исполняет функции — математик-навык давно их обещает */
ok('T4a: функции: sqrt, fact, fib, log', evalExpr('sqrt(16)') === 4 && evalExpr('fact(5)') === 120 && evalExpr('fib(10)') === 55 && evalExpr('log(1000)') === 3);
ok('T4b: аргументы через «;»: gcd, lcm, C, perm, mod, min', evalExpr('gcd(48;18)') === 6 && evalExpr('lcm(4;6)') === 12 && evalExpr('C(5;2)') === 10 && evalExpr('perm(5;2)') === 20 && evalExpr('mod(10;3)') === 1 && evalExpr('min(3;7;2)') === 2);
ok('T4c: функции в выражении и запятая-аргумент: sqrt(16)+2^3=12, gcd(12,18)=6', evalExpr('sqrt(16)+2^3') === 12 && evalExpr('gcd(12,18)') === 6);
ok('T4d: запятая-десятичная вне вызова жива: 1,5+2=3,5', Math.abs(evalExpr('1,5+2') - 3.5) < 1e-9);
{
  const calcFn = await gatherTools('вычисли sqrt(144) пожалуйста', {}, fakeFetch({}));
  ok('T4e: «вычисли sqrt(144)» → калькулятор, 12', calcFn.used.join() === 'calc' && calcFn.block.includes('12'), calcFn.block);
}

const calcRes = await gatherTools('посчитай 17*(3+2)', {}, fakeFetch({}));
ok('T5: «посчитай 17*(3+2)» → калькулятор, 85', calcRes.used.join() === 'calc' && calcRes.block.includes('85'), calcRes.block);

const dice = await gatherTools('брось кубик d20', {}, fakeFetch({}));
const d20 = Number(/= (\d+)/.exec(dice.block.trim())[1]);
ok('T6: кубик d20 — у отдельного инструмента, значение в диапазоне 1..20',
  dice.used.join() === 'dice' && /d20: /.test(dice.block) && d20 >= 1 && d20 <= 20, dice.block);

console.log('T — дата, курсы, погода');
const timeRes = await gatherTools('который час?', { TZ_NAME: 'Europe/Minsk' }, fakeFetch({}));
ok('T7: «который час?» → дата с таймзоной', timeRes.used.join() === 'time' && timeRes.block.includes('Europe/Minsk'), timeRes.block);

const cur = await gatherTools('курс доллара к рублю', {}, fakeFetch({
  'open.er-api.com/v6/latest/RUB': { rates: { USD: 0.011, EUR: 0.0094, BYN: 0.026 }, time_last_update_unix: 1791619200 },
}));
ok('T8: «курс доллара» → база RUB и USD в ответе', cur.used.join() === 'currency' && cur.block.includes('RUB') && cur.block.includes('USD'), cur.block);

const curBy = await gatherTools('курс доллара', {}, fakeFetch({
  'api.nbrb.by/exrates/rates': [
    { Cur_Abbreviation: 'USD', Cur_OfficialRate: 3.0637, Cur_Scale: 1, Date: '2026-10-18T00:00:00' },
    { Cur_Abbreviation: 'EUR', Cur_OfficialRate: 3.55, Cur_Scale: 1, Date: '2026-10-18T00:00:00' },
    { Cur_Abbreviation: 'RUB', Cur_OfficialRate: 3.45, Cur_Scale: 100, Date: '2026-10-18T00:00:00' },
  ],
}));
ok('T8b: «курс доллара» без «рубля» — Нацбанк РБ, 1 USD = 3.0637 BYN',
  curBy.used.join() === 'currency' && /Нацбанк РБ/.test(curBy.block) && /1 USD = 3\.0637 BYN/.test(curBy.block)
    && /nbrb\.by/.test(curBy.block), curBy.block);

const curFb = await gatherTools('курс евро', {}, fakeFetch({
  'api.nbrb.by': new Error('nbrb down'),
  'open.er-api.com/v6/latest/BYN': { rates: { USD: 0.326, EUR: 0.282, RUB: 29.1 }, time_last_update_unix: 1791619200 },
}));
ok('T8c: НБРБ молчит — запасной er-api с базой BYN',
  curFb.used.join() === 'currency' && /база BYN/.test(curFb.block) && /1 EUR = /.test(curFb.block)
    && /er-api/.test(curFb.block), curFb.block);

/* Геокодер отвечает ТОЛЬКО на правильное имя: если извлечение города сломается,
   мок вернёт пусто и тест упадёт, а не подыграет, как раньше. */
const GEO = {
  'геокодинг Варшавы': (u) => {
    const name = decodeURIComponent((/name=([^&]*)/.exec(u) || [])[1] || '');
    return /^варшав/i.test(name) ? { results: [{ name: 'Варшава', country: 'Польша', latitude: 52.2, longitude: 21.0 }] } : { results: [] };
  },
};
const WEATHER_FORECAST = {
  current: { temperature_2m: 12.4, apparent_temperature: 10.1, wind_speed_10m: 3.6, precipitation: 0, weather_code: 1, time: '2026-10-11T09:00' },
  daily: { temperature_2m_max: [15], temperature_2m_min: [7] },
};
const weather = await gatherTools('погода в варшаве', {}, fakeFetch({
  'geocoding-api.open-meteo.com': GEO['геокодинг Варшавы'],
  'api.open-meteo.com': WEATHER_FORECAST,
}));
ok('T9: погода нашла город и показала температуру', weather.used.join() === 'weather' && weather.block.includes('Варшава') && weather.block.includes('12°C'), weather.block);

/* Падеж: «Гомеле» у open-meteo — это Гомелевка в России. Правильный ответ —
   сначала снять окончание и найти Гомель; сырое слово — только вторым шансом. */
const gomel = await gatherTools('Какая погода в Гомеле сейчас?', {}, fakeFetch({
  'geocoding-api.open-meteo.com': (u) => {
    const name = decodeURIComponent((/name=([^&]*)/.exec(u) || [])[1] || '');
    if (name === 'Гомел') return { results: [{ name: 'Гомель', country: 'Беларусь', latitude: 52.43, longitude: 30.97 }] };
    if (name === 'Гомеле') return { results: [{ name: 'Гомелевка', country: 'Россия', latitude: 51.0, longitude: 40.0 }] };
    return { results: [] };
  },
  'api.open-meteo.com': WEATHER_FORECAST,
}));
ok('T9a: «в Гомеле» → Гомель, а не Гомелевка', gomel.block.includes('Гомель') && !gomel.block.includes('Гомелевка'), gomel.block);

/* Поисковик лёг: инструмент обязан сказать это вслух, а не выдать Википедию
   за свежий поиск. notes — та же строка для интерфейса. */
const degraded = await gatherTools('какие главные новости технологий сегодня?', {}, fakeFetch({
  'api.wikimedia.org': { pages: [{ title: 'Технологии', description: 'Обзор', key: 'Технологии' }] },
}));
ok('T9b: поисковик лёг → предупреждение в блоке и в notes',
  degraded.used.includes('web-search') && degraded.block.includes('⚠️') &&
  (degraded.notes || []).some((n) => /поиск/i.test(n)), JSON.stringify(degraded.notes));

console.log('T — вики, страница, поиск, новости');
const wiki = await gatherTools('что такое гравитация в википедии', {}, fakeFetch({
  'ru.wikipedia.org/api/rest_v1/page/summary/': {
    title: 'Гравитация', extract: 'Всемирное тяготение…',
    content_urls: { desktop: { page: 'https://ru.wikipedia.org/wiki/Гравитация' } },
  },
}));
ok('T10: википедия дала выжимку и ссылку', wiki.used.join() === 'wikipedia' && wiki.block.includes('Всемирное тяготение') && wiki.block.includes('wikipedia.org'), wiki.block);

const page = await gatherTools('прочитай https://example.com/doc и перескажи', {}, fakeFetch({
  'https://example.com/doc': '<html><head><title>Документ</title><meta name="description" content="Описание страницы"></head><body><p>Первый абзац текста.</p><script>var x=1</script></body></html>',
}));
ok('T11: чтение страницы: заголовок, описание, текст без скриптов', page.used.join() === 'url' && page.block.includes('Документ') && page.block.includes('Первый абзац') && !page.block.includes('var x'), page.block.slice(0, 120));

const search = await gatherTools('найди в интернете квантовые компьютеры', {}, fakeFetch({
  'api.duckduckgo.com': { AbstractText: 'Квантовый компьютер использует кубиты.', RelatedTopics: [{ Text: 'Кубит — единица информации' }], AbstractURL: 'https://qc.example' },
}));
ok('T12: веб-поиск свёл абстракт и связанные темы', search.used.join() === 'web-search' && search.block.includes('кубит') && search.block.includes('квантовые компьютеры'), search.block.slice(0, 120));

const news = await gatherTools('последние новости про космос', { GNEWS_KEY: 'k1' }, fakeFetch({
  'gnews.io/api/v4/search': { articles: [{ title: 'Запуск ракеты', description: 'Успешный старт.', publishedAt: '2026-10-01T07:00:00Z', url: 'https://n.example/1' }] },
}));
ok('T13: новости через GNews: заголовок и ссылка', news.used.join() === 'news' && news.block.includes('Запуск ракеты') && news.block.includes('n.example/1'), news.block);

const silent = await gatherTools('привет, как дела', {}, fakeFetch({}));
ok('T14: болтовня — ни один инструмент не сработал', silent.used.length === 0 && silent.block === '', JSON.stringify(silent));

const lite = await gatherTools('найди в интернете погода завтра', {}, fakeFetch({
  'api.wikimedia.org/core/v1/wikipedia/ru/search': { pages: [] },
  'api.wikimedia.org/core/v1/wikipedia/en/search': { pages: [] },
  'api.duckduckgo.com': { AbstractText: '', RelatedTopics: [] },
  'lite.duckduckgo.com': '<a class="result-link" href="https://ex.test/1">Погода завтра</a><td class="result-snippet">Прогноз на завтра</td>',
}));
ok('T17: lite-выдача распарсена в ссылку и сниппет', lite.used.join() === 'web-search' && lite.block.includes('Погода завтра') && lite.block.includes('ex.test/1'), lite.block);

const wikiSearch = await gatherTools('найди в интернете квантовые компьютеры', {}, fakeFetch({
  'api.wikimedia.org/core/v1/wikipedia/ru/search': {
    pages: [{ title: 'Квантовый компьютер', description: 'вычислительное устройство' }, { title: 'Кубит', description: 'единица информации' }],
  },
}));
ok('T18: поиск Wikimedia REST — главный источник', wikiSearch.used.join() === 'web-search' && wikiSearch.block.includes('Квантовый компьютер') && wikiSearch.block.includes('вычислительное устройство'), wikiSearch.block);

const noKey = await gatherTools('новости про науку', {}, fakeFetch({}));
ok('T15: новости без ключей → тишина, а не выдумка', noKey.used.length === 0 && noKey.block === '');

console.log('T — состав слоя и бытовые инструменты (перенос из донора)');
ok('T16: в слое 18 инструментов (0.185: + график) — состав ровно тот, что ожидаем',
  TOOL_IDS().join() === 'time,calc,letters,currency,random,weather,wikipedia,url,news,web-search,date,coin,dice,joke,image-search,imggen,chart,filegen',
  TOOL_IDS().join());

const dateRes = await gatherTools('какая сегодня дата', { TZ_NAME: 'Europe/Minsk' }, fakeFetch({}));
ok('T17: дата — свой инструмент, с ISO и номером недели',
  dateRes.used.join() === 'date' && /номер недели \d+/.test(dateRes.block) && /\d{4}-\d{2}-\d{2}/.test(dateRes.block), dateRes.block);
{
  const todayish = await gatherTools('Сложи 1 250 000 и 3 750,50. В ответе только сумма по-человечески и сегодняшняя дата.', { TZ_NAME: 'Europe/Minsk' }, fakeFetch({}));
  ok('T17b: «сегодняшняя дата» будит date — \\w не ловит кириллицу',
    todayish.used.includes('date'), todayish.used.join());
  ok('T17c: «сложи 1 250 000 и 3 750,50» считает калькулятор, 1253750.5',
    todayish.used.includes('calc') && /1253750/.test(todayish.block), todayish.block);
}
{
  const tab = await gatherTools('Посчитай сумму.\nтовар\tшт\tцена\nХлеб\t10\t1,20\nМолоко\t4\t2,50\nСыр\t2\t12,00', {}, fakeFetch({}));
  ok('T17d: таблица шт×цена — сумма 46, а не пустой calc',
    tab.used.includes('calc') && /46/.test(tab.block), tab.block);
}
ok('T18: «который час» больше не тянет дату (инструменты не дублируют друг друга)',
  (await gatherTools('который час', {}, fakeFetch({}))).used.join() === 'time', 'time');
ok('T19: номер недели по ISO: 2021-01-01 = 53-я неделя 2020 года',
  isoWeek(new Date(Date.UTC(2021, 0, 1))) === 53 && isoWeek(new Date(Date.UTC(2026, 0, 1))) === 1,
  [isoWeek(new Date(Date.UTC(2021, 0, 1))), isoWeek(new Date(Date.UTC(2026, 0, 1)))].join('/'));

const coin = await gatherTools('подбрось монетку', {}, fakeFetch({}));
ok('T20: монетка — орёл или решка, честным генератором', /Монетка: (орёл|решка)/.test(coin.block) && /crypto/.test(coin.block), coin.block);
const d3 = await gatherTools('брось 3d6+2', {}, fakeFetch({}));
const v3 = Number(/= (\d+)/.exec(d3.block)[1]);
ok('T21: 3d6+2 = 3..20 и формула показана', v3 >= 3 && v3 <= 20 && /3d6\+2: \d \+ \d \+ \d \+ 2/.test(d3.block), d3.block);

const jk = await gatherTools('анекдот про котов', {}, fakeFetch({}));
const jText = jk.block.trim().split('\n').pop().trim();
ok('T22: шутка берётся из перенесённого набора, а не выдумывается',
  jk.used.join() === 'joke' && JOKES.some((j) => j.t === jText) && jText.length > 20, jText.slice(0, 50));
ok('T23: шуток перенесено 36, и они с тегами', JOKES.length === 36 && JOKES.every((j) => j.t && Array.isArray(j.tags)), String(JOKES.length));

const img = await gatherTools('найди картинку с котом', {}, fakeFetch({
  'commons.wikimedia.org/w/api.php': { query: { pages: { 7: { index: 1, title: 'File:Кот.jpg', imageinfo: [{ url: 'https://upload/1.jpg', thumburl: 'https://upload/1-t.jpg', extmetadata: { Artist: { value: '<span>Иван</span>' }, LicenseShortURL: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }] } } } },
}));
ok('T24: поиск картинок даёт адрес, автора и лицензию — без выдумки',
  img.used.join() === 'image-search' && img.block.includes('https://upload/1-t.jpg') && img.block.includes('Иван') && img.block.includes('creativecommons'), img.block.replace(/\n/g, ' | ').slice(0, 130));
ok('T25: картинки не нашлись → блока нет, а не «вот что-то похожее»',
  (await gatherTools('найди картинку с котом', {}, fakeFetch({ 'commons.wikimedia.org': { error: 1 } }))).block === '');

const fg = await gatherTools('оформи это в файл docx', {}, fakeFetch({}));
ok('T26: filegen — указание модели, а не данные: в [Инструмент: …] его нет',
  fg.used.join() === 'filegen' && fg.block === '' && fg.directive.includes('```file:docx|') && fg.directive.includes('форматы') === false && fg.directive.includes('docx, xlsx'), (fg.directive || '').replace(/\n/g, ' | ').slice(0, 120));
ok('T27: формат просьбы узнаётся: xlsx для таблицы, txt для голого текста',
  formatFromText('сделай таблицу xlsx') === 'xlsx' && formatFromText('голым текстом') === 'txt' && formatFromText('просто ответь') === 'docx', '');
ok('T28: имя файла режется по-человечески, без предлога в начале', nameFromText('оформи в файл смету на ремонт, пожалуйста') === 'смету на ремонт', nameFromText('оформи в файл смету на ремонт, пожалуйста'));

ok('T29: TOOLS_OFF выключает инструмент целиком — и навык это видит',
  (await gatherTools('анекдот про котов', { TOOLS_OFF: 'joke' }, fakeFetch({ 'x': {} }))).block === '');
ok('T30: force зовёт инструмент без триггера (так навык получает свои данные)',
  (await gatherTools('привет', {}, fakeFetch({}), { force: ['coin'] })).used.join() === 'coin', '');

console.log('T — глубокий поиск, распаковка редиректов и источники');
ok('T31: unwrapSearchUrl разворачивает редирект DDG Lite в прямую ссылку',
  unwrapSearchUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc%3Fa%3D1&rut=9') === 'https://example.com/doc?a=1'
    && unwrapSearchUrl('//example.org/p') === 'https://example.org/p',
  unwrapSearchUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc%3Fa%3D1&rut=9'));

const parsedSrc = extractSources([
  'Результаты поиска по запросу «квантовый компьютер»:',
  '1) Квантовый компьютер: вычислительное устройство — использует кубиты (https://ru.wikipedia.org/wiki/Квантовый_компьютер)',
  '2) Обзор кубитов — свежая статья (https://qc.example/article)',
  '3) Дубль той же статьи — другой сниппет (https://qc.example/article)',
].join('\n'));
ok('T32: extractSources вынимает заголовки и ссылки без дублей',
  parsedSrc.length === 2
    && parsedSrc[0].title === 'Квантовый компьютер'
    && parsedSrc[0].url === 'https://ru.wikipedia.org/wiki/Квантовый_компьютер'
    && parsedSrc[1].title === 'Обзор кубитов'
    && parsedSrc[1].url === 'https://qc.example/article',
  JSON.stringify(parsedSrc));

const deepRes = await gatherTools('сверхпроводники при комнатной температуре', {}, fakeFetch({
  'api.wikimedia.org/core/v1/wikipedia/ru/search': {
    pages: [{ title: 'Сверхпроводимость', key: 'Сверхпроводимость', description: 'свойство материалов', excerpt: 'нулевое электрическое сопротивление' }],
  },
  'api.duckduckgo.com': { AbstractText: '', RelatedTopics: [] },
  'lite.duckduckgo.com': '<a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fphys.example%2Flk99">Проверка образцов</a><td class="result-snippet">Критический разбор</td>',
  'https://phys.example/lk99': '<html><body><p>Подробный отчёт лаборатории показал отсутствие эффекта Мейснера при комнатной температуре в проверенных образцах.</p></body></html>',
}), { deep: true });
ok('T33: deep=true включает веб-поиск без слова «погугли», склеивает вики + выдачу + выжимку страницы и собирает sources',
  deepRes.used.includes('web-search')
    && deepRes.block.includes('нулевое электрическое сопротивление')
    && deepRes.block.includes('Выжимка из источника (https://phys.example/lk99)')
    && deepRes.block.includes('отсутствие эффекта Мейснера')
    && deepRes.sources.length === 2
    && deepRes.sources[1].url === 'https://phys.example/lk99',
  JSON.stringify({ sources: deepRes.sources, block: deepRes.block.slice(0, 220) }));

const deepOff = await gatherTools('сверхпроводники', { TOOLS_OFF: 'web-search' }, fakeFetch({}), { deep: true });
ok('T34: TOOLS_OFF запрещает web-search даже при deep=true',
  deepOff.used.length === 0 && deepOff.block === '' && deepOff.sources.length === 0);

ok('T35: gatherTools собирает webSteps (search + fetch) для блока «Searching the web»',
  Array.isArray(deepRes.webSteps)
    && deepRes.webSteps.some((s) => s.kind === 'search' && /сверхпроводники/.test(s.query || ''))
    && deepRes.webSteps.some((s) => s.kind === 'fetch' && s.url === 'https://phys.example/lk99'),
  JSON.stringify(deepRes.webSteps));

{
  const { lettersOf, LETTERS_ASK } = await import('../engine/tools.js');
  ok('T132a: «Сколько букв «р» в слове «пререкаться»?» — 2, посчитано кодом, а не моделью',
    LETTERS_ASK.test('Сколько букв «р» в слове «пререкаться»?') && /встречается 2 раз/.test(lettersOf('Сколько букв «р» в слове «пререкаться»?')));
  ok('T132b: английский «how many r\'s in strawberry» — 3', /встречается 3 раз/.test(lettersOf("How many r's in strawberry?")));
  ok('T132c: предлог «в» не принимается за букву («сколько букв в слове молоко» — 6 букв, без счёта «в»)',
    /6 букв/.test(lettersOf('сколько букв в слове молоко')) && !/Буква/.test(lettersOf('сколько букв в слове молоко')));
  ok('T132d: слоги — по гласным', /слогов: 4/.test(lettersOf('Сколько слогов в слове «телевизор»?')));
}

/* 0.163: дата источника доезжает до плашек под ответом. */
{
  const { extractSources } = await import('../engine/tools.js');
  const block = '1) Курс доллара (https://myfin.by/usd · от 2026-10-04)\n2) Старая статья (https://old.by/x)';
  const src = extractSources(block);
  ok('T163a: дата источника вынута из строки поиска и уехала в плашку', src[0].date === '2026-10-04', JSON.stringify(src[0]));
  ok('T163b: без даты источник остаётся без выдуманной свежести', src[1] && src[1].date === undefined, JSON.stringify(src[1]));
}

/* 0.231: адрес со скобкой и хвост даты не ломают плашку. */
{
  const { extractSources } = await import('../engine/tools.js');
  const src = extractSources([
    '1) React (software) — Wikipedia (https://en.wikipedia.org/wiki/React_(software) · от 2020-03-01 · 6 лет назад · ДАВНИЙ источник: данные могли устареть)',
    '2) React Versions (https://react.dev/versions)',
  ].join('\n'));
  ok('T231a: адрес со скобкой не обрезается, заголовок не съедает служебный хвост',
    src[0].url === 'https://en.wikipedia.org/wiki/React_(software)'
      && src[0].title === 'React (software)'
      && src[0].date === '2020-03-01'
      && src[1].url === 'https://react.dev/versions' && src[1].title === 'React Versions',
    JSON.stringify(src));
  ok('T231b: лимит плашек задаётся и не режет список молча на восьми',
    extractSources('1) A (https://a.by)\n2) B (https://b.by)\n3) C (https://c.by)', 2).length === 2
      && extractSources('1) A (https://a.by)\n2) B (https://b.by)', 16).length === 2);
}

/* 0.165: у данных из открытых API есть свой адрес и дата — их видно в плашках.
   Повод: на живом проде ответ про курс дописал «данные на 18 июля 2026» и ссылку
   на ЦБ, которых в данных инструмента не было. Даты и ссылки — только из данных. */
{
  const cur2 = await gatherTools('курс доллара к рублю', {}, fakeFetch({
    'open.er-api.com/v6/latest/RUB': { rates: { USD: 0.011, EUR: 0.0094 }, time_last_update_unix: 1791619200 },
  }));
  ok('T165a: курсы отдают источник с датой обновления (не «на сегодня» без числа)',
    /https:\/\/open\.er-api\.com\/v6\/latest\/RUB · от 2026-10-10/.test(cur2.block), cur2.block);
  ok('T165b: источник курсов доехал до плашек с датой и без «шагов поиска»',
    cur2.sources.length === 1 && cur2.sources[0].date === '2026-10-10'
      && cur2.webSteps.length === 0, JSON.stringify({ src: cur2.sources, steps: cur2.webSteps.length }));

  const w2 = await gatherTools('погода в варшаве', {}, fakeFetch({
    'geocoding-api.open-meteo.com': { results: [{ name: 'Варшава', latitude: 52.2, longitude: 21.0 }] },
    'api.open-meteo.com': {
      current: { temperature_2m: 12.4, apparent_temperature: 10.1, wind_speed_10m: 3.6, precipitation: 0, weather_code: 1, time: '2026-10-11T09:00' },
      daily: { temperature_2m_max: [15], temperature_2m_min: [7] },
    },
  }));
  ok('T165c: погода отдаёт источнику время наблюдения',
    w2.sources.length === 1 && w2.sources[0].date === '2026-10-11', JSON.stringify(w2.sources));

  const off = await gatherTools('курс доллара к рублю', {}, fakeFetch({
    'open.er-api.com/v6/latest/RUB': { rates: { USD: 0.011 } },
  }));
  ok('T165d: без времени обновления источник остаётся без даты — выдумывать нечего',
    off.sources.length === 1 && off.sources[0].date === undefined, JSON.stringify(off.sources));
}

/* 0.165: правило о честных датах стоит рядом с подсказкой про инструменты. */
{
  const chat = readFileSync('engine/chat.js', 'utf8');
  ok('T165e: модели сказано не выдумывать даты и адреса',
    /Дат[аы]/.test(chat) && /бери только из данных/.test(chat));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
