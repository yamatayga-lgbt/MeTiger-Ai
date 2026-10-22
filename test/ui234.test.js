/**
 * Проверки 0.234 — живая ревизия пула моделей и ускорение первой строки (TTFT).
 *
 * 1) Пул TABLE и порядок ORDER очищены по живому прогону прода:
 *    быстрые живые провайдеры (Gemini, Mistral, OpenRouter) стоят сразу за Groq/Inception
 *    раньше капризных cloudflare/sharellm, а зависавшие/удалённые модели убраны с фронта.
 * 2) streamCall со сторожком первого слова (firstByteMs) обрывает молчащий апстрим
 *    до полного потолка таймаута, но не трогает живой начавшийся поток.
 * 3) 401 на отдельной модели безключевого дома (llm7 / kilo) охлаждает саму модель,
 *    а не сажает в карантин весь безключевой провайдер.
 * 4) 404 / «unavailable for free» уводит мёртвую модель в карантин по ключам, чтобы
 *    следующий вопрос не тратил секунды на повторную 404.
 * 5) На коротком разговорном fast-вопросе дефолтный reasoningEffort='medium' снижается
 *    до 'low', ускоряя первую русскую строку, но на коде/глубоком режиме сохраняется.
 */

import { TABLE, ORDER, FIRST_BYTE_TIMEOUT } from '../engine/providers.js';
import { streamCall } from '../engine/shape.js';
import { createEngine, MODEL_COOL } from '../engine/chat.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('\n── Пул моделей и очередь провайдеров (0.234) ──');
{
  ok('T234a-1: FIRST_BYTE_TIMEOUT задан быстрее полного потолка для fast и smart',
    FIRST_BYTE_TIMEOUT.fast > 0 && FIRST_BYTE_TIMEOUT.fast < 25000
    && FIRST_BYTE_TIMEOUT.smart > FIRST_BYTE_TIMEOUT.fast && FIRST_BYTE_TIMEOUT.smart < 60000);
  ok('T234a-2: Gemini smart больше не держит зависающую gemma-4-31b-it и включает gemini-2.5-flash',
    !TABLE.gemini.models.smart.includes('gemma-4-31b-it')
    && TABLE.gemini.models.smart.includes('gemini-2.5-flash'));
  ok('T234a-3: OpenRouter очищен от удалённых nex-agi/qwen3.8-27b и держит живые flint + openrouter/free',
    !TABLE.openrouter.models.fast.includes('nex-agi/nex-n2.5-mini:free')
    && !TABLE.openrouter.models.fast.includes('qwen/qwen3.8-27b:free')
    && TABLE.openrouter.models.fast[0] === 'recursive/flint-v1.0:free'
    && TABLE.openrouter.models.smart.includes('nvidia/nemotron-3-ultra-550b-a55b:free'));
  ok('T234a-4: Kilo fast начинается с безключевого kilo-auto/free, LLM7 smart — с codestral-latest',
    TABLE.kilo.models.fast[0] === 'kilo-auto/free'
    && TABLE.llm7.models.smart[0] === 'codestral-latest');
  ok('T234a-5: ORDER ставит gemini, mistral и openrouter раньше cloudflare и sharellm',
    ORDER.fast.indexOf('gemini') < ORDER.fast.indexOf('cloudflare')
    && ORDER.fast.indexOf('mistral') < ORDER.fast.indexOf('cloudflare')
    && ORDER.smart.indexOf('mistral') < ORDER.smart.indexOf('cloudflare')
    && ORDER.smart.indexOf('openrouter') < ORDER.smart.indexOf('sharellm'));
}

console.log('\n── Сторожок первого слова в потоке (streamCall firstByteMs) ──');
{
  const enc = new TextEncoder();
  const reqBase = {
    url: 'https://fake.local/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'привет' }] },
    sse: (d) => ({ text: d?.choices?.[0]?.delta?.content || '' }),
    wrap: (reply, finish) => ({ choices: [{ message: { content: reply }, finish_reason: finish || 'stop' }] }),
  };

  /* 1. Молчащий апстрим обрывается по firstByteMs (~1.5 с), не дожидаясь полного 8 с потолка */
  const t0 = Date.now();
  const hung = await streamCall(
    (_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        rej(err);
      });
    }),
    reqBase,
    8000,
    () => {},
    () => {},
    1500,
  );
  const dtHung = Date.now() - t0;
  ok('T234b-1: молчащий апстрим прерван по firstByteMs до полного таймаута',
    hung.status === 0 && hung.error === 'timeout' && dtHung < 3500,
    `dt=${dtHung}ms err=${hung.error}`);

  /* 2. Поток, приславший первый кусок вовремя, спокойно дописывает ответ дольше firstByteMs */
  const live = await streamCall(
    () => Promise.resolve({
      status: 200,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: new ReadableStream({
        async start(ctrl) {
          await new Promise((r) => setTimeout(r, 200));
          ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Раз "}}]}\n\n'));
          await new Promise((r) => setTimeout(r, 1600));
          ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"два."}}]}\n\ndata: [DONE]\n\n'));
          ctrl.close();
        },
      }),
    }),
    reqBase,
    8000,
    () => {},
    () => {},
    1500,
  );
  ok('T234b-2: начавший писать поток снимает firstByteMs и дописывает ответ целиком',
    live.status === 200 && live.text === 'Раз два.' && !live.streamError,
    JSON.stringify(live));
}

console.log('\n── Безключевой 401 и карантин мёртвых 404 моделей в чате ──');
{
  MODEL_COOL.clear();
  /* 3. На keyless-доме 401 на первой модели НЕ убивает весь дом — соседняя модель отвечает */
  const seenKilo = [];
  const engKeyless = createEngine({
    env: {},
    sleep: async () => {},
    fetch: async (_url, init) => {
      const b = JSON.parse(init.body || '{}');
      seenKilo.push(b.model);
      if (b.model === 'kilo-auto/free') {
        return new Response(JSON.stringify({ error: { message: 'Missing API key' } }), { status: 401 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Живой ответ соседней модели без ключа.' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const rKeyless = await engKeyless.run({
    text: 'Разбери подробно архитектуру распределённого кэша и консистентного хэширования',
    only: 'kilo',
    tier: 'smart',
    noTools: true,
    noCouncils: true,
  });
  ok('T234c: 401 на одной модели keyless-шлюза не сажает провайдер в карантин — отвечает соседняя модель',
    rKeyless.ok && rKeyless.provider === 'kilo' && seenKilo.length >= 2,
    JSON.stringify({ ok: rKeyless.ok, provider: rKeyless.provider, model: rKeyless.model, seenKilo }));

  MODEL_COOL.clear();
  /* 4. 404 модели уводит её в карантин: второй запрос сразу идёт на живую вторую голову */
  const calls404 = [];
  const eng404 = createEngine({
    env: { OPENROUTER_KEY: 'sk-or-test-1' },
    sleep: async () => {},
    fetch: async (_url, init) => {
      const b = JSON.parse(init.body || '{}');
      calls404.push(b.model);
      if (b.model === 'recursive/flint-v1.0:free') {
        return new Response(JSON.stringify({ error: { message: 'This model is unavailable for free', code: 404 } }), { status: 404 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Варшава.' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const r1 = await eng404.run({ text: 'привет', only: 'openrouter', noTools: true, noCouncils: true });
  const lenAfterFirst = calls404.length;
  const r2 = await eng404.run({ text: 'пока', only: 'openrouter', noTools: true, noCouncils: true });
  const secondRunModels = calls404.slice(lenAfterFirst);
  ok('T234d: 404 на модели уводит её в карантин — следующий запрос сразу обходит мёртвую голову',
    r1.ok && r2.ok && !secondRunModels.includes('recursive/flint-v1.0:free'),
    JSON.stringify({ calls404, secondRunModels }));

  MODEL_COOL.clear();
  /* 5. Короткий fast-вопрос снижает medium → low, а кодовый вопрос сохраняет medium */
  const efforts = [];
  const engEffort = createEngine({
    env: { INCEPTION_KEY: 'sk-inc-test' },
    sleep: async () => {},
    fetch: async (_url, init) => {
      const b = JSON.parse(init.body || '{}');
      efforts.push({ model: b.model, effort: b.reasoning_effort });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Готово.' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await engEffort.run({
    text: 'привет, как дела',
    only: 'inception',
    forceModel: 'mercury-2.5',
    reasoningEffort: 'medium',
    noTools: true,
    noCouncils: true,
  });
  await engEffort.run({
    text: 'Напиши функцию быстрой сортировки на Python с обработкой дубликатов',
    only: 'inception',
    forceModel: 'mercury-2.5',
    reasoningEffort: 'medium',
    noTools: true,
    noCouncils: true,
  });
  ok('T234e: fast-разговор снижает reasoning_effort с medium до low, а код сохраняет medium',
    efforts.length === 2 && efforts[0].effort === 'low' && efforts[1].effort === 'medium',
    JSON.stringify(efforts));
  MODEL_COOL.clear();
}

console.log(`\nИтог 0.234: ${pass} зелёных, ${fail} красных.`);
if (fail) process.exit(1);
