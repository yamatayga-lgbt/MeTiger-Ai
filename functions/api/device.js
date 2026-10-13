/**
 * /api/device — «какой телефон и под каким ID».
 *
 *   POST /api/device            — отметить визит и/или занять ID
 *        { device, id?, model?, ver? }   — ping визита; с id — это просьба сменить/занять
 *   GET  /api/device?owner=1    — список устройств для админ-панели (только владелец)
 *   GET  /api/device?id=KTFZ    — свободен ли ID (спросить можно всем: это не тайна)
 *
 * Зачем дверь, а не «считать устройство по запросам чата»: владелец просит видеть
 * в админ-панели телефон, версию и когда человек заходил, а ID — менять раз в неделю.
 * Правило недели обязан держать сервер: на клиентских часах любой поставит что угодно.
 *
 * Записи дешёвые, но их много: визит обновляем не чаще раза в полчаса (иначе один
 * человек с включённым приложением съел бы бесплатные записи KV за день).
 */
import { createRateLimiter, cfgOf as limitsCfg } from '../../engine/limits.js';
import {
  ID_MAX, ID_MIN, DEV_ID, RENAME_MS,
  canRename, deviceKeyOf, deviceRecordKey, fingerprintOf, fpIndexKey, idIndexKey, idProblem,
  modelFromUa, normalizeId, renameLeft, renameWaitText,
} from '../../engine/devid.js';
import { ownerOk } from './report.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-mt-owner',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

/** Визит человека — не чаще раза в полчаса: хватает, чтобы «когда заходил» было живым. */
const VISIT_MS = 30 * 60 * 1000;

const LOCAL = new Map();

export function deviceStore(env) {
  const kv = env && env.MEMORY;
  if (!kv) return null;
  /* Терпимый разбор — как у памяти чата и заявок: связка KV отдаёт строку, а
     локальная заглушка в scripts/api-dev.js — уже разобранный объект. Без этого
     запись устройства на одном из двух хранилищ выглядела бы пустой. */
  const parse = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  return {
    get: (k) => Promise.resolve(kv.get(k)).then(parse, () => null),
    put: (k, v, opts) => kv.put(k, JSON.stringify(v), opts),
    del: (k) => kv.delete(k),
    list: (opts) => Promise.resolve(kv.list(opts || {})).then((r) => (r && r.keys) || [], () => []),
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Тот же счётчик, что у чата: ID — не место для перебора (занят/свободен) пачками. */
async function tooOften(request, env, key, max = 60) {
  if (env.RATE_LIMIT === '0') return false;
  const lim = createRateLimiter({ env, store: LOCAL, cfg: limitsCfg(env) });
  const r = await lim.check('dev:' + key, max);
  return !!(r && r.limited);
}

/**
 * Запись владельца с той же моделью телефона — для случая «с другого браузера» (0.182).
 * Ищем только среди записей с пометкой владельца: код есть лишь у него, и подсунуть
 * сюда чужой телефон нельзя. Больше одной записи владельца быть не должно; если их
 * всё же несколько (следы прежних версий), берём самую старую — она и настоящая.
 */
async function ownerTwin(store, exceptKey, model) {
  let keys = [];
  try { keys = (await store.list({ prefix: 'dev:' })).map((k) => k.name); } catch { return ''; }
  let best = '';
  let bestAt = Infinity;
  for (const k of keys.slice(0, 500)) {
    const rec = await store.get(k);
    if (!rec || !rec.owner) continue;
    const key = deviceKeyOf(rec.key || k.replace(/^dev:/, ''));
    if (!key || key === deviceKeyOf(exceptKey)) continue;
    if (String(rec.model || '').trim().toLowerCase() !== String(model).trim().toLowerCase()) continue;
    const at = Number(rec.firstAt || 0) || Infinity;
    if (at < bestAt) { bestAt = at; best = key; }
  }
  return best;
}

async function readDevice(store, key) {
  const rec = await store.get(deviceRecordKey(key));
  return rec && typeof rec === 'object' ? rec : null;
}

/** Живёт ли ID за другим устройством. */
async function idTaken(store, id, key) {
  const idx = await store.get(idIndexKey(id));
  return !!(idx && idx.key && idx.key !== key);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const store = deviceStore(env);
  if (!store) return json({ ok: false, error: 'нет хранилища — админ-панель без него пуста' }, 503);

  if (url.searchParams.get('owner') === '1') {
    if (!(await ownerOk(request, env))) return json({ ok: false, error: 'нет доступа' }, 403);
    let keys = [];
    try {
      keys = (await store.list({ prefix: 'dev:' })).map((k) => k.name);
    } catch (e) {
      keys = [];
    }
    const devices = [];
    for (const k of keys.slice(0, 500)) {
      const rec = await store.get(k);
      if (rec && rec.key) devices.push(rec);
    }
    devices.sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0));
    return json({
      ok: true,
      devices,
      total: devices.length,
      /* Кто владелец — видно и без отдельного запроса: в списке у него id = Dev. */
      dev: devices.find((d) => d.owner) || null,
    });
  }

  const want = normalizeId(url.searchParams.get('id') || '');
  if (!want) return json({ ok: false, error: 'нужен id: /api/device?id=…' }, 400);
  const problem = idProblem(want);
  /* Служебное имя отвечаем той же формой, что и занятое: клиенту важно и «нельзя»,
     и «почему», и пометка «это ID владельца» — она объясняет, а не просто запрещает. */
  if (problem) {
    const isDevName = want.toLowerCase() === DEV_ID.toLowerCase();
    return json({ ok: true, id: want, free: false, busy: false, reserved: isDevName, error: problem });
  }
  const key = deviceKeyOf(url.searchParams.get('device') || '');
  const taken = await idTaken(store, want, key);
  const isDev = want.toLowerCase() === DEV_ID.toLowerCase();
  return json({ ok: true, id: want, free: !taken && !isDev, busy: taken, reserved: isDev });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const store = deviceStore(env);
  if (!store) return json({ ok: false, error: 'нет хранилища' }, 503);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const asked = deviceKeyOf(body.device);
  if (!asked) return json({ ok: false, error: 'не понял, с какого вы устройства' }, 400);
  const fp = fingerprintOf(body.fp);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'anon';
  if (await tooOften(request, env, ip)) return json({ ok: false, error: 'слишком часто — подождите минуту' }, 429);

  const isOwner = await ownerOk(request, env);

  /*
   * Одно устройство — одна запись (0.177; уточнено 0.182).
   *
   * Ключ устройства живёт в localStorage и умирает вместе с чисткой данных сайта:
   * тот же телефон заводил вторую запись, и владелец видел в админ-панели три строки
   * «без ID · SM-A546B» вместо одной. Поэтому визит с новым ключом, но известным
   * отпечатком приписываем к уже существующей записи, а пустую (ни ID, ни обращений)
   * убираем.
   *
   * Что добавилось в 0.182. Владелец объяснил вторую строку: «это я же, просто оно
   * считается с другого браузера». Две беды:
   *   · отпечаток считался по строке браузера — у Chrome и Samsung Internet на одном
   *     телефоне он разный (лечится на телефоне, src/lib/devid.ts);
   *   · даже когда отпечаток сходится, прежнее правило приписывало визит к ТОЙ записи,
   *     что нашлась по указателю, — и запись владельца могла «переехать» в пустую.
   *     Теперь настоящей считается лучшая запись (владелец → есть ID → есть обращения
   *     → больше заходов), а пустая уходит совсем.
   */
  /* Кем человек пришёл: заявленный ID нужен ещё до склейки — если он не совпадает с
     ID уже известной записи с тем же отпечатком, это разные люди (см. twoPeople). */
  const want = normalizeId(body.id || '');

  const rankOf = (r) => (!r ? -1
    : (r.owner ? 8 : 0) + (r.id ? 4 : 0) + (Number(r.reports || 0) > 0 ? 2 : 0) + (Number(r.visits || 0) > 1 ? 1 : 0));

  let key = asked;
  if (fp) {
    const mapped = await store.get(fpIndexKey(fp));
    const linkedKey = mapped && mapped.key && deviceKeyOf(mapped.key) !== asked ? deviceKeyOf(mapped.key) : '';
    if (linkedKey) {
      const linked = await readDevice(store, linkedKey);
      const mine = await readDevice(store, asked);
      /* Два человека с разными ID одну запись не делят: у каждого своя, даже если
         телефоны одинаковые — отпечаток это «тот же аппарат», а не «тот же человек». */
      const mineId = String((mine && mine.id) || want || '').toLowerCase();
      const twoPeople = !!(linked && linked.id && mineId && mineId !== String(linked.id).toLowerCase());
      if (!twoPeople) {
        const target = rankOf(mine) > rankOf(linked) ? mine : linked;
        const loser = target === mine ? linked : mine;
        if (target) {
          key = target.key || (target === mine ? asked : linkedKey);
          /* Пустую запись убираем, даже если в ней был заход: один заход без ID и без
             обращений — это и есть «второе моё устройство» из админ-панели. */
          if (loser && !loser.owner && !loser.id && !Number(loser.reports || 0)) {
            try { await store.del(deviceRecordKey(loser.key || (loser === mine ? asked : linkedKey))); }
            catch (e) { /* нечего чистить — не беда */ }
          }
        }
      }
    }
  }

  /* Владелец и второй браузер (0.182). Даже если отпечатки не сошлись (необычный
     браузер, другой экран в полноэкранном режиме), у владельца есть точная примета —
     код. Своё устройство узнаём по модели: код есть только у него, поэтому чужой
     телефон той же модели сюда не попадёт. Другое устройство владельца (ноутбук)
     останется отдельной строкой — это разные устройства, и путать их нечестно. */
  const model0 = String(body.model || '').replace(/\s+/g, ' ').trim().slice(0, 40) || modelFromUa(request.headers.get('user-agent'));
  if (isOwner && model0) {
    const current = await readDevice(store, key);
    if (!current || !current.owner) {
      const same = await ownerTwin(store, key, model0);
      if (same) {
        key = same;
        /* Пустую запись этого визита убираем: она завелась бы вторым «моим устройством». */
        if (current && !current.id && !Number(current.reports || 0)) {
          try { await store.del(deviceRecordKey(current.key || asked)); } catch (e) { /* пусто — не беда */ }
        }
      }
    }
  }
  const now = Date.now();
  const model = model0;
  const ver = String(body.ver || '').slice(0, 16);

  let rec = await readDevice(store, key);
  const fresh = !rec;
  if (!rec) rec = { key, firstAt: now, reports: 0, visits: 0 };

  rec.visits = Number(rec.visits || 0) + (fresh || now - Number(rec.lastAt || 0) > VISIT_MS ? 1 : 0);
  if (fresh || now - Number(rec.lastAt || 0) > VISIT_MS || ver || model) rec.lastAt = now;
  if (model) rec.model = model;
  if (ver) rec.ver = ver;

  /* Владелец: ID #Dev закрепляется сам — «у меня сразу будет стоять айди». */
  if (isOwner) {
    rec.owner = true;
    rec.id = DEV_ID;
    rec.idLocked = true;
  } else if (rec.owner) {
    /* Был владельцем по коду, кода больше нет — не отбираем ID молча, но и не даём
       выдавать себя за владельца дальше: помечаем, что код снят. */
    rec.ownerCodeGone = true;
  }

  let renamed = false;
  if (want && want.toLowerCase() !== String(rec.id || '').toLowerCase()) {
    if (rec.owner) {
      /* Владельцу ID закреплён: менять нечего — отвечаем так, чтобы было понятно. */
      if (want.toLowerCase() !== DEV_ID.toLowerCase()) {
        return json({ ok: true, device: publicDevice(rec), note: `ID владельца закреплён: #${DEV_ID}` });
      }
    }
    const problem = idProblem(want, { owner: !!rec.owner });
    if (problem) return json({ ok: false, error: problem }, 400);
    if (!rec.id) {
      /* Первый выбор ID — свободен всем и сразу. */
      if (await idTaken(store, want, key)) return json({ ok: false, error: `#${want} уже занят другим устройством — попробуйте другой` }, 409);
      rec.id = want;
      rec.idChangedAt = now;
      renamed = true;
    } else if (canRename(rec, now) && !rec.idLocked) {
      if (await idTaken(store, want, key)) return json({ ok: false, error: `#${want} уже занят другим устройством — попробуйте другой` }, 409);
      const old = rec.id;
      rec.id = want;
      rec.idChangedAt = now;
      renamed = true;
      try {
        await store.del(idIndexKey(old));
      } catch (e) {
        /* нечего чистить — не беда */
      }
    } else {
      const left = rec.idLocked ? 0 : renameLeft(rec, now);
      return json({
        ok: false,
        error: rec.idLocked
          ? 'это ID владельца — он закреплён за этим устройством'
          : `ID можно менять раз в неделю — следующий раз ${renameWaitText(left)}`,
        left,
        renameInDays: Math.ceil(left / (24 * 60 * 60 * 1000)),
        device: publicDevice(rec),
      }, 409);
    }
  }

  rec.key = key;
  await store.put(deviceRecordKey(key), rec);
  if (rec.id) await store.put(idIndexKey(rec.id), { key: rec.key, at: Number(rec.idChangedAt || now) });
  /* Отпечаток запоминаем всегда: следующая чистка данных на этом телефоне вернёт
     человека в ЭТУ же запись, а не заведёт новую. */
  if (fp) {
    try { await store.put(fpIndexKey(fp), { key, at: now }); } catch (e) { /* указатель не сложился — не беда */ }
  }

  return json({
    ok: true,
    device: publicDevice(rec),
    renamed,
    fresh,
    /* Сколько ждать до следующей смены — клиент покажет это человеку словами. */
    renameInDays: Math.ceil(renameLeft(rec, now) / (24 * 60 * 60 * 1000)),
    rules: { min: ID_MIN, max: ID_MAX, days: Math.round(RENAME_MS / (24 * 60 * 60 * 1000)) },
  });
}

/** Наружу — без ключа (это адрес записи, а не секрет, но и не нужен человеку). */
function publicDevice(rec) {
  return {
    id: rec.id || '',
    model: rec.model || '',
    owner: !!rec.owner,
    firstAt: Number(rec.firstAt || 0),
    lastAt: Number(rec.lastAt || 0),
    visits: Number(rec.visits || 0),
    reports: Number(rec.reports || 0),
    locked: !!rec.idLocked,
  };
}
