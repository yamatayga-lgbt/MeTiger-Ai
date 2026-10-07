/**
 * GET /api/models — живой список моделей для окна выбора.
 *
 * Возвращает не горстку вручную вписанных имён, а всё, что движок действительно
 * может назвать: пулы провайдеров + весь бесплатный каталог OpenRouter и Xkiро,
 * с настоящими потолками (контекст, вывод) и признаком зрения. Именно этого не
 * хватало: модель есть у провайдера, а в списке её не видно — и выбрать нельзя.
 *
 *   ?refresh=1 — обойти кэш и тянуть каталог заново (раз в 30 минут он сам)
 *
 * Ответ всегда есть: нет сети, нет KV, пустой каталог — придут только пулы, и
 * фронт не останется с пустым списком.
 */
import { buildTable } from '../../engine/providers.js';
import { createBrave, lineOf as braveLine } from '../../engine/brave.js';
import * as modelreg from '../../engine/modelreg.js';
import { VERIFIED } from '../../engine/models-verified.js';
import { memoryStore } from './chat.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

/** Все id из пулов движка + к какому слою (fast/smart) они относятся.
    Экспортируется ради теста (test/table.test.js): «локальная голова не висит
    в списке без адреса» — правило, за которым надо следить машиной. */
export function poolsOf(P) {
  const pools = [];
  const ids = [];
  const tierOf = Object.create(null);
  for (const pid of Object.keys(P)) {
    const cfg = P[pid];
    const fast = (cfg.models && cfg.models.fast) || [];
    const smart = [].concat((cfg.models && cfg.models.smart) || []);
    if (!fast.length && !smart.length) continue;
    pools.push({ provider: pid, label: cfg.label || pid, fast, smart });
    for (const id of fast.concat(smart)) {
      if (ids.indexOf(id) < 0) ids.push(id);
      /* если модель в обоих слоях — считаем умной: выбирать будут по этому ярлыку */
      tierOf[id] = fast.indexOf(id) >= 0 && smart.indexOf(id) >= 0 ? 'smart' : (fast.indexOf(id) >= 0 ? 'fast' : 'smart');
    }
  }
  return { pools, ids, tierOf };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const force = url.searchParams.get('refresh') === '1';
  const P = buildTable(env);
  const { pools, ids, tierOf } = poolsOf(P);

  const store = memoryStore(env);
  let cat = await modelreg.loadCatalog(store, { env, force });
  if (!cat || cat.stale || force) {
    try {
      /* force — чтобы ?refresh=1 действительно перечитывал провайдеров, а не
         возвращал свежий по таймеру кэш: иначе «обновить» в панели было бы
         декорацией (на проде проверено — список не менялся). */
      cat = await modelreg.refresh(env, store, {
        force: true,
        curated: ids.map((id) => ({ id, tier: tierOf[id] })),
      });
    } catch (e) {
      /* каталог — дополнение; без него список пулов всё равно usable */
      cat = cat || { updatedAt: 0, models: [], byId: null, errors: [String((e && e.message) || e)] };
    }
  }

  const list = modelreg.showcase(cat, {
    pickIds: ids,
    curatedIds: ids,
    tierOf: (id) => tierOf[id] || 'fast',
  });

  /* Чем модель уже отличилась на «острых» темах — тот же рейтинг, что читает
     движок: человеку полезно видеть, что «без купюр» — это не только ярлык из
     каталога, но и проверенный опыт (или наоборот: упирается). */
  const brave = createBrave({ env, store });
  await brave.pull();
  for (const row of list) {
    const own = row.src && row.src !== 'pool' ? brave.record(row.src, row.id) : null;
    const rec = own || brave.anyOf(row.id);
    if (rec) row.brave = { ok: rec.ok, refused: rec.refused, total: rec.total, score: Math.round(rec.score * 100) / 100, provider: rec.provider || row.src };
  }
  return json({
    ok: true,
    /* есть ли связка KV: без неё список живёт только в изоляте и греется заново */
    cached: !!store,
    updatedAt: Number(cat.updatedAt || 0) || null,
    stale: !!cat.stale,
    count: list.length,
    catalogCount: (cat.models || []).length,
    catalogTotal: Number(cat.total || 0) || null,
    /* Когда список меряли живьём и сколько имён отбраковано: по этим числам видно,
       что пора `node scripts/models-probe.mjs --all` (поле для диагностики, фронт его не читает). */
    verified: { at: VERIFIED.at || null, alive: VERIFIED.alive.length, dead: VERIFIED.dead.length },
    errors: cat.errors || null,
    pools: pools.map((p) => ({ provider: p.provider, label: p.label, count: p.fast.length + p.smart.length })),
    /* чьи собственные списки реально прочитаны в этом обновлении — чтобы «в
       каталоге нет» не выглядело приговором там, где список неполный (z.ai) */
    read: cat.read || null,
    brave: braveLine(brave.stats()),
    models: list,
  });
}

export async function onRequestPost() {
  return json({ ok: false, error: 'список моделей читается через GET /api/models' }, 405);
}
