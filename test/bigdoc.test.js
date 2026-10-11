/**
 * Большой документ в движке (0.161): файл, который не влезает в окно, читается по
 * частям, выписки доезжают до итогового ответа, маленький файл идёт целиком, а
 * вопрос по файлу из прошлой реплики находит выписки в памяти чата.
 * Сети нет: fetch подставлен, проверяются решения движка.
 * Запуск: node test/bigdoc.test.js
 */
import { createEngine } from '../engine/chat.js';
import { createMemory } from '../engine/memory.js';
import { buildTable } from '../engine/providers.js';
import * as longdoc from '../engine/longdoc.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 240) : '')); }
}

const ENV = { GROQ_KEYS: 'g1', GEMINI_KEYS: 'gm1', OPENROUTER_KEYS: 'o1', COUNCIL_BUDGET: '0' };

/** Ответ в форме того провайдера, куда позвали: gemini читает candidates, прочие — choices. */
const shaped = (url, text) => (/generativelanguage/.test(String(url))
  ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
  : { choices: [{ message: { content: text }, finish_reason: 'stop' }] });

function fakeFetch(onAsk) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(String(init.body));
    /* Текст запроса: у gemini он в contents.parts, у openai-подобных — в messages. */
    let sent = '';
    if (Array.isArray(body.contents)) {
      sent = (body.contents || []).map((c) => ((c.parts || []).map((p) => p.text || '').join('\n'))).join('\n');
    } else if (Array.isArray(body.messages)) {
      sent = (body.messages || []).map((m) => String(m.content || '')).join('\n');
    }
    calls.push({ url: String(url), sent, body, system: String(body.systemInstruction || (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('') || '') });
    return { status: 200, text: async () => JSON.stringify(shaped(url, onAsk(sent, calls.length - 1, url))) };
  };
  impl.calls = calls;
  return impl;
}

const eng = (script, extra) => createEngine(Object.assign(
  { env: ENV, fetch: script ? fakeFetch(script) : undefined, sleep: async () => {} }, extra || {}));

/* Документ как от читалки: разделы и одна важная фраза глубоко в середине. */
const FILLER = 'Общие условия сделки, порядок согласования заявок, ответственность сторон. ';
const docText = (keysent) => Array.from({ length: 40 }, (_, i) => 'Раздел ' + (i + 1) + '. ' + FILLER.repeat(12)).join('\n\n')
  .replace('Раздел 12. ', 'Раздел 12. ' + keysent + ' ');

console.log('\nD — большой документ: читаем по частям, а не отрезаем');

{
  const KEYSENT = 'Пункт 7.3: срок оплаты — 42 календарных дня с даты приёмки.';
  const body = docText(KEYSENT);
  ok('D1: документ для проверки действительно большой', body.length > 30000, String(body.length));
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent)
    ? 'Выписка: ' + (/42 календарных дня/.test(sent) ? KEYSENT : 'по вопросу ничего нет')
    : 'Ответ по документу: срок оплаты 42 дня.'));
  const e = eng(null, { fetch: f });
  const r = await e.run({ text: 'какой срок оплаты по договору?', docs: [{ name: 'договор.pdf', line: 'pdf · 90 000 симв.', text: body }] });

  const mapCalls = f.calls.filter((c) => /--- начало фрагмента ---/.test(c.sent));
  const finalCall = f.calls[f.calls.length - 1];
  ok('D2: файл прочитан по частям — на каждую часть свой вызов',
    r.ok === true && mapCalls.length >= 2, JSON.stringify({ calls: f.calls.length, map: mapCalls.length }));
  ok('D3: в итоговый запрос ушли выписки, а не весь документ',
    /прочитан по частям/.test(finalCall.sent) && finalCall.sent.indexOf('42 календарных дня') >= 0
      && finalCall.sent.length < body.length, JSON.stringify({ final: finalCall.sent.length, doc: body.length }));
  ok('D4: в шапке выписок честно сказано, сколько частей из скольких',
    /\[Файл: договор\.pdf · pdf · 90 000 симв\., прочитан по частям: \d+ из \d+\]/.test(finalCall.sent),
    (finalCall.sent.match(/\[Файл:[^\]]*\]/) || [''])[0]);
  ok('D5: человеку под ответом сказано, как файл прочитан — без отчётного шума',
    Array.isArray(r.docs) && r.docs.length === 1 && /прочитан по частям \(\d+ из \d+\)/.test(r.docs[0].line)
      && r.reply === 'Ответ по документу: срок оплаты 42 дня.',
    JSON.stringify(r.docs));
}

{
  const small = 'Небольшой файл: заказ №14, сумма 1 200 руб., срок — 3 дня.';
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent) ? 'Выписка' : 'Ок, прочитал.'));
  const e = eng(null, { fetch: f });
  const r = await e.run({ text: 'что в файле?', docs: [{ name: 'заказ.txt', line: 'txt · 60 симв.', text: small }] });
  ok('D6: маленький файл идёт целиком и по частям не читается',
    f.calls.length === 1 && f.calls[0].sent.indexOf(small) >= 0 && r.ok === true,
    JSON.stringify({ calls: f.calls.length, has: f.calls[0].sent.indexOf(small) >= 0 }));
  ok('D7: про целиком прочитанный файл «по частям» не пишем',
    !/по частям/.test(String(r.docs && r.docs[0] && r.docs[0].line)), JSON.stringify(r.docs));
}

{
  /* Модель на части не отвечает вовсе (отказ/лимит): файл не теряется — ищем по
     вопросу сами, и человек об этом узнаёт строкой «по частям», а не молчанием. */
  const KEYSENT = 'Пункт 7.3: срок оплаты — 42 календарных дня.';
  const body = docText(KEYSENT);
  const f = fakeFetch((sent) => {
    if (/--- начало фрагмента ---/.test(sent)) throw new Error('провайдер молчит');
    return 'Отвечаю по найденному месту.';
  });
  const e = eng(null, { fetch: f });
  const r = await e.run({ text: 'какой срок оплаты?', docs: [{ name: 'договор.pdf', line: 'pdf · 90 000 симв.', text: body }] });
  const finalCall = f.calls[f.calls.length - 1];
  ok('D8: модель не ответила по частям — нужное место найдено самим и попало в ответ',
    r.ok === true && finalCall.sent.indexOf('42 календарных дня') >= 0,
    JSON.stringify({ final: finalCall.sent.length, key: finalCall.sent.indexOf('42 календарных дня') }));
}

{
  /* Окно оператора узкое (2 000 токенов): части должны ужиматься под него, а не
     резаться потом общей подгонкой — иначе выписки уедут в «историю урезал». */
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent) ? 'Выписка по фрагменту' : 'Готово.'));
  const e = eng(null, { fetch: f });
  const r = await e.run({
    text: 'кратко: что в файле?', docs: [{ name: 'отчёт.txt', line: 'txt · 90 000 симв.', text: docText('Пункт 7.3: 42 дня.') }],
  }, {});
  ok('D9: ответ есть и он не «время вышло»', r.ok === true, JSON.stringify({ err: r.error, calls: f.calls.length }));
}

{
  /* Память чата: файл прислали в прошлой реплике, вопрос про него — в следующей.
     Без записи в памяти модель отвечала бы по догадке. */
  const store = new Map();
  const memStore = {
    get: async (k) => (store.has(k) ? { value: store.get(k) } : null),
    put: async (k, v) => { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
  };
  const env2 = Object.assign({}, ENV, { MEMORY: '1' });
  const memory = createMemory({ store: memStore, env: env2 });
  const KEYSENT = 'Пункт 7.3: срок оплаты — 42 календарных дня с даты приёмки.';
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent)
    ? (/42 календарных дня/.test(sent) ? KEYSENT : 'нет')
    : 'Ответ.'));
  const e = createEngine({ env: env2, fetch: f, sleep: async () => {}, memory, memoryChatId: 'u-test' });
  const r1 = await e.run({ text: 'прочитай договор', chatId: 'u-test', docs: [{ name: 'договор.pdf', line: 'pdf · 90 000 симв.', text: docText(KEYSENT) }] });
  ok('D10: первый ход с файлом отвечен', r1.ok === true, JSON.stringify({ err: r1.error }));
  await memory.flush();
  const saved = await memory.docFor('u-test');
  ok('D11: выписки по файлу остались в памяти чата', !!saved && saved.block.length > 100 && saved.name === 'договор.pdf',
    JSON.stringify(saved && { name: saved.name, chars: saved.block.length, parts: saved.parts }));
  const before = f.calls.length;
  const r2 = await e.run({ text: 'а что там в пункте 7.3?', chatId: 'u-test' });
  const lastCall = f.calls[f.calls.length - 1];
  ok('D12: следующая реплика про файл находит выписки — модель отвечает по ним, а не по памяти',
    r2.ok === true && lastCall.sent.indexOf('Ранее приложенный файл') >= 0
      && lastCall.sent.indexOf('42 календарных дня') >= 0 && f.calls.length > before,
    JSON.stringify({ found: lastCall.sent.indexOf('Ранее приложенный файл') }));
  const third = await e.run({ text: 'сколько будет 2+2?', chatId: 'u-test' });
  const call3 = f.calls[f.calls.length - 1];
  ok('D13: вопрос не про файл выписки не тащит (окно не жжём каждый ход)',
    third.ok === true && call3.sent.indexOf('Ранее приложенный файл') < 0,
    JSON.stringify({ has: call3.sent.indexOf('Ранее приложенный файл') }));
}

{
  /* Пин модели: человек выбрал голову сам. Файл обязан читаться так же — иначе
     «выбрал модель» тихо ломало бы большие документы. */
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent) ? 'Выписка' : 'Ответ по выпискам.'));
  const e = eng(null, { fetch: f });
  const r = await e.run({
    text: 'что по договору?', model: 'llama-3.3-70b-versatile',
    docs: [{ name: 'договор.pdf', line: 'pdf · 90 000 симв.', text: docText('Пункт 7.3: 42 дня.') }],
  });
  ok('D14: пин модели большой файл не ломает (носовых вызовов на части ≥ 2)',
    r.ok === true && f.calls.filter((c) => /--- начало фрагмента ---/.test(c.sent)).length >= 2,
    JSON.stringify({ calls: f.calls.length }));
}

{
  /* Гигантский файл: частей больше потолка — читаем самые нужные, а не двести раз
     по абзацу. Это про квоту: каждый вызов части — живой запрос к бесплатной голове. */
  const huge = docText('Пункт 7.3: 42 дня.') + docText('');
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent) ? 'Выписка' : 'Ответ.'));
  const e = eng(null, { fetch: f });
  const r = await e.run({ text: 'срок оплаты?', docs: [{ name: 'том.pdf', line: 'pdf · 200 000 симв.', text: huge }] });
  const mapCalls = f.calls.filter((c) => /--- начало фрагмента ---/.test(c.sent));
  ok('D15: частей больше потолка — читаем не больше восьми (квота бесплатных ключей)',
    r.ok === true && mapCalls.length <= longdoc.MAX_PARTS && /из \d+/.test(r.docs[0].line),
    JSON.stringify({ map: mapCalls.length, line: String(r.docs[0].line).slice(0, 80) }));
}
{
  /* Совет голов: файл голове виден, но своими вызовами она его НЕ перечитывает —
     иначе три головы читают документ заново и жгут квоту. */
  const f = fakeFetch((sent) => (/--- начало фрагмента ---/.test(sent) ? 'Выписка' : 'Ответ.'));
  const e = eng(null, { fetch: f });
  await e.run({ text: 'что в договоре?', docsMap: false, docs: [{ name: 'договор.pdf', line: 'pdf · 90 000 симв.', text: docText('Пункт 7.3: 42 дня.') }] });
  ok('D16: при docsMap=false модель на части не зовут — файл виден, вызовов нет',
    f.calls.filter((c) => /--- начало фрагмента ---/.test(c.sent)).length === 0 && f.calls.length === 1,
    JSON.stringify({ calls: f.calls.length }));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
