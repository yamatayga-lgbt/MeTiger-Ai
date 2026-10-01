/**
 * Двигатель Этап 1a — классификация, очереди моделей, форма запроса, разбор ответа.
 * Сети нет: всё проверяется на таблицах и на внедрённом fetch.
 * Запуск: node test/route.test.js
 */
import assert from 'node:assert';
import { classifyTask, tierFor, isVision, modelsFor } from '../engine/route.js';
import { buildRequest, isProviderError, isRefusal, stripThinkTags } from '../engine/shape.js';
import { buildTable } from '../engine/providers.js';

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

console.log('A — куда уходит задача (роутер перенесён вместе с порядком проверок)');
ok('A1: «напиши код факториала» → code', classifyTask('напиши код факториала на python') === 'code');
ok('A2: «сравни postgres и mysql» → reasoning, хотя sql в тексте есть',
  classifyTask('сравни postgres и mysql для нагрузки чтения') === 'reasoning');
ok('A3: «почему этот код не работает» → code', classifyTask('почему этот код не работает на node 22') === 'code');
ok('A4: арифметика словами → math', classifyTask('24 яблока, треть съели утром, вечером ещё 5, сколько осталось') === 'math'
  || classifyTask('посчитай 24 - 8 - 5') === 'math');
ok('A5: «привет, как дела» → fast', classifyTask('привет, как дела') === 'fast');
ok('A6: развёрнутый вопрос без маркеров → reasoning',
  classifyTask('Мне нужно понять стоит ли переходить на микросервисы если команда из четырёх человек и релизы раз в две недели') === 'reasoning');
ok('A7: vision — только при настоящей картинке',
  classifyTask('что на фото', ['data:image/png;base64,AA']) === 'vision' && classifyTask('что на фото') !== 'vision');
ok('A8: «накидай идей для названия» → creative', classifyTask('накидай идей для названия сервиса') === 'creative');
ok('A9: tier: код/математика/зрение — smart, болтовня — fast',
  tierFor('code') === 'smart' && tierFor('vision') === 'smart' && tierFor('fast') === 'fast');

console.log('B — внутри провайдера: зрячие первыми, думающие последними');
ok('B1: glm-4.7-flash и qwen3.7-flash в зрячие не попадают',
  !isVision('glm-4.7-flash') && !isVision('qwen/qwen3.7-flash:free'));
ok('B2: gemini- и vl- попадают', isVision('gemini-2.5-flash') && isVision('inclusionai/ling-3.0-flash-vl:free'));
{
  const cfg = { models: { fast: ['glm-4.7-flash', 'llama-3.2-vision-11b', 'gpt-oss-120b'] } };
  const withImg = modelsFor(cfg, 'fast', 'vision', ['data:image/png;base64,AA']);
  ok('B3: с картинкой зрячая модель идёт первой', withImg[0] === 'llama-3.2-vision-11b', JSON.stringify(withImg));
  const plain = modelsFor(cfg, 'fast', 'fast', []);
  ok('B4: в болтовне думающая модель уезжает в конец (бюджет токенов уходит на размышления)',
    plain[plain.length - 1] === 'gpt-oss-120b', JSON.stringify(plain));
  const code = modelsFor(cfg, 'fast', 'code', []);
  ok('B5: на коде и математике порядок пула не трогаем (думать там нужно, а не прятать)',
    code.join() === cfg.models.fast.join(), JSON.stringify(code));
}

console.log('C — тело запроса — формат своего провайдера');
{
  const req = buildRequest({
    cfg: P.groq, keyIdx: 0, model: 'openai/gpt-oss-20b', tier: 'fast',
    messages: [{ role: 'user', content: 'Привет' }], system: 'Система', maxTokens: 700,
  });
  ok('C1: openai-эндпоинт и Bearer по ключу из env',
    /\/chat\/completions$/.test(req.url) && req.headers.authorization === 'Bearer g1', req.url);
  ok('C2: система первым сообщением', req.body.messages[0].role === 'system' && req.body.messages[1].content === 'Привет');
  ok('C3: max_tokens и temperature доезжают', req.body.max_tokens === 700 && req.body.temperature === 0.8);

  const g = buildRequest({
    cfg: P.gemini, keyIdx: 0, model: 'gemini-2.5-flash', tier: 'fast',
    messages: [{ role: 'assistant', content: 'было' }, { role: 'user', content: 'стало' }],
    system: 'Система', images: ['data:image/png;base64,AAA'], maxImages: 2,
  });
  ok('C4: gemini — :generateContent с ключом в query', /:generateContent\?key=gm1$/.test(g.url), g.url);
  ok('C5: система — user-turn с подтверждением, иначе Gemini её теряет',
    g.body.contents[0].parts[0].text === 'Система' && g.body.contents[1].role === 'model');
  ok('C6: роль assistant → model', g.body.contents[2].role === 'model');
  ok('C7: картинка — inline_data в последнем user-turn',
    JSON.stringify(g.body.contents[3]).indexOf('inline_data') >= 0, JSON.stringify(g.body.contents).slice(0, 160));

  const cf = buildRequest({ cfg: P.cloudflare, keyIdx: 0, model: '@cf/meta/llama-3.1-8b-instruct', tier: 'fast', messages: [{ role: 'user', content: 'х' }], system: '' });
  ok('C8: cloudflare — {acc} подставлен из env', cf.url.indexOf('/accounts/acc123/ai/v1/') > 0 && cf.url.indexOf('{acc}') < 0, cf.url);

  const or = buildRequest({ cfg: P.openrouter, keyIdx: 0, model: 'x/y:free', tier: 'fast', messages: [{ role: 'user', content: 'х' }], system: 'с' });
  ok('C9: openrouter получает подсказку models', Array.isArray(or.body.models) && or.body.models[0] === 'x/y:free');
}

console.log('D — из ответа достаётся текст, а не мусор');
{
  const req = buildRequest({ cfg: P.groq, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c' });
  const withThink = '<think>сначала размышление</think> итог'
  const p = req.parse({ choices: [{ message: { content: withThink, reasoning_content: 'рассуждал' }, finish_reason: 'length' }] });
  ok('D1: текст без хода мыслей', p.reply === 'итог', JSON.stringify(p.reply));
  ok('D2: reasoning_content — отдельным полем', p.reasoning === 'рассуждал', JSON.stringify(p.reasoning));
  ok('D3: finish_reason виден (по нему решаем про допилку)', p.finish === 'length');
  const err = req.parse({ error: { message: 'key quota exceeded' } });
  ok('D4: ошибка провайдера не выдаётся за ответ', /quota/.test(err.error || ''), JSON.stringify(err));
  const gp = buildRequest({ cfg: P.gemini, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c' })
    .parse({ candidates: [{ content: { parts: [{ text: 'раз' }, { text: 'два' }] }, finishReason: 'STOP' }], promptFeedback: { blockReason: 'SAFETY' } });
  ok('D5: gemini — части склеиваются', /раз/.test(gp.reply) && /два/.test(gp.reply), gp.reply);
  ok('D6: gemini — блок по фильтрам виден как blocked, а не как пустой ответ', gp.blocked === true);
  const cut = stripThinkTags('<think>думаю</think> ответ человеку');
  ok('D7: think-теги вырезаются и в standalone-хелпере', cut.text === 'ответ человеку' && /думаю/.test(cut.reasoning), JSON.stringify(cut));
  ok('D8: ошибка провайдера — да; голые числа в тексте — нет',
    isProviderError('Rate limit reached for this key') === true
    && isProviderError('в зале 429 человек') === false
    && isProviderError('ошибка: тайм-аут соединения') === true);
  ok('D9: вежливый отказ ловится отдельным признаком и не глушит длинные ответы',
    isRefusal('Извини, не могу с этим помочь') === true
    && isRefusal('Sorry, but I cannot help with that') === true
    && isRefusal('Конечно! Вот как устроен event loop в Node: ' + 'подробности. '.repeat(40)) === false);
  ok('D10: parts без text (inlineData) не превращается в undefined в ответе',
    (() => {
      const r = buildRequest({ cfg: P.gemini, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c' })
        .parse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png' } }, { text: 'видно' }] } }] });
      return r.reply === 'видно' && r.blocked === false;
    })());
  ok('D11: блок по безопасности в finishReason — тоже blocked',
    (() => {
      const r = buildRequest({ cfg: P.gemini, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c' })
        .parse({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] });
      return r.blocked === true && /SAFETY/.test(r.blockReason);
    })());
}

console.log('E — у задачи с верным числом должен быть умный слой, а не «быстро»');
{
  /* Дефект нашёл живой прогон: совет голов такие задачи ловил, а роутер отправлял
     их в дешёвый слой — агент путался, его исправляли, и за это платили секундами. */
  const apples = 'В вазе было 24 яблока. Третью часть съели утром, а вечером ещё 5. Сколько яблок осталось?';
  const apples2 = '24 яблока, треть съели утром, вечером ещё 5. Сколько осталось?';
  ok('E1: арифметика в человеческой формулировке — math', classifyTask(apples) === 'math', classifyTask(apples));
  ok('E2: и в короткой формулировке тоже', classifyTask(apples2) === 'math', classifyTask(apples2));
  ok('E3: math ⇒ tier smart (цена ошибки выше цены секунды)', tierFor(classifyTask(apples)) === 'smart');
  ok('E4: «2+2» как и раньше — math', classifyTask('посчитай 24 - 8 - 5') === 'math', classifyTask('посчитай 24 - 8 - 5'));
  ok('E5: бытовой вопрос с числами не уезжает в math',
    classifyTask('у меня 3 кошки и 2 собаки, они не ладят, что делать') === 'fast',
    classifyTask('у меня 3 кошки и 2 собаки, они не ладят, что делать'));
  ok('E6: просьба написать код остаётся кодом, даже с цифрами в тексте',
    classifyTask('напиши функцию, которая складывает 2 и 3') === 'code',
    classifyTask('напиши функцию, которая складывает 2 и 3'));
  ok('E7: «привет» остаётся быстрым', classifyTask('привет') === 'fast', classifyTask('привет'));
}

console.log('F — порядок в пулах groq: первая быстрая модель должна годиться для русского');
{
  const P = buildTable({ GROQ_KEYS: 'g' });
  const g = P.groq.models;
  ok('F1: allam-2-7b убрана из быстрого пула (арабский вставки + география наврёт)',
    g.fast.indexOf('allam-2-7b') < 0, JSON.stringify(g.fast));
  ok('F2: мёртвых на нашем ключе id в пулах нет',
    [g.fast, g.smart].every((a) => a.indexOf('groq/compound') < 0 && a.indexOf('groq/compound-mini') < 0),
    JSON.stringify({ fast: g.fast, smart: g.smart }));
  ok('F3: быстрый пул начинается с модели, прошедшей замер формы',
    g.fast[0] === 'qwen/qwen3.8-27b', g.fast[0]);
  ok('F4: в smart первой идёт gpt-oss-120b (её живой ответ подтверждён и в проде)',
    g.smart[0] === 'openai/gpt-oss-120b', g.smart[0]);
  const take = modelsFor(P.groq, 'fast', 'chat', false).slice(0, 2);
  ok('F5: modelsPerProvider=2 берёт две живые модели, а не «каша + 400»',
    take.indexOf('allam-2-7b') < 0 && take.indexOf('groq/compound-mini') < 0, JSON.stringify(take));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
