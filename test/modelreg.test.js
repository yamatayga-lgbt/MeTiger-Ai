/**
 * Живой каталог моделей (engine/modelreg.js) — список «как в Yama» и обход
 * ограничений по настоящим потолкам, а не по угадыванию имени.
 *
 * Проверки идут по живым граблям донора: зрение по подстроке `flash` (400 на
 * картинке и сожжённая квота), `max_tokens` выше потолка модели, id модели,
 * которую провайдер уже снял, ручной выбор, которого нет в пулах.
 *
 *   node test/modelreg.test.js
 */
import * as M from '../engine/modelreg.js';
/** Форма запроса — то, где потолок модели становится числом в теле запроса. */
import { buildRequest } from '../engine/shape.js';
import { createEngine } from '../engine/chat.js';
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/models.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Копия KV-байндинга: значения строками, TTL в секундах, инъективные часы. */
function fakeKv(start) {
  let nowMs = start || 1000000;
  const map = new Map();
  const api = {
    get: async (key) => (map.has(key) ? map.get(key).value : null),
    put: async (key, value, opts) => {
      const ttl = opts && opts.expirationTtl;
      map.set(key, { value, until: ttl ? nowMs + ttl * 1000 : Infinity });
      api.puts++;
    },
    delete: async (key) => { map.delete(key); api.deletes++; },
    _raw: map,
    _set: (t) => { nowMs = t; },
    puts: 0, deletes: 0,
  };
  return api;
}

const OR_FIX = {
  data: [
    {
      id: 'nex-agi/nex-n2.5-mini:free', name: 'Nex N2.5 Mini (free)',
      context_length: 131072,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192 },
      supported_parameters: ['max_tokens', 'tools', 'include_reasoning'],
      pricing: { prompt: '0', completion: '0' },
      description: 'Быстрая маленькая модель.   Видит картинки.',
    },
    {
      id: 'inclusionai/ling-3.0-flash-sante:free',
      context_length: 32768,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 4096 },
      supported_parameters: ['max_tokens'],
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'openai/embedding-3', context_length: 8191,
      architecture: { input_modalities: ['text'], output_modalities: [] },
      pricing: { prompt: '0', completion: '0' },
    },
    {
      id: 'anthropic/claude-paid', context_length: 200000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 64000 },
      pricing: { prompt: '0.003', completion: '0.015' },
    },
  ],
};

const XK_FIX = {
  data: [
    {
      id: 'qwen3.8-27b', context_length: 65536, max_output_tokens: 16384,
      capabilities: { vision: true, tools: true, reasoning: true },
      pricing: { input: 0, output: 0 }, description: 'из Xkiро',
    },
    { id: 'bge-m3', modality: 'embedding', context_length: 8192, pricing: { input: 0, output: 0 } },
    { id: 'paid-only', context_length: 8192, pricing: { input: 0.001, output: 0.002 } },
  ],
};

console.log('── A · разбор чужих форматов ───');
const or0 = M.TEST.fromOpenRouter(OR_FIX.data[0]);
ok('A1 зрение взято из модальностей, а не из имени', or0.vision === true, JSON.stringify(or0.vision));
ok('A2 ctx и maxOut из реальных полей', or0.ctx === 131072 && or0.maxOut === 8192, `${or0.ctx}/${or0.maxOut}`);
ok('A3 tools и reasoning прочитаны из supported_parameters', or0.tools === true && or0.canExcludeReasoning === true);
ok('A4 бесплатность по суффиксу :free', or0.free === true);
ok('A5 описание спрессовано', or0.desc === 'Быстрая маленькая модель. Видит картинки.', or0.desc);
const or1 = M.TEST.fromOpenRouter(OR_FIX.data[1]);
ok('A6 «flash» в имени больше не делает модель зрячей', or1.vision === false && or1.visionKnown === true);
const or2 = M.TEST.fromOpenRouter(OR_FIX.data[2]);
ok('A7 эмбеддинги помечены не-чатом', or2.chat === false);
const or3 = M.TEST.fromOpenRouter(OR_FIX.data[3]);
ok('A8 платная модель помечена платной', or3.free === false);
const xk0 = M.TEST.fromXkiro(XK_FIX.data[0]);
ok('A9 Xkiро: зрение и инструменты из capabilities', xk0.vision === true && xk0.tools === true && xk0.ctx === 65536 && xk0.maxOut === 16384);
ok('A10 Xkiро: бесплатность по цене 0, суффикса нет', xk0.free === true && xk0.src === 'xkiro');
ok('A11 Xkiро: vendor не в кириллице', xk0.vendor === 'Xkiro', xk0.vendor);
ok('A12 Xkiро: embedding отсеян', M.TEST.fromXkiro(XK_FIX.data[1]).chat === false);
ok('A13 Xkiро: платное помечено', M.TEST.fromXkiro(XK_FIX.data[2]).free === false);

console.log('── B · сборка каталога ───');
const parsed = [...OR_FIX.data, ...XK_FIX.data].map((m, i) => (i < OR_FIX.data.length ? M.TEST.fromOpenRouter(m) : M.TEST.fromXkiro(m))).filter(Boolean);
const cat = M.buildCatalog(parsed, { curated: [{ id: 'glm-4.7-flash', tier: 'fast' }], now: 555 });
ok('B1 в каталоге только бесплатное и только чат (+ то, что в пулах движка)', cat.models.length === 4, cat.models.map((m) => m.id).join(','));
ok('B2 платный claude-paid не попал', !cat.models.some((m) => m.id === 'anthropic/claude-paid'));
ok('B3 id из пулов добавлен и помечен src=pool', cat.models.some((m) => m.id === 'glm-4.7-flash' && m.src === 'pool' && m.tier === 'fast'));
ok('B4 у пуловой записи есть потолки по умолчанию', cat.byId === null && (cat.models.find((m) => m.id === 'glm-4.7-flash') || {}).ctx === 32768);
const many = M.buildCatalog(Array.from({ length: 1000 }, (_, i) => ({ id: 'x/m' + i + ':free', name: 'm' + i, free: true, chat: true, ctx: 1000, maxOut: 100, vision: false, visionKnown: true, src: 'openrouter' })), {});
ok('B5 каталог ограничен сверху: держим 900, про остальные помним только числом', many.models.length === 900 && many.count === 900 && many.total === 1000, many.count + '/' + many.total);
const dup = M.buildCatalog([{ id: 'a/b:free', free: true, chat: true, name: 'первая' }, { id: 'a/b:free', free: true, chat: true, name: 'вторая' }], {});
ok('B6 дубль id не удваивает запись и первый выигрывает', dup.models.length === 1 && dup.models[0].name === 'первая');

/* Индекс достраивается в loadCatalog; для чистых функций строим вручную. */
function indexed(c) { const byId = Object.create(null); for (const m of c.models) byId[m.id] = m; return Object.assign({}, c, { byId }); }
const CAT = indexed(cat);

console.log('── C · потолки, зрение, инструменты ───');
const ceil = M.ceilings(CAT, 'nex-agi/nex-n2.5-mini:free');
ok('C1 maxOut занижен на 1 (шлюзы отдают 400 на потолке)', ceil.maxOut === 8191 && ceil.ctx === 131072, JSON.stringify(ceil));
ok('C2 неизвестной модели потолков нет', M.ceilings(CAT, 'nope/nope') === null);
ok('C3 зрение: каталог знает', M.visionOf(CAT, 'nex-agi/nex-n2.5-mini:free') === true);
ok('C4 зрение: каталог знает «нет»', M.visionOf(CAT, 'inclusionai/ling-3.0-flash-sante:free') === false);
ok('C5 зрение: пуловая модель — не знаем, решаем по имени', M.visionOf(CAT, 'glm-4.7-flash') === null);
ok('C6 инструменты: известны', M.toolsOk(CAT, 'qwen3.8-27b') === true && M.toolsOk(CAT, 'inclusionai/ling-3.0-flash-sante:free') === false);
ok('C7 инструменты: неизвестны → null (как раньше, «умеет»)', M.toolsOk(CAT, 'glm-4.7-flash') === null);
ok('C8 пустой каталог не ломает потолки', M.ceilings(null, 'x') === null && M.visionOf(undefined, 'x') === null);

console.log('── D · вычистка мёртвых id ───');
const deadCat = indexed(M.buildCatalog(
  [
    { id: 'live/model-a:free', name: 'A', free: true, chat: true, ctx: 4096, maxOut: 512, vision: false, visionKnown: true, src: 'openrouter' },
    { id: 'gone/model-b:free', name: 'B', free: false, chat: true, ctx: 4096, maxOut: 512, vision: false, visionKnown: true, src: 'openrouter' },
  ], {},
));
ok('D1 модель, ставшая платной, убрана из пула', M.prune(deadCat, 'openrouter', ['gone/model-b:free', 'live/model-a:free']).join() === 'live/model-a:free');
ok('D2 чужие id (odirouter/groq) не трогаем', M.prune(deadCat, 'odirouter', ['gone/model-b:free', 'free-gemini-3-flash-preview']).length === 2);
ok('D3 неизвестный провайдер не прунится', M.prune(deadCat, 'groq', ['llama-3.3-70b']).join() === 'llama-3.3-70b');
ok('D4 протухший каталог ничего не имеет права убирать', M.prune(Object.assign({}, deadCat, { stale: true }), 'openrouter', ['gone/model-b:free']).length === 1);
ok('D4b пустой каталог не судит: пул остаётся как есть', M.prune({ stale: false, models: [], byId: {} }, 'openrouter', ['a/x:free']).length === 1);
ok('D5 если вымер весь пул — оставляем как есть', M.prune(indexed(M.buildCatalog([{ id: 'other/x:free', free: true, chat: true, src: 'openrouter' }], {})), 'openrouter', ['gone/a', 'gone/b']).length === 2);
ok('D6 без каталога — пул нетронут', M.prune(null, 'openrouter', ['a', 'b']).length === 2);

console.log('── E · ручной выбор модели из каталога ───');
ok('E1 xkiro-модель ведёт к xkiro', M.ownerOf(CAT, 'qwen3.8-27b') === 'xkiro');
ok('E2 openrouter-модель ведёт к openrouter', M.ownerOf(CAT, 'nex-agi/nex-n2.5-mini:free') === 'openrouter');
ok('E3 модель из пула — тоже резолвится', M.ownerOf(CAT, 'glm-4.7-flash') === 'openrouter');
ok('E4 случайного слова не выдаём', M.ownerOf(CAT, 'что-то-не-то') === null && M.ownerOf(null, 'qwen3.8-27b') === null);

console.log('── F · кэш в KV и молчаливые отказы ───');
M.forgetMemo();
const store = fakeKv(1000000);
let netCalls = 0;
const fakeFetch = async (url) => {
  netCalls++;
  return { ok: true, status: 200, json: async () => (String(url).indexOf('xkiro') >= 0 ? XK_FIX : OR_FIX) };
};
const env = { MODELS_REFRESH_MS: '120000' };
const p0 = M.refresh(env, store, { fetchImpl: fakeFetch, now: 1000000, curated: [{ id: 'glm-4.7-flash' }] });
await p0;
ok('F1 сеть дёрнута ровно по двум источникам', netCalls === 2, netCalls);
ok('F2 каталог лёг в KV одним значением', store.puts === 1 && typeof store._raw.get(M.CATALOG_KEY).value === 'string');
const saved = JSON.parse(store._raw.get(M.CATALOG_KEY).value);
ok('F3 в KV попали updatedAt, count и models', saved.updatedAt === 1000000 && saved.models.length === 4, JSON.stringify(saved.count));
M.forgetMemo();
netCalls = 0;
const cached0 = await M.loadCatalog(store, { env, now: 1000001 });
ok('F4 свежий кэш читается без сети', netCalls === 0 && cached0 && cached0.models.length === 4 && !cached0.stale);
M.forgetMemo();
const staleProbe = await M.loadCatalog(store, { env, now: 1000000 + 600000 });
ok('F5 после TTL каталог помечен протухшим', staleProbe && staleProbe.stale === true);
M.forgetMemo();
netCalls = 0;
const broke = await M.refresh(env, store, { fetchImpl: async () => { netCalls++; throw new Error('нет сети'); }, now: 1700000, sleep: async () => {} });
ok('F6 сеть легла — движок получает то, что знал, а не пустоту', broke && broke.models.length === 4 && broke.errors.length === 4, JSON.stringify((broke && broke.errors || []).slice(0, 1)));
ok('F7 на провале ничего не перезаписано', store.puts === 1 && netCalls === 4, `${netCalls} попыток`);
M.forgetMemo();
const empty = await M.refresh(env, fakeKv(1), { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }), sleep: async () => {}, now: 1 });
ok('F8 пустой ответ провайдера — пустой каталог без падения', Array.isArray(empty.models) && empty.models.length === 0 && (empty.errors || []).length === 4);
M.forgetMemo();
const obj = fakeKv(1);
await obj.put(M.CATALOG_KEY, { updatedAt: Date.now(), count: 1, models: [{ id: 'a/b:free', free: true, chat: true, ctx: 100, maxOut: 10, vision: false, visionKnown: true, src: 'openrouter' }] });
M.forgetMemo();
const fromObj = await M.loadCatalog(obj, { env, now: Date.now() });
ok('F9 файловое хранилище (объект вместо строки) декодируется', fromObj && fromObj.models.length === 1);
M.forgetMemo();
const none = await M.loadCatalog(null, { env });
ok('F10 без хранилища — null, и это не ошибка', none === null || (none && Array.isArray(none.models)));
M.forgetMemo();
const noNet = await M.refresh(env, null, { fetchImpl: async () => { throw new Error('fetch нет'); }, now: 1, sleep: async () => {} });
M.forgetMemo();
  const noStore = await M.refresh(env, null, { fetchImpl: fakeFetch, now: Date.now(), curated: [] });
  ok('F11 без хранилища каталог всё равно греется (но только в изоляте)', noStore.models.length === 3, noStore.models.length);
  M.forgetMemo();
  ok('F12 fetch нечего — пустой каталог, падения нет', Array.isArray(noNet.models) && noNet.models.length === 0, JSON.stringify(noNet.errors));

console.log('── G · витрина для выбора ───');
const pick = ['glm-4.7-flash', 'qwen3.8-27b', 'чего-нет-в-природе'];
const list = M.showcase(CAT, { pickIds: pick, curatedIds: ['glm-4.7-flash'], tierOf: () => 'smart' });
ok('G1 выбранное человеком идёт первым и по его порядку', list[0].id === 'glm-4.7-flash' && list[1].id === 'qwen3.8-27b', list.slice(0, 2).map((x) => x.id).join(','));
ok('G2 неизвестный id не теряется — он останется в списке', list[2].id === 'чего-нет-в-природе' && list[2].src === 'pool');
ok('G3 витрина помечена curated, каталог — нет', list[0].curated === true && list.some((x) => x.id === 'nex-agi/nex-n2.5-mini:free' && x.curated === false));
ok('G4 у каталожных строк есть name/vendor/потолки', (() => { const e = list.find((x) => x.id === 'qwen3.8-27b'); return e.vendor === 'Xkiro' && e.ctx === 65536 && e.maxOut === 16384; })(), JSON.stringify(list.find((x) => x.id === 'qwen3.8-27b')));
ok('G5 дублей в списке нет', new Set(list.map((x) => x.id)).size === list.length);
ok('G6 пустой каталог даёт только pickIds (не падает)', M.showcase(null, { pickIds: ['a', 'b'] }).length === 2);
ok('G7 платное и не-чат в витрину не попадают', !list.some((x) => /embedding|claude-paid/.test(x.id)));

console.log('── H · настройки ───');
ok('H1 MODELS_REFRESH_MS задаёт свежесть', M.TEST.ttlMs({ MODELS_REFRESH_MS: '600000' }) === 600000);
ok('H2 слишком мелкий TTL поднят до минуты', M.TEST.ttlMs({ MODELS_REFRESH_MS: '10' }) === 60000);
ok('H3 без настройки — 30 минут, как у донора', M.TEST.ttlMs({}) === M.DEFAULT_TTL_MS);
ok('H4 ключ кэша не пересекается с памятью чата', M.CATALOG_KEY === 'models:catalog');

console.log('── I · потолок модели доходит до тела запроса ───');
{
  const kv = fakeKv(Date.now());
  M.forgetMemo();
  const tinyFetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).indexOf('xkiro') >= 0
      ? { data: [
        { id: 'tiny/model-a', context_length: 4096, max_output_tokens: 512, capabilities: { vision: false, tools: true }, pricing: { input: 0, output: 0 } },
        { id: 'wide/model-b', context_length: 200000, max_output_tokens: 32000, capabilities: { vision: true }, pricing: { input: 0, output: 0 } },
      ] }
      : { data: [] }),
  });
  const warmed = await M.refresh({}, kv, { fetchImpl: tinyFetch, now: Date.now(), curated: [] });
  ok('I0: прогрев положил в кэш ровно то, что дали провайдеры', warmed.models.length === 2, warmed.models.length);
  const cfg = { kind: 'openai', base: 'https://api.xkiro.com/v1', keys: ['k'], account: '', id: 'xkiro' };

  const small = buildRequest({ cfg, keyIdx: 0, model: 'tiny/model-a', messages: [{ role: 'user', content: 'привет' }], system: 'система', tier: 'smart', maxTokens: 2000 });
  ok('I1: max_tokens зажат под потолок модели (512 − 1), а не 2000', small.body.max_tokens === 511, small.body.max_tokens);
  const big = buildRequest({ cfg, keyIdx: 0, model: 'wide/model-b', messages: [{ role: 'user', content: 'привет' }], system: 'система', tier: 'smart', maxTokens: 2000 });
  ok('I2: модели с большим потолком наш потолок не мешает', big.body.max_tokens === 2000, big.body.max_tokens);
  const unknown = buildRequest({ cfg, keyIdx: 0, model: 'не-из-каталога/x', messages: [{ role: 'user', content: 'привет' }], system: 'система', tier: 'smart', maxTokens: 2000 });
  ok('I3: неизвестная модель — потолок не выдумываем', unknown.body.max_tokens === 2000);

  const long = [{ role: 'user', content: 'x'.repeat(12000) }, { role: 'assistant', content: 'y'.repeat(12000) }, { role: 'user', content: 'последняя реплика' }];
  const fitted = buildRequest({ cfg, keyIdx: 0, model: 'tiny/model-a', messages: long, system: 'система', tier: 'fast', maxTokens: 900 });
  ok('I4: в контекст 4К втиснули — остались системный и последний ход', fitted.body.messages.length === 2 && fitted.body.messages[fitted.body.messages.length - 1].content === 'последняя реплика' && !fitted.body.messages.some((m) => /^y+$/.test(String(m.content))), JSON.stringify(fitted.body.messages.map((m) => String(m.content).length)));
  const wide = buildRequest({ cfg, keyIdx: 0, model: 'wide/model-b', messages: long, system: 'система', tier: 'fast', maxTokens: 900 });
  ok('I5: большой контекст не режется вообще', wide.body.messages.length === long.length + 1, wide.body.messages.length);

  console.log('── J · выбор из каталога доходит до провайдера ───');
  const ENV = { XKIRO_KEYS: 'x1', OPENROUTER_KEYS: 'o1', GROQ_KEYS: 'g1' };
  const calls = [];
  const recFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), model: body.model });
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] }) };
  };
  const eng = createEngine({ env: ENV, fetch: recFetch, sleep: async () => {} });
  const picked = await eng.run({ text: 'привет', model: 'wide/model-b' });
  ok('J1: пин каталожной модели не снят, а доведён до её провайдера', picked.ok && picked.model === 'wide/model-b' && picked.provider === 'xkiro', JSON.stringify(picked).slice(0, 160));
  ok('J2: запрос ушёл на базу этого провайдера', calls.length > 0 && /api\.xkiro\.com/.test(calls[calls.length - 1].url), calls[calls.length - 1] && calls[calls.length - 1].url);
  ok('J3: ответ подписан моделью человека, а не «Авто»', /model-b/.test(picked.model || '') && (picked.tried || []).length === 0, JSON.stringify(picked.tried || []));
  M.forgetMemo(); M.resetThrottle();
  {
    const kvOwn = fakeKv(Date.now());
    await kvOwn.put(M.CATALOG_KEY, JSON.stringify({
      updatedAt: Date.now(), count: 3,
      read: { mistral: true, gemini: true, openrouter: true },
      models: [
        { id: 'mistral-code-latest', name: 'Mistral Code', vendor: 'MISTRALAI', src: 'mistral', free: true, chat: true, ctx: 256000, maxOut: 4096, vision: false, visionKnown: false, tools: true, priceKnown: false },
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5', vendor: 'GOOGLE', src: 'gemini', free: true, chat: true, ctx: 1048576, maxOut: 65536, visionKnown: false },
        { id: 'glm-4.7-flash', name: 'GLM', vendor: 'ZAI', src: 'pool', free: true, chat: true },
      ],
    }));
    await M.warm({}, kvOwn, null);
    ok('J3a: владелец каталожной модели — тот провайдер, чей список её прислал',
      M.ownerOf(M.cached(), 'mistral-code-latest') === 'mistral' && M.ownerOf(M.cached(), 'gemini-3.5-flash') === 'gemini',
      M.ownerOf(M.cached(), 'mistral-code-latest') + '/' + M.ownerOf(M.cached(), 'gemini-3.5-flash'));
    ok('J3b: пуловой id без привязки по-прежнему пробует OpenRouter', M.ownerOf(M.cached(), 'glm-4.7-flash') === 'openrouter');
    const callsOwn = [];
    const ownFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      callsOwn.push({ url: String(url).slice(0, 40), model: body.model, max: body.max_tokens ?? body.generationConfig?.maxOutputTokens });
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] }) };
    };
    /* У провайдера обязаны быть ключи — иначе движок снимет пин законно (нет чем платить). */
    const engOwn = createEngine({ env: Object.assign({}, ENV, { MISTRAL_KEYS: 'm1' }), fetch: ownFetch, sleep: async () => {} });
    const ownPick = await engOwn.run({ text: 'привет', model: 'mistral-code-latest', maxTokens: 8000 });
    ok('J3c: пин модели вне наших пулов доходит до её провайдера и не подменяется',
      ownPick.ok && ownPick.provider === 'mistral' && ownPick.model === 'mistral-code-latest' && ownPick.pinMiss === false,
      JSON.stringify({ p: ownPick.provider, m: ownPick.model, miss: ownPick.pinMiss }));
    ok('J3d: потолок ответа взят из её же строки каталога (4096 − 1), а не из нашей щедрости',
      callsOwn.length > 0 && callsOwn[callsOwn.length - 1].max === 4095, JSON.stringify(callsOwn.slice(-1)));
  }
  M.forgetMemo();

  /* Снятая модель (в каталоге её нет) не должна уезжать в запрос: 404 стоит
     суточной квоты провайдера, а не одного ответа. */
  M.forgetMemo();
  const deadCat = { updatedAt: Date.now(), stale: false, models: [{ id: 'live/openrouter-x:free', name: 'Live', vendor: 'L', src: 'openrouter', free: true, chat: true, ctx: 8192, maxOut: 1024, vision: false, visionKnown: true, tools: true }], byId: null };
  deadCat.byId = { 'live/openrouter-x:free': deadCat.models[0] };
  const poolNow = M.prune(deadCat, 'openrouter', ['live/openrouter-x:free', 'nex-agi/nex-n2.5-mini:free', 'openrouter/free']);
  ok('J4: мёртвые id вычищены из пула перед запросом', poolNow.join() === 'live/openrouter-x:free,openrouter/free', poolNow.join());
  ok('J5: чистка не ломает ответ — движок получает живую модель', (() => {
    const r = M.showcase(deadCat, { pickIds: ['live/openrouter-x:free'], curatedIds: ['live/openrouter-x:free'], tierOf: () => 'fast' });
    return r.length === 1 && r[0].name === 'Live';
  })());

  /* Запись в каталоге может врать: провайдер выставляет id как бесплатную, а на
     запрос отвечает 404. На проде так упал пин nex-agi/nex-n2.5-mini:free — и весь
     ответ. Пин теперь имеет первый отказ, но не монопонию. */
  {
    const kv4 = fakeKv(Date.now());
    await kv4.put(M.CATALOG_KEY, JSON.stringify({
      updatedAt: Date.now(), count: 2,
      models: [
        { id: 'wide/model-b', name: 'Wide', vendor: 'W', src: 'xkiro', free: true, chat: true, ctx: 200000, maxOut: 32000, vision: true, visionKnown: true, tools: true },
        { id: 'live/openrouter-x:free', name: 'Live', vendor: 'L', src: 'openrouter', free: true, chat: true, ctx: 8192, maxOut: 1024, vision: false, visionKnown: true, tools: true },
      ],
    }));
    M.forgetMemo(); M.resetThrottle();
    await M.warm({}, kv4, null);
    const calls2 = [];
    const deadFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls2.push(body.model);
      if (body.model === 'wide/model-b') {
        return { status: 404, text: async () => '{"error":{"message":"This model is unavailable for free."}}', json: async () => ({ error: { message: 'This model is unavailable for free.' } }) };
      }
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'жив' }, finish_reason: 'stop' }] }), json: async () => ({ choices: [{ message: { content: 'жив' }, finish_reason: 'stop' }] }) };
    };
    const eng2 = createEngine({ env: ENV, fetch: deadFetch, sleep: async () => {} });
    const r2 = await eng2.run({ text: 'привет', model: 'wide/model-b' });
    ok('J6: мёртвая запись каталога не роняет ответ — движок добирается до запасных',
       r2.ok === true && r2.model !== 'wide/model-b', JSON.stringify(r2).slice(0, 150));
    ok('J7: подмена выбрана честно — известно, кого звали',
       r2.pinMiss === true && r2.pinned === 'wide/model-b' && calls2[0] === 'wide/model-b',
       calls2.slice(0, 3).join(', ') + ' · pinMiss=' + r2.pinMiss);
    M.forgetMemo();
  }

  console.log('── K · эндпоинт /api/models ───');
  {
    const store = {
      _m: new Map(),
      async get(k) { return this._m.has(k) ? this._m.get(k) : null; },
      async put(k, v) { this._m.set(k, typeof v === 'string' ? JSON.parse(v) : v); },
    };
    store._m.set(M.CATALOG_KEY, { updatedAt: Date.now(), count: 2, models: [
      { id: 'tiny/model-a', name: 'Tiny', vendor: 'T', src: 'xkiro', free: true, chat: true, ctx: 4096, maxOut: 512, vision: false, visionKnown: true, tools: true },
      { id: 'wide/model-b', name: 'Wide', vendor: 'W', src: 'xkiro', free: true, chat: true, ctx: 200000, maxOut: 32000, vision: true, visionKnown: true, tools: true },
    ] });
    M.forgetMemo();
    let net = 0;
    const env2 = { MEMORY: store, XKIRO_KEYS: 'x1', OPENROUTER_KEYS: 'o1', GROQ_KEYS: 'g1' };
    const g = globalThis.fetch;
    globalThis.fetch = async () => { net++; throw new Error('сеть не нужна при свежем кэше'); };
    const res = await onRequestGet({ request: new Request('https://metiger.example/api/models'), env: env2 });
    const d = await res.json();
    globalThis.fetch = g;
    ok('K1: 200 и ok', res.status === 200 && d.ok === true, res.status);
    ok('K2: каталог взят из KV, сеть не дёрнута', net === 0 && d.catalogCount === 2 && d.stale === false, net + '/' + d.catalogCount);
    ok('K3: models — это пулы движка + каталог, а не 19 вручную вписанных', d.count > 100 && d.models.some((m) => m.id === 'tiny/model-a'), d.count);
    ok('K4: у строк есть name/vendor и потолки', (() => { const e = d.models.find((m) => m.id === 'wide/model-b'); return e.vendor === 'W' && e.ctx === 200000 && e.maxOut === 32000 && e.vision === true; })(), JSON.stringify(d.models.find((m) => m.id === 'wide/model-b')));
    ok('K5: пулы посчитаны по провайдерам', d.pools.some((pp) => pp.provider === 'openrouter' && pp.count > 0) && d.pools.some((pp) => pp.provider === 'groq'), JSON.stringify(d.pools.map((pp) => pp.provider + ':' + pp.count)));
    ok('K6: KV есть — кэш есть', d.cached === true);
    ok('K7: POST не принимается, подсказка в теле', (await onRequestPost()).status === 405);
    const opt = await onRequestOptions();
    ok('K8: OPTIONS отдаёт CORS', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*');

    /* без KV и без сети — список всё равно есть: пулы движка */
    M.forgetMemo();
    globalThis.fetch = async () => { throw new Error('сети нет'); };
    const res2 = await onRequestGet({ request: new Request('https://metiger.example/api/models'), env: { GROQ_KEYS: 'g1' } });
    const d2 = await res2.json();
    globalThis.fetch = g;
    ok('K9: без каталога и без сети человек видит пулы, а не пустоту', d2.ok === true && d2.count > 100 && d2.catalogCount === 0 && d2.stale === false, d2.count);
    ok('K10: cached=false честно говорит, что кэша нет', d2.cached === false);

      /* ?refresh=1 обязан перечитать провайдеров, а не вернуть свежий по таймеру кэш.
         На проде без force «обновить» было декорацией: каталог не менялся. */
      M.forgetMemo();
      let net2 = 0;
      globalThis.fetch = async () => {
        net2++;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'new/model:free', name: 'New', context_length: 4096, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, top_provider: { max_completion_tokens: 1024 }, pricing: { prompt: '0', completion: '0' } }] }) };
      };
      const resR = await onRequestGet({ request: new Request('https://metiger.example/api/models?refresh=1'), env: { MEMORY: store } });
      const dR = await resR.json();
      globalThis.fetch = g;
      ok('K11: ?refresh=1 перечитывает провайдеров и отдаёт новое',
         net2 === 2 && dR.models.some((m) => m.id === 'new/model:free') && !dR.models.some((m) => m.id === 'wide/model-b'),
         net2 + ' сетевых запросов, каталог ' + dR.catalogCount);
      M.forgetMemo();

        M.forgetMemo();
  }
}

console.log('── L · сервисные модели и прогрев перед запросом ───');
{
  const svc = (id, out) => M.TEST.fromOpenRouter({ id, context_length: 8192, architecture: { input_modalities: ['text'], output_modalities: out || ['text'] }, pricing: { prompt: '0', completion: '0' } });
  ok('L1 модель модерации не попадает ни в список, ни в ротацию', svc('nvidia/nemotron-3.5-content-safety:free').chat === false);
  ok('L2 музыка (lyria) отсеяна, хотя текст она тоже отдаёт', svc('google/lyria-3-pro-preview', ['text', 'audio']).chat === false);
  ok('L3 omni с текстовым выводом остаётся — картинки она действительно видит', svc('qwen/qwen3-omni-flash:free', ['text']).chat === true);
  ok('L4 tts и audio-модели отсеяны', svc('openai/tts-1').chat === false && svc('some/audio-model').chat === false);

  /* Случай, который поймал прод: memo изолята пусто, каталог лежит только в KV. */
  M.forgetMemo(); M.resetThrottle();
  const kv2 = fakeKv(Date.now());
  await kv2.put(M.CATALOG_KEY, JSON.stringify({
    updatedAt: Date.now(), count: 1,
    models: [{ id: 'apodex/apodex-1.1-mini:free', name: 'Apodex', vendor: 'APODEX', src: 'openrouter', free: true, chat: true, ctx: 262144, maxOut: 235929, vision: false, visionKnown: true, tools: true }],
  }));
  const warmed = await M.warm({}, kv2, null);
  ok('L5 warm достаёт каталог из KV в memo движка', !!M.cached() && M.cached().models.length === 1, JSON.stringify(M.cached() && M.cached().count));
  ok('L6 после warm пин каталожной модели ведёт к её провайдеру', M.ownerOf(M.cached(), 'apodex/apodex-1.1-mini:free') === 'openrouter');
  ok('L7 warm отдаёт каталог тому, кто грел', warmed && warmed.models.length === 1);

  const g = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('сети нет'); };
  M.forgetMemo(); M.resetThrottle();
  const kv3 = fakeKv(Date.now());
  await kv3.put(M.CATALOG_KEY, JSON.stringify({ updatedAt: Date.now() - 7200000, count: 1, models: [{ id: 'x/y:free', name: 'Y', vendor: 'X', src: 'openrouter', free: true, chat: true, ctx: 1000, maxOut: 100 }] }));
  let jobs = 0;
  const cat3 = await M.warm({}, kv3, (pr) => { jobs++; Promise.resolve(pr).then(() => {}, () => {}); });
  ok('L8 протухший каталог отдаётся сразу и честно помечен', cat3 && cat3.stale === true && cat3.models.length === 1);
  ok('L9 обновление уехало в waitUntil, а не в ответ человеку', jobs === 1);
  await new Promise((r) => setTimeout(r, 60));
  const after = await M.loadCatalog(kv3, { now: Date.now() });
  ok('L10 фоновое обновление не съедало старый каталог, когда сети нет', after && after.models.length === 1, JSON.stringify(after && after.count));
  globalThis.fetch = g;

  let hits = 0;
  M.resetThrottle();
  const spy = async () => { hits++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
  await M.maybeRefresh({}, null, { fetchImpl: spy, sleep: async () => {} });
  const second = await M.maybeRefresh({}, null, { fetchImpl: spy, sleep: async () => {} });
  ok('L11 тормоз фонового обновления: сколько бы запросов ни прошло — одна попытка в минуту',
    second === null && hits === 4, hits + ' запросов (2 источника × 2 попытки), второй вызов — ' + (second === null ? 'null' : 'объект'));
  M.resetThrottle(); M.forgetMemo();
}


console.log('── M · собственные списки провайдеров ───');
{
  /* Фикстуры сняты живьём (2026-10-02) с /v1/models того же провайдера, каким
     пользуется движок: groq 11 записей, mistral 46, gemini 61, odirouter 232. */
  const groq = {
    id: 'openai/gpt-oss-120b', object: 'model', created: 1, owned_by: 'OpenAI', active: true,
    context_window: 131072, max_completion_tokens: 65536, name: 'GPT OSS 120B',
    input_modalities: ['text'], output_modalities: ['text'],
    pricing: { prompt: '0.000000075', completion: '0.0000003' }, supported_sampling_parameters: ['temperature', 'reasoning_effort'],
  };
  const whisper = { id: 'whisper-large-v3', object: 'model', owned_by: 'OpenAI', active: true, context_window: 448, max_completion_tokens: 448, input_modalities: ['audio'], output_modalities: ['transcription'] };
  const g = M.TEST.fromProviderList(groq, 'groq', { priceUnknown: true });
  ok('M1: настоящие потолки groq (131072/65536), а не выдуманные 32768/4096',
    g.ctx === 131072 && g.maxOut === 65536, g.ctx + '/' + g.maxOut);
  ok('M2: цена у groq в списке не указана — помечаем честно', g.free === true && g.priceKnown === false);
  ok('M3: reasoningEffort виден из supported_sampling_parameters', g.reasoning === true && g.canExcludeReasoning === true);
  const w = M.TEST.fromProviderList(whisper, 'groq', { priceUnknown: true });
  ok('M4: шёпот в чат не попадёт (output=transcription)', w === null || w.chat === false, JSON.stringify(w && { id: w.id, chat: w.chat }));

  const mis = { id: 'mistral-medium-latest', object: 'model', owned_by: 'mistralai', name: 'Mistral Medium Latest', max_context_length: 262144, description: '  Улучшенная  модель  ', capabilities: { completion_chat: true, function_calling: true, reasoning: true, vision: false, ocr: false } };
  const mi = M.TEST.fromProviderList(mis, 'mistral', { priceUnknown: true });
  ok('M5: mistral даёт контекст и способности из его же ответа', mi.ctx === 262144 && mi.tools === true && mi.reasoning === true && mi.vision === false, JSON.stringify({ c: mi.ctx, t: mi.tools, r: mi.reasoning }));
  ok('M6: описание причесано', mi.desc === 'Улучшенная модель', JSON.stringify(mi.desc));
  const fim = M.TEST.fromProviderList({ id: 'mistral-code-fim-latest', capabilities: { completion_chat: false } }, 'mistral', {});
  ok('M7: модель без completion_chat не чат', fim.chat === false);
  const dep = M.TEST.fromProviderList({ id: 'old/model', deprecation: '2026-01-01', deprecation_replacement_model: 'new/model' }, 'mistral', {});
  ok('M8: снятая модель помечена и указывает замену', dep.chat === false && dep.deprecated === true && dep.replaces === 'new/model');

  const gem = M.TEST.fromGemini({ name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'], thinking: { thinkingLevel: 'HIGH' }, description: 'модель' });
  ok('M9: у gemini id без префикса models/, потолки из inputTokenLimit', gem.id === 'gemini-3.5-flash' && gem.ctx === 1048576 && gem.maxOut === 65536, gem.id + ' ' + gem.ctx);
  ok('M10: reasoning gemini берётся из поля thinking', gem.reasoning === true);
  const tts = M.TEST.fromGemini({ name: 'models/gemini-3.8-flash-lite-tts', supportedGenerationMethods: ['streamGenerateContent'] });
  const emb = M.TEST.fromGemini({ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] });
  ok('M11: tts/embedding из gemini отсеяны', tts.chat === false && emb.chat === false, JSON.stringify({ t: tts.chat, e: emb.chat }));

  const od = M.TEST.fromProviderList({ id: 'kling-v2-1-master-i2v', owned_by: 'kling' }, 'odirouter', { priceUnknown: true });
  const od2 = M.TEST.fromProviderList({ id: 'gemini-2.5-flash-lite', owned_by: 'google' }, 'odirouter', { priceUnknown: true });
  ok('M12: генераторы видео у odirouter не лезут в список', od.chat === false && od2.chat === true);

  /* какие источники вообще трогаем — только те, у которых есть ключ */
  ok('M13: без ключа провайдера его список не дёргается',
    M.TEST.listSources({ GROQ_KEYS: 'k1' }).join() === 'groq' && M.TEST.listSources({}).length === 0,
    JSON.stringify(M.TEST.listSources({ GROQ_KEYS: 'k1', OPENROUTER_KEYS: 'o' })));
  const cfg = M.TEST.nativeCfg('gemini', { GEMINI_KEYS: 'abc,def' });
  ok('M14: заголовок gemini — x-goog-api-key, а не Bearer', !!cfg && cfg.headers['x-goog-api-key'] === 'abc' && !/abc/.test(cfg.url));
  ok('M15: чужой/безключевой провайдер конфига не даёт', M.TEST.nativeCfg('cloudflare', { CLOUDFLARE_KEYS: 'x' }) === null && M.TEST.nativeCfg('groq', {}) === null);

  /* сетевой путь: groq спросили, ключ подставили, строки помечены src=groq */
  M.forgetMemo(); M.resetThrottle();
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url: String(url), auth: (init && init.headers && (init.headers.authorization || init.headers['x-goog-api-key'])) || '' });
    if (/groq/.test(url)) return { ok: true, status: 200, json: async () => ({ data: [groq, whisper] }) };
    if (/mistral/.test(url)) return { ok: true, status: 200, json: async () => ({ data: [mis] }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const got = await M.fetchCatalog({ env: { GROQ_KEYS: 'k1', MISTRAL_KEYS: 'k2' }, fetchImpl: f, sleep: async () => {} });
  ok('M16: natивные списки доехали до каталога', got.models.length >= 2 && got.models.some((m) => m.src === 'mistral' && m.ctx === 262144), got.models.length + ' строк');
  ok('M17: ключ ушёл в заголовок, а не в url',
    seen.filter((s) => /groq|mistral/.test(s.url)).length === 2 &&
    seen.filter((s) => /groq|mistral/.test(s.url)).every((s) => s.auth.length > 0) &&
    !seen.some((s) => /k1|k2/.test(s.url)),
    JSON.stringify(seen.map((s) => s.url.slice(0, 28) + (s.auth ? ' +ключ' : ''))));
  ok('M18: прочитанные источники записаны в карту', !!got.read && got.read.groq === true && got.read.zai === undefined, JSON.stringify(Object.keys(got.read || {})));
  const cat = M.buildCatalog(got.models, { curated: [], read: got.read });
  ok('M19: карта читается и в собранном каталоге', cat.read.groq === true);
  /* soft-prune: у z.ai список неполный (бесплатные алиасы в него не входят) — резать нельзя */
  const z = M.prune({ updatedAt: Date.now(), stale: false, read: { zai: true }, models: [{ id: 'glm-5.3', src: 'zai', chat: true }], byId: { 'glm-5.3': { id: 'glm-5.3', chat: true } } }, 'zai', ['glm-5.3', 'glm-4.7-flash']);
  ok('M20: неполный список провайдера не снимает живые алиасы', z.join() === 'glm-5.3,glm-4.7-flash', z.join());
  const zbad = M.prune({ updatedAt: Date.now(), stale: false, read: { zai: true }, models: [{ id: 'glm-dead', src: 'zai', chat: false }], byId: { 'glm-dead': { id: 'glm-dead', chat: false } } }, 'zai', ['glm-dead', 'glm-5']);
  ok('M21: а то, про что провайдер сказал «не чат», убирается', zbad.join() === 'glm-5', zbad.join());
  const nobody = M.prune({ updatedAt: Date.now(), stale: false, read: { groq: true }, models: [], byId: {} }, 'groq', ['qwen/qwen3.8-27b']);
  ok('M22: пустой ответ провайдера — пул не режем', nobody.join() === 'qwen/qwen3.8-27b');
  let capped = 0;
  const manyRows = { data: Array.from({ length: 60 }, (_, i) => ({ id: 'cap/m' + i, owned_by: 'cap' })) };
  const fCap = async () => { capped++; return { ok: true, status: 200, json: async () => manyRows }; };
  const lim = await M.fetchCatalog({ env: { GROQ_KEYS: 'k', MODELS_PER_SOURCE: '30' }, fetchImpl: fCap, sources: ['groq'] });
  ok('M23: MODELS_PER_SOURCE ограничивает одного провайдера (30 из 60), а не весь список',
    lim.models.length === 30, lim.models.length);
  const nolim = await M.fetchCatalog({ env: { GROQ_KEYS: 'k' }, fetchImpl: fCap, sources: ['groq'] });
  ok('M24: без переменной потолок — 200 на источник, а меньше 20 не даём ставить совсем',
    nolim.models.length === 60, nolim.models.length);
  M.forgetMemo();
}


console.log('── N · один id у двух провайдеров: потолок берём у того, куда идём ───');
{
  const kv = fakeKv(Date.now());
  M.forgetMemo(); M.resetThrottle();
  const f = async (url) => {
    const u = String(url);
    /* OdiRouter выдаёт этот id без всяких лимитов, Google — со своими. */
    if (u.indexOf('odirouter') >= 0) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gemini-3.5-flash', owned_by: 'google' }] }) };
    if (u.indexOf('generativelanguage') >= 0) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] }] }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const cat = await M.refresh({ ODIROUTER_KEYS: 'o1', GEMINI_KEYS: 'g1' }, kv, {
    fetchImpl: f, now: Date.now(), curated: [], sources: ['odirouter', 'gemini'],
  });
  ok('N1: строка в списке одна, но дополнена фактами второго источника',
    cat.models.length === 1 && cat.models[0].ctx === 1048576 && (cat.models[0].also || []).indexOf('gemini') >= 0,
    JSON.stringify(cat.models.map((m) => ({ id: m.id, ctx: m.ctx, also: m.also }))));
  const viaGoogle = M.ceilings(cat, 'gemini-3.5-flash', 'gemini');
  const viaOdi = M.ceilings(cat, 'gemini-3.5-flash', 'odirouter');
  ok('N2: к Google едет его потолок, к агрегатору — только то, что он сам сказал',
    viaGoogle.ctx === 1048576 && viaGoogle.maxOut === 65535 && viaOdi.ctx === 32768 && viaOdi.maxOut === 4095,
    JSON.stringify({ viaGoogle, viaOdi }));
  const base = { kind: 'openai', base: 'https://api.odirouter.ai/v1', keys: ['k'], models: { fast: ['gemini-3.5-flash'] } };
  const reqOdi = buildRequest({ cfg: base, keyIdx: 0, model: 'gemini-3.5-flash', provider: 'odirouter', messages: [{ role: 'user', content: 'привет' }], system: 'с', tier: 'smart', maxTokens: 20000 });
  const reqGem = buildRequest({ cfg: Object.assign({}, base, { kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta' }), keyIdx: 0, model: 'gemini-3.5-flash', provider: 'gemini', messages: [{ role: 'user', content: 'привет' }], system: 'с', tier: 'smart', maxTokens: 20000 });
  ok('N3: тело запроса получает потолок СВОЕГО провайдера, а не среднее по больнице',
    reqOdi.body.max_tokens === 4095 && JSON.stringify(reqGem.body).indexOf('20000') >= 0,
    reqOdi.body.max_tokens + ' / ' + JSON.stringify(reqGem.body).slice(0, 120));
  ok('N4: без провайдера старое поведение сохранено (внешние вызовы не сломались)',
    M.ceilings(cat, 'gemini-3.5-flash').ctx === 1048576);
  ok('N5: витрина подписана тем, кто знает больше (Google, а не агрегатор)',
    cat.byId['gemini-3.5-flash'].src === 'gemini' && (cat.byId['gemini-3.5-flash'].also || []).indexOf('odirouter') >= 0,
    cat.byId['gemini-3.5-flash'].src + ' · ' + JSON.stringify(cat.byId['gemini-3.5-flash'].also));
  ok('N6: а запрос через агрегатор всё равно идёт по ЕГО лимиту',
    M.ceilings(cat, 'gemini-3.5-flash', 'odirouter').maxOut === 4095 && M.ceilings(cat, 'gemini-3.5-flash', 'gemini').maxOut === 65535,
    JSON.stringify(M.ceilings(cat, 'gemini-3.5-flash', 'odirouter')));
  M.forgetMemo();
}

console.log('\n' + (fail ? 'ПРОВАЛЫ: ' + fail : 'готово') + ` · пройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
