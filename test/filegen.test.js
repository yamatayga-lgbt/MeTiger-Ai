/**
 * Файлы (перенос engine/filegen.js из yama-ai) + упаковка блоков ответа +
 * врезка в движок, эндпоинт и Telegram.
 *
 * Проверка идёт по-настоящему: ZIP разбирается своим читалкой в тесте (имена, CRC,
 * байты), а не «на глаз по длине». Сети нет — fetch подменён.
 * Запуск: node test/filegen.test.js
 */
import { generate, packFiles, formatFromText, nameFromText, crc32, zipStore, sizeOf, FMT } from '../engine/filegen.js';
import { createEngine } from '../engine/chat.js';
import { handleUpdate } from '../engine/telegram.js';

let pass = 0; let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (detail ? ' — ' + String(detail).slice(0, 180) : '')); }
};

const enc = new TextEncoder();

/** Минимальный читальщик ZIP (stored): { имя → { data, crc } } по центральному каталогу. */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { error: 'EOCD не найден' };
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return { error: 'головка центрального каталога битая' };
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true);
    const el = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const ho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    /* локальная головка: 30 байт + имя + extra, дальше данные */
    const lnl = dv.getUint16(ho + 26, true);
    const lel = dv.getUint16(ho + 28, true);
    const start = ho + 30 + lnl + lel;
    out[name] = {
      method, crc, size,
      data: bytes.subarray(start, start + size),
      crcOk: crc32(bytes.subarray(start, start + size)) === crc,
    };
    p += 46 + nl + el + cl;
  }
  return out;
}

const xml = (f) => {
  const z = readZip(f.bytes || new Uint8Array(0));
  return z;
};

console.log('A — упаковка: ZIP, OOXML, CSV');
const zip = zipStore([{ name: 'a.txt', data: 'привет мир' }, { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 250, 255]) }]);
const zr = readZip(zip);
ok('A1: zip читается, оба файла на месте', !zr.error && Object.keys(zr).length === 2, JSON.stringify(zr.error || Object.keys(zr)));
ok('A2: байты текста целы и CRC сходятся', new TextDecoder().decode(zr['a.txt'].data) === 'привет мир' && zr['a.txt'].crcOk);
ok('A3: бинарные байты целы (250 и 255 на месте)', Array.from(zr['dir/b.bin'].data).join() === '0,1,2,250,255' && zr['dir/b.bin'].crcOk);
ok('A4: crc32(«123456789») = 0xCBF43926 — контрольная сумма из стандарта', crc32(enc.encode('123456789')) === 0xcbf43926);
ok('A5: метод хранения — stored (0), без сжатия', zr['a.txt'].method === 0);

const MD = '# Отчёт\n\nВыводы **важные**:\n\n- первый\n- второй\n\n| Показатель | Значение |\n| - | - |\n| Выручка | 1500 |\n';
const docx = generate({ format: 'docx', name: 'Отчёт сентябрь', content: MD });
const dz = readZip(Buffer.from(docx.b64, 'base64'));
const dxml = new TextDecoder().decode(dz['word/document.xml'].data);
ok('A6: docx — это zip с [Content_Types], document.xml и стилями',
  !dz.error && !!dz['[Content_Types].xml'] && !!dz['word/styles.xml'] && !!dz['word/_rels/document.xml.rels'], Object.keys(dz).join(','));
ok('A7: заголовок со стилем, жирный отдельным run, таблица собрана',
  dxml.includes('w:val="Heading1"') && dxml.includes('<w:b/>') && dxml.includes('<w:tbl>') && dxml.includes('<w:tr>'), dxml.slice(0, 90));
ok('A8: кириллица в xml цела и экранирование работает',
  dxml.includes('Отчёт') && !/&(?!amp|lt|gt|quot|#)/.test(dxml.replace(/&amp;|&lt;|&gt;|&quot;/g, '')));

const xlsx = generate({ format: 'xlsx', name: 'Смета', content: 'Товар\tКол-во\tЦена\nМолоко\t2\t1,5\nИтого\t\t2,3' });
const xz = readZip(Buffer.from(xlsx.b64, 'base64'));
const sheet = new TextDecoder().decode(xz['xl/worksheets/sheet1.xml'].data);
ok('A9: xlsx — лист, строки и имя листа по названию',
  !!xz['xl/workbook.xml'] && sheet.includes('<row r="1">') && sheet.includes('<row r="3">')
  && new TextDecoder().decode(xz['xl/workbook.xml'].data).includes('name="Смета"'), Object.keys(xz).join(','));
ok('A10: число — без кавык, текст — inlineStr', sheet.includes('<is><t xml:space="preserve">Молоко</t></is>') && /<c r="B2"><v>2<\/v><\/c>/.test(sheet), sheet.slice(0, 120));

const csv = generate({ format: 'csv', name: 'прайс', content: 'Товар\tЦена\tПримечание\nб,в\t10\t=cmd' });
const csvRaw = Buffer.from(csv.b64, 'base64');
const csvText = csvRaw.toString('utf8');
ok('A11: csv начинается с UTF-8 BOM (иначе Excel в Windows съест кириллицу)',
  csvRaw[0] === 0xef && csvRaw[1] === 0xbb && csvRaw[2] === 0xbf && csvText.charCodeAt(0) === 0xfeff, [csvRaw[0], csvRaw[1], csvRaw[2]].join());
ok('A12: запятая в поле — кавычки, формула отсечена апострофом',
  csvText.includes('"б,в"') && csvText.includes("'=cmd") && csvText.split('\n')[1].startsWith('"б,в"'), csvText.replace(/\n/g, '|'));

const html = generate({ format: 'html', name: 'page', content: '# Привет <b>\n\nтекст' });
const htmlText = Buffer.from(html.b64, 'base64').toString('utf8');
ok('A13: html — печатная страница с доctype и экранированным тегом в тексте',
  htmlText.startsWith('<!DOCTYPE html>') && htmlText.includes('&lt;b&gt;') && htmlText.includes('<h1>'), htmlText.slice(0, 60));

ok('A14: расширение в имени не дублируется, запрещённые символы вычищены',
  generate({ format: 'docx', name: 'Смета.xlsx', content: 'а' }).name === 'Смета.docx'
  && generate({ format: 'md', name: 'а/b:c*d', content: 'а' }).name === 'а b c d.md', '');
ok('A15: неизвестный формат — отказ со списком форматов, а не исключение вслепую',
  (() => { try { generate({ format: 'pdf', name: 'x', content: 'y' }); return false; } catch (e) { return /docx, xlsx/.test(e.message); } })());
ok('A16: гигантский контент отклоняется с объяснением',
  (() => { try { generate({ format: 'txt', name: 'x', content: 'а'.repeat(200001) }); return false; } catch (e) { return /200 тыс/.test(e.message); } })());
ok('A17: base64 в ответе — те же байты, что и в файле',
  Buffer.from(docx.b64, 'base64').length === docx.size && readZip(Buffer.from(docx.b64, 'base64'))['word/document.xml'].size > 500);
ok('A18: размер человек читает без «0 КБ»', sizeOf(700) === '700 б' && sizeOf(4200) === '4,1 КБ', sizeOf(4200));

console.log('B — блоки ```file:…``` в ответе модели');
const withBlock = 'Вот смета.\n\n```file:docx|Смета на ремонт\n' + MD + '```\n\nОткрывай.';
let r = packFiles(withBlock, {});
ok('B1: блок изъят из текста, файл приложен, пояснение осталось',
  r.files.length === 1 && r.files[0].name === 'Смета на ремонт.docx' && r.reply.includes('Вот смета.') && !r.reply.includes('```') && r.notes.length === 0, r.reply.slice(0, 60));
ok('B2: извлечённый файл — настоящий docx с содержимым',
  readZip(Buffer.from(r.files[0].b64, 'base64'))['word/document.xml'] !== undefined
  && new TextDecoder().decode(readZip(Buffer.from(r.files[0].b64, 'base64'))['word/document.xml'].data).includes('Выручка'));
r = packFiles('ответ без блока, но файл просили: ' + 'данные '.repeat(20), { wanted: true, format: 'csv', name: 'прайс', text: 'оформи в файл csv прайс' });
ok('B3: блок не пришёл — упаковываем ответ целиком, а не молчим',
  r.files.length === 1 && r.files[0].name === 'прайс.csv' && r.reply.length > 40, JSON.stringify(r.files.map((f) => f.name)));
ok('B4: короткий ответ не превращается в файл ради файла', packFiles('ок', { wanted: true }).files.length === 0);
r = packFiles('есть ```file:pdf|х\nконтент\n``` блок', {});
ok('B5: неизвестный формат — причина человеку, текст ответа цел',
  r.files.length === 0 && /формат «pdf» не упакован/.test(r.reply) && r.reply.includes('есть'), r.reply.slice(0, 90));
r = packFiles('```file\n# Только заголовок\n```', {});
ok('B6: модель молвила только блоком — подтверждение с настоящим весом',
  /^Готово: файл\.md \(\d+ б\)\.$/.test(r.reply) && r.files[0].mime === 'text/markdown', r.reply);
const four = ['docx', 'md', 'txt', 'csv'].map((f) => '```file:' + f + '|ф' + f + '\nсодержимое '.repeat(12) + '\n```').join('\n');
r = packFiles(four, {});
ok('B7: больше трёх файлов за ответ не отдаём — и говорим об этом',
  r.files.length === 3 && /больше трёх/.test(r.notes.join(' ')), r.files.length + '/' + r.notes.join(''));
ok('B8: формат и имя берутся из просьбы человека',
  formatFromText('сделай таблицу xlsx') === 'xlsx' && formatFromText('голым текстом') === 'txt'
  && nameFromText('оформи в файл смету на ремонт, пожалуйста') === 'смету на ремонт', '');
ok('B9: список форматов у инструмента и у постобработки один', Object.keys(FMT).join() === 'docx,xlsx,csv,txt,md,html', Object.keys(FMT).join());

console.log('C — движок: указание в промпте, файлы в ответе');
const ENV = { ODIROUTER_KEYS: 'od1', GROQ_KEYS: 'g1' };
/** запрос именно к модели: у вызова инструмента тела нет, и он идёт в списке раньше */
const modelCall = (calls) => calls.filter((c) => c.body && Array.isArray(c.body.messages))[0] || { body: { messages: [] } };
const run = (script, env, extra) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    /* у запроса инструмента (GET) тела нет — парсер не должен на этом падать */
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    const out = script(url, body, calls.length - 1);
    const txt = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    return { status: out.status == null ? 200 : out.status, text: async () => txt, json: async () => JSON.parse(txt) };
  };
  const eng = createEngine(Object.assign({ env: env || ENV, fetch: fetchImpl, sleep: async () => {} }, extra || {}));
  return { eng, calls };
};

{
  const answer = 'Держи: три пункта в файле.\n\n```file:docx|Список\n# Список\n\n- раз\n- два\n- три\n```\n';
  const { eng, calls } = run((url, body) => ({ body: { choices: [{ message: { content: answer } }] } }), ENV, {
    brave: null,
  });
  const res = await eng.run({ text: 'напиши короткий список из трёх пунктов и оформи это в файл docx', noCouncils: true, deadlineMs: 40000 });
  const sys = String(modelCall(calls).body.messages.find((m) => m.role === 'system').content);
  ok('C1: движок передал модели правило оформления блока',
    sys.includes('【Файл】') && sys.includes('```file:docx|'), sys.slice(-140));
  ok('C2: навыки и их объяснение механизма едут в системный промпт',
    sys.includes('【Активные навыки') && sys.includes('[Инструмент: …]'), '');
  ok('C3: файл пришёл в ответе, блок из текста вынут',
    res.ok && res.files.length === 1 && res.files[0].name === 'Список.docx' && !res.reply.includes('```') && res.reply.includes('Держи'),
    JSON.stringify({ ok: res.ok, files: (res.files || []).length, reply: res.reply.slice(0, 60) }));
  ok('C4: вес и mime у файла настоящие', res.files[0].mime.includes('wordprocessingml') && res.files[0].size > 1000 && res.files[0].size === Buffer.from(res.files[0].b64, 'base64').length, '');
  ok('C5: навыки подписаны у ответа (для строки источника во фронте)',
    Array.isArray(res.skills) && res.skills.length > 0 && res.skills[0].title && res.skills[0].id, JSON.stringify(res.skills || []).slice(0, 90));
}

{
  const long = 'Ответ без блока, но достаточно длинный, чтобы его стоило упаковать в файл: 2+2 = 4.';
  const { eng, calls } = run((url, body) => ({ body: { choices: [{ message: { content: long } }] } }), ENV);
  const res = await eng.run({ text: 'посчитай 2+2 и пришли файлом', noCouncils: true, deadlineMs: 40000 });
  const sys = String(modelCall(calls).body.messages.find((m) => m.role === 'system').content);
  ok('C6: блок не пришёл — ответ упакован автоматом, текст не потерян',
    res.ok && res.files.length === 1 && res.reply === long, JSON.stringify((res.files || []).map((f) => f.name)));
  ok('C7: указание про файл было в промпте до ответа', sys.includes('Человек просит файл'), '');
}

{
  const { eng, calls } = run((url, body) => ({ body: { choices: [{ message: { content: 'ок' } }] } }), ENV);
  await eng.run({ text: 'оформи в файл docx', noCouncils: true, useTools: false, deadlineMs: 40000 });
  const sys = String(modelCall(calls).body.messages.find((m) => m.role === 'system').content);
  ok('C8: useTools=false — ни указаний, ни навыков: модель видит только человека',
    !sys.includes('【Файл】') && !sys.includes('【Активные навыки'), sys.slice(-100));
  const r2 = await eng.run({ text: 'оформи в файл docx', noCouncils: true, skills: false, deadlineMs: 40000 });
  const sys2 = String(modelCall(calls.slice(1)).body.messages.find((m) => m.role === 'system').content);
  ok('C9: skills=false снимает навыки, но инструменты остаются',
    !sys2.includes('【Активные навыки') && sys2.includes('【Файл】') && !r2.skills, sys2.slice(-80));
}

{
  /* навык сам зовёт инструмент: картинки в запросе нет, триггер поиска срабатывает,
     но проверим, что данные инструмента доходят до модели блоком */
  const { eng, calls } = run((url, body) => {
    if (String(url).includes('commons.wikimedia.org')) {
      return { body: { query: { pages: { 1: { index: 1, title: 'File:Тигр.jpg', imageinfo: [{ url: 'https://u/1.jpg', thumburl: 'https://u/1-t.jpg', extmetadata: { Artist: { value: 'Фотограф' }, LicenseShortURL: { value: 'https://cc/by' } } }] } } } } };
    }
    return { body: { choices: [{ message: { content: 'вот фото' } }] } };
  }, ENV);
  const res = await eng.run({ text: 'найди картинку с тигром', noCouncils: true, deadlineMs: 40000 });
  const userMsg = String(modelCall(calls).body.messages.filter((m) => m.role === 'user').pop().content);
  ok('C10: данные поиска картинок подложены в сообщение блоком',
    userMsg.includes('[Инструмент: Поиск картинок]') && userMsg.includes('https://u/1-t.jpg') && userMsg.includes('cc/by'), userMsg.slice(0, 120));
  ok('C11: инструмент попал в подпись ответа', res.tools.includes('image-search'), res.tools.join());
}

console.log('D — Telegram: документ уходит multipart-ом');
{
  const sent = [];
  const out = await handleUpdate({
    update: { message: { chat: { id: 7, type: 'private' }, from: { id: 7, is_bot: false }, text: 'сделай файл' } },
    env: {},
    ask: async () => ({ ok: true, reply: 'готово', files: [{ name: 'отчёт.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 4397, b64: Buffer.from('a'.repeat(400)).toString('base64') }] }),
    post: async (method, payload, file) => { sent.push({ method, payload, file }); return { status: 200 }; },
  });
  const doc = sent.find((s) => s.method === 'sendDocument');
  ok('D1: после текста отправлен sendDocument с настоящим именем и типом',
    !!doc && doc.file.filename === 'отчёт.docx' && doc.file.type.includes('wordprocessingml') && doc.file.bytes.length === 400, JSON.stringify(sent.map((s) => s.method)));
  ok('D2: подпись к документу — имя, вес и метадвижка', /отчёт\.docx · 4,3 КБ/.test(doc.payload.caption), doc.payload.caption);
  ok('D3: счётчик отправленных файлов виден снаружи', out.files.join() === 'отчёт.docx', JSON.stringify(out.files));

  const bad = [];
  const out2 = await handleUpdate({
    update: { message: { chat: { id: 7, type: 'private' }, from: { id: 7, is_bot: false }, text: 'сделай файл' } },
    env: {},
    ask: async () => ({ ok: true, reply: 'готово', files: [{ name: 'x.docx', mime: 'x', size: 4, b64: Buffer.from('abcd').toString('base64') }] }),
    post: async (method, payload, file) => { bad.push(method); if (method === 'sendDocument') throw new Error('Bot API отверг файл'); return { status: 200 }; },
  });
  ok('D4: не отправился файл — человек слышит причину, а не тишину',
    out2.sent.some((t) => /не отправить не вышло|не вышло: Bot API отверг/.test(t)) && /Bot API/.test(out2.fileError || ''), out2.sent.join(' | ').slice(-90));
}

console.log('E — эндпоинты: человек видит файлы и навыки');
{
  const real = globalThis.fetch;
  const seen = [];
  const answer = 'Вот записка.\n\n```file:md|Записка\n# Записка\n\n- не забыть\n```\n';
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const chat = await import('../functions/api/chat.js');
  const waits = [];
  const resPost = await chat.onRequestPost({
    request: new Request('https://metiger.example/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'напиши записку из одного пункта и оформи в файл markdown', chatId: 'filegen-e2e', provider: 'odirouter' }),
    }),
    env: { ODIROUTER_KEYS: 'od1' },
    waitUntil: (pr) => { waits.push(Promise.resolve(pr)); },
  });
  const dj = await resPost.json();
  ok('E1: /api/chat принёс файл человеку: имя, mime, вес и base64 целиком',
    resPost.status === 200 && dj.ok === true && dj.files.length === 1 && dj.files[0].name === 'Записка.md'
    && dj.files[0].mime === 'text/markdown' && Buffer.from(dj.files[0].b64, 'base64').toString('utf8').includes('не забыть') && !dj.reply.includes('```'),
    JSON.stringify({ files: (dj.files || []).map((f) => f.name), reply: String(dj.reply).slice(0, 50) }));
  ok('E2: и список навыков, которые правил этот ответ', Array.isArray(dj.skills) && dj.skills.length >= 1 && typeof dj.skills[0] === 'string', JSON.stringify(dj.skills || []));
  ok('E3: запрос к модели нёс правило оформления и блок навыков в system', (() => {
    const mc = seen.filter((s) => s.body && s.body.messages).pop();
    const sys = String((mc.body.messages.find((m) => m.role === 'system') || {}).content || '');
    return sys.includes('【Файл】') && sys.includes('【Активные навыки');
  })(), '');
  await Promise.all(waits);
  globalThis.fetch = real;
}
{
  const skills = await import('../functions/api/skills.js');
  const res = await skills.onRequestGet({ request: new Request('https://metiger.example/api/skills?q=' + encodeURIComponent('переведи на английский')), env: {} });
  const d = await res.json();
  ok('E4: /api/skills отдаёт реестр целиком (351) и сводку по категориям',
    d.ok === true && d.total === 351 && d.items.length === 351 && d.groups.length === 25, JSON.stringify([d.total, d.items && d.items.length]));
  ok('E5: и что включится на живой вопрос — той же функцией, что в бою',
    d.onAsk.some((s) => s.id === 'translate') && !d.onAsk.some((s) => s.id === 'ad-lang'), JSON.stringify(d.onAsk.map((s) => s.id)));
  ok('E6: выключенные навыки видны с причиной, а не молча',
    d.items.filter((s) => s.off).length === 43 && d.reasons.some((x) => /загрузки файлов/.test(x)), String(d.off));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
