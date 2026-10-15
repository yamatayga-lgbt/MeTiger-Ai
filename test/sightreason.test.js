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
  ok('V2: отказали все — честная ошибка «ни один провайдер не ответил», выдуманного ответа нет',
    !r2.ok && /ни один провайдер не ответил/.test(String(r2.error || '')) && !r2.reply,
    JSON.stringify({ ok: r2.ok, err: String(r2.error).slice(0, 120) }));
}

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
console.log('✔ 0.185: зрячий маршрут сложных задач и честный откат — проверки пройдены');
