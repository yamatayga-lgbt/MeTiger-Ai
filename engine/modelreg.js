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
import { envKeys } from './providers.js';
import { VERIFIED as CHECKED } from './models-verified.js'
const MAX_ENTRIES = 900;
/* Сколько строк берём у одного провайдера: odirouter выдаёт 232 id разом, и
   если их не порезать, один говорливый агрегатор вытеснит всех остальных. */
let PER_SOURCE = 200;
/* Переменная приходит из env Pages (process.env тут трогать нельзя: в воркере его
   по-настоящему нет), а дефолт живёт здесь. */
function perSource(env) {
  return clamp(num(env && env.MODELS_PER_SOURCE, PER_SOURCE), 20, 600);
}

/* Модель не для чата: классификаторы, модерация, эмбеддинги. Такие в ротации
   только жуют квоту и никогда не дают ответа (выведено на доноре). */
/* Модель не для чата: классификаторы, модерация, эмбеддинги, генерация
   картинок и музыки. Такие в ротации только жуют квоту и никогда не дают ответа
   (выведено на доноре). В каталоге OpenRouter они тоже есть с ценой 0 —
   например nvidia/nemotron-3.5-content-safety и google/lyria — и без этого
   фильтра полезли бы и в список выбора, и в обход. */
const NON_CHAT_HINT = /(embedding|classifier|moderation|-safety|safety-|content-safety|prompt-guard|safeguard|guard|whisper|tts|-tts|dall|lyria|music|suno|sora|speech|voice|orpheus|voxtral|imagen|flux|kontext|stable-diffusion|midjourney|seedream|seedance|nano-banana|kling|wan2|vidu|hunyuan|-3d|i2v|t2v|img2|image|-image|-img|inpaint|variation|-vid|video|clip|rerank|realtime|transcribe|transcription|livetranslate|audio-|-audio|-ocr|ocr-|computer-use|robotics|deep-research|antigravity|fim-|-fim)/i;

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
    priceKnown: true,
    ctx: num(m.context_length ?? top.context_length, 32768),
    maxOut: num(top.max_completion_tokens, 4096),
    vision: knownMod ? inMod.indexOf('image') >= 0 : /vision|multimodal|-vl\b/i.test(lower),
    visionKnown: knownMod,
    tools: params.indexOf('tools') >= 0 || params.indexOf('function_calling') >= 0,
    canExcludeReasoning: params.indexOf('reasoning') >= 0 || params.indexOf('include_reasoning') >= 0,
    chat: !(NON_CHAT_HINT.test(lower) || (outMod.length && outMod.indexOf('text') < 0)),
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || '').replace(/\s+/g, ' ').trim().slice(0, 160),
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
    priceKnown: true,
    ctx: num(m.context_length, 32768),
    maxOut: num(m.max_output_tokens, 4096),
    vision: !!cap.vision,
    visionKnown: true,
    tools: cap.tools !== false,
    canExcludeReasoning: !!cap.reasoning,
    chat: m.modality !== 'embedding' && !NON_CHAT_HINT.test(lower),
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

/** Output-модальности: если провайдер их назвал, верить надо им, а не имени. */
function textOut(m) {
  const out = Array.isArray(m && m.output_modalities) ? m.output_modalities : [];
  if (!out.length) return true;
  return out.indexOf('text') >= 0;
}

/**
 * Запись OpenAI-совместимого `/v1/models` у самого провайдера (groq, mistral,
 * cerebras, z.ai, odirouter, sharellm, atria). Имена у всех скачут, поэтому
 * читаем известные варианты, а выдумываем только то, чего провайдер не сказал.
 * Смысл не в длине списка, а в потолках: у groq есть context_window и
 * max_completion_tokens, у mistral — max_context_length и capabilities, и без
 * них движок сидел на выдуманных 32768/4096 для 101 модели из пулов.
 */
function fromProviderList(m, src, opts = {}) {
  if (!m || typeof m.id !== 'string' || !m.id) return null;
  const cap = m.capabilities || {};
  const lower = m.id.toLowerCase();
  const inMod = Array.isArray(m.input_modalities) ? m.input_modalities : [];
  const knownMod = inMod.length > 0 || Array.isArray(m.output_modalities) || typeof m.modality === 'string';
  const vision = knownMod
    ? (inMod.length ? inMod.indexOf('image') >= 0 : /vision|multimodal|image/i.test(String(m.modality || '')))
    : /vision|multimodal|-vl\b/i.test(lower);
  const priced = isFree(m) || m.access_tier === 'free' || m.access_tier === 'free_tier';
  const ssp = Array.isArray(m.supported_sampling_parameters) ? m.supported_sampling_parameters : [];
  return {
    id: m.id,
    name: prettyName(m),
    vendor: (m.owned_by ? String(m.owned_by) : src).slice(0, 18).toUpperCase(),
    src,
    /* Провайдер не пишет в списке, бесплатна ли модель (groq и mistral тарифицируют
       токенами, бесплатность — в суточной квоте). Честнее пометить «цена не
       проверена», чем наврать, что бесплатно: движок от этого ничего не решает
       (сам он ходит только по своим пулам), а человек видит оговорку. */
    free: priced || opts.priceUnknown === true,
    priceKnown: priced,
    ctx: num(m.context_window ?? m.context_length ?? m.max_context_length ?? m.max_context_tokens, 32768),
    maxOut: num(m.max_completion_tokens ?? m.max_output_tokens ?? m.max_output_length ?? m.completion_tokens_allowed, 4096),
    vision,
    visionKnown: knownMod,
    tools: typeof cap.function_calling === 'boolean' ? cap.function_calling : (typeof cap.tools === 'boolean' ? cap.tools : undefined),
    reasoning: typeof cap.reasoning === 'boolean' ? cap.reasoning : (ssp.length ? ssp.some((x) => /reasoning/i.test(String(x))) : undefined),
    canExcludeReasoning: ssp.some((x) => /reasoning|thinking/i.test(String(x))) || undefined,
    chat: m.active !== false && !m.deprecation && cap.completion_chat !== false &&
      !(NON_CHAT_HINT.test(lower) || !textOut(m)),
    deprecated: !!m.deprecation,
    replaces: m.deprecation_replacement_model || undefined,
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || m.name || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

/**
 * Список Gemini (`/v1beta/models`) устроен иначе: id в `name` с префиксом
 * `models/`, модальностей нет, зато есть supportedGenerationMethods — по нему
 * и режем всё, что не умеет обычный generateContent (tts, live, embeddings).
 */
function fromGemini(m) {
  const id = String((m && m.name) || '').replace(/^models\//, '');
  if (!id) return null;
  const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
  const lower = id.toLowerCase();
  return {
    id,
    name: String(m.displayName || prettyName({ id })).slice(0, 48),
    vendor: 'GOOGLE',
    src: 'gemini',
    free: true,
    priceKnown: false,
    ctx: num(m.inputTokenLimit, 32768),
    maxOut: num(m.outputTokenLimit, 8192),
    /* модальностей список не сообщает — значит решаем по имени и честно
       говорим, что это догадка: visionKnown=false, и движок не запретит картинку,
       но и не потащит её вслепую */
    vision: /flash|pro|gemma|omni|note|vision|multimodal/i.test(lower) && !/transcribe|lite-tts|-tts/i.test(lower),
    visionKnown: false,
    tools: undefined,
    reasoning: !!m.thinking || undefined,
    chat: (methods.length === 0 || methods.indexOf('generateContent') >= 0) && !NON_CHAT_HINT.test(lower),
    uncensored: UNCENSORED_HINTS.some((h) => lower.indexOf(h) >= 0),
    desc: String(m.description || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

/* Провайдеры, у которых свой список открыт и читается тем же ключом, что и чат.
   Ключа нет — источника просто нет: не дергаем сеть на каждом обновлении. */
export const LIST_SOURCES = {
  groq: { url: 'https://api.groq.com/openai/v1/models', prefix: 'GROQ', priceUnknown: true },
  mistral: { url: 'https://api.mistral.ai/v1/models', prefix: 'MISTRAL', priceUnknown: true },
  cerebras: { url: 'https://api.cerebras.ai/v1/models', prefix: 'CEREBRAS', priceUnknown: true },
  /* У z.ai все ручки POST-овые: на GET их же адрес отвечает 405, и это было видно
     в каталоге как вечная ошибка «zai: HTTP 405» (дважды — ещё и повтор был).
     Ключ на месте, модели в пуле работают; не хватало только формы запроса. */
  zai: { url: 'https://api.z.ai/api/paas/v4/models', prefix: 'ZAI', priceUnknown: true, postOnly: true },
  odirouter: { url: 'https://api.odirouter.ai/v1/models', prefix: 'ODIROUTER', priceUnknown: true },
  sharellm: { url: 'https://sharellm.net/v1/models', prefix: 'SHARELLM', priceUnknown: true },
  atria: { url: 'https://api.atria-asi.ai/v1/models', prefix: 'ATRIA', priceUnknown: true },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', prefix: 'GEMINI', kind: 'gemini', priceUnknown: true },
};

/** Какие нативные списки вообще можно спросить в этом окружении. */
export function listSources(env, opts = {}) {
  const keys = opts.keys || envKeys;
  return Object.keys(LIST_SOURCES).filter((id) => keys(env, LIST_SOURCES[id].prefix).length > 0);
}

/** Один источник → его строки. Возвращаем и заголовок авторизации, и парсер. */
function nativeCfg(src, env) {
  const c = LIST_SOURCES[src];
  if (!c) return null;
  const keys = envKeys(env, c.prefix);
  if (!keys.length) return null;
  const head = c.kind === 'gemini'
    ? { 'x-goog-api-key': keys[0] }
    : { authorization: 'Bearer ' + keys[0] };
  return {
    url: c.url,
    /* postOnly значит «этот адрес отвечает 405 на GET, пробуй POST» (см. LIST_SOURCES.zai) */
    postOnly: !!c.postOnly,
    headers: Object.assign({ accept: 'application/json' }, head),
    pick: (d) => (Array.isArray(d && d.data) ? d.data : (Array.isArray(d && d.models) ? d.models : (Array.isArray(d && d.result) ? d.result : []))),
    map: c.kind === 'gemini' ? fromGemini : ((m) => fromProviderList(m, src, { priceUnknown: c.priceUnknown })),
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
/**
 * Что сказать про отказ каталога. Молчаливый «HTTP 405» в ответе /api/models
 * выглядит как поломка проекта, хотя означает конкретную вещь: у этого провайдера
 * список моделей не отдаётся вообще, а его модели работают из пула движка.
 */
function catalogErrorOf(src, status) {
  const code = Number(status) || 0;
  const e = new Error(
    code === 405 ? 'список моделей не отдаётся по этому адресу (HTTP 405) — их видно в выборе из пула движка'
      : code === 401 || code === 403 ? 'ключ не принят (HTTP ' + code + ')'
        : code === 404 ? 'адреса списка моделей больше нет (HTTP 404)'
          : 'HTTP ' + code
  );
  e.status = code;
  return e;
}

export async function fetchCatalog(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return { models: [], errors: ['нет fetch'] };
  const timeoutMs = clamp(num(opts.timeoutMs, 8000), 1500, 20000);
  const attempts = clamp(num(opts.attempts, 2), 1, 3);
  const env = opts.env || {};
  const sources = Array.isArray(opts.sources) && opts.sources.length
    ? opts.sources
    /* OpenRouter и Xkiро — всегда (их списки открыты без ключа и дают бесплатные
       модели всему миру). Остальные — только если у нас есть их ключ: без ключа
       запрос вернул бы 401 и занял место в ошибках. */
    : ['openrouter', 'xkiro'].concat(listSources(env));
  const models = [];
  const errors = [];
  const read = {};
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  for (const src of sources) {
    const cfg = PARSERS[src] || nativeCfg(src, env);
    if (!cfg) { errors.push(src + ': нет парсера'); continue; }
    let got = null;
    /* stop — «отказ определённый, повтор не поможет»: 401/403/404/405 лечатся не
       повтором, а другим ключом или другим адресом. Раньше z.ai успевал положить
       две одинаковые строки в каждый ответ каталога. */
    let stop = false;
    for (let i = 0; i < attempts && !got && !stop; i++) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      if (timer && timer.unref) timer.unref();
      try {
        let r = await fetchImpl(cfg.url, {
          headers: Object.assign({ 'User-Agent': 'MeTigerAi/0.011' }, cfg.headers || { accept: 'application/json' }),
          signal: ctl ? ctl.signal : undefined,
        });
        /* 405 на GET — не «источника нет», а «этот адрес ждёт другую форму запроса»
           (у z.ai все ручки POST-овые). Пробуем то, что он просит, один раз. */
        if (r && r.status === 405 && cfg.postOnly) {
          r = await fetchImpl(cfg.url, {
            method: 'POST',
            headers: Object.assign({ 'User-Agent': 'MeTigerAi/0.011', 'content-type': 'application/json' }, cfg.headers || {}),
            body: '{}',
            signal: ctl ? ctl.signal : undefined,
          });
        }
        if (!r || !r.ok) throw catalogErrorOf(src, r && r.status);
        const data = cfg.pick(await r.json());
        if (!data.length) throw new Error('пустой список');
        got = data.map(cfg.map).filter(Boolean).slice(0, perSource(env));
      } catch (e) {
        errors.push(src + ': ' + String((e && e.message) || e).replace(/^Error:\s*/, ''));
        /* Определённый отказ (401/403/404/405) повтором не лечится: это не «сеть
           мигнула», а «так нельзя». Раньше z.ai давал две одинаковые строки в
           каждом ответе каталога, и по ним нельзя было понять, что случилось. */
        const status = Number(e && e.status) || 0;
        const definite = status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (definite) stop = true;
        else if (i < attempts - 1) await sleep(Math.min(4000, 500 * 2 ** i));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (got) {
      read[src] = true;
      for (const m of got) models.push(m);
    }
  }
  /* Одинаковые строки в списке ошибок ничего не добавляют: «zai: HTTP 503» дважды —
     это одна беда, а не две. Порядок сохраняем: первая беда важнее. */
  return { models, errors: Array.from(new Set(errors)), read };
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
    if (!m || !m.id) continue;
    if (!m.free || m.chat === false) continue;
    const prev = byId[m.id];
    if (!prev) { byId[m.id] = m; out.push(m); continue; }
    /* Тот же id у другого провайдера: строку в списке держим одну, но дописываем
       ей то, чего первый источник не знал. Иначе `gemini-3.5-flash` приехал бы
       из OdiRouter с пустыми потолками и человек увидел бы «32К/4К» там, где
       Google честно сказал «1М/64К». */
    if (m.src !== prev.src) {
      /* Про каждого провайдера держим ЕГО данные: поток через агрегатор не обязан
         уметь столько, сколько обещает первоисточник. */
      const fact = (o) => ({ ctx: o.ctx, maxOut: o.maxOut, vision: o.vision, visionKnown: o.visionKnown, tools: o.tools, reasoning: o.reasoning, priceKnown: o.priceKnown });
      if (!prev.perSrc) prev.perSrc = { [prev.src]: fact(prev) };
      prev.perSrc[m.src] = fact(m);
      /* Витрину ведём за тем, кто про модель знает больше: строка `gemini-3.5-flash`
         должна быть подписана Google (у него есть потолки и модальности), а не
         агрегатором, который прислал пустую строку. Маршрутизации это не касается —
         она читает perSrc того провайдера, куда реально идёт запрос. */
      const score = (o) => (o.visionKnown ? 2 : 0) + (o.ctx !== 32768 || o.maxOut !== 4096 ? 1 : 0) +
        (o.desc ? 1 : 0) + (o.tools !== undefined ? 1 : 0);
      const all = Array.from(new Set([].concat(prev.also || [], prev.src, m.src)));
      if (score(m) > score(prev)) {
        const keep = fact(prev);
        const who = prev.src;
        const per = Object.assign({}, prev.perSrc, m.perSrc);
        Object.assign(prev, m);
        prev.perSrc = per;
        prev.perSrc[who] = per[who] || keep;   /* про агрегатора не забываем */
      } else {
        if (prev.ctx === 32768 && m.ctx !== 32768) prev.ctx = m.ctx;
        if (prev.maxOut === 4096 && m.maxOut !== 4096) prev.maxOut = m.maxOut;
        if (!prev.visionKnown && m.visionKnown) { prev.vision = m.vision; prev.visionKnown = true; }
        if (prev.tools === undefined && m.tools !== undefined) prev.tools = m.tools;
        if (prev.reasoning === undefined && m.reasoning !== undefined) prev.reasoning = m.reasoning;
        if (!prev.priceKnown && m.priceKnown) prev.priceKnown = true;
        if (!prev.desc && m.desc) prev.desc = m.desc;
      }
      prev.also = all;
    }
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
  return {
    updatedAt: Number(opts.now) || Date.now(), count: kept.length, total: out.length,
    models: kept, byId: null,
    /* какие списки ПРОЧИТАНЫ в этом обновлении — по этому признаку prune и решает,
       можно ли считать «нет в списке» как «модель мертва» */
    read: opts.read && typeof opts.read === 'object' ? opts.read : null,
  };
}

/**
 * Индексы достраиваем на месте — в KV их не пишем. `bySrc` нужен потому, что
 * один и тот же id могут выдавать несколько провайдеров (`gemini-3.5-flash` есть
 * и у Google, и у OdiRouter), а потолки у них РАЗНЫЕ: у Google 1 048 576/65 536,
 * у агрегатора их списка нет вовсе. Брать первое попавшееся — значит слать
 * агрегатору запрос с чужим лимитом и ловить 400.
 */
function index(cat) {
  if (!cat) return null;
  if (!cat.byId) {
    const byId = Object.create(null);
    const bySrc = Object.create(null);
    for (const m of cat.models || []) {
      if (!m || !m.id) continue;
      if (!byId[m.id]) byId[m.id] = m;
      if (!bySrc[m.src]) bySrc[m.src] = Object.create(null);
      bySrc[m.src][m.id] = m;
    }
    cat.byId = byId;
    cat.bySrc = bySrc;
  }
  return cat;
}

/** Запись о модели: сначала у того провайдера, куда идёт запрос, потом любая. */
function rowOf(cat, id, providerId) {
  if (!cat || !id) return null;
  const own = providerId && cat.bySrc ? cat.bySrc[providerId] : null;
  if (own && own[id]) return own[id];
  return (cat.byId && cat.byId[id]) || null;
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
  const { models, errors, read } = await fetchCatalog(Object.assign({ env }, opts));
  if (!models.length) {
    /* Ничего не вытащили — оставляем то, что знали (пусть и протухшее): лучше
       старый каталог, чем движок, который снова начал угадывать по имени. */
    memo = { at: now, cat: cur || null };
    return cur ? Object.assign({}, cur, { errors }) : { updatedAt: 0, count: 0, models: [], byId: null, errors };
  }
  const cat = index(buildCatalog(models, { curated: opts.curated, now, read }));
  if (errors.length) cat.errors = errors;
  if (store) {
    try {
      const val = JSON.stringify({ updatedAt: cat.updatedAt, count: cat.count, models: cat.models, read: cat.read || null });
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
/** Если о модели есть сведения именно от того провайдера, куда идём, — верим им. */
function factOf(m, providerId) {
  if (!m || !providerId || !m.perSrc) return m;
  return m.perSrc[providerId] || m;
}

export function ceilings(cat, id, providerId) {
  const m = rowOf(cat, id, providerId);
  if (!m) return null;
  const src = factOf(m, providerId);
  return { ctx: num(src.ctx, 32768), maxOut: Math.max(256, num(src.maxOut, 4096) - 1) };
}

/** Зрение по каталогу; null — каталог не знает, решаем по имени. */
export function visionOf(cat, id, providerId) {
  const m = factOf(rowOf(cat, id, providerId), providerId);
  if (!m || !m.visionKnown) return null;
  return !!m.vision;
}

/** Модель умеет инструменты? null — не знаем (считаем, что умеет, как раньше). */
export function toolsOk(cat, id, providerId) {
  const m = factOf(rowOf(cat, id, providerId), providerId);
  if (!m || m.tools === undefined) return null;
  return !!m.tools;
}

/**
 * Чей это id, если модели нет ни в одном пуле. Без этого ручной выбор модели из
 * каталога молча превращался в «Авто» — человек тыкал в модель, а отвечала другая.
 */
/**
 * Чей это id, если модели нет ни в одном нашем пуле. Пока каталог знал только
 * OpenRouter с Xkiро, ответ был из двух строк, и всё остальное снималось в «Авто»
 * — человек выбирал `mistral-code-latest`, а ему отвечал Groq. Теперь у каждого
 * провайдера прочитан свой список, поэтому владельца отдаёт сам источник строки.
 */
export function ownerOf(cat, id) {
  const m = cat && cat.byId ? cat.byId[id] : null;
  if (!m) return null;
  /* Пуловые id без привязки к списку по-прежнему пробуем через OpenRouter: он
     терпит голые имена (glm-4.7-flash и прочее), остальные шлюзы на них 404-ят. */
  if (m.src === 'pool') return 'openrouter';
  return LIST_SOURCES[m.src] || m.src === 'openrouter' || m.src === 'xkiro' ? m.src : null;
}

/**
 * Вычистить из пула id, которых нет в живом каталоге (модель сняли — 404 и
 * потраченная квота). Работает только для провайдеров, чей каталог мы видим,
 * и только если каталог свежий: протухший каталог не имеет права ничего убирать.
 */
export function prune(cat, providerId, list) {
  const arr = Array.isArray(list) ? list : [];
  if (!cat || cat.stale || !arr.length) return arr;
  const models = cat.models || [];
  if (!models.length) return arr;                    // пустой каталог — не судья
  const byId = cat.byId || Object.create(null);
  /* Два уровня доверия к «модели нет в списке».
     Мёртвоеknown: провайдер сам сказал про этот id что-то плохое (не чат, снята,
     устарела) — такое убираем везде, где источник прочитан.
     Неизвестное: список прочитан, id в нём не найден. Это судит только агрегаторов
     с полным открытым списком (openrouter, xkiro). У z.ai, например, список
     неполный: бесплатные алиасы glm-4.7-flash в него не входят, и «нет в списке»
     там означало бы «список не полный», а не «модель мертва». */
  const full = providerId === 'openrouter' || providerId === 'xkiro';
  /* Карты прочитанного может и не быть (каталог старее этого кода) — для
     агрегаторов считаем, что список читали, они и раньше так жили. */
  const saw = cat.read ? !!cat.read[providerId] : full;
  const sawOpenRouter = models.some((m) => m && m.src === 'openrouter');
  const keep = arr.filter((id) => {
    const known = byId[id];
    if (known) return known.chat !== false && !known.deprecated;
    if (!saw || !full) return true;
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
  /* Снимок живой проверки (engine/models-verified.js). Два правила, оба — про то, что
     человек видит в списке, а не про то, куда движок пошлёт запрос:
       · имя, на котором провайдер отвечает другой моделью, в списке быть не должно;
       · имя с неизвестной ценой (алиасы агрегаторов) оставляем, только если оно
         проверено живым; «бесплатно» для них никто не подтверждал.
     Если снимка нет (проверку ещё не повторяли) — не режем ничего. */
  const ver = opts.verified || CHECKED || {};
  const alive = new Set(ver.alive || []);
  const dead = new Set(ver.dead || []);
  const audited = !!(ver.alive || []).length || !!(ver.dead || []).length;
  const tiers = opts.tierOf || (() => 'fast');
  const out = [];
  const seen = new Set();
  for (const id of pickIds) {
    if (seen.has(id)) continue;
    if (audited && dead.has(id)) continue;
    seen.add(id);
    const m = cat && cat.byId ? cat.byId[id] : null;
    out.push({
      id, name: (m && m.name) || prettyName({ id, name: id }), vendor: (m && m.vendor) || (String(id).split('/')[0] || '').toUpperCase(),
      vision: m ? (m.visionKnown ? !!m.vision : undefined) : undefined,
      ctx: m ? m.ctx : undefined, maxOut: m ? m.maxOut : undefined,
      tier: tiers(id), curated: pool.has(id), src: m ? m.src : 'pool', desc: (m && m.desc) || '',
      priceKnown: m ? !!m.priceKnown : false, reasoning: m ? m.reasoning : undefined,
      tools: m ? m.tools : undefined,
    });
  }
  const rest = ((cat && cat.models) || [])
    .filter((m) => m.free && m.chat !== false && !seen.has(m.id))
    .filter((m) => !audited || !dead.has(m.id))
    .filter((m) => !audited || m.priceKnown || alive.has(m.id))
    .sort((a, b) => (String(a.vendor).localeCompare(String(b.vendor))) || String(a.name).localeCompare(String(b.name)))
    .slice(0, MAX_ENTRIES - out.length);
  for (const m of rest) {
    out.push({
      id: m.id, name: m.name, vendor: m.vendor, vision: m.vision, ctx: m.ctx, maxOut: m.maxOut,
      tier: pool.has(m.id) ? tiers(m.id) : (m.uncensored ? 'smart' : 'fast'),
      curated: false, src: m.src, desc: m.desc, uncensored: !!m.uncensored, tools: !!m.tools,
      priceKnown: !!m.priceKnown, reasoning: m.reasoning,
    });
  }
  return out;
}

/** Последняя попытка обновить каталог: чтобы не долбить провайдера на каждый запрос. */
let lastTry = 0;
const TRY_FLOOR_MS = 60 * 1000;

/** Обновление с тормозом: не чаще, чем раз в минуту, независимо от числа запросов. */
export async function maybeRefresh(env, store, opts = {}) {
  const now = Date.now();
  if (now - lastTry < TRY_FLOOR_MS) return null;
  lastTry = now;
  return refresh(env, store, opts);
}

/**
 * Прогрев перед запросом. Именно здесь прячется грабля, которую показал прод:
 * memo изолята пуст, движок читает каталог синхронно — и пин модели из каталога
 * молча снимался, отвечала другая. Поэтому каталог достаётся из KV ДО вызова
 * движка, а обновление уезжает в waitUntil и не задерживает ответ.
 */
export async function warm(env, store, waitUntil) {
  let cat = null;
  try { cat = await loadCatalog(store, { env }); } catch (e) { cat = null; }
  if (!cat || cat.stale) {
    const job = () => maybeRefresh(env, store, {}).catch(() => {});
    if (typeof waitUntil === 'function') waitUntil(Promise.resolve().then(job));
    else Promise.resolve().then(job);
  }
  return cat;
}

/** Только для тестов: затормозить/разтормозить фоновое обновление. */
export function resetThrottle() { lastTry = 0; }

export const TEST = { fromOpenRouter, fromXkiro, fromProviderList, fromGemini, nativeCfg, listSources, LIST_SOURCES, isFree, prettyName, decode, ttlMs, NON_CHAT_HINT, index };
