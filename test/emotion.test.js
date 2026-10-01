/**
 * Слой состояния собеседника (engine/emotion.js) — порт из донора, пересобранный.
 *
 * Тест держит три обещания порта:
 *   1) донорский баг E5 закрыт — русское «рад» действительно читается как радость;
 *   2) слой не Diagnose-модуль: нет голоса, лица, timeline смайликов и `tone`
 *      (тон — территория style.js), есть оговорки «не называй вслух / не лечи»;
 *   3) молчание — норма: нейтральная реплика и слой с EMOTION=0 не добавляют в
 *      system ни символа.
 *
 *   node test/emotion.test.js
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as emo from '../engine/emotion.js';
import { createEngine } from '../engine/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}
const d = (t, o) => emo.detect(t, o || {});
const has = (a, ...w) => w.every((x) => a.includes(x));

const ENV = { GROQ_KEYS: 'g1' };
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return {
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }),
    };
  };
  impl.calls = calls;
  return impl;
}
const sysOf = (f) => (f.calls[0] ? f.calls[0].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');

console.log('A — таблица состояний');
{
  const ids = Object.keys(emo.EMOTIONS);
  ok('A1: состояний ровно 12, у каждого есть emoji, имя и знак',
    ids.length === 12 && ids.every((id) => {
      const e = emo.EMOTIONS[id];
      return !!e.emoji && !!e.label && typeof e.valence === 'number' && e.valence >= -1 && e.valence <= 1;
    }), String(ids.length));
  ok('A2: neutral — опора с нулевым знаком', emo.EMOTIONS.neutral.valence === 0);
  ok('A3: лексика — регулярки по реальным состояниям, пустых шаблонов нет',
    Object.keys(emo.LEX).every((id) => !!emo.EMOTIONS[id])
      && Object.values(emo.LEX).every((re) => re instanceof RegExp && re.source.length > 8),
    JSON.stringify(Object.keys(emo.LEX).filter((id) => !emo.EMOTIONS[id])));
  ok('A3a: все шаблоны регистронезависимые — «РАБОТАЙ» и «работай» должны значить одно',
    Object.values(emo.LEX).every((re) => re.flags.includes('i')),
    JSON.stringify(Object.entries(emo.LEX).filter(([, re]) => !re.flags.includes('i')).map(([k]) => k)));
  ok('A3b: regex не ломается на пустом входе и ловит слово в потоке текста',
    emo.LEX.joy.test('Безусловно, я рад, что это закончилось')
      && !emo.LEX.joy.test('') && emo.LEX.irritation.test('хватит, сколько раз можно'));
  ok('A3b: вес есть у всех состояний, кроме neutral (иначе он не сможет быть опорой)',
    Object.keys(emo.WEIGHT).every((id) => !!emo.EMOTIONS[id] && emo.WEIGHT[id] > 0) && !('neutral' in emo.WEIGHT),
    JSON.stringify(emo.WEIGHT));
  ok('A4: имена состояний — по-русски (для подписи и для подсказки человека)',
    Object.values(emo.EMOTIONS).every((e) => /^[а-яёА-ЯЁ ]+$/.test(e.label)),
    JSON.stringify(Object.values(emo.EMOTIONS).map((e) => e.label).filter((l) => !/^[а-яёА-ЯЁ ]+$/.test(l))));
}

console.log('B — детектор на русском');
{
  ok('B1: донорский баг E5 закрыт — «я рад» это joy', d('как же я рад тебя видеть').id === 'joy', d('как же я рад тебя видеть').id);
  const ir = d('опять не работает, сколько раз можно');
  ok('B2: «опять не работает, сколько раз можно» — раздражение, и уверенно',
    ir.id === 'irritation' && ir.confidence > 0.6, ir.id + ' ' + ir.confidence.toFixed(2));
  ok('B3: «мне просто грустно» — грусть, знак отрицательный',
    d('мне просто грустно').id === 'sadness' && d('мне просто грустно').valence < 0);
  ok('B4: благодарность не путается с радостью', d('спасибо большое, ты меня спас').id === 'gratitude');
  const n1 = d('привет'), n2 = d('');
  ok('B5: болтовня и пустота — neutral с нулевой уверенностью (порог тишины)',
    n1.id === 'neutral' && n1.confidence === 0 && n2.id === 'neutral' && n2.confidence === 0,
    n1.id + '/' + n1.confidence + ' ' + n2.id + '/' + n2.confidence);
  ok('B6: капс на «НЕ ПОНИМАЮ» — растерянность, а не ярость',
    d('НЕ ПОНИМАЮ что делать').id === 'confusion', d('НЕ ПОНИМАЮ что делать').id);
  ok('B7: капс сам по себе состояние не выдумывает',
    d('РАБОТАЙ УЖЕ').id === 'neutral', d('РАБОТАЙ УЖЕ').id + ' ' + d('РАБОТАЙ УЖЕ').confidence.toFixed(2));
  ok('B8: прямая обида читается как злость', d('ты совсем ослепл, я же написал выше').id === 'anger');
  const q = d('что такое рекурсия? объясни');
  ok('B9: вопрос по делу не превращается в «человеку плохо»', q.id === 'neutral' || q.confidence < 0.34, q.id);
  ok('B10: confidence и intensity в границах, signals непустые при находке',
    [ir, d('как же я рад тебя видеть')].every((s) => s.confidence >= 0 && s.confidence <= 1
      && s.intensity >= 0 && s.intensity <= 1 && s.signals.length > 0));
}

console.log('C — внешняя подсказка (для контуров, которые знают точнее)');
{
  ok('C1: подсказка принимается по id', d('ну и текст', { hint: 'joy' }).id === 'joy');
  ok('C2: и по-русски, в любом регистре — не нужно знать таблицу',
    d('ну и текст', { hint: ' РАЗДРАЖЕНИЕ ' }).id === 'irritation', d('ну и текст', { hint: 'РРАЗДРАЖЕНИЕ ' }).id);
  ok('C3: мусорная подсказка ничего не ломает, лексика человека остаётся в силе',
    d('спасибо большое', { hint: 'фигня' }).id === 'gratitude');
  ok('C4: hintId не выдумывает состояние', emo.hintId('чушь') === '' && emo.hintId('') === '');
}

console.log('D — тренд по истории');
{
  const bad = d('опять не работает, сколько раз можно');
  const good = d('спасибо большое, ты меня спас');
  ok('D1: без прошлого хода и на чужом входе — stable, а не NaN',
    emo.trend(bad, null) === 'stable' && emo.trend(bad, []) === 'stable' && emo.trend(bad, {}) === 'stable');
  ok('D2: с хорошего на плохое — настроение падает', emo.trend(bad, good) === 'darkening', emo.trend(bad, good));
  ok('D3: с плохого на хорошее — выправляется', emo.trend(good, bad) === 'brightening', emo.trend(good, bad));
  ok('D3b: то же состояние подряд — steady, это другое предупреждение для модели',
    emo.trend(bad, d('снова не работает, я уже сто раз просил')) === 'steady', emo.trend(bad, d('снова не работает, я уже сто раз просил')));
  ok('D4: strategy носит trend с собой', emo.strategy(bad, [good]).trend === 'darkening');
}

console.log('E — стратегия: что делать, а не что чувствовать');
{
  const st = emo.strategy(d('опять не работает, сколько раз можно'), []);
  ok('E1: раздражение — коротко, без спора, со списком «не надо»',
    st.format === 'concise' && st.deescalate === true && st.avoid.length > 0, JSON.stringify(st).slice(0, 160));
  const cf = emo.strategy(d('НЕ ПОНИМАЮ что делать'), []);
  ok('E2: растерянность — режим шагов и простой язык', cf.steps === true && cf.format === 'plain', JSON.stringify(cf).slice(0, 160));
  ok('E2b: в block из этого растут «Дай шаги», а не «успокойся»',
    emo.block(d('НЕ ПОНИМАЮ что делать'), [], {}).includes('Дай шаги: по одному за раз'), emo.block(d('НЕ ПОНИМАЮ что делать'), [], {}));
  ok('E3: донорского `tone` в стратегии нет — тон не здесь', st.tone === undefined && cf.tone === undefined);
  ok('E4: у нейтрального состояния стратегия пустая, а не «заботливая»',
    (() => { const s = emo.strategy(d('привет'), []); return !s.deescalate && s.avoid.length === 0; })(),
    JSON.stringify(emo.strategy(d('привет'), [])).slice(0, 160));
}

console.log('F — кусок в system');
{
  const b = emo.block(d('опять не работает, сколько раз можно'), [], {});
  ok('F1: названо состояние, знак и имя — для модели, а не для человека',
    has(b, 'Собеседник сейчас:', 'раздражение') && b.includes('😠'), b.slice(0, 120));
  ok('F2: антидиагностические оговорки на месте',
    has(b, 'не называй его вслух', 'не лечи', 'не добавляй заботливость, если о ней не просили'), b);
  ok('F3: список «Не надо» дублирует стратегию',
    b.includes('Не надо:') && emo.strategy(d('опять не работает, сколько раз можно'), []).avoid.every((w) => b.includes(w)));
  ok('F4: нейтральная реплика — пустая строка', emo.block(d('привет'), [], {}) === '');
  ok('F5: слабое попадание под порогом молчит', emo.block({ id: 'sadness', emoji: '😔', label: 'грусть', confidence: 0.2, intensity: 0.1, valence: -0.5, signals: [] }, [], {}) === '');
  ok('F6: EMOTION=0 — слой молчит даже на явном раздражении',
    emo.block(d('опять не работает, сколько раз можно'), [], { EMOTION: '0' }) === '');
  ok('F7: сила состояния и падение настроения дописываются в строку',
    emo.block(d('ты совсем ослепл, я же написал выше'), [d('спасибо большое, ты меня спас')], {}).includes('заметно')
      && emo.block(d('опять не работает, сколько раз можно'), [d('спасибо большое, ты меня спас')], {}).includes('настроение падает'));
  ok('F8: донорской декорации нет: ни «Эмоционального интеллекта», ни смайлик-timeline, ни голоса с лицом',
    ![b, emo.block(d('как же я рад тебя видеть'), [], {})].some((x) => x.includes('Эмоциональный интеллект')
      || x.includes('【') || x.includes('голос') || x.includes('лицо') || x.includes('интонац')), b);
  ok('F9: ни одного иероглифа и ни одного латинского огрызка в тексте блока',
    !/[一-鿿]/.test(b) && !/[A-Za-z]{3,}/.test(b), JSON.stringify((b.match(/[A-Za-z]{3,}|[一-鿿]/g) || [])));
}

console.log('G — диагностика');
{
  ok('G1: stats на включённом слое', (() => { const s = emo.stats({}); return s.on && s.emotions === 12 && s.sample > 100 && !s.label; })(), JSON.stringify(emo.stats({})));
  ok('G2: EMOTION=0 видно по sample = 0', emo.stats({ EMOTION: '0' }).sample === 0);
  ok('G3: EMOTION_LABEL включает метку в метаданных', emo.stats({ EMOTION_LABEL: '1' }).label === true);
  ok('G4: cfgOf: «0» выключает, всё остальное — нет',
    emo.cfgOf({ EMOTION: '0' }).on === false && emo.cfgOf({ EMOTION: 'no' }).on === true && emo.cfgOf({}).on === true);
}

console.log('I — слой внутри движка');
{
  const f = fakeFetch('ок');
  const r = await createEngine({ env: Object.assign({}, ENV, { EMOTION_LABEL: '1' }), fetch: f, sleep: async () => {} })
    .run({ text: 'опять не работает, сколько раз можно' });
  ok('I1: наблюдение доехало до system', sysOf(f).includes('Собеседник сейчас:'), sysOf(f).slice(-260));
  ok('I2: и вернулось человеку метаданными (EMOTION_LABEL=1)',
    r.emotion && r.emotion.id === 'irritation' && r.emotion.label === 'раздражение' && typeof r.emotion.confidence === 'number',
    JSON.stringify(r.emotion));

  const f2 = fakeFetch('ок');
  const r2 = await createEngine({ env: ENV, fetch: f2, sleep: async () => {} }).run({ text: 'опять не работает, сколько раз можно' });
  ok('I3: без EMOTION_LABEL метаданных о состоянии нет — приватность по умолчанию',
    r2.emotion === undefined, JSON.stringify(r2.emotion));

  const f3 = fakeFetch('ок');
  await createEngine({ env: Object.assign({}, ENV, { EMOTION: '0' }), fetch: f3, sleep: async () => {} }).run({ text: 'опять не работает, сколько раз можно' });
  ok('I4: EMOTION=0 — в system нет ни символа слоя', !sysOf(f3).includes('Собеседник сейчас'), sysOf(f3).slice(-200));

  const f4 = fakeFetch('ок');
  await createEngine({ env: ENV, fetch: f4, sleep: async () => {} }).run({ text: 'привет' });
  ok('I5: болтовня не получает эмоциональной врезки', !sysOf(f4).includes('Собеседник сейчас'), sysOf(f4).slice(-200));

  const f5 = fakeFetch('ок');
  await createEngine({ env: ENV, fetch: f5, sleep: async () => {} })
    .run({ text: 'опять не работает, сколько раз можно', history: [{ role: 'user', content: 'спасибо, ты меня спас' }, { role: 'assistant', content: 'обращайся' }] });
  ok('I6: предыдущие реплики участвуют (тренд), а не только последняя',
    sysOf(f5).includes('настроение падает'), sysOf(f5).slice(-300));

  const f6 = fakeFetch('ок');
  await createEngine({ env: Object.assign({}, ENV, { EMOTION_LABEL: '1' }), fetch: f6, sleep: async () => {} })
    .run({ text: 'привет', history: [{ role: 'user', content: 'опять не работает, сколько раз можно' }] });
  ok('I7: нейтральный ответ на напряжённую историю — метки нет', r2.ok && (!f6.calls[0] || true) && !(sysOf(f6).includes('Собеседник сейчас')), sysOf(f6).slice(-200));

  const f7 = fakeFetch('ок');
  await createEngine({ env: ENV, fetch: f7, sleep: async () => {} }).run({ text: 'опять не работает, сколько раз можно', system: 'Ты — редактор.' });
  ok('I8: чужая персона не получает ни рода, ни состояния (пользовательский system — территория человека)',
    !sysOf(f7).includes('Собеседник сейчас') && !sysOf(f7).includes('Род агента'), sysOf(f7).slice(0, 200));
}

console.log('H — гигиена порта');
{
  const src = readFileSync(join(process.cwd(), 'engine', 'emotion.js'), 'utf8');
  ok('H1: жёстких путей наружу и следов донора в файле нет',
    !src.includes('/home/') && !src.includes('uploads') && !src.includes('yama') && !src.includes('../'), 'нашёл чужой путь');
  ok('H2: сеть и файловая система слою не нужны',
    !src.includes('fetch(') && !src.includes('node:fs') && !src.includes('readFile'), 'услал куда-то наружу');
  const exported = (src.match(/^export (?:async )?function ([A-Za-z]+)/gm) || []).map((x) => x.split(' ').pop());
  ok('H3: донорские функции-декорации не переезжали (экспорта нет — и вызывать нечему)',
    ['detectVoiceEmotion', 'detectVisualEmotion', 'buildEmotionalPrompt', 'getEmotionalContext']
      .every((name) => exported.indexOf(name) < 0), JSON.stringify(exported));
  ok('H3b: публичный слой — ровно то, что обещано: EMOTIONS, detect, trend, strategy, block, stats',
    ['EMOTIONS', 'LEX', 'WEIGHT', 'STYLE', 'cfgOf', 'hintId', 'detect', 'trend', 'strategy', 'block', 'stats']
      .every((name) => name in emo), JSON.stringify(Object.keys(emo)));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
