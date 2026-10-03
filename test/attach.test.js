/**
 * Вложения из Telegram (engine/attach.js) на поддельной сети.
 * Bot API подделан полностью: getFile и отдача файла. Проверяются лимиты, порядок
 * «фото → документ → голос», примечания о том, чего не умеем, и — обязательно —
 * что токен бота не утекает в причины ошибок.
 * Запуск: node test/attach.test.js
 */
import { parseMedia, createAttach, compose, readDocBytes, readVoiceBytes, DOC_CHARS, MAX_IMAGES } from '../engine/attach.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

const TXT = new TextEncoder().encode('отчёт за квартал\nвыручка,1200\nрасход,800\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const OGG = new Uint8Array(2048).fill(9);
/** Байты по формату: имя файла в Telegram ничего не гарантирует, и проверка должна
    видеть настоящую сигнатуру, а не совпадение букв в пути. */
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0].concat(Array.from(new TextEncoder().encode('метки камеры'))));
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50].concat(Array.from(new TextEncoder().encode('кадр'))));
const HEICB = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63].concat(Array.from(new TextEncoder().encode('raw с айфона'))));

const FILES = {
  'doc-1': { path: 'downloads/documents_report.txt', bytes: TXT },
  'doc-2': { path: 'downloads/documents_big.bin', bytes: new Uint8Array(4 * 1024 * 1024) },
  'ph-1': { path: 'downloads/photos_pic1.jpg', bytes: JPG },
  'ph-2': { path: 'downloads/photos_pic2.png', bytes: PNG },
  'ph-3': { path: 'downloads/photos_pic3.webp', bytes: WEBP },
  'ph-4': { path: 'downloads/photos_pic4.jpg', bytes: PNG },
  'ph-5': { path: 'downloads/photos_pic5.jpg', bytes: PNG },
  'ph-heic': { path: 'downloads/photos_pic6.jpg', bytes: HEICB },
  'voc-1': { path: 'downloads/audio_voice1.ogg', bytes: OGG },
  'vid-1': { path: 'downloads/video_clip1.mp4', bytes: new Uint8Array(12) },
  'doc-3': { path: 'downloads/documents_bad.docx', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
  'doc-4': { path: 'downloads/documents_long.txt', bytes: new TextEncoder().encode('строка '.repeat(6000)) },
};

/** Сеть Telegram: getFile → путь, /file/<путь> → байты. opt — что ломать. */
function tg(opt) {
  const o = opt || {};
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.indexOf('/botSEKRETNYTOKEN/') < 0 && url.indexOf('/file/') < 0) return new Response('нет такого метода', { status: 404 });
    if (url.indexOf('/getFile') >= 0) {
      if (o.getFileFails) return new Response(JSON.stringify({ ok: false, description: 'Bad Request: file id invalid' }), { status: 400 });
      const id = new URL(url).searchParams.get('file_id');
      const f = FILES[id];
      if (!f) return new Response(JSON.stringify({ ok: false, description: 'file not found' }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { file_id: id, file_path: o.noPath ? '' : f.path } }), { status: 200 });
    }
    const hit = Object.values(FILES).find((f) => url.indexOf('/file/' + f.path) >= 0);
    if (!hit) return new Response('не туда', { status: 404 });
    if (o.dlStatus) return new Response('нет доступа', { status: o.dlStatus });
    return new Response(hit.bytes, { status: 200, headers: { 'content-length': String(o.hideLen ? 0 : hit.bytes.length) } });
  };
  return { fetch, calls };
}

const sttOk = { transcribe: async () => ({ ok: true, text: 'Привет, это Тигр', via: 'groq/whisper-large-v3-turbo' }) };
const sttFail = { transcribe: async () => ({ ok: false, why: 'http 429 · квота', via: 'groq' }) };
const sttBoom = { transcribe: async () => { throw new Error('взрыв внутри слоя'); } };

console.log('A — разбор сообщения: что в нём есть');
{
  const m = parseMedia({ message: { text: 'привет' } });
  ok('A1: текст без вложений — слой сети не трогать', m.has === false && m.photos.length === 0 && m.document === null, JSON.stringify(m));
  const photo = parseMedia({ message: { photo: [{ file_id: 'a', file_size: 1000 }, { file_id: 'b', file_size: 90000 }, { file_id: 'c', file_size: 45000 }] } });
  ok('A2: из размеров фото берётся самый большой первым', photo.has && photo.photos[0].id === 'b' && photo.photos[1].id === 'c', JSON.stringify(photo.photos.map((p) => p.id)));
  const doc = parseMedia({ message: { document: { file_id: 'd', file_name: 'отчёт.pdf', mime_type: 'application/pdf', file_size: 12000 } } });
  ok('A3: pdf — это документ, а не картинка', doc.document && doc.document.name === 'отчёт.pdf' && doc.photos.length === 0, JSON.stringify(doc.document));
  const gif = parseMedia({ message: { document: { file_id: 'g', file_name: 'meme.gif', mime_type: 'image/gif', file_size: 900 } } });
  ok('A4: гифку и картинку-в-document отправляем зрению, а не читалке', gif.photos.length === 1 && gif.document === null && gif.photos[0].fromDocument === true, JSON.stringify(gif));
  const av = parseMedia({ message: { voice: { file_id: 'v', duration: 4, mime_type: 'audio/ogg' }, audio: { file_id: 'aa', duration: 60, file_name: 'trek.mp3' } } });
  ok('A5: голос и музыка различаются, длительность — числом', av.voice.id === 'v' && av.voice.seconds === 4 && av.audio.name === 'trek.mp3' && av.audio.mime === 'audio/mpeg', JSON.stringify({ v: av.voice, a: av.audio }));
  const mixed = parseMedia({ message: { video: { file_id: 'vv', file_size: 8000000 }, poll: { id: 1 }, sticker: { id: 2 }, contact: {} } });
  ok('A6: видео, опрос, стикер, визитка — замечены и названы', mixed.has && !!mixed.video && mixed.other.length === 3, JSON.stringify(mixed.other));
  const edited = parseMedia({ edited_message: { document: { file_id: 'e', file_name: 'x.txt' } } });
  ok('A7: edited_message разбирается так же', edited.document && edited.document.name === 'x.txt', JSON.stringify(edited).slice(0, 80));
  ok('A8: мусор вместо апдейта не роняет разбор', parseMedia(null).has === false && parseMedia({}).has === false && parseMedia({ message: 5 }).has === false);
}

console.log('\nB — скачивание и разбор');
{
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {}, stt: sttOk });
  const got = await a.take({ has: true, photos: [{ id: 'ph-1', size: 12 }], document: { id: 'doc-1', name: 'report.txt', mime: 'text/plain', size: TXT.length }, voice: { id: 'voc-1', seconds: 3, mime: 'audio/ogg' }, audio: null, video: null, other: [] });
  ok('B1: фото дошло до модели как data-URL', got.images.length === 1 && /^data:image\/jpeg;base64,/.test(got.images[0]), String(got.images[0]).slice(0, 40));
  ok('B2: текстовый файл прочитан и описан одной строкой', got.docs.length === 1 && got.docs[0].ok === true && /txt/.test(got.docs[0].line) && /выручка/.test(got.docs[0].text), JSON.stringify(got.docs[0]).slice(0, 200));
  ok('B3: голос расшифрован слоем STT', got.voiceText === 'Привет, это Тигр' && got.notes.length === 0, JSON.stringify(got).slice(0, 200));
}
{
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got = await a.take({ has: true, photos: [], voice: { id: 'voc-1', seconds: 3, mime: 'audio/ogg' }, other: [] });
  ok('B4: STT отсутствует — сказано прямо, а не пусто', /не подключено/.test(got.notes.join(' ')) && got.voiceText === '', JSON.stringify(got.notes));
  const b = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {}, stt: sttFail });
  const got2 = await b.take({ has: true, photos: [], voice: { id: 'voc-1', seconds: 3, mime: 'audio/ogg' }, other: ['опрос'] });
  ok('B5: отказ расшифровки — примечание с причиной и источником', /не расшифрована/.test(got2.notes.join(' ')) && /groq/.test(got2.notes.join(' ')), JSON.stringify(got2.notes));
  ok('B6: про опрос человек тоже слышит словами', /опрос разбираю не умею/.test(got2.notes.join(' ')), JSON.stringify(got2.notes));
  const c = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {}, stt: sttBoom });
  const got3 = await c.take({ has: true, photos: [], voice: { id: 'voc-1', seconds: 3, mime: 'audio/ogg' }, other: [] });
  ok('B7: взрыв внутри STT не ломает обработку сообщения', got3.docs.length === 0 && /взрыв внутри слоя/.test(got3.notes.join(' ')), JSON.stringify(got3.notes));
}
{
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg({ getFileFails: true }).fetch, log: () => {} });
  const got = await a.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  const all = got.notes.join(' ') + JSON.stringify(got.docs);
  ok('B8: getFile отказал — причина есть, а токена в ней нет', /не получен/.test(all) && all.indexOf('SEKRETNYTOKEN') < 0 && all.indexOf('bot') < 0, JSON.stringify(all).slice(0, 160));
  const bad = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg({ dlStatus: 403 }).fetch, log: () => {} });
  const got2 = await bad.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  ok('B9: отдача файла 403 — сказано по-человечески, без URL', /не скачался: http 403/.test(got2.notes.join(' ')) && got2.notes.join(' ').indexOf('https://') < 0, JSON.stringify(got2.notes));
  const ntok = createAttach({ env: {}, fetch: tg().fetch, log: () => {} });
  const got3 = await ntok.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  ok('B10: без ключа бота файлы не качаем и говорим про ключ', /ключа бота нет/.test(got3.notes.join(' ')), JSON.stringify(got3.notes));
  const noNet = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: () => { throw new Error('сети тут быть не должно'); }, log: () => {} });
  const got4 = await noNet.take({ has: false, photos: [], other: [] });
  ok('B11: нет вложений — ни одного запроса', got4.tried === 0 && got4.notes.length === 0, JSON.stringify(got4));
  const off = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN', ATTACH: 'off' }, fetch: tg().fetch, log: () => {} });
  const got5 = await off.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  ok('B12: ATTACH=off — слой отключён словами и молча в сеть не ходит', /выключены \(ATTACH=off\)/.test(got5.notes.join(' ')) && got5.tried === 0, JSON.stringify(got5));
}
{
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got = await a.take({ has: true, photos: ['ph-1', 'ph-2', 'ph-3', 'ph-4', 'ph-5'].map((id) => ({ id })), other: [] });
{
  /* Имя обещает .jpg, внутри HEIC: раньше байты уходили модели под ярлыком
     image/jpeg, и «картинки не вижу» было неотличимо от настоящей поломки. */
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got = await a.take({ has: true, photos: [{ id: 'ph-heic', size: 12 }], other: [] });
  ok('B17: HEIC под именем .jpg не притворяется jpeg — назван формат и сказано, что прислать',
    got.images.length === 0 && /HEIC/.test(got.notes.join(' ')) && /JPEG или PNG/.test(got.notes.join(' ')),
    JSON.stringify({ i: got.images.length, n: got.notes }));
}
  ok('B13: фото больше трёх — смотрим три, и это сказано', got.images.length === MAX_IMAGES && /смотрю первые 3/.test(got.notes.join(' ')), JSON.stringify({ n: got.images.length, notes: got.notes }));
  const mimes = got.images.map((d) => d.slice(5, d.indexOf(';')));
  ok('B14: mime картинки берётся из байт (имя файла не указ), jpeg/png/webp различаются', mimes[0] === 'image/jpeg' && mimes[1] === 'image/png' && mimes[2] === 'image/webp', JSON.stringify(mimes));
  const big = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN', ATTACH_MAX_DOC: String(256 * 1024) }, fetch: tg().fetch, log: () => {} });
  const got2 = await big.take({ has: true, photos: [], document: { id: 'doc-2', name: 'big.bin', size: 4 * 1024 * 1024 }, other: [] });
  ok('B15: файл через потолок не читается, а отклоняется с цифрами', got2.docs.length === 1 && got2.docs[0].ok === false && /потолок 0\.25 МБ|потолок/.test(got2.docs[0].why), JSON.stringify(got2.docs[0]).slice(0, 200));
  const noLen = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN', ATTACH_MAX_PHOTO: String(64 * 1024) }, fetch: tg({ hideLen: true }).fetch, log: () => {} });
  const got3 = await noLen.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  ok('B16: без content-length потолок проверяется по факту байтов', got3.images.length === 1, JSON.stringify(got3.notes));
  const zipBomb = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got4 = await zipBomb.take({ has: true, photos: [], document: { id: 'doc-3', name: 'bad.docx', size: 12 }, other: [] });
  ok('B17: мусор под видом docx — честная причина вместо пустого текста',
    got4.docs[0].ok === false && String(got4.docs[0].why).length > 8, JSON.stringify(got4.docs[0]).slice(0, 200));
  const noPath = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg({ noPath: true }).fetch, log: () => {} });
  const got5 = await noPath.take({ has: true, photos: [{ id: 'ph-1' }], other: [] });
  ok('B17a: Telegram не вернул путь — сказано ровно это, и файл не качаем в пустоту', /не вернул путь/.test(got5.notes.join(' ')), JSON.stringify(got5.notes));
  const notThere = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got6 = await notThere.take({ has: true, photos: [{ id: 'нет-такого' }], other: [] });
  ok('B17b: чужого file_id не стесняемся: «не получен» и ни одного запроса за файлом', got6.calls === undefined && /не получен/.test(got6.notes.join(' ')), JSON.stringify(got6.notes));
}
{
  const a = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'T' }, fetch: tg().fetch, log: () => {} });
  const st = a.stats();
  ok('B18: stats — флаги и лимиты, токена там нет', st.on === true && st.token === true && st.photos === 3 && JSON.stringify(st).indexOf('SEKRET') < 0 && st.docFormats.indexOf('pdf') >= 0, JSON.stringify(st).slice(0, 200));
  ok('B19: потолки не уезжают ниже разумного, что бы ни написали в env', createAttach({ env: { ATTACH_MAX_PHOTO: '1', ATTACH_DOC_CHARS: '10' }, fetch: tg().fetch, log: () => {} }).limits.photo === 64 * 1024 && createAttach({ env: { ATTACH_DOC_CHARS: '10' }, fetch: tg().fetch, log: () => {} }).limits.chars === 2000, JSON.stringify(createAttach({ env: { ATTACH_MAX_PHOTO: '1', ATTACH_DOC_CHARS: '10' }, fetch: tg().fetch }).limits));
}

console.log('\nC — сборка текста для движка');
{
  const got = { images: ['data:image/jpeg;base64,AAA'], docs: [{ name: 'отчёт.pdf', ok: true, line: 'pdf · 40 симв.', text: 'Итоги квартала' }], voiceText: 'Привет, это Тигр', notes: ['видео 12 МБ я не смотрю', 'опрос разбираю не умею — опиши словами'] };
  const media = { has: true, photos: [{ id: 'p' }], voice: { id: 'v' } };
  const c = compose(media, got, 'И вот ещё подпись');
  ok('C1: голос помечен, подпись человека рядом не теряется, файл — отдельным блоком',
    c.text.indexOf('[Голосом: Привет, это Тигр]\nИ вот ещё подпись') === 0 && /\[Файл: отчёт\.pdf · pdf · 40 симв\.\]\nИтоги квартала/.test(c.text), JSON.stringify(c.text));
  ok('C2: картинки уходят отдельным полем, файлов — один', c.images.length === 1 && c.files === 1, JSON.stringify({ i: c.images.length, f: c.files }));
  ok('C3: примечания идут списком в конце', /· видео 12 МБ/.test(c.text) && /· опрос/.test(c.text) && c.notes.length === 2, JSON.stringify(c.notes));
  const onlyVoice = compose({ has: true, voice: { id: 'v' } }, { images: [], docs: [], voiceText: 'Только голос, ни слова текстом', notes: [] }, '');
  ok('C4: голос без подписи — реплика уходит как есть, без скобок', onlyVoice.text === 'Только голос, ни слова текстом', JSON.stringify(onlyVoice.text));
  const badDoc = compose({ has: true, document: { id: 'd' } }, { images: [], docs: [{ name: 'a.doc', ok: false, why: 'старый бинарный формат' }], notes: [] }, '');
  ok('C5: непрочитанный файл описан в тексте, а не проглочен', /^\[Файл: a\.doc — старый бинарный формат\]$/.test(badDoc.text) && badDoc.files === 1, JSON.stringify(badDoc.text));
  const nothing = compose({ has: true }, { images: [], docs: [], notes: ['фото не скачалось'] }, '');
  ok('C6: ход без слов и без расшифровки — не пустой запрос', /ни слов, ни расшифровки/.test(nothing.text) && /· фото не скачалось/.test(nothing.text), JSON.stringify(nothing.text));
  const empty = compose({ has: true }, { images: [], docs: [], notes: [] }, '');
  ok('C7: совсем пусто — движок всё равно получает внятную просьбу', empty.text.length > 10 && /Посмотри/.test(empty.text), JSON.stringify(empty.text));
  const long = compose({ has: true }, { images: [], docs: [{ name: 'x.txt', ok: true, line: 'txt', text: 'ю'.repeat(200000) }], notes: [] }, '');
  ok('C8: текст файла под потолком — 120 КБ на ход больше не пролезает', long.text.length <= 120000, String(long.text.length));
  ok('C9: DOC_CHARS — сколько текста файла действительно доезжает до модели', DOC_CHARS === 24000 && createAttach({ env: { ATTACH_DOC_CHARS: '3000' }, fetch: tg().fetch, log: () => {} }).limits.chars === 3000, JSON.stringify(DOC_CHARS));
  const a4 = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN', ATTACH_DOC_CHARS: '3000' }, fetch: tg().fetch, log: () => {} });
  const got2 = await a4.take({ has: true, photos: [], document: { id: 'doc-4', name: 'long.txt' }, other: [] });
  ok('C10: длинный файл резуется потолком слоя и обрыв помечен словами',
    got2.docs[0].ok === true && got2.docs[0].text.length <= 3100 && /дальше файл не показываем/.test(got2.docs[0].text), JSON.stringify({ len: got2.docs[0].text && got2.docs[0].text.length, tail: got2.docs[0].text && got2.docs[0].text.slice(-40) }));
  const a5 = createAttach({ env: { TELEGRAM_BOT_TOKEN: 'SEKRETNYTOKEN' }, fetch: tg().fetch, log: () => {} });
  const got3 = await a5.take({ has: true, photos: [], document: { id: 'doc-4', name: 'long.txt' }, other: [] });
  ok('C11: без env потолок по умолчанию — 24000 знаков файла', got3.docs[0].text.length <= DOC_CHARS + 40 && got3.docs[0].chars > DOC_CHARS, JSON.stringify({ shown: got3.docs[0].text.length, all: got3.docs[0].chars }));
}

console.log('\nD — общий разбор байтов: он же для Telegram, он же для браузера');
{
  const d = readDocBytes(TXT, 'отчёт.txt', {});
  ok('D1: байты → блок с описанием и размером, как его видит модель',
    d.ok === true && d.name === 'отчёт.txt' && /txt · \d+ симв\./.test(d.line) && d.bytes === TXT.length && /выручка/.test(d.text), JSON.stringify({ line: d.line, bytes: d.bytes }));
  const long = new TextEncoder().encode('строка '.repeat(2000));
  const cut = readDocBytes(long, 'длинно.txt', { chars: 3000 });
  ok('D2: потолок знаков и пометка об обрыве — на месте',
    cut.ok === true && cut.chars > 3000 && cut.text.length <= 3100 && /дальше файл не показываем/.test(cut.text), JSON.stringify({ all: cut.chars, shown: cut.text.length }));
  const floor = readDocBytes(long, 'длинно.txt', { chars: '1' });
  ok('D2a: потолок не опускается ниже 2000 знаков, что бы ни написали в env',
    floor.text.length > 1900 && floor.text.length <= 2100, String(floor.text.length));
  const junk = readDocBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'битый.docx', {});
  ok('D3: мусор под видом docx — ок=false и причина словами', junk.ok === false && String(junk.why).length > 8, JSON.stringify(junk).slice(0, 160));
  ok('D4: числовой потолок принимает и строку из env, и мусор (падает на дефолт)',
    readDocBytes(TXT, 'x.txt', { chars: 'abc' }).ok === true && readDocBytes(TXT, 'x.txt', {}).text.length > 0);
  const v0 = await readVoiceBytes(new Uint8Array([1, 2, 3]), 'audio/ogg', {});
  ok('D5: слоя STT нет — причина названа, исключения нет', v0.ok === false && /слоя STT нет/.test(v0.why), JSON.stringify(v0));
  const v1 = await readVoiceBytes(new Uint8Array([1, 2, 3]), 'audio/ogg', { stt: { transcribe: async () => ({ ok: true, text: 'текст', via: 'groq/m' }) } });
  ok('D6: расшифровка прошла — текст и источник идут как есть', v1.ok === true && v1.text === 'текст' && v1.via === 'groq/m', JSON.stringify(v1));
  const v2 = await readVoiceBytes(new Uint8Array([1, 2, 3]), 'audio/ogg', { stt: { transcribe: async () => { throw new Error('взрыв'); } } });
  ok('D7: взрыв внутри STT → причина словом (браузер не должен получить 500)', v2.ok === false && /взрыв/.test(v2.why), JSON.stringify(v2));
  const v3 = await readVoiceBytes(new Uint8Array(0), 'audio/ogg', { stt: { transcribe: async () => ({ ok: true, text: 'x' }) } });
  ok('D8: пустые байты не идут в сеть вообще', v3.ok === false && /пустая/.test(v3.why), JSON.stringify(v3));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
