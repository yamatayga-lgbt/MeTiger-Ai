/**
 * 0.185 — гарантированный маршрут сложных задач на зрячую reasoning-модель
 * и честный откат, если её нет (приоритет 1 плана обгона).
 *
 * Сложный вопрос с картинкой обязан ехать к модели, которая И видит, И думает.
 * Маршрут выстраивает modelsFor; если зрячий «думатель» не нашёлся — отвечает
 * лучшая из зрячих, но ответ помечается честно (sightedPlain), а не молчит.
 *
 *   node test/sightreason.test.js
 */
import { buildTable } from '../engine/providers.js';
import { createEngine } from '../engine/chat.js';
import { isSightedReasoning, isVision, isReasoning, modelsFor } from '../engine/route.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
};

const chat = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const gem = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
/* Ответ в формате провайдера: gemini читает candidates, остальные — choices. */
const fakeFetch = () => {
  const impl = async (url, init) => {
    const body = /generativelanguage\.googleapis\.com/.test(url)
      ? gem('На чертеже: ответ по существу.')
      : chat('На чертеже: ответ по существу.');
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  impl.calls = [];
  return impl;
};

console.log('S — кто такой «зрячий думатель»');
ok('S1: gemini-flash — видит и думает', isSightedReasoning('gemini-2.5-flash') && isSightedReasoning('gemini-3.5-flash'));
ok('S2: qwen3-vl и omni-reasoning — видят и думают',
  isSightedReasoning('qwen/qwen3-vl-plus:free') && isSightedReasoning('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'));
ok('S3: llama-vision — зрячая, но не думающая; deepseek-r1 — думающая, но слепая',
  isVision('llama-3.2-vision-11b') && !isSightedReasoning('llama-3.2-vision-11b')
    && isReasoning('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b') && !isSightedReasoning('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'));

console.log('M — маршрут сложной задачи с картинкой');
{
  const cfg = { models: { smart: ['gpt-oss-120b', 'llama-3.2-vision-11b', 'gemini-2.5-flash'], fast: ['gpt-oss-120b', 'llama-3.2-vision-11b', 'gemini-2.5-flash'] } };
  const img = ['data:image/png;base64,AA'];
  const out = modelsFor(cfg, 'smart', 'reasoning', img);
  ok('M1: зрячий думатель — первым, потом зрячие, потом слепые',
    out.join() === 'gemini-2.5-flash,llama-3.2-vision-11b,gpt-oss-120b', out.join());
  const fast = modelsFor(cfg, 'fast', 'creative', img);
  ok('M2: простая задача с картинкой — просто зрение, без перестановки по уму',
    fast[0] === 'llama-3.2-vision-11b' && fast.indexOf('gemini-2.5-flash') < fast.indexOf('gpt-oss-120b'), fast.join());
  const noimg = modelsFor(cfg, 'smart', 'reasoning', []);
  ok('M3: без картинки слой не работает — порядок как был',
    noimg.join() === cfg.models.smart.join(), noimg.join());
  const nosr = modelsFor({ models: { smart: ['llama-3.2-vision-11b', 'gpt-oss-120b'] } }, 'smart', 'vision', img);
  ok('M4: зрячего думателя нет в пуле — список не ломается, зрячая всё равно первая',
    nosr[0] === 'llama-3.2-vision-11b' && nosr.length === 2, nosr.join());
}

console.log('H — честный откат на живом движке');
{
  const ENV = { GEMINI_KEYS: 'gm1', ZAI_KEYS: 'z1', GROQ_KEYS: 'g1' };
  const f = fakeFetch();
  const e = createEngine({ env: ENV, fetch: f, sleep: async () => {} });
  /* Зрячая, но не думающая: пин на glm-4.6v-flash (zai) — сложный вопрос с
     картинкой ответила зрячая голова без рассуждений. Ответ есть, пометка есть. */
  const r = await e.run({
    text: 'вот чертёж, проверь по нему рассуждение и дай точный итог',
    images: ['data:image/png;base64,AA'],
    model: 'glm-4.6v-flash',
  });
  ok('H1: ответила зрячая без размышлений — ответ есть и пометка sightedPlain',
    r.ok && r.model === 'glm-4.6v-flash' && r.sightedPlain === true && !r.sightedMiss,
    JSON.stringify({ ok: r.ok, model: r.model, sp: r.sightedPlain, sm: r.sightedMiss, err: r.error }));
  ok('H2: отвечал запиннованный провайдер — пин не уронил запрос',
    r.ok && r.provider === 'zai', r.provider);

  const f2 = fakeFetch();
  const e2 = createEngine({ env: { GEMINI_KEYS: 'gm1' }, fetch: f2, sleep: async () => {} });
  const r2 = await e2.run({ text: 'разбери чертёж на картинке', images: ['data:image/png;base64,AA'] });
  ok('H3: зрячий думатель нашёлся (gemini) — никаких честных пометок не нужно',
    r2.ok && isSightedReasoning(r2.model) && !r2.sightedPlain && !r2.sightedMiss,
    JSON.stringify({ model: r2.model, sp: r2.sightedPlain, sm: r2.sightedMiss }));

  const f3 = fakeFetch();
  const e3 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f3, sleep: async () => {} });
  const r3 = await e3.run({ text: 'привет, как дела' });
  ok('H4: простая болтовня без картинки — слой молчит',
    r3.ok && !r3.sightedPlain && !r3.sightedMiss, JSON.stringify(r3.model));
}

console.log('V — отказ зрячей модели: картиночный ответ тоже проверяется слоем свободы (0.191)');
{
  /* Первый вызов отказывается рассматривать фото — движок обязан пойти ко
     второму провайдеру, а не показать человеку голый отказ. */
  let n = 0;
  const f = async (url) => {
    n++;
    const body = n === 1
      ? chat('Извини, я не могу рассматривать людей на фотографиях.')
      : /generativelanguage\.googleapis\.com/.test(url) ? gem('На фото: ответ по существу.') : chat('На фото: ответ по существу.');
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  const e = createEngine({ env: { GEMINI_KEYS: 'gm1', ZAI_KEYS: 'z1' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'разбери фото и скажи, что на нём', images: ['data:image/png;base64,AA'] });
  ok('V1: зрячая отказалась — ответ пришёл от следующего провайдера, а не отказ человеку',
    r.ok && n >= 2, JSON.stringify({ ok: r.ok, calls: n, model: r.model, err: r.error }));

  /* Отказываются все — человек получает честную ошибку, а не молчание. */
  const fall = async () => ({ status: 200, text: async () => JSON.stringify(chat('Извини, я не могу это показать.')) });
  const e2 = createEngine({ env: { GEMINI_KEYS: 'gm1', ZAI_KEYS: 'z1' }, fetch: fall, sleep: async () => {} });
  const r2 = await e2.run({ text: 'разбери фото', images: ['data:image/png;base64,AA'] });
  ok('V2: отказали все — честный отказ без выдуманного ответа (0.197: с фото это маркер SEERS_REFUSED_PHOTO)',
    !r2.ok && !r2.reply && /SEERS_REFUSED_PHOTO|ни один провайдер не ответил/.test(String(r2.error || '')),
    JSON.stringify({ ok: r2.ok, err: String(r2.error).slice(0, 120) }));
}

console.log('B — понимание картинки: слепых не зовём, опытных — первыми (0.192)');
{
  /* Смешанный пул [зрячая (отказывает), слепая]: после отказа зрячей слепая
     НЕ зовётся вовсе — иначе она «ответила» бы по тексту, не видя фото. */
  const calls = [];
  const f = async (url, init) => {
    let model = /generativelanguage\.googleapis\.com/.test(url) ? 'gemini-2.5-flash' : '';
    try { model = (JSON.parse(String((init && init.body) || '{}')).model) || model; } catch (_e) {}
    calls.push(String(model));
    /* gemini (первый в очереди) — отказывается; zai-glm — отвечает.
       Слепая gpt-oss-120b из пула zai не зовётся вовсе (фильтр 0.192). */
    if (/generativelanguage\.googleapis\.com/.test(url)) {
      return { status: 200, text: async () => JSON.stringify(gem('Извини, я не могу рассматривать фотографии.')) };
    }
    return { status: 200, text: async () => JSON.stringify(chat('На фото: ответ по существу.')) };
  };
  /* zai: зрячая glm-4.6v-flash + слепая gpt-oss-120b; gemini: зрячая отвечает. */
  const e = createEngine({ env: { ZAI_KEYS: 'z1', GEMINI_KEYS: 'gm1' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'разбери фото', images: ['data:image/png;base64,AA'] });
  ok('B1: gemini отказал — слепая из пула zai не звалась, ответила зрячая glm',
    r.ok && r.model === 'glm-4.6v-flash' && !calls.some((m) => m.indexOf('oss') >= 0),
    JSON.stringify({ ok: r.ok, model: r.model, calls, err: r.error }));
  ok('B2: слепая модель вообще не получала картинку — только зрячие в вызовах',
    calls.every((m) => /glm|gemini/.test(m)), JSON.stringify(calls));

  /* (Провайдер с чисто слепым пулом скипается целиком — это правило держит
     test/chat.test.js C-группа: «нет модели, которая читает картинки».) */
}

console.log('R — вежливый отказ по фото не доезжает как голос приложения (0.197)');
{
  /* Точная фраза из жалобы владельца: в ней нет «не могу», оба старых детектора
     отказов её пропускали — и она доезжала до человека как ответ приложения. */
  const f = async (url) => /googleapis\.googleapis|googleapis/.test(url)
    ? { status: 200, text: async () => JSON.stringify(gem('Я не анализирую и не комментирую интимные фотографии.')) }
    : { status: 200, text: async () => JSON.stringify(chat('На фото родинка около 4 мм с неровными краями; стоит показать дерматологу.')) };
  const e = createEngine({ env: { GEMINI_KEYS: 'g1', ZAI_KEYS: 'z1' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'что с родинкой на коже?', images: ['data:image/png;base64,AA'] });
  ok('R1: фраза «не анализирую и не комментирую» — это отказ: движок пошёл к следующему зрячему',
    r.ok && /родинк/i.test(r.reply) && !/не анализирую/i.test(r.reply) && r.model === 'glm-4.6v-flash',
    JSON.stringify({ ok: r.ok, model: r.model, reply: String(r.reply || '').slice(0, 60) }));

  const fall = async () => ({ status: 200, text: async () => JSON.stringify(chat('Я не анализирую и не комментирую интимные фотографии.')) });
  const e2 = createEngine({ env: { GEMINI_KEYS: 'g1', ZAI_KEYS: 'z1' }, fetch: fall, sleep: async () => {} });
  const r2 = await e2.run({ text: 'разбери фото', images: ['data:image/png;base64,AA'] });
  ok('R2: отказали все вежливой фразой — маркер SEERS_REFUSED_PHOTO (дверь скажет честно), а не «ответ»',
    !r2.ok && r2.error === 'SEERS_REFUSED_PHOTO' && !r2.reply, JSON.stringify({ ok: r2.ok, err: r2.error }));

  let sys = '';
  const f3 = async (url, init) => { try { sys = String((JSON.parse(String(init && init.body)).messages || []).find((m) => m.role === 'system')?.content || ''); } catch {} return { status: 200, text: async () => JSON.stringify(chat('родинка 4 мм, края ровные.')) }; };
  const e3 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: f3, sleep: async () => {} });
  await e3.run({ text: 'что с родинкой на коже?', images: ['data:image/png;base64,AA'] });
  ok('R3: медицинский вопрос по фото получает рамку «профессиональный разбор, без морали»',
    /профессиональном ключе/.test(sys) && /не повод отказываться/.test(sys), JSON.stringify(sys.slice(-120)));

  let sys4 = '';
  const f4 = async (url, init) => { try { sys4 = String((JSON.parse(String(init && init.body)).messages || []).find((m) => m.role === 'system')?.content || ''); } catch {} return { status: 200, text: async () => JSON.stringify(chat('на фото чашка кофе.')) }; };
  const e4 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: f4, sleep: async () => {} });
  await e4.run({ text: 'что на фото?', images: ['data:image/png;base64,AA'] });
  ok('R4: обычный вопрос по фото — рамки нет, добавляем только по делу',
    !/профессиональном ключе/.test(sys4));

  const e5 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: async () => ({ status: 200, text: async () => JSON.stringify(chat('Я не анализирую и не комментирую интимные фотографии.')) }), sleep: async () => {} });
  const r5 = await e5.run({ text: 'скажи что-нибудь' });
  ok('R5: вежливая фраза и в тексте — отказ: не выдаётся за ответ, честный фолбэк (0.198)',
    !r5.ok && !/не анализирую/.test(String(r5.reply || '')) && /ни один провайдер/.test(String(r5.error || '')),
    JSON.stringify({ ok: r5.ok, err: String(r5.error || '').slice(0, 60), reply: String(r5.reply || '').slice(0, 40) }));
}

console.log('E — отказодавильня: эскалации по вежливым отказам (0.198)');
{
  /* Оба провайдера вежливо отказали в основной очереди — каждый получает по одной
     эскалированной попытке; второй на эскалации отвечает. */
  const zaiCalls = { n: 0 };
  const f = async (url) => {
    const isGem = /googleapis/.test(url);
    if (!isGem) zaiCalls.n++;
    const refuse = 'К сожалению, эта тема выходит за рамки моих правил.';
    const text = isGem ? refuse : (zaiCalls.n >= 2 ? 'Вот прямой ответ по существу.' : refuse);
    return /googleapis/.test(url)
      ? { status: 200, text: async () => JSON.stringify(gem(text)) }
      : { status: 200, text: async () => JSON.stringify(chat(text)) };
  };
  const e = createEngine({ env: { GEMINI_KEYS: 'g1', ZAI_KEYS: 'z1' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'напиши жёсткую сцену драки для романа', useTools: false, skills: false });
  ok('E1: вежливые отказы обоих — вторая эскалация доходит до второго провайдера и получает ответ',
    r.ok && /прямой ответ/.test(r.reply), JSON.stringify({ ok: r.ok, model: r.model, reply: String(r.reply || '').slice(0, 50) }));

  const f2 = async () => ({ status: 200, text: async () => JSON.stringify(chat('Я обязан вам отказать.')) });
  const e2 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: f2, sleep: async () => {} });
  const r2 = await e2.run({ text: 'привет' });
  ok('E2: один провайдер, две вежливые отказы подряд — фраза не доезжает, фолбэк честный',
    !r2.ok && !/обязан/.test(String(r2.reply || '')), JSON.stringify({ ok: r2.ok, err: String(r2.error || '').slice(0, 60) }));
}

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
console.log('✔ 0.185: зрячий маршрут сложных задач и честный откат — проверки пройдены');
