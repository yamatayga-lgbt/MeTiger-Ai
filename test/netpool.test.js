/* 0.211 — сетевые «нитки», бюджеты длинных ответов и владельческий коридор.
   Проверяется не декларация «стало параллельнее», а наблюдаемые факты:
   сколько работ одновременно в полёте, сохранился ли порядок, дописался ли
   оборванный ответ несколько раз и не списывает ли владелец публичный запас. */

import { mapLimit, allLimit, netCfg, netStats } from '../engine/netpool.js';
import { fetchCatalog, forgetMemo, resetThrottle } from '../engine/modelreg.js';
import { createEngine, isTruncatedFinish } from '../engine/chat.js';
import { buildRequest } from '../engine/shape.js';
import { ownerHash } from '../engine/reports.js';
import { onRequestPost } from '../functions/api/chat.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra != null ? ' — ' + extra : '')); }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonResponse = (obj) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(obj),
  json: async () => obj,
});

console.log('N — ограниченный пул: параллельно, но порядок исходный');
{
  let active = 0;
  let maxActive = 0;
  const out = await mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(42 - n * 4);
    active--;
    return n * 2;
  });
  ok('N1: одновременно летят ровно три работы пула', maxActive === 3, String(maxActive));
  ok('N2: медленный первый результат не переставляет остальные', out.join(',') === '0,2,4,6,8,10,12,14', out.join(','));

  const jobs = await allLimit([
    async () => { await delay(25); return 'первый'; },
    async () => 'второй',
    async () => { await delay(5); return 'третий'; },
  ], 2);
  ok('N3: allLimit тоже возвращает исходный порядок', jobs.join('/') === 'первый/второй/третий', jobs.join('/'));

  const d = netCfg({});
  const e = netCfg({ NET_CATALOG_THREADS: '99', NET_DOC_THREADS: '0', NET_PREFETCH_THREADS: 'x' });
  ok('N4: дефолты пула — каталог 4, документы 3, предчтения 3', d.catalog === 4 && d.docs === 3 && d.prefetch === 3, JSON.stringify(d));
  ok('N5: env-ручки зажаты в разумные рамки, мусор не ломает пул', e.catalog === 8 && e.docs === 1 && e.prefetch === 3, JSON.stringify(e));
  ok('N6: диагностика называет ширину всех трёх пулов словами', /каталог ×4/.test(netStats({}).line) && /документы ×3/.test(netStats({}).line), netStats({}).line);
}

console.log('C — каталог моделей: источники параллельно, сборка в прежнем порядке');
{
  forgetMemo(); resetThrottle();
  let active = 0;
  let maxActive = 0;
  const delays = [
    [/groq/, 75, 'groq'],
    [/mistral/, 55, 'mistral'],
    [/kilo/, 35, 'kilo'],
    [/llm7/, 15, 'llm7'],
  ];
  const f = async (url) => {
    const row = delays.find((x) => x[0].test(String(url))) || delays[3];
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(row[1]);
    active--;
    return jsonResponse({ data: [{ id: row[2] + '/model', owned_by: row[2] }] });
  };
  const got = await fetchCatalog({
    env: { GROQ_KEYS: 'g', MISTRAL_KEYS: 'm' },
    fetchImpl: f,
    sleep: async () => {},
    sources: ['groq', 'mistral', 'kilo', 'llm7'],
    attempts: 1,
  });
  ok('C1: каталог реально держит несколько источников в полёте', maxActive >= 3, String(maxActive));
  ok('C2: порядок моделей остался порядком источников, а не гонки',
    got.models.map((m) => m.id).join(',') === 'groq/model,mistral/model,kilo/model,llm7/model',
    got.models.map((m) => m.id).join(','));
  ok('C3: карта прочитанных источников полна', got.read.groq && got.read.mistral && got.read.kilo && got.read.llm7, JSON.stringify(got.read));
}

console.log('D — большой документ: части читаются пулом и собираются по файлу');
{
  let active = 0;
  let maxActive = 0;
  let mapCalls = 0;
  const doc = Array.from({ length: 12 }, (_, i) => (
    'СЕКЦИЯ ' + i + '. Срок оплаты по этой секции — тридцать дней. '
    + 'Подробное описание условий, поставок, ответственности и порядка проверки. '.repeat(12)
  )).join('\n\n');
  const f = async (url, init) => {
    const body = JSON.parse(String((init && init.body) || '{}'));
    const sent = JSON.stringify(body.messages || body.contents || []);
    if (/начало фрагмента/.test(sent)) {
      mapCalls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(40);
      active--;
      return jsonResponse({ choices: [{ message: { content: 'Срок оплаты — тридцать дней.' }, finish_reason: 'stop' }] });
    }
    return jsonResponse({ choices: [{ message: { content: 'По документу срок оплаты — тридцать дней.' }, finish_reason: 'stop' }] });
  };
  const engine = createEngine({
    env: { GROQ_KEYS: 'g', CTX_WINDOW: '2000' },
    fetch: f,
    sleep: async () => {},
  });
  const r = await engine.run({
    text: 'Какой срок оплаты в документе?',
    docs: [{ name: 'договор.txt', line: 'txt', text: doc }],
    providerOrder: ['groq'],
    skills: false,
    useTools: false,
    noCouncils: true,
    deadlineMs: 30000,
  });
  ok('D1: документ прочитан несколькими частями', r.ok && mapCalls >= 3, JSON.stringify({ ok: r.ok, mapCalls, error: r.error }));
  ok('D2: части действительно overlap-ятся во времени', maxActive >= 2, String(maxActive));
  ok('D3: attempts считает части и финальную голову, а не только видимую очередь', r.attempts >= mapCalls + 1, JSON.stringify({ attempts: r.attempts, mapCalls }));
}

console.log('T — длинные ответы: бюджет по полосе и несколько продолжений');
{
  const cfg = { base: 'https://example.test/v1', keys: ['k'], kind: 'openai' };
  const fast = buildRequest({ cfg, keyIdx: 0, model: 'unknown-fast', provider: 'x', tier: 'fast', messages: [{ role: 'user', content: 'привет' }], system: '' });
  const smart = buildRequest({ cfg, keyIdx: 0, model: 'unknown-smart', provider: 'x', tier: 'smart', messages: [{ role: 'user', content: 'задача' }], system: '' });
  ok('T1: fast получает 1600 токенов вместо прежних 900', fast.body.max_tokens === 1600, String(fast.body.max_tokens));
  ok('T2: smart получает 4000 токенов вместо прежних 2000', smart.body.max_tokens === 4000, String(smart.body.max_tokens));
  ok('T3: обрыв узнаётся и как length, и как Gemini MAX_TOKENS',
    isTruncatedFinish('length') && isTruncatedFinish('MAX_TOKENS') && !isTruncatedFinish('stop'));

  const finishes = ['MAX_TOKENS', 'length', 'stop'];
  const parts = [
    'ПЕРВАЯ ЧАСТЬ длинного ответа с достаточным количеством текста.',
    'ВТОРАЯ ЧАСТЬ продолжает ровно с оборванного места.',
    'ТРЕТЬЯ ЧАСТЬ завершает ответ нормальной точкой.',
  ];
  let call = 0;
  const f = async () => {
    const i = Math.min(call++, 2);
    return jsonResponse({ choices: [{ message: { content: parts[i] }, finish_reason: finishes[i] }] });
  };
  const engine = createEngine({ env: { GROQ_KEYS: 'g' }, fetch: f, sleep: async () => {} });
  const r = await engine.run({
    text: 'Напиши длинный ответ',
    providerOrder: ['groq'],
    skills: false,
    useTools: false,
    noCouncils: true,
    noCheck: true,
    deadlineMs: 30000,
  });
  ok('T4: ответ дописан двумя продолжениями, а не одним',
    r.ok && r.continuations === 2 && /ПЕРВАЯ/.test(r.reply) && /ВТОРАЯ/.test(r.reply) && /ТРЕТЬЯ/.test(r.reply),
    JSON.stringify({ ok: r.ok, continuations: r.continuations, reply: r.reply }).slice(0, 220));
  ok('T5: финальный finish и точные попытки доезжают до вызывающего', r.finish === 'stop' && r.attempts === 3, JSON.stringify({ finish: r.finish, attempts: r.attempts }));
}

console.log('O — дверь: владелец мимо публичных счётчиков, остальные под ними');
{
  const code = 'netpool-owner-code';
  const hash = await ownerHash(code);
  const map = new Map();
  const kv = {
    async get(key, opts) {
      const v = map.get(key);
      if (v == null) return null;
      if (opts && opts.type === 'json') { try { return JSON.parse(v); } catch (e) { return null; } }
      return v;
    },
    async put(key, value) { map.set(key, String(value)); },
    async delete(key) { map.delete(key); },
    async list() { return { keys: Array.from(map.keys()).map((name) => ({ name })), list_complete: true }; },
  };
  const env = {
    GROQ_KEYS: 'g',
    MEMORY: kv,
    REPORT_OWNER_HASH: hash,
    RATE_MAX: '1',
    DAY_CAP: '1',
    DAY_CAP_CHUNK: '1',
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: 'Живой ответ тестового провайдера.' }, finish_reason: 'stop' }],
  });
  const call = async (ip, owner) => {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
    if (owner) headers['x-mt-owner'] = code;
    const res = await onRequestPost({
      request: new Request('https://metiger.test/api/chat', {
        method: 'POST', headers, body: JSON.stringify({ text: 'привет' }),
      }),
      env,
    });
    let payload = {};
    try { payload = await res.json(); } catch (e) { payload = {}; }
    return { status: res.status, payload };
  };
  try {
    const o1 = await call('198.51.100.211', true);
    const o2 = await call('198.51.100.211', true);
    ok('O1: владелец дважды проходит при RATE_MAX=1', o1.status === 200 && o2.status === 200, JSON.stringify([o1.status, o2.status]));
    ok('O2: ответ честно помечен owner-приоритетом', o2.payload.priority === 'owner', JSON.stringify(o2.payload).slice(0, 180));

    const p1 = await call('198.51.100.212', false);
    const p2 = await call('198.51.100.213', false);
    ok('O3: первый публичный запрос расходует единственный суточный резерв', p1.status === 200, JSON.stringify(p1).slice(0, 180));
    ok('O4: следующий публичный IP уже видит исчерпанный суточный запас', p2.status === 503, JSON.stringify(p2).slice(0, 220));

    const o3 = await call('198.51.100.214', true);
    ok('O5: владелец проходит и после исчерпания публичного запаса', o3.status === 200 && o3.payload.priority === 'owner', JSON.stringify(o3).slice(0, 220));
  } finally {
    globalThis.fetch = oldFetch;
  }
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
