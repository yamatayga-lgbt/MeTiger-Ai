/**
 * Двигатель Этап 1a — классификация, очереди моделей, форма запроса, разбор ответа.
 * Сети нет: всё проверяется на таблицах и на внедрённом fetch.
 * Запуск: node test/route.test.js
 */
import assert from 'node:assert';
import { INTENT_HEADS, classifyTask, headsFor, isDeepThinker, isReasoning, isVision, modelsFor, preferHeads, tierFor, visionFirst } from '../engine/route.js';
import { buildRequest, isProviderError, isRefusal, stripThinkTags, THINK_OPEN_PARTIAL } from '../engine/shape.js';
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

/* «Думающий» для режима «глубже» — шире, чем «не сожжёт ли бюджет на размышления».
   DeepSeek V4 и GLM-5 отвечают быстро и до конца, поэтому в REASON_HINT их нет,
   но на вопрос «кто лучше решает трудное» они — первые. Если это правило
   потеряется, «Размышлять глубже» начнёт выбирать ту же модель, что и обычный
   запрос: режим останется, разницы не будет. */
ok('D1: deep-думающими считаются deepseek-v4, glm-5 и gemini-3, которых REASON_HINT не ловит',
  isDeepThinker('deepseek-v4-pro') && isDeepThinker('glm-5.3') && isDeepThinker('gemini-3.5-flash')
    && !isReasoning('deepseek-v4-pro') && !isReasoning('glm-5.3'));
ok('D2: обычные модели думающими не объявлены — иначе «глубже» переставлял бы всё подряд',
  !isDeepThinker('llama-3.3-70b-instruct') && !isDeepThinker('ministral-14b-2512') && !isDeepThinker('gpt-4o-mini'));

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

  /* 0.070: presence/frequency penalty — второе расширение карточки «Параметры». */
  const withPen = buildRequest({
    cfg: P.groq, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c',
    presencePenalty: 0.6, frequencyPenalty: -0.3,
  });
  ok('C10: presence/frequency_penalty доезжают до openai-совместимого тела под своим именем',
    withPen.body.presence_penalty === 0.6 && withPen.body.frequency_penalty === -0.3, JSON.stringify(withPen.body));
  const noPen = buildRequest({ cfg: P.groq, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c' });
  ok('C11: без penalty в запросе — полей нет вовсе (используется дефолт самого провайдера, не наш 0)',
    !('presence_penalty' in noPen.body) && !('frequency_penalty' in noPen.body), JSON.stringify(Object.keys(noPen.body)));
  const gp2 = buildRequest({
    cfg: P.gemini, keyIdx: 0, model: 'm', tier: 'fast', messages: [{ role: 'user', content: 'x' }], system: 'c',
    presencePenalty: 1.2, frequencyPenalty: 0.4,
  });
  ok('C12: у gemini те же два поля — camelCase внутри generationConfig',
    gp2.body.generationConfig.presencePenalty === 1.2 && gp2.body.generationConfig.frequencyPenalty === 0.4, JSON.stringify(gp2.body.generationConfig));
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

console.log('D — «Размышлять глубже»: кто отвечает и в каком порядке (0.109)');
{
  const cfg = { models: { smart: ['llama-3.3-70b-instruct', 'ministral-14b-2512', 'deepseek-v4-pro', 'glm-5.3'] } };
  const plain = modelsFor(cfg, 'smart', 'reasoning', null, {}, false);
  const deep = modelsFor(cfg, 'smart', 'reasoning', null, {}, true);
  ok('D3: без режима вперёд идёт только голова интента — думающая, но не голова, стоит где стояла',
    plain.join() === 'deepseek-v4-pro,llama-3.3-70b-instruct,ministral-14b-2512,glm-5.3', plain.join());
  ok('D4: в режиме «глубже» думающие модели уходят в НАЧАЛО пула, а не просто не в конец',
    deep.slice(0, 2).join() === 'deepseek-v4-pro,glm-5.3' && deep.length === 4, deep.join());
  const vision = modelsFor(cfg, 'smart', 'vision', ['data:image/png;base64,AA'], {}, true);
  ok('D5: с картинкой режим не ломает зрение — слепая думающая модель картинку не увидит',
    vision.length === 4, vision.join());
  const fast = modelsFor({ models: { fast: ['deepseek-v4-pro', 'llama-3.3-70b-instruct'] } }, 'fast', 'fast', null, {}, true);
  ok('D6: «глубже» не выбрасывает из пула обычные модели — если думающая откажет, ответит она',
    fast.join() === 'deepseek-v4-pro,llama-3.3-70b-instruct', fast.join());
}

/* Тег размышлений, названный по-своему, — тот же тег. Живой случай с прода:
   `<вкладка:thinking> We need to prove…` уехал человеку текстом ответа, потому что
   разбор знал только латинские имена. Правило теперь одно на поток и на обычный
   ответ (engine/shape.js). */
console.log('T — ход мыслей не показывается ответом, каким бы именем модель его ни назвала');
{
  const t1 = stripThinkTags('<вкладка:thinking>We need to prove that sqrt(2) is irrational.</вкладка:thinking>\nЧисло иррационально.');
  ok('T1: чужое имя тега («вкладка:thinking») уводит мысли в reasoning, а не в ответ',
    t1.text === 'Число иррационально.' && /sqrt\(2\)/.test(t1.reasoning), JSON.stringify(t1));
  const t2 = stripThinkTags('<мысли>считаю шаги</мысли>Ответ.');
  ok('T2: русское имя тега тоже понимается', t2.text === 'Ответ.' && t2.reasoning === 'считаю шаги', JSON.stringify(t2));
  const t3 = stripThinkTags('<think>обычный</think>Ответ');
  ok('T3: прежнее поведение не сломано — <think> режется как резался', t3.text === 'Ответ' && t3.reasoning === 'обычный', JSON.stringify(t3));
  const t4 = stripThinkTags('<div class="x">код html</div> и текст');
  ok('T4: чужой тег (html в примере кода) ответом не считается — ложных срабатываний нет',
    t4.reasoning === '' && /код html/.test(t4.text), JSON.stringify(t4));
  const t6 = stripThinkTags('Доказательство: √2 иррационально.\n<think>We need to advise on architecture choice and weigh factors');
  ok('T6: незакрытый хвост размышлений режется, а его текст уходит в reasoning, а не пропадает',
    t6.text === 'Доказательство: √2 иррационально.' && /We need to advise/.test(t6.reasoning), JSON.stringify(t6));
  const t7 = stripThinkTags('Вот пример: `и тег <think>` в тексте протокола');
  ok('T7: тег внутри строки не режет ответ — незакрытое правило смотрит на начало строки',
    /и тег <think>/.test(t7.text) && t7.reasoning === '', JSON.stringify(t7));
  ok('T5: неполный тег узнаётся — поток может оборвать кусок посреди имени',
    THINK_OPEN_PARTIAL.test('<вкл') && THINK_OPEN_PARTIAL.test('</think') && !THINK_OPEN_PARTIAL.test('<div class='));
}

console.log('R — головы интента: кому считать математику и писать код (INTENT_HEADS)');
{
  ok('R1: дефолт короток и честен — только то, что реально отвечает бесплатно',
    INTENT_HEADS.math.join() === 'deepseek-v4-flash,deepseek-v4-pro' && INTENT_HEADS.code.join() === INTENT_HEADS.math.join(), INTENT_HEADS.math.join());
  ok('R2: головы есть только у math, code и «глубже» — на болтовне и зрении порядок не трогаем',
    headsFor('chat', {}).length === 0 && headsFor('vision', {}).length === 0 && headsFor('math', {}).length === 2,
    JSON.stringify({ chat: headsFor('chat', {}), vision: headsFor('vision', {}) }));
  ok('R2b: «глубже» ведёт к сильным рассуждениям, а не к самой быстрой модели пула',
    headsFor('reasoning', {}).join() === 'deepseek-v4-pro,deepseek-v4-flash', headsFor('reasoning', {}).join());
  ok('R2c: DEEP_HEADS человека важнее дефолта, INTENT_HEADS=off выключает всё',
    headsFor('reasoning', { DEEP_HEADS: 'glm-5.3, ' }).join() === 'glm-5.3'
      && headsFor('reasoning', { INTENT_HEADS: 'off' }).length === 0);
  ok('R2d: провайдер с головой «глубже» идёт вперёд очереди',
    preferHeads(['groq', 'zai', 'odirouter'], { groq: ['openai/gpt-oss-120b'], zai: ['glm-4.5-flash'], odirouter: ['deepseek-v4-pro'] }, 'reasoning', {})[0] === 'odirouter');
  ok('R3: MATH_HEADS человека важнее дефолта, пустые имена отбрасываются',
    headsFor('math', { MATH_HEADS: 'одна, ,две' }).join() === 'одна,две', JSON.stringify(headsFor('math', { MATH_HEADS: 'одна, ,две' })));
  ok('R4: потолок шесть голов — очередь и промпт не распухают', headsFor('math', { MATH_HEADS: 'a,b,c,d,e,f,g,h' }).length === 6);
  const pools = { groq: ['openai/gpt-oss-120b'], odirouter: ['free-gemini-3-flash-preview', 'deepseek-v4-flash'], zai: ['glm-4.5-flash'] };
  ok('R5: первым идёт провайдер, у которого голова в пуле',
    preferHeads(['groq', 'odirouter', 'zai'], pools, 'math', {}).join() === 'odirouter,groq,zai',
    preferHeads(['groq', 'odirouter', 'zai'], pools, 'math', {}).join());
  ok('R6: нет головы ни у кого — порядок остаётся как был', preferHeads(['groq', 'zai'], { groq: ['a'], zai: ['b'] }, 'math', {}).join() === 'groq,zai');
  ok('R7: INTENT_HEADS=off снимает и головы пула, и очередь провайдеров',
    preferHeads(['groq', 'odirouter'], pools, 'math', { INTENT_HEADS: 'off' }).join() === 'groq,odirouter'
    && headsFor('code', { INTENT_HEADS: 'off' }).length === 0, '');
  ok('R8: головы пула применяются только без картинок — зрение важнее марки модели',
    modelsFor({ models: { smart: ['claude-x', 'deepseek-v4-flash'] } }, 'smart', 'math', []).join() === 'deepseek-v4-flash,claude-x'
    && modelsFor({ models: { smart: ['claude-x', 'deepseek-v4-flash'] } }, 'smart', 'math', [{}]).join() !== 'deepseek-v4-flash,claude-x', '');
}

console.log('Z — зрение как последнее слово в порядке пула');
{
  const blind = 'deepseek-v4-flash', see = 'gemini-3.8-flash', other = 'qwen-3.8-27b', omni = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
  const l = [blind, see, other, omni];
  const z = visionFirst(l, ['data:image/png;base64,AAA']);
  ok('Z1: с картинкой зрячие идут первыми, порядок внутри их не трогается',
    z[0] === see && z[1] === omni && z.slice(2).join() === [blind, other].join(), z.join(','));
  ok('Z2: без картинки список не трогаем (не за что переставлять)', visionFirst(l, []).join() === l.join());
  ok('Z3: слепой пул остаётся как есть — это сигнал пропускать провайдер, а не таскать вслепую',
    visionFirst([blind, other], ['x']).join() === [blind, other].join(), visionFirst([blind, other], ['x']).join(','));
  ok('Z4: повторный вызов ничего не меняет (порядок идемпотентен)',
    visionFirst(z, ['x']).join() === z.join(), visionFirst(z, ['x']).join(','));
  ok('Z5: мусор на входе не роняет (undefined, не-массив)',
    visionFirst(undefined, ['x']).length === 0 && visionFirst('не список', ['x']).length === 0);
}

console.log('R127 — «план» внутри «планеты» и остывание модели после 429 (0.127)');
{
  ok('R127a: «Назови 3 планеты» — не рассуждение (раньше «план» в «планеты» созывал совет на 13 с)',
    classifyTask('Назови 3 планеты солнечной системы') === 'fast' && classifyTask('купить планшет') === 'fast');
  ok('R127b: настоящий план по-прежнему рассуждение',
    ['составь план поездки', 'нужен план', 'планирую отпуск', 'по плану'].every((q) => classifyTask(q) === 'reasoning'));
  const { createEngine } = await import('../engine/chat.js');
  let calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse((init && init.body) || '{}');
    calls.push(body.model);
    if (calls.length === 1) return new Response('{"error":"rate"}', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ответ ' + body.model }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const shared = new Map();
  const env = { GROQ_KEYS: 'g1', COUNCIL_BUDGET: '0', CHECK: 'off', ENSEMBLE: 'off' };
  const mk = () => createEngine({ env, fetch: fakeFetch, modelCool: shared, sleep: async () => {} });
  const r1 = await mk().run({ text: 'привет', useTools: false, skills: false, providerOrder: ['groq'] });
  const first = calls[0];
  calls = [];
  const r2 = await mk().run({ text: 'привет', useTools: false, skills: false, providerOrder: ['groq'] });
  ok('R127c: модель, ответившая 429, в следующем запросе (новый движок, общая карта) идёт не первой',
    r1.ok && r2.ok && calls[0] !== first, JSON.stringify({ first, next: calls }));
}

{
  const sk = await import('../engine/skills.js');
  const cur = (q) => sk.detect(q, {}).some((x) => x.id === 'currency');
  ok('R128: навык курса валют не ловит «рекурсию», «курсы английского», «курсовую», «Европу»',
    !cur('Объясни, что такое рекурсия') && !cur('Записался на курсы английского') && !cur('Курсовая по истории') && !cur('Расскажи про Европу'));
  ok('R128b: а настоящие вопросы про валюту — ловит',
    cur('Какой курс доллара?') && cur('Сколько 100 евро в рублях') && cur('курс биткоина') && cur('конвертируй 50 долларов'));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
