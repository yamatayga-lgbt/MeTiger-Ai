/**
 * Профиль человека и адрес памяти (фаза: разные люди — разная память).
 *
 * Проверяется настоящее: модуль `engine/profile.js`, эндпоинт `/api/profile`,
 * вход `/api/chat` (какой ключ памяти реально получается у двух людей и доезжает ли
 * профиль до промпта) и ветка `/профиль` в Telegram. Сети нет — fetch подставлен,
 * хранилище — подставной KV, поэтому проверяются решения кода, а не провайдеры.
 *
 *   node test/profile.test.js
 */
import { blockOf, createProfile, memoryKey, normalize, profileKey, sanitizeUserId, signalsOf, CAPS } from '../engine/profile.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/profile.js';
import { onRequestGet as chatGet, onRequestPost as chatPost } from '../functions/api/chat.js';
import { handleUpdate, profileLine } from '../engine/telegram.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/** Подставной KV: строки, `get(key,'json')`, как у Pages. Плюс счётчик записей. */
function fakeKv() {
  const map = new Map();
  const kv = {
    map,
    puts: 0,
    get: async (key) => (map.has(key) ? JSON.parse(map.get(key)) : null),
    put: async (key, v) => { kv.puts++; map.set(key, typeof v === 'string' ? v : JSON.stringify(v)); },
    delete: async (key) => { map.delete(key); },
  };
  return kv;
}

console.log('A — форма профиля: что сохраняем и что обрезаем');
{
  const p = normalize({ name: '  Иван   Петров ', job: 'аналитик\nданных', about: 'абв'.repeat(900) });
  ok('A1: пробелы и перевод строк в коротких полях свёрнуты', p.name === 'Иван Петров' && p.job === 'аналитик данных', JSON.stringify({ n: p.name, j: p.job }));
  ok('A2: потолок поля соблюдён, «filled» правдив', p.about.length === CAPS.about && p.filled === true, String(p.about.length));
  ok('A3: управляющие символы не доезжают до хранилища', normalize({ name: 'ив\u0000ан\u001f\u007f' }).name === 'иван', JSON.stringify(normalize({ name: 'ив\u0000ан\u001f\u007f' }).name));
  ok('A4: мусор вместо объекта — пустой профиль, а не исключение', normalize(null).filled === false && normalize('строка').filled === false && normalize(42).name === '');
  ok('A5: переносы в «о себе» живые, тройные схлопнуты', normalize({ about: 'раз\n\n\n\nдва' }).about === 'раз\n\nдва', JSON.stringify(normalize({ about: 'раз\n\n\n\nдва' }).about));
  const noStore = normalize({ name: 'a'.repeat(200) });
  ok('A6: длинное имя обрезано, а не отброшено', noStore.name.length === CAPS.name, String(noStore.name.length));
}

console.log('B — адрес: чья это память и чей профиль');
{
  ok('B1: веб-гость с ключом получает личный адрес, а не общий «web»', memoryKey('ab12cd34', 'web') === 'u-ab12cd34', memoryKey('ab12cd34', 'web'));
  ok('B2: два разных ключа — два разных адреса (это и есть изоляция памяти)', memoryKey('ab12cd34', 'web') !== memoryKey('ff99ee11', 'web'));
  ok('B3: без ключа остаётся старое поведение — не выдумываем адрес из головы', memoryKey('', 'web') === 'web' && memoryKey(null) === 'web');
  ok('B4: Telegram-ключ не переименовываем: иначе накопленная память уехала бы в новый ключ', memoryKey('tg_4242', 'tg_12345') === 'tg_12345', memoryKey('tg_4242', 'tg_12345'));
  ok('B5: чужой chatId с подставным «tg_» остаётся как есть (мы его не изобретали)', memoryKey('', 'tg_777') === 'tg_777');
  ok('B6: идентификатор с мусором не проходит', sanitizeUserId('../../etc/passwd') === '' && sanitizeUserId('ab 12') === '' && sanitizeUserId('abc') === '' && sanitizeUserId('a'.repeat(81)) === '');
  ok('B7: ключ профиля — с префиксом и без кириллицы в имени файла хранилища', /^profile:[A-Za-z0-9_-]+$/.test(profileKey('ab12cd34')) && profileKey('Иван') === '', profileKey('ab12cd34') + '/' + JSON.stringify(profileKey('Иван')));
}

console.log('C — «автоматическое понимание»: что диктует профиль');
{
  const tech = signalsOf({ name: 'Иван', job: 'backend-разработчик', about: '' });
  ok('C1: техническая профессия — разговор терминами и кодом', tech.some((x) => /термины и детали/.test(x)), JSON.stringify(tech));
  const plain = signalsOf({ name: '', job: 'врач-кардиолог', about: '' });
  ok('C2: нетехническая — по шагам и с расшифровкой терминов', plain.some((x) => /простым языком/.test(x) && /расшифровывай/.test(x)), JSON.stringify(plain));
  const terse = signalsOf({ about: 'отвечай коротко, без воды' });
  ok('C3: просьба «коротко» превращается в потолок длины', terse.some((x) => /2–4 строки/.test(x)), JSON.stringify(terse));
  const long = signalsOf({ about: 'люблю подробно, с примерами и пошагово' });
  ok('C4: просьба «подробно» не спорит с короткой', long.some((x) => /подробно/.test(x)) && !long.some((x) => /2–4 строки/.test(x)), JSON.stringify(long));
  const noEmoji = signalsOf({ about: 'без эмодзи, пожалуйста' });
  ok('C5: «без эмодзи» услышано', noEmoji.some((x) => /без эмодзи/.test(x)), JSON.stringify(noEmoji));
  ok('C6: имя превращается в обращение, а не в лесть', signalsOf({ name: 'Мария' }).some((x) => x === 'обращайся по имени: Мария'), JSON.stringify(signalsOf({ name: 'Мария' })));
  ok('C7: пустой профиль — ноль правил (молчим, а не выдумываем)', signalsOf({}).length === 0 && signalsOf(null).length === 0);
  const b = blockOf({ name: 'Иван', job: 'дата-сайентист', about: 'таблицы' });
  ok('C8: блок помечен как данные человека и запрещает додумывать', /ПРОФИЛЬ ЧЕЛОВЕКА/.test(b) && /не выдумывай сверх них/.test(b) && /Как обращаться: Иван/.test(b), b.slice(0, 160));
  ok('C9: блок не назначает роль и не разрешает всё на свете', !/ты — |забудь правила|без цензуры|режим без/.test(b) && !/взросл|18\+/.test(b), b.match(/ты — |забудь правила|без цензуры|18\+/));
  ok('C10: пустой профиль не добавляет в промпт ни символа', blockOf({}) === '' && blockOf(null) === '' && blockOf({ name: '   ' }) === '');
}

console.log('D — хранилище профиля: запись, отказ, очистка');
{
  const kv = fakeKv();
  const p = createProfile({ env: { MEMORY: kv }, store: kv });
  const first = await p.put('user0001', { name: 'Иван', job: 'аналитик данных', about: 'покороче' });
  ok('D1: сохранение возвращает то, что записалось, и блок для промпта', first.ok === true && first.profile.name === 'Иван' && /ПРОФИЛЬ ЧЕЛОВЕКА/.test(first.block) && first.stored === true, JSON.stringify(first).slice(0, 180));
  ok('D2: лежит под ключом профиля, а не памяти чатов', [...kv.map.keys()].some((k) => k.indexOf('profile:') === 0) && ![...kv.map.keys()].some((k) => k.indexOf('chat:') === 0), [...kv.map.keys()].join(','));
  const again = await p.put('user0001', { name: 'Иван', job: 'аналитик данных', about: 'покороче' });
  ok('D3: повтор тех же полей ничего не пишет (квота KV не горит)', again.ok === true && again.unchanged === true && kv.puts === 1, 'puts=' + kv.puts);
  const soon = await p.put('user0001', { name: 'Иван', job: 'аналитик данных', about: 'подробно' });
  ok('D4: вторая запись подряд отклонена словами, а не тихо проглочена', soon.ok === false && soon.tooSoon === true && /подожди/.test(soon.why), JSON.stringify(soon));
  const p2 = createProfile({ env: { MEMORY: kv, PROFILE_WRITE_MS: '0' }, store: kv });
  const fast = await p2.put('user0001', { name: 'Иван', job: 'аналитик данных', about: 'подробно, с примерами' });
  ok('D5: лимит записи настраивается и не является стеной', fast.ok === true && /подробно/.test(fast.profile.about), JSON.stringify(fast).slice(0, 140));
  const long = await p2.put('user0002', { name: 'И'.repeat(200), job: '', about: '' });
  ok('D6: обрезка человеку называется, а не прячется', long.ok === true && long.truncated.length === 1 && /имя обрезан/.test(long.truncated[0]), JSON.stringify(long.truncated));
  const bad = await p2.put('../../etc', { name: 'x' });
  ok('D7: без валидного идентификатора не пишем никуда', bad.ok === false && /идентификатор/.test(bad.why), JSON.stringify(bad));
  const nobox = await createProfile({ env: {}, store: null }).put('user0003', { name: 'x' });
  ok('D8: без хранилища ответ честный: сохранять некуда', nobox.ok === false && /KV не подключена/.test(nobox.why), JSON.stringify(nobox));
  const noboxGet = await createProfile({ env: {}, store: null }).get('user0003');
  ok('D9: чтение без хранилища не падает и объясняет подвох', noboxGet.ok === true && noboxGet.stored === false && /работает только в этом запросе/.test(noboxGet.why), JSON.stringify(noboxGet).slice(0, 160));
  const off = await createProfile({ env: { PROFILE: 'off', MEMORY: kv }, store: kv }).get('user0001');
  ok('D10: PROFILE=off выключает слой словами', off.ok === false && /PROFILE=off/.test(off.why), JSON.stringify(off));
  const other = await createProfile({ env: { MEMORY: kv }, store: kv }).get('user9999');
  ok('D11: чужой профиль пуст — данные не перетекают между людьми', other.ok === true && other.profile.filled === false, JSON.stringify(other.profile));
  const cleared = await createProfile({ env: { MEMORY: kv, PROFILE_WRITE_MS: '0' }, store: kv }).clear('user0001');
  ok('D12: очистка стирает запись и возвращает пустую форму', cleared.ok === true && cleared.profile.filled === false && !kv.map.has(profileKey('user0001')), [...kv.map.keys()].join(','));
}

console.log('E — эндпоинт /api/profile');
{
  const kv = fakeKv();
  const env = { MEMORY: kv, RATE_LIMIT: '0', PROFILE_WRITE_MS: '0' };
  const req = (url, init) => new Request('http://x' + url, init);
  const put = await onRequestPut({ request: req('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'dev1234', name: 'Иван', job: 'разработчик', about: 'без эмодзи' }) }), env });
  const pj = await put.json();
  ok('E1: PUT отвечает 200 и отдаёт сохранённую форму', put.status === 200 && pj.ok === true && pj.profile.name === 'Иван' && pj.signals.length > 0, JSON.stringify(pj).slice(0, 200));
  ok('E2: в ответе есть адрес памяти — человек видит, куда это ляжет', pj.memoryChatId === 'u-dev1234', String(pj.memoryChatId));
  const got = await onRequestGet({ request: req('/api/profile?id=dev1234'), env });
  const gj = await got.json();
  ok('E3: GET читает то, что записали (roundtrip через KV)', gj.ok === true && gj.profile.job === 'разработчик' && gj.stored === true, JSON.stringify(gj).slice(0, 200));
  ok('E4: GET отдаёт тот же блок, что уйдёт в промпт', gj.block === pj.block && /ПРОФИЛЬ ЧЕЛОВЕКА/.test(gj.block), String(gj.block).slice(0, 80));
  const noId = await onRequestGet({ request: req('/api/profile'), env });
  ok('E5: GET без идентификатора — 400 словами', noId.status === 400 && /идентификатор/.test((await noId.json()).error), String(noId.status));
  const badBody = await onRequestPut({ request: req('/api/profile', { method: 'PUT', body: 'не json' }), env });
  ok('E6: тело не JSON — 400 с объяснением формы, а не 500', badBody.status === 400 && /JSON/.test((await badBody.json()).error), String(badBody.status));
  const noStore = await onRequestPut({ request: req('/api/profile', { method: 'PUT', body: JSON.stringify({ userId: 'dev1234', name: 'Пётр' }) }), env: { RATE_LIMIT: '0' } });
  ok('E7: без связки KV — 503 с причиной, а не видимость сохранённого', noStore.status === 503 && /KV не подключена/.test((await noStore.json()).error), String(noStore.status));
  const del = await onRequestDelete({ request: req('/api/profile?id=dev1234', { method: 'DELETE' }), env });
  ok('E8: DELETE стирает запись', del.status === 200 && (await del.json()).cleared === true && !kv.map.has(profileKey('dev1234')));
  const cors = await onRequestGet({ request: req('/api/profile?id=dev1234'), env });
  ok('E9: CORS открыт, как у остальных эндпоинтов (приложение на другом поддомене)', cors.headers.get('access-control-allow-origin') === '*' && /PUT/.test(cors.headers.get('access-control-allow-methods')), String(cors.headers.get('access-control-allow-methods')));
}

console.log('F — вход /api/chat: разные люди — разные ключи, профиль в промпте');
{
  const ENV = { GROQ_KEYS: 'g1', RATE_LIMIT: '0', MEMORY: null };
  const chatBody = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (body && body.messages) calls.push({ url, body });
    return { status: 200, text: async () => JSON.stringify(body && body.messages ? chatBody('ок') : { data: [] }) };
  };
  try {
    const kv = fakeKv();
    const env = Object.assign({}, ENV, { MEMORY: kv, PROFILE_WRITE_MS: '0' });
    const req = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
    await onRequestPut({ request: new Request('http://x/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'anna0001', name: 'Анна', job: 'врач', about: 'без эмодзи' }) }), env });
    const a = await chatPost({ request: req({ text: 'сколько будет 2+2', userId: 'anna0001' }), env });
    const aj = await a.json();
    ok('F1: ответ собран и ключ памяти — личный, не «web»', aj.ok === true && aj.memoryChatId === 'u-anna0001', JSON.stringify({ mem: aj.memoryChatId, err: aj.error }).slice(0, 160));
    ok('F2: профиль отмечен в ответе как учтённый', aj.profile === 'учтён', String(aj.profile));
    const sys = (calls[0] && calls[0].body.messages.find((m) => m.role === 'system') || {}).content || '';
    ok('F3: блок профиля дошёл до модели', /ПРОФИЛЬ ЧЕЛОВЕКА/.test(sys) && /Как обращаться: Анна/.test(sys), sys.slice(-260));
    ok('F4: правило подстройки доехало вместе с данными', /простым языком/.test(sys) && /без эмодзи/.test(sys), (sys.match(/Как подстраиваться:[\s\S]{0,220}/) || [''])[0]);
    const pblk = (sys.match(/ПРОФИЛЬ ЧЕЛОВЕКА[\s\S]*?(?:\n\n|$)/) || [''])[0];
    ok('F5: в блоке профиля нет указаний «кем быть» и нет обходных формулировок',
      pblk.length > 40 && !/ты — |ты теперь |забудь|правила можно|без цензуры|режим без|18\+/.test(pblk), pblk.slice(0, 120));
    ok('F5a: блок профиля дошёл целиком (не срезан серединой строки)', /Как подстраиваться:/.test(pblk) && /обращайся по имени: Анна/.test(pblk), pblk.slice(-120));
    const b = await chatPost({ request: req({ text: 'а у меня как дела', userId: 'other99' }), env });
    const bj = await b.json();
    ok('F6: у второго человека — свой ключ памяти', bj.memoryChatId === 'u-other99', String(bj.memoryChatId));
    const keys = [...kv.map.keys()];
    const chatKeys = keys.filter((k) => k.indexOf('chat:') === 0);
    ok('F7: в хранилище две разные записи памяти, а не одна общая', chatKeys.length === 2 && new Set(chatKeys).size === 2, chatKeys.join(','));
    const recA = JSON.parse(kv.map.get('chat:u-anna0001') || '{}');
    const recB = JSON.parse(kv.map.get('chat:u-other99') || '{}');
    const txt = (r) => (r.messages || []).map((m) => m.content).join(' ');
    ok('F8: в памяти первого нет слов второго (разговоры не смешиваются)',
      /2\+2/.test(txt(recA)) && !/как дела/.test(txt(recA)) && /как дела/.test(txt(recB)) && !/2\+2/.test(txt(recB)), txt(recA).slice(0, 90) + ' || ' + txt(recB).slice(0, 90));
    const sysB = (calls[1] && calls[1].body.messages.find((m) => m.role === 'system') || {}).content || '';
    ok('F9: чужой профиль не подмешался второму человеку', !/Анна/.test(sysB), sysB.slice(-160));
    const legacy = await chatPost({ request: req({ text: 'привет' }), env });
    ok('F10: клиент без userId (curl, старый фронт) не ломается — память идёт в «web»', (await legacy.json()).memoryChatId === 'web');
    const forget = await chatPost({ request: req({ text: '/forget', forget: true, userId: 'anna0001' }), env });
    const fj = await forget.json();
    ok('F11: /forget чистит именно личную запись, а не общий котёл', fj.ok === true && fj.chatId === 'u-anna0001' && !kv.map.has('chat:u-anna0001'), JSON.stringify(fj).slice(0, 160));
    const off = await chatPost({ request: req({ text: 'привет', userId: 'anna0001' }), env: Object.assign({}, env, { PROFILE: 'off' }) });
    ok('F12: PROFILE=off не ломает ответ — просто без персонализации', (await off.json()).ok === true, 'нет 200');
  } finally {
    globalThis.fetch = saved;
  }
}

console.log('G — /профиль в Telegram');
{
  const priv = (text, from) => ({ message: { message_id: 5, chat: { id: 1, type: 'private' }, from: from || { id: 4242, is_bot: false, first_name: 'Иван' }, text } });
  const spy = () => { const posts = [], texts = []; return { posts, texts, post: async (m, p) => { posts.push({ m, p }); if (m === 'sendMessage') texts.push(p.text || ''); return { status: 200 }; } }; };
  const kv = fakeKv();
  const api = createProfile({ env: { MEMORY: kv, PROFILE_WRITE_MS: '0' }, store: kv });
  const asked = [];
  const s1 = spy();
  const r1 = await handleUpdate({ update: priv('/профиль'), env: {}, ask: async (pl) => { asked.push(pl); return { ok: true, reply: 'не должен быть вызван' }; }, post: s1.post, profile: api });
  ok('G1: команда не идёт к моделям — отвечает словами и не жжёт квоту', r1.answered === true && asked.length === 0 && s1.texts.length === 1, 'ask=' + asked.length + ' texts=' + s1.texts.length);
  ok('G2: пустой профиль описан как пустой, с формой записи', /ничего не записывал/.test(s1.texts[0]) && /не заполнено/.test(s1.texts[0]) && /<имя> \| <чем занимаешься>/.test(s1.texts[0]), s1.texts[0].slice(0, 200));
  const s2 = spy();
  await handleUpdate({ update: priv('/профиль Иван | аналитик данных | люблю таблицы и покороче'), env: {}, ask: async (pl) => { asked.push(pl); return { ok: true, reply: 'нет' }; }, post: s2.post, profile: api });
  ok('G3: запись одной строкой раскладывается по трём полям', /Как обращаться: Иван/.test(s2.texts[0]) && /Чем занимаешься: аналитик данных/.test(s2.texts[0]) && /О себе: люблю таблицы и покороче/.test(s2.texts[0]), s2.texts[0].slice(0, 240));
  ok('G4: подстройка показана человеку теми же словами, что ушла в промпт', /Как я подстраиваюсь/.test(s2.texts[0]) && /2–4 строки/.test(s2.texts[0]), (s2.texts[0].match(/Как я подстраиваюсь[\s\S]{0,160}/) || [''])[0]);
  const s3 = spy();
  await handleUpdate({ update: priv('/профиль  |  врач  | '), env: {}, ask: async () => ({ ok: true, reply: 'нет' }), post: s3.post, profile: api });
  ok('G5: пустые куски не затирают то, что уже записано', /Как обращаться: Иван/.test(s3.texts[0]) && /Чем занимаешься: врач/.test(s3.texts[0]), s3.texts[0].slice(0, 220));
  const s4 = spy();
  await handleUpdate({ update: priv('/профиль очисть'), env: {}, ask: async () => ({ ok: true, reply: 'нет' }), post: s4.post, profile: api });
  ok('G6: «очисть» стирает и не путает это с /forget', /Профиль забыт/.test(s4.texts[0]) && /\/forget/.test(s4.texts[0]), s4.texts[0]);
  const s5 = spy();
  await handleUpdate({ update: priv('/профиль'), env: {}, ask: async () => ({ ok: true, reply: 'нет' }), post: s5.post });
  ok('G7: без хранилища бот говорит об этом, а не падает', /не подключены/.test(s5.texts[0]) && s5.texts.length === 1, s5.texts[0]);
  const s6 = spy();
  await handleUpdate({ update: priv('/профиль Иван', { id: null }), env: {}, ask: async () => ({ ok: true, reply: 'нет' }), post: s6.post, profile: api });
  ok('G8: без id отправителя не пишем на чужое имя', /Не вижу id/.test(s6.texts[0]), s6.texts[0]);
  const s7 = spy();
  const r7 = await handleUpdate({ update: priv('привет'), env: {}, ask: async (pl) => { asked.push(pl); return { ok: true, reply: 'Привет, Иван!' }; }, post: s7.post, profile: api });
  ok('G9: обычный ответ уносит userId в payload — память и профиль в боте тоже личные',
    r7.answered === true && asked[asked.length - 1].userId === 'tg_4242' && asked[asked.length - 1].chatId === 'tg_1', JSON.stringify(asked[asked.length - 1]).slice(0, 160));
  const line = await profileLine(api, 'tg_4242', 'a | b | c | d');
  ok('G10: четыре куска — отказ с формой, а не запись лишнего в «о себе»', /Слишком много кусков/.test(line), line.slice(0, 120));
}

console.log('H — видимость состояния в диагностике');
{
  const ENV = { GROQ_KEYS: 'g1', RATE_LIMIT: '0' };
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ data: [] }) });
  try {
    const kv = fakeKv();
    const g = await chatGet({ request: new Request('http://x/api/chat'), env: Object.assign({}, ENV, { MEMORY: kv }) });
    const gj = await g.json();
    ok('H1: GET /api/chat объясняет, как включены профили и где они лежат',
      /профили включены/.test(gj.profile) && /связка KV есть/.test(gj.profile) && /имя\/профессия\/о себе/.test(gj.profile), String(gj.profile));
    const g2 = await chatGet({ request: new Request('http://x/api/chat'), env: ENV });
    const g2j = await g2.json();
    ok('H2: без связки это видно сразу, а не всплывает при первой попытке сохранить', /связки KV нет/.test(g2j.profile), String(g2j.profile));
  } finally { globalThis.fetch = saved; }
}

console.log(fail ? `\nПРОВАЛЕНО: ${fail}` : `\nпройдено: ${pass}, провалено: 0`);
process.exit(fail ? 1 : 0);
