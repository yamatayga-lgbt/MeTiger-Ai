/**
 * 0.177 «Картинка доходит»: рисование в потоке и честный прогресс.
 *
 * Задача владельца звучала так: картинка должна доходить до человека, а если
 * источников несколько — пусть будет видно, что агент не висит, а перебирает
 * каналы. Поэтому здесь проверяется вся дорога целиком, а не по частям:
 * модель заказывает картинку блоком ```img``` → слой картинок рисует её через
 * привязку Workers AI (без ключей и без сети) → в поток уезжают этапы «канал 1
 * из N», «канал не ответил — пробую следующий» → финальный payload несёт файл.
 *
 * Сеть не нужна: привязка AI — обычный объект, провайдер текста — заглушка.
 * Отдельно проверяется, что без потока (`accept` не стоит) всё остаётся прежним:
 * ни событий, ни новых полей, а картинка в ответе та же.
 *
 *   node test/imgstream.test.js
 */
import { onRequestPost } from '../functions/api/chat.js';
import { forgetSharedImggen } from '../engine/imggen.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 240) : '')); }
}

const SSE = 'text/event-stream';
const enc = new TextEncoder();

/* Картинка-заглушка: настоящая JPEG-подпись и достаточный вес — слой принимает
   только то, что похоже на картинку, и это правильно. */
const JPEG = (() => {
  const b = new Uint8Array(1200);
  [0xff, 0xd8, 0xff, 0xe0].forEach((v, i) => { b[i] = v; });
  for (let i = 4; i < b.length; i++) b[i] = i % 251;
  return b;
})();
const JPEG_B64 = Buffer.from(JPEG).toString('base64');

const req = (o, accept) => new Request('http://x/api/chat', {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, accept ? { accept } : {}),
  body: JSON.stringify(o),
});
const post = (o, env, accept) => onRequestPost({ request: req(o, accept), env, waitUntil: () => {} });

/** Провайдер текста: отвечает потоком и вкладывает в ответ блок картинки. */
function textStreamFetch(reply, calls) {
  return async (url, init) => {
    let body = null;
    try { body = JSON.parse(String(init && init.body)); } catch (e) { body = null; }
    if (calls) calls.push({ url: String(url), stream: !!(body && body.stream) });
    /* Куски режем по словам: человек должен видеть, что текст идёт, а картинка
       появляется позже — ровно как в живом разговоре. */
    const parts = String(reply).match(/.{1,40}/gs) || [''];
    const chunks = parts.map((t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: '' }] }) + '\n\n');
    chunks.push('data: [DONE]\n\n');
    const rs = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
    return new Response(rs, { status: 200, headers: { 'content-type': SSE } });
  };
}

/** Провайдер, который про поток не слышит: один JSON — обычная жизнь curl и бота. */
function jsonFetch(reply) {
  return async () => new Response(
    JSON.stringify({ choices: [{ message: { content: String(reply) }, finish_reason: 'stop' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function drain(res) {
  const events = [];
  const rd = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!rd) return { events, text: await res.text() };
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const r = await rd.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let cut = buf.indexOf('\n\n');
    while (cut >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const line = block.split('\n').find((x) => x.startsWith('data:'));
      if (line) { try { events.push(JSON.parse(line.slice(5).trim())); } catch (e) { /* обрыв */ } }
      cut = buf.indexOf('\n\n');
    }
  }
  return { events };
}

const withFetch = async (fn) => {
  const saved = globalThis.fetch;
  try { return await fn(); } finally { globalThis.fetch = saved; }
};

/* Привязка AI: рисует сразу, без ключей и без сети. */
const aiOk = () => ({ run: async () => ({ image: JPEG_B64 }) });
const aiBroken = () => ({ run: async () => { throw new Error('привязка недоступна в этом окружении'); } });

const ASK = 'нарисуй, пожалуйста, кота на подоконнике';
const REPLY = 'Вот кот на подоконнике.\n\n```img|котик\na red cat on a windowsill, morning light, watercolor style\n```';
const ENV_AI = { GROQ_KEYS: 'g1', RATE_LIMIT: '0', AI: aiOk() };

console.log('── K · рисование в потоке: прогресс и картинка ───');
{
  await withFetch(async () => {
    globalThis.fetch = textStreamFetch(REPLY, null);
    const res = await post({ text: ASK, chatId: 'img1' }, ENV_AI, SSE);
    const { events } = await drain(res);
    const img = events.filter((e) => e.kind === 'image');
    const drafts = events.filter((e) => e.kind === 'draft');
    const fin = events.filter((e) => e.kind === 'final').pop();

    ok('K1: этапы рисования летят отдельными событиями, а не тонут в тексте',
      img.length >= 2 && img.every((e) => e.step && typeof e.step.state === 'string'),
      JSON.stringify(img).slice(0, 200));

    ok('K2: виден заказ (start) и работающий канал — «канал N из M» без имён провайдеров',
      img.some((e) => e.step.state === 'start' && e.step.name === 'котик')
        && img.some((e) => e.step.state === 'trying' && e.step.index >= 1 && e.step.total >= 1)
        && !/gemini|odirouter|workersai|pollinations/i.test(JSON.stringify(img.map((e) => ({ s: e.step.state, i: e.step.index, t: e.step.total, n: e.step.name })))),
      JSON.stringify(img.map((e) => e.step.state)));

    ok('K3: прогресс приходит ПОСЛЕ текста и ДО финала — человек уже читает ответ, пока рисуется',
      drafts.length > 0 && events.indexOf(img[0]) > events.indexOf(drafts[drafts.length - 1])
        && events.indexOf(img[0]) < events.indexOf(fin),
      JSON.stringify({ d: drafts.length, i: events.indexOf(img[0]), f: events.indexOf(fin) }));

    ok('K4: картинка доходит — финал несёт файл, а не обещание',
      !!fin && fin.status === 200 && fin.payload.ok === true
        && Array.isArray(fin.payload.files) && fin.payload.files.length === 1
        && fin.payload.files[0].kind === 'image' && fin.payload.files[0].source === 'workersai',
      JSON.stringify(fin && fin.payload && fin.payload.files && fin.payload.files.map((f) => [f.name, f.source])));

    ok('K5: в тексте ответа не осталось служебного блока — только слова человеку',
      !!fin && !/```img/.test(String(fin.payload.reply)) && /кот/i.test(String(fin.payload.reply)),
      fin && fin.payload.reply);
  });

  /* Привязка сломалась (выключили модель, кончилась квота аккаунта) — картинка
     всё равно должна дойти следующим каналом, а отказ — быть названным. */
  /* Общий слой картинок помнит окружение изолята — в тесте окружение другое,
     поэтому на каждом заходе просим слой пересоздаться (в проде это не нужно). */
  forgetSharedImggen();
  await withFetch(async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (/generativelanguage|googleapis/.test(u)) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: JPEG_B64 } }] } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      /* текст ответа — тем же потоком, что и раньше */
      return textStreamFetch(REPLY, null)(url);
    };
    const env = { GROQ_KEYS: 'g1', RATE_LIMIT: '0', AI: aiBroken(), GEMINI_KEYS: 'gk' };
    const res = await post({ text: ASK, chatId: 'img2' }, env, SSE);
    const { events } = await drain(res);
    const img = events.filter((e) => e.kind === 'image').map((e) => e.step);
    const fin = events.filter((e) => e.kind === 'final').pop();

    ok('K6: канал не ответил — это сказано словами, а не спрятано',
      img.some((e) => e.state === 'failed' && typeof e.why === 'string' && e.why.length > 3),
      JSON.stringify(img));

    ok('K7: и после отказа работа продолжается: следующий канал нарисовал',
      !!fin && fin.payload.ok === true && (fin.payload.files || []).length === 1
        && fin.payload.files[0].source === 'gemini',
      JSON.stringify(fin && fin.payload && fin.payload.files && fin.payload.files.map((f) => f.source)));
  });

  /* Обычный путь без потока: curl, бот и дымовой тест публикации не должны
     заметить ни новых событий, ни изменившегося ответа. */
  forgetSharedImggen();
  await withFetch(async () => {
    globalThis.fetch = jsonFetch(REPLY);
    const res = await post({ text: ASK, chatId: 'img3' }, ENV_AI);
    const j = await res.json();
    ok('K8: без accept-потока — прежний JSON, картинка в нём та же, событий нет',
      j.ok === true && (j.files || []).length === 1 && j.files[0].source === 'workersai'
        && !/event-stream/.test(res.headers.get('content-type') || ''),
      JSON.stringify({ ct: res.headers.get('content-type'), files: (j.files || []).length }));
  });
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
