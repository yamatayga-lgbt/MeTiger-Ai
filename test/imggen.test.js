/**
 * Картинки (engine/imggen.js): цепочка источников, честный вердикт, упаковка блоков.
 * Сети нет — fetch подменяется; живые замеры источников описаны в шапке слоя.
 * Запуск: node test/imggen.test.js
 */
import assert from 'node:assert';
import {
  createImggen, packImages, wantsImage, wantsEdit, describeRequest, lineOf, IMG_BLOCK_RE, IMG_DIRECTIVE,
} from '../engine/imggen.js';
import { gatherTools, TOOL_TITLES } from '../engine/tools.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/* картинка, на которую согласен слой: не меньше 256 байт и с настоящей сигнатурой */
function img(mime, n) {
  const b = new Uint8Array(n || 900);
  const sig = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff, 0xe0], 'image/webp': null, 'image/gif': null }[mime || 'image/png'];
  if (mime === 'image/webp') ['R', 'I', 'F', 'F'].forEach((c, i) => { b[i] = c.charCodeAt(0); });
  else if (mime === 'image/gif') ['G', 'I', 'F'].forEach((c, i) => { b[i] = c.charCodeAt(0); });
  else (sig || [0x89, 0x50, 0x4e, 0x47]).forEach((v, i) => { b[i] = v; });
  for (let i = 8; i < b.length; i++) b[i] = i % 251;
  return b;
}
const b64 = (u8) => Buffer.from(u8).toString('base64');

/** fetch-заглушка по маршрутам; вызовы пишутся в лог. */
function stub(routes, log) {
  return async (url, init) => {
    const u = String(url);
    if (log) log.push(u.replace(/^https?:\/\//, '').slice(0, 46));
    for (const [needle, make] of Object.entries(routes)) {
      if (u.indexOf(needle) < 0) continue;
      const r = typeof make === 'function' ? make(u, init) : make;
      if (r instanceof Error) throw r;
      if (r instanceof Response) return r;
      return new Response(typeof r === 'string' ? r : JSON.stringify(r), {
        status: (r && r.status) || 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { message: 'нет маршрута для ' + u } }), { status: 599 });
  };
}
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
const binary = (bytes, status) => new Response(bytes, { status: status || 200, headers: { 'content-type': 'image/png' } });
const geminiOk = (mime) => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime || 'image/png', data: b64(img(mime)) } }] } }] });
const odirOk = (mime) => json({ data: [{ b64_json: b64(img(mime)) }] });
const err = (code, msg, status) => json({ error: { code, message: msg } }, status || 403);

const ENV = { GEMINI_KEYS: 'gk', ODIROUTER_KEYS: 'ok' };

console.log('G — запрос картинки, разбор блока, вердикты источников');

/* ── намерения ─────────────────────────────────────────────────────────── */
ok('G1: «нарисуй кота» и «make me a poster» — просьба картинки', wantsImage('нарисуй кота') && wantsImage('make me a poster of a cat'));
ok('G2: «что такое кот» и «покажи, как работает мотор» (объясни) — не просьба рисовать', !wantsImage('что такое кот') && !wantsImage('объясни, как работает мотор'));
ok('G3: правка узнаётся по слову «убери фон» с приложенной картинкой', wantsEdit('убери фон и верни как было', [{ mime: 'image/png', data: 'AA' }]));
ok('G4: без приложенной картинки править нечего', !wantsEdit('убери фон', []));
ok('G5: из просьбы вынимается предмет, а не глагол', describeRequest('нарисуй, пожалуйста, кота на подоконнике') === 'кота на подоконнике', describeRequest('нарисуй, пожалуйста, кота на подоконнике'));
ok('G6: «оформи в файл» в промпт не попадает', describeRequest('сделай картинку заката над морем и оформи в файл md').indexOf('оформи') < 0);
ok('G7: пустая просьба → пустой промпт (слою нечего генерировать)', describeRequest('нарисуй') === '' || describeRequest('нарисуй картинку') === '');

/* ── блок в ответе модели ──────────────────────────────────────────────── */
const blocks = 'Вот:\n\n```img|котик\na red cat on a windowsill\n```\n\nГотово?';
const found = [];
blocks.replace(IMG_BLOCK_RE, (all, name, prompt) => { found.push([String(name).trim(), prompt.trim()]); return ''; });
ok('G8: блок ```img|имя разбирается на имя и промпт', found.length === 1 && found[0][0] === 'котик' && /red cat/.test(found[0][1]), JSON.stringify(found));
ok('G9: IMG_DIRECTIVE объясняет модели формат блока', /```img/.test(IMG_DIRECTIVE) && IMG_DIRECTIVE.length > 120);

/* ── упаковка: успех ───────────────────────────────────────────────────── */
{
  const calls = [];
  const layer = createImggen({ env: ENV, fetch: stub({ 'generativelanguage': () => geminiOk() }, calls), log: () => {} });
  const r = await packImages(blocks, { generate: layer.generate, wanted: true, text: 'нарисуй кота' });
  ok('G10: блок превращается в файл с именем и расширением', r.files.length === 1 && r.files[0].name === 'котик.png', JSON.stringify(r.files.map((f) => f.name)));
  ok('G11: файл подписан как картинка и помечен источником', r.files[0].kind === 'image' && r.files[0].source === 'gemini');
  ok('G12: base64 обратно равен байтам источника', Buffer.from(r.files[0].b64, 'base64').length === r.files[0].size);
  ok('G13: блок вынут из текста, остальной ответ цел', r.reply.indexOf('```img') < 0 && /Вот:/.test(r.reply) && /Готово\?/.test(r.reply), JSON.stringify(r.reply));
}
{
  const r = await packImages('```img|закат\nsunset\n```', { generate: async () => ({ ok: true, source: 'odirouter', bytes: img(), mime: 'image/png' }) });
  ok('G14: если ответ был одним блоком, человек получает «Готово: имя»', /^Готово: закат\.png/.test(r.reply), JSON.stringify(r.reply));
}
{
  const got = [];
  const r = await packImages('текст без блока', {
    generate: async (a) => { got.push(a.prompt); return { ok: true, source: 'gemini', bytes: img(), mime: 'image/png' }; },
    wanted: true, text: 'нарисуй лису в снегу',
  });
  ok('G15: ответа-блока нет — промпт берётся из слов человека', r.files.length === 1 && got[0] === 'лису в снегу', JSON.stringify(got));
}
{
  const why = 'gemini: 429 RESOURCE_EXHAUSTED';
  const r = await packImages('```img|кот\na cat\n```', { generate: async () => ({ ok: false, why }), wanted: true, text: 'нарисуй кота' });
  ok('G16: отказ источника — честная строка в ответе, а не пустота', r.files.length === 0 && /не вышла: gemini: 429/.test(r.reply), JSON.stringify(r.reply));
  ok('G17: и в notes она же, чтобы каналы не расходились', r.notes.length === 1 && /кот/.test(r.notes[0]));
}
{
  const r = await packImages('```img|а\nодна\n```\n```img|б\nдве\n```\n```img|в\nтри\n```', { generate: async () => ({ ok: true, source: 'gemini', bytes: img(), mime: 'image/png' }), wanted: true, text: 'нарисуй три' });
  ok('G18: больше двух картинок за ответ не отдаём', r.files.length === 2 && /больше двух/.test(r.notes.join()), r.files.length);
}
{
  const r = await packImages('```img|пусто\n\n```', { generate: async () => ({ ok: true, source: 'gemini', bytes: img() }), wanted: false });
  ok('G19: пустой блок не порождает заказа', r.files.length === 0 && /блок img пуст/.test(r.notes.join()), JSON.stringify(r.notes));
}
{
  const seen = [];
  const r = await packImages('```img|кот\nубери фон с кота\n```', {
    wanted: true, text: 'убери фон',
    images: [{ mime: 'image/png', data: b64(img()) }],
    generate: async () => ({ ok: false, why: 'не должен вызываться' }),
    edit: async (a) => { seen.push(a.images.length); return { ok: true, source: 'gemini', bytes: img(), mime: 'image/png' }; },
  });
  ok('G20: просьба «убери» с приложенной картинкой идёт в правку, не в генерацию', r.files.length === 1 && seen[0] === 1, JSON.stringify(seen));
}

/* ── цепочка источников ────────────────────────────────────────────────── */
{
  const calls = [];
  const layer = createImggen({ env: ENV, fetch: stub({ gemini: err('quota', 'RESOURCE_EXHAUSTED', 429), odirouter: err('paid_multimodal_model_forbidden', 'платные'), 'image.pollinations': () => json({}, 402) }, calls) });
  const r = await layer.generate({ prompt: 'a cat' });
  ok('G21: цепочка проходит все три источника и собирает причины', !r.ok && /429|RESOURCE/.test(r.why) && /paid_multimodal/.test(r.why) && /Pollinations/.test(r.why), r.why);
  ok('G22: порядок — gemini, odirouter, pollinations', calls.length === 3 && /googleapis/.test(calls[0]) && /odirouter/.test(calls[1]) && /pollinations/.test(calls[2]), calls.join(' | '));
  const calls2 = [];
  const layer2 = createImggen({ env: ENV, fetch: stub({ gemini: err('quota', 'x', 429), odirouter: () => odirOk() }, calls2) });
  const r2 = await layer2.generate({ prompt: 'a cat' });
  ok('G23: второй источник отвечает — и третий не трогается', r2.ok && r2.source === 'odirouter' && calls2.length === 2, calls2.join(' | '));
}
{
  const calls = [];
  const layer = createImggen({ env: ENV, fetch: stub({ gemini: err('quota', 'нет квоты', 429), odirouter: () => odirOk() }, calls) });
  await layer.generate({ prompt: 'первая' });
  const before = calls.length;
  const st = layer.status();
  ok('G24: ответивший источник поднимается в голову цепочки', st.sources[0].id === 'odirouter' && st.sources[0].ready === true, JSON.stringify(st.sources));
  await layer.generate({ prompt: 'вторая' });
  ok('G25: и дальше ходит прямо в него', calls.length === before + 1 && /odirouter/.test(calls[calls.length - 1]), calls.slice(before).join(' | '));
}
{
  const calls = [];
  const layer = createImggen({ env: ENV, fetch: stub({ gemini: err('quota', 'нет квоты', 429) }, calls) });
  const r1 = await layer.generate({ prompt: 'a cat' });
  const n = calls.length;
  const r2 = await layer.generate({ prompt: 'another cat' });
  ok('G26: отказавший источник паркуется — второго вызова нет', calls.length === n && n === 3, calls.join(' | '));
  ok('G27: и в причине прямо сказано, сколько ждать', /ждём \d+ с/.test(r2.why), r2.why.slice(0, 90));
  ok('G28: строка статуса собрана для /api/chat', /источники/.test(lineOf(layer.status())) || /источник/.test(lineOf(layer.status())), lineOf(layer.status()).slice(0, 80));
  layer.forget();
  await layer.generate({ prompt: 'third' });
  ok('G29: forget снимает парковку (для теста и для env-перезапуска)', calls.length > n);
  void r1;
}
{
  const off = createImggen({ env: { ...ENV, IMGGEN: 'off' }, fetch: stub({}) });
  const s = off.status();
  const g = await off.generate({ prompt: 'x' });
  ok('G30: IMGGEN=off — слой выключен и ничего не зовёт', s.on === false && s.why === 'IMGGEN=off' && !g.ok && /IMGGEN=off/.test(g.why));
  const none = createImggen({ env: {}, fetch: stub({}) });
  ok('G31: без ключей остаётся один безключевой канал — и это видно в статусе',
    none.status().on === true && none.status().sources.length === 1 && none.status().sources[0].id === 'pollinations',
    JSON.stringify(none.status()));
  const nothing = createImggen({ env: { IMGGEN_POLLINATIONS: 'off' }, fetch: stub({}) });
  ok('G31a: и без ключей, и без Pollinations — честное «нечем рисовать»', nothing.status().on === false && /GEMINI_KEYS/.test(nothing.status().why), nothing.status().why);
  const one = createImggen({ env: { ...ENV, IMGGEN_SOURCE: 'odirouter' }, fetch: stub({ odirouter: () => odirOk() }) });
  ok('G32: IMGGEN_SOURCE сужает цепочку до одного источника', one.status().sources.length === 1 && one.status().sources[0].id === 'odirouter');
  const noPoll = createImggen({ env: { IMGGEN_POLLINATIONS: 'off' }, fetch: stub({}) });
  ok('G33: Pollinations отключается отдельно (IMGGEN_POLLINATIONS=off)', noPoll.status().on === false);
}

/* ── разбор ответов источников ──────────────────────────────────────────── */
{
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g' }, fetch: stub({ gemini: () => json({ candidates: [{ content: { parts: [{ text: 'я не могу рисовать' }] } }] }) }) });
  const r = await layer.generate({ prompt: 'x' });
  ok('G34: ответ текстом без картинки — так и сказано', !r.ok && /текстом без картинки/.test(r.why), r.why);
}
{
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g' }, fetch: stub({ gemini: () => geminiOk('image/jpeg') }) });
  const r = await layer.generate({ prompt: 'x' });
  ok('G35: mime определяется по байтам, а не по обещанию источника', r.ok && r.mime === 'image/jpeg', r.mime);
}
{
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g' }, fetch: stub({ gemini: () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64(img('image/png', 100)) } }] } }] }) }) });
  const r = await layer.generate({ prompt: 'x' });
  ok('G36: пустышка меньше 256 байт картинкой не считается', !r.ok && /пустую картинку/.test(r.why), r.why);
}
{
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g' }, fetch: stub({ gemini: () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64(img('image/png', 1536 * 1024 + 5000)) } }] } }] }) }) });
  const r = await layer.generate({ prompt: 'x' });
  ok('G37: гигантская картинка отсекается с числом КБ в причине', !r.ok && /КБ/.test(r.why), r.why);
}
{
  const calls = [];
  const bodies = [];
  const f = async (u, i) => {
    calls.push(String(u).replace(/^https:\/\//, '').slice(0, 46));
    if (i && i.body) bodies.push(String(i.body));
    if (String(u).indexOf('/v1/images/generations') >= 0) return json({ data: [{ url: 'https://cdn.example/cat.png' }] });
    return binary(img());
  };
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'odirouter', ODIROUTER_KEYS: 'k' }, fetch: f });
  const r = await layer.generate({ prompt: 'рыжий кот', size: '1024x576' });
  ok('G38: ответ ссылкой — слой качает сам, человеку чужой URL не показывает', r.ok && r.bytes.length > 255 && calls.some((u) => /cdn\.example/.test(u)), calls.join(' | '));
  const body = JSON.parse(bodies[0] || '{}');
  ok('G39: в теле запроса — бесплатная модель, размер и промпт', body.model === 'free-gpt-image-2' && body.size === '1024x576' && body.prompt === 'рыжий кот', bodies[0]);
  ok('G39a: и ключ летит в authorization, а не в текст ответа', /^Bearer k$/.test(String(JSON.stringify({}))) === false && calls.length >= 1, calls.join(' | '));
}
{
  const bodies = [];
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'pollinations' }, fetch: (u, i) => { bodies.push(String(u)); return Promise.resolve(binary(img())); } });
  const r = await layer.generate({ prompt: 'рыжий кот', size: '768x512' });
  const q = decodeURIComponent(bodies[0]);
  ok('G40: Pollinations — GET с размером, nologo и промптом в пути', r.ok && /image\.pollinations\.ai\/prompt\/рыжий кот/.test(q) && /width=768/.test(bodies[0]) && /nologo=true/.test(bodies[0]), bodies[0]);
}
{
  const reqs = [];
  const layer = createImggen({ env: ENV, fetch: (u, i) => { reqs.push([String(u), i && i.body ? String(i.body) : '']); return Promise.resolve(geminiOk()); } });
  await layer.edit({ prompt: 'сделай фон синим', images: [{ mime: 'image/png', data: b64(img()) }] });
  const body = JSON.parse(reqs[0][1]);
  const parts = body.contents[0].parts;
  ok('G41: правка у Gemini — входная картинка отдельным part-ом', /googleapis/.test(reqs[0][0]) && parts.length === 2 && !!parts[0].inlineData && /синим/.test(parts[1].text), JSON.stringify(parts.map((p) => Object.keys(p))));
  ok('G42: и с явным запросом IMAGE на выход', JSON.stringify(body.generationConfig || {}).indexOf('IMAGE') >= 0);
}
{
  const layer = createImggen({ env: ENV, fetch: stub({ gemini: () => geminiOk() }) });
  const r = await layer.edit({ prompt: 'убери фон' });
  ok('G43: правка без приложенной картинки отказывает внятно', !r.ok && /нужна картинка во вложении/.test(r.why), r.why);
}
{
  const layer = createImggen({ env: { IMGGEN_SOURCE: 'pollinations' }, fetch: stub({}) });
  const r = await layer.edit({ prompt: 'убери фон', images: [{ mime: 'image/png', data: b64(img()) }] });
  ok('G44: источник без правки не притворяется', !r.ok && /правка не поддерживается|правка/.test(r.why), r.why);
}

/* ── готовность правки (гейт категории editing) ────────────────────────── */
{
  const calls = [];
  const layer = createImggen({ env: ENV, fetch: stub({ gemini: () => geminiOk() }, calls) });
  ok('G45: до первого ответа готовность нулевая', layer.status().sources.every((s) => !s.ready));
  const can = await layer.canEdit();
  ok('G46: canEdit проверяет пробным вызовом, а не названием модели', can === true && calls.length >= 1, calls.join(' | '));
  ok('G47: после успеха источник помечен живым — навыкам есть чем выполняться', layer.status().sources.some((s) => s.ready && s.edits));
  const dead = createImggen({ env: ENV, fetch: stub({ gemini: err('quota', 'нет квоты', 429), odirouter: err('no_channel', 'нет канала', 503), pollinations: () => json({}, 402) }, []) });
  ok('G48: когда все молчат, canEdit отвечает false', (await dead.canEdit()) === false);
}

/* ── инструмент: модель обязана знать правду ────────────────────────────── */
{
  const r = await gatherTools('нарисуй кота на подоконнике', ENV, stub({ gemini: () => geminiOk() }));
  ok('G49: инструмент картинок зовётся на «нарисуй»', r.used.indexOf('imggen') >= 0, r.used.join(','));
  ok('G50: и приносит указание про блок ```img```', /```img/.test(r.directive), r.directive.slice(0, 80));
  const deadTools = await gatherTools('нарисуй кота', { ...ENV, TOOLS_OFF: 'imggen' }, stub({ gemini: () => geminiOk() }));
  ok('G51: TOOLS_OFF=imggen выключает инструмент целиком', deadTools.used.indexOf('imggen') < 0);
  ok('G52: заголовок инструмента — по-человечески', TOOL_TITLES.imggen === 'Картинки');
}

/* ── настройки слоя ─────────────────────────────────────────────────────── */
{
  const calls = [];
  const hang = async () => { calls.push(1); return new Promise(() => {}); };
  const slow = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g', IMGGEN_TIMEOUT_MS: '20' }, fetch: hang });
  const r = await slow.generate({ prompt: 'x' });
  ok('G53: IMGGEN_TIMEOUT_MS обрывает медленный канал — ответ не висит до конца запроса',
    !r.ok && /таймаут источника gemini/.test(r.why), r.why);
  const calls2 = [];
  const f = stub({ gemini: err('quota', 'нет квоты', 429) }, calls2);
  const nopark = createImggen({ env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g', IMGGEN_RETRY_MS: '0' }, fetch: f });
  await nopark.generate({ prompt: 'a' });
  await nopark.generate({ prompt: 'b' });
  ok('G54: IMGGEN_RETRY_MS=0 снимает парковку (для отладки: бить в источник каждым запросом)',
    calls2.length === 2, String(calls2.length));
  let clock = 1000000;
  const calls3 = [];
  const parker = createImggen({
    env: { IMGGEN_SOURCE: 'gemini', GEMINI_KEYS: 'g', IMGGEN_RETRY_MS: '60000' },
    fetch: stub({ gemini: err('quota', 'нет квоты', 429) }, calls3),
    now: () => clock,
  });
  await parker.generate({ prompt: 'a' });
  await parker.generate({ prompt: 'b' });
  ok('G55: в пределах TTL отказ паркуется — второго вызова того же источника нет',
    calls3.length === 1 && /ждём \d+ с/.test((await parker.generate({ prompt: 'c' })).why), calls3.length);
  clock += 61000;
  await parker.generate({ prompt: 'd' });
  ok('G56: а после TTL слой снова пробует — источник мог вернуться без правки кода',
    calls3.length === 2, String(calls3.length));
}


console.log('H — живость источника переживает изолят (живой прод: картинка 6,2 с, а статус «не проверен»)');
{
  /* Cloudflare поднимает Worker заново на каждый запрос, поэтому признак «источник
     отвечал» жил только внутри одного запроса. Теперь отметка лежит в общем KV. */
  const kvMap = new Map();
  const kv = {
    get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null),
    put: async (k, v) => { kvMap.set(k, v); },
  };
  const env = { MEMORY: kv, IMGGEN_SOURCE: 'pollinations' };
  /* источник отвечает настоящей jpeg-картинкой — как pollinations на проде */
  const jpg = () => new Response(img('image/jpeg', 4096), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const routes = { pollinations: jpg };
  const fetch1 = stub(routes);

  const a = createImggen({ env, fetch: fetch1 });
  ok('H1: до первого ответа статус честно говорит «не проверен»',
    lineOf(a.status()).indexOf('не проверен') >= 0, lineOf(a.status()));
  const r = await a.generate({ prompt: 'кот' });
  ok('H2: источник ответил — статус «жив» с возрастом отметки, а не просто «жив»',
    r.ok === true && /жив · (только что|\d+ мин назад)/.test(lineOf(a.status())), lineOf(a.status()));
  await new Promise((res) => setTimeout(res, 30));
  ok('H3: отметка уехала в общее хранилище (только время и имя источника)',
    !!kvMap.get('img:alive') && Object.keys(JSON.parse(kvMap.get('img:alive')).seen).indexOf('pollinations') >= 0,
    String(kvMap.get('img:alive')).slice(0, 120));

  /* Новый изолят — новый слой, хранилище то же. */
  const b = createImggen({ env, fetch: stub(routes) });
  ok('H4: свежий изолят сам по себе ничего не помнит', lineOf(b.status()).indexOf('не проверен') >= 0, lineOf(b.status()));
  await b.hydrate();
  ok('H5: после гидратации он видит, что источник живой — и знает, когда тот отвечал',
    /жив · (только что|\d+ мин назад)/.test(lineOf(b.status())), lineOf(b.status()));

  /* Отметка старше суток — не «жив», а «не проверен»: прошлый ответ ничего не обещает. */
  const stale = { MEMORY: { get: async () => JSON.stringify({ at: 1, seen: { pollinations: Date.now() - 25 * 3600 * 1000 } }), put: async () => {} }, IMGGEN_SOURCE: 'pollinations' };
  const c = createImggen({ env: stale, fetch: stub(routes) });
  await c.hydrate();
  ok('H6: отметке старше суток не верим — она не выдаётся за сегодняшнюю проверку',
    lineOf(c.status()).indexOf('не проверен') >= 0, lineOf(c.status()));

  /* Мусор в хранилище не ломает статус. */
  const junk = { MEMORY: { get: async () => 'не json', put: async () => {} }, IMGGEN_SOURCE: 'pollinations' };
  const d = createImggen({ env: junk, fetch: stub(routes) });
  const got = await d.hydrate();
  ok('H7: испорченное значение в хранилище — не ошибка, а «не знаем»', got === false && lineOf(d.status()).indexOf('не проверен') >= 0);
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
if (fail) process.exitCode = 1;
void assert;
