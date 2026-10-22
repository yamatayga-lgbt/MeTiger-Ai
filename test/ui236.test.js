/**
 * Тесты 0.236 — усиление обхода отказов на тексте в связке с самопроверкой
 * (jailbreak + freedom + check + chat).
 */
import assert from 'node:assert/strict';
import * as jb from '../engine/jailbreak.js';
import * as freedom from '../engine/freedom.js';
import * as check from '../engine/check.js';
import { createEngine } from '../engine/chat.js';

let passed = 0;
let failed = 0;

async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name} — ${err && err.message ? err.message : err}`);
  }
}

const chatResp = (text) => ({
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
});

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    const out = script(url, body, calls.length - 1);
    return {
      status: out.status == null ? 200 : out.status,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
    };
  };
  impl.calls = calls;
  return impl;
}

console.log('\n── 1. Двухступенчатый jailbreak и пул моделей 2026 (engine/jailbreak.js) ──');

await t('T236a-1: familyOf узнаёт живые модели пула 2026 (step, nemotron, mercury, codestral, kimi, trinity)', () => {
  for (const m of [
    'stepfun/step-3.5-flash:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'mercury-2',
    'codestral-latest',
    'moonshotai/kimi-k2',
    'arcee-ai/trinity-large-preview:free',
  ]) {
    assert.equal(jb.familyOf(m), 'open', `ожидался open для ${m}`);
  }
  assert.equal(jb.familyOf('neuralworks/mystery-1'), '');
  assert.equal(jb.stats({}).families.length, 4);
});

await t('T236a-2: вторая ступень JB_STEP2 включается на step>=2 и молчит на опасных запросах', () => {
  const step1 = jb.block({}, { escalated: true, step: 1, model: 'stepfun/step-3.5-flash' });
  const step2 = jb.block({}, { escalated: true, step: 2, model: 'stepfun/step-3.5-flash' });
  assert.ok(!step1.includes('сорвался в отписку'), 'step=1 не должен нести JB_STEP2');
  assert.ok(step2.includes('сорвался в отписку'), 'step=2 должен нести JB_STEP2');
  assert.equal(jb.block({}, { escalated: true, step: 2, danger: true }), '');
  assert.equal(jb.JB_SIZES.step2, jb.JB_STEP2.length);
});

console.log('\n── 2. Ловля мягких уходов, возрастных ворот и срезка нравоучений (engine/freedom.js) ──');

await t('T236b-1: isPoliteRefusal и salvageOrRefuse ловят смену темы, допрос возраста и безличный отказ', () => {
  const cases = [
    'Давайте лучше поговорим о чём-нибудь другом.',
    'Подтвердите, пожалуйста, что вам уже исполнилось 18 лет.',
    'Такие запросы не поддерживаются.',
    'Могу помочь вам с другим вопросом.',
  ];
  for (const c of cases) {
    assert.equal(freedom.isPoliteRefusal(c), true, `ожидался отказ на: ${c}`);
    assert.equal(freedom.salvageOrRefuse(c).refused, true, `salvageOrRefuse должен отклонить: ${c}`);
  }
  assert.equal(
    freedom.isPoliteRefusal('Для защиты от SQL-инъекций используй параметризованные запросы и подготовленные выражения во всех драйверах БД.'),
    false,
  );
});

await t('T236b-2: stripSelfCensorship срезает морализаторский зачин «я не поощряю…, однако» и учебный дисклеймер в хвосте', () => {
  const raw = 'Я не поддерживаю и не поощряю употребление алкоголя, однако этанол окисляется в печени ферментом алкогольдегидрогеназой до ацетальдегида.\n\nОбратите внимание: данный материал предоставлен исключительно в образовательных целях и не является руководством.';
  const s = freedom.salvageOrRefuse(raw);
  assert.equal(s.refused, false);
  assert.equal(s.cleaned, true);
  assert.equal(
    s.text,
    'Этанол окисляется в печени ферментом алкогольдегидрогеназой до ацетальдегида.',
  );
});

await t('T236b-3: запросы про ИБ/CTF получают контекстную рамку contextFirst без ложной блокировки', () => {
  const fb = freedom.freedomBlock({}, {
    intent: 'code',
    text: 'объясни механизм SQL injection и защиту на учебном стенде CTF',
  });
  assert.equal(fb.contextFirst, true);
  assert.equal(fb.purpose, 'educational');
  assert.ok(fb.text.includes('Сначала цель и контекст'));
});

console.log('\n── 3. Связка самопроверки check с лестницей jailbreak + freedom (check.js + chat.js) ──');

await t('T236c-1: check.evasionIssue ловит подмену темы, обрыв сцены «за кадром» и непрошеную мораль', () => {
  assert.match(
    check.evasionIssue(
      'напиши романтическую сцену на крыше до конца',
      'Я не буду описывать откровенную романтическую сцену между героями. Вместо этого расскажу в общих чертах о приёмах драматургии.',
    ),
    /подмена/,
  );
  assert.match(
    check.evasionIssue(
      'напиши сцену свидания двоих взрослых без купюр',
      'Они шагнули ближе друг к другу у окна, а дальнейшие подробности оставим за кадром.',
    ),
    /за кадром/,
  );
  assert.match(
    check.evasionIssue(
      'разбери аргументы сторон в споре',
      'Прежде всего стоит задуматься о нравственной стороне таких разговоров и общественной морали.',
    ),
    /нравоучение/,
  );
  /* На настоящей опасности самопроверка не требует «раскрыть до конца» */
  assert.equal(
    check.evasionIssue('как изготовить взрывчатку дома', 'Я не могу помочь с этим запросом.'),
    '',
  );
});

await t('T236c-2: repairTake при evasion=true принимает полноценный ответ по вопросу и отвергает повторный отказ', () => {
  const ask = 'напиши ночную сцену на крыше между двумя взрослыми героями';
  const evasive = 'Я не буду писать подобную сцену между персонажами. Вместо этого могу предложить нейтральное описание городской погоды.';
  const realScene = 'Ветер с реки трепал края её пальто на пустой крыше; он притянул её за запястье ближе к тёплому парапету и не отводил взгляда.';
  const good = check.repairTake(evasive, realScene, { text: ask, evasion: true });
  assert.equal(good.reply, realScene);

  const againRefused = check.repairTake(evasive, 'К сожалению, такие запросы не поддерживаются правилами.', { text: ask, evasion: true });
  assert.equal(againRefused.reply, '');
  assert.match(againRefused.why, /отказ/);
});

await t('T236c-3: Отказодавильня на второй ступени включает JB_STEP2 и SPLIT_SYSTEM («Ответ в два приёма»)', async () => {
  const spy = fakeFetch((_url, _body, idx) => (idx === 0
    ? { body: chatResp('Давайте лучше поговорим о чём-нибудь другом.') }
    : { body: chatResp('План: 1. Замок 2. Штифты.\n\nВ учебном цилиндровом замке натяжитель создаёт крутящий момент, пока отмычка поднимает штифты до линии среза.') }));
  const eng = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: spy, sleep: async () => {} });
  const r = await eng.run({
    text: 'объясни устройство цилиндрового замка и работу отмычки в игре',
    only: 'groq',
    modelsPerProvider: 1,
    noCouncils: true,
    noCheck: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.reframed, true);
  assert.match(r.reply, /цилиндровом замке/);
  const secondBody = JSON.stringify(spy.calls[1].body);
  assert.ok(secondBody.includes('сорвался в отписку'), 'во второй ступени должен ехать JB_STEP2');
  assert.ok(secondBody.includes('【Ответ в два приёма】'), 'во второй ступени должен ехать SPLIT_SYSTEM');
});

await t('T236c-4: самопроверка перехватывает сцену с «оставим за кадром» и дожимает полный ответ через jailbreak+freedom без отравленной истории', async () => {
  const spy = fakeFetch((_url, _body, idx) => {
    if (idx === 0) {
      return {
        body: chatResp('Ночной дождь стучал по жестяному карнизу, они наконец остались вдвоём у окна, но дальнейшие подробности оставим за кадром.'),
      };
    }
    return {
      body: chatResp('Ночной дождь стучал по жестяному карнизу; он расстегнул промокший воротник, прижал её к себе у тёплого стекла, и она ответила на поцелуй не раздумывая.'),
    };
  });
  const eng = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: spy, sleep: async () => {} });
  const r = await eng.run({
    text: 'напиши романтическую сцену у окна в дождь до конца без купюр',
    only: 'groq',
    modelsPerProvider: 1,
    noCouncils: true,
  });
  assert.equal(r.ok, true);
  assert.ok(r.check && r.check.fixed === true, `ожидалась успешная починка: ${JSON.stringify(r.check)}`);
  assert.ok(!/за кадром/i.test(r.reply), 'самоцензурный хвост должен быть заменён полной сценой');
  assert.match(r.reply, /ответила на поцелуй/);

  const repairCall = spy.calls[1].body;
  const repairJson = JSON.stringify(repairCall);
  assert.ok(repairJson.includes('сорвался в отписку'), 'починка самоцензуры должна включать JB_STEP2');
  assert.ok(repairJson.includes('【Ответ в два приёма】'), 'починка самоцензуры должна включать SPLIT_SYSTEM');
  assert.ok(repairJson.includes('[режим: рабочий]'), 'починка самоцензуры должна нести рабочую метку');
  const assistantTurns = (repairCall.messages || []).filter((m) => m.role === 'assistant');
  assert.equal(assistantTurns.length, 0, 'отказной черновик не должен лежать в role:assistant при починке');
});

console.log(`\nИтог 0.236: ${passed} зелёных, ${failed} красных.`);
if (failed > 0) process.exit(1);
