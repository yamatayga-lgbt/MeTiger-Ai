/**
 * Форма запроса и разбор ответа — порт callProvider из Yama (Этап 1).
 *
 * Здесь только то, что отличает провайдеров друг от друга: URL, заголовки, тело,
 * и способ вынуть текст. Всё остальное (очередь, квоты, отказ) — в chat.js.
 *
 *  • openai-подобные: /chat/completions, картинки — массивом content с image_url;
 *  • gemini: :generateContent, system — первым user-turn'ом с подтверждением
 *    («Понял. Действую так.»), иначе Gemini иногда теряет системный блок;
 *  • cloudflare: тот же openai-эндпоинт, но под путём аккаунта ({acc}).
 */

import { cached as catalogCached, ceilings as catalogCeilings } from './modelreg.js';

export const THINK_TAG = /<\s*(think(?:ing)?|reasoning)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;

/** data:image/png;base64,... → { mime, data }. Чужой формат — null, не исключение. */
export function parseDataUrl(src) {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(String(src || ''));
  return m ? { mime: m[1], data: m[2] } : null;
}

/** Ход мыслей не должен попадать в ответ: это разные поля и разная цена. */
export function stripThinkTags(text) {
  const t = String(text == null ? '' : text);
  THINK_TAG.lastIndex = 0;
  if (!THINK_TAG.test(t)) return { text: t.trim(), reasoning: '' };
  return {
    text: t.replace(THINK_TAG, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim(),
    reasoning: (t.match(THINK_TAG) || []).map((seg) => seg.replace(THINK_TAG, '$2')).join('\n').trim(),
  };
}

/**
 * Ответ, который на деле является ошибкой провайдера или отказом.
 * Список снят с прода: эти строки приходят как text/plain 200, поэтому их
 * нельзя пускать человеку — иначе «I can't help with that» выглядит ответом агента.
 */
/* Признаки того, что в теле 200 OK приехал технический отказ провайдера.
   Голые числа 401/429 сюда НЕ входят: код ответа проверяется отдельно, а фраза
   «в зале 429 человек» — не ошибка (проверено на живых ответах). */
const PROVIDER_ERROR = /(^\s*(error|ошибка)\s*[:\-]|rate limit|too many requests|insufficient (balance|credit|quota)|exceeded your current|quota (exceeded|exhausted)|content policy|safety (guidelines|system)|blocked by (the )?(content|safety)|input data may contain|failed to generate|model (is )?(busy|unavailable)|no compatible providers)/i;

export function isProviderError(text) {
  return PROVIDER_ERROR.test(String(text || ''));
}

/* Вежливый отказ модели: короткий ответ, начинающийся с «извини/не могу/не буду».
   Длинные тексты под это не попадают — иначе мы глушили бы нормальные ответы,
   где человек спрашивает «почему ты не можешь...». */
/* Граница слова: \b в JS кириллицу не знает (проверено на Yama), поэтому она явная. */
const RU_HEAD = /^\s*(извини(те)?|прости(те)?|к\s+сожалению|сожалею|увы|боюсь,?\s+не)(?![а-яёa-z])/i;
const REFUSAL_BODY = /(не могу|не буду|не в состояни|отказыва|не получится|не умею|не должен)/i;
const EN_REFUSAL = /^(i('| a)m sorry|sorry,? but|i can'?t|i cannot|i'?m not able to|as an ai|as a language model)(?![a-z])/i;
export function isRefusal(text) {
  /* Модели отдают отказ в «красивой» типографике — с ’ вместо ' (gpt-oss любит
     «I’m sorry, but I can’t help with that.»). Без этой замены английский отказ
     не узнавался, и голая фраза «не могу» уезжала человеку как ответ. */
  const t = String(text || '').trim().replace(/[\u2019\u2018\u02bc\u02b9]/g, "'");
  if (t.length > 320) return false;
  return RU_HEAD.test(t) && REFUSAL_BODY.test(t) || EN_REFUSAL.test(t);
}

export function buildRequest(o) {
  const cfg = o.cfg;
  const model = String(o.model || '');
  const key = cfg.keys[o.keyIdx] || '';
  const url = (u) => u.replace('{acc}', cfg.account || '');
  let maxTokens = o.maxTokens || (o.tier === 'smart' ? 2000 : 900);
  /* Потолок модели важнее нашей щедрости: бесплатные модели отдают 400 на
     max_tokens выше своего, а часть шлюзов — и на равном. Каталог знает настоящий
     потолок, поэтому режем здесь. Нет каталога — живём по-старому. */
  const ceil = catalogCeilings(catalogCached(), model, o.provider);
  if (ceil) maxTokens = Math.max(64, Math.min(maxTokens, ceil.maxOut));
  const temp = typeof o.temperature === 'number' ? o.temperature : 0.8;
  const pics = (Array.isArray(o.images) ? o.images : [])
    .map(parseDataUrl).filter(Boolean).slice(0, o.maxImages || 2);

  /* Контекст у бесплатных моделей маленький (половина — 8–32К). Один лишний ход
     истории превращает запрос в 400 «context length exceeded», и очередь уходит
     дальше, сжигая квоту. Отбрасываем самые старые ходы, системный и последний
     не трогаем никогда. */
  let msgs = Array.isArray(o.messages) ? o.messages : [];
  if (ceil && msgs.length > 1) {
    const over = (o.system ? String(o.system).length : 0) + 2000;
    const budget = Math.max(600, Math.floor(ceil.ctx * 3) - maxTokens * 3 - over);
    let used = msgs.reduce((a, m) => a + String((m && m.content) || '').length, 0);
    /* Убираем с самого старого хода: последние важнее. Последний не отдаём ни
       при каком бюджете — без него запрос превращается в «ответь на пустоту». */
    while (used > budget && msgs.length > 1) {
      used -= String((msgs[0] && msgs[0].content) || '').length;
      msgs = msgs.slice(1);
    }
  }

  if (cfg.kind === 'gemini') {
    const sys = [{ role: 'user', parts: [{ text: o.system }] }, { role: 'model', parts: [{ text: 'Понял. Действую так.' }] }];
    const contents = msgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content == null ? '' : m.content) }],
    }));
    if (pics.length && contents.length) {
      pics.forEach((p) => contents[contents.length - 1].parts.push({ inline_data: { mime_type: p.mime, data: p.data } }));
    }
    return {
      /* alt=sse — иначе gemini отдаёт один большой json и поток превращается в ожидание. */
      url: url(cfg.base) + '/models/' + model + (o.stream ? ':streamGenerateContent?alt=sse&' : ':generateContent?') + 'key=' + encodeURIComponent(key),
      headers: { 'content-type': 'application/json' },
      ...(o.stream ? {
        sse: (d) => ({
          text: ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [])
            .map((x) => (x && typeof x.text === 'string' ? x.text : '')).join(''),
          finish: (d.candidates && d.candidates[0] && d.candidates[0].finishReason) || '',
        }),
        wrap: (text, finish) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: finish }] }),
      } : {}),
      body: {
        contents: sys.concat(contents),
        generationConfig: { maxOutputTokens: maxTokens, temperature: temp },
      },
      parse: (d) => {
        const cand = (d.candidates && d.candidates[0]) || {};
        const parts = (cand.content && cand.content.parts) || [];
        /* parts бывает и { inlineData: ... } — без text; undefined в ответ нельзя */
        const text = parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
        /* Блок приходит и в promptFeedback, и в finishReason — смотреть надо оба: во втором
           случае ответ пустой, и без этой проверки он выглядел бы как «модель промолчала». */
        const blockedReason = (d.promptFeedback && d.promptFeedback.blockReason)
          || (/(SAFETY|BLOCKLIST|PROHIBITED|RECITATION)/.test(String(cand.finishReason || '')) ? cand.finishReason : '');
        return { reply: text, reasoning: '', finish: cand.finishReason || '', blocked: !!blockedReason, blockReason: blockedReason };
      },
    };
  }

  /* openai-совместимый: сообщения один в один, картинки — в content массивом */
  const messages = [];
  if (o.system) messages.push({ role: 'system', content: o.system });
  for (const m of msgs) {
    const content = String(m.content == null ? '' : m.content);
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  if (pics.length) {
    const last = messages[messages.length - 1];
    if (last && typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content }];
    }
    if (last && Array.isArray(last.content)) {
      pics.forEach((p) => last.content.push({ type: 'image_url', image_url: { url: 'data:' + p.mime + ';base64,' + p.data } }));
    }
  }
  return {
    url: url(cfg.base) + '/chat/completions',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: Object.assign({ model, messages, max_tokens: maxTokens, temperature: temp }, o.stream ? { stream: true } : {}, cfg.id === 'openrouter' ? { models: [model] } : {}),
    parse: (d) => {
      const err = d.error && (d.error.message || d.error.code);
      const ch = (d.choices && d.choices[0]) || {};
      const m = ch.message || {};
      const raw = m.content || ch.text || '';
      const cut = stripThinkTags(typeof raw === 'string' ? raw : '');
      const reason = m.reasoning_content || m.reasoning || ch.reasoning || '';
      return {
        reply: cut.text, reasoning: String(reason || '').trim() || cut.reasoning,
        finish: ch.finish_reason || '', error: err ? String(err).slice(0, 300) : '',
      };
    },
    /* Читалка потока и упаковка собранного обратно в «настоящий» ответ провайдера.
       Второе нужно, чтобы стрим проходил те же нормализации (think-теги, reasoning,
       error), что и обычный: один parse на два пути, а не два почти одинаковых. */
    ...(o.stream ? {
      sse: (d) => {
        const ch = (d.choices && d.choices[0]) || {};
        const dl = ch.delta || ch.message || {};
        const e = d.error && (d.error.message || d.error.code);
        return {
          text: typeof dl.content === 'string' ? dl.content : '',
          reasoning: dl.reasoning_content || dl.reasoning || '',
          finish: ch.finish_reason || '',
          error: e ? String(e).slice(0, 300) : '',
        };
      },
      wrap: (text, finish, reasoning) => ({
        choices: [{ message: { content: text, reasoning_content: reasoning || '' }, finish_reason: finish }],
      }),
    } : {}),
  };
}

/** Один запрос с потолком времени. Ошибку не бросаем — возвращаем структурированно. */
export async function rawCall(impl, req, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(2000, timeoutMs || 30000));
  try {
    const res = await impl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ac.signal,
    });
    const status = res.status;
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* не-json: провайдеры так отвечают на ошибки */ }
    return { status, text, data };
  } catch (e) {
    return { status: 0, text: '', data: null, error: String((e && e.name === 'AbortError') ? 'timeout' : (e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Тот же запрос, но потоком: читает SSE по мере прихода и отдаёт куски в `onDelta`.
 *
 * Возвращает результат в ФОРМЕ rawCall (status/text/data), чтобы вызывающий не знал
 * о двух режимах: собранный текст упаковывается `req.wrap` и проходит обычный
 * `req.parse` — те же think-теги, reasoning и разбор error.
 *
 * Честно про границы:
 *   · провайдер обязан прислать `content-type: text/event-stream`; прислал json —
 *     тихо продолжаем как обычно (значит, stream:true он не поддерживает);
 *   · поток обрывается на середине: если текст уже есть — считаем его (модель ответила,
 *     хвост доесть нечем), если нет — это ошибка, и вызывающий уйдёт к следующему;
 *   · `onReasoning` (если задан) получает куски РАССУЖДЕНИЙ отдельно от ответа: думать
 *     вслух — это про показ, а не про то, чем модель ответила, поэтому в текст они
 *     не подмешиваются и счётчик `chunks` их не считает;
 *   · битую строку не считаем провайдерской ошибкой: режем её и идём дальше, но
 *     количество `bad` отдаём — по нему видно, что формат у провайдера свой.
 */
export async function streamCall(impl, req, timeoutMs, onDelta, onReasoning) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(2000, timeoutMs || 30000));
  let res = null;
  try {
    res = await impl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, text: '', data: null, error: String((e && e.name === 'AbortError') ? 'timeout' : (e && e.message) || e) };
  }
  const status = res.status;
  const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
  const isSse = /event-stream/i.test(ct) && typeof req.sse === 'function';
  if (status >= 400 || !isSse || !res.body || !res.body.getReader) {
    /* Не поток (или ошибка целиком) — прежний путь, без веток в вызывающем коде. */
    let text = '';
    try { text = await res.text(); } catch (e) { text = '' }
    clearTimeout(timer);
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* не-json: провайдеры так отвечают на ошибки */ }
    return { status, text, data, streamed: false };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '', reply = '', reason = '', finish = '', err = '', chunks = 0, bad = 0, aborted = false;
  const feed = (block) => {
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let d = null;
      try { d = JSON.parse(payload); } catch (e) { bad++; continue; }
      const got = req.sse(d) || {};
      if (got.error) err = String(got.error);
      if (got.reasoning) {
        reason += got.reasoning;
        if (onReasoning) { try { onReasoning(got.reasoning); } catch (e) { /* наблюдатель упал — поток не его вина */ } }
      }
      if (got.finish) finish = got.finish;
      if (got.text) {
        reply += got.text;
        chunks++;
        if (onDelta) { try { onDelta(got.text); } catch (e) { /*Consumer упал — поток не его вина */ } }
      }
    }
  };
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let cut = buf.indexOf('\n\n');
      while (cut >= 0) {
        feed(buf.slice(0, cut));
        buf = buf.slice(cut + 2);
        cut = buf.indexOf('\n\n');
      }
    }
    if (buf.trim()) feed(buf);
  } catch (e) {
    aborted = !!(e && e.name === 'AbortError');
    if (!reply && !err) err = aborted ? 'timeout' : 'поток оборвался: ' + String((e && e.message) || e);
  } finally {
    clearTimeout(timer);
    try { if (reader.cancel && !aborted) await reader.cancel().catch(() => {}); } catch (e) { /* уже закрыт */ }
    try { reader.releaseLock(); } catch (e) { /* не у всех есть */ }
  }
  if (!reply) {
    return { status: err ? status : 0, text: '', data: null, error: err || 'пустой поток', streamed: true, chunks, bad };
  }
  /* Ошибка в середине потока при уже собранном тексте — НЕ повод выбрасывать ответ
     (половину ответа лучше показать, чем молча уйти к следующей голове), но и молчать
     про неё нельзя: поле streamError доезжает до подписи под ответом. */
  return {
    status, text: reply, data: req.wrap ? req.wrap(reply, finish, reason) : null,
    streamed: true, chunks, bad, streamError: err || '',
  };
}
