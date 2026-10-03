/**
 * Стриминг: SSE от провайдера → куски текста в onDelta, и тот же разбор, что у обычного ответа.
 *
 * Зачем отдельная проверка: поток идёт мимо res.json(), а значит мимо привычной
 * нормализации. Меряется то, что глазами не увидеть: собранный из кусков текст проходит
 * обычный req.parse (think-теги, reasoning, error), провайдер без stream не ломает путь,
 * а оборванный поток не превращается в выдуманный ответ.
 *
 *   node test/stream.test.js
 */
import { buildRequest, streamCall } from '../engine/shape.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const OPENAI = { id: 'groq', kind: 'openai', base: 'https://api.example/v1', keys: ['k1'] };
const GEMINI = { id: 'gemini', kind: 'gemini', base: 'https://gen.example/v1beta', keys: ['k1'] };
const msgs = [{ role: 'user', content: 'скажи два' }];
/* Теги рассуждения собираются, чтобы их текст не резался об этот же файл. */
const T_ON = '<' + 'th' + 'ink' + '>';
const T_OFF = '<' + '/' + 'th' + 'ink' + '>';
const NL = String.fromCharCode(10);

function streamReader(parts) {
  let i = 0;
  return {
    read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true, value: undefined }),
    cancel: async () => {},
    releaseLock: () => {},
  };
}
const enc = new TextEncoder();
/** Ответ провайдера: поток из кусков (или json, если поток он не понёс). */
function resp(parts, status = 200, type = 'text/event-stream; charset=utf-8') {
  return {
    status,
    headers: new Headers({ 'content-type': type }),
    body: { getReader: () => streamReader(parts.map((p) => enc.encode(p))) },
    text: async () => parts.join(''),
  };
}
const sse = (obj) => 'data: ' + JSON.stringify(obj) + NL + NL;
const delta = (content, extra) => sse({ choices: [{ delta: Object.assign({ content }, extra || {}) }] });

console.log('── S · запрос: что уходит провайдеру ───');
{
  const req = buildRequest({ cfg: OPENAI, keyIdx: 0, model: 'm1', messages: msgs, system: 'с', tier: 'fast', stream: true });
  ok('S1: stream:true в теле, и есть читалка дельт с упаковкой',
    req.body.stream === true && typeof req.sse === 'function' && typeof req.wrap === 'function',
    JSON.stringify({ stream: req.body.stream, sse: typeof req.sse }));
  const plain = buildRequest({ cfg: OPENAI, keyIdx: 0, model: 'm1', messages: msgs, system: 'с', tier: 'fast' });
  ok('S2: без запроса потока тело прежнее — режим по умолчанию не изменился',
    plain.body.stream === undefined && plain.sse === undefined && typeof plain.parse === 'function');
  const g = buildRequest({ cfg: GEMINI, keyIdx: 0, model: 'g1', messages: msgs, system: 'с', tier: 'fast', stream: true });
  ok('S3: у gemini поток — streamGenerateContent с alt=sse (иначе это один большой json)',
    /:streamGenerateContent\?alt=sse&key=/.test(g.url) && typeof g.sse === 'function', g.url.slice(0, 78));
}

console.log('── S · сборка ответа из кусков ───');
{
  const req = buildRequest({ cfg: OPENAI, keyIdx: 0, model: 'm1', messages: msgs, system: 'с', tier: 'fast', stream: true });
  const got = [];
  const res = await streamCall(async () => resp([
    delta('Раз,'),
    'data: это не json' + NL + NL,
    delta(NL + T_ON + 'секрет' + T_OFF + NL + ' два', { reasoning_content: 'думаю' }),
    'data: [DONE]' + NL + NL,
  ]), req, 5000, (t) => got.push(t));
  const parsed = req.parse(res.data);
  ok('S4: куски доходят до onDelta сырыми и в порядке прихода (обрезать — дело parse, не потока)',
    got.length === 2 && got[0] === 'Раз,' && got[1].indexOf(T_ON) >= 0, JSON.stringify(got));
  ok('S5: собранный текст проходит обычный parse: рассуждение уехало в reasoning, reply чист',
    parsed.reasoning === 'думаю' && parsed.reply.indexOf('секрет') < 0
      && parsed.reply.indexOf('Раз,') === 0 && /два$/.test(parsed.reply.trim()), JSON.stringify(parsed).slice(0, 140));
  ok('S6: битая строка — статистика bad, а не провайдерская ошибка',
    res.streamed === true && res.bad === 1 && !parsed.error, JSON.stringify({ streamed: res.streamed, bad: res.bad }));
  ok('S7: finish_reason из потока доезжает (на него решаем, продолжать ли оборванный ответ)',
    'finish' in parsed && res.chunks === 2, JSON.stringify({ finish: parsed.finish, chunks: res.chunks }));

  const fast = await streamCall(async () => resp([]), req, 4000);
  ok('S8: пустой поток — это ошибка, а не «модель ответила пустотой»',
    !fast.data && !!fast.error, JSON.stringify(fast).slice(0, 110));
}

console.log('── S · когда потока нет и когда он рвётся ───');
{
  const req = buildRequest({ cfg: OPENAI, keyIdx: 0, model: 'm1', messages: msgs, system: 'с', tier: 'fast', stream: true });
  const r1 = await streamCall(async () => resp(['{"choices":[{"message":{"content":"целиком"}}]}'], 200, 'application/json'), req, 4000);
  ok('S9: провайдер проигнорировал stream:true — молча обычный путь, ответ тот же',
    r1.streamed === false && req.parse(r1.data).reply === 'целиком', JSON.stringify(r1).slice(0, 110));

  const r2 = await streamCall(async () => resp(['data:boom' + NL + NL], 429), req, 4000);
  ok('S10: 4xx читается как ответ, а не как поток: статус сохранён, лимитер увидит 429',
    r2.status === 429 && r2.streamed === false, JSON.stringify({ s: r2.status, st: r2.streamed }));

  /* Поток обрывается по таймауту: с текстом — считаем его, без текста — это ошибка. */
  const hang = {
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: () => new Promise((_r, rj) => setTimeout(() => rj(Object.assign(new Error('aborted'), { name: 'AbortError' })), 20)),
        cancel: async () => {}, releaseLock: () => {},
      }),
    },
    text: async () => '',
  };
  const r3 = await streamCall(async () => hang, req, 2000);
  ok('S11: оборванный без текста поток — ошибка, а не пустой «успех»',
    !!r3.error && !r3.data, JSON.stringify(r3).slice(0, 130));

  const r4 = await streamCall(async () => resp([delta('половина ответа'), sse({ error: { message: 'поток закрыт на середине' } })]), req, 4000);
  ok('S12: ошибка в хвосте названа, а уже собранный текст не выброшен',
    /поток закрыт/.test(r4.streamError || '') && req.parse(r4.data).reply === 'половина ответа',
    JSON.stringify({ e: r4.streamError, r: req.parse(r4.data).reply }).slice(0, 130));

  /* Deadline у потока общий с обычным запросом: иначе медленный шлюз, который отдаёт
     по букве в секунду, держал бы изолят до бесконечности. Проверка заодно доказывает,
     что abort долетает до читалки тела, а не остаётся на fetch. */
  const hangResp = (signal) => ({
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: () => {
        let n = 0;
        return {
          read: () => new Promise((resolve, reject) => {
            if (n++ === 0) { resolve({ done: false, value: enc.encode(delta('х')) }); return; }
            const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (signal && signal.aborted) { onAbort(); return; }
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
          }),
          cancel: async () => {}, releaseLock: () => {},
        };
      },
    },
    text: async () => '',
  });
  const t0 = Date.now();
  const r5 = await streamCall(async (_u, init) => hangResp(init && init.signal), req, 400);
  const dt = Date.now() - t0;
  ok('S13: висячий поток обрывается по нашему потолку и несёт то, что уже пришло',
    dt < 3000 && req.parse(r5.data).reply === 'х', JSON.stringify({ dt, err: r5.error || '', st: r5.streamed }));
}

console.log('── S · рассуждения идут отдельным каналом ───');
{
  const req = buildRequest({ cfg: OPENAI, keyIdx: 0, model: 'm1', messages: msgs, system: 'с', tier: 'fast', stream: true });
  const parts = [
    delta('', { reasoning_content: 'Считаю ' }),
    delta('', { reasoning_content: 'в уме' }),
    delta('два'),
  ];
  const text = [], reason = [];
  const r = await streamCall(async () => resp(parts), req, 5000, (t) => text.push(t), (t) => reason.push(t));
  const parsed = req.parse(r.data);
  ok('S14: куски рассуждений уходят в onReasoning и ни буквой не попадают в ответ',
    reason.join('') === 'Считаю в уме' && text.join('') === 'два' && r.chunks === 1,
    JSON.stringify({ text, reason, chunks: r.chunks }));
  ok('S15: собранный ответ несёт то же reasoning, что и обычный путь (wrap + тот же parse)',
    parsed.reply === 'два' && parsed.reasoning === 'Считаю в уме', JSON.stringify(parsed));
  const r2 = await streamCall(async () => resp(parts), req, 5000, () => {});
  ok('S16: без слушателя рассуждений поток не падает и ответ не меняется',
    r2.chunks === 1 && req.parse(r2.data).reply === 'два', JSON.stringify({ st: r2.status, ch: r2.chunks }));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
