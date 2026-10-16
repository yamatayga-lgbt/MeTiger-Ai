/**
 * Подгонка запроса под окно модели (ctxfit) — «проверка на ошибки» на входе.
 *
 * Зачем. Бесплатные модели, на которых живёт этот клиент, имеют окно 4–32 К токенов,
 * а на входе у нас: системный промпт (персона + навыки до 3000 знаков + блоки freedom
 * до 8 КБ + данные инструментов) + до 8 реплик истории по 4000 знаков + текст
 * человека до 24000 знаков. Всё это может весить больше окна, и тогда провайдер
 * отвечает не «я не понял», а `400 context length exceeded` — человек видит пустой
 * отказ и думает, что сломался бот.
 *
 * Что делает слой, по порядку и всегда словами о том, что он тронул:
 *   1) нормализует поля (temperature — в разумный диапазон, model — без мусора,
 *      system — с потолком: клиент не должен иметь возможности прислать мегабайт
 *      «системы» и тем самым сорвать запрос);
 *   2) сжимает историю с САМОГО СТАРОГО конца, оставляя последнюю реплику целой —
 *      «забыть, о чём речь десять сообщений назад» лучше, чем не ответить вовсе;
 *      отрезанное сворачивается в одну строку-выжимку, а не исчезает молча;
 *   3) если и без истории не влезает — обрезает текст человека с явной пометкой.
 *
 * Никакого токенизатора: у бесплатных моделей свою разметку не угадать, а считать
 * «в среднем 3,3 знака на токен для кириллицы и 4 для латиницы» — достаточно, чтобы
 * не выстрелить в 400. Точность здесь нужна не в токенах, а в порядке: что резать
 * первым.
 */

const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CYR = 2.6;
const MAX_SYSTEM = 32000;
const MAX_MSG = 4000;
const MAX_HISTORY = 12;
const MAX_TEXT = 24000;
/**
 * Потолок окна, когда каталог говорит, что модель тянет больше.
 *
 * Почему не «сколько скажет каталог»: окно — не единственный предел бесплатного
 * тарифа, есть ещё минута-токены (TPM). Запрос на 300 КБ Gemini может отбить
 * `429` раньше, чем прочитает, — и человек вместо ответа получит обход по кругу.
 *
 * 1 000 000 токенов ≈ 2 500 000 знаков: это больше самого большого документа, который
 * мы вообще принимаем (ATTACH_DOC_CHARS = 200 000 знаков ≈ 60-70 К токенов), поэтому
 * файл целиком уезжает широкой голове, а не режется. Тем, у кого окно меньше,
 * документ не отрезается, а читается по частям (engine/longdoc.js) — там размер
 * окна перестаёт быть потолком для размера файла. Оператор может поднять потолок
 * до миллиона (CTX_WINDOW_MAX) или, наоборот, сузить (CTX_WINDOW).
 */
export const CTX_WINDOW_MAX = 1000000;

/** Оценка в токенах: кириллица плотнее, чем латиница (см. шапку). */
export function estTokens(s) {
  const text = String(s == null ? '' : s);
  if (!text) return 0;
  let cyr = 0;
  const n = Math.min(text.length, 8000);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x400 && c <= 0x4ff) cyr++;
  }
  const share = n ? cyr / n : 0;
  const perToken = CHARS_PER_TOKEN_LATIN - (CHARS_PER_TOKEN_LATIN - CHARS_PER_TOKEN_CYR) * Math.min(1, share * 1.6);
  return Math.ceil(text.length / perToken);
}

const num = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };

/** Число в разумные рамки; нечисловое — дефолт. */
export function clampNumber(v, min, max, dflt) {
  const x = Number(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(max, Math.max(min, x));
}

/**
 * Поля запроса в безопасный вид: то, что пришёл клиент из веба или из чужого
 * curl, не имеет права ронять движок. notes — чем мы это оплатили (всегда словами).
 */
export function normalizeFields(body, env) {
  const o = body || {};
  const notes = [];
  /* Безлимитный контекст (0.193, с 0.194 — всегда): историю не выбрасываем.
     Потолки на реплику, текст и длину ленты подняты в несколько раз, а то, что
     не влезает в окно модели, сжимается в выжимку на этапе fit(), а не теряется. */
  const cap = {
    system: num(env && env.CTX_MAX_SYSTEM, MAX_SYSTEM),
    msg: num(env && env.CTX_MAX_MSG, 16000),
    text: num(env && env.CTX_MAX_TEXT, 96000),
  };
  const maxHist = 200;

  let text = String(o.text == null ? '' : o.text).trim();
  if (text.length > cap.text) { text = text.slice(0, cap.text); notes.push('запрос обрезан до ' + cap.text + ' знаков'); }

  let system = typeof o.system === 'string' && o.system.trim() ? o.system.trim() : '';
  if (system.length > cap.system) { system = system.slice(0, cap.system); notes.push('свой системный промпт обрезан до ' + cap.system + ' знаков'); }

  const historyRaw = Array.isArray(o.history) ? o.history : [];
  /* длинную ленту не выбрасываем молча: берём последние `MAX_HISTORY`, и это
     отдельная причина, не «пустые реплики» — иначе человек читает неверный диагноз */
  const taken = historyRaw.slice(-maxHist);
  const tooOld = Math.max(0, historyRaw.length - taken.length);
  const history = [];
  let dropped = 0;
  for (const m of taken) {
    const raw = m && (m.text != null ? m.text : m.content);
    const content = String(raw == null ? '' : raw).trim();
    if (!content) { dropped++; continue; }
    if (content.length > cap.msg) {
      history.push({ role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content: content.slice(0, cap.msg) });
      notes.push('реплику истории урезал до ' + cap.msg + ' знаков');
      continue;
    }
    history.push({ role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user', content });
  }
  if (dropped > 0) notes.push(dropped + ' пустых реплик в истории не отправляем');
  if (tooOld > 0) notes.push('история длиннее ' + maxHist + ' реплик — взял последние ' + taken.length + ' (из ' + historyRaw.length + ')');

  let temperature;
  if (o.temperature != null && Number.isFinite(Number(o.temperature))) {
    const t = clampNumber(o.temperature, 0, 2, NaN);
    temperature = t;
    if (Number(o.temperature) !== t) notes.push('температуру ' + o.temperature + ' вернул в диапазон 0…2');
  }

  let maxTokens;
  const rawMax = o.maxTokens != null ? o.maxTokens : o.max_tokens;
  if (rawMax != null && Number.isFinite(Number(rawMax)) && Number(rawMax) > 0) {
    maxTokens = Math.round(clampNumber(rawMax, 64, 32768, 2048));
  }

  let topP;
  const rawTopP = o.topP != null ? o.topP : o.top_p;
  if (rawTopP != null && Number.isFinite(Number(rawTopP))) {
    topP = clampNumber(rawTopP, 0.05, 1, 0.95);
  }

  /* presence/frequency penalty — тот же приём, что у temperature: ноль — настоящее
     значение («выключено»), а не «не прислали», поэтому проверяем на != null, а не
     на truthy (0 || default стёр бы ровно тот случай, который чаще всего и шлют). */
  let presencePenalty;
  const rawPresence = o.presencePenalty != null ? o.presencePenalty : o.presence_penalty;
  if (rawPresence != null && Number.isFinite(Number(rawPresence))) {
    const v = clampNumber(rawPresence, -2, 2, 0);
    presencePenalty = v;
    if (Number(rawPresence) !== v) notes.push('presence_penalty ' + rawPresence + ' вернул в диапазон -2…2');
  }

  let frequencyPenalty;
  const rawFrequency = o.frequencyPenalty != null ? o.frequencyPenalty : o.frequency_penalty;
  if (rawFrequency != null && Number.isFinite(Number(rawFrequency))) {
    const v = clampNumber(rawFrequency, -2, 2, 0);
    frequencyPenalty = v;
    if (Number(rawFrequency) !== v) notes.push('frequency_penalty ' + rawFrequency + ' вернул в диапазон -2…2');
  }

  const reasoningEffort = o.reasoningEffort === 'low' || o.reasoningEffort === 'medium' || o.reasoningEffort === 'high'
    ? o.reasoningEffort
    : undefined;

  const model = typeof o.model === 'string' ? o.model.trim().replace(/[\u0000-\u001f\s]+/g, ' ').slice(0, 160) : undefined;
  const provider = typeof o.provider === 'string' && /^[a-z0-9_-]{1,40}$/i.test(o.provider.trim()) ? o.provider.trim() : undefined;
  const chatId = String(o.chatId || 'web').replace(/[\u0000-\u001f]/g, '').slice(0, 80);

  return { text, system, history, temperature, maxTokens, topP, presencePenalty, frequencyPenalty, reasoningEffort, model, provider, chatId, notes, caps: cap };
}

/**
 * Богатая выжимка (0.193, с 0.194 — всегда): до 40 реплик по ~220 знаков
 * каждая, а реплике, с которой разговор начался, — до 1500 знаков целиком:
 * в начале лежит сама задача человека.
 */
function richDigest(list) {
  const flat = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const firstUser = list.find((m) => m && m.role === 'user');
  const parts = [];
  for (const m of list) {
    if (!m || m === firstUser) continue;
    const head = flat(m.content).slice(0, 220);
    if (head) parts.push((m.role === 'assistant' ? 'я: ' : 'человек: ') + head + (head.length >= 220 ? '…' : ''));
    if (parts.length >= 40) break;
  }
  const start = firstUser ? 'С чего начался разговор (целиком): ' + flat(firstUser.content).slice(0, 1500) + '\n' : '';
  return start + parts.join('\n');
}

/**
 * Подогнать под окно. ctx: { system, history, text, images, env, maxOut, ctxUnlimited }.
 * → { system, history, text, notes, cut, tokens, window, overflow }
 * Резать начинаем с самого старого; последнюю реплику человека не трогаем никогда.
 */
export function fit(ctx) {
  const o = ctx || {};
  const env = o.env || {};
  /* Окно: сначала явное число от движка (`o.window`) — он спрашивает его у каталога
     про ту модель, которая сейчас отвечает (Gemini честно тянет миллион токенов, а
     groq-голове и восьми тысяч много). Настройка оператора (CTX_WINDOW) остаётся
     главной: она и есть «не расти выше этого» — тесты и отладка живут на ней. */
  const window = clampNumber(o.window, 1200, 1000000, clampNumber(env.CTX_WINDOW, 1200, 1000000, 8192));
  const maxOut = clampNumber(env.CTX_MAX_OUT, 64, 32000, num(o.maxOut, 900));
  const on = String(env.CTX_FIT || '') !== 'off';
  const notes = [];
  const out = {
    system: String(o.system || ''),
    history: Array.isArray(o.history) ? o.history.slice() : [],
    text: String(o.text || ''),
    notes, cut: { dropped: 0, digest: '', systemTrimmed: false, textTrimmed: 0 },
    tokens: 0, window, overflow: 0,
  };
  /* картинки стоят дорого и сжать их нечем — снимаем с бюджета по ~1000 токенов */
  const reserve = maxOut + (Array.isArray(o.images) ? o.images.length : 0) * 1000;
  const usedSys = () => estTokens(out.system);
  const usedUser = () => estTokens(out.text);
  const total = () => usedSys() + (out.history.reduce((a, m) => a + estTokens(m.content) + 4, 0)) + usedUser();
  out.tokens = total();
  if (!on) return out;

  const histCost = (list) => list.reduce((a, m) => a + estTokens(m.content) + 4, 0);

  /* 1) история: с самого старого конца. Дешевле всего потерять «о чём говорили
        десять реплик назад», чем не ответить вовсе; текущий вопрос человека при
        этом не в истории (он в `text`), так что он не пострадает. */
  const droppedList = [];
  while (total() + reserve > window && out.history.length) droppedList.push(out.history.shift());

  /* 2) выжимка: отрезанное не исчезает молча, оно возвращается в промпт —
        богатая (40×220 + начало разговора целиком). Её стоимость учитываем ДО
        подрезки подсказок и вставляем ПОСЛЕ неё — иначе подрезка съела бы как
        раз то, что должно напомнить о начале разговора. */
  const wrapDig = (d) => d
    ? '\n\nРаньше в разговоре было (старые реплики целиком не влезают в окно: начало разговора — целиком, дальше сжато):\n' + d
      + '\nНе выдумывай того, чего в сжатом виде нет.'
    : '';
  let dig = droppedList.length ? richDigest(droppedList) : '';
  let digBlock = wrapDig(dig);
  /* Выжимка богата и сама стоит места. Не влезает с ней — снимаем ещё реплики
     из живой части и обогащаем выжимку, пока блок не уместится. */
  let guard = 0;
  while (digBlock && total() + reserve + estTokens(digBlock) > window && out.history.length && guard < 250) {
    /* push, а не unshift: продолжаем снимать с того же (старого) конца —
       порядок выжимки остаётся «от начала разговора к концу». */
    droppedList.push(out.history.shift());
    dig = richDigest(droppedList);
    digBlock = wrapDig(dig);
    guard++;
  }
  if (droppedList.length) {
    out.cut.dropped = droppedList.length;
    notes.push('в окне ' + out.history.length + ' реплик целиком, предыдущие ' + droppedList.length + ' сжал в выжимку (окно ' + window + ' токенов)');
  }
  out.cut.digest = dig;

  /* 3) сам промпт: режем ТОЛЬКО хвост (подсказки навыков, данные инструментов).
        Персона и воля владельца остаются — иначе ответ начинает съезжать, а это
        дороже, чем обрезанный справочник. Запас 2% — на то, что оценка в токенах
        округляется вверх: без неё подрезка на 1 токен «не влезала» бы вечно. */
  const sysRoom = Math.max(120, window - reserve - histCost(out.history) - estTokens(out.text) - estTokens(digBlock) - 16);
  const keepChars = Math.floor(sysRoom * CHARS_PER_TOKEN_CYR * 0.98);
  if (out.system.length > keepChars + 1) {
    /* Флаг остаётся (по нему видно, что ответ шёл с подрезанным справочником),
       а в строку примечаний под ответом это НЕ пишется: человеку не нужен
       отчёт о внутренней кухне промпта — «подсказки в системном промпте
       обрезаны до N знаков — иначе не влезало в окно» он увидел и попросил
       убрать. Технический факт виден в out.cut.systemTrimmed и в логах. */
    out.cut.systemTrimmed = true;
    out.system = out.system.slice(0, keepChars) + '…';
  }
  if (digBlock) out.system += digBlock;

  /* 4) крайний случай: одного текста человека больше, чем всё окно. Режем его и
        говорим прямо — молча ответить на огрызок было бы хуже. Порог «мало места»
        считаем в токенах: в знаках он превращался в вечное «не влезает». */
  if (total() + reserve > window) {
    const roomTok = window - reserve - estTokens(out.system) - histCost(out.history) - 16;
    if (roomTok < 150) {
      out.overflow = 'запрос не влезает в окно модели даже без истории и подсказок: нужно ~'
        + (estTokens(out.text) + reserve) + ' токенов, окно ' + window;
    } else {
      const maxTextChars = Math.floor(roomTok * CHARS_PER_TOKEN_CYR);
      if (out.text.length > maxTextChars) {
        out.cut.textTrimmed = out.text.length - maxTextChars;
        out.text = out.text.slice(0, maxTextChars) + '\n…(дальше обрезано: окно модели ' + window + ' токенов)';
        /* Окно называем и здесь: человеку важно не только «текст урезали», но и
           «до какого размера» — по одному числу видно, идти ли к модели пошире. */
        notes.push('твой текст укоротил на ' + out.cut.textTrimmed + ' знаков, чтобы запрос влез в окно модели '
          + window + ' токенов');
      }
    }
  }
  out.tokens = total();
  return out;

}

/** Строка состояния для диагностического конца. */
export function lineOf(env) {
  if (String((env || {}).CTX_FIT || '') === 'off') return 'выключен (CTX_FIT=off)';
  return 'окно ' + num((env || {}).CTX_WINDOW, 8192) + ' токенов (или потолок модели из каталога, он же не выше '
    + num((env || {}).CTX_WINDOW_MAX, CTX_WINDOW_MAX) + ') · резерв на ответ ' + num((env || {}).CTX_MAX_OUT, 900);
}

export function stats(env) {
  return {
    on: String((env || {}).CTX_FIT || '') !== 'off',
    window: num((env || {}).CTX_WINDOW, 8192),
    windowMax: num((env || {}).CTX_WINDOW_MAX, CTX_WINDOW_MAX),
    maxOut: num((env || {}).CTX_MAX_OUT, 900),
    caps: { system: MAX_SYSTEM, msg: MAX_MSG, text: MAX_TEXT, history: MAX_HISTORY },
    line: lineOf(env),
  };
}
