/**
 * POST/GET /api/report — «Сообщить об ошибке» (0.173).
 *
 * Зачем: владелец узнаёт о поломках только если кто-то напишет ему сам. Форма в
 * приложении превращает «нашёл проблему» в одно движение: описал, приложил до
 * четырёх снимков экрана, отправил. Владелец же видит обращения у себя на
 * устройстве и закрывает их двумя кнопками — «Рассмотрено» или «Отказано».
 *
 * Как устроены входы (всё в одном эндпоинте, потому что и данных одна тема):
 *   GET  /api/report                     — правила приёма (знаков, фото) без секретов;
 *   POST /api/report                     — принять заявку (обычный человек);
 *   GET  /api/report?owner=1             — список заявок (только по коду владельца);
 *   GET  /api/report?owner=1&id=...      — одна заявка целиком, вместе с фото;
 *   POST /api/report?owner=1             — вердикт: { id, verdict: 'done'|'declined' }.
 *
 * Владелец проверяется по отпечатку кода (engine/reports.js): сам код лежит
 * только на его устройстве и уходит в заголовке x-mt-owner. Витрина «Скоро» у
 * пункта «Сообщить об ошибке» снята — теперь за ней живая форма.
 */
import { cfgOf as limitsCfg, createRateLimiter } from '../../engine/limits.js';
import { limitsStore, realClientIp } from './chat.js';
import {
  REPORT_LIMITS, cleanReportPhotos, cleanReportText, cleanVerdict, isOwnerCode,
  makeReport, newReportId, photoKey, reportKey, reportSummary,
} from '../../engine/reports.js';
import { deviceKeyOf, deviceRecordKey } from '../../engine/devid.js';

/* Своя карта частоты — как у голоса: отправка заявки не должна ни съедать, ни
   съедаться лимитами чата. Потолок мягкий: пять обращений в минуту — это уже
   не «нашёл проблему», а проверка формы. */
const RATE_LOCAL = new Map();

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * Хранилище заявок: тот же терпимый разбор, что у памяти чата (локальная
 * заглушка scripts/api-dev.js отдаёт объект, настоящий KV — строку).
 */
function reportStore(env) {
  const kv = env && env.MEMORY;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  const parse = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  return {
    get: (key) => Promise.resolve(kv.get(key)).then(parse, () => null),
    put: async (key, value) => { await kv.put(key, JSON.stringify(value)); },
    list: (opts) => Promise.resolve(kv.list(opts)).then((r) => (r && r.keys) || [], () => []),
  };
}

/* Замок владельца нужен двум дверям — обращениям и админ-панели устройств,
   поэтому он экспортируется, а не переписывается второй раз. */
export async function ownerOk(request, env) {
  const code = request.headers.get('x-mt-owner') || '';
  return isOwnerCode(code, env && env.REPORT_OWNER_HASH);
}

/** Список заявок владельцу: свежие сверху, без фото внутри. */
async function listReports(store) {
  const keys = await store.list({ prefix: 'rep:', limit: 1000 });
  const last = keys.slice(-REPORT_LIMITS.LIST_MAX);
  const recs = await Promise.all(last.map((k) => store.get(k.name)));
  return recs.filter(Boolean).map(reportSummary).sort((a, b) => b.at - a.at);
}

/** Одна заявка целиком: запись плюс её фото по отдельным ключам. */
async function fullReport(store, id) {
  const keys = await store.list({ prefix: 'rep:', limit: 1000 });
  const hit = keys.find((k) => k.name.endsWith(':' + String(id || '').slice(0, 10)));
  const rec = hit ? await store.get(hit.name) : null;
  if (!rec) return null;
  const photos = [];
  for (let i = 0; i < Math.min(REPORT_LIMITS.MAX_PHOTOS, Math.max(0, Number(rec.photoCount) || 0)); i++) {
    const pic = await store.get(photoKey(rec.id, i));
    if (pic && typeof pic === 'object' && pic.data) photos.push(String(pic.data));
  }
  return { ...reportSummary(rec), photoData: photos };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const owner = url.searchParams.get('owner') === '1';

  if (!owner) {
    /* Публичная шапка правил: клиенту незачем хардкодить числа, а диагностика
       («сколько сейчас принимаем») должна быть видна одной командой. */
    return json({
      ok: true,
      send: true,
      maxChars: REPORT_LIMITS.MAX_CHARS,
      maxPhotos: REPORT_LIMITS.MAX_PHOTOS,
      store: !!reportStore(env),
    });
  }

  if (!(await ownerOk(request, env))) return json({ ok: false, error: 'нет доступа' }, 403);

  const store = reportStore(env);
  if (!store) return json({ ok: false, error: 'хранилище не подключено (нет связки MEMORY)' }, 503);

  const id = String(url.searchParams.get('id') || '').trim();
  if (id) {
    const one = await fullReport(store, id);
    if (!one) return json({ ok: false, error: 'обращение не найдено' }, 404);
    return json({ ok: true, report: one });
  }

  const reports = await listReports(store);
  return json({
    ok: true,
    owner: true,
    reports,
    total: reports.length,
    fresh: reports.filter((r) => r.status === 'new').length,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const owner = url.searchParams.get('owner') === '1';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'запрос не разобрался' }, 400);
  }

  const store = reportStore(env);
  if (!store) return json({ ok: false, error: 'хранилище не подключено (нет связки MEMORY)' }, 503);

  /* ── Владелец: вердикт по заявке ─────────────────────────────────────────── */
  if (owner) {
    if (!(await ownerOk(request, env))) return json({ ok: false, error: 'нет доступа' }, 403);
    const id = String(body && body.id || '').trim().slice(0, 10);
    const verdict = cleanVerdict(body && body.verdict);
    if (!id || !verdict) return json({ ok: false, error: 'нужны id и вердикт: done или declined' }, 400);
    const keys = await store.list({ prefix: 'rep:', limit: 1000 });
    const hit = keys.find((k) => k.name.endsWith(':' + id));
    const rec = hit ? await store.get(hit.name) : null;
    if (!rec || !hit) return json({ ok: false, error: 'обращение не найдено' }, 404);
    const next = { ...rec, status: verdict, verdictAt: Date.now() };
    await store.put(hit.name, next);
    return json({ ok: true, id, status: verdict, at: next.verdictAt });
  }

  /* ── Обычный человек: новая заявка ──────────────────────────────────────── */
  if (env.RATE_LIMIT !== '0') {
    const cfg = limitsCfg(env);
    const max = Math.max(1, Number(env.REPORT_RATE_MAX) || REPORT_LIMITS.RATE_DEFAULT);
    const rate = createRateLimiter({ store: limitsStore(env), cfg: { ...cfg, rateMax: max }, base: RATE_LOCAL });
    const r = await rate.check(realClientIp(request, env));
    if (r.limited) return json({ ok: false, error: 'слишком часто — подождите минуту' }, 429);
  }

  const text = cleanReportText(body && body.text);
  if (!text) return json({ ok: false, error: 'опишите, что произошло — без этого не понять, что чинить' }, 400);
  const pics = cleanReportPhotos(body && body.photos);
  if (pics.error) return json({ ok: false, error: pics.error }, 400);

  const at = Date.now();
  const id = newReportId();
  const { rec, photos } = makeReport({
    now: at, id, uid: body && body.uid, ver: body && body.ver, text, photos: pics.photos,
    did: body && body.did, model: body && body.model,
  });
  const key = reportKey(at, id);
  await store.put(key, rec);
  for (let i = 0; i < photos.length; i++) await store.put(photoKey(id, i), { data: photos[i] });

  /* Счётчик обращений в записи устройства: владелец видит в админ-панели, кто
     сколько раз писал. Пишем ПОСЛЕ заявки и не роняем приём, если не вышло:
     заявка важнее счётчика. */
  try {
    const dev = deviceKeyOf(body && body.device);
    if (dev) {
      const recKey = deviceRecordKey(dev);
      const drec = await store.get(recKey);
      if (drec && typeof drec === 'object') {
        drec.reports = Number(drec.reports || 0) + 1;
        drec.lastReportAt = at;
        await store.put(recKey, drec);
      }
    }
  } catch (e) {
    /* счётчик не сложился — не беда */
  }

  return json({ ok: true, id, at, photos: photos.length });
}
