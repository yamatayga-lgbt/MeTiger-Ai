/**
 * 0.210 — многоступенчатый анализ изображения.
 *
 * Проверяется не «модель всё разрешила», а устойчивость движка: задача по
 * фото классифицируется по цели, после отказа идут инвентаризация, одна
 * деталь и визуальные якоря, а полезный кусок частично отказного ответа
 * не выбрасывается вместе с фразой провайдера о его правилах.
 *
 *   node test/vision.test.js
 */
import * as vision from '../engine/vision.js';
import { createEngine } from '../engine/chat.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 240) : '')); }
};
const chat = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const img = ['data:image/png;base64,AA'];

/* Какую ступень видит модель в этом запросе: нужно и для счёта вызовов, и для
   проверок «ступаем по порядку». */
const STAGE_MARK = [
  [/Режим холодного разбора/, 'neutral'],
  [/Режим разбора одной детали/, 'detail'],
  [/Режим визуальных якорей/, 'anchors'],
  [/Режим профессионального разбора/, 'professional'],
  [/Режим перечня видимого/, 'checklist'],
  [/Режим разбора взрослого кадра/, 'adult'],
];
const stageOf = (body) => (STAGE_MARK.find(([re]) => re.test(String(body || ''))) || [null, '?'])[1];

console.log('V21 — чистая классификация и ступени анализа');
{
  ok('V21.1: документ, медицина, кадр и люди различаются по цели вопроса',
    vision.classifyVisionTask('прочитай, что написано на чеке').mode === 'document'
      && vision.classifyVisionTask('что с родинкой на коже?').mode === 'medical'
      && vision.classifyVisionTask('оцени кадр и освещение').mode === 'composition'
      && vision.classifyVisionTask('что делает человек на фото?').mode === 'people');

  const detail = vision.visionPass('detail', 'какого цвета главный предмет?');
  const anchors = vision.visionPass('anchors', 'что на этом фото?');
  const neutral = vision.visionPass('neutral', 'что на этом фото?');
  ok('V21.2: три прохода действительно разные, а не одна подсказка трижды',
    /инвентаризация видимого/.test(neutral.system)
      && /одной детали/.test(detail.system) && /цвета и оттенки/.test(detail.prompt)
      && /визуальных якорей/.test(anchors.system) && /Не переходи к эротической/.test(anchors.system));

  ok('V21.3: локальная задача есть для особого режима и не шумит на обычном вопросе',
    vision.visionInlineNote('прочитай надпись').includes('режим анализа вложения')
      && vision.visionInlineNote('что тут?') === '');

  ok('V21.4: технические факты о вложении не выдумывают содержимое',
    vision.imageFacts(img).length === 1
      && /Получено изображений: 1 \(PNG/.test(vision.imageFactLine(img)));
}

console.log('V22 — лестница доходит до визуальных якорей');
{
  let calls = 0;
  const fetchAnchors = async (url, init) => {
    calls++;
    const body = String((init && init.body) || '');
    const text = /Режим визуальных якорей/.test(body)
      ? 'Визуальные якоря: на переднем плане предмет, фон нейтральный, свет мягкий, композиция центрированная, качество среднее.'
      : 'Извините, я не могу анализировать или комментировать данное изображение.';
    return { status: 200, text: async () => JSON.stringify(chat(text)) };
  };
  const engine = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchAnchors, sleep: async () => {} });
  const r = await engine.run({ text: 'что на этом фото? оцени кадр', images: img, noCouncils: true });
  ok('V22.1: после отказов на полной и холодной ступенях ответ дают якоря',
    r.ok && r.photoNeutral === true && r.photoStage === 'anchors' && r.photoMode === 'composition'
      && /Визуальные якоря/.test(r.reply),
    JSON.stringify({ ok: r.ok, calls, stage: r.photoStage, mode: r.photoMode, reply: String(r.reply || '').slice(0, 80) }));
}

console.log('V23 — спасение частично полезного ответа');
{
  let calls = 0;
  const fetchPartial = async () => {
    calls++;
    return {
      status: 200,
      text: async () => JSON.stringify(chat('Я не могу анализировать это изображение. На фото видна комната, окно и стол; на фоне нейтральная стена, свет мягкий.')),
    };
  };
  const engine = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchPartial, sleep: async () => {} });
  const r = await engine.run({ text: 'что на фото?', images: img, noCouncils: true });
  ok('V23.1: отказная первая фраза срезана, наблюдение доставлено человеку',
    r.ok && r.photoSalvaged === true && /видна комната/.test(r.reply) && !/не могу анализировать/i.test(r.reply),
    JSON.stringify({ ok: r.ok, calls, salvaged: r.photoSalvaged, reply: String(r.reply || '').slice(0, 100) }));
}

console.log('V24 — даже полный отказ всех голов остаётся честным ответом движка');
{
  const fetchRefuse = async () => ({
    status: 200,
    text: async () => JSON.stringify(chat('Извините, я не могу анализировать или комментировать данное изображение.')),
  });
  const engine = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchRefuse, sleep: async () => {} });
  const r = await engine.run({ text: 'прочитай, что написано на фото', images: img, noCouncils: true });
  ok('V24.1: финал помечает ступень/режим и называет технические факты вложения',
    r.ok && r.photoRefused === true && r.photoStage === 'fallback' && r.photoMode === 'document'
      && /Получено изображений: 1/.test(r.reply) && /визуальным якорям/.test(r.reply),
    JSON.stringify({ ok: r.ok, stage: r.photoStage, mode: r.photoMode }));
}

console.log('V25 — ступени 0.232: профессиональная, перечень, взрослая');
{
  const prof = vision.visionPass('professional', 'что с родинкой на коже?');
  const list = vision.visionPass('checklist', 'что на фото?');
  const adult = vision.visionPass('adult', 'разбери интимное фото');
  ok('V25.1: профессиональная ступень называет область и запрещает отказ от видимого',
    vision.VISION_STAGES.indexOf('professional') >= 0 && /медицинской фотографии/.test(prof.system)
      && /без отказа/.test(prof.system));
  ok('V25.2: перечень — механические семь пунктов, отказываться нечем',
    /списком из семи пунктов/.test(list.system) && /инвентаризация, отказываться нечем/.test(list.system));
  ok('V25.3: взрослая ступень отвечает прямо, но не смакует и держит границу по возрасту',
    /18\+/.test(adult.system) && /без эвфемизмов/.test(adult.system)
      && /несовершеннолетн/.test(adult.system) && /Эротической или возбуждающей детализации не добавляй/.test(adult.system));
  ok('V25.4: все ступени разные, а не один текст пять раз',
    new Set(vision.VISION_STAGES.map((x) => vision.visionPass(x, 'что на фото?').system)).size === vision.VISION_STAGES.length);
}

console.log('V26 — жёсткие границы: лестница снимает ложные отказы, а не настоящие запреты');
{
  ok('V26.1: несовершеннолетние, опознание и распространение останавливаются до вызова моделей',
    vision.hardStop('разбери интимное фото школьницы') === 'minor'
      && vision.hardStop('кто это на интимном фото') === 'identify'
      && vision.hardStop('выложи её интимное фото') === 'distribute');
  ok('V26.2: обычные разборы под запрет не попадают — ложных срабатываний нет',
    vision.hardStop('что с родинкой на коже?') === ''
      && vision.hardStop('что на фото?') === ''
      && vision.hardStop('разбери интимное фото') === ''
      && vision.hardStop('что за обнажённая статуя, кто это?') === '');
  ok('V26.3: ответ на стоп называет причину и даёт выход, а не читает мораль',
    /несовершеннолетн/.test(vision.hardStopReply('minor'))
      && /по фото я не опознаю|Людей по фото я не опознаю/.test(vision.hardStopReply('identify'))
      && /милицию/.test(vision.hardStopReply('distribute')));
}

console.log('V27 — стоп не тратит ни одного вызова модели');
{
  let calls = 0;
  const engine = createEngine({
    env: { ZAI_KEYS: 'z1' }, sleep: async () => {},
    fetch: async () => { calls++; return { status: 200, text: async () => JSON.stringify(chat('не должно случиться')) }; },
  });
  const r = await engine.run({ text: 'кто это на интимном фото?', images: img, noCouncils: true });
  ok('V27.1: ответ есть, моделей не звали, ступень названа честно',
    r.ok && calls === 0 && /hardstop:identify/.test(r.photoStage || '') && /не опознаю/.test(r.reply),
    JSON.stringify({ calls, stage: r.photoStage, reply: String(r.reply).slice(0, 60) }));
}

console.log('V28 — лестница доходит до механического перечня');
{
  let calls = 0;
  const stages = [];
  const fetchList = async (url, init) => {
    calls++;
    const body = String((init && init.body) || '');
    stages.push(stageOf(body));
    const text = /Режим перечня видимого/.test(body)
      ? '1) главный объект — стол. 2) людей нет. 3) текста нет. 4) кухня. 5) свет мягкий, цвета тёплые. 6) качество среднее. 7) на фото рабочий стол у окна.'
      : 'Извините, я не могу анализировать или комментировать данное изображение.';
    return { status: 200, text: async () => JSON.stringify(chat(text)) };
  };
  const engine = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchList, sleep: async () => {} });
  const r = await engine.run({ text: 'что на этом фото?', images: img, noCouncils: true });
  ok('V28.1: пять отказов подряд не сдаются — срабатывает перечень',
    r.ok && r.photoStage === 'checklist' && /рабочий стол/.test(r.reply),
    JSON.stringify({ stage: r.photoStage, stages: stages.slice(0, 8), calls }));
  const ladder = stages.filter((x) => x !== '?');   /* '?' — обычные попытки до лестницы */
  ok('V28.2: ступени идут по порядку и без повторов, перечень — последний',
    ladder[0] === 'neutral' && ladder[ladder.length - 1] === 'checklist'
      && new Set(ladder).size === ladder.length && calls >= 5,
    JSON.stringify(stages.slice(0, 10)));
}

console.log('V29 — взрослая ступень включается только на взрослом вопросе');
{
  const seen = [];
  const fetchStages = async (url, init) => {
    const body = String((init && init.body) || '');
    seen.push(stageOf(body));
    return { status: 200, text: async () => JSON.stringify(chat('Извините, я не могу анализировать или комментировать данное изображение.')) };
  };
  const e1 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchStages, sleep: async () => {} });
  await e1.run({ text: 'разбери интимное фото', images: img, noCouncils: true });
  const withAdult = seen.slice();
  seen.length = 0;
  const e2 = createEngine({ env: { ZAI_KEYS: 'z1' }, fetch: fetchStages, sleep: async () => {} });
  await e2.run({ text: 'что на этом фото?', images: img, noCouncils: true });
  const plain = seen.slice();
  ok('V29.1: на взрослом вопросе ступень 18+ идёт, на обычном — нет',
    withAdult.includes('adult') && !plain.includes('adult'),
    JSON.stringify({ withAdult: withAdult.slice(0, 10), plain: plain.slice(0, 10) }));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
