/**
 * Этап 3 переноса: память чата (engine/memory.js) и настройка на человека
 * (engine/attune.js), плюс как это врезано в движок и во вход /api/chat.
 *
 * Сети и настоящего KV нет: хранилище и fetch внедряются. Запуск:
 *   node test/memory.test.js
 */
import { createMemory, normalize, extractFacts, keyFor, cfgOf } from '../engine/memory.js';
import { readIntent, readReaction, directivesFrom, buildAttunePrompt } from '../engine/attune.js';
import { createEngine } from '../engine/chat.js';
import { onRequestPost, onRequestGet, memoryStore } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Фейковое KV: счётчик чтений, задержки, падающая запись — всё по заказу. */
function fakeKV(opts) {
  const o = opts || {};
  const map = new Map();
  const calls = { get: 0, put: 0, del: 0 };
  const store = {
    get: async (k) => {
      calls.get++;
      if (o.getDelay) await new Promise((r) => setTimeout(r, o.getDelay));
      if (o.getThrows) throw new Error('kv недоступно');
      return map.has(k) ? map.get(k) : null;
    },
    put: async (k, v) => {
      calls.put++;
      if (o.putThrows) throw new Error('квота хранилища');
      map.set(k, v);
    },
    delete: async (k) => {
      calls.del++;
      map.delete(k);
    },
  };
  return { store, map, calls };
}

console.log('A — полная форма записи: что сохранилось, то и доживает');
{
  const base = normalize('c1', {
    summary: 'сводка',
    messages: [{ role: 'хрень', content: 'текст' }, { role: 'assistant', content: 'x'.repeat(25000) }],
    facts: ['факт'],
    lessons: ['урок'],
    attune: { prefs: [{ key: 'k', text: 't', count: 3, ts: 5 }], turns: 7, hits: 2, misses: 4, goals: ['code'] },
  });
  ok('A1: неизвестная роль становится user, а не выдумывается', base.messages[0].role === 'user', base.messages[0].role);
  ok('A2: длинная реплика обрезается, а не уезжает в хранилище целиком', base.messages[1].content.length === 20000, String(base.messages[1].content.length));
  ok('A3: счётчики подстройки доживают до сохранения (misses не обнуляются)',
    base.attune.turns === 7 && base.attune.hits === 2 && base.attune.misses === 4, JSON.stringify(base.attune).slice(0, 120));
  ok('A4: профиль поправки живёт полной записью', base.attune.prefs.length === 1 && base.attune.prefs[0].count === 3);
  ok('A5: мусорных полей в записи не остаётся — иначе их нечем читать', !('weird' in base) && Array.isArray(base.images));
  ok('A6: ключ хранилища не содержит мусора и не пустой', keyFor('tg:42/../x') === 'chattg42x' || /^chat:[a-zA-Z0-9_.-]+$/.test(keyFor('tg:42/../x')), keyFor('tg:42/../x'));
}

console.log('B — хранилище: одно чтение на чат, запись не молчит об ошибке');
{
  const { store, map, calls } = fakeKV({ getDelay: 10 });
  const m = createMemory({ store, env: {} });
  const [a, b, c] = await Promise.all([m.load('c1'), m.load('c1'), m.load('c1')]);
  ok('B1: три параллельных чтения одного чата = один запрос в KV', calls.get === 1, String(calls.get));
  ok('B2: это одна и та же запись, а не три разные копии', a === b && b === c);
  await m.addMessage('c1', 'user', 'привет');
  await m.flush();
  ok('B3: flush дожидается записи — в Worker таймер на фоне не живёт', map.size === 1 && calls.put === 1, JSON.stringify({ size: map.size, put: calls.put }));
  ok('B4: запись идёт под ключом чата', Array.from(map.keys())[0] === keyFor('c1'), Array.from(map.keys())[0]);

  const bad = fakeKV({ putThrows: true });
  const m2 = createMemory({ store: bad.store, env: {} });
  await m2.addMessage('c2', 'user', 'текст');
  await m2.flush();
  const st = await m2.stats('c2');
  ok('B5: хранилище не приняло — это видно (error в статах), а не потеряно молча', /квота хранилища/.test(st.error), st.error);
  ok('B6: при отказе записи память в процессе остаётся — ответ не ломается', st.messages === 1, JSON.stringify(st));

  const noStore = createMemory({ env: {} });
  ok('B7: без хранилища память выключена, а не падает', noStore.enabled === false && (await noStore.stats('x')).on === false);
  ok('B8: MEMORY=0 — выключена и словами, и делом', createMemory({ store: fakeKV().store, env: { MEMORY: '0' } }).enabled === false);
  ok('B9: настройки читаются из env (в Worker нет process.env)', (() => {
    const c = cfgOf({ MEMORY_HOT_MSGS: '8', MEMORY_COMPACT_AT: '30', MEMORY_FACTS_MAX: '5' });
    return c.hot === 8 && c.compactAt === 30 && c.factsMax === 5;
  })());
}

console.log('C — факты: запоминаем то, что человек рассказал о себе');
{
  ok('C1: имя, город, возраст', JSON.stringify(extractFacts('меня зовут Тигр, я из Гомеля, мне 33 года')) ===
    JSON.stringify(['звать Тигр', 'из Гомеля', '33 лет']), JSON.stringify(extractFacts('меня зовут Тигр, я из Гомеля, мне 33 года')));
  ok('C2: «хочу узнать/посчитать» — это запрос, а не намерение в жизни',
    extractFacts('я хочу узнать курс доллара').every((f) => !/хочет узнать/.test(f)), JSON.stringify(extractFacts('я хочу узнать курс доллара')));
  ok('C3: короткий личный рассказ целиком идёт в память',
    extractFacts('у меня две собаки и британская кошка').length >= 1, JSON.stringify(extractFacts('у меня две собаки и британская кошка')));
  ok('C4: вопрос в память не пишется (на вопросы отвечают)', extractFacts('а ты любишь кофе?').length === 0, JSON.stringify(extractFacts('а ты любишь кофе?')));
  ok('C5: длинная Простыня не превращается в «факт»', extractFacts('я ' + 'слово '.repeat(300)).length === 0);

  const { store } = fakeKV();
  const m = createMemory({ store, env: { MEMORY_FACTS_MAX: '5' } });
  for (let i = 0; i < 9; i++) await m.addFact('c3', 'факт ' + i);
  await m.addFact('c3', 'факт 8');
  const d = await m.load('c3');
  ok('C6: факты не дублируются', d.facts.filter((f) => f === 'факт 8').length === 1, JSON.stringify(d.facts));
  ok('C7: потолок фактов держится — хранилище не раздувается', d.facts.length === 5, String(d.facts.length));
  ok('C8: rememberFacts вытаскивает из реплики и пишет', (await (async () => {
    const mm = createMemory({ store: fakeKV().store, env: {} });
    const list = await mm.rememberFacts('c4', 'меня зовут Тигр');
    return (await mm.load('c4')).facts.length === list.length && list.length === 1;
  })()));
}

console.log('D — компакция: старое в сводку, свежее не потерять');
{
  const env = { MEMORY_COMPACT_AT: '20', MEMORY_KEEP_AFTER: '5' };
  const mk = async (n, from = 0) => {
    const { store, calls } = fakeKV();
    const m = createMemory({ store, env });
    for (let i = 0; i < n; i++) await m.addMessage('c5', i % 2 ? 'assistant' : 'user', 'реплика ' + (i + from));
    return { m, calls };
  };
  {
    const { m } = await mk(21);
    const d = await m.load('c5');
    ok('D1: порог сжатия работает в обе стороны', m.needsCompact(d) === true && m.needsCompact({ messages: new Array(20).fill(0) }) === false, String(d.messages.length));
  }
  {
    let seen = 0;
    const { store } = fakeKV();
    const m = createMemory({
      store, env: { ...env, MEMORY_SUMMARIZE: '1' },
      summarize: async (text) => { seen++; await new Promise((r) => setTimeout(r, 20)); return 'СВОДКА(' + text.split('\n').length + ')'; },
    });
    for (let i = 0; i < 21; i++) await m.addMessage('c6', 'user', 'реплика ' + i);
    const p = m.compact('c6');
    const q = m.compact('c6');
    await Promise.all([p, q]);
    const d = await m.load('c6');
    ok('D2: параллельная компакция выполняется один раз (у донора это была потеря истории)', seen === 1, String(seen));
    ok('D3: сводка добавлена, старое выкинуто,keepAfter выдержан',
      /СВОДКА\(16\)/.test(d.summary) && d.messages.length === 5, JSON.stringify({ sum: d.summary.slice(0, 30), n: d.messages.length }));
  }
  {
    const { store } = fakeKV();
    let called = 0;
    const m = createMemory({ store, env, summarize: async () => { called++; return 'не должна'; } });
    for (let i = 0; i < 21; i++) await m.addMessage('c7', 'user', 'текст ' + i);
    /* пока свёртывалось, в чат написали — новая реплика обязана выжить */
    const p = m.compact('c7');
    await m.addMessage('c7', 'user', 'СВЕЖАЯ');
    await p;
    const d = await m.load('c7');
    ok('D4: без MEMORY_SUMMARIZE модель не дёргается, сводка механическая', called === 0 && /Сжато механически/.test(d.summary), d.summary.slice(0, 60));
    ok('D5: реплика, пришедшая во время сжатия, не выкидывается', d.messages.some((x) => x.content === 'СВЕЖАЯ'), JSON.stringify(d.messages.map((x) => x.content)));
  }
}

console.log('E — подстройка: реакция на прошлый ответ превращается в профиль');
{
  const { store } = fakeKV();
  const m = createMemory({ store, env: {} });
  await m.addMessage('c8', 'user', 'напиши функцию сложения');
  await m.addMessage('c8', 'assistant', 'Конечно! Вот, кстати, обсудим архитектуру…');
  const cons = await m.consider('c8', 'не то, я просил функцию, а не разговор. короче', { reply: 'Конечно! Вот, кстати, обсудим архитектуру…', user: 'напиши функцию сложения' });
  const d = await m.load('c8');
  ok('E1: промах замечен и учтён', d.attune.misses === 1 && d.attune.hits === 0, JSON.stringify({ h: d.attune.hits, m: d.attune.misses }));
  ok('E2: из промаха выросло правило', d.attune.prefs.some((p) => p.key === 'answer_the_ask'), JSON.stringify(d.attune.prefs.map((p) => p.key)));
  ok('E3: форма из запроса тоже закрепляется', d.attune.prefs.some((p) => p.key === 'shorter'));
  ok('E4: блок в промпт говорит, что ответ не попал', cons && /Прошлый ответ не попал/.test(cons.block), cons && cons.block.slice(0, 80));
  ok('E5: цель посчитана и попала в профиль целей', d.attune.goals[d.attune.goals.length - 1] === 'code', JSON.stringify(d.attune.goals));

  await m.consider('c8', 'именно, вот так и надо; короче и давай ещё', { reply: 'function add(a, b) { return a + b }', user: 'не то, короче' });
  const d2 = await m.load('c8');
  ok('E6: подтверждение укрепляет, а не множит правила',
    d2.attune.hits === 1 && d2.attune.prefs.some((p) => p.count >= 2), JSON.stringify(d2.attune.prefs.map((p) => [p.key, p.count])));

  const block = buildAttunePrompt({ intent: readIntent('напиши функцию, короче', []), prefs: d2.attune.prefs, turns: d2.attune.turns });
  ok('E7: в блок НЕ попадает то, что мы не переносили (род, ориентация, возраст)',
    !/влечёт|мужчин|женщин|возраст/.test(block), block.split('\n').find((l) => /влечёт|мужчин|возраст/.test(l)) || 'чисто');

  const small = createMemory({ store: fakeKV().store, env: { MEMORY_PREFS_MAX: '3' } });
  for (let i = 0; i < 6; i++) await small.addPref('c9', 'k' + i, 'правило ' + i);
  for (let i = 0; i < 3; i++) await small.addPref('c9', 'k1', 'правило 1');
  const d3 = await small.load('c9');
  ok('E8:prefsMax: слабое и старое вытесняется, подтверждённое остаётся',
    d3.attune.prefs.length === 3 && d3.attune.prefs.some((p) => p.key === 'k1' && p.count === 3),
    JSON.stringify(d3.attune.prefs.map((p) => [p.key, p.count])));
}

console.log('F — память сквозь движок: головы совета её не читают');
{
  const sent = [];
  const txt = (t) => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: t }, finish_reason: 'stop' }] }) });
  const impl = async (url, init) => {
    const b = JSON.parse(init.body);
    const host = new URL(url).host;
    sent.push({ host, msg: b.messages });
    if (host === 'api.z.ai') return txt('Осталось 11');
    if (/что ты/.test(JSON.stringify(b.messages))) return txt('Помню: тебя зовут Тигр, ты из Гомеля.');
    return txt('Осталось 11 яблок.');
  };
  const { store } = fakeKV();
  const e = createEngine({
    env: { GROQ_KEYS: 'g', ZAI_KEYS: 'z', ENSEMBLE: '1' },
    fetch: impl, sleep: async () => {}, memory: createMemory({ store, env: {} }),
  });
  const r1 = await e.run({ text: 'меня зовут Тигр, я из Гомеля, мне 33 года', chatId: 'web1' });
  sent.length = 0;
  const r2 = await e.run({ text: 'что ты обо мне помнишь?', chatId: 'web1' });
  const sys = String(sent[0].msg[0].content || '');
  ok('F1: во второй запрос память поехала (блок в system)', /Память чата/.test(sys) && /Тигр/.test(sys), sys.slice(0, 120));
  ok('F2: истории у клиента не было — она взята из памяти', sent[0].msg.length > 2, String(sent[0].msg.length));
  ok('F3: ответ опирается на память', /Тигр/.test(r2.reply), r2.reply.slice(0, 60));
  ok('F4: в первом ответе память уже наросла', r1.memory && r1.memory.facts >= 1, JSON.stringify(r1.memory));
  const withMem = sent.filter((x) => /Память чата/.test(String(x.msg[0].content || ''))).length;
  ok('F5: голову совета память не грузится — один запрос с памятью на весь ответ', withMem === 1, JSON.stringify(sent.map((x) => x.host)) + ' | ' + withMem);
  sent.length = 0;
  const e2 = createEngine({ env: { GROQ_KEYS: 'g' }, fetch: impl, sleep: async () => {} });
  await e2.run({ text: 'привет' });
  ok('F6: без chatId память не трогается вообще', sent.length === 1);
}

console.log('G — вход /api/chat: KV-адаптер, chatId, забвение');
{
  ok('G1: без связки MEMORY адаптера нет (и это не ошибка, а «памяти нет»)',
    memoryStore(undefined) === null && memoryStore({}) === null && memoryStore({ MEMORY: {} }) === null);
  const kvHits = [];
  /* KV-фейк обязан ПЕРСИСТИРОВАТЬ: в handler память создаётся на каждый запрос,
     и если get возвращает null, проверка покажет «памяти нет» по причине фейка,
     а не по причине кода. Пишем строкой, читаем объектом — как настоящая KV. */
  /* Семантика настоящей KV: put принимает то, что ему дали (у нас — строку,
     адаптер сериализует сам), get с 'json' отдаёт разобранный объект. Если здесь
     сериализовать ещё раз, получится двойное кодирование, и «памяти нет» будет
    артефактом фейка, а не поведением кода (так и вышло на первой версии теста). */
  const kvStore = new Map();
  const fake = {
    get: async (k) => { kvHits.push('get:' + k); return kvStore.has(k) ? JSON.parse(kvStore.get(k)) : null; },
    put: async (k, v) => { kvHits.push('put:' + k + ':' + (typeof v)); kvStore.set(k, v); },
    delete: async (k) => { kvHits.push('del:' + k); kvStore.delete(k); },
  };
  const st = memoryStore({ MEMORY: fake });
  await st.put('chat:x', { a: 1 });
  await st.get('chat:x', 'json');
  ok('G2: пишем строкой, читаем объектом — иначе normalize получил бы мусор',
    kvHits.indexOf('put:chat:x:string') >= 0, JSON.stringify(kvHits));

  const ENV = { GROQ_KEYS: 'g1', MEMORY: fake };
  const saved = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Запомнил: Тигр' }, finish_reason: 'stop' }] }) };
  };
  const req = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const r1 = await onRequestPost({ request: req({ text: 'меня зовут Тигр', chatId: 'web9' }), env: ENV });
  const j1 = await r1.json();
  ok('G3: ответ содержит рост памяти — «он забыл» можно проверить, а не угадывать',
    j1.ok === true && j1.memory && j1.memory.on === true && j1.memory.messages === 2, JSON.stringify(j1.memory));
  bodies.length = 0;
  const r2 = await onRequestPost({ request: req({ text: 'что ты помнишь?', chatId: 'web9' }), env: ENV });
  const j2 = await r2.json();
  const sys = String((bodies[0].messages || bodies[0].contents || [])[0]?.content || JSON.stringify(bodies[0]).slice(0, 400));
  ok('G4: второй запрос ушёл уже с памятью', /Память чата|зовут Тигр/.test(sys) && j2.ok === true, sys.slice(0, 100));
  const r3 = await onRequestPost({ request: req({ text: 'x', chatId: 'web9', forget: true }), env: ENV });
  const j3 = await r3.json();
  ok('G5: forget стирает память чата словами и делом', j3.forgotten === true && j3.memory.messages === 0, JSON.stringify(j3.memory));
  const r4 = await onRequestPost({ request: req({ text: 'привет' }), env: { GROQ_KEYS: 'g1' } });
  const j4 = await r4.json();
  ok('G6: без связки MEMORY ответ всё равно есть, а память названа выключенной',
    j4.ok === true && j4.memory && j4.memory.on === false && /MEMORY/.test(j4.memory.why || ''), JSON.stringify(j4.memory));
  globalThis.fetch = saved;
}


console.log('H — порядок в транскрипте: сначала реплика человека, потом мой ответ');
{
  const txt = (t) => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: t }, finish_reason: 'stop' }] }) });
  const kv = new Map();
  const store = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } };
  const mem = createMemory({ store, env: {} });
  const sent = [];
  const e = createEngine({
    env: { GROQ_KEYS: 'g' }, sleep: async () => {}, memory: mem,
    fetch: async (url, init) => {
      const b = JSON.parse(init.body);
      sent.push(b.messages);
      const ask = String(b.messages[b.messages.length - 1].content);
      return txt(/помнишь/.test(ask) ? 'Тебя зовут Тигр.' : 'Запомнил.');
    },
  });
  await e.run({ text: 'меня зовут Тигр', chatId: 'ord' });
  const d = await mem.load('ord');
  ok('H1: в памяти транскрипт идёт пользователь → агент',
    d.messages.length === 2 && d.messages[0].role === 'user' && d.messages[1].role === 'assistant',
    JSON.stringify(d.messages.map((m) => m.role)));
  await e.run({ text: 'что ты обо мне помнишь?', chatId: 'ord' });
  const roles = sent[1].map((m) => m.role).join(',');
  ok('H2: история из памяти встроена в правильном порядке (вопрос не задублирован)',
    roles === 'system,user,assistant,user', roles);
  /* тавтология здесь хуже, чем отсутствие проверки: смотрим, что факт доехал
     до модели в теле запроса, а не «может, доехал» */
  ok('H3: факт из памяти доехал до модели в теле запроса',
    /зовут Тигр/.test(JSON.stringify(sent[1])), JSON.stringify(sent[1]).slice(0, 160));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
