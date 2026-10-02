/**
 * Инструменты агента — триггеры, разбор ответов, тишина при пустоте.
 * Сети нет: fetch внедряется и отвечает заглушками.
 * Запуск: node test/tools.test.js
 */
import assert from 'node:assert';
import { gatherTools, evalExpr, TOOL_IDS, JOKES, isoWeek } from '../engine/tools.js';
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
        return {
          ok: true, status: 200,
          json: async () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
          text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
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
  'open.er-api.com/v6/latest/RUB': { rates: { USD: 0.011, EUR: 0.0094, BYN: 0.026 } },
}));
ok('T8: «курс доллара» → база RUB и USD в ответе', cur.used.join() === 'currency' && cur.block.includes('RUB') && cur.block.includes('USD'), cur.block);

const weather = await gatherTools('погода в варшаве', {}, fakeFetch({
  'geocoding-api.open-meteo.com': { results: [{ name: 'Варшава', latitude: 52.2, longitude: 21.0 }] },
  'api.open-meteo.com': {
    current: { temperature_2m: 12.4, apparent_temperature: 10.1, wind_speed_10m: 3.6, precipitation: 0, weather_code: 1 },
    daily: { temperature_2m_max: [15], temperature_2m_min: [7] },
  },
}));
ok('T9: погода нашла город и показала температуру', weather.used.join() === 'weather' && weather.block.includes('Варшава') && weather.block.includes('12°C'), weather.block);

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
ok('T16: в слое 16 инструментов — состав ровно тот, что ожидаем',
  TOOL_IDS().join() === 'time,calc,currency,random,weather,wikipedia,url,news,web-search,date,coin,dice,joke,image-search,imggen,filegen',
  TOOL_IDS().join());

const dateRes = await gatherTools('какая сегодня дата', { TZ_NAME: 'Europe/Minsk' }, fakeFetch({}));
ok('T17: дата — свой инструмент, с ISO и номером недели',
  dateRes.used.join() === 'date' && /номер недели \d+/.test(dateRes.block) && /\d{4}-\d{2}-\d{2}/.test(dateRes.block), dateRes.block);
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

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
