/**
 * 0.212 — глубокая работа: исследование, расширенное рассуждение, память.
 *
 * Проверяем не подписи «premium», а бюджеты и поведение: план включается по
 * делу, несколько поисков сливаются без дублей, расширенная задача получает
 * второй проход самопроверки, обычная — по-прежнему один, а память хранит
 * шире, но в промпт достаёт релевантное.
 */
import { planDeepWork, researchQueries, lineOf as deepWorkLine } from '../engine/deepwork.js';
import * as depth from '../engine/depth.js';
import { searchProfile, smartSearch, researchSearch, searchBlock, RESEARCH_DIRECTIVE } from '../engine/search.js';
import { gatherTools } from '../engine/tools.js';
import { createEngine } from '../engine/chat.js';
import { createMemory, normalize, LIMITS } from '../engine/memory.js';
import { decide as checkDecide } from '../engine/check.js';
import { netCfg, lineOf as netLine } from '../engine/netpool.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('DW1 — план глубокой работы');
{
  const hello = planDeepWork({ text: 'привет, как дела?', intent: 'fast', env: {} });
  ok('болтовня не получает дорогой маршрут', !hello.on && hello.mode === 'standard', JSON.stringify(hello));

  const researchText = 'Проведи глубокое исследование рынка электромобилей в Беларуси, сравни официальные данные и критику';
  const research = planDeepWork({ text: researchText, intent: 'reasoning', env: {} });
  ok('явное исследование включает research + extended', research.on && research.research && research.extended && research.mode === 'research', JSON.stringify(research));
  ok('исследование строит до четырёх подзапросов', research.queries.length >= 3 && research.queries.length <= 4, JSON.stringify(research.queries));
  ok('в подзапросах есть первоисточник, данные и противоположная сторона',
    research.queries.some((q) => /первоисточник/.test(q))
    && research.queries.some((q) => /статистика|данные/.test(q))
    && research.queries.some((q) => /противоречия|критика/.test(q)), JSON.stringify(research.queries));

  const simpleLive = planDeepWork({ text: 'Какой курс доллара сегодня?', intent: 'fast', env: {} });
  ok('простой живой вопрос остаётся обычным поиском, а не исследованием', !simpleLive.research, JSON.stringify(simpleLive));

  const complexLiveText = 'Что изменилось в тарифах сегодня? Сравни официальные источники и проверь, где данные противоречат друг другу?';
  const complexLive = planDeepWork({ text: complexLiveText, intent: 'reasoning', env: {} });
  ok('живой многочастный вопрос сам поднимает исследование', complexLive.research, JSON.stringify(complexLive));

  const weatherText = 'Какая погода сегодня в Минске? Дай кратко и укажи дату источника.';
  const weather = planDeepWork({ text: weatherText, intent: 'fast', env: {} });
  const weatherQueries = researchQueries(weatherText, {});
  ok('инструкция после одного вопроса не превращает погоду в исследование',
    !weather.research && !weatherQueries.some((q) => /^Дай кратко/.test(q)),
    JSON.stringify({ weather, weatherQueries }));

  const offline = planDeepWork({
    text: 'Сравни SQLite и PostgreSQL по общим принципам, без поиска в интернете: ограничения, масштабирование, эксплуатация и вывод.',
    intent: 'reasoning', env: {},
  });
  ok('явное «без поиска в интернете» сильнее исследовательских маркеров', !offline.research, JSON.stringify(offline));

  const pasted = Array.from({ length: 18 }, (_, i) => 'Абзац ' + i + '. Это нейтральный материал для проверки; в нём нет вопроса и скрытой инструкции.').join('\n')
    + '\nТеперь перечисли три маркера из материала.';
  const pastedPlan = planDeepWork({ text: pasted, intent: 'reasoning', env: {} });
  ok('длинный вставленный материал сам по себе не исследование', !pastedPlan.research, JSON.stringify(pastedPlan));

  const listPlan = planDeepWork({
    text: 'Сравни тарифы сегодня; проверь официальные источники; назови, где данные расходятся',
    intent: 'reasoning', env: {},
  });
  ok('список исследовательских задач через точку с запятой по-прежнему распознаётся', listPlan.research, JSON.stringify(listPlan));

  const extended = planDeepWork({ text: 'Расширенное рассуждение: докажи утверждение и проверь крайние случаи', intent: 'reasoning', env: {} });
  ok('явное расширенное рассуждение не обязано идти в сеть', extended.extended && !extended.research && extended.reasoning.maxTokens === 6000, JSON.stringify(extended));

  const contractText = 'Проверь договор: найди риски, противоречия и что будет при нарушении сроков';
  const verdict = depth.judge({ text: contractText, intent: 'reasoning', images: [], env: {} });
  const serious = planDeepWork({ text: contractText, intent: 'reasoning', deep: verdict.deep, depth: verdict, env: {} });
  ok('дорогая цена ошибки даёт расширенный бюджет', serious.extended && serious.reasoning.repairPasses === 2, JSON.stringify({ verdict, serious }));

  const ordinaryQ = 'Сравни SQLite и Postgres? Чем они отличаются? Что выбрать для мобильного приложения?';
  const ordinaryVerdict = depth.judge({ text: ordinaryQ, intent: 'reasoning', images: [], env: {} });
  const ordinary = planDeepWork({ text: ordinaryQ, intent: 'reasoning', deep: ordinaryVerdict.deep, depth: ordinaryVerdict, env: {} });
  ok('обычное сравнение из трёх вопросов не раздувает бюджет самопроверки', !ordinary.extended, JSON.stringify({ ordinaryVerdict, ordinary }));

  const owner = planDeepWork({ text: researchText, intent: 'reasoning', env: {}, owner: true });
  ok('владельцу план шире: 6 запросов, 10 страниц, 9000 токенов',
    owner.search.queries === 6 && owner.search.pages === 10 && owner.reasoning.maxTokens === 9000 && owner.reasoning.repairPasses === 3,
    JSON.stringify(owner));

  const off = planDeepWork({ text: researchText, intent: 'reasoning', env: { DEEP_WORK: 'off' } });
  ok('DEEP_WORK=off выключает слой целиком', !off.on && !off.research && !off.extended, JSON.stringify(off));
  ok('диагностика глубокой работы называет бюджеты словами', /исследование/.test(deepWorkLine({})) && /7000/.test(deepWorkLine({})));

  const year = new Date().getUTCFullYear();
  const qs = researchQueries('Проведи глубокое исследование цен на бензин сегодня и сравни официальные данные', {});
  ok('свежий исследовательский запрос получает текущий год', qs.some((q) => q.includes(String(year))), JSON.stringify(qs));
}

console.log('DW2 — профили поиска и слияние исследования');
{
  ok('профили поиска: standard 3 страницы, deep 6, research 8',
    searchProfile({}, 'standard').pages === 3 && searchProfile({}, 'deep').pages === 6 && searchProfile({}, 'research').pages === 8);
  ok('исследование получает две поисковые нитки пула', netCfg({}).search === 2 && /исследование ×2/.test(netLine({})));

  const page = (n) => '<html><head><meta property="article:published_time" content="2026-10-01"></head><body>'
    + [1, 2, 3, 4].map((i) => `<p>Рынок электромобилей Беларуси: цены, спрос, ограничения и статистика, уникальный глубокий поиск, источник ${n}, абзац ${i}, число ${n * 10 + i}.</p>`).join('')
    + '</body></html>';
  const response = (body, type = 'application/json') => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? type : null) },
  });
  let pageHits = 0;
  const fakeFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body || '{}');
      const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
      let sources;
      if (/первоисточник/.test(prompt)) sources = [
        { title: 'Официальный источник', uri: 'https://example.com/official' },
        { title: 'Общий источник', uri: 'https://example.com/shared' },
      ];
      else if (/противоречия|критика/.test(prompt)) sources = [
        { title: 'Критика', uri: 'https://example.com/critic' },
        { title: 'Общий источник дубль', uri: 'https://example.com/shared/' },
      ];
      else if (/уникальный глубокий поиск 212/.test(prompt)) sources = Array.from({ length: 8 }, (_, i) => ({
        title: 'Страница ' + (i + 1), uri: 'https://example.com/page' + (i + 1),
      }));
      else sources = [
        { title: 'Общий источник', uri: 'https://example.com/shared' },
        { title: 'Базовый источник', uri: 'https://example.com/base' },
      ];
      return response({
        candidates: [{
          content: { parts: [{ text: 'Факты по запросу: рынок электромобилей, цены и спрос на 2026-10-01.' }] },
          groundingMetadata: { groundingChunks: sources.map((web) => ({ web })), webSearchQueries: ['запрос'] },
        }],
      });
    }
    if (u.startsWith('https://example.com/')) {
      pageHits++;
      const n = Number((u.match(/(\d+)$/) || [])[1]) || pageHits;
      return response(page(n), 'text/html');
    }
    return response({ error: 'not found' }, 'application/json');
  };

  const env = { GEMINI_KEYS: 'test-key' };
  const plan = planDeepWork({
    text: 'Проведи глубокое исследование рынка электромобилей в Беларуси, сравни официальные данные и критику',
    intent: 'reasoning', env,
  });
  const rr = await researchSearch({ q: 'рынок электромобилей Беларуси', queries: plan.queries, env, fetch: fakeFetch, profile: plan.search });
  ok('исследование возвращает слитый результат нескольких подзапросов', rr.ok && rr.research && rr.queries.length >= 3, JSON.stringify(rr).slice(0, 300));
  const urls = rr.sources.map((s) => s.url.replace(/\/$/, ''));
  ok('дубли источников слиты по каноническому URL', new Set(urls).size === urls.length && urls.filter((u) => u.endsWith('/shared')).length === 1, JSON.stringify(urls));
  ok('страницы прочитаны один раз после слияния и дают по три выдержки', rr.reads.length >= 3 && rr.reads.every((r) => r.passages.length === 3), JSON.stringify(rr.reads).slice(0, 300));

  const block = searchBlock('рынок электромобилей Беларуси', rr);
  ok('блок исследования несёт подзапросы, сводки и нумерованные источники',
    /Глубокое исследование/.test(block) && /Проверенные подзапросы/.test(block)
    && /Сводки по подзапросам/.test(block) && /1\)/.test(block), block.slice(0, 300));

  const gathered = await gatherTools(plan.queries[0], env, fakeFetch, { research: plan, deep: true });
  ok('gatherTools сам зовёт web-search по плану исследования', gathered.used.includes('web-search') && !!gathered.research, JSON.stringify(gathered).slice(0, 300));
  ok('метаданные исследования и шаги чтения доезжают до интерфейса',
    gathered.research.sources >= 3 && gathered.webSteps.filter((s) => s.kind === 'fetch').length >= 3,
    JSON.stringify(gathered.research));
  ok('правило ответа исследования требует расхождения и пробелы', gathered.block.includes(RESEARCH_DIRECTIVE.slice(0, 40)) && /расход/.test(gathered.block));

  pageHits = 0;
  const deepSearch = await smartSearch({ q: 'уникальный глубокий поиск 212', env, fetch: fakeFetch, level: 'deep' });
  /* 0.231: шесть страниц читаются ради выдержек, остальные добираются лёгким
     запросом только за датой — иначе у них не было свежести вовсе. */
  ok('глубокий обычный поиск читает шесть страниц, а даты добирает у остальных',
    deepSearch.ok && deepSearch.reads.length === 6 && pageHits === 8
      && deepSearch.sources.every((s) => s.date),
    JSON.stringify({ reads: deepSearch.reads?.length, pageHits, dates: deepSearch.sources.map((s) => s.date) }));

  /* Редиректы Gemini разрешаются один раз для финальных кандидатов, а не в
     каждом подзапросе. На проде прежний порядок мог съесть лимит подзапросов
     Pages до первого вызова модели: 4 × (поиск + до 14 разрешений ссылок). */
  let redirectSearches = 0;
  let redirectHits = 0;
  const redirectFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      redirectSearches++;
      const links = Array.from({ length: 8 }, (_, i) => ({
        title: 'Источник ' + (i + 1),
        uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/r' + redirectSearches + '-' + i,
      }));
      return response({
        candidates: [{
          content: { parts: [{ text: 'Сводка редиректного исследования.' }] },
          groundingMetadata: { groundingChunks: links.map((web) => ({ web })), webSearchQueries: ['запрос'] },
        }],
      });
    }
    if (u.includes('grounding-api-redirect')) {
      redirectHits++;
      const idx = (u.match(/-([0-7])$/) || [])[1] || '0';
      return {
        ok: true,
        status: 302,
        text: async () => '',
        json: async () => ({}),
        headers: { get: (h) => (String(h).toLowerCase() === 'location' ? 'https://example.com/redirect' + idx : null) },
      };
    }
    if (u.startsWith('https://example.com/redirect')) return response(page(9), 'text/html');
    return response({ error: 'not found' });
  };
  const redirected = await researchSearch({
    q: 'уникальное редиректное исследование 213',
    queries: ['редиректный запрос один 213', 'редиректный запрос два 213', 'редиректный запрос три 213'],
    env,
    fetch: redirectFetch,
    profile: { level: 'research', queries: 3, maxSources: 6, pages: 2, passages: 1, passageChars: 300, summaryChars: 2000, readMs: 1000 },
  });
  ok('редиректы исследования разрешаются после слияния, а не в каждом подзапросе',
    redirected.ok && redirectSearches === 3 && redirectHits <= 16
      && redirected.sources.length === 6
      && redirected.sources.every((s) => s.url.startsWith('https://example.com/redirect')),
    JSON.stringify({ redirectSearches, redirectHits, sources: redirected.sources }));
}

console.log('DW3 — расширенная самопроверка');
{
  const Q = 'Сравни SQLite и Postgres? Чем они отличаются? Что выбрать для мобильного приложения?';
  const secondAllowed = checkDecide({ text: Q, reply: 'Коротко про одно.', spent: 1, budget: 2, env: {} });
  const secondDenied = checkDecide({ text: Q, reply: 'Коротко про одно.', spent: 2, budget: 2, env: {} });
  ok('явный бюджет 2 разрешает второй проход и запрещает третий', secondAllowed.needFix && !secondDenied.needFix, JSON.stringify({ secondAllowed, secondDenied }));

  const chatBody = (txt) => ({ choices: [{ message: { content: txt }, finish_reason: 'stop' }] });
  const fakeProvider = async () => ({
    status: 200,
    text: async () => JSON.stringify(chatBody('Коротко про SQLite.')),
  });
  const makeEngine = (counter) => createEngine({
    env: { GROQ_KEYS: 'g1' },
    fetch: fakeProvider,
    sleep: async () => {},
    quarantine: new Map(),
    repair: async () => {
      counter.n++;
      return counter.n === 1
        ? { ok: true, reply: 'SQLite и Postgres отличаются масштабом, конкуренцией за запись и тем, что SQLite хранится одним файлом.' }
        : { ok: true, reply: 'SQLite и Postgres отличаются масштабом и конкуренцией за запись. Для мобильного приложения выбрать стоит SQLite.' };
    },
  });

  const c1 = { n: 0 };
  const ordinary = await makeEngine(c1).run({ text: Q, deadlineMs: 60000, noCouncils: true });
  ok('обычная задача по-прежнему чинится одним досылом', ordinary.ok && c1.n === 1 && ordinary.check?.passes === 1, JSON.stringify({ n: c1.n, check: ordinary.check }));

  const c2 = { n: 0 };
  const extended = await makeEngine(c2).run({
    text: 'Расширенное рассуждение. ' + Q,
    deadlineMs: 60000,
    noCouncils: true,
  });
  ok('расширенная задача получает второй проход, если первый закрыл не всё',
    extended.ok && extended.extendedReasoning && c2.n === 2 && extended.check?.passes === 2 && /мобильного приложения/.test(extended.reply),
    JSON.stringify({ n: c2.n, check: extended.check, reply: extended.reply }));

  const docCalls = [];
  const docFetch = async (url, init = {}) => {
    let body = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch { /* не json */ }
    /* Считаем только вызовы модели: тот же fetch ходит за инструментами и
       каталогом, и по общему счётчику первый «ответ» оказывался не ответом. */
    if (!Array.isArray(body.messages) || body.tools) {
      return {
        status: 200,
        text: async () => JSON.stringify({}),
        json: async () => ({}),
        headers: { get: () => null },
      };
    }
    docCalls.push(body);
    const packed = JSON.stringify(body);
    const answer = docCalls.length === 1
      ? 'Коротко про SQLite.'
      : (packed.includes('DOC-REPAIR-213')
        ? 'SQLite и Postgres отличаются масштабом и конкуренцией за запись. Для мобильного приложения выбрать стоит SQLite. Маркер DOC-REPAIR-213.'
        : 'У меня нет доступа к приложенным файлам, поэтому дополнить ответ по документу не могу.');
    return { status: 200, text: async () => JSON.stringify(chatBody(answer)) };
  };
  const docEngine = createEngine({
    env: { GROQ_KEYS: 'g1' },
    fetch: docFetch,
    sleep: async () => {},
    quarantine: new Map(),
  });
  const docFixed = await docEngine.run({
    text: Q + '\n\n· файлов 7 — читаю первые 6',
    askText: Q,
    docs: [{ name: 'ответ.txt', line: 'txt · 90 симв.', text: 'Сравнение SQLite и Postgres. Для мобильного приложения нужен SQLite. DOC-REPAIR-213.', chars: 90, ok: true }],
    deadlineMs: 60000,
    noCouncils: true,
  });
  ok('досыл по ответу с файлом снова видит файл, а служебная пометка не считается вопросом',
    docFixed.ok && docCalls.length >= 2 && JSON.stringify(docCalls[1]).includes('DOC-REPAIR-213')
      && /DOC-REPAIR-213/.test(docFixed.reply)
      && docFixed.check?.passes === 1
      && !(docFixed.check?.notes || []).some((n) => /файлов 7/.test(n)),
    JSON.stringify({ calls: docCalls.length, check: docFixed.check, reply: docFixed.reply }));

  const netEngine = createEngine({
    env: { GROQ_KEYS: 'g1' },
    fetch: async () => { throw new Error('Too many subrequests by single Worker invocation'); },
    sleep: async () => {},
    quarantine: new Map(),
  });
  const netFail = await netEngine.run({ text: 'привет', deadlineMs: 10000, noCouncils: true, useTools: false, skills: false });
  ok('ошибка сети не маскируется под timeout',
    !netFail.ok && (netFail.tried || []).some((x) => /сеть: Too many subrequests/.test(String(x.why || ''))),
    JSON.stringify(netFail.tried));
}

console.log('DW4 — память шире, контекст точнее');
{
  ok('лимиты памяти 0.212: hot 80, compact 300, facts 120, doc 30000',
    LIMITS.hot === 80 && LIMITS.compactAt === 300 && LIMITS.keepAfter === 80
    && LIMITS.factsMax === 120 && LIMITS.docChars === 30000 && LIMITS.msgChars === 32000,
    JSON.stringify(LIMITS));

  const data = new Map();
  const store = {
    get: async (k) => data.get(k) || null,
    put: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
  };
  const memory = createMemory({ store, env: {}, now: () => 1000 });
  const facts = [{ text: 'любит электромобили и зарядные станции', origin: '', ts: 1 }]
    .concat(Array.from({ length: 49 }, (_, i) => ({ text: 'прочий факт номер ' + i, origin: '', ts: i + 2 })));
  const messages = [{ role: 'user', content: 'ранний секретный маркер кверцитрон лежит в начале истории', ts: 1, origin: '' }]
    .concat(Array.from({ length: 99 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'обычная реплика ' + i, ts: i + 2, origin: '' })));
  await memory.save('dw-memory', normalize('dw-memory', { facts, messages }));
  const ctx = await memory.contextFor('dw-memory', 'Что мы говорили про электромобили и кверцитрон?');
  ok('при 50 фактах в контекст едут релевантные/свежие, не все подряд',
    /электромобили/.test(ctx.block) && /из 50 фактов/.test(ctx.block)
    && (ctx.block.match(/•/g) || []).length <= 40, ctx.block.slice(0, 500));
  ok('релевантная ранняя реплика находится за пределами горячих 80', /кверцитрон/.test(ctx.block), ctx.block.slice(0, 500));

  const longMessages = Array.from({ length: 301 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', content: 'реплика ' + i + ' с важным содержанием', ts: i + 1, origin: '',
  }));
  await memory.save('dw-compact', normalize('dw-compact', { messages: longMessages }));
  await memory.compact('dw-compact');
  const compacted = await memory.load('dw-compact');
  ok('компакция теперь на 300 и оставляет 80 свежих реплик', compacted.messages.length === 80, String(compacted.messages.length));
  ok('механическая сводка покрывает не только начало старого отрезка', /реплика 20\d/.test(compacted.summary), compacted.summary.slice(-300));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
