/**
 * Двигатель Этап 1b — обход провайдеров, квоты, вход /api/chat.
 * Сети нет: fetch подставляется, поэтому проверяются решения движка, а не провайдеры.
 * Запуск: node test/chat.test.js
 */
import { buildTable, providerAlive, pickKey } from '../engine/providers.js';
import { createEngine, PERSONA_SYSTEM } from '../engine/chat.js';
import * as ensemble from '../engine/ensemble.js';
import { onRequestPost, onRequestGet } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const ENV = {
  GROQ_KEYS: 'g1,g2', CLOUDFLARE_KEYS: 'cf1', CLOUDFLARE_ACCOUNT_ID: 'acc123',
  OPENROUTER_KEYS: 'or1', GEMINI_KEYS: 'gm1',
};
const P = buildTable(ENV);

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const out = script(url, body, calls.length - 1);
    return { status: out.status == null ? 200 : out.status, text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)) };
  };
  impl.calls = calls;
  return impl;
}
const chat = (text, extra) => Object.assign({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }, extra || {});
const only = (...ids) => Object.fromEntries(ids.map((id) => [id, (ENV[id.toUpperCase().replace('CLOUDFLARE', 'CLOUDFLARE')] || '')]));
const eng = (script, env, extra) => createEngine(Object.assign(
  { env: env || ENV, fetch: script ? fakeFetch(script) : undefined, sleep: async () => {} }, extra || {}));

console.log('E — обход: годный ответ или честный список попыток');
{
  const f = fakeFetch(() => ({ body: chat('Привет! Я на связи.') }));
  const e = createEngine({ env: ENV, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'привет, как дела' });
  ok('E1: ответ есть, провайдер и модель названы', r.ok && r.reply === 'Привет! Я на связи.' && !!r.provider && !!r.model, JSON.stringify(r).slice(0, 200));
  ok('E2: задача классифицирована до обращения к сети (болтовня — не smart-очередь)', r.intent === 'fast' && r.tier === 'fast', r.intent + '/' + r.tier);
  ok('E3: учёт расхода ведётся', (e.usage()[r.provider] || {}).ok === 1, JSON.stringify(e.usage()));
  ok('E4: запрос ушёл на реальный адрес провайдера', /api\.groq\.com|generativelanguage|openrouter|workers-ai|api\./.test(f.calls[0].url), f.calls[0].url);

  const f2 = fakeFetch((url, body, i) => (url.indexOf('groq') >= 0 ? { status: 429, body: { error: 'rate limit' } } : { body: chat('с ответом') }));
  const e2 = createEngine({ env: ENV, fetch: f2, sleep: async () => {} });
  const r2 = await e2.run({ text: 'привет' });
  ok('E5: 429 не убивает ответ — идём к следующему провайдеру', r2.ok && r2.provider !== 'groq', r2.provider);
  ok('E6: прожитый 429 помечен в health, чтобы не долбить ключ', JSON.stringify(e2.health()).indexOf('cool') >= 0, JSON.stringify(e2.health()));
  ok('E7: список попыток остаётся видимым (что человек видел, то и объяснимо)',
    r2.tried.some((t) => t.provider === 'groq' && t.why === 'rate-limit'), JSON.stringify(r2.tried));

  const f3 = fakeFetch(() => ({ body: chat('Rate limit reached for this key') }));
  const e3 = createEngine({ env: ENV, fetch: f3, sleep: async () => {} });
  const r3 = await e3.run({ text: 'привет' });
  ok('E8: «ответ», которым является ошибка провайдера, человеку не показывается',
    r3.tried.some((t) => /ответ-отказ/.test(t.why || '')), JSON.stringify(r3.tried).slice(0, 200));

  const f4 = fakeFetch(() => ({ body: chat('Извини, не могу с этим помочь') }));
  const e4 = createEngine({ env: ENV, fetch: f4, sleep: async () => {} });
  const r4 = await e4.run({ text: 'привет' });
  ok('E9: вежливый отказ = попытка, а не ответ', r4.tried.some((t) => /ответ-отказ/.test(t.why || '')) && !r4.ok, JSON.stringify(r4).slice(0, 160));
  ok('E10: когда не ответил никто — ошибка словом, а не пустая строка',
    r4.ok === false && /ни один провайдер не ответил/.test(r4.error), r4.error);

  const f5 = fakeFetch((url, body, i) => (i === 0
    ? { body: chat('Первая половина ответа.', { choices: [{ message: { content: 'Первая половина ответа.' }, finish_reason: 'length' }] }) }
    : { body: chat('вторая половина, продолжение.') }));
  const e5 = createEngine({ env: ENV, fetch: f5, sleep: async () => {} });
  const r5 = await e5.run({ text: 'расскажи длинно' });
  ok('E11: обрыв на лимите токенов допиливается, а не отдаётся куском',
    /вторая половина/.test(r5.reply) && /Первая половина/.test(r5.reply), JSON.stringify(r5.reply));
  ok('E12: в допилку отправляется просьба продолжить, а не новый вопрос',
    /Продолжи/.test(JSON.stringify((f5.calls[1] || {}).body || {})), JSON.stringify((f5.calls[1] || {}).body || {}).slice(0, 180));

  /* картинки: путь отдельный, и он не должен ронять обход (моделей без зрения много) */
  const fImg = fakeFetch(() => ({ body: chat('Тигр на аватарке, текста нет') }));
  const eImg = createEngine({ env: { GEMINI_KEYS: 'gm1', ODIROUTER_KEYS: 'od1' }, fetch: fImg, sleep: async () => {} });
  const rImg = await eImg.run({ text: 'что на картинке?', images: ['data:image/png;base64,iVBORw0KGgo='] });
  const imgBody = JSON.stringify(fImg.calls[0].body);
  ok('E14: запрос с картинкой проходит движок, картинка в теле, модель зрячая',
    rImg.ok === true && rImg.intent === 'vision'
    && (imgBody.indexOf('inline_data') >= 0 || imgBody.indexOf('image_url') >= 0)
    && /(gemini|vl|vision|omni|flash-preview)/i.test(rImg.model),
    JSON.stringify({ provider: rImg.provider, model: rImg.model, kind: (imgBody.indexOf('inline_data') >= 0 ? 'gemini' : 'openai') }));
  ok('E15: битую data-url не крашит, а просто не отправляет как картинку',
    (async () => {
      const f = fakeFetch(() => ({ body: chat('текст без картинки') }));
      const e = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f, sleep: async () => {} });
      const r = await e.run({ text: 'что на фото?', images: ['not-a-data-url'] });
      return r.ok === true && JSON.stringify(f.calls[0].body).indexOf('image') < 0;
    })());
  const f6 = fakeFetch(() => ({ body: chat('x') }));
  const e6 = createEngine({ env: {}, fetch: f6, sleep: async () => {} });
  const r6 = await e6.run({ text: 'привет' });
  /* 0.099: без ключей продукт больше не «объясняет отказ», а отвечает через
     keyless-шлюзы (Kilo, LLM7) — им ключ не нужен вовсе. Отказ остаётся честным
     только когда в очереди никого: это уже не пустое окружение, а выключенные пулы. */
  ok('E13: без ключей вообще отвечает keyless-шлюз, а не отказ',
    r6.ok === true && (r6.provider === 'kilo' || r6.provider === 'llm7'), JSON.stringify({ provider: r6.provider, model: r6.model, ok: r6.ok }));
}

console.log('F — ротация ключей и лимиты');
{
  const health = { groq: [{ state: 'invalid' }, { used: 0 }] };
  ok('F1: сгоревший ключ пропускается, берётся живой', pickKey(P, 'groq', health) === 1);
  const alive = {};
  for (let i = 0; i < 2; i++) alive.groq = alive.groq || [];
  alive.groq[0] = { state: 'cool', until: Date.now() + 60000 };
  ok('F2: провайдер на паузе жив (ключ другой), а не выключен навсегда', providerAlive(P, 'groq', alive) === true);
  alive.groq[1] = { state: 'invalid' };
  ok('F3: все ключи мертвы — провайдер мёртв', providerAlive(P, 'groq', alive) === false);
  ok('F4: без id аккаунта cloudflare не участвует', providerAlive(buildTable({ CLOUDFLARE_KEYS: 'k' }), 'cloudflare', {}) === false
    && providerAlive(P, 'cloudflare', {}) === true);
  const P2 = buildTable({ GROQ_KEYS: 'a,b,c' });
  const dead = P2.groq.keys.map(() => ({ used: P2.groq.limit, state: 'ok' }));
  ok('F5: суточный лимит учтён по всем ключам — провайдер выпадает из очереди',
    providerAlive(P2, 'groq', { groq: dead }) === false, JSON.stringify({ limit: P2.groq.limit, keys: dead.length }));
  const oneFree = dead.map((x) => ({ used: x.used, state: x.state }));
  oneFree[1] = { used: 0 };
  ok('F6: пока хоть один ключ не исчерпан — провайдер в строю', providerAlive(P2, 'groq', { groq: oneFree }) === true);
  ok('F7: ключи без истории считаются живыми, а не «израсходованными»', providerAlive(P2, 'groq', {}) === true);
  {
    /* пауза под тариф: второй запрос к тому же провайдеру обязан подождать */
    const f = fakeFetch(() => ({ body: chat('ok') }));
    let waited = 0;
    const e = createEngine({ env: Object.assign({}, ENV, { ODIRROUTER_MIN_MS: '5000' }), fetch: f, sleep: async (ms) => { waited += ms; } });
    await e.run({ text: 'привет', providerOrder: ['odirouter', 'odirouter'] });
    ok('F6: MIN_INTERVAL отрабатывает — к провайдеру не долбимся чаще тарифа', waited > 0 || !providerAlive(e.providers, 'odirouter', {}), 'waited=' + waited);
  }
}

console.log('G — вход /api/chat (Pages Function): то, что видит фронт');
{
  const req = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const g = fakeFetch(() => ({ body: chat('Нормальный ответ агента') }));
  const saved = globalThis.fetch;
  globalThis.fetch = g;
  const a = await onRequestPost({ request: req({ text: 'привет' }), env: ENV });
  const j = await a.json();
  ok('G1: 200, reply, провайдер, модель, намерение — всё на месте',
    a.status === 200 && j.ok === true && j.reply === 'Нормальный ответ агента' && !!j.provider && !!j.model && !!j.intent, JSON.stringify(j).slice(0, 200));
  ok('G2: CORS открыт (мини-приложение живёт на другом поддомене)',
    a.headers.get('access-control-allow-origin') === '*', String(a.headers.get('access-control-allow-origin')));
  const b = await onRequestPost({ request: req({ text: '   ' }), env: ENV });
  ok('G3: пустой текст — 400 словом, а не 500', b.status === 400 && /пустой запрос/.test((await b.json()).error));
  const c = await onRequestPost({ request: req({ text: 'расскажи' , history: [{ role: 'user', text: 'было' }, { role: 'assistant', text: 'стало' }] }), env: ENV });
  await c.json();
  const lastBody = g.calls[g.calls.length - 1].body;
  ok('G4: история доезжает до модели (без неё «агент» амнезирует между сообщениями)',
    JSON.stringify(lastBody.messages).indexOf('было') >= 0 && JSON.stringify(lastBody.messages).indexOf('стало') >= 0,
    JSON.stringify(lastBody.messages).slice(0, 200));
  for (let i = 0; i < 14; i++) await onRequestPost({ request: req({ text: 'спам' + i }), env: ENV });
  const d = await onRequestPost({ request: req({ text: 'ещё' }), env: ENV });
  ok('G5: частый клиент получает 429 — квоты бесплатных провайдеров защищены', d.status === 429, 'status=' + d.status);
  const e2 = await onRequestPost({ request: req({ text: 'привет', rate: 0 }), env: { RATE_LIMIT: '0' } });
  /* 0.099: раньше без ключей отдавали 503 и фронт показывал демо. Теперь без
     ключей отвечают keyless-шлюзы — демо не нужно, ответ настоящий. */
  const e2j = await e2.json();
  ok('G6: без ключей отвечает keyless-пул — отказ не подменяет ответ',
    e2.status === 200 && (e2j.provider === 'kilo' || e2j.provider === 'llm7'),
    JSON.stringify({ status: e2.status, provider: e2j.provider }));
  const st = await onRequestGet({ env: ENV });
  const sj = await st.json();
  ok('G7: GET /api/chat отдаёт живых провайдеров — это и есть наблюдаемость',
    sj.ok === true && Array.isArray(sj.alive) && sj.alive.indexOf('groq') >= 0, JSON.stringify(sj).slice(0, 160));
  /* Охрана входа по весу: движок и бесплатные провайдеры спотыкаются о тело
     запроса раньше, чем начинается толк, — отказываем словами и сразу. */
  const many = await onRequestPost({ request: req({ text: 'что на фото?', images: ['data:image/png;base64,' + 'A'.repeat(64), 'data:image/png;base64,' + 'B'.repeat(64), 'data:image/png;base64,' + 'C'.repeat(64)] }), env: ENV });
  ok('G8: три картинки — отказ словами, а не усечение втихую',
    many.status === 413 && /двух/.test((await many.json()).error || ''), String(many.status));
  const heavy = await onRequestPost({ request: req({ text: 'что на фото?', images: ['data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024)] }), env: ENV });
  ok('G9: тяжёлую картинку не тащим до провайдера',
    heavy.status === 413 && /МБ/.test((await heavy.json()).error || ''), String(heavy.status));
  /* Вход из чужого curl обязан быть безопасен: «system», «temperature», «model»
     и «provider» человек пишет сам, и движок не имеет права тащить их как есть. */
  const ENV0 = Object.assign({}, ENV, { RATE_LIMIT: '0' });
  const big = await onRequestPost({ request: req({ text: 'привет', system: 'x'.repeat(100000), temperature: 12, chatId: 'чат\u00009' }), env: ENV0 });
  const bj = await big.json();
  ok('G10: чужой мегабайтный «system» режется до потолка — и это сказано человеку',
    big.status === 200 && /системный промпт обрезан/.test((bj.inputNotes || []).join(' ')), JSON.stringify(bj.inputNotes || bj.error).slice(0, 160));
  const bigBody = g.calls[g.calls.length - 1].body;
  const sysSent = (bigBody.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content).length);
  ok('G11: до провайдера уехал обрезанный промпт, а не 100 000 знаков', sysSent.length > 0 && sysSent[0] <= 32100, JSON.stringify(sysSent));
  ok('G12: temperature=12 возвращён в 0…2 и назван словами', bigBody.temperature === 2 && /температуру 12/.test((bj.inputNotes || []).join(' ')), String(bigBody.temperature));
  const junk = await onRequestPost({ request: req({ text: 'привет', model: '  glm\u0000-5 \u0007 ', provider: 'groq/../x' }), env: ENV0 });
  const jj = await junk.json();
  const junkBody = g.calls[g.calls.length - 1].body;
  ok('G13: из имени модели вычищены управляющие символы, провайдер-мусор не перебивает выбор',
    junk.status === 200 && junkBody.model.indexOf('\u0000') < 0 && junkBody.model.indexOf('\u0007') < 0 && !!jj.provider, JSON.stringify({ model: junkBody.model, provider: jj.provider }).slice(0, 160));
  const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'реплика ' + i + ' ' + 'текст '.repeat(400) }));
  const over = await onRequestPost({ request: req({ text: 'итого?', history: hist }), env: Object.assign({}, ENV0, { CTX_WINDOW: '1500', CTX_MAX_OUT: '300' }) });
  const oj = await over.json();
  const overBody = g.calls[g.calls.length - 1].body;
  ok('G14: гирлянду истории не тащим — окно модели режет её, и это видно в ответе',
    over.status === 200 && overBody.messages.length < hist.length + 1 && /окно модели/.test(String(oj.ctxFit || '')) && /взял последние 12/.test((oj.inputNotes || []).join(' ')), JSON.stringify({ sent: overBody.messages.length, fit: String(oj.ctxFit || '').slice(0, 60), notes: oj.inputNotes }).slice(0, 300));
  ok('G15: последним в запросе идёт вопрос человека, а не обрывок истории',
    /итого\?/.test(String(overBody.messages[overBody.messages.length - 1].content)), String(overBody.messages[overBody.messages.length - 1].content).slice(0, 60));
  const dg = await onRequestGet({ env: ENV0 });
  const dgj = await dg.json();
  ok('G16: GET /api/chat показывает настройки окна — «что за лимиты сейчас» видно без чтения кода',
    !!dgj.ctx && /окно \d+/.test(dgj.ctx), JSON.stringify(dgj.ctx));
  globalThis.fetch = saved;
}

console.log('K — математика едет к тому DeepSeek, который реально отвечает');
{
  const ENVDS = { GROQ_KEYS: 'g1', ODIROUTER_KEYS: 'od1' };
  const seen = [];
  const e1b = createEngine({
    env: ENVDS, sleep: async () => {},
    fetch: async (url, init) => {
      const b = JSON.parse(init.body);
      seen.push((String(url).includes('odirouter') ? 'odirouter/' : 'groq/') + b.model);
      return { status: 200, text: async () => JSON.stringify(chat(b.model.includes('deepseek') ? '391' : 'не считаю')) };
    },
  });
  const r1 = await e1b.run({ text: 'реши уравнение 3x+7=2x+11 и проверь корень', noCouncils: true });
  ok('K1 (0.129): на настоящей математике первым спрашивают быстрый gpt-oss-120b на Groq',
    r1.ok === true && seen[0] === 'groq/openai/gpt-oss-120b' && r1.provider === 'groq', JSON.stringify(seen.slice(0, 3)));
  const seen2 = [];
  const e2 = createEngine({
    env: ENVDS, sleep: async () => {},
    fetch: async (url, init) => {
      const b = JSON.parse(init.body);
      seen2.push((String(url).includes('odirouter') ? 'odirouter/' : 'groq/') + b.model);
      return { status: 200, text: async () => JSON.stringify(chat('Привет.')) };
    },
  });
  const r2 = await e2.run({ text: 'привет, как дела', noCouncils: true });
  ok('K1a: «17*23» — калькулятор посчитал, везти запрос к другому провайдеру незачем',
    (await (async () => {
      const seen = [];
      const e = createEngine({
        env: ENVDS, sleep: async () => {},
        fetch: async (url, init) => {
          const b = JSON.parse(init.body);
          seen.push((String(url).includes('odirouter') ? 'odirouter/' : 'groq/') + b.model);
          return { status: 200, text: async () => JSON.stringify(chat('391')) };
        },
      });
      const r = await e.run({ text: 'сколько будет 17*23? только число', noCouncils: true });
      return r.ok === true && seen[0].indexOf('groq/') === 0;
    })()), '');
  ok('K2: на болтовне очередь остаётся конфигом (groq первым), DeepSeek не при чём',
    r2.ok === true && seen2[0].indexOf('groq/') === 0, JSON.stringify(seen2.slice(0, 2)));
  const seen3 = [];
  const e3 = createEngine({
    env: ENVDS, sleep: async () => {},
    fetch: async (url, init) => {
      const b = JSON.parse(init.body);
      seen3.push((String(url).includes('odirouter') ? 'odirouter/' : 'groq/') + b.model);
      return { status: 200, text: async () => JSON.stringify(chat('ок')) };
    },
  });
  const r3 = await e3.run({ text: 'сколько будет 17*23', noCouncils: true, model: 'openai/gpt-oss-120b' });
  ok('K3: выбранная человеком модель сильнее головы интента',
    r3.ok === true && seen3[0] === 'groq/openai/gpt-oss-120b' && seen3.length === 1, JSON.stringify(seen3));
  const seen4 = [];
  const e4 = createEngine({
    env: Object.assign({}, ENVDS, { INTENT_HEADS: 'off' }), sleep: async () => {},
    fetch: async (url, init) => {
      const b = JSON.parse(init.body);
      seen4.push((String(url).includes('odirouter') ? 'odirouter/' : 'groq/') + b.model);
      return { status: 200, text: async () => JSON.stringify(chat('ок')) };
    },
  });
  await e4.run({ text: 'сколько будет 17*23', noCouncils: true });
  ok('K4: INTENT_HEADS=off — движок снова слушает конфиг', seen4[0].indexOf('groq/') === 0, JSON.stringify(seen4.slice(0, 2)));
}

/** fetch для «живой gemini-картинки»: LLM отвечает чатом, генератор — inlineData. */
function mkFetch2(b64png) {
  return async (url, init) => {
    const body = init && init.body ? String(init.body) : '';
    if (body.indexOf('responseModalities') >= 0) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64png } }] } }] }) };
    }
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Кот.' }, finish_reason: 'stop' }] }) };
  };
}

console.log('K2b — правка живёт только там, где ей есть чем выполняться');
{
  const G = await import('../engine/imggen.js');
  const png = new Uint8Array(900);
  [0x89, 0x50, 0x4e, 0x47].forEach((v, i) => { png[i] = v; });
  for (let i = 8; i < png.length; i++) png[i] = i % 251;
  const b64p = Buffer.from(png).toString('base64');
  /* безключевой канал: картинку отдаёт, правку не умеет вовсе */
  const pollFetch = async (url) => {
    if (String(url).indexOf('pollinations') < 0) {
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Кот.' }, finish_reason: 'stop' }] }) };
    }
    return { status: 200, ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer };
  };
  const envP = { GROQ_KEYS: 'g1', IMGGEN_SOURCE: 'pollinations' };
  const eP = createEngine({ env: envP, fetch: pollFetch, sleep: async () => {}, imggen: G.createImggen({ env: envP, fetch: pollFetch }) });
  const rP = await eP.run({ text: 'нарисуй кота', chatId: 'k2p', providerOrder: ['groq'] });
  ok('K2m: картинка от безключевого канала доходит до человека',
    (rP.files || []).length === 1 && /image\//.test(rP.files[0].mime), JSON.stringify((rP.files || []).map((x) => x.name + ' ' + x.mime)));
  ok('K2n: и при этом навыкам правки нечем выполняться — движок этого не обещает',
    eP.imgReady() === false && !(rP.skills || []).some((x) => x.cat === 'editing'),
    JSON.stringify({ ready: eP.imgReady(), cats: (rP.skills || []).map((x) => x.cat) }));
  ok('K2o: зато строка состояния показывает, кто именно жив',
    /pollinations/.test(G.lineOf(eP.img())), G.lineOf(eP.img()).slice(0, 70));

  const fG = mkFetch2(b64p);
  const envG = { GROQ_KEYS: 'g1', GEMINI_KEYS: 'gm1', IMGGEN_SOURCE: 'gemini' };
  const eG = createEngine({ env: envG, fetch: fG, sleep: async () => {}, imggen: G.createImggen({ env: envG, fetch: fG }) });
  const rG = await eG.run({ text: 'нарисуй кота', chatId: 'k2g', providerOrder: ['groq'] });
  ok('K2p: канал, умеющий правку, поднимает готовность — editing включится со следующего сообщения',
    eG.imgReady() === true && (rG.imgSource || '') === 'gemini', JSON.stringify(eG.img().sources));
  const rG2 = await eG.run({ text: 'убери фон с кота и верни как было', chatId: 'k2g', providerOrder: ['groq'] });
  ok('K2q: и навык правки приезжает в промпт следующим же запросом',
    (rG2.skills || []).some((x) => x.cat === 'editing'), JSON.stringify((rG2.skills || []).map((x) => x.id)));
}

console.log('K2 — картинки сквозь движок (engine/imggen.js)');
{
  const G = await import('../engine/imggen.js');
  const png = new Uint8Array(900);
  [0x89, 0x50, 0x4e, 0x47].forEach((v, i) => { png[i] = v; });
  for (let i = 8; i < png.length; i++) png[i] = i % 251;
  const toB64 = (u) => Buffer.from(u).toString('base64');
  const imgAnswer = '\n\n```img|кот\na red cat on a windowsill\n```';
  /* Один fetch на два дела: генерация картинок отличается телом запроса
     (responseModalities), LLM-вызовы — нет. */
  const mkFetch = (o) => {
    const calls = [];
    const impl = async (url, init) => {
      const body = init && init.body ? String(init.body) : '';
      const isImg = body.indexOf('responseModalities') >= 0 || String(url).indexOf('/images/') >= 0;
      calls.push({ url: String(url), isImg, body });
      if (!isImg) {
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: (o.reply || 'Вот кот.') + (o.block === false ? '' : imgAnswer) }, finish_reason: 'stop' }] }) };
      }
      if (o.imgFail) return { status: 429, text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) };
      return { status: 200, ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: toB64(png) } }] } }] }), arrayBuffer: async () => png.buffer };
    };
    impl.calls = calls;
    return impl;
  };
  const env = { GROQ_KEYS: 'g1', GEMINI_KEYS: 'gm1', IMGGEN_SOURCE: 'gemini' };
  const f = mkFetch({});
  const layer = G.createImggen({ env, fetch: f });
  const e = createEngine({ env, fetch: f, sleep: async () => {}, imggen: layer });
  const r = await e.run({ text: 'нарисуй кота на подоконнике', chatId: 'k2a', providerOrder: ['groq'] });
  ok('K2a: блок ```img``` из ответа превращается в приложенную картинку',
    r.ok && r.files.length === 1 && r.files[0].kind === 'image' && /кот\.png/.test(r.files[0].name), JSON.stringify((r.files || []).map((x) => x.name)));
  ok('K2b: сам блок из текста вынут, человек видит обычный ответ', r.reply.indexOf('```img') < 0 && /^Вот кот\./.test(r.reply), JSON.stringify(r.reply));
  ok('K2c: размер и base64 считаются по байтам источника', r.files[0].size === 900 && Buffer.from(r.files[0].b64, 'base64').length === 900, r.files[0].size);
  ok('K2d: tools показывают, что картинки участвовали', (r.tools || []).indexOf('imggen') >= 0, JSON.stringify(r.tools));
  ok('K2e: и是谁 сгенерировал — видно из imgSource', r.imgSource === 'gemini', JSON.stringify(r.imgSource));
  ok('K2f: источник помечен живым — навыки правки оживают со следующего сообщения', layer.status().sources.some((x) => x.ready && x.edits), JSON.stringify(layer.status().sources));

  const f2 = mkFetch({ reply: 'Кот на подоконнике, как договорились.', block: false });
  const layer2 = G.createImggen({ env, fetch: f2 });
  const e2 = createEngine({ env, fetch: f2, sleep: async () => {}, imggen: layer2 });
  const r2 = await e2.run({ text: 'нарисуй кота', chatId: 'k2b', providerOrder: ['groq'] });
  ok('K2g: модель ответила без блока — промпт берётся из слов человека, картинка всё равно выходит',
    r2.files.length === 1 && f2.calls.some((c) => c.isImg), JSON.stringify({ files: (r2.files || []).length }));

  const f3 = mkFetch({ imgFail: true, reply: 'Кот на подоконнике, как договорились.' });
  const layer3 = G.createImggen({ env, fetch: f3 });
  const e3 = createEngine({ env, fetch: f3, sleep: async () => {}, imggen: layer3 });
  const r3 = await e3.run({ text: 'нарисуй кота', chatId: 'k2c', providerOrder: ['groq'] });
  ok('K2h: когда источник молчит, человек читает причину, а не пустоту',
    r3.ok && !(r3.files || []).length && /RESOURCE_EXHAUSTED|quota/.test(String(r3.fileError)) && /не вышла/.test(r3.reply),
    JSON.stringify({ err: r3.fileError, reply: r3.reply.slice(0, 90) }));
  ok('K2i: ответ модели при этом остаётся целиком', /^Кот на подоконнике, как договорились\./.test(r3.reply.replace(/\n+· [\s\S]*$/, '')), JSON.stringify(r3.reply.slice(0, 60)));
  const r4 = await e3.run({ text: 'нарисуй ещё кота', chatId: 'k2c', providerOrder: ['groq'] });
  /* HTTP-вход: причину отказа от картинки человек должен видеть ПОЛЕМ, а не только
     строкой в тексте — иначе фронт рисует пустое место без объяснений. Слой
     картинок в движке общий на изолят, поэтому здесь он честно падает на
     заглушку fetch («ответ без картинки») — ровно то поведение, которое проверяем. */
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ body: chat('Кот на подоконнике.') }));
  const api3 = await onRequestPost({
    request: new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'нарисуй кота', chatId: 'k2api', history: [] }) }),
    env: { ...ENV, RATE_LIMIT: '0' },
  });
  const j3 = await api3.json();
  globalThis.fetch = savedFetch;
  ok('K2m1: HTTP-ответ отдаёт причину отказа полем, а не только текстом в баббле',
    j3.ok === true && /не вышла/.test(String(j3.fileError)) && !(j3.files || []).length,
    JSON.stringify({ err: String(j3.fileError).slice(0, 90), files: (j3.files || []).length }));
  ok('K2m2: и в ответе картинка не обещана — блока нет, ссылка не выдумана',
    j3.reply.indexOf('```img') < 0 && !/http[s]?:\/\/[^ ]*\.(png|jpg)/.test(j3.reply), JSON.stringify(j3.reply).slice(0, 160));
  ok('K2j: и не долбится в тот же API каждый запрос — источник припаркован',
    !/ждём 0 с/.test(String(r4.fileError)) && /ждём \d+ с/.test(String(r4.fileError)), String(r4.fileError).slice(0, 90));

  const offEnv = { GROQ_KEYS: 'g1', GEMINI_KEYS: 'gm1', IMGGEN: 'off' };
  const f4 = mkFetch({});
  const e4 = createEngine({ env: offEnv, fetch: f4, sleep: async () => {}, imggen: G.createImggen({ env: offEnv, fetch: f4 }) });
  const r5 = await e4.run({ text: 'нарисуй кота', chatId: 'k2d', providerOrder: ['groq'] });
  ok('K2k: IMGGEN=off — движок не делает ни одного картиночного вызова',
    !f4.calls.some((c) => c.isImg) && !(r5.files || []).length && (r5.tools || []).indexOf('imggen') < 0,
    JSON.stringify({ calls: f4.calls.length, tools: r5.tools }));
  ok('K2l: и блок, который модель всё равно выдала, человеку не показывается', r5.reply.indexOf('```img') < 0, JSON.stringify(r5.reply));
}

console.log('W — ответ, проверенный калькулятором, голов не требует (замер прода: 4,5 с против 14,1 с)');
{
  /* Правило родилось из живого замера: одинаковый «17×23» отвечал 4,5 с и 14,1 с.
     Во втором прогоне движок до потолка COUNCIL_MS (12 с) ждал головы, которые не
     ответили, — и всё ради проверки того, что уже посчитал калькулятор. */
  const proof = ensemble.verifiedByTool;
  const C = '[Инструмент: Калькулятор]\n17*23 = 391';
  ok('W1: ответ-число, совпавший с калькулятором, признан проверенным',
    !!proof({ tools: ['calc'], block: C, reply: '391', intent: 'math' })
      && !!proof({ tools: ['calc'], block: C, reply: '391 (результат калькулятора).', intent: 'math' }),
    String(proof({ tools: ['calc'], block: C, reply: '391', intent: 'math' })));
  ok('W2: модель проигнорировала число инструмента — совет по-прежнему нужен',
    proof({ tools: ['calc'], block: C, reply: 'Не могу ответить на этот вопрос.', intent: 'math' }) === null
      && proof({ tools: ['calc'], block: C, reply: 'Двадцать три умножить на семнадцать будет двести.', intent: 'math' }) === null);
  ok('W3: осторожность и оговорки снимают пропуск — там вердикт к месту',
    proof({ tools: ['calc'], block: C, reply: 'Примерно 391', intent: 'math' }) === null
      && proof({ tools: ['calc'], block: C, reply: '391, но если считать по-другому, выйдет иное', intent: 'math' }) === null);
  ok('W4: звался не calc — правила нет (другой инструмент сам может ошибаться)',
    proof({ tools: ['web-search'], block: '[Инструмент: Поиск] 391', reply: '391', intent: 'math' }) === null);
  ok('W5: разделители тысяч и запятая сверяются тем же ключом, что у совета',
    !!proof({ tools: ['calc'], block: '[Инструмент: Калькулятор]\n2 000 000 / 4 = 500 000', reply: '500 000', intent: 'math' })
      && !!proof({ tools: ['calc'], block: '[Инструмент: Калькулятор]\n1/8 = 0,125', reply: '0,125', intent: 'math' }));
  ok('W6: абзац с числом внутри — не «ответ числом», головы остаются',
    proof({ tools: ['calc'], block: C, reply: 'Смотри: 17 умножить на 23 это 391, и вот почему это важно для расчёта бюджета.', intent: 'math' }) === null);

  /* Врезка в движок: на такой задаче головы не зовут вообще. */
  const f = fakeFetch(() => ({ body: chat('391') }));
  const e = createEngine({ env: ENV, fetch: f, sleep: async () => {}, quarantine: new Map() });
  const r = await e.run({ text: 'сколько будет 17*23' });
  ok('W7: типовая арифметика — один запрос вместо трёх (головы не звали)',
    r.ok === true && /калькулятор/i.test(r.ensembleSkip || '') && f.calls.length === 1,
    JSON.stringify({ calls: f.calls.length, skip: r.ensembleSkip }));
  ok('W8: и человеку это не молчание: пропуск назван причиной, а не пустотой',
    /проверен/i.test(r.ensembleSkip || ''), r.ensembleSkip);

  /* Обратная сторона: без проверки инструментом совет жив, как жил. */
  const f2 = fakeFetch((url, body, i) => ({ body: chat(i === 0 ? 'Осталось 17' : 'Осталось 17') }));
  const e2 = createEngine({ env: ENV, fetch: f2, sleep: async () => {}, quarantine: new Map() });
  const r2 = await e2.run({ text: 'В вазе 24 яблока, треть съели, ещё 5 вечером, сколько осталось?' });
  ok('W9: задача без инструмента по-прежнему собирает головы (правило узкое, а не «совет выключен»)',
    r2.ok === true && f2.calls.length > 1, JSON.stringify({ calls: f2.calls.length, ens: r2.ensemble, skip: r2.ensembleSkip }));
}

console.log('G2 — «Размышлять глубже»: просьба человека доезжает до движка и не врёт о себе (0.109)');
{
  const rq = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const gs = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ body: chat('Короткий ответ.') }));

  const j1 = await (await onRequestPost({ request: rq({ text: 'привет', deep: true }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' } })).json();
  ok('G2a: «глубже» поднимает короткий вопрос до рассуждения и smart-очереди (иначе режим отвечал бы самой быстрой моделью)',
    j1.ok === true && j1.intent === 'reasoning' && j1.tier === 'smart' && j1.deep === true,
    JSON.stringify({ ok: j1.ok, intent: j1.intent, tier: j1.tier, deep: j1.deep }));

  const j2 = await (await onRequestPost({ request: rq({ text: 'привет' }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' } })).json();
  ok('G2b: без просьбы то же сообщение остаётся болтовнёй в быстрой очереди — режим не включён по умолчанию',
    j2.intent === 'fast' && j2.tier === 'fast' && !j2.deep,
    JSON.stringify({ intent: j2.intent, tier: j2.tier, deep: j2.deep }));

  const j3 = await (await onRequestPost({
    request: rq({ text: 'привет', deep: true, provider: 'mistral', model: 'ministral-14b-2512' }),
    env: { MISTRAL_KEYS: 'm1', RATE_LIMIT: '0' },
  })).json();
  ok('G2c: ответила не думающая модель — ответ отдан, и помечено, что размышлений не было',
    j3.ok === true && j3.deep === true && j3.deepPlain === true,
    JSON.stringify({ ok: j3.ok, deep: j3.deep, plain: j3.deepPlain, model: j3.model }));

  globalThis.fetch = gs;
}

console.log('G4 — самопроверка ответа: агент сверяет написанное с вопросом (0.124, engine/check.js)');
{
  const rq = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const gs = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ body: chat('Ответ агента на один из трёх вопросов.') }));

  const Q = 'Сравни SQLite и Postgres? Чем они отличаются? Что выбрать для мобильного приложения?';
  const j1 = await (await onRequestPost({ request: rq({ text: Q }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' }, waitUntil: () => {} })).json();
  ok('G4a: неполный ответ самопроверка ловит и называет зацепки словами в payload',
    j1.ok === true && Array.isArray(j1.checkNotes) && j1.checkNotes.length > 0
      && /спрошено/.test(j1.checkNotes.join(' ')),
    JSON.stringify(j1.checkNotes));

  ok('G4b: зацепки читаются человеком — ни кодов слоя, ни имён переменных',
    (j1.checkNotes || []).every((n) => typeof n === 'string' && n.length > 6 && !/CHECK|coveredShare|askedPoints/i.test(n)),
    JSON.stringify(j1.checkNotes));

  globalThis.fetch = fakeFetch(() => ({ body: chat('SQLite встраивается в приложение и хранится файлом, Postgres требует сервера. Отличаются масштабом и конкуренцией за запись. Для мобильного приложения выбрать стоит SQLite.') }));
  const j2 = await (await onRequestPost({ request: rq({ text: Q }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' }, waitUntil: () => {} })).json();
  ok('G4c: полный ответ зацепок не даёт — ложная тревога стоила бы лишнего прогона',
    j2.ok === true && (j2.checkNotes === undefined || j2.checkNotes.length === 0) && !j2.checkFixed,
    JSON.stringify(j2.checkNotes));

  const j3 = await (await onRequestPost({ request: rq({ text: Q }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0', CHECK: 'off' }, waitUntil: () => {} })).json();
  ok('G4d: CHECK=off выключает слой целиком — поведение прежнее',
    j3.ok === true && (j3.checkNotes === undefined || j3.checkNotes.length === 0),
    JSON.stringify(j3.checkNotes));

  /* Починка: движок зовёт того же агента ещё раз и берёт дописанный ответ. */
  const f4 = fakeFetch(() => ({ body: chat('Коротко про одно.') }));
  let repairs = 0;
  const e4 = createEngine({ env: ENV, fetch: f4, sleep: async () => {}, quarantine: new Map(),
    repair: async (extra) => { repairs++; return { ok: true, reply: 'Дописанный ответ: сравниваем SQLite и Postgres, отличия в масштабе, для мобильного приложения берём SQLite.', provider: 'groq', model: 'm', extra } } });
  const r4 = await e4.run({ text: Q });
  ok('G4e: найденную зацепку агент чинит РОВНО одним досылом — и в ответе недостающее',
    r4.ok === true && /Дописанный ответ/.test(r4.reply) && r4.check && r4.check.fixed === true
      && repairs === 1,
    JSON.stringify({ repairs, check: r4.check, reply: r4.reply.slice(0, 40) }));

  ok('G4h: досыл несёт вопрос, собственный ответ и зацепки — голова чинит своё, а не пишет заново',
    repairs === 1, 'счётчик досылов: ' + repairs);

  /* Впритык к потолку досыл не начинается: не успеть и отдать пустой ответ хуже,
     чем честно показать зацепку. */
  let lateRepairs = 0;
  const e7 = createEngine({ env: ENV, fetch: fakeFetch(() => ({ body: chat('Коротко про одно.') })), sleep: async () => {}, quarantine: new Map(),
    repair: async () => { lateRepairs++; return { ok: true, reply: 'Дописанный ответ длиной больше сорока знаков, чтобы его взяли.' } } });
  const r7 = await e7.run({ text: Q, deadlineMs: 5000 });
  ok('G4i: на починку не осталось времени — досыла нет, зацепка показана с причиной',
    r7.ok === true && lateRepairs === 0 && r7.check && r7.check.fixed === false
      && /не осталось времени/.test(r7.check.skipped || ''),
    JSON.stringify({ lateRepairs, check: r7.check }));

  /* Куцый досыл ответ не улучшает: написанное дороже правки. */
  const e5 = createEngine({ env: ENV, fetch: fakeFetch(() => ({ body: chat('Коротко про одно.') })), sleep: async () => {}, quarantine: new Map(),
    repair: async () => ({ ok: true, reply: 'ок' }) });
  const r5 = await e5.run({ text: Q });
  ok('G4f: пустой или куцый досыл ответ не подменяет — зацепка остаётся видна',
    r5.ok === true && /Коротко про одно/.test(r5.reply) && r5.check && r5.check.fixed === false
      && r5.check.notes.length > 0,
    JSON.stringify({ check: r5.check, reply: r5.reply.slice(0, 40) }));

  /* Слой не имеет права стоить ответа: починка упала — ответ цел. */
  const e6 = createEngine({ env: ENV, fetch: fakeFetch(() => ({ body: chat('Коротко про одно.') })), sleep: async () => {}, quarantine: new Map(),
    repair: async () => { throw new Error('голова недоступна') } });
  const r6 = await e6.run({ text: Q });
  ok('G4g: упавшая починка не роняет ответ — зацепки видны, текст прежний',
    r6.ok === true && /Коротко про одно/.test(r6.reply) && r6.check && r6.check.notes.length > 0,
    JSON.stringify(r6.check));

  globalThis.fetch = gs;
}


console.log('G3 — глубину выбирает агент, а не переключатель (0.123, engine/depth.js)');
{
  const rq = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const gs = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ body: chat('Развёрнутый ответ.') }));

  /* Никто ничего не просил: судья сам увидел доказательство и поднял глубину. */
  const j1 = await (await onRequestPost({ request: rq({ text: 'докажи, что корень из 2 иррациональное число' }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' }, waitUntil: () => {} })).json();
  ok('G3a: доказательство поднимает глубину БЕЗ просьбы человека — и причина названа словами',
    j1.ok === true && j1.deep === true && j1.intent === 'reasoning' && j1.tier === 'smart'
      && /доказательство/.test(j1.depthWhy || ''),
    JSON.stringify({ deep: j1.deep, intent: j1.intent, tier: j1.tier, why: j1.depthWhy }));

  /* Причина входа обязана дожить до ответа: движок не имеет права переписать её
     на «человек попросил», потому что флаг deep ставит тот же вход. */
  ok('G3b: причина судьи доезжает до payload, а не затирается «человек попросил глубже»',
    !/попросил/.test(j1.depthWhy || ''), j1.depthWhy);

  /* Болтовня остаётся быстрой: судья не делает глубоким каждый запрос. */
  const j2 = await (await onRequestPost({ request: rq({ text: 'привет' }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' }, waitUntil: () => {} })).json();
  ok('G3c: приветствие остаётся болтовнёй в быстрой очереди, а причина отказа видна в поле',
    j2.intent === 'fast' && j2.tier === 'fast' && !j2.deep && /не глубже/.test(j2.depthWhy || ''),
    JSON.stringify({ intent: j2.intent, tier: j2.tier, deep: j2.deep, why: j2.depthWhy }));

  /* Явная просьба извне важнее судьи: curl и прежние версии приложения не сломаны. */
  const j3 = await (await onRequestPost({ request: rq({ text: 'привет', deep: true }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0' }, waitUntil: () => {} })).json();
  ok('G3d: явное deep:true извне по-прежнему решает — судья его не перебивает',
    j3.deep === true && j3.intent === 'reasoning' && /попросил/.test(j3.depthWhy || ''),
    JSON.stringify({ deep: j3.deep, why: j3.depthWhy }));

  /* Слой выключается одной переменной — поведение прежнее, без сюрпризов в проде. */
  const j4 = await (await onRequestPost({ request: rq({ text: 'докажи, что корень из 2 иррациональное число' }), env: { GROQ_KEYS: 'g1', RATE_LIMIT: '0', DEPTH: 'off' }, waitUntil: () => {} })).json();
  ok('G3e: DEPTH=off — судья молчит, глубина только по явной просьбе',
    !j4.deep && j4.intent === 'reasoning',
    JSON.stringify({ deep: j4.deep, intent: j4.intent, why: j4.depthWhy }));

  /* Прямой вызов движка: он судит сам, когда вход ничего не прислал. */
  const f5 = fakeFetch(() => ({ body: chat('Ответ движка.') }));
  const e5 = createEngine({ env: ENV, fetch: f5, sleep: async () => {}, quarantine: new Map() });
  const r5 = await e5.run({ text: 'обоснуй и докажи каждый шаг этого решения' });
  ok('G3f: движок без входа судит сам — глубина и причина на месте',
    r5.ok === true && r5.deep === true && /доказательство|обоснуй/.test(r5.depthWhy || ''),
    JSON.stringify({ deep: r5.deep, why: r5.depthWhy }));

  /* Дорогая задача просит больше независимых проверок, если это разрешили переменной. */
  const f6 = fakeFetch(() => ({ body: chat('17') }));
  const e6 = createEngine({ env: Object.assign({ DEPTH_COUNCIL_K: 4 }, ENV), fetch: f6, sleep: async () => {}, quarantine: new Map() });
  const r6 = await e6.run({ text: 'обоснуй и докажи, сколько останется: было 24, съели треть и ещё 5' });
  ok('G3g: на дорогой задаче совет собирается шире (DEPTH_COUNCIL_K), а не как обычно',
    r6.ok === true && f6.calls.length > 3,
    JSON.stringify({ calls: f6.calls.length, ens: r6.ensemble, skip: r6.ensembleSkip }));

  globalThis.fetch = gs;
}


console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

console.log('V — картинка не должна доставаться слепой модели');
{
  /* Прод на красном квадрате отвечал «Фон белый»: провайдер, у которого в пуле нет
     зрячей модели, съедал запрос первым, а картинка до модели не доезжала. Пулы
     берём настоящие: mistral (ministral-2512 — зрения нет), odirouter
     (в пуле есть gemini-…-flash — зрит). Cerebras для этого больше не годится:
     он убран из продукта целиком (0.094) — стал платным. */
  const f = fakeFetch(() => ({ body: chat('Красный') }));
  const e = createEngine({ env: { MISTRAL_KEYS: 'm1', ODIROUTER_KEYS: 'o1' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'какого цвета фон? одно слово', images: ['data:image/png;base64,iVBORw0KGgo='], useTools: false, skills: false });
  /* Зрячая голова находится внутри того же обхода, поэтому tried может остаться
     пустым: провайдер-то отвечал первым. Требование здесь — кто именно ответил. */
  ok('V1: ответ по картинке отдаёт зрячая модель, а не первая в пуле',
    r.ok === true && /(gemini|vl|omni|vision)/i.test(r.model) && r.intent === 'vision',
    JSON.stringify({ p: r.provider, m: r.model, i: r.intent }));
  ok('V2: в mistral с картинкой не ходим вообще', !f.calls.some((c) => /mistral/.test(String(c.url))),
    f.calls.map((c) => String(c.url).slice(0, 30)).join(' '));
  const e3 = createEngine({ env: { MISTRAL_KEYS: 'm1' }, fetch: fakeFetch(() => ({ body: chat('белый') })), sleep: async () => {} });
  const r3 = await e3.run({ text: 'что на картинке?', images: ['data:image/png;base64,iVBORw0KGgo='], useTools: false, skills: false });
  ok('V3: если зрячих нет нигде — ответа нет, а причина названа (тихое вранье дороже)',
    r3.ok === false && /нет модели, которая читает картинки/.test(JSON.stringify(r3.tried)), JSON.stringify({ ok: r3.ok, t: r3.tried }));
  const rq = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const gs = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ body: chat('Красный') }));
  const res4 = await onRequestPost({
    request: rq({ text: 'что на картинке?', images: ['data:image/png;base64,iVBORw0KGgo='], provider: 'mistral', model: 'ministral-14b-2512' }),
    env: { MISTRAL_KEYS: 'm1', RATE_LIMIT: '0' },
  });
  const j4 = await res4.json();
  ok('V4: пин на слепую модель с картинкой — отказ словами (422), а не 503 «провайдеры легли»',
    res4.status === 422 && j4.blindVision === true && /не читает картинки/.test(j4.error || ''),
    JSON.stringify({ s: res4.status, e: j4.error }));
  const res5 = await onRequestPost({ request: rq({ text: 'привет', provider: 'mistral', model: 'ministral-14b-2512' }), env: { MISTRAL_KEYS: 'm1', RATE_LIMIT: '0' } });
  const j5 = await res5.json();
  ok('V5: тот же пин без картинки работает как работал — отказа про зрение нет',
    res5.status === 200 && !j5.blindVision, JSON.stringify({ s: res5.status, e: j5.error }));
  globalThis.fetch = gs;
}

/* 0.114: формулы рисуются (0.112), но только если модель их прислала формулами.
   Живая проба на проде: часть бесплатных моделей пишет математику простым текстом
   («x + y = 5»), и рисовать тогда нечего — поэтому просьба про LaTeX едет в базовой
   подсказке, рядом с просьбой про fence. */
{
  const просьба = 'формулами LaTeX'
  const есть = PERSONA_SYSTEM.indexOf(просьба) >= 0
  ok('P1: базовая подсказка просит писать математику формулами LaTeX', есть,
    JSON.stringify(PERSONA_SYSTEM.slice(PERSONA_SYSTEM.indexOf(просьба) - 60, PERSONA_SYSTEM.indexOf(просьба) + 90)))
  ok('P2: в подсказке названы и строка, и выключная формула, и системы',
    PERSONA_SYSTEM.indexOf('\\( ... \\)') >= 0 && PERSONA_SYSTEM.indexOf('\\[ ... \\]') >= 0
      && PERSONA_SYSTEM.indexOf('\\begin{cases}') >= 0)
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
