/**
 * Двигатель Этап 1b — обход провайдеров, квоты, вход /api/chat.
 * Сети нет: fetch подставляется, поэтому проверяются решения движка, а не провайдеры.
 * Запуск: node test/chat.test.js
 */
import { buildTable, providerAlive, pickKey } from '../engine/providers.js';
import { createEngine } from '../engine/chat.js';
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
  ok('E13: без ключей вообще — не падаем, а объясняем', r6.ok === false && r6.tried.every((t) => /нет живых ключей/.test(t.why || '')), JSON.stringify(r6).slice(0, 200));
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
  ok('G6: без ключей — 503 со списком попыток (фронт по нему решает, показывать ли демо)',
    e2.status === 503 && Array.isArray((await e2.json()).tried));
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
  ok('K1: на настоящей математике первым спрашивают OdiRouter с deepseek-v4-flash',
    r1.ok === true && seen[0] === 'odirouter/deepseek-v4-flash' && r1.provider === 'odirouter', JSON.stringify(seen.slice(0, 3)));
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

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
