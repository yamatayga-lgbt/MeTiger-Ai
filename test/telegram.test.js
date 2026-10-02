/**
 * Telegram-сторона (engine/telegram.js + functions/telegram/webhook.js).
 * Сети нет: ask подменяется фиктивным ответом движка, отправка — шпионом.
 * Последний блок всё же идёт через настоящий onRequestPost вебхука, чтобы
 * проверить склейку «вебхук → /api/chat → движок», но глобальный fetch там
 * подменён, и Telegram не дёргается.
 *
 * Запуск: node test/telegram.test.js
 */
import {
  parseUpdate, shouldRespond, hasMention, memoryChatId, commandReply,
  chunkText, metaLine, handleUpdate, telegramPoster, secretOk,
} from '../engine/telegram.js';
import { onRequestPost as webhookPost, onRequestGet as webhookGet } from '../functions/telegram/webhook.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const priv = (text, id) => ({ message: { chat: { id: id || 1, type: 'private' }, from: { id: id || 1, first_name: 'Тигр' }, text, message_id: 5 } });
const group = (text, extra) => ({ message: Object.assign({ chat: { id: -100, type: 'supergroup' }, from: { id: 7 }, text, message_id: 9 }, extra || {}) });
const json = (o) => ({ status: 200, json: async () => o });

console.log('A — разбор апдейта и адрес памяти');
{
  const p = parseUpdate(priv('привет'));
  ok('A1: приватное сообщение распознано', p.kind === 'message' && p.isPrivate && p.text === 'привет', JSON.stringify({ k: p.kind, t: p.text }));
  ok('A2: память бота привязана к беседе, а не к «web»', memoryChatId(p.chat) === 'tg_1', memoryChatId(p.chat));
  ok('A3: групповой id тоже свой (разговор в группе один на всех)',
    memoryChatId(parseUpdate(group('а')).chat) === 'tg_-100', memoryChatId(parseUpdate(group('а')).chat));
  ok('A4: подпись к фото считается текстом запроса',
    parseUpdate({ message: { chat: { id: 1, type: 'private' }, caption: 'что на фото', photo: [{ file_id: 'x' }] } }).text === 'что на фото');
  ok('A5: чужие типы апдейтов не рассылаются',
    parseUpdate({ callback_query: { id: 'x' } }).kind === 'callback' && parseUpdate({}).kind === 'other');
}

console.log('B — когда молчать, а когда отвечать');
{
  ok('B1: в личке отвечаем на любое сообщение', shouldRespond(parseUpdate(priv('ну как там')), 'Metigerai_bot'));
  const g = parseUpdate(group('обсуждаем weather'));
  ok('B2: в группе без обращения молчим', !shouldRespond(g, 'Metigerai_bot'));
  ok('B3: упоминание текстом — это обращение',
    shouldRespond(parseUpdate(group('а что скажешь, @Metigerai_bot?')), 'Metigerai_bot'));
  ok('B4: mention-сущность тоже считается',
    hasMention(parseUpdate(group('x', { entities: [{ type: 'mention', offset: 0, length: 13, text: '@Metigerai_bot' }] })), 'Metigerai_bot'));
  ok('B5: похожий username не считается обращением (@Metigerai_botanik — не про нас)',
    !hasMention(parseUpdate(group('привет @Metigerai_botanik')), 'Metigerai_bot'));
  ok('B6: ответ на сообщение бота — обращение',
    shouldRespond(parseUpdate(group('а подробнее?', { reply_to_message: { from: { id: 1, is_bot: true } } })), 'Metigerai_bot'));
  ok('B7: правку своего сообщения не переигрываем заново',
    !shouldRespond(parseUpdate({ edited_message: { chat: { id: 1, type: 'private' }, text: 'исправил' } }), 'Metigerai_bot'));
}

console.log('C — команды');
{
  const start = commandReply(parseUpdate(priv('/start')), {});
  ok('C1: /start знакомит и перечисляет команды', !!start && /забываю/i.test(start) && /\/id/.test(start), String(start).slice(0, 40));
  ok('C2: /help честно говорит, чего бот пока не умеет', /не умею/i.test(commandReply(parseUpdate(priv('/help')), {})));
  ok('C3: /id показывает и чат, и ключ памяти', /tg_1$/.test(commandReply(parseUpdate(priv('/id')), {}).trim()), commandReply(parseUpdate(priv('/id')), {}));
  ok('C4: /forget — не текст, а служебный знак', commandReply(parseUpdate(priv('/forget')), {}) === '__forget__');
  ok('C5: команда чужого бота не наша, отдаём движку',
    commandReply(parseUpdate(priv('/начать @otherbot')), {}) === null);
  ok('C6: ordinary текст — не команда', commandReply(parseUpdate(priv('сколько будет 2+2')), {}) === null);
}

console.log('D — разбивка: предел 4096 и неразбитые эмодзи');
{
  ok('D1: короткий текст — одним куском', chunkText('привет').length === 1);
  const long = 'строка слов. '.repeat(900);
  const parts = chunkText(long);
  ok('D2: длинный текст разбит', parts.length > 1, String(parts.length));
  ok('D3: ни один кусок не больше лимита', parts.every((p) => p.length <= 3900), String(Math.max(...parts.map((x) => x.length))));
  ok('D4: ничего не потеряно и не продублировано',
    parts.join(' ').replace(/\s+/g, ' ').trim() === long.replace(/\s+/g, ' ').trim(),
    parts.join('').length + ' против ' + long.length);
  const oneWord = 'я'.repeat(5000);
  const w = chunkText(oneWord);
  ok('D5: слово длиннее лимита режется, а не выбрасывается', w.join('').length === 5000, JSON.stringify(w.map((x) => x.length)));
  const emoParts = chunkText(('волк 🐺 и ещё много слов для длины. '.repeat(140)) + 'финал 🐺');
  ok('D6: эмодзи не разрезан пополам (ни один кусок не кончается старшим суррогатом)',
    emoParts.every((x) => !/[\uD800-\uDBFF]$/.test(x)), JSON.stringify(emoParts.map((x) => x.slice(-2))));
  ok('D7: пустое и пробельное — ноль кусков, а не кусок-пустышка', chunkText('').length === 0 && chunkText('\n\n  \n').length === 0);
  ok('D8: абзацы не склеиваются в кашу', chunkText('раз\n\nдва\n\nтри').length === 1 && chunkText('раз\n\nдва').join('|') === 'раз\n\nдва');
}

console.log('E — транспорт и секрет');
{
  ok('E1: без секрета вебхук не принимается (иначе любой гоняет бота за наш счёт)',
    !secretOk(null, {}).ok && !secretOk('чужой', { TELEGRAM_WEBHOOK_SECRET: 'a' }).ok);
  ok('E2: верный секрет проходит', secretOk('a', { TELEGRAM_WEBHOOK_SECRET: 'a' }).ok);
  const calls = [];
  const post = telegramPoster({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_API_BASE: 'http://base' }, async (u, i) => { calls.push({ u, body: i.body }); return { status: 200, text: async () => '{}' }; });
  await post('sendMessage', { chat_id: 1, text: 'x' });
  ok('E3: адрес строится как base/bot<token>/<метод>', calls[0].u === 'http://base/bottok/sendMessage', calls[0].u);
  let threw = '';
  try { await telegramPoster({}, async () => ({ status: 200, text: async () => '{}' }))('sendMessage', {}); } catch (e) { threw = e.message; }
  ok('E4: без токена не молчит, а объясняет', /TELEGRAM_BOT_TOKEN/.test(threw), threw);
}

console.log('F — поведение ответа: что увидит человек');
{
  /* Шпион считает только sendMessage: sendChatAction — служебный вызов, и путать
     его с ответом нельзя (первая версия теста ровно на этом и съехала индексами). */
  const spy = () => { const posts = [], texts = []; return { posts, texts, post: async (m, p) => { posts.push({ m, p }); if (m === 'sendMessage') texts.push(p.text || ''); return { status: 200 }; } }; };

  const s1 = spy(); const asked = [];
  const r1 = await handleUpdate({
    update: priv('меня зовут Тигр'),
    env: { TELEGRAM_TYPING: '1' },
    ask: async (pl) => { asked.push(pl); return json({ ok: true, reply: 'Приятно познакомиться, Тигр.', provider: 'groq', model: 'qwen/qwen3.8-27b', ms: 430, ensemble: 'сошлись 2/2 (author,openrouter)', memory: { on: true, messages: 2, facts: 1 } }); },
    post: s1.post,
  });
  ok('F1: ответ отправлен в тот же чат', s1.texts.length === 1 && /Тигр/.test(s1.texts[0]) && s1.posts[0].p.chat_id === 1, JSON.stringify(s1.posts[0]));
  ok('F2: движку переданы текст и ключ памяти, а истории нет — её берёт память',
    asked[0].text === 'меня зовут Тигр' && asked[0].chatId === 'tg_1' && asked[0].history === undefined, JSON.stringify(asked[0]));
  ok('F3: сначала «печатает», потом ответ', s1.posts[0].m === 'sendChatAction' && s1.posts[1].m === 'sendMessage', s1.posts.map((x) => x.m).join(','));
  ok('F4: служебной строки про модель по умолчанию нет', !/qwen/.test(s1.texts[0]), s1.texts[0]);
  ok('F5: ответ — реплай на реплику человека (в большой группе непутано)', s1.posts[1].p.reply_to_message_id === 5, JSON.stringify(s1.posts[1].p));

  const s2 = spy();
  await handleUpdate({
    update: priv('привет'), env: { TELEGRAM_META: '1', TELEGRAM_TYPING: '0' },
    ask: async () => json({ ok: true, reply: 'Привет!', provider: 'groq', model: 'qwen/qwen3.8-27b', ms: 430, memory: { on: true, messages: 2, facts: 1 } }),
    post: s2.post,
  });
  ok('F6: с TELEGRAM_META=1 видно, кто ответил и на чём память',
    /groq\/qwen/.test(s2.texts[0]) && /память: 2 репл/.test(s2.texts[0]), s2.texts[0]);
  ok('F7: META не съедает текст человека — он остаётся первым', s2.texts[0].indexOf('Привет!') === 0, s2.texts[0]);
  ok('F8: TELEGRAM_TYPING=0 убирает лишний вызов API', s2.posts.length === 1, s2.posts.map((x) => x.m).join(','));

  const s3 = spy();
  await handleUpdate({
    update: priv('считай'), env: {},
    ask: async () => json({ ok: false, error: 'нет живых ключей ни у одного провайдера', tried: [{ provider: 'groq', why: 'ключи исчерпаны' }] }),
    post: s3.post,
  });
  ok('F9: движковая ошибка доходит словами, а не тишиной', /нет живых ключей/.test(s3.texts[0]), JSON.stringify(s3.texts));

  const s4 = spy();
  await handleUpdate({
    update: priv('а теперь?'), env: {},
    ask: async () => json({ ok: true, tried: [{ provider: 'groq' }, { provider: 'zai' }] }),
    post: s4.post,
  });
  ok('F10: пустой ответ = «модели молчат» с числом попыток', /молчат/.test(s4.texts[0]) && /2 попыток/.test(s4.texts[0]), JSON.stringify(s4.texts));

  const s5 = spy(); let askedTimes = 0;
  await handleUpdate({
    update: priv('длинный вопрос'), env: { TELEGRAM_TYPING: '0' },
    ask: async () => { askedTimes++; return json({ ok: true, reply: 'абзац. '.repeat(1200) }); },
    post: s5.post,
  });
  ok('F11: длинный ответ уходит несколькими сообщениями, движок спрошен один раз',
    s5.texts.length > 1 && askedTimes === 1, s5.texts.length + ' частей, ' + askedTimes + ' запрос(ов)');
  ok('F12: части идут по порядку, первая начинается с начала ответа',
    s5.texts[0].indexOf('абзац') === 0 && s5.texts.join(' ').split('абзац').length - 1 > 100, String(s5.texts.length));

  const s6 = spy(); const askCalls6 = [];
  await handleUpdate({
    update: priv('/forget'), env: { TELEGRAM_TYPING: '0' },
    ask: async (pl) => { askCalls6.push(pl); return json({ ok: true, forgotten: true, chatId: 'tg_1', reply: 'Готово, этот чат вычищен.' }); },
    post: s6.post,
  });
  ok('F13: /forget идёт движку с флагом forget, а не как вопрос',
    askCalls6[0].forget === true && askCalls6[0].chatId === 'tg_1', JSON.stringify(askCalls6[0]));
  ok('F14: и не ловит 400 «пустой запрос» — текст-заглушка приложена',
    askCalls6[0].text === '/forget', JSON.stringify(askCalls6[0]));
  ok('F15: человек получает подтверждение, а не тишину', /вычищен/.test(s6.texts[0]), JSON.stringify(s6.texts));

  const s7 = spy(); let asked7 = 0;
  await handleUpdate({
    update: { message: { chat: { id: 1, type: 'private' }, voice: { file_id: 'v' }, message_id: 3 } },
    env: { TELEGRAM_TYPING: '0' },
    ask: async () => { asked7++; return json({ ok: true, reply: 'не должно произойти' }); },
    post: s7.post,
  });
  ok('F16: голосовое — вежливый отказ и НИ одного запроса к моделям (квота не горит)',
    asked7 === 0 && s7.texts.length === 1 && /голос/i.test(s7.texts[0]), JSON.stringify({ asked7, texts: s7.texts }));

  const s8 = spy(); let asked8 = 0;
  await handleUpdate({
    update: { message: { chat: { id: 1, type: 'private' }, photo: [{ file_id: 'p' }], message_id: 3 } },
    env: { TELEGRAM_TYPING: '0' },
    ask: async () => { asked8++; return json({ ok: true, reply: 'x' }); },
    post: s8.post,
  });
  ok('F17: фото без подписи — тоже честный «ещё не подключено», а не пустой ответ',
    asked8 === 0 && /не видит|не подключена/i.test(s8.texts[0]), JSON.stringify(s8.texts));

  const r2 = await handleUpdate({ update: group('молчи'), env: {}, ask: async () => { throw new Error('не должен вызываться'); }, post: async () => ({ status: 200 }) });
  ok('F18: проигнорированное сообщение не дёргает движок', r2.answered === false && /группа/.test(r2.ignored), r2.ignored);

  const s9 = spy();
  const r3 = await handleUpdate({ update: { message: { chat: { id: 1, type: 'private' }, text: '/start', message_id: 1 } }, env: { TELEGRAM_TYPING: '0' }, ask: async () => { throw new Error('команда не должна доходить до моделей'); }, post: s9.post });
  ok('F19: команда отвечается на месте, до моделей не идёт', r3.answered === true && s9.texts.length === 1 && /\/id/.test(s9.texts[0]), JSON.stringify(s9.texts));
}

console.log('G — служебная строка');
{
  const m = metaLine({ provider: 'groq', model: 'x', ensemble: 'разошлись 1/2 (openrouter)', ms: 1234, memory: { on: true, messages: 6, facts: 2 } });
  ok('G1: в META входит вердикт совета и задержка', /разошлись 1\/2/.test(m) && /1,2 с|1.2 с/.test(m) && /память: 6/.test(m), m);
  ok('G2: пустой ответ — пустая строка, а не «undefined»', metaLine({}) === '' && metaLine(null) === '');
}

console.log('H — вебхук Pages: настоящая склейка (fetch подменён)');
{
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: init && init.body ? String(init.body) : '' });
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const env = {
    TELEGRAM_BOT_TOKEN: 'faketok', TELEGRAM_WEBHOOK_SECRET: 's3cr3t', TELEGRAM_TYPING: '0',
    /* ключей нет намеренно: проверяем, что запрос доходит до движка и человек
       получает внятное «модели молчат», а не тихую 500-ку в логе Telegram */
  };
  const ctx = (text, headers) => ({
    request: new Request('https://p.pages.dev/telegram/webhook', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 's3cr3t' }, headers || {}),
      body: JSON.stringify({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text, message_id: 1 } }),
    }),
    env, waitUntil: () => {},
  });
  const r = await webhookPost(ctx('привет, это через настоящий вход'));
  const out = await r.json();
  ok('H1: вебхук вернул 200 (Telegram не должен повторять доставку)', r.status === 200, String(r.status));
  ok('H2: в Telegram ушёл sendMessage с внятным текстом, а не JSON и не undefined',
    seen.some((x) => /sendMessage/.test(x.url) && /ни один провайдер не ответил|молчат|ключей/i.test(x.body))
      && !/undefined/.test(seen.map((x) => x.body).join('')), JSON.stringify(seen.map((x) => x.body).slice(0, 1)));
  ok('H3: ключ памяти построился из телеграм-чата', seen.some((x) => /tg_42/.test(x.body)) || out.answered === true, JSON.stringify(out));

  const r2 = await webhookPost(ctx('привет', { 'x-telegram-bot-api-secret-token': 'wrong-secret' }));
  ok('H4: неверный секрет — 403 и ни одной отправки', r2.status === 403, String(r2.status));

  const r3 = await webhookPost({
    request: new Request('https://p.pages.dev/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 's3cr3t' }, body: 'this is not json' }),
    env, waitUntil: () => {},
  });
  ok('H5: битое тело — 400, а не падение (Telegram вернул бы 500 и повторил доставку)', r3.status === 400, String(r3.status));

  const g = await webhookGet({ env, request: new Request('https://p.pages.dev/telegram/webhook'), waitUntil: () => {} });
  const gj = await g.json();
  ok('H6: GET показывает, чего не хватает, не раскрывая значений',
    gj.secret === 'задан' && /MEMORY/.test(gj.memory) && !JSON.stringify(gj).includes('faketok'), JSON.stringify(gj));
  globalThis.fetch = real;
}

console.log('I — настройка рода в боте (/род)');
{
  const mk = () => { const asked = [], texts = []; return {
    asked, texts,
    post: async (m, p) => { if (m === 'sendMessage') texts.push(p.text || ''); return { status: 200 }; },
    ask: async (payload) => { asked.push(payload); return json({ ok: true, reply: 'ок' }); },
  }; };
  const store = new Map();
  const prefs = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };

  const a = mk();
  await handleUpdate({ update: priv('/род'), env: {}, prefs, post: a.post, ask: a.ask });
  ok('I1: /род без аргумента показывает текущее значение и не трогает движок',
    a.texts.length === 1 && /Род агента: авто/.test(a.texts[0]) && a.asked.length === 0, JSON.stringify(a.texts));

  const b = mk();
  await handleUpdate({ update: priv('/род м'), env: {}, prefs, post: b.post, ask: b.ask });
  ok('I2: /род м запоминается на этот чат и отвечает по-человечески',
    store.get('tg_1') === 'male' && /мужской/.test(b.texts[0]) && b.asked.length === 0, JSON.stringify(b.texts) + ' ' + store.get('tg_1'));

  const c = mk();
  await handleUpdate({ update: priv('привет'), env: {}, prefs, post: c.post, ask: c.ask });
  ok('I3: выбор доезжает до /api/chat полем gender (тот же путь, что у приложения)',
    c.asked.length === 1 && c.asked[0].gender === 'male', JSON.stringify(c.asked[0]));

  const e = mk();
  await handleUpdate({ update: priv('/род чушь собачья'), env: {}, prefs, post: e.post, ask: e.ask });
  ok('I4: нераспознанный аргумент = авто, а не текст, уехавший в модель',
    store.get('tg_1') === 'auto' && /авто/.test(e.texts[0]), store.get('tg_1') + ' ' + JSON.stringify(e.texts));

  const f = mk();
  await handleUpdate({ update: priv('скажи пару слов'), env: {}, prefs, post: f.post, ask: f.ask });
  ok('I5: на авто полем не машем — пусть работает AGENT_GENDER развертывания',
    f.asked[0].gender === undefined, JSON.stringify(f.asked[0]));

  const g = mk();
  await handleUpdate({ update: { message: { message_id: 9, from: { id: 7, first_name: 'Кто-то' }, chat: { id: 2, type: 'private' }, text: '/род ж' } }, env: {}, prefs, post: g.post, ask: g.ask });
  ok('I6: настройка привязана к беседе, а не к воркеру целиком',
    store.get('tg_2') === 'female' && store.get('tg_1') === 'auto', JSON.stringify([...store.entries()]));

  const h = mk();
  await handleUpdate({ update: priv('ну как'), env: {}, prefs, post: h.post, ask: h.ask });
  ok('I7: чужой чат не получает нашего выбора (первый всё ещё на авто)',
    h.asked[0].gender === undefined, JSON.stringify(h.asked[0]));

  const k = mk();
  await handleUpdate({ update: priv('/род ж'), env: {}, post: k.post, ask: k.ask });
  ok('I8: без хранилища команда не падает и честно говорит про ограничение',
    k.texts.length === 1 && /Ок\. Род агента: женский/.test(k.texts[0]), JSON.stringify(k.texts));

  const m = mk();
  await handleUpdate({ update: priv('/help'), env: {}, prefs, post: m.post, ask: m.ask });
  await handleUpdate({ update: priv('/start'), env: {}, prefs, post: m.post, ask: m.ask });
  ok('I9: /help и /start про /род знают — про настройку не надо догадываться',
    m.texts.every((t) => /\/род/.test(t)), JSON.stringify(m.texts.map((t) => t.slice(0, 40))));

  const n = mk();
  await handleUpdate({ update: priv('/forget'), env: {}, prefs, post: n.post, ask: n.ask });
  ok('I10: /forget не затирает настройку рода — это про память разговора, а не про человека',
    store.get('tg_1') === 'auto' && n.asked.length === 1 && n.asked[0].forget === true, JSON.stringify(store.get('tg_1')));
}

console.log('J — файлы и картинки в Telegram');
{
  const b64 = Buffer.from('a'.repeat(640)).toString('base64');
  const img = { name: 'котик.png', mime: 'image/png', size: 640, b64, kind: 'image' };
  const doc = { name: 'план.md', mime: 'text/markdown', size: 240, b64 };
  async function run(files, throwOn) {
    const posts = [];
    const res = await handleUpdate({
      update: priv('сделай картинку'),
      env: {},
      ask: async () => json(Object.assign({ ok: true, reply: 'Готово.', provider: 'gemini', model: 'm', ms: 100 }, files ? { files } : {})),
      post: async (m, p, f) => {
        posts.push({ m, p, f });
        if (f && throwOn && f.filename === throwOn) throw new Error('Telegram не принял файл');
        return { status: 200 };
      },
    });
    return { posts, res };
  }
  const a = await run([img, doc]);
  const photo = a.posts.find((x) => x.m === 'sendPhoto');
  const document = a.posts.find((x) => x.m === 'sendDocument');
  ok('J1: картинка уходит sendPhoto — она видна в ленте, а не «скачай и открой»',
    !!photo && photo.f.field === 'photo' && photo.f.filename === 'котик.png', JSON.stringify(a.posts.map((x) => x.m + ':' + (x.f && x.f.field))));
  ok('J2: обычный файл — по-прежнему sendDocument', !!document && document.f.field === 'document', JSON.stringify(document && document.f.field));
  ok('J3: подпись под файлом — имя и размер', /котик\.png/.test(photo.p.caption) && /640|0\.6|КБ/.test(photo.p.caption), photo.p.caption);
  ok('J4: тип файла передан в multipart', photo.f.type === 'image/png' && document.f.type === 'text/markdown', [photo.f.type, document.f.type].join('/'));
  const byMime = await run([{ name: 'закат.jpg', mime: 'image/jpeg', size: 640, b64 }]);
  ok('J5: kind можно не присылать — mime решает', byMime.posts.some((x) => x.m === 'sendPhoto'), JSON.stringify(byMime.posts.map((x) => x.m)));
  const many = await run([img, img, img, img, img]);
  ok('J6: не больше трёх файлов за ответ — как в веб-чате',
    many.posts.filter((x) => x.f).length === 3, JSON.stringify(many.posts.filter((x) => x.f).length));
  const bad = await run([img], 'котик.png');
  ok('J7: сбой отправки картинки называется картинкой, а не файлом',
    bad.posts.some((x) => x.m === 'sendMessage' && /Картинку «котик.png» отправить не вышло/.test(x.p.text)), JSON.stringify(bad.posts.map((x) => x.p && (x.p.text || '')).join('|').slice(0, 120)));
  ok('J8: и ошибка ложится в поле, которое показывает фронт', /не принял файл/.test(String(bad.res.fileError || '')), JSON.stringify(bad.res.fileError));
  const good = await run([img]);
  ok('J9: счётчик картинок ведётся — по нему видно, что дошло до человека', good.res.photos === 1 && good.res.files.length === 1, JSON.stringify({ p: good.res.photos, f: good.res.files }));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
