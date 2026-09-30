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
  const t = String(text || '').trim();
  if (t.length > 320) return false;
  return RU_HEAD.test(t) && REFUSAL_BODY.test(t) || EN_REFUSAL.test(t);
}

export function buildRequest(o) {
  const cfg = o.cfg;
  const model = String(o.model || '');
  const key = cfg.keys[o.keyIdx] || '';
  const url = (u) => u.replace('{acc}', cfg.account || '');
  const maxTokens = o.maxTokens || (o.tier === 'smart' ? 2000 : 900);
  const temp = typeof o.temperature === 'number' ? o.temperature : 0.8;
  const pics = (Array.isArray(o.images) ? o.images : [])
    .map(parseDataUrl).filter(Boolean).slice(0, o.maxImages || 2);

  if (cfg.kind === 'gemini') {
    const sys = [{ role: 'user', parts: [{ text: o.system }] }, { role: 'model', parts: [{ text: 'Понял. Действую так.' }] }];
    const contents = o.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content == null ? '' : m.content) }],
    }));
    if (pics.length && contents.length) {
      pics.forEach((p) => contents[contents.length - 1].parts.push({ inline_data: { mime_type: p.mime, data: p.data } }));
    }
    return {
      url: url(cfg.base) + '/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
      headers: { 'content-type': 'application/json' },
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
  for (const m of o.messages) {
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
    body: Object.assign({ model, messages, max_tokens: maxTokens, temperature: temp }, cfg.id === 'openrouter' ? { models: [model] } : {}),
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
