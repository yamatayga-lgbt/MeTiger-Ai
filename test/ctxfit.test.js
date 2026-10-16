/**
 * Подгонка запроса под окно модели (engine/ctxfit.js).
 * Проверяется порядок резки и то, что каждое действие названо словами.
 * Запуск: node test/ctxfit.test.js
 */
import { estTokens, clampNumber, normalizeFields, fit, lineOf, stats } from '../engine/ctxfit.js';
import { createEngine } from '../engine/chat.js';
import { buildTable } from '../engine/providers.js';
import * as modelreg from '../engine/modelreg.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 170) : '')); }
}

console.log('C — окно контекста: нормализация входа и подгонка');

ok('C1: оценка в токенах растёт с длиной и не врёт в ноль', estTokens('') === 0 && estTokens('a'.repeat(400)) > estTokens('a'.repeat(100)));
ok('C2: кириллица плотнее латиницы (окно по ней меньше)', estTokens('кот'.repeat(100)) > estTokens('cat'.repeat(100) + 'xxx'), [estTokens('кот'.repeat(100)), estTokens('cat'.repeat(100))].join('/'));
ok('C3: clampNumber держит рамки и не боится мусора', clampNumber(9, 0, 2, 0.7) === 2 && clampNumber(-5, 0, 2, 0.7) === 0 && clampNumber('нет', 0, 2, 0.7) === 0.7);

{
  const many = normalizeFields({ text: 'давай', history: Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: 'р' + i })) }, {});
  ok('C4a: ленту в 30 реплик не выбрасываем молча — сказано, сколько взято',
    many.history.length === 12 && /взял последние 12 \(из 30\)/.test(many.notes.join(' ')) && !/пустых/.test(many.notes.join(' ')), JSON.stringify(many.notes));
  const r = normalizeFields({ text: 'привет', chatId: 'чат\u00001' }, {});
  ok('C4: нормальный вход проходит без единой правки', r.text === 'привет' && r.notes.length === 0 && r.history.length === 0, JSON.stringify(r));
  ok('C5: управляющие символы из chatId вычищаются', r.chatId.indexOf('\u0000') < 0 && /^чат1$/.test(r.chatId), JSON.stringify(r.chatId));
  const long = normalizeFields({ text: 'a'.repeat(40000), system: 'x'.repeat(100000), history: [{ role: 'user', text: 'b'.repeat(9000) }, { role: 'bogus' }, null, { role: 'assistant', text: 'ok' }], temperature: 12, model: '  deepseek\u000b4-flash ', provider: 'groq/../x' }, {});
  ok('C6: длиннющий текст режется и это сказано', long.text.length <= long.caps.text && /запрос обрезан/.test(long.notes.join()), long.text.length);
  ok('C7: «system» от клиента имеет потолок — мегабайт промпта не пройдёт', long.system.length === long.caps.system && /системный промпт обрезан/.test(long.notes.join()), long.system.length);
  ok('C8: пустые и мусорные реплики истории не едут провайдеру', long.history.length === 2 && long.history[1].role === 'assistant', JSON.stringify(long.history.map((m) => m.role)));
  ok('C9: роль-мусор становится user, а не ломает запрос', long.history[0].role === 'user', JSON.stringify(long.history[0].role));
  ok('C10: каждая реплика истории тоже под потолком', long.history.every((m) => m.content.length <= long.caps.msg), JSON.stringify(long.history.map((m) => m.content.length)));
  ok('C11: temperature возвращается в 0…2 словами', long.temperature === 2 && /температуру 12/.test(long.notes.join()), String(long.temperature));
  ok('C12: из имени модели вычищены управляющие символы, пробелы по краям — нет смысла', long.model === 'deepseek 4-flash', JSON.stringify(long.model));
  ok('C13: провайдер с путью («groq/../x») не проходит, а значит будет выбран движком', long.provider === undefined, JSON.stringify(long.provider));
  const t0 = normalizeFields({ text: 'x', temperature: 0 }, {});
  ok('C14: ялевой ноль — это значение, а не «не прислали»', t0.temperature === 0, JSON.stringify(t0.temperature));

  /* 0.070: presence/frequency penalty — второе расширение карточки «Параметры»
     (после temperature/max_tokens/top_p) тем же приёмом: клиентский мусор режется
     молча ДО провайдера, а не долетает до него и не роняет запрос на 400. */
  const penClamped = normalizeFields({ text: 'x', presencePenalty: 9, frequencyPenalty: -9 }, {});
  ok('C14a: presence/frequency_penalty тоже возвращаются в рамку (-2…2) словами',
    penClamped.presencePenalty === 2 && penClamped.frequencyPenalty === -2
      && /presence_penalty 9/.test(penClamped.notes.join()) && /frequency_penalty -9/.test(penClamped.notes.join()),
    JSON.stringify(penClamped));
  const penZero = normalizeFields({ text: 'x', presencePenalty: 0, frequencyPenalty: 0 }, {});
  ok('C14b: ноль у penalty — тоже значение, а не «не прислали» (как у temperature)',
    penZero.presencePenalty === 0 && penZero.frequencyPenalty === 0, JSON.stringify(penZero));
  const penSnake = normalizeFields({ text: 'x', presence_penalty: 1.5, frequency_penalty: -0.5 }, {});
  ok('C14c: snake_case-алиасы (как шлют некоторые клиенты) читаются так же, как camelCase',
    penSnake.presencePenalty === 1.5 && penSnake.frequencyPenalty === -0.5, JSON.stringify(penSnake));
  const penNone = normalizeFields({ text: 'x' }, {});
  ok('C14d: без penalty в запросе — поля undefined, а не 0 по умолчанию (провайдер получит свой дефолт)',
    penNone.presencePenalty === undefined && penNone.frequencyPenalty === undefined, JSON.stringify(penNone));
}

{
  const sys = 'ПЕРСОНА. ' + 'подсказки '.repeat(50);
  const hist = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'реплика ' + i + ' ' + 'содержание '.repeat(120) }));
  const r = fit({ system: sys, history: hist, text: 'короткий вопрос', images: [], env: { CTX_WINDOW: 2000, CTX_MAX_OUT: 300 } });
  ok('C15: не влезает → история режется с САМОГО СТАРОГО конца', r.history.length < hist.length && /реплика 9/.test(r.history[r.history.length - 1].content), String(r.history.length));
  ok('C16: последняя реплика человека остаётся целой', /содержание/.test(r.history[r.history.length - 1].content) && r.history[r.history.length - 1].content.length === hist[9].content.length, JSON.stringify(r.history.map((m) => m.content.length)));
  ok('C17: отрезанное не исчезает молча — в промпт идёт выжимка', /Раньше в разговоре было/.test(r.system) && /реплика 0/.test(r.system), r.system.slice(-160));
  ok('C18: и человек получает заметку, сколько реплик ушло', r.notes.length >= 1 && /историю урезал на \d+/.test(r.notes.join(' ')), JSON.stringify(r.notes));
  ok('C19: после подгонки запрос влезает в окно (или сказан overflow)', r.tokens + 300 <= 2000 || !!r.overflow, JSON.stringify({ tokens: r.tokens, window: r.window, overflow: r.overflow }));
  const small = fit({ system: 'короткая персона', history: [{ role: 'user', content: 'привет' }], text: 'как дела', images: [], env: { CTX_WINDOW: 8192 } });
  ok('C20: нормальный запрос не трогается вообще', small.notes.length === 0 && small.history.length === 1 && small.system === 'короткая персона' && small.text === 'как дела', JSON.stringify(small.notes));
  const off = fit({ system: sys, history: hist, text: 'короткий вопрос', env: { CTX_WINDOW: 2000, CTX_FIT: 'off' } });
  ok('C21: CTX_FIT=off — слой не режет ничего (для отладки и для спора)', off.history.length === hist.length && off.notes.length === 0, off.history.length);
  const pic = fit({ system: 'персона', history: [], text: 'что на фото', images: [1, 2], env: { CTX_WINDOW: 8192, CTX_MAX_OUT: 900 } });
  ok('C22: картинки снимаются с бюджета — их сжать нечем', pic.tokens > 0 && pic.notes.length === 0, JSON.stringify(pic).slice(0, 120));
  const hugeText = fit({ system: 'персона', history: [], text: 'а'.repeat(60000), images: [], env: { CTX_WINDOW: 1000, CTX_MAX_OUT: 300 } });
  ok('C23: один текст больше окна — либо режется, либо честный overflow', hugeText.overflow ? /окно/.test(hugeText.overflow) : hugeText.text.length < 60000, JSON.stringify({ ov: hugeText.overflow, len: hugeText.text.length }).slice(0, 160));
  /* Сценарий: промпт сам по себе больше половины окна. Резать можно только его
     хвост и историю — вопрос человека обязан дойти до модели целиком. */
  const fat = 'ПЕРСОНА. ' + 'правила '.repeat(320);
  const one = fit({ system: fat, history: [{ role: 'user', content: 'контекст разговора' }], text: 'итого?', env: { CTX_WINDOW: 1500, CTX_MAX_OUT: 900 } });
  ok('C24: вопрос человека не режется никогда — резать можно только историю и хвост подсказок',
    one.text === 'итого?' && one.system.length < fat.length && one.notes.length > 0 && !one.overflow,
    JSON.stringify({ sysLen: one.system.length, notes: one.notes.map((n) => n.slice(0, 44)), ov: one.overflow }));
  /* Владелец увидел в ответе «подсказки в системном промпте обрезаны до 4515 знаков —
     иначе не влезало в окно» и попросил убрать. Флаг остаётся (по нему видно, что
     ответ шёл с подрезанным справочником), а в примечания не пишется. */
  ok('C24a: подрезка внутреннего системного промпта НЕ выходит человеку в примечания (флаг cut.systemTrimmed — для логов)',
    one.cut.systemTrimmed === true && !/системном промпте|не влезало/.test(one.notes.join(' ')),
    JSON.stringify({ trimmed: one.cut.systemTrimmed, notes: one.notes }));}

{
  ok('C25: lineOf — одна строка для диагностики', /окно 8192/.test(lineOf({})) && /выключен/.test(lineOf({ CTX_FIT: 'off' })), lineOf({}));
  const st = stats({ CTX_WINDOW: '12000' });
  ok('C26: stats показывает окно, резерв и потолки', st.window === 12000 && st.caps.history === 12 && st.maxOut > 0, JSON.stringify(st).slice(0, 160));
}

console.log('C27 — сквозная проверка: движок применяет подгонку сам');
{
  const bodies = [];
  const f = async (url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] }) };
  };
  const env = { GROQ_KEYS: 'g1', CTX_WINDOW: '900', CTX_MAX_OUT: '200' };
  const e = createEngine({ env, fetch: f, sleep: async () => {} });
  const history = Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: 'реплика ' + i + ' ' + 'много текста '.repeat(300) }));
  const r = await e.run({ text: 'итого?', history, providerOrder: ['groq'], skills: false, useTools: false });
  const sent = bodies[0] && bodies[0].messages ? bodies[0].messages : [];
  ok('C27: в запрос модели ушло меньше реплик, чем прислали (окно 900)', r.ok && sent.length < history.length + 1, JSON.stringify({ sent: sent.length, sent_to: history.length + 1 }));
  ok('C28: и последнее слово — человека, а не выжимка истории', sent.length > 0 && /итого\?/.test(sent[sent.length - 1].content), JSON.stringify(sent[sent.length - 1] && sent[sent.length - 1].content.slice(0, 60)));
  ok('C29: движок говорит словами, что он подрезал', typeof r.cxFit === 'string' && /окно модели/.test(r.cxFit), JSON.stringify(r.cxFit));
  const small = await createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f, sleep: async () => {} }).run({ text: 'привет', history: [{ role: 'user', content: 'как дела' }], providerOrder: ['groq'], skills: false, useTools: false });
  ok('C30: на нормальном запросе поле подгонки пустое — резали нечего', small.ok && small.cxFit === undefined, JSON.stringify(small.cxFit));
}

/* 0.153: окно следует за моделью, которая отвечает.
   До этого окно было одной цифрой на весь запрос (CTX_WINDOW, 8 192), и документ
   в 24 000 знаков терял половину ещё до отправки — даже когда в пуле стояла модель
   на миллион токенов. Здесь это и проверяется: у широкой головы документ цел, у
   узкой — честно подрезан и названо окно, а на длинный материал движок сначала
   идёт к широкой. */
console.log('C31 — окно по модели, а не одно на всех');
{
  const P = buildTable({ GROQ_KEYS: 'g1', GEMINI_KEYS: 'm1' });
  const models = [];
  for (const [pid, cfg] of Object.entries(P)) {
    for (const id of [].concat(cfg.models.fast || [], cfg.models.smart || [])) {
      models.push({ id, src: pid, free: true, chat: true, ctx: pid === 'gemini' ? 1000000 : 8192, maxOut: 4096 });
    }
  }
  const store = { get: async () => ({ value: JSON.stringify({ updatedAt: Date.now(), count: models.length, models }) }) };
  await modelreg.loadCatalog(store, { env: {}, now: Date.now(), force: true });
  ok('C31: каталог с разными окнами дошёл до движка (gemini 1М, groq 8К)',
    modelreg.ceilings(modelreg.cached(), 'gemini-3.5-flash', 'gemini').ctx === 1000000
      && modelreg.ceilings(modelreg.cached(), 'qwen/qwen3.8-27b', 'groq').ctx === 8192,
    JSON.stringify({
      gemini: modelreg.ceilings(modelreg.cached(), 'gemini-3.5-flash', 'gemini'),
      groq: modelreg.ceilings(modelreg.cached(), 'qwen/qwen3.8-27b', 'groq'),
    }));

  /* «Документ» из вложения: 18 900 знаков — так ATTACH_DOC_CHARS и задуман, он
     режет файл на 24 000, то есть документ обязан доехать до модели целиком. */
  const tail = 'КОНЕЦ-ДОКУМЕНТА-77';
  const doc = 'строка документа с данными. '.repeat(690) + tail;
  const question = 'Что сказано в документе?\n\n' + doc;
  const calls = [];
  /* Ответ — в форме того провайдера, куда позвали: gemini разбирает candidates,
     openai-подобные — choices. Один общий фейк отдавал gemini «пустой ответ». */
  const f = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const body = /generativelanguage/.test(String(url))
      ? { candidates: [{ content: { parts: [{ text: 'ок' }] }, finishReason: 'STOP' }] }
      : { choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  /* У gemini текст лежит в contents (parts.text), у openai-подобных — в messages. */
  const sentText = (i) => {
    const b = (calls[i] && calls[i].body) || {};
    if (Array.isArray(b.contents)) {
      const last = b.contents[b.contents.length - 1] || {};
      return String((((last.parts || [])[0]) || {}).text || '');
    }
    const msgs = b.messages || [];
    return String((msgs[msgs.length - 1] && msgs[msgs.length - 1].content) || '');
  };

  const wide = await createEngine({ env: { GEMINI_KEYS: 'm1' }, fetch: f, sleep: async () => {} })
    .run({ text: question, history: [], providerOrder: ['gemini'], skills: false, useTools: false });
  ok('C32: широкая голова получает документ целиком — хвост на месте, резать нечего',
    wide.ok && sentText(0).indexOf(tail) >= 0 && wide.cxFit === undefined,
    JSON.stringify({ ok: wide.ok, cx: wide.cxFit, tailIn: sentText(0).indexOf(tail) >= 0, len: sentText(0).length }));

  calls.length = 0;
  const narrow = await createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f, sleep: async () => {} })
    .run({ text: question, history: [], providerOrder: ['groq'], skills: false, useTools: false });
  ok('C33: узкая голова режет — и говорит, что окно было 8 192, а не молчит',
    narrow.ok && sentText(0).indexOf(tail) < 0 && /окно модели 8192/.test(String(narrow.cxFit)),
    JSON.stringify({ cx: narrow.cxFit, tailIn: sentText(0).indexOf(tail) >= 0 }).slice(0, 200));

  calls.length = 0;
  const auto = await createEngine({ env: { GROQ_KEYS: 'g1', GEMINI_KEYS: 'm1' }, fetch: f, sleep: async () => {} })
    .run({ text: question, history: [], providerOrder: ['groq', 'gemini'], skills: false, useTools: false });
  ok('C34: на длинный материал движок сам идёт к широкой голове первой (в этом и смысл)',
    auto.ok && calls.length > 0 && /generativelanguage/.test(calls[0].url) && auto.cxFit === undefined,
    JSON.stringify({ first: (calls[0] || {}).url, cx: auto.cxFit }).slice(0, 200));

  /* Слово оператора остаётся главным: CTX_WINDOW — это «не расти выше», и каталог
     с миллионом его не отменяет (на этом живут тесты и отладка). */
  calls.length = 0;
  const capped = await createEngine({ env: { GEMINI_KEYS: 'm1', CTX_WINDOW: '2000' }, fetch: f, sleep: async () => {} })
    .run({ text: question, history: [], providerOrder: ['gemini'], skills: false, useTools: false });
  ok('C35: CTX_WINDOW оператора сильнее каталога — окно 2 000 держит и миллионную модель',
    capped.ok && /окно модели 2000/.test(String(capped.cxFit)) && sentText(0).indexOf(tail) < 0,
    JSON.stringify({ cx: capped.cxFit, tailIn: sentText(0).indexOf(tail) >= 0 }).slice(0, 200));
}

console.log('U — безлимитный контекст (0.193)');
{
  /* Капы растут: лента 150 реплик не режется до 12, реплика в 20 000 знаков
     остаётся (до 16 000), текст до 96 000. */
  const u = normalizeFields({
    text: 'a'.repeat(120000),
    history: Array.from({ length: 150 }, (_, i) => ({ role: 'user', text: 'х'.repeat(20000) })),
    ctxUnlimited: true,
  }, {});
  ok('U1: безлимит — лента целиком (150), реплики до 16 000, текст до 96 000',
    u.ctxUnlimited === true && u.history.length === 150 && u.history[0].content.length === 16000 && u.text.length === 96000,
    JSON.stringify({ n: u.history.length, msg: u.history[0].content.length, text: u.text.length }));

  const d = normalizeFields({ text: 'привет', ctxUnlimited: true }, {});
  ok('U2: флаг честно доезжает и при пустой истории', d.ctxUnlimited === true);
  const off = normalizeFields({ text: 'привет' }, {});
  ok('U3: без флага всё по-старому — 12 реплик и никаких изменений капов',
    off.ctxUnlimited === false && off.history.length === 0 && off.caps.text === 24000);

  /* fit: богатая выжимка — начало разговора целиком, элементы по ~220. */
  const hist = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: (i === 0 ? 'Задача: посчитай бюджет ремонта кухни 12 метров. ' : 'сообщение номер ' + i + ' ').repeat(i === 0 ? 4 : 40),
  }));
  const f = fit({ system: 'ты помощник', history: hist, text: 'итог какой?', env: { CTX_WINDOW: '6000' }, ctxUnlimited: true, maxOut: 900 });
  ok('U4: выжимка богата: начало разговора — целиком, старые реплики по ~220 знаков',
    f.cut.digest.indexOf('С чего начался разговор (целиком): Задача: посчитай бюджет') === 0
      && /сообщение номер 2[^\n]{150,}/.test(f.cut.digest),
    JSON.stringify(f.cut.digest.slice(0, 120)));
  ok('U5: примечание честно: сколько реплик целиком и сколько сжато',
    /безлимит: \d+ реплик целиком, предыдущие \d+ сжал в выжимку/.test(f.notes.join(' ')), JSON.stringify(f.notes));

  /* Обычный режим не изменился: тонкая выжимка одной строкой. */
  const f2 = fit({ system: 'ты помощник', history: hist, text: 'итог какой?', env: { CTX_WINDOW: '6000' }, maxOut: 900 });
  ok('U6: без флага — прежняя выжимка 6×90, без «С чего начался разговор»',
    f2.cut.digest.length > 0 && f2.cut.digest.indexOf('С чего начался разговор') < 0 && !/человек: /m.test(f2.cut.digest),
    JSON.stringify(f2.cut.digest.slice(0, 80)));
}

/* U7: у движка свой кэп истории (historyKeep) — безлимит поднимает и его. */
{
  const seen = [];
  const f = async (_url, init) => {
    try { seen.push(JSON.parse(String(init && init.body)).messages.length); } catch { seen.push(-1); }
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ок' } }] }) };
  };
  const e = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f, sleep: async () => {} });
  const h30 = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: 'метка ' + i + ' ' + 'слово '.repeat(20) }));
  await e.run({ text: 'привет', history: h30, ctxUnlimited: true, useTools: false, skills: false });
  await e.run({ text: 'привет', history: h30, useTools: false, skills: false });
  ok('U7: с флагом движок шлёт все ~31 сообщение, без флага — прежние ~9',
    seen[0] >= 28 && seen[1] <= 10, JSON.stringify(seen));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
