/**
 * Общий слой лимитов и карантина (engine/limits.js) — то, из-за чего KV вообще
 * нужен проекту, кроме памяти чата.
 *
 * Хранилище подменяется точной копией KV-байндинга: get/put/delete, expirationTtl
 * и инъекция времени. Так проверяются настоящие грабли: «маркер пережил окно»,
 * «второй изолятор увидел наказание», «хранилище упало — ответ не упал»,
 * «честный клиент не потратил ни одной операции».
 *
 *   node test/limits.test.js
 */
import * as L from '../engine/limits.js';
import { createEngine } from '../engine/chat.js';
import { onRequestPost } from '../functions/api/chat.js';
import { fnv1a } from '../engine/kvkey.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Копия KV: значения строками, TTL в секундах, часы инъективные. */
function fakeKv(start) {
  let nowMs = start || 1000000;
  const map = new Map();
  const api = {
    get: async (key) => { sweep(); return map.has(key) ? map.get(key).value : null; },
    put: async (key, value, opts) => {
      sweep();
      const ttl = opts && opts.expirationTtl;
      if (ttl != null && ttl < 60) throw new Error('expirationTtl too short');
      map.set(key, { value, until: ttl ? nowMs + ttl * 1000 : Infinity, ttl });
      api.puts++;
    },
    delete: async (key) => { sweep(); map.delete(key); api.deletes++; },
    list: async () => ({ keys: [...map.keys()].map((k) => ({ name: k })) }),
    _map: map,
    _set: (t) => { nowMs = t; },
    _now: () => nowMs,
    puts: 0, deletes: 0, reads: 0,
  };
  function sweep() { for (const [k, e] of [...map]) if (e.until <= nowMs) map.delete(k); }
  const realGet = api.get;
  api.get = async (k) => { api.reads++; return realGet(k); };
  return api;
}
/** то же, но в форме, которую ждёт общий слой (JSON + ttl числом секунд) */
function storeOf(kv) {
  return {
    get: (key) => kv.get(key).then((raw) => (raw == null ? null : JSON.parse(raw))),
    put: (key, value, ttlSec) => kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec }),
    delete: (key) => kv.delete(key),
  };
}

console.log('L — настройки');
{
  const d = L.cfgOf({});
  ok('L1: дефолты совпадают с тем, что было до слоя (12 в минуту)',
    d.rateMax === 12 && d.rateWindowMs === 60000 && d.writeEveryMs === 60000 && d.probeAt === 3 && d.on === true,
    JSON.stringify(d));
  const e = L.cfgOf({ RATE_MAX: '4', RATE_WINDOW_MS: '30000', SHARED_LIMITS: '0', QUAR_TTL_MAX: '120' });
  ok('L2: env переопределяет, SHARED_LIMITS=0 выключает слой',
    e.rateMax === 4 && e.rateWindowMs === 30000 && e.on === false && e.quarTtlMaxSec === 120, JSON.stringify(e));
  ok('L3: мусор в env не ломает конфиг, а откатывает к дефолту',
    L.cfgOf({ RATE_MAX: 'много' }).rateMax === 12 && L.cfgOf({ RATE_WINDOW_MS: '10' }).rateWindowMs === 60000);
  ok('L4: TTL никогда не короче 60 секунд (KV на коротком отказывает) и не больше потолка',
    L.ttlSec(1000) === 60 && L.ttlSec(0) === 60 && L.ttlSec(3600000, 600) === 600 && L.ttlSec(999 * 1e9) === L.KV_MAX_TTL_SEC,
    [L.ttlSec(1000), L.ttlSec(3600000, 600)].join('/'));
  ok('L5: ip в ключ не попадает — только хэш, и он детерминированный',
    L.rateKey('203.0.113.9') === 'rl:' + fnv1a('203.0.113.9')
      && L.rateKey('203.0.113.9') === L.rateKey('203.0.113.9')
      && L.rateKey('203.0.113.9').indexOf('.') < 0 && L.rateKey('') === L.rateKey(null) && L.rateKey(null) === 'rl:' + fnv1a('anon'),
    L.rateKey('203.0.113.9'));
}

console.log('R — общий счётчик частоты');
{
  const kv = fakeKv(); const store = storeOf(kv); const cfg = L.cfgOf({});
  const now = () => kv._now();

  const solo = L.createRateLimiter({ cfg, now });
  let allowed = 0, blocked = 0;
  for (let i = 0; i < 14; i++) { const r = await solo.check('1.1.1.1'); r.limited ? blocked++ : allowed++; }
  ok('R1: без хранилища — ровно старое поведение: 12 проходят, дальше отказ',
    allowed === 12 && blocked === 2, allowed + '/' + blocked);
  ok('R2: и ни одной попытки в сеть, когда байндинга нет', solo.stats().on === false && kv.puts === 0);

  const a = L.createRateLimiter({ store, cfg, now });
  const first = await a.check('8.8.8.8');
  ok('R3: честный собеседник (1-й запрос в окне) не стоит ни одной записи',
    first.limited === false && kv.puts === 0, JSON.stringify(a.stats()));
  ok('R3b: и чтение у него одно — на начало окна, а не на каждый запрос',
    a.stats().reads === 1, JSON.stringify(a.stats()));

  for (let i = 0; i < 19; i++) await a.check('8.8.8.8');
  ok('R4: маркер блокировки пишется один раз на окно, а не на запрос',
    kv.puts === 1, 'записей: ' + kv.puts + ' ' + JSON.stringify(a.stats()));
  ok('R5: в хранилище лежит блокировка с TTL окна',
    JSON.parse(kv._map.get(L.rateKey('8.8.8.8')).value).blockedUntil > now()
      && kv._map.get(L.rateKey('8.8.8.8')).ttl === 60, kv._map.get(L.rateKey('8.8.8.8')).value);

  const b = L.createRateLimiter({ store, cfg, now });
  const rb = await b.check('8.8.8.8');
  ok('R6: второй изолятор узнаёт о блокировке с первого запроса',
    rb.limited === true && rb.shared === true, JSON.stringify(rb));

  kv._set(now() + 61000);
  const c = L.createRateLimiter({ store, cfg, now });
  const rc = await c.check('8.8.8.8');
  ok('R7: минута прошла — маркер истёк по TTL, клиент снова чист', rc.limited === false, JSON.stringify(rc));

  ok('R8: другой клиент под тем же NAT не страдает молча: окно одно на ip',
    (await L.createRateLimiter({ store, cfg, now }).check('9.9.9.9')).limited === false);

  const broken = { get: async () => { throw new Error('KV unavailable'); }, put: async () => { throw new Error('KV unavailable'); }, delete: async () => {} };
  const d = L.createRateLimiter({ store: broken, cfg, now });
  let res = null, threw = null;
  try { for (let i = 0; i < 13; i++) res = await d.check('5.5.5.5'); } catch (e) { threw = e; }
  ok('R9: хранилище падает — лимит продолжает работать локально и ответ не падает',
    !threw && res && res.limited === true, String(threw) + ' ' + JSON.stringify(res));

  const off = L.createRateLimiter({ store, cfg: L.cfgOf({ SHARED_LIMITS: '0' }), now });
  const before = { r: kv.reads, w: kv.puts };
  for (let i = 0; i < 14; i++) await off.check('7.7.7.7');
  ok('R10: SHARED_LIMITS=0 — ни одной операции хранилища, считаем сами',
    kv.reads === before.r && kv.puts === before.w, JSON.stringify({ r: kv.reads - before.r, w: kv.puts - before.w }));
}

console.log('Q — карантин провайдеров поверх Map-интерфейса движка');
{
  const kv = fakeKv(); const store = storeOf(kv); const cfg = L.cfgOf({});
  const now = () => kv._now();

  const q1 = L.createQuarantine({ store, cfg, now, base: new Map() });
  ok('Q1: пока никто не наказан, flush ничего и не пишет',
    (await q1.flush()).written === false && kv.puts === 0, JSON.stringify(await q1.flush()));

  q1.set('groq', { until: now() + 240000, why: 'нет баланса (429)' });
  const f = await q1.flush();
  ok('Q2: наказание уехало в общее хранилище одной записью',
    f.written === true && f.punished === 1 && kv.puts === 1, JSON.stringify(f));
  const rec = JSON.parse(kv._map.get(cfg.quarKey).value);
  ok('Q3: таблица живёт ровно столько, сколько самое долгое наказание',
    rec.groq.until === now() + 240000 && kv._map.get(cfg.quarKey).ttl === 240, JSON.stringify(rec) + ' ttl=' + kv._map.get(cfg.quarKey).ttl);

  const q2 = L.createQuarantine({ store, cfg, now, base: new Map() });
  const p = await q2.pull();
  ok('Q4: холодный изолятор видит чужой карантин и движку он уже доступен синхронно',
    p.merged === 1 && q2.get('groq') && q2.get('groq').why === 'нет баланса (429)', JSON.stringify(p));
  ok('Q5: интерфейс Map на месте (get/set/delete/entries) — движок подменять не пришлось',
    typeof q2.entries === 'function' && [...q2.entries()].length === 1 && q2.size === 1);

  q2.set('groq', { until: now() + 100000, why: 'короче, чем уже есть' });
  await q2.flush();
  ok('Q6: короткое своё наказание не отменяет долгое чужое (максимум по until)',
    JSON.parse(kv._map.get(cfg.quarKey).value).groq.until === rec.groq.until, kv._map.get(cfg.quarKey).value);

  q2.delete('groq');
  const f2 = await q2.flush();
  ok('Q7: провайдер ожил и других наказаний нет — ключ удаляется, а не засоряется',
    f2.written === true && !kv._map.has(cfg.quarKey) && kv.deletes === 1, JSON.stringify(f2) + ' keys=' + [...kv._map.keys()].join(','));

  const slow = L.createQuarantine({ store: storeOf(fakeKv()), cfg: L.cfgOf({ QUAR_TTL_MAX: '60' }), now });
  slow.set('x', { until: now() + 3600000, why: 'год' });
  ok('Q8: наказание длиннее QUAR_TTL_MAX в хранилище не уезжает (защита от «вечного» карантина)',
    (await slow.flush()).written === true, 'нет записи');

  const dead = { get: async () => { throw new Error('нет сети'); }, put: async () => { throw new Error('нет сети'); }, delete: async () => {} };
  const q3 = L.createQuarantine({ store: dead, cfg, now, base: new Map() });
  let err = null;
  try { q3.set('groq', { until: now() + 1000, why: 'w' }); await q3.pull(); await q3.flush(); } catch (e) { err = e; }
  ok('Q9: хранилище упало — ни паники в pull, ни паники в flush', !err, String(err));
}

console.log('E — слой внутри движка (настоящий обход провайдеров)');
{
  const ENV = { GROQ_KEYS: 'bad-key', OPENROUTER_KEYS: 'good-key', QUARANTINE_MS: '240000' };
  const kv = fakeKv(); const store = storeOf(kv); const cfg = L.cfgOf({});
  const now = () => kv._now();
  function fetchTwo(script) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push(url);
      const out = script(url, calls.length);
      return { status: out.status, text: async () => JSON.stringify(out.body) };
    };
    impl.calls = calls;
    return impl;
  }
  const broken = (url, n) => url.indexOf('groq') >= 0
    ? { status: 401, body: { error: { message: 'Invalid API Key' } } }
    : { status: 200, body: { choices: [{ message: { content: 'ответ ' + n }, finish_reason: 'stop' }] } };
  const run = (q, f) => createEngine({ env: ENV, fetch: f, sleep: async () => {}, quarantine: q })
    .run({ text: 'привет', providerOrder: ['groq', 'openrouter'] });

  const q = L.createQuarantine({ store, cfg, now, base: new Map() });
  const f1 = fetchTwo(broken);
  const r = await run(q, f1);
  ok('E1: ключ не принят — движок наказывается через наш интерфейс, без правки движка',
    r.ok === true && r.provider === 'openrouter' && !!q.get('groq') && /ключ не принят/.test(q.get('groq').why),
    JSON.stringify(q.get('groq')) + ' ' + r.provider);
  const fl = await q.flush();
  ok('E2: ровно одна запись в общее хранилище на это наказание', fl.written === true && kv.puts === 1, 'puts=' + kv.puts);
  ok('E3: таблица подписана причиной — разбирать «почему groq молчит» можно словами',
    JSON.parse(kv._map.get(cfg.quarKey).value).groq.why.indexOf('401') > 0, kv._map.get(cfg.quarKey).value);

  /* холодный изолятор: пустая локальная карта, но то же хранилище */
  const q2 = L.createQuarantine({ store, cfg, now, base: new Map() });
  await q2.pull();
  ok('E4: свежий изолятор после pull знает наказание (оно пережило перезапуск)',
    !!q2.get('groq') && q2.get('groq').until > now() && q2.stats().local === 1, JSON.stringify(q2.stats()));

  const f2 = fetchTwo(broken);
  const r2 = await run(q2, f2);
  ok('E5: и обход не стучится в наказанного — запрос к groq вообще не отправлен',
    f2.calls.filter((u) => u.indexOf('groq') >= 0).length === 0
      && r2.tried.some((t) => t.provider === 'groq' && /в карантине/.test(t.why || '')),
    JSON.stringify({ calls: f2.calls.length, tried: r2.tried.map((t) => t.provider + ':' + (t.why || '')) }));
  ok('E6: ответ человек всё равно получил — карантин не делает бота немым',
    r2.ok === true && r2.provider === 'openrouter', r2.provider);

  /* и наоборот: когда наказаны ВСЕ, движок идёт пробовать — это его правило,
     слой не имеет права превращать карантин в тишину */
  const q3 = L.createQuarantine({ store: null, cfg, now, base: new Map() });
  q3.set('groq', { until: now() + 100000, why: 'w1' });
  q3.set('openrouter', { until: now() + 100000, why: 'w2' });
  const f3 = fetchTwo(broken);
  const r3 = await run(q3, f3);
  ok('E7: наказаны все до единого — движок идёт пробовать, а не молчит (слой его не перебивает)',
    f3.calls.length > 0, 'звонков: ' + f3.calls.length);
}

console.log('H — граница HTTP: /api/chat на общем слое');
{
  const ENV = { GROQ_KEYS: 'g1', RATE_MAX: '3' };
  const kv = fakeKv();
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }] }),
  });
  const envWithKv = Object.assign({}, ENV, { MEMORY: kv });
  const req = () => new Request('http://x/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '44.55.66.77' },
    body: JSON.stringify({ text: 'привет', rate: 0 }),
  });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await onRequestPost({ request: req(), env: envWithKv })).status);
  ok('H1: четвёртый запрос с того же ip — 429 (RATE_MAX=3), и это видит общее хранилище',
    codes.join(',') === '200,200,200,429,429', codes.join(','));
  const blockedKey = [...kv._map.keys()].find((k) => k.indexOf('rl:') === 0);
  ok('H2: маркер частоты уехал в KV под хэшем ip (адреса в хранилище нет)',
    !!blockedKey && blockedKey !== 'rl:44.55.66.77' && JSON.parse(kv._map.get(blockedKey).value).blockedUntil > kv._now(),
    String(blockedKey));
  const body = await (await onRequestPost({ request: req(), env: envWithKv })).json();
  ok('H3: отказ объясняет, по какому счётчику он вынесен',
    body.rate && body.rate.max === 3 && body.rate.shared === true && body.rate.n > 3, JSON.stringify(body));
  const g = await onRequestGet({ env: envWithKv });
  const gj = await g.json();
  ok('H4: GET /api/chat говорит, общие ли лимиты (диагностика в одном месте)',
    gj.limits && gj.limits.on === true && gj.limits.rateMax === 3, JSON.stringify(gj.limits));
  const gn = await (await onRequestGet({ env: ENV })).json();
  ok('H5: без байндинга — словами, что лимиты в изоляторе, а не «всё хорошо»',
    gn.limits && gn.limits.on === false && /нет связки MEMORY/.test(gn.limits.why), JSON.stringify(gn.limits));
  globalThis.fetch = saved;
}
async function onRequestGet(o) { const m = await import('../functions/api/chat.js'); return m.onRequestGet(o); }



console.log('D — формы хранилища: прод и локальная заглушка');
{
  /* Настоящий KV-байндинг отдаёт строку, а fileKV из scripts/api-dev.js — готовый
    объект. Если читать только одну форму, вторая молча даст «памяти нет», и на
    локальном запуске слой будет выглядеть живым, ничего не делая. */
  const raw = fakeKv();
  const objectShape = { get: async (k) => (raw._map.has(k) ? JSON.parse(raw._map.get(k).value) : null), put: async (k, v) => raw._map.set(k, { value: JSON.stringify(v), until: Infinity, ttl: null }), delete: async (k) => raw._map.delete(k) };
  const { limitsStore } = await import('../functions/api/chat.js');
  const viaReal = limitsStore({ MEMORY: raw });
  const viaLocal = limitsStore({ MEMORY: objectShape });
  const cfg = L.cfgOf({});
  await viaReal.put(cfg.quarantine || cfg.quarKey, { groq: { until: 9e12, why: 'w' } }, 600);
  const back = await viaReal.get(cfg.quarKey);
  ok('D1: строковая форма (Pages) читается', back && back.groq && back.groq.why === 'w', JSON.stringify(back));
  const q = L.createQuarantine({ store: viaLocal, cfg: L.cfgOf({}), now: () => 1000000, base: new Map() });
  await viaLocal.put(cfg.quarKey, { groq: { until: 9e12, why: 'локально' } }, 600);
  const pr = await q.pull();
  ok('D2: объектная форма (локальный fileKV) читается так же', pr.merged === 1 && q.get('groq').why === 'локально', JSON.stringify(pr));
  ok('D3: без байндинга limitsStore возвращает null, а не объект-обманку',
    limitsStore({}) === null && limitsStore(null) === null && limitsStore({ MEMORY: { get: 1 } }) === null);
}

console.log('K — память и лимиты в одном байндинге');
{
  const kv = fakeKv();
  const m = await import('../engine/memory.js');
  ok('K1: схемы ключей не пересекаются: память — chat:*, лимиты — rl:* и таблица карантина',
    m.keyFor('tg_1').indexOf('chat:') === 0 && L.rateKey('1.2.3.4').indexOf('rl:') === 0 && L.cfgOf({}).quarKey.indexOf('rl:') !== 0,
    m.keyFor('tg_1') + ' ' + L.rateKey('1.2.3.4'));
  ok('K2: русское имя чата даёт разные ключи разным чатам (раньше вырезание склеивало их)',
    m.keyFor('кот и пёс') !== m.keyFor('кот или пёс'), m.keyFor('кот или пёс'));
  ok('K3: ключ детерминирован и без пробелов (иначе его не найти в списке KV)',
    m.keyFor('c 1') === m.keyFor('c 1') && m.keyFor('c 1').indexOf(' ') < 0 && !/^\./.test(m.keyFor('.hidden')), m.keyFor('c 1'));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
