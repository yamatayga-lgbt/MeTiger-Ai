/**
 * Инструменты агента — триггеры, разбор ответов, тишина при пустоте.
 * Сети нет: fetch внедряется и отвечает заглушками.
 * Запуск: node test/tools.test.js
 */
import assert from 'node:assert';
import { gatherTools, evalExpr, TOOL_IDS } from '../engine/tools.js';

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
ok('T6: кубик d20 сработал и в диапазоне', dice.used.join() === 'random' && /выпало \d+/.test(dice.block) && /d20/.test(dice.block), dice.block);

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

console.log('T — состав слоя');
ok('T16: в слое 9 инструментов', TOOL_IDS().length === 9, TOOL_IDS().join());

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
