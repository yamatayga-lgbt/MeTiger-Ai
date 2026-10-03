/**
 * Вложения веб-чата: браузер присылает файл base64-ом, читает его тот же слой,
 * что и Telegram (engine/attach.js + docparse + voicein). Сети нет: глобальный
 * fetch подменён, поэтому проверяется решение входа, а не провайдеры.
 *
 *   node test/attachweb.test.js
 */
import { onRequestPost, onRequestGet, readAttachments } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

const b64of = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const ENV = { GROQ_KEYS: 'g1', RATE_LIMIT: '0' };
const req = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const chatBody = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });

/** Подделка: отличает расшифровку голоса от обычного запроса к модели. */
function stub(voiceText) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.indexOf('/audio/transcriptions') >= 0) {
      calls.push({ kind: 'stt', body: init && init.body });
      return new Response(JSON.stringify(voiceText === null ? { text: '' } : { text: voiceText, language: 'ru' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    let parsed = null;
    try { parsed = JSON.parse(String(init && init.body)); } catch (e) { /* не json */ }
    calls.push({ kind: 'chat', body: parsed });
    return new Response(JSON.stringify(chatBody('Прочитал и ответил.')), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}
const sent = (calls) => (calls.filter((c) => c.kind === 'chat').pop() || {}).body || {};
const userText = (calls) => {
  const m = sent(calls).messages || [];
  return String(m.length ? m[m.length - 1].content : '');
};
const withFetch = async (fn) => {
  const saved = globalThis.fetch;
  try { return await fn(); } finally { globalThis.fetch = saved; }
};

console.log('W — файл из браузера доезжает до модели прочитанным');
{
  await withFetch(async () => {
    const c = stub('');
    const res = await onRequestPost({ request: req({ text: 'сводка по файлу', attachments: [{ name: 'отчёт.txt', mime: 'text/plain', size: 40, b64: b64of('выручка,1200\nрасход,800\n') }] }), env: ENV });
    const j = await res.json();
    ok('W1: текст файла вошёл в запрос блоком с именем и описанием',
      j.ok === true && /\[Файл: отчёт\.txt · txt · \d+ симв\.\]/.test(userText(c)) && /выручка,1200/.test(userText(c)), JSON.stringify({ t: userText(c).slice(0, 90) }));
    ok('W2: подпись человека сохранена — файл не вытеснил её', /сводка по файлу/.test(userText(c)), JSON.stringify(userText(c).slice(0, 60)));
    ok('W3: человек видит, что именно прочитали', !!j.attachments && j.attachments.length === 1 && j.attachments[0].ok === true && /txt/.test(j.attachments[0].line), JSON.stringify(j.attachments));
    ok('W4: примечаний нет — читать было что', !j.attachNotes, JSON.stringify(j.attachNotes));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const res = await onRequestPost({ request: req({ text: '', attachments: [{ name: 'прайд.csv', mime: 'text/csv', size: 20, b64: b64of('a,b\n1,2\n') }] }), env: ENV });
    const j = await res.json();
    ok('W5: файл без подписи — это полноценный запрос, а не 400', res.status === 200 && j.ok === true && /прайд\.csv/.test(userText(c)), JSON.stringify({ s: res.status, t: userText(c).slice(0, 60) }));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const res = await onRequestPost({ request: req({ text: 'глянь', attachments: [{ name: 'мусор.bin', mime: 'application/octet-stream', size: 12, b64: 'это не base64 !!!' }] }), env: ENV });
    const j = await res.json();
    ok('W6: кривой base64 — причина в ответе, а запрос живёт на словах человека',
      res.status === 200 && /не распознано/.test((j.attachNotes || []).join(' ')) && /глянь/.test(userText(c)) && /мусор\.bin/.test(userText(c)), JSON.stringify({ s: res.status, n: j.attachNotes, t: userText(c).slice(0, 60) }).slice(0, 220));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const res = await onRequestPost({ request: req({ text: '', attachments: [{ name: 'мусор.bin', b64: '!!!' }] }), env: ENV });
    ok('W7: ход без слов и без читаемого — 422 с причиной, а не пустой запрос к модели', res.status === 422 && c.length === 0, String(res.status));
    const empty = await onRequestPost({ request: req({ text: '   ' }), env: ENV });
    ok('W8: пустой запрос без вложений — по-прежнему 400 словом', empty.status === 400 && /пустой запрос/.test((await empty.json()).error || ''), String(empty.status));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const n = 5 * 1024 * 1024;
    const bytes = new Uint8Array(n);
    let bin = '';
    for (let i = 0; i < n; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    const res = await onRequestPost({ request: req({ text: 'прочитай', attachments: [{ name: 'тяжёлый.pdf', mime: 'application/pdf', size: n, b64: btoa(bin) }] }), env: ENV });
    const j = await res.json();
    ok('W9: файл через потолок не читается и отказ назван мегабайтами',
      res.status === 200 && /5 МБ|4 МБ/.test((j.attachNotes || []).join(' ')) && !/\[Файл: тяжёлый/.test(userText(c)), JSON.stringify(j.attachNotes));
    ok('W10: и подпись человека при этом доходит — запрос не теряется', /прочитай/.test(userText(c)), JSON.stringify(userText(c).slice(0, 60)));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const many = Array.from({ length: 5 }, (_, i) => ({ name: 'ф' + i + '.txt', mime: 'text/plain', size: 6, b64: b64of('x' + i) }));
    await onRequestPost({ request: req({ text: 'сравни', attachments: many }), env: ENV });
    const txt = userText(c);
    ok('W11: больше трёх файлов — читаем три, лишнее названо', (txt.match(/\[Файл:/g) || []).length === 3 && /файлов 5|лишних/.test(txt), JSON.stringify(txt).slice(0, 140));
  });
}
{
  await withFetch(async () => {
    const c = stub('Привет, это кот');
    const res = await onRequestPost({ request: req({ text: 'и что тут?', attachments: [{ name: 'voiced.ogg', mime: 'audio/ogg', size: 2048, b64: b64of('O'.repeat(1200)) }] }), env: ENV });
    const j = await res.json();
    ok('W12: голосовое из браузера расшифровывается и помечается в тексте',
      j.ok === true && /\[Голосом: Привет, это кот\]/.test(userText(c)) && /и что тут\?/.test(userText(c)), JSON.stringify({ t: userText(c).slice(0, 80), e: j.error }));
    ok('W13: к Groq за расшифровкой сходили ровно один раз', c.filter((x) => x.kind === 'stt').length === 1, JSON.stringify(c.map((x) => x.kind)));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const res = await onRequestPost({ request: req({ text: 'послушай', attachments: [{ name: 'a.ogg', mime: 'audio/ogg', size: 900, b64: b64of('O'.repeat(600)) }] }), env: Object.assign({}, ENV, { STT: 'off' }) });
    const j = await res.json();
    ok('W14: STT=off — голос не слушаем и говорим это прямо',
      /выключено|слоя STT нет/.test((j.attachNotes || []).join(' ')) && /послушай/.test(userText(c)), JSON.stringify({ n: j.attachNotes, t: userText(c).slice(0, 40) }));
    const before = c.length;
    const pic = await onRequestPost({ request: req({ text: 'что на картинке', attachments: [{ name: 'кот.png', mime: 'image/png', size: 12, b64: b64of('\u0089PNG\r\n\u001axx') }] }), env: ENV });
    const pj = await pic.json();
    ok('W15: картинка, присланная как файл, уходит зрению, а не читалке документов',
      pj.ok === true && JSON.stringify(sent(c)).indexOf('data:image/png;base64,') >= 0 && c.length > before, JSON.stringify(sent(c)).slice(-200));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const doc = { name: 'длинный.txt', mime: 'text/plain', size: 90000, b64: b64of('строка данных '.repeat(6000)) };
    const res = await onRequestPost({ request: req({ text: 'резюме', attachments: [doc] }), env: Object.assign({}, ENV, { ATTACH_DOC_CHARS: '3000' }) });
    const j = await res.json();
    ok('W16: потолок знаков файла из env работает и помечен в описании',
      j.ok === true && /дальше файл не показываем/.test(userText(c)), JSON.stringify(j.attachments).slice(0, 160));
    const def = await onRequestPost({ request: req({ text: 'резюме', attachments: [{ name: 'д.txt', mime: 'text/plain', size: 60000, b64: b64of('абвгд '.repeat(6000)) }] }), env: ENV });
    const dj = await def.json();
    ok('W17: без перебивки действует дефолт — 24000 знаков на файл',
      dj.ok === true && userText(c).length <= 24100 && /абвгд/.test(userText(c)), String(userText(c).length));
  });
}
{
  await withFetch(async () => {
    stub('');
    const g = await onRequestGet({ env: ENV });
    const j = await g.json();
    ok('W18: GET /api/chat показывает лимиты вложений и чем читаем голос',
      typeof j.attach === 'string' && /до 3 файлов по 4 МБ/.test(j.attach) && /whisper/.test(j.attach), JSON.stringify(j.attach));
    const off = await onRequestGet({ env: Object.assign({}, ENV, { ATTACH: 'off', STT: 'off' }) });
    const oj = await off.json();
    ok('W19: и выключенное состояние видно той же строкой', /ATTACH=off/.test(oj.attach) && /STT=off/.test(oj.attach), JSON.stringify(oj.attach));
  });
}
{
  await withFetch(async () => {
    const c = stub('');
    const hist = Array.from({ length: 6 }, (_, i) => ({ role: 'user', text: 'реплика ' + i + ' ' + 'много текста '.repeat(600) }));
    const res = await onRequestPost({
      request: req({ text: 'итого по файлу', history: hist, attachments: [{ name: 'x.txt', mime: 'text/plain', size: 20, b64: b64of('важные цифры') }] }),
      env: Object.assign({}, ENV, { CTX_WINDOW: '1500', CTX_MAX_OUT: '400' }),
    });
    const j = await res.json();
    ok('W20: файл и история вместе не ломают окно — резка считает по собранному тексту',
      j.ok === true && (sent(c).messages || []).length < hist.length + 2 && /окно модели/.test(String(j.ctxFit || '')), JSON.stringify({ n: (sent(c).messages || []).length, fit: String(j.ctxFit || '').slice(0, 60) }));
    ok('W21: и блок файла при этом остался в запросе', /\[Файл: x\.txt/.test(userText(c)), JSON.stringify(userText(c).slice(0, 60)));
  });
}

console.log('\nW22 — советы голов не слепые: блок файла виден и им');
{
  await withFetch(async () => {
    /* без второго провайдера голова неLive, и совет честно промолчит — поэтому тут
       два ключа: именно так heads и вызываются на проде */
    const env2 = Object.assign({}, ENV, { OPENROUTER_KEYS: 'o1' });
    const c = stub('');
    const res = await onRequestPost({
      request: req({ text: 'посчитай 1200 + 800 по этому файлу и скажи, что там ещё', attachments: [{ name: 'бюджет.csv', mime: 'text/csv', size: 30, b64: b64of('а,1200\nб,800\n') }] }),
      env: env2,
    });
    const j = await res.json();
    const chats = c.filter((x) => x.kind === 'chat');
    const withFile = chats.filter((x) => JSON.stringify(x.body).indexOf('бюджет.csv') >= 0);
    ok('W22: голова совета получает тот же запрос с блоком файла, а не голый пересказ',
      res.status === 200 && j.ok === true && chats.length >= 2 && withFile.length === chats.length,
      JSON.stringify({ calls: chats.length, withFile: withFile.length, ens: String(j.ensemble || j.ensembleSkip || 'нет').slice(0, 80) }).slice(0, 240));
  });
}

/* Признак картинки на входе. Проверается сам `readAttachments`, а не модель за ним:
   ломалось именно решение «картинка это или документ», и молча. */
{
  const b64bytes = (arr) => btoa(String.fromCharCode.apply(null, Array.from(arr)));
  const pngBytes = b64bytes([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10].concat(Array.from(new TextEncoder().encode('данные'))));
  const txt = b64of('обычный текст, а не картинка вовсе');
  const run = async (att) => readAttachments([att], { ATTACH_DOC_CHARS: 0 }, async () => { throw new Error('сети нет'); }, () => {});
  const a = await run({ name: 'IMG_1.HEIC', mime: '', size: 40, b64: pngBytes });
  ok('W23: картинка без MIME, но с сигнатурой png уходит зрению, а не в читалку документов',
    a.images.length === 1 && /^data:image\/png;base64,/.test(a.images[0]) && !a.docs.length,
    JSON.stringify({ i: a.images.length, d: a.docs.length, n: a.notes }));
  const b = await run({ name: 'кот.png', mime: 'application/octet-stream', size: 40, b64: txt });
  ok('W24: имя «png», а внутри текст — говорим «не похоже на картинку», не кормим ни зрение, ни парсер',
    !b.images.length && /не похоже на картинку/.test(b.notes.join(' ')), JSON.stringify(b.notes));
  const c = await run({ name: 'IMG_9.HEIC', mime: 'image/heic', size: 40, b64: pngBytes });
  ok('W25: HEIC не уезжает в документы и не притворяется jpeg — есть отдельная подсказка',
    !c.images.length && !c.docs.length && /HEIC/.test(c.notes.join(' ')) && /JPEG/.test(c.notes.join(' ')),
    JSON.stringify(c.notes));
  const d = await run({ name: 'doc.txt', mime: 'text/plain', size: 40, b64: txt });
  ok('W26: обычный текст по-прежнему читается как документ (картиночное правило его не сожрало)',
    !d.images.length && d.docs.length === 1 && d.docs[0].ok === true, JSON.stringify(d.docs.map((x) => x.ok)));
  ok('W27: правило имени общее со слоем Telegram — IMAGE_NAME импортирован, а не переписан',
    (await import('../engine/attach.js')).IMAGE_NAME.test('x.heic') === true, 'IMAGE_NAME');
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
