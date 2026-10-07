/**
 * Расход провайдеров — engine/usage.js, врезка в движок и GET /api/usage.
 *
 * Сети нет: хранилище подменяется копией KV (get/put + expirationTtl), часы —
 * инъективные. Проверяются не «поля объекта», а грабли, из-за которых счётчику
 * нельзя верить: смена суток, второе устройство (изолят), пауза между записями,
 * упавшее хранилище и главная из них — read-modify-write, при котором один
 * изолят не имеет права стереть расход другого.
 *
 *   node test/usage.test.js
 */
import { createUsage, sharedUsage, resetSharedUsage, dayKeyOf, minuteOf, storeOf, USAGE_DAY_TTL_SEC } from '../engine/usage.js';
import { createEngine } from '../engine/chat.js';
import { onRequestGet as usageGet } from '../functions/api/usage.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Копия KV-байндинга: значения строками, TTL в секундах, отключаемый отказ.
 *  Форму значения отдаёт как настоящий KV: `get(key)` — строку, `get(key,'json')`
 *  — разобранный объект (на этом различии в проекте уже спотыкались). */
function fakeKv() {
  const map = new Map();
  const api = {
    get: async (key, type) => {
      api.reads++;
      const e = map.get(key);
      if (!e) return null;
      if (type === 'json') {
        try { return JSON.parse(e.value); } catch (err) { return null; }
      }
      return e.value;
    },
    put: async (key, value, opts) => {
      api.puts++;
      if (api.fail) throw new Error('KV недоступен');
      const ttl = opts && opts.expirationTtl;
      if (ttl != null && ttl < 60) throw new Error('expirationTtl too short');
      map.set(key, { value, ttl });
      api.lastPut = { key, value, ttl };
    },
    _map: map,
    reads: 0,
    puts: 0,
    fail: false,
    lastPut: null,
  };
  return api;
}

/* Часы теста: СЕГОДНЯШНИЕ сутки в 10:00 UTC, а не жёсткая дата.
   Дверь /api/usage читает расход под ключом сегодняшних суток (UTC), а трекер
   здесь пишет под ключом суток своих часов. Пока «сегодня» совпадало с
   зашитым 6 октября 2026, W7/W8 проходили; на следующий день ключи разошлись,
   и тест упал — «расход не доезжает до панели». Держим дату сегодняшней, а
   внутри прогона она по-прежнему одна и та же. */
const NOW0 = new Date();
const T0 = Date.UTC(NOW0.getUTCFullYear(), NOW0.getUTCMonth(), NOW0.getUTCDate(), 10, 0, 0);

console.log('U — счётчик сам по себе');
{
  let t = T0;
  const kv = fakeKv();
  const env = { USAGE_STORE: kv };
  const u = createUsage({ env, now: () => t });

  ok('U1: ключ суток и минуты считаются по UTC, а не по браузеру',
    /* Отдельная, намеренно жёсткая дата: здесь проверяется САМА функция ключа суток,
       а не хранилище — такая проверка не стареет вместе с календарём. */
    dayKeyOf(Date.UTC(2026, 9, 6, 10, 0, 0)) === '2026-10-06' && minuteOf(T0) === Math.floor(T0 / 60000));

  u.attempt('groq', 'qwen/qwen3.8-27b');
  u.attempt('groq', 'qwen/qwen3.8-27b');
  u.outcome('groq', 'ok');
  u.outcome('groq', 'refused');
  u.attempt('gemini', 'gemini-2.5-flash');
  u.outcome('gemini', 'dead');
  const s1 = u.snapshot();
  ok('U2: попытки и исходы копятся по провайдеру, а не одним общим числом',
    s1.providers.groq.attempt === 2 && s1.providers.groq.ok === 1 && s1.providers.groq.refused === 1
      && s1.providers.gemini.attempt === 1 && s1.providers.gemini.dead === 1,
    JSON.stringify(s1.providers));
  ok('U3: в срез входит модель последней попытки — по ней видно, кто отвечал',
    s1.providers.groq.model === 'qwen/qwen3.8-27b' && s1.providers.gemini.model === 'gemini-2.5-flash');
  ok('U4: в срезе есть справочные потолки «в минуту» и честная пауза записи',
    s1.rpm.groq === 30 && s1.writeMs === 30000 && s1.store === true && s1.off === false);

  ok('U5: ничего не записано, пока не позвали flush (обычный срез в KV не ходит)',
    kv.puts === 0 && s1.dirty === true && s1.unsaved === 2);

  const w1 = await u.flush();
  ok('U6: первая запись проходит и уносит обе строки, TTL — двое суток',
    w1.written === true && w1.rows === 2 && kv.puts === 1 && kv.lastPut.ttl === USAGE_DAY_TTL_SEC,
    JSON.stringify(w1));
  ok('U7: после записи пачка пуста — второй flush писать нечего',
    (await u.flush()).written === false && kv.puts === 1);

  u.attempt('groq', 'qwen/qwen3.8-27b');
  ok('U8: пауза между записями держится (иначе счётчик съел бы квоту KV)',
    (await u.flush()).written === false && kv.puts === 1);
  t += 31000;
  ok('U9: через полминуты пачка уезжает сама, без force',
    (await u.flush()).written === true && kv.puts === 2);

  /* Записанное не двоится: base уже содержит наши же числа. */
  const s2 = u.snapshot();
  ok('U10: свои же записанные числа не считаются дважды',
    s2.providers.groq.attempt === 3, JSON.stringify(s2.providers.groq));
}

console.log('U2 — минута, сутки, второй изолят');
{
  let t = T0;
  const kv = fakeKv();
  const u = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  u.attempt('groq', 'm');
  u.attempt('groq', 'm');
  u.attempt('groq', 'm');
  ok('U11: «в минуту» видит три запроса сразу после трёх попыток', u.snapshot().providers.groq.minute === 3);
  t += 61000;
  ok('U12: окно минуты скользящее — прошлое не считаем',
    u.snapshot().providers.groq.minute === 0);
  u.attempt('groq', 'm');
  ok('U13: новая попытка снова попадает в минуту', u.snapshot().providers.groq.minute === 1);

  /* Второй изолят: читает чужое и не стирает его своей записью. */
  const A = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  A.attempt('gemini', 'g-m');
  A.outcome('gemini', 'ok');
  await A.flush({ force: true });
  const B = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  await B.pull({ force: true });
  ok('U14: второй изолят видит расход первого', B.snapshot().providers.gemini.attempt === 1);
  B.attempt('mistral', 'mi-m');
  await B.flush({ force: true });
  const C = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  await C.pull({ force: true });
  const sc = C.snapshot();
  ok('U15: запись второго изолята не стёрла расход первого (read-modify-write)',
    sc.providers.gemini.attempt === 1 && sc.providers.mistral.attempt === 1,
    JSON.stringify(sc.providers));

  /* Минутная марка: видна и тому, кто читает из хранилища, причём до конца своей минуты. */
  const kvw = fakeKv();
  let tw = T0;
  const W = createUsage({ env: { USAGE_STORE: kvw }, now: () => tw });
  W.attempt('groq', 'm');
  await W.flush({ force: true });
  const R1 = createUsage({ env: { USAGE_STORE: kvw }, now: () => tw });
  await R1.pull({ force: true });
  ok('U19: «в минуту» видно и читающему из хранилища, а не только своему изоляту',
    R1.snapshot().providers.groq.minute === 1);
  tw += 31000;
  const R2 = createUsage({ env: { USAGE_STORE: kvw }, now: () => tw });
  await R2.pull({ force: true });
  ok('U20: через 31 секунду число ещё видно — марка не устаревает раньше минуты',
    R2.snapshot().providers.groq.minute === 1);
  tw += 40000;
  const R3 = createUsage({ env: { USAGE_STORE: kvw }, now: () => tw });
  await R3.pull({ force: true });
  ok('U21: старше минуты — ноль, но расход за день остался',
    R3.snapshot().providers.groq.minute === 0 && R3.snapshot().providers.groq.attempt === 1);

  /* Смена суток */
  const day1 = C.snapshot().day;
  t += 20 * 3600 * 1000;   /* уже следующие сутки UTC */
  const s = C.snapshot();
  ok('U16: сутки сменились — счёт начинается заново, чужой расход не переносится',
    s.day !== day1 && s.totals.attempt === 0, s.day + ' vs ' + day1 + ' · attempt=' + s.totals.attempt);

  /* Пауза (карантин провайдера) — тоже через хранилище */
  const D = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  D.pause('zai', 'ключ не принят (http 401)', 600000);
  await D.flush({ force: true });
  const E = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  await E.pull({ force: true });
  const pe = E.snapshot().providers.zai;
  ok('U17: пауза видна во втором изоляте и знает причину',
    !!pe.pause && pe.pause.until > t && /401/.test(pe.pause.why), JSON.stringify(pe));
  t += 700000;
  ok('U18: истёкшую паузу срез больше не показывает', E.snapshot().providers.zai.pause === null);
}

console.log('U3 — отказы окружения');
{
  let t = T0;
  const u = createUsage({ env: {}, now: () => t });
  u.attempt('groq', 'm');
  const s = u.snapshot();
  const w = await u.flush();
  ok('U22: без хранилища счёт живёт в памяти, а запись честно объясняет отказ',
    s.store === false && s.providers.groq.attempt === 1 && w.written === false && /MEMORY/.test(w.why),
    JSON.stringify(w));

  const off = createUsage({ env: { USAGE: '0', USAGE_STORE: fakeKv() }, now: () => t });
  off.attempt('groq', 'm');
  off.outcome('groq', 'ok');
  const so = off.snapshot();
  const wo = await off.flush();
  ok('U23: USAGE=0 выключает слой целиком — ни счёта, ни записи',
    so.off === true && so.totals.attempt === 0 && wo.written === false && /USAGE=0/.test(wo.why),
    JSON.stringify(so.totals));

  const kv = fakeKv();
  kv.fail = true;
  const f = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  f.attempt('groq', 'm');
  f.outcome('groq', 'ok');
  const wf = await f.flush({ force: true });
  ok('U24: упавшее хранилище не теряет пачку — она остаётся незаписанной',
    wf.written === false && /отказало/.test(wf.why) && f.snapshot().providers.groq.attempt === 1,
    JSON.stringify(wf));
  kv.fail = false;
  ok('U25: хранилище ожило — та же пачка уезжает целиком',
    (await f.flush({ force: true })).written === true && f.snapshot().providers.groq.ok === 1);

  /* Потолок записей: счётчик не имеет права съесть бюджет KV, который считает. */
  const kv3 = fakeKv();
  let t3 = T0;
  const capped = createUsage({ env: { USAGE_STORE: kv3, USAGE_WRITE_MAX: '2' }, now: () => t3 });
  for (let i = 0; i < 3; i++) {
    capped.attempt('groq', 'm');
    t3 += 31000;
    await capped.flush();
  }
  ok('U27: после потолка записей слой остаётся считать, но в KV больше не пишет',
    kv3.puts === 2 && capped.snapshot().providers.groq.attempt === 3,
    JSON.stringify({ puts: kv3.puts, attempt: capped.snapshot().providers.groq.attempt }));

  ok('U26: storeOf принимает и настоящую форму KV, и уже разобранный объект',
    storeOf({ MEMORY: { get: async () => '{"a":1}', put: async () => {} } }) !== null
      && storeOf({}) === null);
  ok('U28: общий слой на изолят создаётся один раз (иначе пауза записи не работает)',
    (() => { resetSharedUsage(); const a = sharedUsage({}, null); const b = sharedUsage({}, null); resetSharedUsage(); return a === b; })());
}

console.log('V — врезка в движок');
{
  const chat = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
  const fakeFetch = (script) => {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const out = script(url, calls.length - 1);
      return { status: out.status == null ? 200 : out.status, text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)) };
    };
    impl.calls = calls;
    return impl;
  };

  let t = T0;
  const ENV = { GROQ_KEYS: 'g1' };
  const track = createUsage({ env: ENV, store: null, now: () => t });
  const e = createEngine({ env: ENV, fetch: fakeFetch(() => ({ body: chat('Привет! Я на связи.') })), sleep: async () => {}, usage: track, quarantine: new Map() });
  const r = await e.run({ text: 'привет, как дела' });
  const s = track.snapshot();
  const row = s.providers[r.provider] || {};
  ok('V1: живой ответ засчитан как попытка и как успех',
    r.ok === true && row.attempt >= 1 && row.ok >= 1 && s.totals.ok === row.ok && s.totals.attempt >= 1,
    JSON.stringify(s.totals));
  ok('V2: записан и адрес модели, по которой отвечали', !!row.model && row.model === r.model, row.model);
  ok('V3: срез движка и счётчик — одно и то же число',
    typeof e.usageStats === 'function' && e.usageStats().totals.attempt === s.totals.attempt);

  /* 429 — расход и сбой; 401 — ещё и пауза с причиной */
  const t2 = createUsage({ env: ENV, store: null, now: () => t });
  const e2 = createEngine({
    env: ENV,
    fetch: fakeFetch(() => ({ status: 429, body: { error: 'rate limit' } })),
    sleep: async () => {}, usage: t2, quarantine: new Map(),
  });
  await e2.run({ text: 'привет' });
  const s2 = t2.snapshot().providers.groq || {};
  ok('V4: 429 — это попытка и сбой, а не тишина', s2.attempt >= 1 && s2.dead >= 1, JSON.stringify(s2));

  const t3 = createUsage({ env: ENV, store: null, now: () => t });
  const e3 = createEngine({
    env: ENV,
    fetch: fakeFetch(() => ({ status: 401, body: { error: 'bad key' } })),
    sleep: async () => {}, usage: t3, quarantine: new Map(),
  });
  await e3.run({ text: 'привет' });
  const s3 = t3.snapshot().providers.groq || {};
  ok('V5: мёртвый ключ оставляет в панели паузу с причиной, а не «провайдер молчит»',
    !!s3.pause && /401/.test(s3.pause.why) && s3.pause.until > t, JSON.stringify(s3.pause));
}

console.log('W — дверь GET /api/usage');
{
  const ctx = () => ({
    env: { GROQ_KEYS: 'g1,g2', GEMINI_KEYS: 'gm1', NOKEY_KEYS: '' },
    request: new Request('https://metiger-ai.pages.dev/api/usage'),
  });
  const res = await usageGet(ctx());
  const data = await res.json();
  ok('W1: ответ есть всегда и в нём есть счёт, потолки и сноска точности',
    data.ok === true && !!data.totals && !!data.precision && /изолят/i.test(data.precision.note),
    JSON.stringify(data).slice(0, 180));
  const groq = data.providers.find((p) => p.id === 'groq');
  ok('W2: суточный потолок берётся из таблицы провайдеров, остаток посчитан',
    groq && groq.dayLimit === 1000 && groq.remaining === 1000 && groq.rpm === 30 && groq.live === true,
    JSON.stringify(groq));
  /* 0.094/0.096: Cerebras (платный) и «Локальная модель» (нужен свой сервер) убраны
     из продукта целиком — в панели расхода их строк тоже быть не должно. */
  ok('W3a: в панели расхода нет ни Cerebras, ни «Локальной модели» — убранные провайдеры не висят в счёте',
    !data.providers.some((p) => p.id === 'local') && !data.providers.some((p) => /Cerebras/i.test(p.label || '')),
    data.providers.map((p) => p.id).join(','));
  /* 0.097: пулы-дублёры. В панели у них свои ставки, и OVHcloud включается
     словом keyless — без него провайдера в очереди нет вовсе. */
  ok('W3b: у пулов-дублёров 0.097 свои ставки в панели, а не чужие',
    data.providers.some((p) => p.id === 'nvidia' && p.rpm === 40)
      && data.providers.some((p) => p.id === 'sambanova' && p.rpm === 20)
      && data.providers.some((p) => p.id === 'github' && p.rpm === 15)
      && data.providers.some((p) => p.id === 'ovh' && p.rpm === 2),
    data.providers.filter((p) => ['nvidia', 'sambanova', 'github', 'ovh'].includes(p.id)).map((p) => p.id + ':' + p.rpm).join(','));

  const ovhCtx = () => ({
    env: { OVH_KEYS: 'keyless' },
    request: new Request('https://metiger-ai.pages.dev/api/usage'),
  });
  const ovhData = await (await usageGet(ovhCtx())).json();
  const row = ovhData.providers.find((p) => p.id === 'ovh');
  /* live:true — «в очереди и с ключом»; сам ответ может быть 429 сколько угодно
     раз, это видно в счёте попыток, а не в этой строке. */
  ok('W3c: OVHcloud со словом keyless — живой провайдер с одним ключом',
    !!row && row.keys === 1 && row.live === true && row.dayLimit === 500,
    JSON.stringify(row));

  ok('W3: провайдер без ключа виден, но помечен как выпавший',
    data.providers.some((p) => p.id === 'openrouter' && p.live === false && p.keys === 0));
  ok('W4: ставка на человека видна и честно говорит, когда общего хранилища нет',
    data.rate.max === 12 && data.rate.on === false && /MEMORY/.test(data.rate.why) && data.kv === false,
    JSON.stringify(data.rate));
  ok('W5: ответ не кэшируется — иначе «живой» счётчик показывал бы вчерашнее',
    res.headers.get('cache-control') === 'no-store' && res.headers.get('access-control-allow-origin') === '*');
  ok('W6: потолок записей в KV виден наружу — панель подписывает им свою точность',
    data.precision.writeCap === 300, JSON.stringify(data.precision));
  ok('W6b: сутки UTC и время до сброса посчитаны',
    data.tz === 'UTC' && /^\d{4}-\d{2}-\d{2}$/.test(data.day) && data.resetInMs > 0 && data.resetInMs <= 86400000,
    data.day + ' · ' + data.resetInMs);

  /* С KV: расход, записанный движком, виден двери */
  const kv = fakeKv();
  let t = T0;
  const track = createUsage({ env: { USAGE_STORE: kv }, now: () => t });
  track.attempt('groq', 'qwen/qwen3.8-27b');
  track.outcome('groq', 'ok');
  track.attempt('groq', 'qwen/qwen3.8-27b');
  track.outcome('groq', 'refused');
  await track.flush({ force: true });
  const kvEnv = { GROQ_KEYS: 'g1', MEMORY: kv };
  const res2 = await usageGet({ env: kvEnv, request: new Request('https://metiger-ai.pages.dev/api/usage?refresh=1') });
  const data2 = await res2.json();
  const g2 = data2.providers.find((p) => p.id === 'groq');
  ok('W7: расход из хранилища доезжает до панели: 2 запроса, 1 ответ, 1 отказ, остаток 998',
    data2.kv === true && data2.rate.on === true && g2.attempt === 2 && g2.ok === 1 && g2.refused === 1 && g2.remaining === 998,
    JSON.stringify({ kv: data2.kv, rate: data2.rate, groq: g2 }));
  ok('W8: доля израсходованного посчитана для полосы в панели',
    g2.pct === 0 && g2.lastAt > 0 && g2.model === 'qwen/qwen3.8-27b', JSON.stringify({ pct: g2.pct, lastAt: g2.lastAt }));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
process.exit(fail ? 1 : 0);
