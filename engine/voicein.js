/**
 * Голос → текст (STT) для входящих сообщений.
 *
 * Зачем: с телефона чаще всего прикладывают голосовое, а движок долго
 * отвечал на них «голос пока не слушаю». Источника два, оба бесплатные и на НАШИХ
 * же ключах (никаких новых ключей и аккаунтов не заводим):
 *   1. Groq — `whisper-large-v3-turbo` (проверено: /v1/audio/transcriptions с нашим
 *      ключом отвечает 200); это основной путь, он заточен именно под расшифровку.
 *   2. OpenRouter — омни-модель с аудио-входом (по умолчанию бесплатная
 *      `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`), если Groq молчит:
 *      квота, 429, таймаут.
 *
 * Рамки: не больше `MAX_AUDIO` на файл, потолок ожидания один на источник, текст
 * нормализуется. Провал — это `{ ok: false, why }` с человеческой причиной, а не
 * брошенное исключение: голосовое сообщение не имеет права ломать ответ.
 *
 * Токена в ошибках нет никогда: URL Bot API и провайдеров содержат секреты, поэтому
 * наружу отдаётся только статус и текст причины.
 */

const MAX_AUDIO = 8 * 1024 * 1024;
const MIN_AUDIO = 400;
const CALL_MS = 90000;

/** Промпт стенографа: дословно, с пунктуацией, без пересказа и «улучшений». */
const PROMPT =
  'Ты — точная стенограмма. Расшифруй аудио ДОСЛОВНО, на языке оригинала (не переводи и не перефразируй).\n'
  + 'Восстанавливай пунктуацию и регистр; числа, даты, имена, термины и единицы пиши так, как произнесено.\n'
  /* Словарь продукта. Whisper пишет имена так, как слышит, и «MeTiger» на слух
     превращается в «Митигер», «Тигр» — в «Сибирь». Список короткий и только про
     то, что человек в этой диктовке почти наверняка назовёт. */
  + 'Имена собственные, которые могут встретиться: MeTiger (может звучать как «тигр»), Whisper, Groq, Cloudflare, OpenRouter, Telegram.\n'
  + 'Если речи нет — верни пустую строку. Никаких пояснений, кавычек и «в аудио слышно».';

/* initial_prompt у Whisper — не инструкция, а образец стиля: модель продолжает
   его по духу. Поэтому здесь именно пример русской расшифровки с пунктуацией,
   а не приказ «расшифруй дословно» (приказы она может прочитать вслух). */
const STYLE_PROMPT = 'Привет! Это расшифровка речи с пунктуацией, заглавными буквами и числами.';

/* Telegram носит opus в ogg; провайдеры берут не любой контейнер, поэтому формат
   подбирается по mime, а у Groq ещё и перебирается в случае отказа формата. */
const FMT = {
  'audio/ogg': ['ogg', 'opus', 'webm'],
  'audio/opus': ['opus', 'ogg'],
  'audio/webm': ['webm', 'ogg'],
  'audio/mp4': ['mp4', 'm4a'],
  'audio/m4a': ['m4a', 'mp4'],
  'audio/mpeg': ['mp3'],
  'audio/mp3': ['mp3'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/aac': ['aac', 'm4a'],
  'audio/amr': ['amr'],
  'audio/ogg; codecs=opus': ['ogg', 'opus'],
};

const b64enc = (bytes) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};
const first = (v) => String(v || '').split(',')[0].trim();

/* Модель любит обернуть реплику в кавычки — и в «ёлочки» тоже: их надо снимать,
   иначе в чат уходит текст в обнимку с типографикой. */
const Q_OPEN = /^[\s«»""'\"\u201e\u201c\u201d\u2018\u2019「」『』【】(`]+/;
const Q_CLOSE = /[\s«»""'\"\u201c\u201d\u2018\u2019」』】)']+$/;
const tidy = (s) => String(s == null ? '' : s)
  .replace(/\r/g, '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .replace(Q_OPEN, '')
  .replace(Q_CLOSE, '')
  .trim();

/** Пустая расшифровка и «.» от шума — не ответ: это надо сказать, а не молчать. */
export function hasWords(text) {
  const t = tidy(text);
  return /[A-Za-zА-Яа-яЁё0-9]/.test(t) && t.length >= 2;
}

function fmtsOf(mime) {
  const m = String(mime || '').toLowerCase();
  return FMT[m] || ['ogg'];
}

/** Статус + короткая причина без URL и токена. */
async function whyOf(res) {
  let why = 'http ' + (res && res.status ? res.status : '?');
  try {
    const txt = await res.text();
    const j = JSON.parse(txt);
    const m = j && (j.error && (j.error.message || j.error.code) || j.message || j.detail);
    if (m) why += ' · ' + String(m).slice(0, 140);
    else if (txt && txt.length < 120) why += ' · ' + txt;
  } catch { /* тело не json */ }
  return why;
}

/**
 * Создать слой расшифровки. o: { env, fetch, log }.
 * `STT=off` — слой выключен (handleUpdate тогда честно отвечает голосом-не-отвечу).
 */
export function createStt(o) {
  const opts = o || {};
  const env = opts.env || {};
  const log = opts.log || (() => {});
  const fetchImpl = opts.fetch || ((...a) => fetch(...a));
  const on = String(env.STT || '') !== 'off';
  const groqKey = first(env.GROQ_KEYS || env.GROQ_KEY);
  const orKey = first(env.OPENROUTER_KEYS || env.OPENROUTER_KEY);
  const cfKey = first(env.CLOUDFLARE_KEYS || env.CLOUDFLARE_KEY);
  const cfAcc = first(env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT);
  const cfModel = String(env.STT_CF_MODEL || '@cf/openai/whisper-large-v3-turbo');
  const groqModel = String(env.STT_MODEL || 'whisper-large-v3-turbo');
  const orModel = String(env.STT_OMNI_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  const timeoutMs = Math.max(5000, Number(env.STT_TIMEOUT_MS) || CALL_MS);

  const withTimeout = (p, label) => {
    let tm;
    return Promise.race([
      Promise.resolve(p).finally(() => clearTimeout(tm)),
      new Promise((_, rej) => { tm = setTimeout(() => rej(new Error('не успел за ' + Math.round(timeoutMs / 1000) + ' с (' + label + ')')), timeoutMs); }),
    ]);
  };

  async function viaGroq(bytes, mime, lang, prev) {
    const tries = fmtsOf(mime);
    let last = 'формат не подошёл';
    for (const fmt of tries) {
      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'voice.' + (fmt === 'opus' ? 'ogg' : fmt));
      fd.append('model', groqModel);
      fd.append('response_format', 'verbose_json');
      fd.append('temperature', '0');
      /* Хвост уже сказанного подсказываем вместе с промптом: кусок в четыре
         секунды без контекста теряет связность («и ещё» превращается в «ещё и»),
         а с хвостом модель держит нить. prev — не команда, а образец стиля. */
      fd.append('prompt', prev ? PROMPT + '\n\n' + prev : PROMPT);
      /* Язык подсказываем, когда знаем его точно (браузер сообщает язык пишущего):
         на короткой фразе «спасибо» автоопределение иногда уезжает в английский. */
      if (lang) fd.append('language', lang);
      const r = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + groqKey },
        body: fd,
      });
      if (!r.ok) {
        last = await whyOf(r);
        /* на лимите и на своей ошибке крутить форматы бессмысленно: дело не в них.
           Пропускаемлишние попытки и сразу идём ко второму источнику. */
        if (r.status === 429 || r.status >= 500) return { ok: false, why: last, via: 'groq' };
        continue;
      }
      let j = null;
      try { j = await r.json(); } catch { last = 'ответ не JSON'; continue; }
      const text = tidy(j && j.text);
      return { ok: hasWords(text), text: hasWords(text) ? text : '', via: 'groq/' + groqModel, lang: (j && j.language) || '', why: hasWords(text) ? '' : 'речи в аудио не было' };
    }
    return { ok: false, why: last, via: 'groq' };
  }

  /**
   * Cloudflare Workers AI, модель @cf/openai/whisper-large-v3-turbo.
   *
   * Форм запроса у Cloudflare две, и какая откроется — зависит от прав токена:
   *   · /ai/run — «своя» форма: base64 в JSON;
   *   · /ai/v1/audio/transcriptions — совместимая с OpenAI: multipart-файл.
   * Пробуем обе, потому что живая проверка на проде дала 401 на первой (токен
   * есть, права на Workers AI — нет) и было неясно, дело в форме или в правах.
   * Пробовать стоит: вторая форма — это ещё один шанс ответить, а не гадание.
   */
  async function viaCloudflare(bytes, mime, lang, prev) {
    if (!cfAcc) return { ok: false, why: 'нет CLOUDFLARE_ACCOUNT_ID для адреса Workers AI', via: 'cloudflare' };
    const base = 'https://api.cloudflare.com/client/v4/accounts/' + cfAcc + '/ai';
    const tries = [];

    const readJson = (j) => {
      /* Ответ бывает двухслойный: { result: { text } } и просто { text }. */
      const raw = (j && ((j.result && j.result.text) || j.text)) || '';
      return tidy(String(raw));
    };

    // Форма 1: своя (base64 в JSON)
    try {
      const body = {
        audio: b64enc(bytes),
        task: 'transcribe',
        vad_filter: true,
        beam_size: 5,
        /* Отключаем «оглядку на прошлый текст»: на коротких фразах она даёт
           зацикливание и повторы вроде «спасибо спасибо спасибо». */
        condition_on_previous_text: false,
        initial_prompt: prev ? STYLE_PROMPT + ' ' + prev : STYLE_PROMPT,
      };
      if (lang) body.language = lang;
      const r = await fetchImpl(base + '/run/' + cfModel, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfKey },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        let j = null;
        try { j = await r.json(); } catch { return { ok: false, why: 'ответ не JSON', via: 'cloudflare' }; }
        const text = readJson(j);
        return { ok: hasWords(text), text: hasWords(text) ? text : '', via: 'cloudflare/' + cfModel.split('/').pop(), why: hasWords(text) ? '' : 'речи в аудио не было' };
      }
      tries.push('/ai/run: ' + (await whyOf(r)));
    } catch (e) { tries.push('/ai/run: ' + String((e && e.message) || e).slice(0, 100)); }

    // Форма 2: совместимая с OpenAI (multipart)
    try {
      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type: mime || 'audio/wav' }), 'voice.wav');
      fd.append('model', cfModel);
      if (lang) fd.append('language', lang);
      if (prev) fd.append('prompt', prev);
      const r = await fetchImpl(base + '/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + cfKey },
        body: fd,
      });
      if (r.ok) {
        let j = null;
        try { j = await r.json(); } catch { return { ok: false, why: 'ответ не JSON', via: 'cloudflare' }; }
        const text = readJson(j);
        return { ok: hasWords(text), text: hasWords(text) ? text : '', via: 'cloudflare/' + cfModel.split('/').pop(), why: hasWords(text) ? '' : 'речи в аудио не было' };
      }
      tries.push('audio/transcriptions: ' + (await whyOf(r)));
    } catch (e) { tries.push('audio/transcriptions: ' + String((e && e.message) || e).slice(0, 100)); }

    return { ok: false, why: tries.join(' · '), via: 'cloudflare' };
  }

  async function viaOpenRouter(bytes, mime, lang, prev) {
    const fmt = fmtsOf(mime)[0] === 'opus' ? 'ogg' : fmtsOf(mime)[0];
    const body = {
      model: orModel,
      max_tokens: 900,
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prev ? PROMPT + '\n\nУже сказано: ' + prev : PROMPT },
        { type: 'input_audio', input_audio: { data: 'data:' + (mime || 'audio/ogg') + ';base64,' + b64enc(bytes), format: fmt } },
      ] }],
    };
    const r = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + orKey },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, why: await whyOf(r), via: 'openrouter' };
    let j = null;
    try { j = await r.json(); } catch { return { ok: false, why: 'ответ не JSON', via: 'openrouter' }; }
    const msg = ((j && j.choices) || [])[0];
    const raw = msg && msg.message ? (typeof msg.message.content === 'string' ? msg.message.content : JSON.stringify(msg.message.content)) : '';
    const text = tidy(String(raw));
    return { ok: hasWords(text), text: hasWords(text) ? text : '', via: 'openrouter/' + orModel, why: hasWords(text) ? '' : 'речи в аудио не было' };
  }

  /**
   * Расшифровать. src: { bytes: Uint8Array, mime, lang, via }.
   * lang — ISO-639-1 («ru»), необязательный: браузер знает язык пишущего, Telegram нет.
   * via — прогнать ровно через этот источник (groq | cloudflare | openrouter);
   *       без него — обычный порядок.
   * → { ok, text, via } | { ok: false, why }
   */
  async function transcribe(src) {
    if (!on) return { ok: false, why: 'распознавание голоса выключено (STT=off)' };
    const bytes = src && src.bytes instanceof Uint8Array ? src.bytes : null;
    if (!bytes || !bytes.length) return { ok: false, why: 'аудио пустое' };
    if (bytes.length < MIN_AUDIO) return { ok: false, why: 'аудио в ' + bytes.length + ' байт — слишком короткое, чтобы там была речь' };
    if (bytes.length > MAX_AUDIO) return { ok: false, why: 'аудио ' + Math.round(bytes.length / 1024 / 1024 * 10) / 10 + ' МБ — больше ' + Math.round(MAX_AUDIO / 1024 / 1024) + ' МБ не расшифровываем' };
    const tried = [];
    const lang = String((src && src.lang) || '').slice(0, 5).toLowerCase() || '';
    /* via — служебный выбор источника («проверь именно этот»). Нужен не для
       красоты: без него запасную ветку нельзя проверить живьём, пока работает
       первая, и «код написан, но ни разу не отвечал» остаётся догадкой. */
    const via = String((src && src.via) || '').toLowerCase();
    /* prev — хвост уже подтверждённого текста (для кусков «на лету»). Он короткий:
       длинная подсказка сама начинает «дописывать» текст, которого не было. */
    const prev = String((src && src.prev) || '').slice(0, 160);
    const want = (name) => !via || via === name;
    if (groqKey && want('groq')) {
      try {
        const r = await withTimeout(viaGroq(bytes, src.mime, lang, prev), 'groq');
        if (r.ok) return r;
        /* Groq ответил, просто речи не было: второй источник ту же тишину не
           расшифрует, а лишний запрос — это секунды задержки и квота. */
        if (/^groq\//.test(String(r.via || ''))) return { ok: false, why: r.why || 'речи в аудио не было', via: r.via };
        tried.push('groq: ' + (r.why || 'пусто'));
      } catch (e) { tried.push('groq: ' + String((e && e.message) || e).slice(0, 120)); }
    } else if (want('groq')) tried.push('groq: ключа GROQ_KEYS нет');
    if (cfKey && cfAcc && want('cloudflare')) {
      try {
        const r = await withTimeout(viaCloudflare(bytes, src.mime, lang, prev), 'cloudflare');
        if (r.ok) return r;
        /* Ответил, но речи не было — третий источник ту же тишину не разберёт. */
        if (/^cloudflare\//.test(String(r.via || ''))) return { ok: false, why: r.why || 'речи в аудио не было', via: r.via };
        tried.push('cloudflare: ' + (r.why || 'пусто'));
      } catch (e) { tried.push('cloudflare: ' + String((e && e.message) || e).slice(0, 120)); }
    } else if (want('cloudflare')) tried.push('cloudflare: ' + (cfKey ? 'нет CLOUDFLARE_ACCOUNT_ID' : 'ключа CLOUDFLARE_KEYS нет'));
    if (orKey && want('openrouter')) {
      try {
        const r = await withTimeout(viaOpenRouter(bytes, src.mime, lang, prev), 'openrouter');
        if (r.ok) return r;
        tried.push('openrouter: ' + (r.why || 'пусто'));
      } catch (e) { tried.push('openrouter: ' + String((e && e.message) || e).slice(0, 120)); }
    } else if (orModel && want('openrouter')) tried.push('openrouter: ключа OPENROUTER_KEYS нет');
    if (via && !tried.length && !['groq', 'cloudflare', 'openrouter'].includes(via)) tried.push('неизвестный источник: ' + via);
    const why = tried.join(' · ');
    log('stt', 'fail', why.slice(0, 160));
    return { ok: false, why };
  }

  return {
    transcribe,
    stats: () => ({
      on,
      keys: { groq: !!groqKey, cloudflare: !!(cfKey && cfAcc), openrouter: !!orKey },
      models: { groq: groqKey ? groqModel : '', cloudflare: cfKey && cfAcc ? cfModel : '', omni: orKey ? orModel : '' },
      free: { cloudflareNeuronsPerAudioMinute: 46.63, cloudflareNeuronsPerDay: 10000, note: 'около 214 минут речи в сутки бесплатно' },
      maxBytes: MAX_AUDIO,
    }),
  };
}

export const sttLimits = { MAX_AUDIO, MIN_AUDIO, PROMPT };
