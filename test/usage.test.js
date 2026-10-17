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
import { createUsage, sharedUsage, resetSharedUsage, dayKeyOf, minuteOf, poolOf, storeOf, USAGE_DAY_TTL_SEC } from '../engine/usage.js';
import { createEngine } from '../engine/chat.js';
import { ownerHash } from '../engine/reports.js';
import { createDayCap, capCfg, capDayOf, msToUtcMidnight, DAY_CAP_DEFAULT } from '../engine/daycap.js';
import { onRequestGet as usageGet } from '../functions/api/usage.js';
import { onRequestPost as chatPost } from '../functions/api/chat.js';

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
  /* 0.202: дверь двухъярусная. Без кода владельца — «жив/лимит» (процент и сброс),
     с кодом — полная раскладка. Код в тесте подставной: отпечаток сверяется через
     env.REPORT_OWNER_HASH, как у «Ведомства», а сам код — только здесь. */
  const OWNER = 'W-OWNER-1';
  const OWNER_HASH = await ownerHash(OWNER);
  const ENV_W = { GROQ_KEYS: 'g1,g2', GEMINI_KEYS: 'gm1', NOKEY_KEYS: '', REPORT_OWNER_HASH: OWNER_HASH };
  const H = { 'x-mt-owner': OWNER };
  const ctx = (headers) => ({
    env: ENV_W,
    request: new Request('https://metiger-ai.pages.dev/api/usage', { headers: headers || {} }),
  });
  const res = await usageGet(ctx(H));
  const data = await res.json();
  ok('W1: ответ есть всегда и в нём есть счёт, потолки и сноска точности',
    data.ok === true && !!data.totals && !!data.precision && /изолят/i.test(data.precision.note),
    JSON.stringify(data).slice(0, 180));
  {
    const open = await (await usageGet(ctx())).json();
    ok('W1b: публичный ответ — процент запаса и время сброса, и больше ничего',
      open.ok === true && open.scope === 'public'
        && typeof open.pool.pct === 'number'
        && open.cap && typeof open.cap.resetInMs === 'number'
        && !open.providers && !open.totals && !open.failover && !open.precision
        && !('kv' in open) && !('rate' in open),
      JSON.stringify(open).slice(0, 220));
    ok('W1c: в публичном ответе нет ни одного имени провайдера и ни одного ключа',
      !/groq|gemini|openrouter|llm7|kilo|keys|балл/i.test(JSON.stringify(open)),
      JSON.stringify(open).slice(0, 220));
    const wrong = await (await usageGet(ctx({ 'x-mt-owner': 'NOT-THE-CODE' }))).json();
    ok('W1d: неверный код не открывает раскладку — падает в публичный ярус',
      wrong.scope === 'public' && !wrong.providers, 'scope=' + wrong.scope);
    const url = new Request('https://metiger-ai.pages.dev/api/usage?code=' + encodeURIComponent(OWNER));
    const byUrl = await (await usageGet({ env: ENV_W, request: url })).json();
    ok('W1e: curl получает раскладку тем же кодом через ?code= — заголовки не обязательны',
      byUrl.scope === 'owner' && Array.isArray(byUrl.providers) && byUrl.providers.length > 0,
      'scope=' + byUrl.scope);
  }
  const groq = data.providers.find((p) => p.id === 'groq');
  ok('W2: суточный потолок берётся из таблицы провайдеров, остаток посчитан',
    groq && groq.dayLimit === 1000 && groq.remaining === 1000 && groq.rpm === 30 && groq.live === true,
    JSON.stringify(groq));
  /* 0.094/0.096: Cerebras (платный) и «Локальная модель» (нужен свой сервер) убраны
     из продукта целиком — в панели расхода их строк тоже быть не должно. */
  ok('W3a: в панели расхода нет ни Cerebras, ни «Локальной модели» — убранные провайдеры не висят в счёте',
    !data.providers.some((p) => p.id === 'local') && !data.providers.some((p) => /Cerebras/i.test(p.label || '')),
    data.providers.map((p) => p.id).join(','));
  /* 0.099: пулы-дублёры. LLM7 и Kilo работают без ключа вовсе (keyless) — им
     ключ не нужен, поэтому в панели у них нулевые ключи и свои ставки. */
  ok('W3b: у пулов-дублёров 0.099 свои ставки в панели, а не чужие',
    data.providers.some((p) => p.id === 'llm7' && p.rpm === 15)
      && data.providers.some((p) => p.id === 'kilo' && p.rpm === 10)
      /* 0.103: SambaNova и GitHub Models убраны из продукта целиком — их не должно
         быть ни в списке провайдеров, ни в счётчиках. */
      && !data.providers.some((p) => ['sambanova', 'github'].includes(p.id)),
    data.providers.filter((p) => ['llm7', 'kilo'].includes(p.id)).map((p) => p.id + ':' + p.rpm).join(','));

  /* 0.100: подхват — имена, живущие у двух и более провайдеров. Без него блок
     «Подхват» в панели было бы нечем наполнить, а это обещание, которое человек
     читает: «отказ провайдера не оставит без ответа». */
  ok('W3d: панель знает про подхват — есть имена у двух провайдеров и примеры к ним',
    !!data.failover && data.failover.count >= 1
      && Array.isArray(data.failover.sample) && data.failover.sample.length >= 1
      && data.failover.sample.every((x) => x.model && Array.isArray(x.providers) && x.providers.length >= 2),
    JSON.stringify(data.failover && { count: data.failover.count, first: data.failover.sample && data.failover.sample[0] }).slice(0, 200));

  const klCtx = () => ({
    env: { REPORT_OWNER_HASH: OWNER_HASH },
    request: new Request('https://metiger-ai.pages.dev/api/usage', { headers: H }),
  });
  const klData = await (await usageGet(klCtx())).json();
  const row = klData.providers.find((p) => p.id === 'llm7');
  /* keyless: ноль ключей — не «выпал», а нормальный режим; квота дня из таблицы. */
  ok('W3c: LLM7 без ключей — живой провайдер, а не выпавший',
    !!row && row.keys === 0 && row.live === true && row.dayLimit === 1000,
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
  const res2 = await usageGet({ env: Object.assign({ REPORT_OWNER_HASH: OWNER_HASH }, kvEnv), request: new Request('https://metiger-ai.pages.dev/api/usage?refresh=1', { headers: H }) });
  const data2 = await res2.json();
  const g2 = data2.providers.find((p) => p.id === 'groq');
  ok('W7: расход из хранилища доезжает до панели: 2 запроса, 1 ответ, 1 отказ, остаток 998',
    data2.kv === true && data2.rate.on === true && g2.attempt === 2 && g2.ok === 1 && g2.refused === 1 && g2.remaining === 998,
    JSON.stringify({ kv: data2.kv, rate: data2.rate, groq: g2 }));
  ok('W8: доля израсходованного посчитана для полосы в панели',
    g2.pct === 0 && g2.lastAt > 0 && g2.model === 'qwen/qwen3.8-27b', JSON.stringify({ pct: g2.pct, lastAt: g2.lastAt }));
}

console.log('X — общий запас агента (0.179)');
{
  /* Счёт запаса: живые источники складываются, мёртвые — нет. Это то, что человек
     видит в кольце в шапке, поэтому проверяем на числах, а не на «поле есть». */
  const p0 = poolOf([]);
  ok('X1: нет живых источников — запаса нет, а не «100 %»',
    p0.capacity === 0 && p0.remaining === 0 && p0.pct === null && p0.live === 0,
    JSON.stringify(p0));

  const p1 = poolOf([
    { live: true, dayLimit: 1000, attempt: 100 },
    { live: true, dayLimit: 250, attempt: 25 },
    { live: false, dayLimit: 1000, attempt: 900 },   /* нет ключа — не запас */
    { live: true, dayLimit: 0, attempt: 0 },          /* потолка нет — тоже не запас */
  ]);
  ok('X2: потолки живых сложены, расход вычтен, мёртвые и беспотолочные не в счёте',
    p1.live === 2 && p1.capacity === 1250 && p1.used === 125 && p1.remaining === 1125
      && Math.abs(p1.pct - 90) < 0.001,
    JSON.stringify(p1));

  /* Числа как на живом проде: потолок 9 900, расход 112 — 98,8686 % остатка.
     Целые проценты на таком запасе стояли бы «на 99 %» неделями, и владелец просил
     именно десятые («только проценты до сотых: 100.0 %, 91,2 %»). */
  const p2 = poolOf([{ live: true, dayLimit: 1000, attempt: 5 }, { live: true, dayLimit: 8900, attempt: 107 }]);
  ok('X3: доля остатка считается с десятыми — «на большом запасе целые стоят на месте»',
    p2.capacity === 9900 && p2.used === 112 && Math.abs(p2.pct - 98.8686) < 0.01 && !Number.isInteger(p2.pct),
    JSON.stringify(p2));

  const p3 = poolOf([{ live: true, dayLimit: 100, attempt: 400 }]);
  ok('X4: расход сверх потолка не уводит процент в минус',
    p3.remaining === 0 && p3.pct === 0);

  /* Дверь: та же цифра наружу, и она сходится с строками провайдеров, которые
     панель показывает рядом. */
  /* 0.202: раскладка по провайдерам — только по коду владельца, поэтому дверь
     зовём с подставным отпечатком и заголовком. */
  const OWNER_X = 'W-OWNER-1';
  const OWNER_X_HASH = await ownerHash(OWNER_X);
  const OWNER_HDR = { 'x-mt-owner': OWNER_X };
  const data3 = await (await usageGet({ env: { GROQ_KEYS: 'g1', MEMORY: fakeKv(), REPORT_OWNER_HASH: OWNER_X_HASH }, request: new Request('https://metiger-ai.pages.dev/api/usage', { headers: OWNER_HDR }) })).json();
  const живой = data3.providers.filter((r) => r.live && r.dayLimit > 0);
  const cap = живой.reduce((a, r) => a + r.dayLimit, 0);
  const used = живой.reduce((a, r) => a + r.attempt, 0);
  ok('X5: дверь отдаёт запас готовым и он сходится со строками провайдеров',
    !!data3.pool && data3.pool.capacity === cap && data3.pool.used === used
      && data3.pool.remaining === Math.max(0, cap - used)
      && data3.pool.live === живой.length
      && (cap ? Math.abs(data3.pool.pct - (Math.max(0, cap - used) / cap) * 100) < 0.001 : data3.pool.pct === null),
    JSON.stringify(data3.pool));

  /* Своё хранилище и свой трекер: два запроса к groq уезжают в KV, а дверь их
     видит — так проверяется не только счёт, но и то, что кольцо смотрит на расход,
     а не на выдуманный ноль. */
  const kvX = fakeKv();
  const tx = createUsage({ env: { USAGE_STORE: kvX }, now: () => T0 });
  tx.attempt('groq', 'qwen/qwen3.8-27b');
  tx.outcome('groq', 'ok');
  tx.attempt('groq', 'qwen/qwen3.8-27b');
  tx.outcome('groq', 'refused');
  await tx.flush({ force: true });
  const data4 = await (await usageGet({ env: { GROQ_KEYS: 'g1', MEMORY: kvX, REPORT_OWNER_HASH: OWNER_X_HASH }, request: new Request('https://metiger-ai.pages.dev/api/usage?refresh=1', { headers: OWNER_HDR }) })).json();
  ok('X6: после двух запросов запас в кольце меньше ровно на два',
    data4.pool.used === 2 && data4.pool.remaining === data4.pool.capacity - 2
      && data4.pool.pct < 100 && data4.pool.pct > 99,
    JSON.stringify(data4.pool));
}

console.log('Y — суточный потолок агента (0.202)');
{
  /** Хранилище в форме, которую ждёт engine/daycap.js: JSON на чтении, TTL на записи. */
  const storeOfKv = (kv) => ({
    get: (k) => kv.get(k, 'json'),
    put: (k, v, ttl) => kv.put(k, JSON.stringify(v), { expirationTtl: ttl }),
  });
  const DAY0 = Date.parse('2026-10-17T10:00:00Z');

  /* Y1: умолчания. Потолок ниже ёмкости пула (~9 900) нарочно: атомарного счётчика
     у KV нет, два изолята могут прочитать одно число — запас на это и оставлен. */
  const c0 = capCfg({});
  ok('Y1: по умолчанию потолок включён, 9 000 попыток в сутки, кусками по 50',
    c0.on === true && c0.max === DAY_CAP_DEFAULT && c0.max === 9000 && c0.chunk === 50,
    JSON.stringify(c0));

  /* Y2: тумблер владельца. Выключенный потолок не должен отказывать никому. */
  const cOff = createDayCap({ env: { DAY_CAP_OFF: '1' }, store: null, now: () => DAY0 });
  const off1 = await cOff.check();
  ok('Y2: DAY_CAP_OFF=1 — потолка нет, дверь открыта, счёт молчит',
    cOff.cfg.on === false && off1.allowed === true && off1.max === 0 && (await cOff.take(50)).used === 0);

  /* Y3: главное. За 100 попыток — ОДНА запись в KV, а не сто: иначе бесплатные
     1 000 записей в сутки кончились бы на первой сотне вопросов. */
  const kv3 = fakeKv();
  const cap3 = createDayCap({ env: { DAY_CAP: 500, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv3), now: () => DAY0 });
  await cap3.check();
  for (let i = 0; i < 99; i++) await cap3.take(1);
  /* «Израсходовано» в панели — это взятое из запаса, а не только потраченное:
     резерв уже отнят у всех, даже если изолят его ещё не истратил. Отсюда 400, а
     не 401 — впереди расхода не больше одного куска. */
  ok('Y3: за 99 попыток расход в KV — одна запись резерва, а не 99',
    kv3.puts === 1 && cap3.stats().spent === 99 && cap3.state().remaining === 400,
    JSON.stringify(cap3.stats()));
  await cap3.take(1);
  await cap3.check();
  ok('Y3b: кусок кончился — резервируется следующий, второй записью',
    kv3.puts === 2 && cap3.state().used === 200 && cap3.state().remaining === 300,
    JSON.stringify({ puts: kv3.puts, st: cap3.state() }));

  /* Y4: два изолята — один запас. Второй видит резерв первого: 100 + 100. */
  const kv4 = fakeKv();
  const a4 = createDayCap({ env: { DAY_CAP: 500, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv4), now: () => DAY0 });
  const b4 = createDayCap({ env: { DAY_CAP: 500, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv4), now: () => DAY0 });
  await a4.check();
  const b4s = await b4.check();
  /* «Израсходовано» = взято из запаса: первый изолят взял 100, второй увидел это
     и взял свои 100 — в хранилище 200, и оба не могут перевалить за max. */
  ok('Y4: второй изолят видит резерв первого и берёт свой — потолок общий, а не на адрес',
    b4s.used === 200 && b4s.remaining === 300, JSON.stringify(b4s));

  /* Y5: исчерпание. max 150: первому достанется 100, второму — остаток 50,
     третьему — отказ с временем сброса. */
  const kv5 = fakeKv();
  const mk5 = () => createDayCap({ env: { DAY_CAP: 150, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv5), now: () => DAY0 });
  const e1 = await mk5().check();
  const e2 = await mk5().check();
  const e3 = await mk5().check();
  ok('Y5: последний кусок не больше остатка — 100 + 50, потом честный отказ',
    e1.allowed === true && e1.used === 100
      && e2.allowed === true && e2.used === 150 && e2.remaining === 0
      && e3.allowed === false && e3.blocked === true,
    JSON.stringify({ e1: e1.used, e2: e2.used, e3: e3.used, allowed: e3.allowed }));
  ok('Y5b: отказ знает время сброса и сутки, а не «попробуйте позже»',
    e3.resetInMs === msToUtcMidnight(DAY0) && e3.day === capDayOf(DAY0) && e3.day === '2026-10-17',
    JSON.stringify({ resetInMs: e3.resetInMs, day: e3.day }));

  /* Y6: смена суток UTC — запас открывается заново, ключ другой. */
  let now6 = Date.parse('2026-10-17T23:59:00Z');
  const kv6 = fakeKv();
  const cap6 = createDayCap({ env: { DAY_CAP: 100, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv6), now: () => now6 });
  await cap6.check();
  await cap6.take(100);
  const before = await cap6.check();
  now6 = Date.parse('2026-10-18T00:01:00Z');
  const after = await cap6.check();
  ok('Y6: полночь UTC открывает запас заново и пишет под новый ключ',
    before.allowed === false && before.day === '2026-10-17'
      && after.allowed === true && after.day === '2026-10-18'
      && kv6._map.has('cap:v1:2026-10-17') && kv6._map.has('cap:v1:2026-10-18'),
    JSON.stringify({ before: before.allowed, after: after.allowed, day: after.day, keys: [...kv6._map.keys()] }));

  /* Y7: упавшее хранилище НЕ выключает агента: считаем локально, помечаем degraded.
     Лучше ответить человеку, чем соврать про «лимит кончился» из-за KV. */
  const bad = { get: async () => { throw new Error('KV недоступен'); }, put: async () => { throw new Error('KV недоступен'); } };
  const cap7 = createDayCap({ env: { DAY_CAP: 20, DAY_CAP_CHUNK: 10 }, store: bad, now: () => DAY0 });
  const ok7 = await cap7.check();
  await cap7.take(20);
  const out7 = await cap7.check();
  ok('Y7: без хранилища агент отвечает, но потолок держится по памяти изолята',
    ok7.allowed === true && cap7.state().degraded === true
      && out7.allowed === false && out7.used === 20,
    JSON.stringify({ degraded: cap7.state().degraded, used: out7.used, allowed: out7.allowed }));

  /* Y8: списание больше остатка куска само добирает резерв — ответ из 3 попыток
     не должен терять две из-за того, что кусок был на 1. */
  const kv8 = fakeKv();
  const cap8 = createDayCap({ env: { DAY_CAP: 500, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv8), now: () => DAY0 });
  const s8 = await cap8.take(150);
  ok('Y8: списание пачки добирает резерв — 150 попыток учтены, не потеряны',
    s8.used === 200 && kv8.puts === 2 && cap8.stats().spent === 150,
    JSON.stringify({ used: s8.used, puts: kv8.puts, spent: cap8.stats().spent }));

  /* Y9: дверь показывает тот же потолок: владельцу — числа, публике — процент. */
  const kv9 = fakeKv();
  const cap9 = createDayCap({ env: { DAY_CAP: 1000, DAY_CAP_CHUNK: 100 }, store: storeOfKv(kv9), now: () => DAY0 });
  await cap9.check();
  await cap9.take(250);
  const OWNER9 = 'Y-OWNER-1';
  const H9 = { 'x-mt-owner': OWNER9 };
  const E9 = { GROQ_KEYS: 'g1', MEMORY: kv9, REPORT_OWNER_HASH: await ownerHash(OWNER9), DAY_CAP: 1000 };
  const open9 = await (await usageGet({ env: E9, request: new Request('https://metiger-ai.pages.dev/api/usage') })).json();
  const own9 = await (await usageGet({ env: E9, request: new Request('https://metiger-ai.pages.dev/api/usage', { headers: H9 }) })).json();
  ok('Y9: публичная дверь отдаёт процент потолка, без чисел и имён',
    open9.cap && open9.cap.on === true && typeof open9.cap.pct === 'number'
      && open9.pool.pct === open9.cap.pct && !('used' in open9.cap),
    JSON.stringify(open9.cap));
  ok('Y9b: владельцу — взятое из запаса и остаток по потолку, с пометкой про резерв',
    own9.cap && own9.cap.on === true && own9.cap.max === 1000 && own9.cap.used === 300
      && own9.cap.remaining === 700 && /резерв/i.test(own9.cap.note || ''),
    JSON.stringify({ used: own9.cap.used, remaining: own9.cap.remaining }));
}

console.log('Z — отказ суточного потолка на границе /api/chat (0.202)');
{
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }] }),
  });
  /* rate: 0 — частотный лимит в этих проверках молчит: проверяется именно потолок,
     иначе 429 пришёл бы раньше и дверь потолка осталась бы непроверенной. */
  const req = (text) => new Request('http://x/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '77.88.99.11' },
    body: JSON.stringify({ text: text === undefined ? 'привет' : text, rate: 0 }),
  });
  const kvZ = fakeKv();
  const ENV = { GROQ_KEYS: 'g1', MEMORY: kvZ, DAY_CAP: '1', DAY_CAP_CHUNK: '1' };

  const z1 = await chatPost({ request: req(), env: ENV });
  const z2 = await chatPost({ request: req(), env: ENV });
  const z2b = await z2.json();
  ok('Z1: запас в 1 попытку — первый вопрос отвечен, второй получает 503',
    z1.status === 200 && z2.status === 503, z1.status + ',' + z2.status);
  ok('Z2: отказ говорит человеческим языком: общий на всех, сброс в 00:00 UTC и сколько ждать',
    z2b.ok === false && /общий на всех/i.test(z2b.error) && /00:00 UTC/.test(z2b.error)
      && /через \d/.test(z2b.error) && z2b.cap && z2b.cap.blocked === true
      && z2b.cap.resetInMs > 0 && z2b.cap.resetInMs <= 86400000,
    String(z2b.error).slice(0, 160));

  /* Пустой запрос — не ответ и не попытка: он отваливается раньше двери потолка и
     не имеет права съесть единственный запас дня. */
  const kvE = fakeKv();
  const ENVE = { GROQ_KEYS: 'g1', MEMORY: kvE, DAY_CAP: '1', DAY_CAP_CHUNK: '1' };
  const empty = await chatPost({ request: req(''), env: ENVE });
  const afterEmpty = await chatPost({ request: req(), env: ENVE });
  ok('Z3: пустой запрос не тратит суточный запас',
    empty.status === 400 && afterEmpty.status === 200, empty.status + ',' + afterEmpty.status);

  /* Аварийный тумблер: выключенный потолок не отказывает никому. */
  const kvO = fakeKv();
  const ENVO = Object.assign({}, ENV, { MEMORY: kvO, DAY_CAP_OFF: '1' });
  const o1 = await chatPost({ request: req(), env: ENVO });
  const o2 = await chatPost({ request: req(), env: ENVO });
  const o3 = await chatPost({ request: req(), env: ENVO });
  ok('Z4: DAY_CAP_OFF=1 — потолок не мешает, три вопроса подряд отвечены',
    o1.status === 200 && o2.status === 200 && o3.status === 200, [o1.status, o2.status, o3.status].join(','));

  /* Упавшее хранилище не имеет права выключать агента: лучше ответ, чем ложное
     «лимит кончился». Ошибка видна в статистике потолка, а не в лице человека. */
  const kvB = fakeKv();
  kvB.fail = true;
  const ENVB = { GROQ_KEYS: 'g1', MEMORY: kvB, DAY_CAP: '5', DAY_CAP_CHUNK: '1' };
  const b1 = await chatPost({ request: req(), env: ENVB });
  ok('Z5: KV упал — агент всё равно отвечает (fail-open), а не врёт про лимит',
    b1.status === 200, String(b1.status));

  globalThis.fetch = saved;
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
process.exit(fail ? 1 : 0);
