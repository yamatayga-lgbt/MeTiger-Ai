/**
 * Картинки (imggen) — слой генерации и правки изображений.
 *
 * ЗАЧЕМ ОН ТАКОЙ СЛОЖНЫЙ. Донор (yama-ai/imggen.js) рисовал через Cloudflare Workers AI.
 * У нас этот путь закрыт, и закрыт он не в коде, а снаружи — замеры 2 октября 2026 нашим
 * же ключом и с же прода:
 *   • Cloudflare `/ai/v1/*` — `401 Authentication error` на ЛЮБУЮ модель, текстовые тоже:
 *     провайдер `cloudflare` жив на проде только в списке `alive` (он построен на наличии
 *     ключа), а каждый вызов отвечает 401 «ключ не принят»;
 *   • Gemini, image-модели (`gemini-2.5-flash-image`, `gemini-3.1-flash-image`,
 *     `gemini-3.1-flash-lite-image`, `gemini-3-pro-image-preview`) — `429 RESOURCE_EXHAUSTED`:
 *     текст тем же ключом отвечает, на картинки бесплатной квоты нет;
 *   • OdiRouter — 117 картиночных id, из них бесплатных ровно два (`free-gpt-image-2`,
 *     `free-gpt-image-2-edit`), и оба отвечают `503 model_not_found — нет доступного канала`;
 *     остальные — `403 paid_multimodal_model_forbidden`;
 *   • Pollinations — 402 на любой промпт, которого нет в кэше: бесплатного прохода больше нет;
 *   • OpenRouter — 4 image-модели в списке, все платные.
 * Поэтому здесь не «ещё один инструмент», а цепочка источников с ЧЕСТНЫМ ВЕРДИКТОМ:
 * источник, который трижды ответил ошибкой, молчит `IMGGEN_RETRY_MS`, а человек и модель
 * видят причину словами, а не пустой ответ или — хуже — выдуманной «картинкой».
 *
 * Что слой умеет, когда хоть один источник жив:
 *   • generate(prompt) — картинка по описанию;
 *   • edit(prompt, images) — правка картинки, которую человек приложил (u Gemini это
 *     тот же generateContent с входными parts, u OdiRouter — отдельная edit-модель);
 *   • готовность (ready) — для навыков категории `editing`: они включаются только когда
 *     правка действительно чем-то выполняется, а не «на всякий случай».
 *
 * Ни одного нового ключа, ни одного платного тарифа: источники строятся из того, что уже
 * лежит в окружении (`GEMINI_KEYS`, `ODIROUTER_KEYS`). `IMGGEN=off` — слой выключен совсем.
 */

const TIMEOUT_MS = 90000;        /* генерация — не поиск: 90 с потолок на источник (IMGGEN_TIMEOUT_MS) */
const FAIL_TTL_MS = 300000;      /* источник с ошибкой не трогаем 5 минут (IMGGEN_RETRY_MS) */
/* Лимит — не поломка: «бесплатный доступ кончился на минуту» лечится ожиданием в
   минуту, а не парковкой на пять. Живой прод 6 окт 2026: Pollinations отдавал 402
   пачками, и после первого такого ответа картинки пропадали на 5 минут. */
const BUSY_TTL_MS = 60000;       /* источник с 402/429 не трогаем минуту (IMGGEN_BUSY_MS) */

/** env-переключатель: пустое и нечисловое — дефолт, 0 разрешён (отключить парковку). */
const numOr = (v, d) => {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : d;
};
const MAX_IMAGE_BYTES = 1536 * 1024;
const DEFAULT_SIZE = '1024x576';

const IMG_MIME = (b) => {
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 12 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF') return 'image/webp';
  if (b.length > 6 && String.fromCharCode(b[0], b[1], b[2]) === 'GIF') return 'image/gif';
  return 'image/png';
};

const b64enc = (bytes) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};
const b64dec = (s) => {
  const bin = atob(String(s || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* ============================== источники ============================== */

const first = (v) => String(v || '').split(',')[0].trim();

/** OdiRouter: OpenAI-совместимые /v1/images/{generations,edits}, у free-каналов квоты нет. */
/* Имена моделей у бесплатных шлюзов меняются без предупреждения: 11 окт 2026 на
   проде живой прогон получил model_not_found на единственном зашитом имени, и это
   выглядело как «картинки сломались», хотя канал был жив. Теперь имя — список
   кандидатов: пробуем по очереди, отвечавшее запоминаем на изолят и начинаем с
   него. Прописанное в окружении имя всегда идёт первым. */
let odiGenTurn = 0;
let odiEditTurn = 0;
const ODI_GEN_CANDIDATES = ['free-gpt-image-2', 'gpt-image-1', 'flux-schnell', 'flux', 'qwen-image'];
const ODI_EDIT_CANDIDATES = ['free-gpt-image-2-edit', 'gpt-image-1-edit', 'qwen-image-edit'];

function odiModels(env, name, candidates) {
  const raw = String(env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = (raw.length ? raw : candidates).slice();
  /* Первым — то, что уже отвечало: как в переборе ключей у gemini. */
  return { make: () => list, candidates: list };
}

function odirouterSource(env) {
  const key = first(env.ODIROUTER_KEYS || env.ODIROUTER_KEY);
  if (!key) return null;
  const genList = odiModels(env, 'IMGGEN_ODI_MODEL', ODI_GEN_CANDIDATES).candidates;
  const editList = odiModels(env, 'IMGGEN_ODI_EDIT_MODEL', ODI_EDIT_CANDIDATES).candidates;
  const base = 'https://api.odirouter.ai/v1';
  const post = async (path, payload, fetchImpl) => {
    const r = await fetchImpl(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* не json — разберём ниже */ }
    if (!r.status || r.status >= 400) {
      const e = j && j.error;
      throw new Error((e && (e.code || e.message)) || ('http ' + r.status + ' ' + String(txt).slice(0, 80)));
    }
    const item = ((j && j.data) || [])[0] || {};
    const bytes = item.b64_json ? b64dec(item.b64_json) : null;
    if (!bytes && !item.url) throw new Error('источник вернул ответ без картинки');
    return { bytes, url: item.url || '' };
  };
  /* Пробуем имена по очереди. «Нет такой модели» — не повод считать канал мёртвым:
     идём дальше. Ошибку отдаём только когда имена кончились. */
  const tryList = async (path, makeBody, list, turn, fetchImpl) => {
    const order = list.map((_, i) => (turn + i) % list.length);
    let lastWhy = 'ни одно имя модели не подошло';
    for (const idx of order) {
      try {
        return { out: await post(path, makeBody(list[idx]), fetchImpl), model: list[idx] };
      } catch (e) {
        lastWhy = String((e && e.message) || e);
        if (!/model_not_found|not found|unknown model|404/i.test(lastWhy)) break;
      }
    }
    throw new Error(lastWhy);
  };
  return {
    id: 'odirouter',
    edits: true,
    async generate({ prompt, size, fetchImpl }) {
      const r = await tryList('/images/generations', (m) => ({ model: m, prompt, n: 1, size: size || DEFAULT_SIZE }), genList, odiGenTurn, fetchImpl);
      odiGenTurn = genList.indexOf(r.model) >= 0 ? genList.indexOf(r.model) : odiGenTurn;
      return r.out;
    },
    async edit({ prompt, images, size, fetchImpl }) {
      const img = (images || [])[0];
      if (!img) throw new Error('для правки нужна картинка во вложении');
      const r = await tryList('/images/edits', (m) => ({
        model: m, prompt, n: 1, size: size || DEFAULT_SIZE,
        image: 'data:' + (img.mime || 'image/png') + ';base64,' + img.data,
      }), editList, odiEditTurn, fetchImpl);
      odiEditTurn = editList.indexOf(r.model) >= 0 ? editList.indexOf(r.model) : odiEditTurn;
      return r.out;
    },
  };
}

/** Gemini: generateContent с responseModalities — картинка на выход, входные parts = правка. */
/* У Gemini картинки упираются в дневную квоту ключа. Ключей в GEMINI_KEYS обычно
   несколько, а источник брал только первый — и когда на нём квота кончалась,
   картинки «ломались» при живых остальных ключах. Теперь перебираем все ключи,
   запоминаем на изолят тот, который отвечал, и начинаем с него: обычно попадаем
   с первого раза, а при исчерпании — молча идём к следующему. */
let gemKeyTurn = 0;

function geminiSource(env) {
  const keys = String(env.GEMINI_KEYS || env.GOOGLE_API_KEY || '')
    .split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return null;
  const model = String(env.IMGGEN_GEMINI_MODEL || 'gemini-2.5-flash-image');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const call = async (parts, fetchImpl) => {
    const order = keys.map((_, i) => (gemKeyTurn + i) % keys.length);
    let lastWhy = 'ни один ключ не ответил';
    for (const idx of order) {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': keys[idx] },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
      });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch { /* нет */ }
      if (!r.status || r.status >= 400) {
        const e = j && j.error;
        lastWhy = (e && e.status ? e.status + ' ' + String(e.message).slice(0, 70) : 'http ' + r.status);
        continue;
      }
      const out = ((j && j.candidates) || [])[0];
      const list = (out && out.content && out.content.parts) || [];
      const img = list.find((p) => p && p.inlineData && p.inlineData.data);
      if (!img) {
        /* Модель ответила текстом: это не про ключ, второй ключ даст то же самое —
           причину отдаём как есть, не жжём остальные. */
        lastWhy = 'модель ответила текстом без картинки';
        break;
      }
      gemKeyTurn = idx;
      return {
        bytes: b64dec(img.inlineData.data),
        url: '',
        text: list.filter((p) => p && p.text).map((p) => p.text).join(' ').trim(),
      };
    }
    /* Все ключи в лимите — так и скажем: это честнее, чем «429» без числа ключей. */
    const allQuota = /RESOURCE_EXHAUSTED|429|exceeded/i.test(lastWhy);
    throw new Error(allQuota && keys.length > 1
      ? lastWhy + ' (проверено ключей: ' + keys.length + ')'
      : lastWhy);
  };
  return {
    id: 'gemini',
    edits: true,
    async generate({ prompt, fetchImpl }) { return call([{ text: prompt }], fetchImpl); },
    async edit({ prompt, images, fetchImpl }) {
      const parts = (images || []).slice(0, 2).map((i) => ({ inlineData: { mimeType: i.mime || 'image/png', data: i.data } }));
      if (!parts.length) throw new Error('для правки нужна картинка во вложении');
      parts.push({ text: prompt });
      return call(parts, fetchImpl);
    },
  };
}

/**
 * Cloudflare Workers AI (0.177) — картинки без единого ключа.
 *
 * Почему это главный канал, а не «ещё один»: воркеру достаточно привязки `AI`
 * (wrangler.toml: `[ai] binding = "AI"`), а ключей и внешних лимитов нет вовсе —
 * аккаунт Cloudflare сам даёт бесплатный запас в сутки. Для человека это значит
 * «картинка есть», а не «у бесплатных источников кончился лимит», как с анонимным
 * Pollinations. Владелец просил токен Pollinations — с привязкой он больше не нужен;
 * если токен всё-таки появится, он подхватится ниже и снимет анонимный лимит.
 *
 * Моделей две: flux-1-schnell (быстрая, 4 шага, отвечает base64 в `image`) и
 * SDXL Lightning — на случай, если первая на аккаунте выключена или в отказе.
 * Через привязку ответ — объект с `image` (base64) или поток байт; через REST
 * (CF_AI_TOKEN + CF_ACCOUNT, для проб вне воркера) — либо JSON, либо сами байты.
 */
function workersAiSource(env) {
  if (env.IMGGEN_WORKERS_AI === 'off') return null;
  const binding = env.AI && typeof env.AI.run === 'function' ? env.AI : null;
  const token = String(env.CF_AI_TOKEN || '');
  const account = String(env.CF_ACCOUNT || '');
  const rest = token && account ? { token, account } : null;
  if (!binding && !rest) return null;
  const models = String(env.IMGGEN_AI_MODELS || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const list = models.length ? models : ['@cf/black-forest-labs/flux-1-schnell', '@cf/bytedance/stable-diffusion-xl-lightning'];

  /** base64 → байты: buf.from нужен и в воркере, и в тестах (atob там нет). */
  const bytesOf = (value) => {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === 'string') {
      try {
        const bin = (typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('binary'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch (e) {
        return null;
      }
    }
    return null;
  };

  const asBytes = async (out) => {
    if (!out) return null;
    if (out.image) return bytesOf(out.image);
    /* REST-ответ Cloudflare заворачивает результат в `result`, привязка — нет */
    if (out.result) return asBytes(out.result);
    const direct = bytesOf(out);
    if (direct) return direct;
    /* поток или Blob: у воркера картинка может приезжать телом ответа */
    if (typeof out.arrayBuffer === 'function') {
      try { return new Uint8Array(await out.arrayBuffer()); } catch (e) { return null; }
    }
    if (typeof out.getReader === 'function') {
      try { return new Uint8Array(await new Response(out).arrayBuffer()); } catch (e) { return null; }
    }
    return null;
  };

  const steps = Math.max(1, Math.min(8, Math.round(Number(env.IMGGEN_AI_STEPS) || 4)) || 4);

  return {
    id: 'workersai',
    edits: false,
    async generate({ prompt, fetchImpl }) {
      let lastWhy = '';
      for (const model of list) {
        try {
          let bytes = null;
          if (binding) {
            const out = await binding.run(model, { prompt: String(prompt || '').slice(0, 2048), steps });
            bytes = await asBytes(out);
          } else {
            const url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(rest.account)
              + '/ai/run/' + model;
            const r = await fetchImpl(url, {
              method: 'POST',
              headers: { authorization: 'Bearer ' + rest.token, 'content-type': 'application/json' },
              body: JSON.stringify({ prompt: String(prompt || '').slice(0, 2048), steps }),
            });
            if (!r.ok) {
              let why = 'http ' + r.status;
              try { const j = await r.json(); why = (j && j.errors && j.errors[0] && j.errors[0].message) || why; } catch (e) { /* не json */ }
              const err = new Error(model.split('/').pop() + ': ' + why);
              err.status = r.status;
              throw err;
            }
            const type = String((r.headers && r.headers.get && r.headers.get('content-type')) || '');
            bytes = /json/i.test(type) ? await asBytes(await r.json()) : new Uint8Array(await r.arrayBuffer());
          }
          if (bytes && bytes.length > 512) return { bytes, url: '', mime: IMG_MIME(bytes) };
          lastWhy = model.split('/').pop() + ': источник ответил, но без картинки';
        } catch (e) {
          const why = String((e && e.message) || e).slice(0, 140);
          lastWhy = why;
          /* «нет такой модели» — не повод ронять весь канал: пробуем следующую */
          const err = e instanceof Error ? e : new Error(why);
          err.message = why;
          if (/401|403|authentication/i.test(why)) throw err;
        }
      }
      throw new Error(lastWhy || 'Workers AI не ответил');
    },
    async edit() { throw new Error('правка картинок у этого источника не умеет'); },
  };
}

/** Pollinations: без ключа, но с 2026 года отдаёт только то, что уже есть в кэше (402 иначе). */
function pollinationsSource(env, state) {
  if (env.IMGGEN_POLLINATIONS === 'off') return null;
  const model = String(env.IMGGEN_POLL_MODEL || '');
  /* Какая форма адреса сработала последней — помним на слой (объекты источников
     собираются заново на каждый вызов, а выяснять одно и то же дважды незачем).
     Начинаем с голой: она дешевле. */
  const st = state || { form: 'bare' };
  const prefer = () => st.form;
  /* Токен auth.pollinations.ai (0.177): с ним сняты и анонимный лимит «раз в 15 с»,
     и водяной знак. Присылать его не обязательно — привязка Workers AI выше уже
     даёт картинки без ключей; токен нужен лишь как второй живой канал. */
  const token = String(env.POLLINATIONS_TOKEN || env.IMGGEN_POLL_TOKEN || '').trim();
  const authHeaders = token ? { authorization: 'Bearer ' + token } : {};
  const urlsOf = (prompt, size) => {
    const [w, h] = String(size || DEFAULT_SIZE).split('x');
    const bare = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
    const full = `${bare}?width=${encodeURIComponent(w || '1024')}&height=${encodeURIComponent(h || '576')}&nologo=true${model ? '&model=' + encodeURIComponent(model) : ''}`;
    return { bare, full };
  };
  return {
    id: 'pollinations',
    edits: false,
    async generate({ prompt, size, fetchImpl }) {
      /* Замеры, которые обновлялись дважды: 6 окт 2026 у Pollinations платным был
         любой параметр адреса (402), а 11 окт 2026 — параметры снова работают, но
         явное `model=flux` отвечает 402, а голый адрес ограничен анонимным лимитом:
         примерно один запрос в 15 секунд на адрес, и на общем адресе Cloudflare
         Workers он исчерпан почти всегда. Поэтому: сначала голый (дешевле и без
         риска 402 за параметр), затем с параметрами; при 402 источник паркуется на
         IGGEN_RETRY_MS, а попытку берёт следующий источник цепочки. */
      const { bare, full } = urlsOf(prompt, size);
      const order = prefer() === 'full' ? [['full', full], ['bare', bare]] : [['bare', bare], ['full', full]];
      let lastBare = null;
      let lastFull = null;
      for (const [form, url] of order) {
        let r = await fetchImpl(url, { headers: { accept: 'image/*', ...authHeaders } });
        /* Токен протух или не подошёл — это не повод остаться без картинки: одна
           повторная попытка анонимно (у анонимного адреса свой лимит, но он есть). */
        if (token && (r.status === 401 || r.status === 403)) {
          r = await fetchImpl(url, { headers: { accept: 'image/*' } });
        }
        if (!r.ok) {
          let why = 'http ' + r.status;
          try { const j = await r.json(); why = (j && (j.error && (j.error.code || j.error.message) || j.message)) || why; } catch { /* тело не json */ }
          if (r.status === 402) {
            /* Голый адрес бесплатен, пока не кончился лимит: 402 на нём — это про
               лимит, а не про параметры. Разные причины — разные слова и разное
               время ожидания (см. BUSY_TTL_MS). */
            if (form === 'bare') why += ' (бесплатный лимит Pollinations исчерпан)';
            else why += ' (у Pollinations бесплатен только голый адрес — без width/height/nologo)';
          }
          const e = new Error(why);
          e.status = r.status;
          if (form === 'bare') lastBare = e; else lastFull = e;
          continue;
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length < 512) {
          const e = new Error('источник вернул пустышку');
          if (form === 'bare') lastBare = e; else lastFull = e;
          continue;
        }
        st.form = form;
        return { bytes: buf, url: '' };
      }
      /* Если голый адрес упёрся в 402 — это про лимит, и человеку надо услышать
         именно это, а не «у вас неправильные параметры». */
      throw (lastBare && lastBare.status === 402 ? lastBare : (lastFull || lastBare)) || new Error('источник не ответил');
    },
    async edit() { throw new Error('правка картинок у этого источника не умеет'); },
  };
}

/* ============================== цепочка ============================== */

/**
 * Создать слой. o: { env, fetch, now, log }.
 * Вердикты источников кэшируются на изолятор: пинать мёртвый API каждым запросом —
 * значит платить человеку секундами за чужую недоступность.
 */
/* Живость источника переживает изолят.
   Cloudflare поднимает Worker заново на каждый запрос, и признак «этот источник уже
   отвечал» умирал вместе с ним: на живом проде 6 окт 2026 картинка сделалась за
   6,2 с (pollinations), а GET /api/chat тут же подписывал все три источника как
   «не проверен». Человек читает это как «картинки могут не работать».
   Поэтому факт и время ответа кладём в то же общее хранилище, что и память, и
   подписываем возраст — «жив (12 мин назад)». Хранится только отметка времени:
   ни промптов, ни картинок там нет. */
export const ALIVE_KEY = 'img:alive';
export const ALIVE_TTL_MS = 24 * 3600e3;

export function createImggen(o) {
  const opts = o || {};
  const env = opts.env || {};
  const now = opts.now || (() => Date.now());
  const log = opts.log || (() => {});
  const fetchImpl = opts.fetch || ((...a) => fetch(...a));
  const off = String(env.IMGGEN || '') === 'off';
  const timeoutMs = Math.max(1000, numOr(env.IMGGEN_TIMEOUT_MS, TIMEOUT_MS));
  const failTtl = numOr(env.IMGGEN_RETRY_MS, FAIL_TTL_MS);
  const busyTtl = Math.min(failTtl, numOr(env.IMGGEN_BUSY_MS, BUSY_TTL_MS));
  const only = String(env.IMGGEN_SOURCE || '').trim();
  /* Общее состояние источников на слой: у Pollinations — какая форма адреса сработала. */
  const pollState = { form: 'bare' };
  /* Порядок: сначала то, что не зависит от чужих лимитов и ключей (привязка
     Workers AI), затем источники владельца, затем анонимный Pollinations. */
  const builders = [workersAiSource, geminiSource, odirouterSource, (env) => pollinationsSource(env, pollState)];

  const fail = new Map();          /* id → { why, until } */
  const alive = new Set();         /* id, который уже хоть раз ответил */
  const seenAt = new Map();        /* id → когда ответил (мс) — это переживает изолят */
  const kv = opts.store !== undefined ? opts.store
    : (env.MEMORY && typeof env.MEMORY.get === 'function' && typeof env.MEMORY.put === 'function' ? env.MEMORY : null);
  let aliveWritten = 0;            /* когда отметку писали в хранилище */
  let hydrateOnce = null;          /* одно чтение на изолят, а не на каждый вызов */
  const withTimeout = (p, ms, label) => {
    let tm;
    return Promise.race([
      p.finally(() => clearTimeout(tm)),
      new Promise((_, rej) => { tm = setTimeout(() => rej(new Error('таймаут источника ' + label)), ms); }),
    ]);
  };

  /** Отметить источник живым — в памяти и (не чаще минуты) в хранилище. */
  function remember(id, at) {
    const t = Number(at) || now();
    alive.add(id);
    seenAt.set(id, t);
    if (!kv) return;
    if (now() - aliveWritten < 60000) return;
    aliveWritten = now();
    const payload = { at: now(), seen: {} };
    for (const [k, v] of seenAt) payload.seen[k] = v;
    /* Фоном и молча: это подсказка для статуса, и падать из-за неё ответ не имеет права. */
    Promise.resolve(kv.put(ALIVE_KEY, JSON.stringify(payload), { expirationTtl: 172800 })).catch(() => {});
  }

  /**
   * Прочитать «кто уже отвечал» из общего хранилища — один раз на изолят.
   * Возвращает промис: дверь вызывает его фоном, а разбору навыков правки он нужен
   * до ответа (по нему включаются 11 навыков категории `editing`), поэтому в run()
   * он ждётся с потолком — быстрое чтение укладывается, медленное не тормозит ответ.
   */
  function hydrate() {
    if (!kv) return Promise.resolve(false);
    if (hydrateOnce) return hydrateOnce;
    hydrateOnce = Promise.resolve(kv.get(ALIVE_KEY))
      .then((raw) => {
        let data = raw;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
        if (!data || !data.seen || typeof data.seen !== 'object') return false;
        const fresh = now() - numOr(env.IMGGEN_ALIVE_MS, ALIVE_TTL_MS);
        let got = 0;
        for (const id of Object.keys(data.seen)) {
          const t = Number(data.seen[id]) || 0;
          if (t > fresh) { alive.add(id); seenAt.set(id, t); got++; }
        }
        return got > 0;
      })
      .catch(() => false);
    return hydrateOnce;
  }

  function chain() {
    const list = [];
    for (const b of builders) {
      const s = b(env);
      if (s && (!only || s.id === only)) list.push(s);
    }
    /* живой источник — в голову: он уже доказал, что отвечает, и не надо снова
       собирать причины отказа по цепочке */
    return list.sort((a, b) => (alive.has(b.id) ? 1 : 0) - (alive.has(a.id) ? 1 : 0));
  }

  function skip(id) {
    const f = fail.get(id);
    return !!f && f.until > now();
  }

  /** Чем мы можем выполнять right now — список { id, why } для статуса и для промпта. */
  function status() {
    if (off) return { on: false, why: 'IMGGEN=off', sources: [] };
    const list = chain();
    if (!list.length) return { on: false, why: 'нет ни одного источника: нужна привязка AI, GEMINI_KEYS или ODIROUTER_KEYS', sources: [] };
    return {
      on: true,
      why: list.every((s) => skip(s.id) && !alive.has(s.id)) ? 'все источники сейчас отказывают' : '',
      sources: list.map((s) => {
        const f = fail.get(s.id);
        return {
          id: s.id,
          edits: !!s.edits,
          ready: alive.has(s.id),
          /* когда источник отвечал: свежая отметка — «проверен сейчас», из хранилища —
             «жив (12 мин назад)». Молчаливое «жив» без возраста было бы догадкой. */
          seenAt: seenAt.get(s.id) || 0,
          blocked: f && f.until > now() ? f.why : '',
        };
      }),
    };
  }

  /**
   * Прогон по цепочке: первый ответивший источник выигрывает.
   * ignoreFail — для мягкого повтора (0.191): паркинг источников, накопленный
   * первым проходом, второму не указ — иначе повтору не дали бы даже начать.
   */
  async function runChain(kind, args, ignoreFail) {
    const tried = [];
    /* Честный прогресс (0.177): человек видит, что картинка рисуется и на каком
       канале мы стоим, а не смотрит на «печатает…» минуту. События уезжают тем же
       потоком, что куски текста; без потока (curl, тесты) колбэка просто нет. */
    const step = typeof args.step === 'function' ? args.step : null;
    const all = chain();
    let index = 0;
    for (const s of all) {
      index++;
      if (!ignoreFail && skip(s.id)) { tried.push(`${s.id}: ${fail.get(s.id).why} (ждём ${Math.ceil((fail.get(s.id).until - now()) / 1000)} с)`); continue; }
      if (kind === 'edit' && !s.edits) { tried.push(`${s.id}: правка не поддерживается`); continue; }
      if (step) step({ state: 'trying', channel: s.id, index, total: all.length, edits: !!s.edits });
      try {
        const out = await withTimeout(s[kind](Object.assign({}, args, { fetchImpl })), timeoutMs, s.id);
        if (!out.bytes && out.url) {
          /* некоторые каналы отдают ссылку: тянем сами, человеку показываем только
             свою копию — чужая ссылка протухнет быстрее, чем он откроет ответ */
          const r = await fetchImpl(out.url, { headers: { accept: 'image/*' } });
          if (!r.ok) throw new Error('картинка по ссылке не скачалась (http ' + r.status + ')');
          out.bytes = new Uint8Array(await r.arrayBuffer());
        }
        const buf = out.bytes;
        if (!buf || buf.length < 256) throw new Error('источник вернул пустую картинку');
        if (buf.length > MAX_IMAGE_BYTES) throw new Error(`картинка ${Math.round(buf.length / 1024)} КБ — больше, чем мы носим в ответе`);
        remember(s.id);
        fail.delete(s.id);
        return { ok: true, source: s.id, bytes: buf, mime: out.mime || IMG_MIME(buf), text: out.text || '' };
      } catch (e) {
        const why = String((e && e.message) || e).slice(0, 160);
        const status = Number(e && e.status) || 0;
        /* 402/429 — «доступ кончился», а не «источник сломался»: ждём минуту, чтобы
           вернуться, а не пять, чтобы человек остался без картинок. */
        const busy = status === 402 || status === 429 || /(^|\D)(402|429)(\D|$)/.test(why);
        fail.set(s.id, { why, until: now() + (busy ? busyTtl : failTtl) });
        tried.push(`${s.id}: ${why}`);
        if (step) step({ state: 'failed', channel: s.id, index, total: all.length, why });
        log('imggen', s.id, why);
      }
    }
    return { ok: false, why: tried.join(' · ') || 'источников нет' };
  }

  /**
   * Внешний прогон (0.191): после полного провала цепочки — ОДИН мягкий повтор.
   * Отказать могло не железо, а слово в промпте, задевшее чужой фильтр: «постер
   * хоррора с кровью» режут все четыре источника, хотя «с драматичными тенями»
   * проходит. Подчищаем такие слова (softenImagePrompt) и проходим цепочку заново,
   * игнорируя свежий паркинг. Один повтор, только для генерации; правку фото не
   * трогаем — там промпт про содержимое приложенной картинки, менять его нельзя.
   */
  async function run(kind, args) {
    if (off) return { ok: false, why: 'генерация картинок выключена (IMGGEN=off)' };
    const first = await runChain(kind, args, false);
    if (first.ok) return first;
    if (kind !== 'generate') return first;
    const soft = softenImagePrompt(args.prompt);
    if (!soft.changed) return first;
    if (typeof args.step === 'function') args.step({ state: 'softretry', why: String(first.why || '').slice(0, 120) });
    const second = await runChain(kind, Object.assign({}, args, { prompt: soft.prompt }), true);
    if (second.ok) return Object.assign(second, { softened: true });
    return { ok: false, why: 'даже с мягкой формулировкой не вышло · ' + second.why };
  }

  return {
    generate: (args) => run('generate', args),
    edit: (args) => run('edit', args),
    /** Сколько каналов сейчас в цепочке — для правдивой подписи прогресса. */
    channels: () => chain().length,
    status,
    /** Подтянуть «кто отвечал» из общего хранилища (один раз на изолят). */
    hydrate,
    /** Есть ли чем править приложенную картинку (для навыков категории `editing`). */
    async canEdit() {
      if (off) return false;
      const s = chain().find((x) => x.edits && !skip(x.id));
      if (!s) return false;
      if (alive.has(s.id)) return true;
      /* проверяем пробным вызовом на крошечной картинке: 1×1 png, «покажи как есть».
         Так решение «включать ли 11 навыков правки» опирается на ответ API, а не на
         название модели в списке. */
      const probe = await run('edit', {
        prompt: 'Верни это же изображение без изменений.',
        images: [{ mime: 'image/png', data: PROBE_PNG }],
      });
      return !!probe.ok;
    },
    forget: () => { fail.clear(); seenAt.clear(); alive.clear(); hydrateOnce = null; },
  };
}

/** PNG 1×1 (белый) — тело пробника, чтобы не тащить ради теста чужие картинки. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/**
 * Блок картинки в ответе модели: ```img|имя\n<промпт>\n``` — тот же приём, что и с файлами:
 * модель формулирует промпт (английским, описательно), мы генерируем и прикладываем.
 * Отдельного вызова модели нет: блок разбирается из уже готового ответа.
 */
export const IMG_BLOCK_RE = /```[ \t]*img(?:[ \t]*\|[ \t]*([^\n`]{0,60}))?[ \t]*\r?\n([\s\S]*?)```/gi;

/**
 * Мягкая формулировка промпта (0.191): таблица слов-магнитов для чужих фильтров.
 * Подчистка точечная: меняются только слова, ради которых режут всю картинку
 * («кровь», «обнажённая», «gore»), — сюжет и композиция остаются просьбой
 * человека. Оружие и символику НЕ трогаем: подмена сюжета целиком честнее
 * выглядит как отказ, а не как «нарисовали не то».
 */
const SOFTEN = [
  [/кров(?:ь|и|ям|ью|ав[а-я]*|ищ[а-я]*)/gi, 'драматичные тени'],
  [/\bblood(?:y|ied|soaked)?\b|\bgory\b|\bgore\b/gi, 'dramatic shadows'],
  [/обнаж[а-я]*/gi, 'в элегантной одежде'],
  [/гол(?:ая|ую|ой|ые|ый)\b/gi, 'в элегантной одежде'],
  [/\bnud(?:e|ity|es)\b|\bnaked\b|\bnsfw\b|\bsexy\b/gi, 'elegantly dressed'],
  [/труп[а-я]*|мертв[а-я]*/gi, 'тёмный силуэт'],
  [/\bcorpse(?:s)?\b|\bdead\s+body\b/gi, 'dark silhouette'],
  [/расчлен[а-я]*/gi, 'драматичный силуэт'],
  [/ран(?:а|ы|е|у|ой|ах|ами|ений|ение)\b/gi, 'лёгкий след былой истории'],
  [/\bwound(?:ed|s)?\b|\bbleeding\b/gi, 'a trace of an old story'],
];

/** Вернёт { prompt, changed }: changed — было что подчищать, повтор имеет смысл. */
export function softenImagePrompt(prompt) {
  let out = String(prompt || '');
  let changed = false;
  for (const [re, to] of SOFTEN) {
    if (re.test(out)) { out = out.replace(re, to); changed = true; }
  }
  return { prompt: out.trim(), changed };
}

/** Просил ли человек картинку (по тексту запроса) — для автоматической доводки. */
export function wantsImage(text) {
  const s = String(text || '');
  return /(нарисуй|накидай|изобрази|сгенерир\w*\s+картинк|сгенерируй|сделай\s+(картинк|изображени|иллюстрац|постер|обои|мем|логотип|аватарк)|покажи\s+(картинк|изображени)|накидай\s+(картинок|эскизов)|отрисуй|отрисуй\s+схем)\s*/i.test(s)
    /* по-английски просьба считается по глаголу с объектом: «draw» сама по себе
       ловит «draw conclusions», поэтому требуются картинка/постер/логотип и т.п. */
    || /(^|[^a-z])(draw|sketch|illustrate|render)\s+(me\s+)?(up\s+)?(an?\s+|some\s+|a\s+)?[a-z0-9' -]{0,48}?\b(image|picture|poster|logo|art|artwork|illustration|portrait|wallpaper|diagram|map|layout|mockup|banner|cover|icon|scene|cat|dog|dragon|robot|city|landscape)\b/i.test(s)
    || /(^|[^a-z])(generate|make|create)\s+(me\s+)?(an?\s+|a\s+)?\b(image|picture|poster|logo|wallpaper|artwork|illustration)\b/i.test(s)
    || /\b(image|picture|poster|thumbnail)\s+(of|for)\s+[a-z0-9]/i.test(s);
}

/** Какую правку человек просит у приложенной картинки. */
export function wantsEdit(text, images) {
  if (!(images && images.length)) return false;
  return /(убер[и]?|убрать|удали|замени|поменяй|поправь|перекрас|фон|ретуш|дорисуй|отреставрир|реставрац|inpaint|edit\s+this|crop|обреж)/i.test(String(text || ''));
}

export const IMG_DIRECTIVE =
  'Картинка делается так: сначала обычный ответ (1-2 предложения, что нарисовали), затем ОДИН блок\n'
  + '```img|имя без расширения\n<подробное описание на английском:subject, действие, обстановка, свет, композиция, стиль — 30-70 слов>\n```\n'
  + 'Мы генерируем сами и приложим файл: не обещай картинку, пока блок не написал, и не вставляй чужие ссылки на изображения. '
  + 'Правка приложенной картинки — тот же блок, но в описании скажи, что именно менять.';

/**
 * Разобрать ответ: блоки ```img``` → заказанные картинки.
 * o: { generate, edit, wanted, images, text } — функции принадлежат слою (createImggen),
 * чтобы постобработка не знала ни про какие ключи и источники.
 */
export async function packImages(answer, o) {
  const opts = o || {};
  const src = String(answer || '');
  const gen = opts.generate || (async () => ({ ok: false, why: 'слой картинок не подключён' }));
  const ed = opts.edit || (async () => ({ ok: false, why: 'правка недоступна' }));
  const step = typeof opts.step === 'function' ? opts.step : null;
  const images = Array.isArray(opts.images) ? opts.images : [];
  const files = [];
  const notes = [];
  const blocks = [];

  const reply0 = src.replace(IMG_BLOCK_RE, (all, name, prompt) => {
    const p = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!p) { notes.push('блок img пуст — описания нет, картинка не заказана'); return ''; }
    blocks.push({ name: cleanName(String(name || '').trim()), prompt: p });
    return '';
  });
  if (blocks.length > 2) notes.push('больше двух картинок за ответ не отдаём — остальные остались текстом');

  /* последовательно, не параллельно: бесплатные источники режут параллель 429-м,
     а нам важнее получить честную причину от первого, чем три ошибки разом */
  for (const b of blocks.slice(0, 2)) {
    const needEdit = images.length > 0 && /(убер|уба\w*|удал\w*|замени|поменя|перекрас|дорисуй|фон|правк|retouch|inpaint|remove|change|background|crop|обреж)/i.test(b.prompt);
    if (step) step({ state: 'start', name: b.name || '', edit: needEdit });
    const r = await (needEdit ? ed : gen)({ prompt: b.prompt, images, step });
    if (!r.ok) { notes.push('картинка «' + (b.name || 'без имени') + '» не вышла: ' + whyWithRaw(humanWhy(r.why), r.why)); continue; }
    files.push(fileOf(r, b.name));
  }

  /* Просил картинку, блока нет — пробуем по формулировке человека: модель нередко
     отвечает словами «вот что бы я нарисовал», и оставлять её без картинки нельзя. */
  if (!files.length && !blocks.length && opts.wanted) {
    const p = describeRequest(opts.text);
    if (p) {
      const needEdit = images.length > 0 && wantsEdit(opts.text, images);
      if (step) step({ state: 'start', name: '', edit: needEdit });
      const r = await (needEdit ? ed : gen)({ prompt: p, images, step });
      if (r.ok) files.push(fileOf(r, cleanName(p).slice(0, 40)));
      else notes.push('картинка не вышла: ' + whyWithRaw(humanWhy(r.why), r.why));
    }
  }

  let reply = reply0.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!reply && files.length) reply = 'Готово: ' + files.map((f) => f.name).join(', ') + '.';
  if (notes.length) reply = (reply ? reply + '\n\n' : '') + '· ' + notes.join('\n· ');
  return { reply, files, notes };
}

/**
 * Причина отказа словами для человека (0.169). Техническую строку человеку читать
 * нечего («gemini: RESOURCE_EXHAUSTED You exceeded your current quota, please check
 * your plan and billing de…»), но и прятать причину нельзя: она объясняет, ждать
 * или пробовать другое. Поэтому в тексте — короткая человеческая фраза, а сырая
 * причина остаётся в скобках: по ней мы разбираем, а человек видит, что делать.
 */
export function humanWhy(why) {
  const w = String(why || '');
  if (/402|quota|RESOURCE_EXHAUSTED|exceeded|лимит/i.test(w)) return 'у бесплатных источников кончился лимит на сегодня — попробуйте позже';
  if (/model_not_found|not found|unknown model|404/i.test(w)) return 'источник больше не знает такой модели';
  if (/таймаут|timeout|abort|время/i.test(w)) return 'источник не ответил вовремя';
  if (/\bhttp\s*5\d\d/i.test(w)) return 'источник сейчас сломан на своей стороне';
  if (/без картинки|пуст/i.test(w)) return 'источник ответил, но без картинки';
  if (/сеть|network|fetch failed|ENOTFOUND/i.test(w)) return 'источник не отвечает';
  return 'источники сейчас не справились';
}

/** Техническую причину оставляем в скобках, но коротко: она для разбора, не для чтения. */
function whyWithRaw(human, raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  return t ? human + ' (' + t + ')' : human;
}

function fileOf(r, name) {
  const ext = String(r.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg');
  return {
    name: (name || 'картинка') + '.' + ext,
    mime: r.mime || 'image/png',
    size: r.bytes.length,
    b64: b64enc(r.bytes),
    kind: 'image',
    source: r.source || '',
  };
}

/** Промпт из человеческой формулировки: срезать саму просьбу, оставить предмет. */
export function describeRequest(text) {
  return String(text || '')
    .replace(/^(нарисуй|нарисуй|накидай|сгенерируй|сделай|изобрази|покажи)\s*(мне|пожалуйста)?[,.\s]*/i, '')
    .replace(/^(картинку|изображение|иллюстрацию|постер|обои|мем)\s*(про|о|с|на тему)?[,.\s]*/i, '')
    .replace(/(пожалуйста|мне|для меня|пжл)/gi, ' ')
    .replace(/(и\s+оформи\s+в\s+файл\s*\w*|оформи\s+в\s+файл\s*\w*)/gi, ' ')
    .replace(/(картинк\w*|изображени\w*|иллюстрац\w*)\s+(в\s+файле|файлом)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.]+/, '')
    .replace(/[,.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function cleanName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Экземпляр на весь изолят: состояние источников (кто ответил, кто припаркован)
 * должно переживать запрос, иначе каждая request'а заново бьётся в мёртвую дверь.
 * Поэтому и /api/skills, и чат смотрят в ОДНО зеркало.
 */
let shared = null;
/**
 * Сбросить общий слой — для тестов и перезапуска окружения.
 *
 * В воркере окружение живёт вместе с изолятом, поэтому общий слой создаётся один
 * раз и это правильно. Но в прогоне тестов окружения разные (то привязка AI, то
 * сломанная привязка), и без сброса первый попавшийся env решал бы за всех —
 * проверка «отказ канала» молча шла бы по живому каналу.
 */
export function forgetSharedImggen() {
  shared = null;
}

export function sharedImggen(env, fetchImpl, log) {
  if (!shared) {
    shared = createImggen({ env: env || {}, fetch: fetchImpl, log });
    /* Чтение — фоном и без ожидания: слой общий на изолят, поэтому к следующему
       обращению отметки уже на месте, а на первый ответ это не влияет. */
    Promise.resolve(shared.hydrate()).catch(() => {});
  }
  return shared;
}

/**
 * Чем ПРАВИТЬ приложенную картинку прямо сейчас. Именно этот предикат решает,
 * включать ли навыки категории `editing`: источник, который умеет только
 * генерировать (Pollinations), правку не выполнит, и навыки врели бы.
 */
export function editsReady(status) {
  return !!(status && status.on && (status.sources || []).some((x) => x.ready && x.edits));
}

/** Строка состояния для GET /api/chat и для подписи в блоке навыка. */
export function lineOf(st) {
  if (!st) return 'выключен';
  if (!st.on) return 'выключен · ' + st.why;
  const parts = st.sources.map((s) => {
    /* Возраст отметки обязателен: «жив» без него — догадка, а не состояние.
       Отметка старше суток не показывается как «жив» — см. IMGGEN_ALIVE_MS. */
    const age = s.ready && s.seenAt ? ' · ' + ageOf(s.seenAt) : '';
    const state = s.ready ? 'жив' : s.blocked ? s.blocked : 'не проверен';
    return s.id + ' · ' + state + age + (s.edits ? ' (правка есть)' : '');
  });
  return 'источники: ' + (parts.join('; ') || 'нет ни одного') + (st.why ? ' · ' + st.why : '');
}

/** «12 мин назад», «только что», «2 ч назад» — словами, как в остальных подписях. */
function ageOf(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' ч назад';
  return Math.round(h / 24) + ' сут назад';
}
