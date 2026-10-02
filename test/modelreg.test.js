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
const many = M.buildCatalog(Array.from({ length: 600 }, (_, i) => ({ id: 'x/m' + i + ':free', name: 'm' + i, free: true, chat: true, ctx: 1000, maxOut: 100, vision: false, visionKnown: true, src: 'openrouter' })), {});
ok('B5 каталог ограничен сверху: держим 400, про 600 помним только числом', many.models.length === 400 && many.count === 400 && many.total === 600, many.count + '/' + many.total);
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
      const resR = await onRequestGet({ request: new Request('https://metiger.example/api/models?refresh=1'), env: env2 });
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

console.log('\n' + (fail ? 'ПРОВАЛЫ: ' + fail : 'готово') + ` · пройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
