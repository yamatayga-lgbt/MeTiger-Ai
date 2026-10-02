/**
 * Живой каталог моделей — порт реестра Yama (models.js), адаптированный под Pages.
 *
 * Зачем он нужен. До сих пор витрина была рукой из 19 строк, а движок — списком
 * пулов в `engine/providers.js`. Два следствия, оба владелец видел своими глазами:
 *   • половина бесплатных моделей в списке не появлялась вовсе (в каталоге
 *     OpenRouter их сейчас 464, из них ~20 бесплатных; у Xkiro — 141, ~68 с ценой 0);
 *   • возможности моделей угадывались по имени. Угадывание стоит денег: картинка
 *     уезжала слепой модели, та отдавала 400 и сжигала суточную квоту провайдера,
 *     а `max_tokens` больше потолка модели — это ещё один 400.
 *
 * В Yama реестр греется в памяти воркера и живёт пока процесс жив. У Pages Function
 * процесса нет: изоляты мелкие и недолгие, поэтому кэш кладётся в то же KV, что и
 * память с лимитами (связка `MEMORY`), а в изоляте держится только короткое memo.
 * Именно из-за отсутствия хранилища этот слой раньше нельзя было перенести — в
 * `engine/route.js` так и написано в комментарии. Теперь хранилище есть.
 *
 * Что реестр даёт движку, кроме списка:
 *   • `ctx` / `maxOut` — настоящие потолки: `max_tokens` зажимается под модель,
 *     длинный ответ перестаёт обрываться ошибкой;
 *   • `vision` по модальностям провайдера, а не по подстроке в имени;
 *   • `tools` / `canExcludeReasoning` — можно ли вообще просить их у этой модели;
 *   • мёртвые id (модель ушла из каталога) вычищаются из пулов до запроса, а не
 *     после 404 — это и есть «обойти ограничения», как это делает донор.
 *
 * Тихая деградация — обязательное свойство: нет сети, нет ключа, нет KV, пустой
 * каталог — движок работает ровно как работал, по статическим пулам.
 */

/** Ключ в KV. Рядом с `chat:*` и `rl:*`, в том же неймспейсе. */
export const CATALOG_KEY = 'models:catalog';

/** Сколько каталог считается свежим (настройки — в минутах, как у Yama). */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Memo в изоляте: чтобы каждый запрос не ходил в KV за одним и тем же. */
const MEMO_MS = 60 * 1000;

/** Разумный потолок на число моделей в байте KV: значение должно оставаться маленьким. */
const MAX_ENTRIES = 400;

/* Модель не для чата: классификаторы, модерация, эмбеддинги. Такие в ротации
   только жуют квоту и никогда не дают ответа (выведено на доноре). */
const NON_CHAT_HINT = /(embedding|classifier|moderation|guard|whisper|tts|dall-e|imagegen|dall3|clip|rerank|realtime|transcribe|audio-|livetranslate)/i;

/* «Без купюр» — мягкая подсказка маршрутизации, не гарантия. Совпадает со
   списком донора; отказоустойчивость у нас делает engine/freedom.js. */
const UNCENSORED_HINTS = ['dolphin', 'wizardlm', 'nous', 'uncensored', 'abliterated', 'sao10k', 'venice', 'leroy', 'mistral', 'ling', 'dots', 'inkling'];

let memo = { at: 0, cat: null };

const num = (x, dflt) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Цена нулевая по обеим сторонам? (у Xkiро нет суффикса `:free`, только price) */
function isFree(m) {
  if (/:(free|zero)$/i.test(String(m && m.id))) return true;
  const p = (m && m.pricing) || {};
  const zero = (x) => x === 0 || x === '0' || x === '0.0' || x === 0.0 || (typeof x === 'string' && /^0(\.0+)?$/.test(x));
  return zero(p.prompt ?? p.input) && zero(p.completion ?? p.output);
}

function prettyName(m) {
  const raw = String((m && (m.name || m.id)) || '');
  return raw
    .replace(/:free$|:zero$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 48);
}

/**
 * Одна запись OpenRouter → наш формат. Модальности берём из `architecture`,
 * а не из имени: донор обжёгся на `*-flash-sante`, которые по подстроке `flash`
 * считались зрячими и отвечали 400 на картинке.
 */
function fromOpenRouter(m) {
  if (!m || typeof m.id !== 'string' || !m.id) return null;
  const arch = m.architecture || {};
  const top = m.top_provider || {};
  const inMod = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
  const outMod = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
  const knownMod = inMod.length > 0 || typeof arch.modality === 'string';
  const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
  const lower = m.id.toLowerCase();
  return {
    id: m.id,
    name: prettyName(m),
    vendor: (m.id.split('/')[0] || '').toUpperCase(),
    src: 'openrouter',
    free: isFree(m) || /:free$/i.test(m.id),
    ctx: num(m.context_length ?? top.context_length, 32768),
    maxOut: num(top.max_completion_tokens, 4096),
    vision: knownMod ? inMod.indexOf('image') >= 0 : /vision|multimodal|-vl\b/i.test(lower),
    visionKnown: knownMod,
    tools: params.indexOf('tools') >= 0 || params.indexOf('function_calling') >= 0,
    canExcludeReasoning: params.indexOf('reasoning') >= 0 || params.indexOf('include_reasoning') >= 0,
    chat: !(NON_CHAT_HINT.test(lower) || (outMod.length && outMod.indexOf('text') < 0)),
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

/** Запись Xkiро (`/v1/models` открыт без ключа) → тот же формат. */
function fromXkiro(m) {
  if (!m || typeof m.id !== 'string' || !m.id) return null;
  const cap = m.capabilities || {};
  const lower = m.id.toLowerCase();
  return {
    id: m.id,
    name: prettyName(m),
    vendor: 'Xkiro',
    src: 'xkiro',
    free: isFree(m) || m.access_tier === 'free',
    ctx: num(m.context_length, 32768),
    maxOut: num(m.max_output_tokens, 4096),
    vision: !!cap.vision,
    visionKnown: true,
    tools: cap.tools !== false,
    canExcludeReasoning: !!cap.reasoning,
    chat: m.modality !== 'embedding' && !NON_CHAT_HINT.test(lower),
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

const PARSERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/models', pick: (d) => (Array.isArray(d && d.data) ? d.data : []), map: fromOpenRouter },
  xkiro: { url: 'https://api.xkiro.com/v1/models', pick: (d) => (Array.isArray(d && d.data) ? d.data : (Array.isArray(d && d.models) ? d.models : [])), map: fromXkiro },
};

/**
 * Тянет каталоги провайдеров. Один источник сдох — второй всё равно считаем:
 * реестр дополняет, а не заменяет (как у донора).
 */
export async function fetchCatalog(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return { models: [], errors: ['нет fetch'] };
  const timeoutMs = clamp(num(opts.timeoutMs, 8000), 1500, 20000);
  const attempts = clamp(num(opts.attempts, 2), 1, 3);
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources : ['openrouter', 'xkiro'];
  const models = [];
  const errors = [];
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  for (const src of sources) {
    const cfg = PARSERS[src];
    if (!cfg) { errors.push(src + ': нет парсера'); continue; }
    let got = null;
    for (let i = 0; i < attempts && !got; i++) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      if (timer && timer.unref) timer.unref();
      try {
        const r = await fetchImpl(cfg.url, { headers: { 'User-Agent': 'MeTigerAi/0.011', accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
        if (!r || !r.ok) throw new Error('HTTP ' + ((r && r.status) || 0));
        const data = cfg.pick(await r.json());
        if (!data.length) throw new Error('пустой список');
        got = data.map(cfg.map).filter(Boolean);
      } catch (e) {
        errors.push(src + ': ' + String((e && e.message) || e));
        if (i < attempts - 1) await sleep(Math.min(4000, 500 * 2 ** i));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (got) for (const m of got) models.push(m);
  }
  return { models, errors };
}

/**
 * Сборка каталога: только бесплатное, только чат, без дублей. `curated` — id из
 * пулов движка: они попадают в каталог даже если провайдер их не показал (у нас
 * есть платные-ставшие-бесплатными id у odirouter/groq, которых в OpenRouter нет).
 */
export function buildCatalog(models, opts = {}) {
  const curated = Array.isArray(opts.curated) ? opts.curated : [];
  const byId = Object.create(null);
  const out = [];
  for (const m of models || []) {
    if (!m || !m.id || byId[m.id]) continue;
    if (!m.free || m.chat === false) continue;
    byId[m.id] = m;
    out.push(m);
  }
  for (const c of curated) {
    if (!c || !c.id || byId[c.id]) continue;
    /* Про пуловые id каталог ничего не знает: vision/tools остаются undefined,
       чтобы движок решал по-старому (по имени), а не «в каталоге нет — значит нельзя». */
    const e = Object.assign({
      src: 'pool', free: true, chat: true, ctx: 32768, maxOut: 4096,
      vision: undefined, visionKnown: false, tools: undefined, canExcludeReasoning: undefined,
      uncensored: false, desc: '', vendor: (String(c.id).split('/')[0] || '').toUpperCase(),
      name: prettyName(c),
    }, c);
    byId[e.id] = e;
    out.push(e);
  }
  const kept = out.slice(0, MAX_ENTRIES);
  return { updatedAt: Number(opts.now) || Date.now(), count: kept.length, total: out.length, models: kept, byId: null };
}

/** Индекс достраиваем на месте — в KV его не пишем. */
function index(cat) {
  if (!cat) return null;
  if (!cat.byId) {
    const byId = Object.create(null);
    for (const m of cat.models || []) byId[m.id] = m;
    cat.byId = byId;
  }
  return cat;
}

const ttlMs = (env) => clamp(num((env && env.MODELS_REFRESH_MS), DEFAULT_TTL_MS), 60000, 24 * 3600 * 1000);

/** Совместимость с тем, что KV и fileKV отдают по-разному (строка/объект). */
function decode(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return typeof raw === 'object' ? raw : null;
}

export async function loadCatalog(store, opts = {}) {
  if (!store) return null;
  const now = Number(opts.now) || Date.now();
  if (memo.cat && now - memo.at < MEMO_MS && !opts.force) return index(memo.cat);
  let cat = null;
  try {
    const got = await store.get(CATALOG_KEY);
    cat = index(decode(got && got.value !== undefined ? got.value : got));
  } catch { cat = null; }
  if (cat && cat.models && cat.models.length && now - Number(cat.updatedAt || 0) < ttlMs(opts.env)) {
    memo = { at: now, cat };
    return cat;
  }
  return cat ? index(Object.assign({}, cat, { stale: true })) : null;
}

/**
 * Обновить каталог: сеть → кэш в KV. Возвращает актуальный каталог.
 * `store` может быть null — тогда каталог живёт только в memo изолята.
 */
export async function refresh(env, store, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const cur = await loadCatalog(store, { env, now, force: true });
  if (cur && !cur.stale && !opts.force) return cur;
  const { models, errors } = await fetchCatalog(opts);
  if (!models.length) {
    /* Ничего не вытащили — оставляем то, что знали (пусть и протухшее): лучше
       старый каталог, чем движок, который снова начал угадывать по имени. */
    memo = { at: now, cat: cur || null };
    return cur ? Object.assign({}, cur, { errors }) : { updatedAt: 0, count: 0, models: [], byId: null, errors };
  }
  const cat = index(buildCatalog(models, { curated: opts.curated, now }));
  if (errors.length) cat.errors = errors;
  if (store) {
    try {
      const val = JSON.stringify({ updatedAt: cat.updatedAt, count: cat.count, models: cat.models });
      /* expirationTtl — чтобы мусор не лежал вечно; свой TTL всё равно проверяем,
         потому что локальное файловое хранилище его не умеет. */
      const ttlSec = Math.max(300, Math.round(ttlMs(env) / 1000) + 3600);
      await store.put(CATALOG_KEY, val, { expirationTtl: ttlSec });
    } catch { /* кэш — не причина падать */ }
  }
  memo = { at: Date.now(), cat };
  return cat;
}

/** Синхронный доступ из движка: только то, что уже в memo. */
export function cached() {
  return memo.cat;
}

export function forgetMemo() { memo = { at: 0, cat: null }; }

/**
 * Потолки модели — {ctx, maxOut} или null, если мы её не знаем.
 * `maxOut` занижаем на 1: часть шлюзов отдаёт 400 на `max_tokens == потолок`.
 */
export function ceilings(cat, id) {
  const m = cat && cat.byId ? cat.byId[id] : null;
  if (!m) return null;
  return { ctx: num(m.ctx, 32768), maxOut: Math.max(256, num(m.maxOut, 4096) - 1) };
}

/** Зрение по каталогу; null — каталог не знает, решаем по имени. */
export function visionOf(cat, id) {
  const m = cat && cat.byId ? cat.byId[id] : null;
  if (!m || !m.visionKnown) return null;
  return !!m.vision;
}

/** Модель умеет инструменты? null — не знаем (считаем, что умеет, как раньше). */
export function toolsOk(cat, id) {
  const m = cat && cat.byId ? cat.byId[id] : null;
  if (!m || m.tools === undefined) return null;
  return !!m.tools;
}

/**
 * Чей это id, если модели нет ни в одном пуле. Без этого ручной выбор модели из
 * каталога молча превращался в «Авто» — человек тыкал в модель, а отвечала другая.
 */
export function ownerOf(cat, id) {
  const m = cat && cat.byId ? cat.byId[id] : null;
  if (!m) return null;
  if (m.src === 'xkiro') return 'xkiro';
  if (m.src === 'openrouter' || m.src === 'pool') return 'openrouter';
  return null;
}

/**
 * Вычистить из пула id, которых нет в живом каталоге (модель сняли — 404 и
 * потраченная квота). Работает только для провайдеров, чей каталог мы видим,
 * и только если каталог свежий: протухший каталог не имеет права ничего убирать.
 */
export function prune(cat, providerId, list) {
  const arr = Array.isArray(list) ? list : [];
  if (!cat || cat.stale || !arr.length) return arr;
  if (providerId !== 'openrouter' && providerId !== 'xkiro') return arr;
  const models = cat.models || [];
  if (!models.length) return arr;                    // пустой каталог — не судья
  const byId = cat.byId || Object.create(null);
  /* Пруним только там, где источник реально прочитан: иначе «нет в списке»
     означает «список не пришли», и мы бы сняли живые модели. */
  const sawOpenRouter = models.some((m) => m && m.src === 'openrouter');
  const keep = arr.filter((id) => {
    const known = byId[id];
    if (known) return known.chat !== false;           // видели и отвергли — модель не для чата
    if (!/:free$/i.test(String(id))) return true;     // алиасы (openrouter/free) и локальные имена не трогаем
    if (providerId === 'xkiro' && String(id).indexOf('/') < 0) return true;  // родные id xkiro вне нашего каталога
    return !sawOpenRouter;                             // id вида вендор/модель:free, каталог прочитан, модели нет — сняли
  });
  return keep.length ? keep : arr;                    // вымер весь пул — оставляем как есть
}

/**
 * Что показать человеку: проверенные пулами движка модели — первыми, дальше всё
 * остальное из каталога. `curatedIds` приходят из `engine/providers.js`, чтобы
 * витрина и возможность выбора не разъезжались.
 */
export function showcase(cat, opts = {}) {
  const curatedIds = Array.isArray(opts.curatedIds) ? opts.curatedIds : [];
  const pickIds = Array.isArray(opts.pickIds) ? opts.pickIds : [];
  const pool = new Set(curatedIds);
  const tiers = opts.tierOf || (() => 'fast');
  const out = [];
  const seen = new Set();
  for (const id of pickIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = cat && cat.byId ? cat.byId[id] : null;
    out.push({
      id, name: (m && m.name) || prettyName({ id, name: id }), vendor: (m && m.vendor) || (String(id).split('/')[0] || '').toUpperCase(),
      vision: m ? (m.visionKnown ? !!m.vision : undefined) : undefined,
      ctx: m ? m.ctx : undefined, maxOut: m ? m.maxOut : undefined,
      tier: tiers(id), curated: pool.has(id), src: m ? m.src : 'pool', desc: (m && m.desc) || '',
    });
  }
  const rest = ((cat && cat.models) || [])
    .filter((m) => m.free && m.chat !== false && !seen.has(m.id))
    .sort((a, b) => (String(a.vendor).localeCompare(String(b.vendor))) || String(a.name).localeCompare(String(b.name)))
    .slice(0, MAX_ENTRIES - out.length);
  for (const m of rest) {
    out.push({
      id: m.id, name: m.name, vendor: m.vendor, vision: m.vision, ctx: m.ctx, maxOut: m.maxOut,
      tier: pool.has(m.id) ? tiers(m.id) : (m.uncensored ? 'smart' : 'fast'),
      curated: false, src: m.src, desc: m.desc, uncensored: !!m.uncensored, tools: !!m.tools,
    });
  }
  return out;
}

export const TEST = { fromOpenRouter, fromXkiro, isFree, prettyName, decode, ttlMs, NON_CHAT_HINT, index };
