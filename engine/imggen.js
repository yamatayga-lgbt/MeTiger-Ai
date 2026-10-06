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
function odirouterSource(env) {
  const key = first(env.ODIROUTER_KEYS || env.ODIROUTER_KEY);
  if (!key) return null;
  const gen = String(env.IMGGEN_ODI_MODEL || 'free-gpt-image-2');
  const edit = String(env.IMGGEN_ODI_EDIT_MODEL || 'free-gpt-image-2-edit');
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
  return {
    id: 'odirouter',
    edits: true,
    async generate({ prompt, size, fetchImpl }) {
      const out = await post('/images/generations', { model: gen, prompt, n: 1, size: size || DEFAULT_SIZE }, fetchImpl);
      return out;
    },
    async edit({ prompt, images, size, fetchImpl }) {
      const img = (images || [])[0];
      if (!img) throw new Error('для правки нужна картинка во вложении');
      const out = await post('/images/edits', {
        model: edit, prompt, n: 1, size: size || DEFAULT_SIZE,
        image: 'data:' + (img.mime || 'image/png') + ';base64,' + img.data,
      }, fetchImpl);
      return out;
    },
  };
}

/** Gemini: generateContent с responseModalities — картинка на выход, входные parts = правка. */
function geminiSource(env) {
  const key = first(env.GEMINI_KEYS || env.GOOGLE_API_KEY);
  if (!key) return null;
  const model = String(env.IMGGEN_GEMINI_MODEL || 'gemini-2.5-flash-image');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const call = async (parts, fetchImpl) => {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* нет */ }
    if (!r.status || r.status >= 400) {
      const e = j && j.error;
      throw new Error((e && e.status ? e.status + ' ' + String(e.message).slice(0, 70) : 'http ' + r.status));
    }
    const out = ((j && j.candidates) || [])[0];
    const list = (out && out.content && out.content.parts) || [];
    const img = list.find((p) => p && p.inlineData && p.inlineData.data);
    if (!img) throw new Error('модель ответила текстом без картинки');
    return {
      bytes: b64dec(img.inlineData.data),
      url: '',
      text: list.filter((p) => p && p.text).map((p) => p.text).join(' ').trim(),
    };
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

/** Pollinations: без ключа, но с 2026 года отдаёт только то, что уже есть в кэше (402 иначе). */
function pollinationsSource(env, state) {
  if (env.IMGGEN_POLLINATIONS === 'off') return null;
  const model = String(env.IMGGEN_POLL_MODEL || '');
  /* Какая форма адреса сработала последней — помним на слой (объекты источников
     собираются заново на каждый вызов, а выяснять одно и то же дважды незачем).
     Начинаем с голой: она дешевле. */
  const st = state || { form: 'bare' };
  const prefer = () => st.form;
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
      /* 6 окт 2026 замерено вживую: у Pollinations бесплатен ТОЛЬКО голый адрес
         (/prompt/<текст>), а любой параметр — width, height, nologo, model, seed —
         отвечает 402 Payment Required и пустым телом {}. Проверено каждым
         параметром по отдельности. Прежний адрес был с width/height/nologo, то есть
         каждый заказ картинки упирался в 402. Поэтому сначала голый; если он не дал
         картинку, пробуем адрес с параметрами — на случай, если платный шлюз снимут.
         Цена голого адреса — картинка в размере по умолчанию (не в заказанном). */
      const { bare, full } = urlsOf(prompt, size);
      const order = prefer() === 'full' ? [['full', full], ['bare', bare]] : [['bare', bare], ['full', full]];
      let lastBare = null;
      let lastFull = null;
      for (const [form, url] of order) {
        const r = await fetchImpl(url, { headers: { accept: 'image/*' } });
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
  const builders = [geminiSource, odirouterSource, (env) => pollinationsSource(env, pollState)];

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
    if (!list.length) return { on: false, why: 'нет ни одного источника: нужны GEMINI_KEYS или ODIROUTER_KEYS', sources: [] };
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

  /** Прогон по цепочке: первый ответивший источник выигрывает. */
  async function run(kind, args) {
    if (off) return { ok: false, why: 'генерация картинок выключена (IMGGEN=off)' };
    const tried = [];
    for (const s of chain()) {
      if (skip(s.id)) { tried.push(`${s.id}: ${fail.get(s.id).why} (ждём ${Math.ceil((fail.get(s.id).until - now()) / 1000)} с)`); continue; }
      if (kind === 'edit' && !s.edits) { tried.push(`${s.id}: правка не поддерживается`); continue; }
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
        log('imggen', s.id, why);
      }
    }
    return { ok: false, why: tried.join(' · ') || 'источников нет' };
  }

  return {
    generate: (args) => run('generate', args),
    edit: (args) => run('edit', args),
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
    const r = await (needEdit ? ed : gen)({ prompt: b.prompt, images });
    if (!r.ok) { notes.push('картинка «' + (b.name || 'без имени') + '» не вышла: ' + r.why); continue; }
    files.push(fileOf(r, b.name));
  }

  /* Просил картинку, блока нет — пробуем по формулировке человека: модель нередко
     отвечает словами «вот что бы я нарисовал», и оставлять её без картинки нельзя. */
  if (!files.length && !blocks.length && opts.wanted) {
    const p = describeRequest(opts.text);
    if (p) {
      const needEdit = images.length > 0 && wantsEdit(opts.text, images);
      const r = await (needEdit ? ed : gen)({ prompt: p, images });
      if (r.ok) files.push(fileOf(r, cleanName(p).slice(0, 40)));
      else notes.push('картинка не вышла: ' + r.why);
    }
  }

  let reply = reply0.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!reply && files.length) reply = 'Готово: ' + files.map((f) => f.name).join(', ') + '.';
  if (notes.length) reply = (reply ? reply + '\n\n' : '') + '· ' + notes.join('\n· ');
  return { reply, files, notes };
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
