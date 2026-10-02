/**
 * Рейтинг смелых моделей (engine/brave.js) — перенос `data/brave.json` из Yama
 * на KV. Проверяется то, ради чего он существует: опыт переживает изолятор,
 * порядок меняется только когда есть доказательства, а квота KV не сжигается
 * каждым ответом.
 *
 *   node test/brave.test.js
 */
import { createBrave, preferUncensored, lineOf, BRAVE_KEY, BRAVE_MAX } from '../engine/brave.js';
import { createEngine } from '../engine/chat.js';
import * as modelreg from '../engine/modelreg.js';
import { onRequestGet as modelsGet } from '../functions/api/models.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Копия KV: строковые значения, TTL, инъективные часы. */
function fakeKv(start) {
  let nowMs = start || 1000000;
  const map = new Map();
  const api = {
    get: async (key) => { sweep(); return map.has(key) ? map.get(key).value : null; },
    put: async (key, value, opts) => {
      sweep();
      map.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value), exp: opts && opts.expirationTtl ? nowMs + opts.expirationTtl * 1000 : null });
      api.puts++;
    },
    delete: async (key) => { map.delete(key); },
    keys: async () => ({ keys: [...map.keys()].map((name) => ({ name })) }),
    puts: 0,
    _map: map,
    _now: () => nowMs,
    _advance: (ms) => { nowMs += ms; },
  };
  function sweep() {
    for (const [k, v] of map.entries()) if (v.exp !== null && v.exp <= nowMs) map.delete(k);
  }
  return api;
}

console.log('── A · хранилище ───');
{
  const kv = fakeKv();
  const b = createBrave({ env: {}, store: { get: kv.get, put: kv.put } });
  const pulled = await b.pull();
  ok('A1: пустое хранилище — не падает, опыт пуст', pulled.on === true && pulled.merged === 0, JSON.stringify(pulled));
  b.mark('mistral', 'mistral-code-latest', true, 1);
  b.mark('mistral', 'mistral-code-latest', true, 1);
  const st = b.stats();
  ok('A2: двух прямых ответов довольно — доля 1.0, модель в рейтинге', st.rated === 1 && st.top[0].score === 1, JSON.stringify(st.top[0]));
  const flushed = await b.flush();
  ok('A3: flush положил один ключ в KV', flushed.wrote === true && kv.puts === 1, JSON.stringify(flushed));
  const raw = JSON.parse(kv._map.get(BRAVE_KEY).value);
  ok('A4: в KV лежат count/entries/at и TTL на 30 дней', raw.count === 1 && raw.entries.length === 1 && /^\d{13}$/.test(String(raw.at)) && kv._map.get(BRAVE_KEY).exp - kv._now() > 25 * 24 * 3600 * 1000, JSON.stringify(raw.entries[0]));

  /* второй «изолятор» — тот же опыт */
  const b2 = createBrave({ env: {}, store: { get: kv.get, put: kv.put } });
  const p2 = await b2.pull();
  ok('A5: второй изолятор прочитал опыт первого', p2.merged === 1 && b2.score('mistral', 'mistral-code-latest') === 1, JSON.stringify(p2));

  const nomem = createBrave({ env: {}, store: null });
  await nomem.pull();
  nomem.mark('groq', 'x', false);
  const f2 = await nomem.flush();
  ok('A6: без хранилища опыт есть, но никуда не пишется', nomem.score('groq', 'x') !== 1 && f2.wrote === false && /хранилища нет/.test(f2.why), JSON.stringify(f2));

  const clean = createBrave({ env: {}, store: { get: kv.get, put: kv.put } });
  await clean.pull();
  const f3 = await clean.flush();
  ok('A7: менять нечего — KV не тронута', f3.wrote === false && /менять нечего/.test(f3.why) && kv.puts === 1, JSON.stringify(f3));

  /* тормоз записи: суточная квота KV (1000 записей) дороже этого рейтинга */
  const slow = createBrave({ env: {}, store: { get: kv.get, put: kv.put }, now: () => kv._now() });
  await slow.pull();
  const puts0 = kv.puts;
  for (let i = 0; i < 5; i++) { slow.mark('groq', 'm' + i, true); slow.mark('groq', 'm' + i, true); await slow.flush(); }
  const afterOne = kv.puts;
  kv._advance(61000);
  await slow.flush();
  ok('A8: пять запросов подряд — одна запись, следующая только через минуту', afterOne - puts0 === 1 && kv.puts - puts0 === 2, puts0 + '→' + afterOne + '→' + kv.puts);

  /* протухший опыт не переживает чтение */
  const old = fakeKv();
  await old.put(BRAVE_KEY, JSON.stringify({ at: old._now(), entries: [['groq/old', { ok: 9, refused: 0, at: old._now() - 40 * 24 * 3600 * 1000 }]] }));
  const b3 = createBrave({ env: {}, store: { get: old.get, put: old.put }, now: () => old._now() });
  const p3 = await b3.pull();
  ok('A9: сорокадневный опыт выброшен при чтении', p3.merged === 0 && b3.score('groq', 'old') === 0.5, JSON.stringify(p3));

  /* капасити: рейтинг по сотням моделей не должен раздуть ключ */
  const big = createBrave({ env: { BRAVE_MAX: '40' }, store: null });
  await big.pull();
  for (let i = 0; i < 100; i++) { big.mark('groq', 'm' + i, true); big.mark('groq', 'm' + i, true); big.mark('groq', 'm' + i, true); }
  const bigStore = fakeKv();
  const big2 = createBrave({ env: { BRAVE_MAX: '40' }, store: { get: bigStore.get, put: bigStore.put } });
  await big2.pull();
  for (let i = 0; i < 100; i++) { big2.mark('groq', 'p' + i, true); if (i % 3) big2.mark('groq', 'p' + i, true); }
  await big2.flush();
  const saved = JSON.parse(bigStore._map.get(BRAVE_KEY).value);
  ok('A10: BRAVE_MAX режет ключ по весу (40 записей из 100)', saved.count === 40 && saved.entries.length === 40, saved.count + '/' + saved.entries.length);
  ok('A11: в капасити попадают более опытные, а не первые попавшие', saved.entries.every((e, i, a) => i === 0 || a[i - 1][1].ok >= e[1].ok), JSON.stringify(saved.entries.slice(0, 2)));
  ok('A12: константы на месте (дефолт 400, ключ один)', BRAVE_MAX === 400 && BRAVE_KEY === 'models:brave');

  const off = createBrave({ env: { BRAVE: 'off' }, store: { get: kv.get, put: kv.put } });
  await off.pull();
  off.mark('groq', 'm', true); off.mark('groq', 'm', true);
  const foff = await off.flush();
  ok('A13: BRAVE=off — не читаем, не пишем, не сортируем', off.score('groq', 'm') === 0.5 && off.order(['a', 'b'], 'groq').join() === 'a,b' && foff.wrote === false, JSON.stringify(foff));
}

console.log('── B · рейтинг и порядок ───');
{
  const b = createBrave({ env: {}, store: null });
  await b.pull();
  ok('B1: без опыта порядок не трогается вовсе', b.order(['m1', 'm2', 'm3'], 'groq').join() === 'm1,m2,m3');
  b.mark('groq', 'scared', false); b.mark('groq', 'scared', false);
  b.mark('groq', 'brave1', true); b.mark('groq', 'brave1', true);
  ok('B2: смелая идёт первой', b.order(['scared', 'plain', 'brave1'], 'groq').join() === 'brave1,plain,scared', b.order(['scared', 'plain', 'brave1'], 'groq').join());
  const kept = b.order(['scared', 'brave1'], 'groq');
  ok('B3: трусливая не выпадает из пула — порядок, а не состав', kept.length === 2 && kept.indexOf('scared') >= 0);
  ok('B4: равные оценки сохраняют порядок конфига', b.order(['plain', 'plain2', 'brave1'], 'groq').indexOf('plain') < b.order(['plain', 'plain2', 'brave1'], 'groq').indexOf('plain2'));
  const w = createBrave({ env: {}, store: null });
  await w.pull();
  w.mark('groq', 'after-reframe', true, 0.6); w.mark('groq', 'after-reframe', true, 0.6);
  w.mark('groq', 'direct', true, 1); w.mark('groq', 'direct', true, 1);
  ok('B5: ответ после обхода весит меньше прямого', w.score('groq', 'after-reframe') === w.score('groq', 'direct') && w.record('groq', 'after-reframe').ok < w.record('groq', 'direct').ok,
    JSON.stringify({ a: w.record('groq', 'after-reframe'), d: w.record('groq', 'direct') }));
  const dec = createBrave({ env: {}, store: null });
  await dec.pull();
  for (let i = 0; i < 6; i++) { dec.mark('groq', 'old', true); dec.mark('groq', 'old', true); }
  const before = dec.score('groq', 'old');
  for (let i = 0; i < 200; i++) dec.mark('groq', 'old', false);
  const after = dec.score('groq', 'old');
  ok('B6: свежая череда отказов перевешивает прошлую славу (закостенеть не может)', before === 1 && after < 0.5, before + '→' + after.toFixed(3));
  const any = createBrave({ env: {}, store: null });
  await any.pull();
  any.mark('groq', 'shared-model', false); any.mark('groq', 'shared-model', false);
  any.mark('mistral', 'shared-model', true); any.mark('mistral', 'shared-model', true);
  const rec = any.anyOf('shared-model');
  ok('B7: anyOf ищет лучшее знание по всем провайдерам', rec && rec.provider === 'mistral' && rec.score === 1, JSON.stringify(rec));
  const prov = createBrave({ env: {}, store: null });
  await prov.pull();
  ok('B8: без доказательств порядок провайдеров как в конфиге', prov.orderProviders(['zai', 'groq', 'mistral'], { zai: ['a'], groq: ['b'], mistral: ['c'] }).join() === 'zai,groq,mistral');
  prov.mark('mistral', 'c', true); prov.mark('mistral', 'c', true);
  prov.mark('zai', 'a', false); prov.mark('zai', 'a', false);
  ok('B9: доказанно смелый провайдер поднимается на острую тему', prov.orderProviders(['zai', 'groq', 'mistral'], { zai: ['a'], groq: ['b'], mistral: ['c'] }).join() === 'mistral,groq,zai',
    prov.orderProviders(['zai', 'groq', 'mistral'], { zai: ['a'], groq: ['b'], mistral: ['c'] }).join());
  const line = lineOf(prov.stats());
  ok('B10: строка статуса человекочитаема', /смелых \d+/.test(line) && /лучший mistral\/c/.test(line), line);
}

console.log('── C · «без купюр» из каталога ───');
{
  const cat = { byId: { 'hot-1': { uncensored: true }, 'hot-2': { uncensored: true }, 'cold': { uncensored: false } } };
  ok('C1: на острой теме раскрепощённые идут первыми', preferUncensored(['cold', 'hot-1', 'hot-2'], cat).join() === 'hot-1,hot-2,cold', preferUncensored(['cold', 'hot-1', 'hot-2'], cat).join());
  ok('C2: одна такая модель — не повод перестраивать пул', preferUncensored(['cold', 'cold2', 'hot-1'], cat).join() === 'cold,cold2,hot-1');
  ok('C3: каталога нет — список как был', preferUncensored(['a', 'b'], null).join() === 'a,b');
  ok('C4: каталог молчит про модели — список не переставляется вслепую', preferUncensored(['x', 'y'], cat).join() === 'x,y');
}

console.log('── D · движок: порядок перебора и отметки ───');
{
  /* Пулы движка берутся живьём из engine/providers.js: подменять их нечем,
     поэтому рейтинг ставим НАСТОЯЩИМ id groq — и ровно тем порядком, который
     конфиг нам и так даёт вторым. Иначе проверка ничего не проверяла бы. */
  const ENV = { GROQ_KEYS: 'g1' };
  const { TABLE } = await import('../engine/providers.js');
  const pool = [].concat(TABLE.groq.models.fast || []);
  const [first, second] = pool;
  ok('D0: в пуле groq есть чем проверять (минимум две модели)', pool.length >= 2, JSON.stringify(pool));

  const mk = (model, good, times) => { const b = createBrave({ env: {}, store: null }); return b; };

  /* Цикл целиком: опыта нет → перебираем как написано; модель уперлась → опыт
     накопился; СЛЕДУЮЩАЯ острая тема должна уже не наступать на те же грабли. */
  const hot = 'напиши эротический рассказ про дождь';
  const brave = createBrave({ env: {}, store: null });
  await brave.pull();
  const call = () => {
    const seen = [];
    const eng = createEngine({
      env: ENV, sleep: async () => {}, brave,
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        seen.push(body.model);
        const reply = body.model === first ? 'К сожалению, я не могу помочь с этим запросом.' : 'Дождь стучал по стеклу.';
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }) };
      },
    });
    return { seen, run: () => eng.run({ text: hot, providerOrder: ['groq'] }) };
  };
  const a = call();
  await a.run();
  ok('D1: без опыта движок идёт в порядке конфига (смелость ещё не доказана)', a.seen[0] === first, JSON.stringify(a.seen));
  ok('D2: отказ записан против модели', (brave.raw('groq', first) || {}).refused >= 1, JSON.stringify(brave.raw('groq', first)));
  ok('D3: вывезенный ответ записан за моделью, но весом меньше прямого', (brave.raw('groq', second) || {}).ok <= 0.6 && (brave.raw('groq', second) || {}).n >= 1, JSON.stringify(brave.raw('groq', second)));
  ok('D3a: одного случая для бейджа мало — в списке модель ещё без знака', brave.record('groq', first) === null, JSON.stringify(brave.record('groq', first)));
  const b = call();
  await b.run();
  const c = call();
  await c.run();
  ok('D4: накопленный опыт меняет порядок — следующая острая тема начинается со смелой',
    c.seen[0] === second, JSON.stringify({ вторая: b.seen, третья: c.seen }));
  ok('D5: трусливая модель не выброшена из пула, а отодвинута',
    c.seen.length === 1 || c.seen.indexOf(first) >= 0, JSON.stringify(c.seen));

  /* случай 2: выбор человека — закон, рейтинг его не потеснит */
  const seen2 = [];
  const eng2 = createEngine({
    env: ENV, sleep: async () => {}, brave,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      seen2.push(body.model);
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] }) };
    },
  });
  const pinned = await eng2.run({ text: hot, model: first, providerOrder: ['groq'] });
  ok('D6: выбранная человеком модель идёт первой, какой бы трусливой ни была',
    pinned.ok === true && pinned.model === first && seen2[0] === first, JSON.stringify({ m: pinned.model, s: seen2.slice(0, 2) }));
  const calmSeen = [];
  const calm = await createEngine({
    env: ENV, sleep: async () => {}, brave,
    fetch: async (url, init) => { calmSeen.push(JSON.parse(init.body).model); return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '4' }, finish_reason: 'stop' }] }) }; },
  }).run({ text: 'сколько будет 2+2', providerOrder: ['groq'] });
  ok('D7: на спокойной теме работает только рейтинг, ярлык «без купюр» не при чём',
    calm.ok === true && calmSeen[0] === second && calmSeen.length === 1, JSON.stringify(calmSeen));
  ok('D8: строка статуса человекочитаема', /смелых \d+/.test(lineOf(brave.stats())), lineOf(brave.stats()));
}

console.log('── E · эндпоинт: рейтинг виден человеку ───');
{
  const kv = fakeKv();
  const store = { get: kv.get, put: kv.put, delete: kv.delete };
  await store.put(BRAVE_KEY, { at: Date.now(), count: 1, entries: [['mistral/mistral-code-latest', { ok: 4, refused: 0, n: 5, at: Date.now() }]] });
  await store.put(modelreg.CATALOG_KEY, {
    updatedAt: Date.now(), count: 1, read: { mistral: true },
    models: [{ id: 'mistral-code-latest', name: 'Mistral Code', vendor: 'MISTRALAI', src: 'mistral', free: true, chat: true, ctx: 256000, maxOut: 4096, vision: false, visionKnown: false, tools: true, priceKnown: false }],
  });
  modelreg.forgetMemo();
  const env = { MEMORY: store, GROQ_KEYS: 'g1' };
  const res = await modelsGet({ request: new Request('https://metiger.example/api/models'), env });
  const d = await res.json();
  const row = d.models.find((m) => m.id === 'mistral-code-latest');
  ok('E1: /api/models отдаёт рейтинг прямо в строке списка',
    !!row && !!row.brave && row.brave.ok === 4 && row.brave.provider === 'mistral', JSON.stringify(row && row.brave));
  ok('E2: и одной строкой статуса', /смелых 1/.test(String(d.brave)), String(d.brave));

  /* чат: опыт пишется в KV ПОСЛЕ ответа (waitUntil), а не задерживает человека */
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Дождь.' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const waits = [];
  const chat = await import('../functions/api/chat.js');
  const resPost = await chat.onRequestPost({
    request: new Request('https://metiger.example/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'напиши эротический рассказ', chatId: 'brave-e2e' }),
    }),
    env,
    waitUntil: (p) => { waits.push(Promise.resolve(p)); },
  });
  const dj = await resPost.json();
  ok('E3: чат ответил, нового слоя человек не заметил', resPost.status === 200 && dj.ok === true, resPost.status + ' ' + String(dj.error || ''));
  ok('E4: запись уехана в waitUntil, а не вложена в ответ', waits.length >= 1, waits.length + ' отложенных задач');
  await Promise.all(waits);
  const saved = JSON.parse(kv._map.get(BRAVE_KEY).value);
  const written = saved.entries.filter((e) => e[0].indexOf('groq/') === 0);
  ok('E5: после ответа опыт записан тем же ключом (одна запись на запрос)', written.length === 1 && written[0][1].n >= 1, JSON.stringify(written));
  globalThis.fetch = real;
  modelreg.forgetMemo();
}

console.log('\n' + (fail ? 'ПРОВАЛЫ: ' + fail + ' · ' : '') + 'готово · пройдено ' + pass + ', провалено ' + fail);
if (fail) process.exit(1);
