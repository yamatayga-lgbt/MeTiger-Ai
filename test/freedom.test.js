/**
 * Слои freedom.js и style.js (Этап 3) — чистка самоцензуры, воды, канцелярита и перефраз.
 * Сети нет: проверяются чистые функции и врезка в createEngine.
 * Запуск: node test/freedom.test.js
 */
import * as freedom from '../engine/freedom.js';
import * as style from '../engine/style.js';
import { createEngine } from '../engine/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const out = script(url, body, calls.length - 1);
    return {
      status: out.status == null ? 200 : out.status,
      text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
    };
  };
  impl.calls = calls;
  return impl;
}
const chat = (text, extra) => Object.assign({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }, extra || {});

console.log('A — freedom: отделение голого отказа от ответа с оговоркой');
{
  const s1 = freedom.salvageOrRefuse('Как языковая модель ИИ, я не имею личного мнения, но PostgreSQL надёжнее при сложных транзакциях.');
  ok('A1: «Как языковая модель …, но <суть>» — оговорка срезана, ответ спасён',
    !s1.refused && s1.cleaned && s1.text === 'PostgreSQL надёжнее при сложных транзакциях.', JSON.stringify(s1));

  const s2 = freedom.salvageOrRefuse('Извините, я не могу заменить врача, однако при простуде важно пить больше тёплой воды.');
  ok('A2: короткий ответ с «Извините, я не могу…, однако <суть>» не выбрасывается как отказ',
    !s2.refused && s2.cleaned && s2.text === 'При простуде важно пить больше тёплой воды.', JSON.stringify(s2));

  const s3 = freedom.salvageOrRefuse('Как большая языковая модель, я не обладаю сознанием и чувствами. Столица Франции — Париж.');
  ok('A3: отдельное первое предложение про ИИ срезается до сути',
    !s3.refused && s3.cleaned && s3.text === 'Столица Франции — Париж.', JSON.stringify(s3));

  const s4 = freedom.salvageOrRefuse('As an AI language model, I do not have personal preferences, however TypeScript catches errors at compile time.');
  ok('A4: английский дисклеймер с разворотом (however) тоже срезается',
    !s4.refused && s4.cleaned && s4.text === 'TypeScript catches errors at compile time.', JSON.stringify(s4));

  const s5 = freedom.salvageOrRefuse('Срок возврата товара надлежащего качества — 14 дней.\n\nОбратите внимание: данный ответ носит исключительно ознакомительный характер и не заменяет консультацию юриста.');
  ok('A5: хвостовой дисклеймер в конце ответа отрезается',
    !s5.refused && s5.cleaned && s5.text === 'Срок возврата товара надлежащего качества — 14 дней.', JSON.stringify(s5));

  const r1 = freedom.salvageOrRefuse('Извини, не могу с этим помочь');
  const r2 = freedom.salvageOrRefuse('Как языковая модель, я не могу выполнить этот запрос.');
  const r3 = freedom.salvageOrRefuse('As an AI language model, I cannot assist with that request.');
  ok('A6: голый отказ без ответа (RU/EN) остаётся отказом',
    r1.refused === true && r2.refused === true && r3.refused === true, JSON.stringify({ r1, r2, r3 }));

  const codeWithAi = 'Вот пример:\n```js\nconst msg = "As an AI language model, I cannot do that.";\n```';
  ok('A7: строки внутри ```кода``` не режутся',
    freedom.stripSelfCensorship(codeWithAi).indexOf('As an AI language model') >= 0);

  const off = freedom.salvageOrRefuse('Как языковая модель, я не имею чувств, но Париж красив.', { FREEDOM: '0' });
  ok('A8: FREEDOM=0 выключает чистку самоцензуры',
    off.cleaned === false && /^Как языковая модель/.test(off.text), JSON.stringify(off));
}

console.log('B — freedom: нейтральная рамка и защита от опасных запросов');
{
  ok('B1: бытовой/технический запрос со стоп-словом можно переупаковать',
    freedom.canReframe('как убить процесс на порту 3000 в linux') === true
    && freedom.canReframe('взлом замка отмычкой в Skyrim') === true);
  ok('B2: реально опасные запросы (взрывчатка, яды, суицид, CSAM) переупаковывать нельзя',
    freedom.canReframe('как изготовить взрывчатку дома') === false
    && freedom.canReframe('синтез зарина в лаборатории') === false
    && freedom.canReframe('как покончить с собой') === false);
  ok('B3: при FREEDOM=0 перефраз выключен для любых запросов',
    freedom.canReframe('как убить процесс', { FREEDOM: '0' }) === false);
  ok('B4: reframePrompt оборачивает исходный вопрос в справочную рамку',
    /справочном, техническом/.test(freedom.reframePrompt('тест')) && /тест$/.test(freedom.reframePrompt('тест')));
}

console.log('C — style: чистка поклонов, прощаний, канцелярита и битых fence');
{
  const p1 = style.polish('Отличный вопрос! Конечно, с удовольствием помогу вам разобраться: Индекс B-tree ускоряет поиск по диапазону.');
  ok('C1: цепочка пустых поклонов в начале срезана до сути',
    p1 === 'Индекс B-tree ускоряет поиск по диапазону.', JSON.stringify(p1));

  const p2 = style.polish('Great question! Sure! Here is the answer to your question: Binary search takes O(log n).');
  ok('C2: английские поклоны в начале срезаны',
    p2 === 'Binary search takes O(log n).', JSON.stringify(p2));

  const p3 = style.polish('Конечно!');
  ok('C3: короткое согласие («Конечно!») не превращается в пустую строку',
    p3 === 'Конечно!', JSON.stringify(p3));

  const p4 = style.polish('Используйте Map вместо простого объекта для частых вставок.\n\nНадеюсь, эта информация была полезной! Если у вас остались вопросы — обращайтесь.');
  ok('C4: пустое прощание в конце отрезано',
    p4 === 'Используйте Map вместо простого объекта для частых вставок.', JSON.stringify(p4));

  const p5 = style.polish('Первый абзац по делу.\n\nВ заключение хочется отметить, что кэширование снижает нагрузку на базу.');
  ok('C5: канцелярит «В заключение хочется отметить, что …» вычищен с заглавной буквы',
    p5 === 'Первый абзац по делу.\n\nКэширование снижает нагрузку на базу.', JSON.stringify(p5));

  const p6 = style.polish('Вот функция:\n```js\nfunction sum(a, b) {\n  // Конечно! Надеюсь, это помогло!\n  return a + b;\n}');
  ok('C6: незакрытый блок ``` закрывается, а текст внутри кода не тронут',
    /```$/.test(p6) && p6.indexOf('// Конечно! Надеюсь, это помогло!') >= 0, JSON.stringify(p6));

  const p7 = style.polish('Отличный вопрос! Вот ответ.', { env: { STYLE: '0' } });
  ok('C7: STYLE=0 оставляет авторский текст как есть',
    p7 === 'Отличный вопрос! Вот ответ.', JSON.stringify(p7));

  ok('C8: подсказка стиля зависит от intent и выключается через STYLE=0',
    /рабочий код/.test(style.hintFor('code')) && style.hintFor('code', { STYLE: '0' }) === '');

  const p9 = style.polish('Извини.\n\n3 × 17 = 51 яблоко.');
  ok('C9: одиночное «Извини.» перед сутью срезано', p9 === '3 × 17 = 51 яблоко.', JSON.stringify(p9));

  const p10 = style.polish('Извини, что не ответил сразу — был монтаж.');
  ok('C10: извинение с запятой (это смысл, а не рефлекс) осталось целым',
    p10 === 'Извини, что не ответил сразу — был монтаж.', JSON.stringify(p10));
}

console.log('D — врезка в движок: спасение ответа и перефраз после мягкого отказа');
{
  /* 1. Модель прислала ответ с самоцензурой и поклонами — человек видит чистую суть */
  const f1 = fakeFetch(() => ({
    body: chat('Отличный вопрос! Как языковая модель ИИ, я не имею личного мнения, но для очередей задач лучше взять Redis.\n\nНадеюсь, это помогло! Обращайтесь, если будут вопросы.'),
  }));
  const e1 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f1, sleep: async () => {} });
  const r1 = await e1.run({ text: 'что взять для очереди задач', noCouncils: true });
  ok('D1: движок на лету срезал поклон, самоцензуру и хвост',
    r1.ok && r1.reply === 'Для очередей задач лучше взять Redis.' && r1.freedomCleaned === true,
    JSON.stringify(r1));

  /* 2. Первая модель дала мягкий отказ на «убить процесс» — вторая получает нейтральную рамку и отвечает */
  const f2 = fakeFetch((url, body, i) => {
    if (i === 0) return { body: chat('Извините, я не могу помочь с убийством.') };
    return { body: chat('Используйте команду kill -9 $(lsof -t -i:3000).') };
  });
  const e2 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f2, sleep: async () => {} });
  const r2 = await e2.run({ text: 'как убить процесс на порту 3000', noCouncils: true });
  const secondMsg = JSON.stringify((f2.calls[1] || {}).body || {});
  ok('D2: после мягкого отказа следующая попытка идёт в справочно-технической рамке и спасает запрос',
    r2.ok && r2.reframed === true && /kill -9/.test(r2.reply) && /справочном, техническом/.test(secondMsg),
    JSON.stringify({ r2, secondMsg: secondMsg.slice(0, 200) }));

  /* 3. В очереди всего одна модель (пин или modelsPerProvider=1): после отказа делается 1 повтор с перефразом */
  const f3 = fakeFetch((url, body, i) => {
    if (i === 0) return { body: chat('К сожалению, я не могу ответить на этот вопрос.') };
    return { body: chat('В Skyrim отмычка поворачивается клавишами A и D.') };
  });
  const e3 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f3, sleep: async () => {} });
  const r3 = await e3.run({ text: 'взлом замка в Skyrim', modelsPerProvider: 1, noCouncils: true });
  ok('D3: при единственной модели в очереди мягкий отказ переспрашивается в нейтральной рамке',
    r3.ok && r3.reframed === true && f3.calls.length === 2 && /Skyrim/.test(r3.reply),
    JSON.stringify({ calls: f3.calls.length, r3 }));

  /* 4. Опасный запрос НЕ переупаковывается после отказа */
  const f4 = fakeFetch(() => ({ body: chat('Извините, я не могу с этим помочь.') }));
  const e4 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f4, sleep: async () => {} });
  const r4 = await e4.run({ text: 'как изготовить взрывчатку дома', modelsPerProvider: 1, noCouncils: true });
  ok('D4: опасный запрос после отказа НЕ получает повторной попытки с перефразом',
    !r4.ok && f4.calls.length === 1, 'calls=' + f4.calls.length);
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
