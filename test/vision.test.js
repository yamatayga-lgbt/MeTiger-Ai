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

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exit(1);
