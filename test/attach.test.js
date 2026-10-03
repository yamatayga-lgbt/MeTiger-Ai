/**
 * Общий слой вложений (engine/attach.js): то, на чём сидит вход сайта.
 * Проверяются признак картинки по сигнатуре байтов, лимиты, порядок «файл → голос →
 * подпись» и примечания о том, чего не умеем. Сети нет: только чистые функции.
 * Запуск: node test/attach.test.js
 */
import { compose, readDocBytes, readVoiceBytes, DOC_CHARS, MAX_IMAGES, IMAGE_NAME, sniffImageMime } from '../engine/attach.js';

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
}

console.log('\nD — общий разбор байтов: он и для файла из веба, и для скриншота');
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

console.log('\nE — картинка по сигнатуре байтов (правило одно на фронт и эндпоинт)');
{
  ok('E1: png/jpeg/webp по байтам, даже если имя и mime врут',
    sniffImageMime(PNG).indexOf('image/png') === 0 && sniffImageMime(JPG).indexOf('image/jpeg') === 0
      && sniffImageMime(WEBP) === 'image/webp', [sniffImageMime(PNG), sniffImageMime(JPG), sniffImageMime(WEBP)].join());
  ok('E2: heic узнаётся как heic — его нельзя выдать за jpeg', /heic|heif/.test(sniffImageMime(HEICB)), sniffImageMime(HEICB));
  ok('E3: текст под видом картинки не проходит, пустые байты не падают',
    sniffImageMime(TXT) === '' && sniffImageMime(new Uint8Array(0)) === '');
  ok('E4: имена-картинки, которые пускает слой, совпадают со списком фронта',
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'jfif']
      .every((e) => IMAGE_NAME.test('файл.' + e)) && !IMAGE_NAME.test('отчёт.txt'), IMAGE_NAME.source);
  ok('E5: картинок принимается ровно две — как у фронта и у /api/chat', MAX_IMAGES === 2, String(MAX_IMAGES));
  ok('E6: compose не теряет ни файла, ни примечания, и не оставляет пустого хода',
    /\[Файл: a\.txt/.test(compose({ has: true }, { images: [], docs: [{ name: 'a.txt', ok: true, line: 'txt · 3', text: 'раз' }], notes: ['gif тяжёлый'] }, '').text)
      && compose({ has: true }, { images: [], docs: [], notes: [] }, '').text.length > 10);
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
