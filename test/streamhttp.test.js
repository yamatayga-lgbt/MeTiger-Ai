/**
 * Стриминг на входе: `accept: text/event-stream` у POST /api/chat.
 *
 * Зачем: обёртка не должна ни менять, ни дублировать логику двери — память, лимиты,
 * инструменты и совет считаются ровно один раз. Проверяется три вещи: куски летят по
 * мере чтения провайдера (а не все в конце), финальное событие несёт тот же payload,
 * что вернул бы обычный POST, и любая ошибка отказа (400/503) приходит как `final`,
 * а не как висящее «думает».
 *
 *   node test/streamhttp.test.js
 */
import { onRequestPost } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

const ENV = { GROQ_KEYS: 'g1', RATE_LIMIT: '0' };
const req = (o, accept) => new Request('http://x/api/chat', {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, accept ? { accept } : {}),
  body: JSON.stringify(o),
});
/* Дверь Pages Function вызывают контекстом ({ request, env }) — не голимым Request. */
const post = (o, accept) => onRequestPost({ request: req(o, accept), env: ENV, waitUntil: () => {} });
const SSE = 'text/event-stream';
const enc = new TextEncoder();

/** Провайдер, который отвечает потоком: три куска и [DONE]. */
function streamFetch(parts, calls) {
  return async (url, init) => {
    let body = null;
    try { body = JSON.parse(String(init && init.body)); } catch (e) { body = null; }
    if (calls) calls.push({ chat: /chat\/completions/.test(String(url)), stream: !!(body && body.stream) });
    const chunks = parts.map((t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: '' }] }) + '\n\n');
    chunks.push('data: [DONE]\n\n');
    const rs = new ReadableStream({
      start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close() },
    });
    return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
  };
}
/** Провайдер, который про stream:true слышать не хочет: один json. */
function jsonFetch(text, calls) {
  return async (_u, init) => {
    let body = null;
    try { body = JSON.parse(String(init && init.body)); } catch (e) { body = null }
    if (calls) calls.push({ chat: true, stream: !!(body && body.stream) });
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function drain(res) {
  const events = []
  const rd = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!rd) return { text: await res.text(), events };
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const r = await rd.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    out += dec.decode(r.value, { stream: false });
    let cut = buf.indexOf('\n\n');
    while (cut >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const line = block.split('\n').find((x) => x.startsWith('data:'));
      if (line) { try { events.push(JSON.parse(line.slice(5).trim())) } catch (e) { /* обрыв строки */ } }
      cut = buf.indexOf('\n\n');
    }
  }
  return { text: out, events };
}

const withFetch = async (fn) => {
  const saved = globalThis.fetch;
  try { return await fn(); } finally { globalThis.fetch = saved }
};

console.log('── H · SSE-обёртка двери /api/chat ───');
{
  await withFetch(async () => {
    const calls = [];
    globalThis.fetch = streamFetch(['При', 'вет', '!'], calls);
    const res = await post({ text: 'скажи привет', chatId: 'sse1' }, SSE);
    const { events: ev } = await drain(res);
    const drafts = ev.filter((e) => e.kind === 'draft');
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H1: ответ идёт потоком — content-type и финальное событие на месте',
      /text\/event-stream/.test(res.headers.get('content-type') || '') && !!fin, res.headers.get('content-type'));
    const chatCall = calls.filter((x) => x.chat)[0];
    ok('H2: провайдер реально спрошен со stream:true, куски долетели по отдельности',
      !!chatCall && chatCall.stream === true && drafts.length >= 2, JSON.stringify({ calls, drafts: drafts.length }));
    ok('H3: куски складываются в тот же текст, что был бы в json',
      drafts.map((d) => d.text).join('') === 'Привет!' && fin.payload.reply === 'Привет!',
      JSON.stringify({ draft: drafts.map((d) => d.text).join(''), reply: fin && fin.payload.reply }));
    ok('H4: дельты помечены провайдером — черновик не перепутается с другим пулом',
      drafts.every((d) => d.provider === 'groq'), JSON.stringify(drafts.map((d) => d.provider)));
    ok('H5: в финале обычные поля (model, ms, chatId) — обёртка ничего не съела',
      fin.status === 200 && fin.payload.ok === true && !!fin.payload.model && fin.payload.memoryChatId === 'sse1',
      JSON.stringify({ st: fin.status, m: fin.payload.model }));
  });

  await withFetch(async () => {
    const calls = [];
    globalThis.fetch = jsonFetch('Привет без потока', calls);
    const res = await post({ text: 'скажи привет', chatId: 'sse2' }, SSE);
    const { events: ev } = await drain(res);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H6: провайдер без потока — тот же ответ, просто одним куском (ничего не отвалилось)',
      calls.filter((x) => x.chat)[0].stream === true && ev.filter((e) => e.kind === 'draft').length === 0 && fin.payload.reply === 'Привет без потока',
      JSON.stringify({ drafts: ev.filter((e) => e.kind === 'draft').length, reply: fin && fin.payload.reply }));
  });

  await withFetch(async () => {
    const calls = [];
    globalThis.fetch = jsonFetch('обычный путь', calls);
    const res = await post({ text: 'скажи привет', chatId: 'sse3' });
    const ct = res.headers.get('content-type') || '';
    const j = await res.json();
    ok('H7: без accept: text/event-stream — прежний голый JSON, провайдер не дразнится потоком',
      /application\/json/.test(ct) && j.ok === true && (calls.filter((x) => x.chat)[0] || {}).stream === false,
      JSON.stringify({ ct, stream: calls.filter((x) => x.chat)[0] }));
  });

  /* Отказ обязан быть назван и в потоке: код + payload, а не пустой закрытый ответ. */
  await withFetch(async () => {
    globalThis.fetch = streamFetch(['x']);
    const res = await post({ text: '', chatId: 'sse4' }, SSE);
    const { events: ev } = await drain(res);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H8: пустой запрос приходит как final со статусом 400, а не как молчаливый конец потока',
      !!fin && fin.status === 400 && fin.payload.ok === false, JSON.stringify(ev).slice(0, 160));
  });

  await withFetch(async () => {
    globalThis.fetch = async () => new Response('нет', { status: 503 });
    const res = await post({ text: 'скажи что-нибудь', chatId: 'sse5' }, SSE);
    const { events: ev } = await drain(res);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    const kinds = ev.map((e) => e.kind).join('+');
    ok('H9: все провайдеры легли — финал со статусом 503 и причиной, а не молчаливый конец',
      !!fin && fin.status === 503 && fin.payload.ok === false && !!fin.payload.error,
      JSON.stringify({ kinds, err: fin && fin.payload.error }));
  });
}
  /* ── «думать вслух»: отдельный канал того же потока ── */
  await withFetch(async () => {
    globalThis.fetch = async (_u, init) => {
      const b = JSON.parse(String(init && init.body));
      void b;
      const rows = [
        { choices: [{ delta: { reasoning_content: 'Взвешиваю ' }, finish_reason: '' }] },
        { choices: [{ delta: { reasoning_content: 'слова' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'Готово' }, finish_reason: '' }] },
      ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'скажи что-нибудь', chatId: 'sse6', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const reason = ev.filter((e) => e.kind === 'draft' && e.channel === 'reasoning');
    const answer = ev.filter((e) => e.kind === 'draft' && !e.channel);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H10: по просьбе рассуждения летят отдельным каналом и не смешиваются с ответом',
      reason.map((e) => e.text).join('') === 'Взвешиваю слова' && answer.length === 1 && answer[0].text === 'Готово',
      JSON.stringify({ reason: reason.map((e) => e.text), answer: answer.map((e) => e.text) }));
    ok('H11: в финале рассуждения те же, что были бы и без потока (данные не прячутся)',
      fin.payload.reasoning === 'Взвешиваю слова' && fin.payload.reply === 'Готово',
      JSON.stringify({ r: fin.payload.reasoning, rep: fin.payload.reply }));
  });

  await withFetch(async () => {
    globalThis.fetch = async () => {
      const rs = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'лишнее' }, finish_reason: '' }] }) + '\n\n'));
          c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ок' }, finish_reason: '' }] }) + '\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'скажи что-нибудь', chatId: 'sse7' }, SSE);
    const { events: ev } = await drain(res);
    ok('H12: без просьбы лишние килобайты не льются — канал reasoning молчит, ответ тот же',
      ev.filter((e) => e.channel === 'reasoning').length === 0 && ev.filter((e) => e.kind === 'draft').length === 1
        && ev.filter((e) => e.kind === 'final').pop().payload.reply === 'ок',
      JSON.stringify(ev.map((e) => e.kind + (e.channel ? ':' + e.channel : ''))));
    ok('H13: без поисковых инструментов поле sources не засоряет ответ',
      ev.filter((e) => e.kind === 'final').pop().payload.sources === undefined);
  });

  await withFetch(async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.wikimedia.org/core/v1/wikipedia/ru/search')) {
        return new Response(JSON.stringify({
          pages: [{ title: ' графен ', key: 'Графен', description: 'двумерный кристалл', excerpt: 'слой атомов углерода' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('duckduckgo.com')) {
        return new Response(JSON.stringify({ AbstractText: '', RelatedTopics: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Графен [1]' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const res = await post({ text: 'расскажи про двумерный углерод', chatId: 'sse8', webSearch: true }, SSE);
    const { events: ev } = await drain(res);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H14: webSearch:true включает глубокий поиск без слова «погугли» и отдаёт проверенные sources в финале',
      fin && fin.payload.ok === true
        && (fin.payload.tools || []).includes('web-search')
        && Array.isArray(fin.payload.sources)
        && fin.payload.sources.length === 1
        && fin.payload.sources[0].title === 'графен'
        && /ru\.wikipedia\.org\/wiki\//.test(fin.payload.sources[0].url),
      JSON.stringify(fin && fin.payload));
  });

  await withFetch(async () => {
    let sysSeen = '';
    const tOpen = '<' + 'think>';
    const tClose = '<' + '/think>';
    globalThis.fetch = async (_u, init) => {
      const b = JSON.parse(String(init && init.body));
      const sysMsg = (b.messages || []).find((m) => m.role === 'system');
      if (sysMsg) sysSeen = sysMsg.content || '';
      const rows = [
        { choices: [{ delta: { content: tOpen + 'Let me analyze ' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'in English first.' + tClose + '\nТочный ' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'ответ.' }, finish_reason: 'stop' }] },
      ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'объясни кратко', chatId: 'sse9', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const reason = ev.filter((e) => e.kind === 'draft' && e.channel === 'reasoning');
    const answer = ev.filter((e) => e.kind === 'draft' && !e.channel);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H15: showReasoning просит думать на английском (IN ENGLISH) и на лету режет <think>...</think> в канал reasoning',
      /IN ENGLISH/.test(sysSeen)
        && reason.map((e) => e.text).join('') === 'Let me analyze in English first.'
        && answer.map((e) => e.text).join('') === 'Точный ответ.'
        && fin.payload.reasoning === 'Let me analyze in English first.'
        && fin.payload.reply === 'Точный ответ.',
      JSON.stringify({ sys: /IN ENGLISH/.test(sysSeen), r: reason.map((e) => e.text), a: answer.map((e) => e.text), fin: fin && fin.payload }));
  });


/* ── Тег размышлений, названный моделью по-своему ─────────────────────────
   Живой случай с прода: ответ начинался с `<вкладка:thinking> We need to prove that
   sqrt(2) is irrational…` — модель перевела имя тега. Прежний разбор знал только
   латинские think/thinking/reasoning, тег не совпал, и человек увидел ход мыслей
   как текст ответа (видно было на снимке экрана, а не в тестах). Теперь правило
   одно на поток и на обычный ответ — в engine/shape.js. */
{
  await withFetch(async () => {
    const tOpen = '<' + 'вкладка:thinking>';
    const tClose = '<' + '/вкладка:thinking>';
    globalThis.fetch = async () => {
      const rows = [
        { choices: [{ delta: { content: tOpen + 'We need to prove ' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'that sqrt(2) ' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'is irrational.' + tClose + '\nГотово: ' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'число иррационально.' }, finish_reason: 'stop' }] },
      ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'докажи, что корень из двух иррационален', chatId: 'sse12', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const reason = ev.filter((e) => e.kind === 'draft' && e.channel === 'reasoning');
    const answer = ev.filter((e) => e.kind === 'draft' && !e.channel);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    const ответ = answer.map((e) => e.text).join('');
    ok('H16: тег размышлений с чужим именем (<вкладка:thinking>) уходит в канал reasoning, а не в ответ',
      /We need to prove that sqrt\(2\) is irrational\./.test(reason.map((e) => e.text).join(''))
        && ответ.indexOf('sqrt') < 0
        && ответ.indexOf('вкладка') < 0
        && fin.payload.reply === 'Готово: число иррационально.'
        && /We need to prove/.test(fin.payload.reasoning),
      JSON.stringify({ r: reason.map((e) => e.text).join('').slice(0, 60), a: ответ.slice(0, 60), fin: fin && fin.payload.reply }));
  });

  /* Кусок может оборвать тег посреди слова: человек в этот момент не должен видеть
     ни куска тега, ни (хуже) полтекста мыслей под видом ответа. */
  await withFetch(async () => {
    globalThis.fetch = async () => {
      const rows = [
        { choices: [{ delta: { content: '<вкл' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'адка:thin' }, finish_reason: '' }] },
        { choices: [{ delta: { content: 'king>думаю' }, finish_reason: '' }] },
      ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'привет', chatId: 'sse13', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const answer = ev.filter((e) => e.kind === 'draft' && !e.channel).map((e) => e.text).join('');
    ok('H17: разорванный по кускам тег не показывается текстом — ни «<вкл», ни «адка:thin»',
      answer.indexOf('вкл') < 0 && answer.indexOf('адка') < 0, JSON.stringify(answer.slice(0, 60)));
  });
}

/* ── Тег посреди ответа и продолжение оборванного ответа ────────────────────
   Живой случай: после 40 секунд размышления в пузыре стояло `<think> We need to
   advise on architecture choice…` — модель начала вторую порцию размышлений уже
   ПОСЛЕ ответа, а разбор ждёт тег только в начале. Вторая дорога туда же: движок
   досылает оборванный по лимиту токенов ответ второй генерацией, и она снова
   начинается с `<think>`. Правило: в финальном тексте тега быть не может. */
{
  await withFetch(async () => {
    const tOpen = '<' + 'think>';
    globalThis.fetch = async () => {
      const rows = [
        { choices: [{ delta: { content: 'Ответ: монолит.' }, finish_reason: '' }] },
        { choices: [{ delta: { content: '\n' + tOpen + ' We need to advise on architecture choice' }, finish_reason: '' }] },
        { choices: [{ delta: { content: ' and weigh factors…' }, finish_reason: 'stop' }] },
      ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'что лучше: монолит или микросервисы', chatId: 'sse14', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H18: незакрытый тег размышлений посреди ответа не доходит до человека, а его текст не теряется',
      fin.payload.reply === 'Ответ: монолит.'
        && /We need to advise on architecture choice/.test(fin.payload.reasoning),
      JSON.stringify({ reply: fin.payload.reply, reasoning: (fin.payload.reasoning || '').slice(0, 60) }));
  });

  /* Продолжение — новая генерация: сигнал reset сбрасывает состояние тега, и мысли
     второй генерации уходят в канал reasoning, а не в текст ответа. */
  await withFetch(async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      const tOpen = '<' + 'think>';
      const tClose = '<' + '/think>';
      const rows = call === 1
        ? [{ choices: [{ delta: { content: 'Начало ответа' }, finish_reason: 'length' }] }]
        : [
            { choices: [{ delta: { content: tOpen + 'теперь продолжу с того места' + tClose + ', где оборвался: и закончу мысль.' }, finish_reason: '' }] },
            { choices: [{ delta: { content: ' Точка.' }, finish_reason: 'stop' }] },
          ];
      const rs = new ReadableStream({
        start(c) {
          for (const x of rows) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\n\n'));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
    };
    const res = await post({ text: 'расскажи подробно', chatId: 'sse15', showReasoning: true }, SSE);
    const { events: ev } = await drain(res);
    const answer = ev.filter((e) => e.kind === 'draft' && !e.channel).map((e) => e.text).join('');
    const fin = ev.filter((e) => e.kind === 'final').pop();
    ok('H19: продолжение оборванного ответа не выкладывает размышления текстом (сигнал reset сбрасывает разбор)',
      answer.indexOf('теперь продолжу') < 0 && answer.indexOf('Начало ответа') >= 0
        && fin.payload.reply.indexOf('<') < 0 && /и закончу мысль/.test(fin.payload.reply),
      JSON.stringify({ a: answer.slice(0, 80), reply: fin.payload.reply }));
  });
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
