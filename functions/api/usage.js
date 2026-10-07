/**
 * GET /api/usage — расход провайдеров и их лимиты. Данные для панели
 * «Использование и Лимиты» в настройках.
 *
 * Отдаёт ровно то, что видно и из curl: сколько запросов ушло к каждому
 * провайдеру за сутки (UTC), сколько из них закончилось ответом, отказом или
 * смертью ключа, сколько ушло за последнюю минуту, кто сейчас на паузе и сколько
 * до её конца. Плюс справочный суточный потолок провайдера из его же таблицы и
 * потолок «в минуту» (PROVIDER_RPM).
 *
 * Точность не приукрашена: у Cloudflare нет атомарного счётчика, изоляты
 * складывают свои числа в KV не чаще `USAGE_WRITE_MS` (см. engine/usage.js),
 * поэтому в ответе есть честная сноска `precision` — она же уходит в подпись
 * панели. Молчание тут было бы хуже: число без подписи выглядит точнее, чем есть.
 *
 *   ?refresh=1 — не верить кэшу изолята и перечитать хранилище
 */
import { buildTable } from '../../engine/providers.js';
import { createUsage } from '../../engine/usage.js';
import { limitsInfo } from '../../engine/limits.js';
import { memoryStore, limitsStore } from './chat.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Сколько осталось до полуночи по UTC — момента, когда суточные квоты провайдеров
 *  начинают считаться заново. Панели это нужнее, чем человеку: «счётчик сбросится
 *  в 03:00 по Минску» перестаёт выглядеть поломкой, когда рядом стоит таймер. */
function msToUtcMidnight(t) {
  const d = new Date(t);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return next - t;
}

export async function onRequestGet(context) {
  const env = (context && context.env) || {};
  const request = context && context.request;
  let force = false;
  try { force = !!request && new URL(request.url).searchParams.get('refresh') === '1'; } catch (e) { force = false; }

  const store = memoryStore(env);
  const usage = createUsage({ env, store });
  await usage.pull({ force });
  const snap = usage.snapshot();
  const P = buildTable(env);

  const rows = Object.keys(P).map((id) => {
    const cfg = P[id] || {};
    const got = snap.providers[id] || null;
    const dayLimit = Number(cfg.limit) || 0;
    const attempt = got ? got.attempt || 0 : 0;
    const rpm = snap.rpm && snap.rpm[id] != null ? Number(snap.rpm[id]) || 0 : 0;
    return {
      id,
      label: cfg.label || id,
      keys: (cfg.keys || []).length,
      /* keyless — «работает без ключа» (LLM7, Kilo): в очереди он есть, даже
         когда ключей ноль. Ключ появится — ничего не изменится, кроме заголовка. */
      live: (cfg.keys || []).length > 0 || !!cfg.keyless,
      dayLimit,
      rpm,
      attempt,
      ok: got ? got.ok || 0 : 0,
      refused: got ? got.refused || 0 : 0,
      dead: got ? got.dead || 0 : 0,
      minute: got ? got.minute || 0 : 0,
      lastAt: got ? got.lastAt || 0 : 0,
      model: got ? got.model || '' : '',
      pause: got && got.pause ? got.pause : null,
      remaining: dayLimit ? Math.max(0, dayLimit - attempt) : null,
      pct: dayLimit ? Math.min(100, Math.round((attempt / dayLimit) * 100)) : null,
    };
  });

  /* Порядок: кто реально работал — вперёд, но пулы провайдеров (ключи есть)
     остаются выше «без ключа»: панель — про расход, а не про алфавит. */
  rows.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (b.attempt !== a.attempt) return b.attempt - a.attempt;
    return a.id < b.id ? -1 : 1;
  });

  /* Подхват (0.100): сколько имён модели живут у ДВУХ и более провайдеров — их
     отказ одного провайдера не роняет: очередь спросит то же имя у второго.
     Считаем по пулам таблицы, а не по каталогу: каталожные строки бесплатны у
     одного дома, а пул — это то, с чем движок реально ходит. */
  const homes = {};
  for (const id of Object.keys(P)) {
    const cfg = P[id] || {};
    const all = [].concat((cfg.models && cfg.models.fast) || [], (cfg.models && cfg.models.smart) || []);
    for (const model of new Set(all)) (homes[model] = homes[model] || []).push(id);
  }
  const twins = Object.keys(homes).filter((m) => homes[m].length >= 2);
  const failover = {
    count: twins.length,
    /* Пара примеров — по ним видно, что это за имена, без простыни на экране. */
    sample: twins.slice(0, 4).map((m) => ({ model: m, providers: homes[m] })),
  };

  const rate = limitsInfo(env, limitsStore(env));
  return json({
    ok: true,
    at: snap.at,
    day: snap.day,
    tz: 'UTC',
    resetInMs: msToUtcMidnight(snap.at),
    kv: !!store,
    off: !!snap.off,
    totals: snap.totals,
    providers: rows,
    rate: { max: rate.rateMax, windowMs: rate.windowMs, on: rate.on, why: rate.why || '' },
    failover,
    /* Подпись точности — дословно та же мысль, что в engine/usage.js: изоляты
       складываются, «в минуту» — нижняя оценка. */
    precision: {
      approx: true,
      writeMs: snap.writeMs,
      readMs: snap.readMs,
      writeCap: snap.writeCap,
      writes: snap.writes,
      reads: snap.reads,
      unsaved: snap.unsaved,
      note: 'числа складываются из изолятов Cloudflare: «в день» — как есть, «в минуту» — нижняя оценка',
    },
  });
}
