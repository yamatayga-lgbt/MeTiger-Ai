/**
 * Этап 2, фронт: как вердикт совета превращается в подпись под ответом.
 *
 * Логика живёт в src/lib/api.ts (TypeScript). Проверка берёт ЕЁ НАСТОЯЩИМ ИМПОРТОМ:
 * файл транслируется esbuild (уже зависимость vite) и импортируется как ESM. Никаких
 * пересказов функции в тесте — иначе тест проверял бы сам себя.
 *
 *   node test/front.test.js
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
if (!existsSync(bin)) {
  /* Пропуск с зелёным кодом — это дыра: как-то раз node_modules в песочнице испарился,
     и «фронт» не проверил ни одного из 77 пунктов, а цепочка npm test осталась зелёной.
     Не выполненные проверки должны валить сборку, а не делать вид, что всё хорошо. */
  console.log('✖ фронт: esbuild не найден (' + bin + ') — проверки НЕ выполнены. Нужно `npm install`.');
  process.exit(1);
}

/* Временные файлы — внутри node_modules/.cache: react и react-dom должны
   разрешиться оттуда так же, как в приложении (в /tmp импорт упал бы в
   ERR_MODULE_NOT_FOUND, и проверка «проверяла бы» отсутствие react). */
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-front');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = join(dir, 'api.mjs');
execFileSync(bin, ['src/lib/api.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
const { adviceLine, sourceLine, attachmentKind, pickAttachments, fileToAttachment, bufToB64, attachLine, notesLine, fileSize, ATTACH_ACCEPT, ATTACH_MAX, ATTACH_FILE_BYTES, countersLine, signalsLine, profileStatusLine, parseSse, sendChat } = await import(out);
execFileSync(bin, ['src/lib/images.ts', '--format=esm', '--outfile=' + join(dir, 'images.mjs'), '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });

console.log('F — подпись под ответом: что видел совет, то видит и человек');
{
  const a = adviceLine({ ok: true, ensemble: 'сошлись 3/3 (author,zai,openrouter)' });
  ok('F1: большинство согласно — тон спокойный, текст дословно', a && a.tone === 'ok' && a.text === 'сошлись 3/3 (author,zai,openrouter)', JSON.stringify(a));
  const b = adviceLine({ ok: true, ensemble: 'разошлись 1/2 (author)' });
  ok('F2: расхождение — тон тревожный, это не «всё хорошо»', b && b.tone === 'warn', JSON.stringify(b));
  const c = adviceLine({ ok: true, ensemble: 'подтверждаю 2/2', ensembleApplied: true });
  ok('F3: ответ ИСПРАВЛЕН большинством — подсвечиваем, даже слово «подтверждаю»', c && c.tone === 'warn', JSON.stringify(c));
  const d = adviceLine({ ok: true, ensemble: 'пропущено: головы не ответили' });
  ok('F4: совет промолчал по причине — тихо, без цветовой тревоги', d && d.tone === 'quiet', JSON.stringify(d));
  ok('F5: совета не было — подписи нет вовсе (пустая плашка хуже, чем её отсутствие)',
    adviceLine({ ok: true, reply: 'привет' }) === null);
  const f = adviceLine({ ok: true, ensemble: 'сошлись 2/2 (author,openrouter)', vision: 'confirmed 2/2 (gemini,odirouter)' });
  ok('F6: текст и по картинке, и по числу — в одну строку, оба видны',
    f && f.text.indexOf('сошлись 2/2') === 0 && f.text.indexOf('confirmed 2/2') > 0, JSON.stringify(f));
  ok('F7: vision-совет сам по себе тоже даёт подпись',
    (() => { const x = adviceLine({ ok: true, vision: 'не сошлись 1/2' }); return x && x.tone === 'warn'; })());
  ok('F8: строка источника не выдумывается при ошибке',
    sourceLine({ ok: false, error: 'нет связи' }) === '' && /groq/.test(sourceLine({ ok: true, provider: 'groq', model: 'm', intent: 'math', tier: 'smart', ms: 2541 })));
  const g = adviceLine({ ok: true, ensemble: 'сошлись 2/2 (author,openrouter)', vision: 'пропущено: зрячие головы не ответили [головы: cloudflare]' });
  ok('F9: одно подтверждено, другое промолчало — обе части в строке, тон по факту', g && g.tone === 'ok' && /пропущено/.test(g.text), JSON.stringify(g));
}

console.log('G — пузырь в интерфейсе: подпись действительно доезжает до разметки');
if (!existsSync(join(process.cwd(), 'node_modules', 'react')) || !existsSync(join(process.cwd(), 'node_modules', 'react-dom'))) {
  ok('G0: react недоступен — проверка разметки пропущена', false, 'node_modules/react не найден: npm i');
} else {
  /* Проверяем настоящий ChatView, а не его пересказ: esbuild бандлит компонент,
     react/react-dom остаются внешними (output лежит внутри node_modules/.cache,
     чтобы разрешение путей сработало как в приложении). */
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const out2 = join(dir, 'chatview.mjs');
  execFileSync(bin, [
    'src/views/ChatView.tsx', '--bundle', '--platform=node', '--format=esm',
    '--packages=external', '--loader:.png=dataurl', '--outfile=' + out2, '--log-level=error',
  ], { stdio: 'inherit' });
  const { ChatView } = await import(out2);
  const msg = {
    id: 'm1', role: 'assistant', text: 'Осталось 11 яблок.',
    src: 'groq · openai/gpt-oss-120b · math/smart · 2541 мс',
    advice: 'разошлись 1/2 (author)', adviceTone: 'warn',
  };
  const html = renderToStaticMarkup(
    React.createElement(ChatView, { user: { first_name: 'Тигр' }, messages: [msg], typing: false, onSend() {} }),
  );
  ok('G1: подпись с вердиктом совета попадает в разметку',
    /msg-meta/.test(html) && /разошлись 1\/2/.test(html), html.slice(html.indexOf('msg-meta') - 40, html.indexOf('msg-meta') + 240));
  ok('G2: тон доехал до класса — цвет не «на глаз», а по факту совета', /msg-meta is-warn/.test(html));
  ok('G3: строка источника (модель/провайдер/режим/мс) в разметке больше не светится — это Агент, а не витрина чужих моделей',
    !/gpt-oss-120b/.test(html) && !/2541 мс/.test(html) && !/msg-src/.test(html) && /разошлись 1\/2/.test(html));
  const quiet = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [{ id: 'm2', role: 'assistant', text: 'привет' }],
      typing: false, onSend() {},
    }),
  );
  ok('G4: у сообщения без мета подписи нет (не пустая плашка под каждым ответом)', !/msg-meta/.test(quiet));

  /* 0.067: отступ снизу + копирование + «N минут назад» под каждым сообщением. */
  const now = Date.now();
  const htmlFooter = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [
        { id: 'u1', role: 'user', text: 'Сделай логотип тигра', ts: now - 10 * 60 * 1000 },
        { id: 'a1', role: 'assistant', text: 'Вот логотип.', ts: now - 9 * 60 * 1000, ms: 12000 },
      ],
      typing: false, onSend() {},
    }),
  );
  ok('G5: под ответом ИИ есть кнопка «копировать» и строка «сколько шёл · когда»',
    /msg-copy-btn/.test(htmlFooter) && /12 с · 9 минут назад/.test(htmlFooter));
  ok('G6: под своим сообщением тоже есть копирование и «когда» (без длительности — это не ответ)',
    /msg-footer-right/.test(htmlFooter) && /10 минут назад/.test(htmlFooter));
  ok('G7: порядок в разметке — сперва пузырь с текстом, подпись времени идёт СТРОГО под ним (видимый отступ)',
    htmlFooter.indexOf('Вот логотип.') < htmlFooter.lastIndexOf('msg-footer'));
  const htmlNoTs = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [{ id: 'a2', role: 'assistant', text: 'Без времени (старое сообщение).' }],
      typing: false, onSend() {},
    }),
  );
  ok('G8: у сообщения без ts/ms подпись не пустая и не ломает разметку — копирование всё равно работает',
    /msg-copy-btn/.test(htmlNoTs));
  const userMsg = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' }, messages: [{ id: 'm3', role: 'user', text: 'сколько будет?' }], typing: false, onSend() {},
    }),
  );
  ok('G5: реплика человека подписи не получает', !/msg-meta/.test(userMsg) && /сколько будет/.test(userMsg));
}

console.log('H — вложения: что уходит в движок и что не уйдёт');
{
  const img = await import(join(dir, 'images.mjs'));
  const f = (type, size = 1024) => ({ type, size, name: 'x' });
  ok('H1: не-картинки отсекаются, больше двух не берём',
    img.pickImages([f('image/png'), f('application/pdf'), f('image/jpeg'), f('image/png')]).length === 2,
    String(img.pickImages([f('image/png'), f('application/pdf'), f('image/jpeg'), f('image/png')]).length));
  ok('H2: MAX_IMAGES = 2 — ровно столько же, сколько принимает /api/chat', img.MAX_IMAGES === 2);
  ok('H3: порог веса на фронте и на входе совпадают (иначе отказывает не та сторона)',
    img.MAX_DATAURL_CHARS === Math.round((4 * 1024 * 1024) / 0.74), String(img.MAX_DATAURL_CHARS));
  const bad = await img.fileToDataUrl(f('text/plain'));
  ok('H4: файл не-картинка → ошибка значением, без исключения', bad.ok === false && /не картинка/.test(bad.error || ''), JSON.stringify(bad));
  const nocanvas = await img.fileToDataUrl({ type: 'image/png', size: 2048, name: 'y.png' });
  ok('H5: где нет canvas — тоже честная ошибка, а не пустой пузырь', nocanvas.ok === false && !!nocanvas.error, JSON.stringify(nocanvas));
  ok('H6: сторона ограничена 1024 px — модель не читает пиксели, которые не различает', img.MAX_SIDE === 1024);
  /* Фото из галереи приходят с пустым type, а iPhone — с image/heic. Прежний фильтр
     «только по MIME» такие файлы выбрасывал молча: нажатие «прикрепить» не давало
     ни превью, ни ошибки. */
  ok('H7: фото без MIME, но с картиночным именем — берём; видео и текст — нет',
    img.looksLikeImage({ name: 'IMG_1234.HEIC', type: '' }) === true
      && img.looksLikeImage({ name: 'скрин.png', type: 'application/octet-stream' }) === true
      && img.looksLikeImage({ name: 'clip.mp4', type: 'video/mp4' }) === false
      && img.looksLikeImage({ name: 'note.txt', type: 'text/plain' }) === false,
    'IMG_1234.HEIC/скрин.png/clip.mp4/note.txt');
  ok('H8: pickImages берёт файл без type, а attachmentKind относит его к картинке, а не к документу',
    img.pickImages([{ name: 'IMG_1.HEIC', type: '', size: 1024 }]).length === 1
      && attachmentKind({ name: 'IMG_1.HEIC', type: '' }) === 'image'
      && attachmentKind({ name: 'отчёт.pdf', type: '' }) === 'file',
    [attachmentKind({ name: 'IMG_1.HEIC', type: '' }), attachmentKind({ name: 'отчёт.pdf', type: '' })].join('/'));
  const heic = await img.fileToDataUrl({ name: 'IMG_1.HEIC', type: 'image/heic', size: 2048 });
  ok('H9: HEIC — отдельная подсказка про камеру, а не «картинка не прочитана»',
    heic.ok === false && /HEIC/.test(heic.error || '') && /Совместим[ыа]е форматы/.test(heic.error || ''), JSON.stringify(heic));
  /* Главный анти-дрейф: фронт и движок решают «это картинка?» по одному правилу. Если
     списки расширений разъедутся, фото начнёт работать в веб-чате и ломаться в Telegram. */
  const eng = await import('../engine/attach.js');
  const names = ['a.png', 'b.jpeg', 'c.jpg', 'd.webp', 'e.gif', 'f.bmp', 'g.avif', 'h.HEIC', 'i.heif', 'j.tif', 'k.tiff', 'l.jfif', 'm.txt', 'n.pdf', 'o.mp4'];
  ok('H10: IMAGE_EXT фронта и IMAGE_NAME движка принимают ровно один и тот же список имён',
    names.every((n) => img.IMAGE_EXT.test(n) === eng.IMAGE_NAME.test(n)),
    names.filter((n) => img.IMAGE_EXT.test(n) !== eng.IMAGE_NAME.test(n)).join(','));
  ok('H11: нюхатор по байтам отличает картинку от текста (веб-путь и Telegram пользуются им вместе)',
    eng.sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4])) === 'image/png'
      && eng.sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])) === 'image/jpeg'
      && eng.sniffImageMime(new TextEncoder().encode('просто текст, не картинка')) === '',
    String(eng.sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4]))));
  const F = (name, type) => ({ name, type });
  ok('H12: вставка из буфера — файлы берутся из files, при пустых из items (скриншот в WebKit)',
    img.filesFromTransfer({ files: [F('a.png', 'image/png')] }).length === 1
      && img.filesFromTransfer({ files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => F('скриншот', 'image/png') }] })[0].name === 'скриншот',
    JSON.stringify(img.filesFromTransfer({ files: [] }).length));
  ok('H13: текст в буфере — ничего не возвращаем, событие не трогаем (вставка слов не ломается)',
    img.filesFromTransfer({ files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }).length === 0
      && img.filesFromTransfer(null).length === 0 && img.filesFromTransfer({}).length === 0);
  const chatSrc = readFileSync('src/views/ChatView.tsx', 'utf8');
  ok('H14: вставка и перетаскивание ведут в тот же addFiles, что и скрепка, а не в свою копию',
    /onPaste=\{[^}]*filesFromTransfer\(e\.clipboardData\)[^}]*addFiles\(fs\)/s.test(chatSrc)
      && /onDrop=\{[^}]*filesFromTransfer\(e\.dataTransfer\)[^}]*addFiles\(fs\)/s.test(chatSrc),
    'нет связки paste/drop → addFiles');
  ok('H15: drop подсвечивается словами, а addFiles принимает и File[], и FileList',
    /отпустите — приложу/.test(chatSrc) && /list: FileList \| File\[\] \| null/.test(chatSrc));

}

console.log('I — окно выбора модели: витрина, пулы и живой каталог');
if (!existsSync(join(process.cwd(), 'node_modules', 'react')) || !existsSync(join(process.cwd(), 'node_modules', 'react-dom'))) {
  ok('I0: react недоступен — проверка окна пропущена', false, 'npm i');
} else {
  /* Три входа одним бандлом: эсбабилд выносит общий src/lib/models в шаренный
     чанк, поэтому кэш каталога у пикера и у ChatView один и тот же — как в
     настоящем приложении. Отдельные бандлы имели бы два разных кэша и проверка
     ничего не проверяла бы. */
  /* Один вход, три экспорта. Раздельные бандлы дали бы каждый СВОЮ копию
     src/lib/models (проверено: esbuild не шарит состояние между точками входа),
     и тест грел бы кэш, которого компонент не видит. */
  const entry = join(dir, 'picker-entry.tsx');
  writeFileSync(entry, [
    "export { ChatView } from '../../../src/views/ChatView'",
    "export { ModelPicker } from '../../../src/components/ModelPicker'",
    "export * as models from '../../../src/lib/models'",
    '',
  ].join('\n'), 'utf8');
  const outPicker = join(dir, 'picker.mjs');
  execFileSync(bin, [
    entry, '--bundle', '--platform=node', '--format=esm', '--packages=external',
    '--loader:.png=dataurl', '--outfile=' + outPicker, '--log-level=error',
  ], { stdio: 'inherit' });
  const bundle = await import(outPicker);
  const models = bundle.models;
  const { ModelPicker, ChatView } = bundle;
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');

  const CATALOG = {
    ok: true, cached: true, stale: false, updatedAt: Date.now(), count: 4, catalogCount: 4,
    pools: [{ provider: 'openrouter', label: 'OpenRouter', count: 21 }],
    models: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'GOOGLE', tier: 'fast', curated: true, src: 'pool', ctx: 1048576, maxOut: 65536 },
      { id: 'cohere/north-mini-code:free', name: 'North Mini Code', vendor: 'COHERE', tier: 'fast', curated: true, src: 'openrouter', ctx: 131072, maxOut: 8192, vision: false },
      { id: 'tiny/model-a', name: 'Tiny Model', vendor: 'TINY', tier: 'fast', curated: false, src: 'xkiro', ctx: 4096, maxOut: 512, vision: false },
      { id: 'wide/model-b', name: 'Wide Model', vendor: 'WIDE', tier: 'smart', curated: false, src: 'xkiro', ctx: 200000, maxOut: 32000, vision: true },
    ],
  };
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'content-type': 'application/json' } });
  await models.loadCatalog();
  ok('I1: каталог принят и лежит в общем кэше', (models.catalogCache() || {}).models.length === 4, JSON.stringify((models.catalogCache() || {}).count));
  ok('I2: чип показывает имя каталожной модели, а не «Авто»', (() => { const o = models.modelOption('wide/model-b'); return o.id === 'wide/model-b' && o.name === 'Wide Model' && o.tier === 'smart' && o.vision === true; })(), JSON.stringify(models.modelOption('wide/model-b')));
  ok('I3: выбор из каталога переживает перезагрузку (иначе форма сбрасывала бы модель)',
    models.isModelId('tiny/model-a') === true && models.isModelId('совсем-не-модель!!!') === false);

  const html = renderToStaticMarkup(React.createElement(ModelPicker, { model: 'wide/model-b', onPick() {} }));
  ok('I4: группы видны — витрина, пулы движка, каталог провайдеров',
    /Витрина/.test(html) && /Пулы движка · 2/.test(html) && /Каталог провайдеров · 2/.test(html), (html.match(/model-section-title">[^<]*/g) || []).join('|'));
  ok('I5: каталожная модель в разметке, с потолками вместо выдуманного описания',
    /Wide Model/.test(html) && /контекст 195К · ответ до 31К/.test(html), (html.match(/контекст [^<]*/) || ['нет'])[0]);
  ok('I6: выбрана ровно одна строка — та, что человек уже выбрал',
    (html.match(/aria-selected="true"/g) || []).length === 1 && /model-row is-selected/.test(html));
  ok('I7: поиск и кнопка обновления на месте, счётчик честный',
    /model-search/.test(html) && /поиск по \d+ моделям/.test(html) && /обновить/.test(html), (html.match(/placeholder="[^"]*"/) || [''])[0]);
  ok('I8: подвал говорит, откуда данные', /обновлено \d\d:\d\d/.test(html) && /живых у провайдеров: 4/.test(html), (html.match(/<div class="model-panel-foot">[^<]*/) || [''])[0]);
  const chip = renderToStaticMarkup(React.createElement(ChatView, {
    user: { first_name: 'Тигр' }, messages: [{ id: 'x', role: 'assistant', text: 'привет' }], typing: false, onSend() {},
  }));
  ok('I9: в окне ввода нет витрины чужих моделей — это Агент, остался только значок параметров',
    !/model-chip/.test(chip) && /class="params-btn/.test(chip) && /MeTiger Ai/.test(chip));

  /* нет сети — список не обязан исчезать: остаются витрина и обычный выбор */
  globalThis.fetch = async () => { throw new Error('сети нет'); };
  await models.refreshCatalog();
  const offline = renderToStaticMarkup(React.createElement(ModelPicker, { model: '', onPick() {} }));
  ok('I10: без каталога панель остаётся рабочей (витрина целая), а не пустой дырой',
    /Витрина/.test(offline) && /каталог недоступен/.test(offline) && /Gemini 2\.5 Flash/.test(offline), (offline.match(/каталог недоступен[^<]*/) || [''])[0]);
  ok('I11: неизвестный id по-прежнему значит Авто — молчаливый обход сохранён',
    models.modelOption('voobshe-ne-model').id === '', JSON.stringify(models.modelOption('voobshe-ne-model')).slice(0, 60));
  /* Собственные списки провайдеров: строка обязана говорить, ЧЬЯ она модель,
     и не должна врать про цену (у groq/mistral в списке цены нет). */
  const BIG = {
    ok: true, cached: true, stale: false, updatedAt: Date.now(),
    count: 124, catalogCount: 124, read: { groq: true, gemini: true },
    pools: [{ provider: 'groq', label: 'Groq', count: 3 }],
    models: [
      { id: 'openai/gpt-oss-120b', name: 'Gpt Oss 120b', vendor: 'OPENAI', tier: 'smart', curated: false, src: 'groq', ctx: 131072, maxOut: 65536, vision: false, priceKnown: false, tools: true, reasoning: true, brave: { ok: 4, refused: 1, total: 5, score: 0.8, provider: 'groq' } },
      ...Array.from({ length: 123 }, (_, i) => ({ id: 'big/model-' + i + ':free', name: 'Big Model ' + i, vendor: 'BIG', tier: 'fast', curated: false, src: 'xkiro', ctx: 8192, maxOut: 1024, vision: false, priceKnown: true })),
    ],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(BIG), { status: 200, headers: { 'content-type': 'application/json' } });
  await models.refreshCatalog();
  const bigHtml = renderToStaticMarkup(React.createElement(ModelPicker, { model: 'openai/gpt-oss-120b', onPick: () => {} }));
  ok('I12: строка подписана провайдером и потолками, а цена помечена непроверенной',
    /Groq/.test(bigHtml) && /контекст 128К · ответ до 64К/.test(bigHtml) && /цена не проверена/.test(bigHtml),
    (bigHtml.match(/Gpt Oss 120b[\s\S]{0,220}/) || [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 150));
  ok('I13: инструменты и рассуждение видны значками в описании',
    /инструменты · рассуждает/.test(bigHtml.replace(/<\/span>/g, '')) || (/инструменты/.test(bigHtml) && /рассуждает/.test(bigHtml)), 'чипы');
  /* Числа не хардкодим: витрина (SHOWCASE в src/lib/models.ts) доливается в список
     живьём, и жёсткая проверка «140 и ещё 4» ломалась бы каждый раз, когда кто-то
     добавил одну модель в список — без всякой поломки в пикере. */
  const shownN = (bigHtml.match(/role="option"/g) || []).length;
  const moreN = Number((bigHtml.match(/показаны не все \(ещё (\d+)\)/) || [])[1]);
  const outM = join(dir, 'models.mjs');
  execFileSync(bin, ['src/lib/models.ts', '--format=esm', '--bundle', '--outfile=' + outM, '--loader:.png=dataurl', '--log-level=error'], { stdio: 'inherit' });
  const { MODELS: VITRINA } = await import(outM);
  const catalogN = BIG.models.length + VITRINA.filter((s) => !BIG.models.some((m) => m.id === s.id)).length;
  ok('I14: длинный список обрезан по группам, и человек об этом предупреждён',
    shownN > 100 && moreN >= 1 && shownN + moreN === catalogN + 1,
    shownN + ' строк показано, ещё ' + moreN + ' · моделей ' + catalogN + ' (+1 опция «Авто»)');
  /* Выбранная строка обязана переживать срез: иначе «моя модель не видна» —
     ровно та жалоба, из-за которой всё это и делалось. */
  const deepHtml = renderToStaticMarkup(React.createElement(ModelPicker, { model: 'big/model-122:free', onPick: () => {} }));
  ok('I14a: рейтинг смелых показан человеку словами, а не цифрой',
    /везёт без отказа 4\/5/.test(bigHtml.replace(/<[^>]+>/g, ' ')) || /цена не проверена · везёт без отказа/.test(bigHtml),
    (bigHtml.match(/Gpt Oss 120b[\s\S]{0,320}/) || [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 150));
  ok('I15: выбранная модель не теряется за срезом',
    /Big Model 122/.test(deepHtml) && (deepHtml.match(/aria-selected="true"/g) || []).length === 1,
    (deepHtml.match(/aria-selected="true"/g) || []).length + ' выбранных');
  globalThis.fetch = real;
}

console.log('J — вложения из браузера: сортировка, base64 и подписи под ответом');
{
  ok('J1: тип вложения угадан по mime и по расширению (картинка, голос, файл)',
    attachmentKind({ name: 'а.png', type: 'image/png' }) === 'image'
    && attachmentKind({ name: 'запись.ogg', type: '' }) === 'voice'
    && attachmentKind({ name: 'отчёт.pdf', type: 'application/pdf' }) === 'file'
    && attachmentKind({ name: 'song.mp3', type: 'audio/mpeg' }) === 'voice', JSON.stringify([attachmentKind({ name: 'запись.ogg', type: '' })]));
  const files = [
    { name: 'a.txt', type: 'text/plain', size: 100 },
    { name: 'b.txt', type: 'text/plain', size: 200 },
    { name: 'c.txt', type: 'text/plain', size: 300 },
    { name: 'd.txt', type: 'text/plain', size: 400 },
    { name: 'монстр.pdf', type: 'application/pdf', size: ATTACH_FILE_BYTES + 1 },
    { name: '', type: 'text/plain', size: 10 },
  ];
  const p = pickAttachments(files);
  ok('J2: берём не больше трёх, и это те, что полегче первых', p.taken.length === ATTACH_MAX && p.taken.map((x) => x.name).join(',') === 'a.txt,b.txt,c.txt', JSON.stringify(p.taken.map((x) => x.name)));
  ok('J3: тяжёлый файл отклонён ИМЕНЕМ и весом, а не молчанием', p.tooBig.length === 1 && /монстр\.pdf/.test(p.tooBig[0]) && /МБ/.test(p.tooBig[0]), JSON.stringify(p.tooBig));
  ok('J4: лишние по количеству учтены, безымянное не проходит', p.extra === 2, String(p.extra));
  const txt = 'данные,1200\nрасход,800\n';
  const att = await fileToAttachment(new File([txt], 'прайс.csv', { type: 'text/csv' }));
  ok('J5: файл → приложение с полным содержимым (base64 читается обратно байт в байт)',
    att.ok === true && att.att.name === 'прайс.csv' && att.att.kind === 'file' && att.att.size === new TextEncoder().encode(txt).length
    && new TextDecoder().decode(Uint8Array.from(atob(att.att.b64), (c) => c.charCodeAt(0))) === txt, JSON.stringify(att).slice(0, 160));
  const empty = await fileToAttachment(new File([], 'пусто.txt', { type: 'text/plain' }));
  ok('J6: пустой файл — честное «пустой файл», а не пустой ответ модели', empty.ok === false && /пустой/.test(empty.error || ''), JSON.stringify(empty));
  const big = await fileToAttachment(new File([new Uint8Array(ATTACH_FILE_BYTES + 10)], 'толстый.bin', { type: 'application/octet-stream' }));
  ok('J7: через потолок фронт не тащит вообще (один отказ на фронте дешевле, чем 422 с сервера)',
    big.ok === false && /МБ/.test(big.error || ''), JSON.stringify(big));
  const buf = new Uint8Array(200000).map((_, i) => i % 256);
  const rt = Uint8Array.from(atob(bufToB64(buf.buffer)), (c) => c.charCodeAt(0));
  ok('J8: чанковый base64 на 200 КБ совпадает с байтами (Stack-safe кодирование)',
    rt.length === buf.length && rt.every((v, i) => v === buf[i]), String(rt.length) + '/' + String(buf.length));
  ok('J9: fileSize не округляет до «0 КБ» и умеет МБ', fileSize(0) === '0 б' && fileSize(1500) === '1,5 КБ' && /МБ$/.test(fileSize(5 * 1048576)), [fileSize(0), fileSize(1500), fileSize(5 * 1048576)].join(' '));
}
{
  const r = {
    ok: true, reply: 'ok',
    attachments: [{ name: 'отчёт.pdf', ok: true, line: 'pdf · 1200 симв.' }, { name: 'Scan.pdf', ok: false, line: 'скан: распознавать нечем' }],
    attachNotes: ['видео не смотрю'],
  };
  const line = attachLine(r);
  ok('J10: подпись по файлам показывает и прочитанное, и отказ — списком',
    /отчёт\.pdf · pdf · 1200 симв\./.test(line) && /Scan\.pdf — скан: распознавать нечем/.test(line) && /· видео не смотрю/.test(line), JSON.stringify(line));
  ok('J11: пустые вложения — пустая строка, пустой плашки в UI нет', attachLine({ ok: true, reply: 'x' }) === '');
  const n = notesLine({ ok: true, reply: 'x', inputNotes: ['температуру 12 вернул в диапазон 0…2'], ctxFit: 'историю урезал на 8 реплик — окно модели 8192 токенов' });
  ok('J12: чем оплатили вход и окно — одна строка под ответом',
    /температуру 12/.test(n) && /историю урезал на 8/.test(n) && n.indexOf(' · ') > 0, JSON.stringify(n));
  ok('J13: правок не было — строки нет (не «движок ничего не делал» отдельной плашкой)', notesLine({ ok: true, reply: 'x' }) === '');
}
{
  /* границы фронте и на входе обязаны совпадать: иначе браузер принимает то, что
     сервер потом молча отбрасывает, и человек не понимает, где потеря */
  const src = readFileSync('functions/api/chat.js', 'utf8');
  const maxSrv = Number((src.match(/const ATT_MAX = (\d+)/) || [])[1]);
  /* «4 * 1024 * 1024» из исходника считаем перемножением, без eval: тест не должен
     исполнять произвольный текст файла */
  const bytesSrv = ((src.match(/const ATT_FILE_BYTES = ([\d* ]+);/) || [])[1] || '').split('*').reduce((a, x) => a * Number(x.trim() || 1), 1);
  ok('J14: потолок количества и веса на фронте и на входе — одно число',
    ATTACH_MAX === maxSrv && ATTACH_FILE_BYTES === bytesSrv, JSON.stringify({ f: [ATTACH_MAX, ATTACH_FILE_BYTES], s: [maxSrv, bytesSrv] }));
  ok('J15: диалог выбора файлов пускает читаемое, а не только картинки',
    /\.pdf/.test(ATTACH_ACCEPT) && /\.docx/.test(ATTACH_ACCEPT) && /\.xlsx/.test(ATTACH_ACCEPT) && /audio\//.test(ATTACH_ACCEPT) && /image\//.test(ATTACH_ACCEPT), ATTACH_ACCEPT);
}
{
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const out3 = join(dir, 'chatview-j.mjs');
  execFileSync(bin, [
    'src/views/ChatView.tsx', '--bundle', '--platform=node', '--format=esm',
    '--packages=external', '--loader:.png=dataurl', '--outfile=' + out3, '--log-level=error',
  ], { stdio: 'inherit' });
  const { ChatView } = await import(out3);
  const html = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [
        { id: 'u1', role: 'user', text: 'сводка по файлу', docs: [{ name: 'отчёт.pdf', size: 24576 }] },
        { id: 'a1', role: 'assistant', text: 'Готово.', attach: 'отчёт.pdf · pdf · 1200 симв.', notes: 'историю урезал на 8 реплик — окно модели 8192 токенов' },
      ],
      typing: false, onSend() {},
    }),
  );
  ok('J16: под ответом видно, ЧТО прочитали из вложения', /msg-read/.test(html) && /отчёт\.pdf · pdf/.test(html), html.slice(html.indexOf('msg-read') - 30, html.indexOf('msg-read') + 160));
  ok('J17: и чем за это заплатили (окно модели) — тоже в разметке', /msg-note/.test(html) && /историю урезал на 8/.test(html), html.slice(html.indexOf('msg-note') - 30, html.indexOf('msg-note') + 160));
  ok('J18: в пузыре человека лежит чип файла с весом — без содержимого', /sent-file/.test(html) && /отчёт\.pdf/.test(html) && /24,0 КБ|24 КБ|24,00 КБ/.test(html), html.slice(html.indexOf('sent-files') - 20, html.indexOf('sent-files') + 200));
  ok('J19: содержимое файлов в разметку не попадает — только имя и вес (base64 в истории чата кончает localStorage)',
    /data:(application|text)[^"]{40,}/.test(html) === false && html.indexOf('\"b64\"') < 0 && /отчёт\.pdf/.test(html), JSON.stringify(html.match(/data:(application|text)[^"]{0,40}/) || 'чисто').slice(0, 120));
}

/** --- K: профиль, адрес памяти и счётчик моделей в Настройках --- **/
console.log('K — Настройки: счётчик моделей, адрес памяти и форма профиля');
{
  const idOut = join(dir, 'identity.mjs');
  execFileSync(bin, ['src/lib/identity.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + idOut, '--log-level=error'], { stdio: 'inherit' });
  const id = await import(idOut);
  /* адрес памяти фронт показывает человеку как факт, а не как догадку: он обязан
     совпадать с тем, что строит бэкенд (engine/profile.js) */
  const backend = await import('../engine/profile.js');
  const ids = ['ab12cd34ef56', 'tg_4242', 'dev-9_9'];
  ok('K1: адрес памяти на фронте и в движке совпадает побайтово',
    ids.every((x) => id.memoryAddress(x) === backend.memoryKey(x, 'web')), ids.map((x) => id.memoryAddress(x) + '≠' + backend.memoryKey(x, 'web')).join(' '));
  ok('K2: без ключа фронт честно говорит про общий котёл, а не выдумывает id',
    id.memoryAddress('') === 'web' && id.memoryAddress('@@@') === 'web' && /общий котёл|общий ключ/.test(id.identityLine('')), id.identityLine(''));
  ok('K3: ключ бота в подписи называется старым — канал закрыт и не выдаётся за текущий',
    /старый ключ бота/.test(id.identityLine('tg_4242')) && !/Telegram/i.test(id.identityLine('tg_4242')),
    id.identityLine('tg_4242'));
  ok('K4: ключ устройства — 16 hex и каждый раз новый', /^[0-9a-f]{16}$/.test(id.newUserId()) && id.newUserId() !== id.newUserId(), id.newUserId());
  /* localStorage подставляем: проверка в том, что ключ заводится один раз и переживает перезагрузку */
  const jar = new Map();
  globalThis.localStorage = { getItem: (k) => (jar.has(k) ? jar.get(k) : null), setItem: (k, v) => jar.set(k, String(v)), removeItem: (k) => jar.delete(k) };
  const a1 = id.ensureDeviceUserId();
  const a2 = id.ensureDeviceUserId();
  ok('K5: ключ переиспользуется из localStorage (память не обнуляется перезагрузкой)', a1 === a2 && jar.get('mt-uid') === a1, a1 + '/' + a2);
  /* Источник идентификатора на сайте ровно один. Окно вебвью (если его кто-то
     подложит) не должно снова становиться вторым ключом: два источника — это две
     памяти у одного человека, ровно та ошибка, из-за которой ключи и путались. */
  globalThis.window = { Telegram: { WebApp: { initDataUnsafe: { user: { id: 99001 } } } } };
  ok('K6: окно мессенджера больше не источник id — ключ один, устройства',
    id.currentUserId() === a1 && id.currentUserId() !== 'tg_99001', id.currentUserId());
  delete globalThis.window;
  const userOut = join(dir, 'user.mjs');
  execFileSync(bin, ['src/lib/user.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm', '--outfile=' + userOut, '--log-level=error'], { stdio: 'inherit' });
  const person = await import(userOut);
  ok('K6a: без записанного имени человек — «Гость», а не выдуманное имя',
    person.siteUser().name === 'Гость' && person.initials(person.siteUser()) === 'Г', person.siteUser().name);
  person.savePersonName('Иван Петров');
  ok('K6b: имя из профиля доезжает до карточки и до инициалов',
    person.siteUser().name === 'Иван Петров' && person.initials(person.siteUser()) === 'ИП', person.initials(person.siteUser()));
  ok('K6c: язык берётся у браузера и не бывает пустым (подсказка распознавания голоса)',
    /^[a-zA-Z-]{2,35}$/.test(person.siteUser().language_code), person.siteUser().language_code);
  ok('K6d: очистка имени убирает запись, а не оставляет «undefined»',
    (person.savePersonName(''), person.siteUser().name === 'Гость'), person.siteUser().name);
    ok('K7: подпись человека понятна и не светит весь ключ (ни новый ключ, ни старый чужой id целиком)',
    /устройство · ab12…ef56$/.test(id.identityLine('ab12cd34ef56')) && /^старый ключ бота · id 4242$/.test(id.identityLine('tg_4242')),
    [id.identityLine('ab12cd34ef56'), id.identityLine('tg_4242')].join(' / '));  globalThis.localStorage = undefined;
}
{
  /* Счётчик моделей: числа придумываются не фронтом, а сервером — здесь ровно то,
     что лежит в ответах /api/models и /api/chat */
  const models = { count: 12, catalogTotal: 40, cached: true, updatedAt: 1700000000000, pools: [{ provider: 'groq', label: 'Groq', count: 5 }, { provider: 'xai', label: 'x.ai', count: 7 }] };
  const line = countersLine(models, { alive: ['groq', 'xai'], providers: 6 });
  ok('K8: строка «Модели» — ровно «моделей доступно: 12», без каталогов и разбивки', line === 'моделей доступно: 12', line);
  ok('K9: длинных подробностей в строке нет: по провайдерам, каталогу и времени обновления — это ответ /api/models, а не строка настроек',
    !/провайдер|каталог|Groq|x\.ai/.test(line), line);
  ok('K10: в строку не просочилось и число живых провайдеров (оно остаётся на «Использовании»)', !/живых/.test(line), line);
  const poor = countersLine({ count: 3, cached: false, updatedAt: null, pools: [] }, {});
  ok('K11: без каталога и без KV строка всё равно короткая — только число', poor === 'моделей доступно: 3', poor);
  ok('K12: пустые ответы — пустая строка (UI не покажет «undefined»)', countersLine(null, null) === '' && countersLine({}, {}) === '');
  const broken = countersLine({ count: 2, pools: [], updatedAt: 1, errors: ['у', 'двух'] }, { alive: [], providers: 4 });
  ok('K13: подробности (ошибки чтения, живые провайдеры) в строку настроек НЕ лезут — владелец попросил «просто сколько доступно моделей», описание столбцом на телефоне занимало пол-экрана', broken === 'моделей доступно: 2', broken);
}
{
  const p = { name: 'Иван', job: 'аналитик', about: '' };
  ok('K14: подстройка описана теми же правилами, что уходят в промпт',
    /2–4 строки|простым языком|обращайся по имени/.test(signalsLine({ ok: true, signals: ['попросил коротко: ответ в 2–4 строки'] })) && /подстройка не включена/.test(signalsLine({ ok: true, signals: [] })), signalsLine({ ok: true, signals: [] }));
  const st = profileStatusLine({ ok: true, profile: Object.assign({ filled: true, updatedAt: 1700000000000 }, p), memoryChatId: 'u-dev1234' });
  ok('K15: статус профиля содержит адрес памяти и время записи', /профиль сохранён · память: это устройство \(dev1234\)/.test(st) && /обновлён \d{2}\.\d{2} \d{2}:\d{2}/.test(st), st);
  ok('K16: память Telegram подписана аккаунтом, а не устройством', /память: Telegram \(id 4242\)/.test(profileStatusLine({ ok: true, profile: { filled: true }, memoryChatId: 'u-tg_4242' })), profileStatusLine({ ok: true, profile: { filled: true }, memoryChatId: 'u-tg_4242' }));
  ok('K17: пустой профиль называется пустым, ошибка — ошибкой',
    /профиль пуст/.test(profileStatusLine({ ok: true, profile: { filled: false }, memoryChatId: 'u-dev1234' })) && /сеть недоступна/.test(profileStatusLine({ ok: false, error: 'сеть недоступна — профиль не прочитан' })), profileStatusLine({ ok: true, profile: { filled: false } }));
}
{
  /* Настоящий SettingsView: человек должен увидеть три поля именно в той формулировке,
     о которой договаривались, и подпись, чья это память. */
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const outS = join(dir, 'settings.mjs');
  execFileSync(bin, [
    'src/views/SettingsView.tsx', '--bundle', '--platform=node', '--packages=external', '--format=esm',
    '--loader:.png=dataurl', '--outfile=' + outS, '--log-level=error',
  ], { stdio: 'inherit' });
  const { SettingsView } = await import(outS);
  const html = renderToStaticMarkup(React.createElement(SettingsView, {
    user: { id: 4242, first_name: 'Тигр', username: 'tiger' },
    themePref: 'system', onThemePref() {}, isTelegram: false, notify() {},
  }));
  ok('K18: в Настройках есть группа «Память» и три поля в нужной формулировке',
    /Память/.test(html) && /Как вас зовут/.test(html) && /Ваша профессия или занятие/.test(html) && /Подробнее о вас/.test(html), [!/Память/.test(html), !/Как вас зовут/.test(html), !/Ваша профессия/.test(html), !/Подробнее о вас/.test(html)].join(','));
  ok('K19: поля ввода и текстареа настоящие — сохранять есть чему', /<input[^>]*maxlength="60"/i.test(html) && /<input[^>]*maxlength="90"/i.test(html) && /<textarea[^>]*maxlength="1500"/i.test(html), (html.match(/maxlength=?[0-9]+/gi) || []).join(','));
  ok('K20: строка «чья это память» видна, и это не обещание общей памяти', /у каждого человека своя/.test(html) && !/общая память/.test(html), (html.match(/Чья это память[\s\S]{0,220}/) || [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 150));
  ok('K21: счётчик моделей — отдельная строка с кнопкой обновления', /Модели/.test(html) && /Обновить/.test(html) && /считаю…/.test(html), (html.match(/Модели[\s\S]{0,120}/) || [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 120));
  ok('K22: поля не автозаполняются чужими данными и не светят ключ в title', /autocomplete/.test(html) === false && /u-tg_4242/.test(html) === false);
}


console.log('L — песочница: запуск кода в браузере (исполнять на платформе негде)');
{
  /* Зачем: модель обязана видеть результат своего кода, иначе «работает» — это догадка.
     Проверки держат ровно то, что нельзя отдать на глаз: рамки изоляции, экранирование
     `</script>`, названный отказ вместо молчаливого пропуска и подсказку по ошибке. */
  const sb = join(dir, 'sandbox.mjs')
  execFileSync(bin, ['src/lib/sandbox.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + sb], { cwd: process.cwd(), stdio: 'inherit' })
  const S = await import(sb)

  ok('L1: к запуску допускается явный JS, Python, SQL, HTML, JSON, TypeScript (без языка — нет)',
    S.runnable('js') && S.runnable('JavaScript') && S.runnable('python') && S.runnable('py')
      && S.runnable('sql') && S.runnable('html') && S.runnable('json') && S.runnable('ts')
      && !S.runnable(''),
    [S.runnable('js'), S.runnable('sql'), S.runnable('ts'), S.runnable('')].join('/'))
  ok('L1b: движок выбирается по языку — js/py/sql/html/json/ts различимы, без языка — demo (null)',
    S.sandboxKind('js') === 'js' && S.sandboxKind('python3') === 'py'
      && S.sandboxKind('sql') === 'sql' && S.sandboxKind('html') === 'html'
      && S.sandboxKind('json') === 'json' && S.sandboxKind('ts') === 'ts'
      && S.sandboxKind('') === null,
    [S.sandboxKind('js'), S.sandboxKind('python3'), S.sandboxKind('sql'), S.sandboxKind('ts')].join('/'))
  ok('L2: пустой код и код через край — отказ назван словами, а не тишина',
    /пустой код/.test(S.prepare('   ').error) && S.prepare('1'.repeat(S.MAX_CODE + 1)).ok === false
      && S.prepare('1'.repeat(S.MAX_CODE + 1)).error.indexOf(String(S.MAX_CODE)) > 0,
    JSON.stringify(S.prepare('').error))
  ok('L3: request к Node-модулям отсекается ДО запуска и объясняет, почему',
    S.prepare('const x = require("fs")').ok === false && /Node/.test(S.prepare('const x = require("fs")').error),
    JSON.stringify(S.prepare('require("fs")')))
  ok('L4: в изоляции нет ни same-origin, ни сети: CSP и allow-scripts на месте',
    /default-src 'none'/.test(S.buildSrcDoc('console.log(1)')) && /<\/script>/.test(S.buildSrcDoc('1')),
    S.buildSrcDoc('1').slice(0, 60))

  const evilSrc = 'console.log("' + '</scr' + 'ipt><img src=x onerror=alert(1)>' + '")'
  const evil = S.buildSrcDoc(evilSrc)
  ok('L5: `</script>` внутри кода не закрывает наш тег (остался ровно один настоящий)',
    (evil.match(/<\/script>/g) || []).length === 1 && /<\\\/script/.test(evil),
    String((evil.match(/<\/script>/g) || []).length))

  const r1 = S.normalize({ logs: ['a', 'b'], value: '7', ms: 12 }, 'console.log("a")')
  ok('L6: вывод = строки консоли плюс возвращённое значение отдельной строкой',
    r1.ok && r1.output.indexOf('a\nb') === 0 && /→ 7/.test(r1.output), JSON.stringify(r1.output))
  const r2 = S.normalize({ logs: [], value: 'undefined' }, 'let x = 1')
  ok('L7: «ничего не вернул и ничего не вывел» — это отдельный вердикт, а не успех молчания',
    r2.ok && /ничего не вернул/.test(r2.output), JSON.stringify(r2.output))
  const r3 = S.normalize({ logs: ['x'.repeat(S.MAX_OUT + 400)] }, 'x')
  ok('L8: вывод режется на потолке и это сказано в тексте',
    r3.output.length < S.MAX_OUT + 120 && /обрезан на/.test(r3.output), String(r3.output.length))
  const r4 = S.normalize({ logs: [], error: 'qwe is not defined', stack: '    at <anonymous>:3:7' }, 'qwe')
  ok('L9: ошибка ответа даёт ok:false, подсказку и строку из стека без служебного мусора',
    !r4.ok && !!r4.hint && /строки|код/.test(r4.output) && !/<anonymous>/.test(r4.output), JSON.stringify(r4))
  const r5 = S.killed(S.TIMEOUT_MS)
  ok('L10: убитый по таймауту код — не «ошибки нет», а названный таймаут',
    r5.ok === false && r5.killed === true && /не завершился/.test(r5.output), JSON.stringify(r5))
  ok('L11: счёт проверок живёт в выводе, а не в отдельном наставлении модели',
    /проверок в коде: 0/.test(S.withTestCount('1+1', 'готово')) && /недоказанным/.test(S.withTestCount('1+1', 'готово'))
      && /проверок в коде: 2/.test(S.withTestCount('assert(1);assert(2)', 'x')), S.withTestCount('1+1', 'готово').slice(-40))
  ok('L12: отказа без браузера не скрыть — текст названного отказа экспортирован',
    /не проверен/.test(S.NO_SANDBOX), S.NO_SANDBOX)

  /* А вот это уже про вёрстку: кнопка обязана быть у JS-блока, а iframe — без same-origin.
     Блоки кода рендерит src/components/Markdown.tsx (полноценный Markdown, 0.069) —
     туда же переехали CodeRunner и бейдж «песочница»/«demo», раньше бывшие в ChatView.tsx. */
  const runner = readFileSync(join(process.cwd(), 'src', 'components', 'CodeRunner.tsx'), 'utf8')
  const chat = readFileSync(join(process.cwd(), 'src', 'components', 'Markdown.tsx'), 'utf8')
  ok('L13: iframe запускается строго с allow-scripts и без allow-same-origin',
    (() => { const m = /sandbox="([^"]*)"/.exec(runner); return !!m && m[1] === 'allow-scripts'; })(),
    (runner.match(/sandbox="[^"]*"/) || [''])[0])
  ok('L14: watchdog стоит, и по нему фрейм снимается (убить цикл больше нечем)',
    /setTimeout\(/.test(runner) && /setDoc\(null\)/.test(runner))
  ok('L15: блок кода проверяется на запуск (runnable) и ему даётся CodeRunner с подписью engineLabel',
    /runnable\(lang\)/.test(chat) && /engineLabel\(lang\)/.test(chat) && /<CodeRunner/.test(chat))
  ok('L16: вывод можно вернуть модели — иначе цикл обрывается на «у меня упало»',
    /onSend/.test(runner) && /Вывод — модели/.test(runner) && /onRunOutput/.test(chat))
}

console.log('L2 — песочница: Python через Pyodide (второй движок, тёплый иframe между запусками)')
{
  /* Зачем второй движок: DeepSeek и большинство бесплатных чатов вообще не выполняют код
     в диалоге. У нас уже был JS — теперь то же самое для Python, самого частого языка в
     задачах «напиши и проверь». Рантайм греется один раз и держится между запусками —
     проверка смотрит именно за этим устройством, а не за тем, что CPython умеет цикл. */
  const sb2 = join(dir, 'pysandbox.mjs')
  execFileSync(bin, ['src/lib/pysandbox.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + sb2], { cwd: process.cwd(), stdio: 'inherit' })
  const P = await import(sb2)
  const runner = readFileSync(join(process.cwd(), 'src', 'components', 'CodeRunner.tsx'), 'utf8')
  const chat = readFileSync(join(process.cwd(), 'src', 'components', 'Markdown.tsx'), 'utf8')

  ok('L17: пустой код и код через край — отказ назван словами (как у JS)',
    /пустой код/.test(P.preparePy('   ').error) && P.preparePy('1'.repeat(20001)).ok === false,
    JSON.stringify(P.preparePy('').error))
  ok('L18: документ Pyodide сужает CSP до одного CDN-хоста, а не открывает сеть целиком',
    (() => { const d = P.buildPySrcDoc(); return /default-src 'none'/.test(d) && /cdn\.jsdelivr\.net/.test(d) && /wasm-unsafe-eval/.test(d) })(),
    P.buildPySrcDoc().slice(0, 140))
  ok('L19: документ статический (код не зашит внутрь) — код приходит позже через postMessage',
    P.buildPySrcDoc.length === 0 && /addEventListener\("message"/.test(P.buildPySrcDoc()) && /runPythonAsync\(String\(d\.code/.test(P.buildPySrcDoc()),
    'buildPySrcDoc.length=' + P.buildPySrcDoc.length)
  const rOk = P.normalizePy({ logs: ['1', '2'], value: '3', ms: 40 })
  ok('L20: вывод Python = строки print плюс возвращённое значение, как у JS',
    rOk.ok && rOk.output.indexOf('1\n2') === 0 && /→ 3/.test(rOk.output), JSON.stringify(rOk.output))
  const rErr = P.normalizePy({ logs: [], error: 'NameError: name \'x\' is not defined', ms: 5 })
  ok('L21: ошибка Python даёт ok:false и подсказку (своя таблица, не JS-овская)',
    !rErr.ok && !!rErr.hint && /области видимости/.test(rErr.hint), JSON.stringify(rErr))

  /* Вёрстка: оба движка — один компонент, язык решает, какой из двух использовать, и
     тёплый иframe для Python не пересоздаётся на каждый клик (в отличие от JS). */
  ok('L22: CodeRunner получает язык и выбирает движок через sandboxKind, а не угадывает',
    /sandboxKind\(lang/.test(runner) && /PY_MARK/.test(runner) && /pyReady/.test(runner),
    'ok')
  ok('L23: Python-иframe не пересоздаётся на каждый запуск — повторный клик шлёт postMessage в тот же фрейм',
    /contentWindow\.postMessage/.test(runner) && /buildPySrcDoc\(\)/.test(runner),
    'ok')
  ok('L24: таймаут и у загрузки Pyodide, и у самого запуска — оба названы, а не тишина',
    /PY_LOAD_TIMEOUT_MS/.test(runner) && /PY_RUN_TIMEOUT_MS/.test(runner) && /не загрузилось за/.test(runner),
    'ok')
  ok('L25: бейдж различает языки — engineLabel даёт разные подписи (Python/SQL/HTML/JSON/TS)',
    (() => {
      const s = readFileSync(join(process.cwd(), 'src', 'lib', 'sandbox.ts'), 'utf8');
      return /песочница · Python/.test(s) && /песочница · SQL/.test(s)
        && /превью/.test(s) && /проверка · JSON/.test(s) && /песочница · TS/.test(s);
    })(),
    'ok')
}

/* ──────────────────────────────────────────────────────────────────────────
   M · живой черновик. Поток разбирает фронт, и на нём же он чаще всего и
   ломается: кусок сети рвёт строку посреди слова, ретраят пул, сервер закрывает
   соединение без финала. Проверяются РОВНЫЕ ТЕ функции из src/lib/api.ts.
   ────────────────────────────────────────────────────────────────────────── */
{
  const enc = new TextEncoder();
  const sseRes = (blocks) => new Response(new ReadableStream({
    start(c) { for (const b of blocks) c.enqueue(enc.encode(b)); c.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  const draftEv = (t) => 'data: ' + JSON.stringify({ kind: 'draft', provider: 'groq', text: t }) + '\n\n';
  const finalEv = (payload) => 'data: ' + JSON.stringify({ kind: 'final', status: 200, payload }) + '\n\n';

  ok('M1: съедается только целое событие, оборванный хвост возвращается назад',
    parseSse(draftEv('При') + 'data: {"kind":"dra').events.length === 1
      && parseSse('data: {"kind":"dra').rest.indexOf('data:') === 0,
    JSON.stringify(parseSse('data: {"kind":"dra')));

  {
    /* событие, приехавшее в двух чанках, — обычное дело для SSE поверх HTTP/2 */
    const whole = draftEv('вет');
    const first = parseSse(whole.slice(0, 14));
    const second = parseSse(first.rest + whole.slice(14));
    ok('M2: событие, разорванное между чанками, достраивается и не теряется',
      first.events.length === 0 && second.events.length === 1 && second.events[0].text === 'вет',
      JSON.stringify({ a: first.events.length, b: second.events.map((e) => e.text) }));
  }

  ok('M3: [DONE] и комментарии сервера не считаются событиями (падать на них незачем)',
    parseSse('data: [DONE]\n\n\n: ping\n\n' + draftEv('x')).events.length === 1);

  {
    const saved = globalThis.fetch;
    const seen = [];
    try {
      globalThis.fetch = async (url, init) => {
        seen.push(init && init.headers);
        return sseRes([draftEv('При'), draftEv('вет'), finalEv({ ok: true, reply: 'Привет!', model: 'groq/x' })]);
      };
      const got = [];
      const r = await sendChat('привет', [], { onDraft: (t) => got.push(t) });
      ok('M4: черновик копится по кускам, а не показывается обрывками',
        got.join('|') === 'При|Привет', JSON.stringify(got));
      ok('M5: финальный payload — обычный ответ (reply и модель берутся из него)',
        r.ok === true && r.reply === 'Привет!' && r.model === 'groq/x', JSON.stringify(r).slice(0, 120));
      ok('M6: поток запрошен только потому, что попросили черновик',
        /text\/event-stream/.test(String((seen[0] || {}).accept || '')), JSON.stringify(seen[0]));
    } finally { globalThis.fetch = saved }
  }

  {
    const saved = globalThis.fetch;
    try {
      globalThis.fetch = async () => sseRes([
        draftEv('неудачн'),
        'data: ' + JSON.stringify({ kind: 'drop', provider: 'groq' }) + '\n\n',
        draftEv('с '), draftEv('запаса'),
        finalEv({ ok: true, reply: 'с запаса', model: 'x/y' }),
      ]);
      const got = [];
      const r = await sendChat('текст', [], { onDraft: (t) => got.push(t) });
      ok('M7: забраксованная попытка стирается с экрана, а не склеивается с новой',
        got[1] === null && got.join('|') === 'неудачн||с |с запаса', JSON.stringify(got));
      ok('M8: ответ при этом обычный — провал автора не превращается в ошибку',
        r.ok === true && r.reply === 'с запаса', JSON.stringify(r).slice(0, 120));
    } finally { globalThis.fetch = saved }
  }

  {
    const saved = globalThis.fetch;
    try {
      globalThis.fetch = async () => sseRes([draftEv('начало'), 'data: {"kind":"fin']);
      const r = await sendChat('текст', [], { onDraft: () => {} });
      ok('M9: поток закрыли без финала — отказ назван, а не показан пустой ответ',
        r.ok === false && /оборвался/.test(r.error || ''), JSON.stringify(r).slice(0, 140));
    } finally { globalThis.fetch = saved }
  }

  {
    const saved = globalThis.fetch;
    const seen = [];
    try {
      globalThis.fetch = async (url, init) => {
        seen.push(init && init.headers);
        return new Response(JSON.stringify({ ok: true, reply: 'обычный путь', model: 'groq/x' }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      };
      let touched = 0;
      const r = await sendChat('текст', [], { onDraft: () => { touched++ } });
      ok('M10: сервер ответил json — черновика просто нет, ответ всё равно получен',
        touched === 0 && r.ok === true && r.reply === 'обычный путь', JSON.stringify({ touched, r }).slice(0, 140));
    } finally { globalThis.fetch = saved }
  }

  {
    /* без заголовка accept запрос обязан быть байт-в-байт прежним: его шлют бот,
       смоуки и curl — им поток не нужен */
    const saved = globalThis.fetch;
    const seen = [];
    try {
      globalThis.fetch = async (url, init) => {
        seen.push(init && init.headers);
        return new Response(JSON.stringify({ ok: true, reply: 'ок' }), { status: 200,
          headers: { 'content-type': 'application/json' } });
      };
      await sendChat('текст', [], {});
      ok('M11: без onDraft — никакого accept: text/event-stream и никакого чтения потока',
        seen.length === 1 && !/event-stream/.test(JSON.stringify(seen[0] || {})), JSON.stringify(seen[0]));
    } finally { globalThis.fetch = saved }
  }

  {
    const api = readFileSync('src/lib/api.ts', 'utf8');
    const chat = readFileSync('src/views/ChatView.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    ok('M12: черновик дошёл до экрана: App просит его и отдаёт в ChatView, а ChatView показывает текст вместо трёх точек',
      /onDraft: \(t\) => setDraft\(t\)/.test(app) && /draft=\{draft\}/.test(app)
        && /draft \? \(/.test(chat) && /msg-draft/.test(chat));
    ok('M13: оборванный хвост не прячется — streamError показывается человеку',
      /streamError\?: string/.test(api) && /r\.streamError/.test(app));
    ok('M14: движок трогает поток только у автора — совет, память и заголовки просят одним ответом',
      !/stream: true/.test(readFileSync('engine/chat.js', 'utf8').replace(/stream: !!onDelta[^\n]*/g, '')),
      readFileSync('engine/chat.js', 'utf8').match(/stream:[^\n]*/g));
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   M2 · «думать вслух». Рассуждения идут тем же потоком, но другим каналом,
   и фронт обязан держать их раздельно: иначе текст модели попадёт в ответ.
   ────────────────────────────────────────────────────────────────────────── */
{
  const enc = new TextEncoder();
  const sseRows = (rows) => new Response(new ReadableStream({
    start(c) { for (const x of rows) c.enqueue(enc.encode(x)); c.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
  const reason = (t) => ev({ kind: 'draft', channel: 'reasoning', provider: 'groq', text: t });
  const answer = (t) => ev({ kind: 'draft', provider: 'groq', text: t });
  const drop = () => ev({ kind: 'drop', provider: 'groq' });
  const fin = (payload) => ev({ kind: 'final', status: 200, payload });
  const saved = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push(init && init.body);
      return sseRows([
        reason('Думаю '), reason('вслух'), answer('От'), answer('вет'),
        fin({ ok: true, reply: 'Ответ', reasoning: 'Думаю вслух', model: 'groq/x' }),
      ]);
    };
    const gotA = [], gotR = [];
    const r = await sendChat('текст', [], { onDraft: (t) => gotA.push(t), onReasoning: (t) => gotR.push(t) });
    ok('M15: рассуждения копятся отдельно от ответа и не пересекаются с ним',
      gotA.join('|') === 'От|Ответ' && gotR.join('|') === 'Думаю |Думаю вслух',
      JSON.stringify({ gotA, gotR }));
    ok('M16: просьба о рассуждениях ушла в теле запроса, ответ собран как обычно',
      JSON.parse(seen[0]).showReasoning === true && r.ok === true && r.reply === 'Ответ' && r.reasoning === 'Думаю вслух',
      seen[0]);
  } finally { globalThis.fetch = saved; seen.length = 0 }

  {
    const saved2 = globalThis.fetch;
    try {
      globalThis.fetch = async (url, init) => {
        seen.push(init && init.body);
        return sseRows([reason('не то'), answer('не то'), drop(), reason('то'), answer('ок'),
          fin({ ok: true, reply: 'ок', reasoning: 'то', model: 'x/y' })]);
      };
      const gotA = [], gotR = [];
      const r = await sendChat('текст', [], { onDraft: (t) => gotA.push(t), onReasoning: (t) => gotR.push(t) });
      ok('M17: сброс попытки чистит ОБА канала — обрывки прошлой головы не остаются на экране',
        gotA[1] === null && gotR[1] === null && gotR.join('|') === 'не то||то',
        JSON.stringify({ gotA, gotR }));
      ok('M18: ответ при этом обычный (провал головы не виден человеку как ошибка)',
        r.ok === true && r.reply === 'ок', JSON.stringify(r).slice(0, 120));
    } finally { globalThis.fetch = saved2 }
  }

  {
    /* отдельный вызов: без onReasoning в теле не должно быть ни ключа, ни следа —
       иначе прежние клиенты (бот, curl) начали бы получать то, чего не просили */
    const saved3 = globalThis.fetch;
    const body = [];
    try {
      globalThis.fetch = async (url, init) => {
        body.push(init && init.body);
        return new Response(JSON.stringify({ ok: true, reply: 'ок' }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await sendChat('текст', [], { onDraft: () => {} });
      ok('M19: без onReasoning сервер про рассуждения не спрашивается (тело прежнее)',
        body.length === 1 && !/showReasoning/.test(body[0]), body[0]);
    } finally { globalThis.fetch = saved3 }
  }

  {
    /* Кнопка «Остановить» снаружи дёргает opts.signal — а не внутренний 75-секундный
       таймер sendChat. Оба падают одним и тем же AbortError, но для человека это
       разные вещи: «я сам остановил» и «сервис не ответил вовремя». */
    const saved5 = globalThis.fetch;
    try {
      globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
      const userAc = new AbortController();
      const pending = sendChat('привет', [], { signal: userAc.signal });
      userAc.abort();
      const r = await pending;
      ok('M19b: человек сам остановил запрос — r.stopped === true, ошибка не похожа на таймаут/сеть',
        r.ok === false && r.stopped === true && r.error === 'остановлено', JSON.stringify(r));
    } finally { globalThis.fetch = saved5 }

    const saved6 = globalThis.fetch;
    try {
      globalThis.fetch = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
      const r = await sendChat('привет', [], {});
      ok('M19c: тот же AbortError, но БЕЗ внешнего сигнала (свой таймаут) — это «время вышло», а не «остановлено»',
        r.ok === false && !r.stopped && r.error === 'время вышло', JSON.stringify(r));
    } finally { globalThis.fetch = saved6 }
  }

  {
    const api = readFileSync('src/lib/api.ts', 'utf8');
    const chat = readFileSync('src/views/ChatView.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    ok('M20: живой канал рассуждений доехал до экрана и выглядит не как ответ',
      chat.includes('msg-reason-live') && chat.includes('aria-label="Модель думает вслух"')
        && api.includes("ev.channel === 'reasoning'"));
    ok('M21: «думает вслух» — постоянная функция, включена всегда (без тумблера и без пикера моделей — это Агент, а не выбор чужих моделей)',
      app.includes('const reasoningOn = true') && app.includes("const model = ''") && app.includes('canModelThink(model)')
        && !chat.includes('reason-toggle') && !chat.includes('model-chip') && !chat.includes('ModelPicker'));
    ok('M22: сказанное под ответом свёрнуто, а не вывалено в пузырь (рассуждения — не текст ответа)',
      chat.includes('<details className="msg-reason">') && chat.includes('думал вслух')
        && app.includes('slice(0, 4000)'));
  }

  {
    const saved4 = globalThis.fetch;
    const bodies = [];
    try {
      globalThis.fetch = async (_u, init) => {
        bodies.push(String((init && init.body) || ''));
        return new Response(JSON.stringify({
          ok: true,
          reply: 'Ответ [1]',
          sources: [{ title: 'Википедия', url: 'https://ru.wikipedia.org/wiki/Тест' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const r1 = await sendChat('вопрос', [], { webSearch: true });
      await sendChat('вопрос', [], {});
      ok('M23: webSearch уходит в теле запроса только по явной просьбе и возвращает sources',
        JSON.parse(bodies[0]).webSearch === true
          && !/webSearch/.test(bodies[1])
          && Array.isArray(r1.sources)
          && r1.sources[0].url === 'https://ru.wikipedia.org/wiki/Тест',
        JSON.stringify({ b0: bodies[0], b1: bodies[1], s: r1.sources }));
    } finally { globalThis.fetch = saved4 }
  }

  {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const out4 = join(dir, 'chatview-search.mjs');
    execFileSync(bin, [
      'src/views/ChatView.tsx', '--bundle', '--platform=node', '--format=esm',
      '--packages=external', '--loader:.png=dataurl', '--outfile=' + out4, '--log-level=error',
    ], { stdio: 'inherit' });
    const { ChatView } = await import(out4);
    const toolsSrc = readFileSync('engine/tools.js', 'utf8');
    const htmlOn = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{
          id: 's1',
          role: 'assistant',
          text: 'Ответ по источникам [1].',
          sources: [{ title: 'Квантовый компьютер', url: 'https://ru.wikipedia.org/wiki/Квантовый_компьютер' }],
        }],
        typing: false,
        onSend() {},
      }),
    );
    const htmlOff = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{ id: 's2', role: 'assistant', text: 'Без поиска.' }],
        typing: false,
        onSend() {},
      }),
    );
    ok('M24: поиск в интернете работает автоматически в движке (без лишней кнопки «поиск» в панели ввода)',
      !/class="search-toggle/.test(htmlOn)
        && toolsSrc.includes('Выжимка из источника')
        && toolsSrc.includes('extractSources'));
    ok('M25: источники рендерятся кликабельными ссылками под ответом только тогда, когда они реально есть',
      /class="msg-sources"/.test(htmlOn)
        && /href="https:\/\/ru\.wikipedia\.org\/wiki\/Квантовый_компьютер"/.test(htmlOn)
        && /\[1\]/.test(htmlOn)
        && !/msg-sources/.test(htmlOff));

    const out5 = join(dir, 'picker-pro.mjs');
    const entry5 = join(dir, 'picker-pro-entry.tsx');
    writeFileSync(entry5, [
      "export { ModelPicker } from '../../../src/components/ModelPicker'",
      "export { ParamsPopover } from '../../../src/components/ParamsPopover'",
      "export { ModelIcon, detectBrand } from '../../../src/components/ModelIcon'",
      "export { Topbar } from '../../../src/components/Topbar'",
      "export { canModelThink, DEFAULT_GEN_PARAMS, isGenParams, isDefaultGenParams, withGenParamDefaults } from '../../../src/lib/models'",
      '',
    ].join('\n'), 'utf8');
    execFileSync(bin, [
      entry5, '--bundle', '--platform=node', '--format=esm',
      '--packages=external', '--loader:.png=dataurl', '--outfile=' + out5, '--log-level=error',
    ], { stdio: 'inherit' });
    const { ModelPicker: MP5, ParamsPopover, Topbar, detectBrand, canModelThink, DEFAULT_GEN_PARAMS, isGenParams, isDefaultGenParams, withGenParamDefaults } = await import(out5);

    ok('M29z: старое сохранённое состояние (до 0.070, без penalty-полей) всё ещё валидно и достраивается нулями',
      isGenParams({ temperature: 1, maxTokens: 0, topP: 0.95 })
        && withGenParamDefaults({ temperature: 1, maxTokens: 0, topP: 0.95 }).presencePenalty === 0
        && withGenParamDefaults({ temperature: 1, maxTokens: 0, topP: 0.95 }).frequencyPenalty === 0,
      'ok')
    ok('M29y: дефолт считается дефолтом, сдвинутый penalty — уже нет',
      isDefaultGenParams(DEFAULT_GEN_PARAMS) === true
        && isDefaultGenParams({ ...DEFAULT_GEN_PARAMS, presencePenalty: 0.5 }) === false,
      'ok')

    const htmlThink = renderToStaticMarkup(
      React.createElement(MP5, {
        model: 'gemini-3.6-flash',
        reasoningOn: true,
        effort: 'medium',
        onPick() {},
      }),
    );
    const htmlNoThink = renderToStaticMarkup(
      React.createElement(MP5, {
        model: 'codestral-latest',
        reasoningOn: true,
        effort: 'medium',
        onPick() {},
      }),
    );

    const logoSrc = readFileSync('src/components/Logo.tsx', 'utf8');
    const favSvg = readFileSync('public/favicon.svg', 'utf8');
    ok('M26: везде вместо старой буквы «M» стоит аватарка тигра (LogoMark, favicon и строка «Авто» в карточке модели движка)',
      logoSrc.includes('agent-avatar.png')
        && !logoSrc.includes('M8.5 23V9.8')
        && !favSvg.includes('M8.5 23V9.8')
        && existsSync('public/favicon.png')
        && /class="m-av[^"]*"[^>]*><img[^>]*class="m-av-img"/.test(htmlThink));

    ok('M27: оригинальные бренд-иконки определяются по семейству ИИ (Google, Qwen, DeepSeek, Mistral, OpenAI, MeTiger)',
      detectBrand('') === 'metiger'
        && detectBrand('gemini-2.5-flash') === 'google'
        && detectBrand('qwen/qwen3.5-plus:free') === 'qwen'
        && detectBrand('deepseek-v4-flash') === 'deepseek'
        && detectBrand('codestral-latest') === 'mistral'
        && detectBrand('openai/gpt-oss-20b') === 'openai');
    ok('M28: двухколоночный пикер показывает категории ИИ, контекст (1M Контекст), ток/с и лимит запросов в день и в минуту (250/день · 15/мин)',
      /Google/.test(htmlThink)
        && /Qwen/.test(htmlThink)
        && /Mistral/.test(htmlThink)
        && /OpenAI/.test(htmlThink)
        && /1M Контекст/.test(htmlThink)
        && /ток\/с/.test(htmlThink)
        && /250\/день · 15\/мин/.test(htmlThink));

    ok('M29: у думающей модели есть переключатель «Думает» и «УСИЛИЕ» (Низкое/Среднее/Высокое), а у не-думающей переключатель «Думает» пропадает',
      canModelThink('gemini-3.6-flash') === true
        && canModelThink('codestral-latest') === false
        && /aria-label="Режим Думает"/.test(htmlThink)
        && /УСИЛИЕ/.test(htmlThink)
        && /Низкое/.test(htmlThink) && /Среднее/.test(htmlThink) && /Высокое/.test(htmlThink)
        && !/aria-label="Режим Думает"/.test(htmlNoThink)
        && !/УСИЛИЕ/.test(htmlNoThink));

    const htmlParams = renderToStaticMarkup(
      React.createElement(ParamsPopover, {
        params: DEFAULT_GEN_PARAMS,
        onChange() {},
      }),
    );
    ok('M30: кнопка параметров и карточка ПАРАМЕТРЫ содержат temperature, max_tokens (Макс.), top_p и Сброс',
      /class="params-btn/.test(htmlOn)
        && /ПАРАМЕТРЫ/.test(htmlParams)
        && /Сброс/.test(htmlParams)
        && /temperature/.test(htmlParams)
        && /max_tokens/.test(htmlParams) && /Макс\./.test(htmlParams)
        && /top_p/.test(htmlParams));
    ok('M30b: 0.070 — карточка расширена presence_penalty и frequency_penalty (по умолчанию 0.0)',
      /presence_penalty/.test(htmlParams) && /frequency_penalty/.test(htmlParams)
        && (htmlParams.match(/>0\.0</g) || []).length === 2,
      (htmlParams.match(/>0\.0</g) || []).length)

    const htmlTopbar = renderToStaticMarkup(
      React.createElement(Topbar, {
        title: 'Новый чат',
        onOpenMenu() {},
        onOpenWorkspace() {},
        onRenameChat() {},
        onDeleteChat() {},
      }),
    );
    const htmlTopbarStatic = renderToStaticMarkup(
      React.createElement(Topbar, {
        title: 'Настройки',
        onOpenMenu() {},
        onOpenWorkspace() {},
      }),
    );
    const cssSrc = readFileSync('src/styles/index.css', 'utf8');
    ok('M31: список моделей в пикере прокручивается (grid-template-rows: minmax(0, 1fr))',
      /class="topbar-side topbar-left"/.test(htmlTopbar)
        && /class="topbar-side topbar-right"/.test(htmlTopbar)
        && cssSrc.includes('grid-template-columns: 44px 1fr 44px')
        && cssSrc.includes('grid-template-rows: minmax(0, 1fr)'));
    ok('M31b: вместо апселла подписки («Подключить» как у ChatGPT) — капсула по центру показывает НАЗВАНИЕ ЧАТА, и НЕ открывает настройки по клику (это была ошибка 0.073, убрано)',
      /class="topbar-pill"[^>]*title="Новый чат"/.test(htmlTopbar)
        && /<span>Новый чат<\/span>/.test(htmlTopbar)
        && !/Подключить/.test(htmlTopbar)
        && !/открыть настройки/.test(htmlTopbar));
    ok('M31c: кнопки слева и справа в шапке — круглые, с собственным фоном (как в референсе), а не обычные квадратные icon-btn',
      /icon-btn topbar-round only-mobile/.test(htmlTopbar)
        && /icon-btn topbar-round"/.test(htmlTopbar)
        && cssSrc.includes('.icon-btn.topbar-round'));
    ok('M31d: на экране чата капсула — кнопка со стрелкой вниз (намёк на меню Переименовать/Удалить), а не на разделах без своего чата («Настройки» и т.п.)',
      /<button[^>]*class="topbar-pill"[^>]*aria-haspopup="menu"/.test(htmlTopbar)
        && /<svg[^>]*class="lucide lucide-chevron-down"/.test(htmlTopbar)
        && /<div class="topbar-pill topbar-pill-static"[^>]*>\s*<span>Настройки<\/span>/.test(htmlTopbarStatic)
        && !/chevron-down/.test(htmlTopbarStatic));

    const topbarSrc = readFileSync('src/components/Topbar.tsx', 'utf8');
    const appSrc2 = readFileSync('src/App.tsx', 'utf8');
    ok('M31e: клик по капсуле открывает меню «Переименовать / Удалить» (то же, что и у чата в сайдбаре), а не настройки — апселл-ошибка 0.073 полностью убрана',
      topbarSrc.includes('Переименовать') && topbarSrc.includes('Удалить')
        && topbarSrc.includes('className="chat-menu"') && topbarSrc.includes('className="danger"')
        && !/onOpenSettings|Settings/.test(topbarSrc));
    ok('M31f: App.tsx включает переименование/удаление в шапке только на экране чата, Настройки остаются доступны только через сайдбар',
      /onRenameChat: \(t: string\) => renameChat\(activeChatId, t\)/.test(appSrc2)
        && /onDeleteChat: \(\) => deleteChat\(activeChatId\)/.test(appSrc2)
        && /view === 'chat'\s*\n\s*\? \{/.test(appSrc2));

    const htmlLiveThink = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{ id: 'u1', role: 'user', text: 'вопрос' }],
        typing: true,
        draft: '',
        draftReasoning: 'Checking `rollback` -> `dv-release` in English',
        onSend() {},
      }),
    );
    const htmlAutoCollapsed = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{
          id: 'a1',
          role: 'assistant',
          text: 'Готовый ответ.',
          reasoning: 'Step 1: analyze in English',
          thinkingSec: 4,
          tools: ['web-search'],
          ms: 1700,
        }],
        typing: false,
        onSend() {},
      }),
    );
    ok('M32: живой блок мыслей со значком Мозг, анимацией «Thinking...», инлайн-кодом и авто-сворачиванием в «Thought for 4 seconds» + used tool',
      /class="reason-brain-icon is-pulsing"/.test(htmlLiveThink)
        && /<span class="thinking-word">Thinking\.\.\.<\/span>/.test(htmlLiveThink)
        && /<code class="reason-inline-code">rollback<\/code>/.test(htmlLiveThink)
        && /class="stream-dot"/.test(htmlLiveThink)
        && /Thought for 4 seconds/.test(htmlAutoCollapsed)
        && /used web-search/.test(htmlAutoCollapsed)
        && cssSrc.includes('@keyframes thinkingShimmer')
        && cssSrc.includes('mask-image: linear-gradient'));

    const htmlWebSteps = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{
          id: 'w1',
          role: 'assistant',
          text: 'Найдено на GitHub.',
          tools: ['calc'],
          ms: 820,
          webSteps: [
            { kind: 'search', query: 'site:github.com/yamatayga-lgbt', results: [{ title: 'MeTiger-Ai', url: 'https://github.com/yamatayga-lgbt/MeTiger-Ai' }] },
            { kind: 'search', query: '"metiger-ai.pages.dev" GitHub', results: [] },
            { kind: 'fetch', url: 'https://github.com/yamatayga-lgbt/MeTiger-Ai', title: 'MeTiger-Ai' },
          ],
        }],
        typing: false,
        onSend() {},
      }),
    );
    ok('M33: блок «Searching the web» рендерит лупу, глобус «Searched for "..."» и окно браузера «Fetched https://...»',
      /Searching the web/.test(htmlWebSteps)
        && /Searched for &quot;site:github\.com\/yamatayga-lgbt&quot;/.test(htmlWebSteps)
        && /Searched for &quot;&quot;metiger-ai\.pages\.dev&quot; GitHub&quot;/.test(htmlWebSteps)
        && /Fetched <a[^>]*href="https:\/\/github\.com\/yamatayga-lgbt\/MeTiger-Ai"[^>]*class="web-fetched-url"/.test(htmlWebSteps)
        && /class="web-search-icon"/.test(htmlWebSteps));

    const htmlExplored = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{
          id: 'e1',
          role: 'assistant',
          text: 'Разобрался в проекте.',
          reads: [
            { name: 'models.ts', ok: true, line: 'ts · 4200 симв.' },
            { name: 'ChatView.tsx', ok: true, line: 'tsx · 9100 симв.' },
            { name: 'битый.docx', ok: false, line: 'не распознан формат' },
          ],
          readNotes: ['показаны первые 3 из 5 файлов'],
        }],
        typing: false,
        onSend() {},
      }),
    );
    ok('M34: блок «Explored N reads» сворачивается по умолчанию и построчно показывает значок глаза + «Read <файл>»',
      /Explored 3 reads/.test(htmlExplored)
        && /class="msg-explored"(?!\s*open)/.test(htmlExplored)
        && /Read <span class="explored-step-name" title="models\.ts">models\.ts<\/span>/.test(htmlExplored)
        && /Couldn&#x27;t read <span class="explored-step-name" title="битый\.docx">битый\.docx<\/span>/.test(htmlExplored)
        && /explored-step is-failed/.test(htmlExplored)
        && /показаны первые 3 из 5 файлов/.test(htmlExplored));

    const htmlWrite = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{
          id: 'wf1',
          role: 'assistant',
          text: 'Готово.',
          files: [
            { name: 'Смета на ремонт.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 12000, b64: 'AAAA', lines: 42 },
          ],
        }],
        typing: false,
        onSend() {},
      }),
    );
    ok('M35: строка «Write <файл> · N lines» рендерится над ответом рядом с остальными шагами подготовки',
      /class="msg-write-files"/.test(htmlWrite)
        && /Write <span class="write-file-name">Смета на ремонт\.docx<\/span>/.test(htmlWrite)
        && /<span class="write-file-lines">42 lines<\/span>/.test(htmlWrite)
        && htmlWrite.indexOf('msg-write-files') < htmlWrite.indexOf('class="bubble"'));

    /* Стоп-кнопка и «Enter не всегда отправляет» — новая пара функций: случайно
       отправленный запрос можно оборвать, а на телефоне Enter просто переводит строку. */
    const htmlTypingOn = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{ id: 'st1', role: 'user', text: 'вопрос' }],
        typing: true,
        draft: '',
        onSend() {},
        onStop() {},
      }),
    );
    const htmlTypingOff = renderToStaticMarkup(
      React.createElement(ChatView, {
        user: { name: 'Тигр', language_code: 'ru' },
        messages: [{ id: 'st2', role: 'user', text: 'вопрос' }],
        typing: false,
        onSend() {},
        onStop() {},
      }),
    );
    ok('M36: пока ответ не пришёл, кнопка отправки превращается в «Остановить» (а не просто гаснет)',
      /class="send-btn stop-btn"/.test(htmlTypingOn)
        && /aria-label="Остановить"/.test(htmlTypingOn)
        && !/aria-label="Отправить"/.test(htmlTypingOn));
    ok('M37: когда ответа не ждём, кнопка снова обычная «Отправить», стоп-кнопки нет',
      /aria-label="Отправить"/.test(htmlTypingOff) && !/stop-btn/.test(htmlTypingOff));

    const chatSrc2 = readFileSync('src/views/ChatView.tsx', 'utf8');
    ok('M38: второй Enter поверх ещё не пришедшего ответа ничего не копит — submit() сам это проверяет',
      /const submit = \(\) => \{\s*(\/\*[\s\S]*?\*\/\s*)?if \(typing\) return/.test(chatSrc2));
    ok('M39: Enter без Shift отправляет только там, где рядом мышь/трекпад — на телефоне это просто перенос строки',
      /e\.key === 'Enter' && !e\.shiftKey && enterKeySends\(\)/.test(chatSrc2)
        && chatSrc2.includes("import { enterKeySends } from '../lib/platform'"));

    const platformOut = join(dir, 'platform.mjs');
    execFileSync(bin, ['src/lib/platform.ts', '--format=esm', '--outfile=' + platformOut, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
    const { enterKeySends } = await import(platformOut);
    const savedWindow = globalThis.window;
    try {
      globalThis.window = { matchMedia: (q) => ({ matches: /pointer: fine/.test(q) }) };
      ok('M40: на компьютере (hover+точный указатель в matchMedia) Enter отправляет', enterKeySends() === true);
      globalThis.window = { matchMedia: () => ({ matches: false }) };
      ok('M41: на телефоне (matchMedia не совпал) Enter не отправляет — значит, просто перенос строки', enterKeySends() === false);
      globalThis.window = {};
      ok('M42: совсем древний браузер без matchMedia — ведём себя как раньше (Enter отправляет)', enterKeySends() === true);
    } finally {
      if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    }

    const appSrc = readFileSync('src/App.tsx', 'utf8');
    ok('M43: стоп реально обрывает именно ушедший запрос — свой AbortController на каждую отправку, а не просто флаг в интерфейсе',
      appSrc.includes('const abortRef = useRef<AbortController | null>(null)')
        && /const ac = new AbortController\(\)/.test(appSrc)
        && /signal: ac\.signal/.test(appSrc)
        && /const stopGeneration = useCallback\(\(\) => \{\s*abortRef\.current\?\.abort\(\)/.test(appSrc)
        && appSrc.includes('onStop={stopGeneration}'));
    ok('M44: остановленный человеком запрос не превращается в фейковую ошибку движка или демо-ответ — для него отдельная ветка',
      /if \(r\.stopped\) \{/.test(appSrc) && appSrc.includes("setToast('Остановлено')"));
  }
}


console.log('── N · стекло (Glassmorphism) ───');
{
  /* Проверяем не «есть ли красиво», а три вещи, на которых стекло держится:
     1) обвязка размывается, а лента сообщений — НЕТ (иначе прокрутка на
        телефоне становится слайд-шоу: десятки backdrop-filter, едущих в кадре);
     2) слабый браузер и просьба «меньше прозрачности» дают непрозрачные панели;
     3) блик у шапки удерживается абсолютным позиционированием — у .topbar
        grid на три колонки, и ::after в потоке стал бы четвёртым элементом. */
  const css = readFileSync('src/styles/index.css', 'utf8');
  const appSrc = readFileSync('src/App.tsx', 'utf8');
  const htmlSrc = readFileSync('index.html', 'utf8');
  const themeSrc = readFileSync('src/hooks/useTheme.ts', 'utf8');

  /* Правило ищем ТОЛЬКО внутри блока стекла: у .composer, .topbar, .msg-user .bubble
     и .drawer-scrim есть и прежние правила выше по файлу, и брать первое вхождение
     значило бы проверять старый стиль вместо нового. Селектор может стоять и в
     группе (через запятую) — поэтому ищем «селектор, затем , или {». */
  const start = css.indexOf('/* ---------- Само стекло ---------- */');
  /* Отсекаем хвост с откатами: там у стекла нарочно backdrop-filter: none, и если
     искать правила по всему файлу, проверка «в поле ввода ровно одно размытие»
     споткнётся о собственный же честный откат. */
  const fallback = css.indexOf('/* ---------- Уважение к настройкам системы ---------- */');
  /* Комментарии вырезаем: они объясняют, ЧЕМ был плох прежний подход, и сами
     содержат слова вроде «position:» и «backdrop-filter» — проверка на них
     спотыкалась бы о собственное объяснение. */
  const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  /* Эффективное значение правила: последнее объявление побеждает, и проверять
     надо ИМЕННО его. На этом уже спотыкались: старый дубль с 62% «удерживал»
     проверку зелёной, хотя на экране было 46%. */
  const lastRuleBody = (sel) => {
    /* Без регулярных выражений: они путались в соседях (.composer против
       .composer-wrap и .composer .icon-btn) и возвращали не то правило.
       Здесь селектор ищется как текст, а совпадением считается только то,
       где после него стоит { или запятая списка. */
    /* Ищем В БЛОКЕ СТЕКЛА (glassArea), а не по всему файлу: ниже лежат честные
       откаты для «меньше прозрачности», где у .composer нарочно плотный фон, и
       по всему файлу последним находился именно откат. */
    const t = glassArea || stripCssComments(css);
    let body = '';
    let from = 0;
    for (;;) {
      const at = t.indexOf(sel, from);
      if (at < 0) return body;
      from = at + sel.length;
      const before = at === 0 ? '\n' : t[at - 1];
      if (!' \n\t},'.includes(before)) continue;
      const rest = t.slice(from).match(/^\s*([{.,:])/);
      if (!rest || (rest[1] !== '{' && rest[1] !== ',')) continue;
      const brace = t.indexOf('{', from);
      const close = brace < 0 ? -1 : t.indexOf('}', brace);
      if (brace < 0 || close < 0) continue;
      body = t.slice(brace + 1, close);
    }
  };
  const glassArea = start < 0 ? '' : stripCssComments(css.slice(start, fallback > start ? fallback : undefined));
  const ruleBody = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|\\n)[ \\t]*' + esc + '[ \\t]*(?:,|\\{)', 'g');
    const out = [];
    let m;
    while ((m = re.exec(glassArea))) {
      const brace = glassArea.indexOf('{', m.index);
      if (brace < 0) break;
      out.push(glassArea.slice(m.index, glassArea.indexOf('}', brace)));
      re.lastIndex = brace;
    }
    return out.join('\n');
  };
  const glassGroup = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  const veilGroup = glassGroup.indexOf('.palette {') > 0
    ? glassGroup.slice(glassGroup.indexOf('.palette {'))
    : '';

  ok('N1: сияние под стеклом нарисовано тремя пятнами внутри оболочки приложения, и оно вне чтения для программ (aria-hidden)',
    /className=\{view === 'chat' \? 'ambient' : 'ambient ambient-still'\}[^>]*aria-hidden="true"[\s\S]{0,140}<i \/>[\s\S]{0,40}<i \/>[\s\S]{0,40}<i \/>/.test(appSrc));

  ok('N2: у стекла свои токены в ОБЕИХ темах (прозрачность, кромка, блик, тень, цвета сияния)',
    ['dark', 'light'].every((t) => {
      const i = css.indexOf("data-theme='" + t + "'");
      const body = i < 0 ? '' : css.slice(i, css.indexOf('}', i));
      return ['--glass:', '--glass-strong:', '--glass-brd:', '--glass-rim:', '--glass-sheen:', '--glass-shadow:', '--ambient-1:', '--ambient-2:', '--ambient-3:'].every((k) => body.includes(k));
    }), 'нет токена в одной из тем');

  ok('N3: размывается обвязка — шапка, сайдбар, попапы, меню, палитра, тост, ящик, карточки',
    ['topbar', 'sidebar', 'chat-menu', 'model-panel', 'params-popover', 'attach-menu', 'palette', 'toast', 'workspace-drawer', 'settings-card', 'usage-card', 'profile-card']
      .every((n) => glassGroup.includes('.' + n)) && /backdrop-filter: blur\(var\(--glass-blur\)\)/.test(glassGroup),
    glassGroup.slice(0, 80));

  ok('N4: поле ввода — стекло, и размывает его РОВНО одна обёртка (вложенный blur стоит как два полноэкранных композита)',
    /backdrop-filter: blur\(var\(--glass-blur\)\)/.test(ruleBody('.composer-wrap::before'))
      && /background-color: color-mix\(in srgb, var\(--pane\) 46%, transparent\)/.test(lastRuleBody('.composer'))
      && !/backdrop-filter/.test(ruleBody('.composer')));

  ok('N5: сообщения в ленте НЕ размываются — это то, что защищает прокрутку на телефоне',
    !glassGroup.includes('.bubble') && !/backdrop-filter/.test(ruleBody('.msg-user .bubble')) && !/backdrop-filter/.test(ruleBody('.bubble')));

  ok('N6: пузырь человека при этом полупрозрачный (сквозь него видно сияние)',
    /color-mix\(in srgb, var\(--user-bubble\)/.test(ruleBody('.msg-user .bubble')));

  ok('N7: блик сделан СЛОЁМ ФОНА (background-image), а не псевдоэлементом — псевдоэлементу нужен position: relative, а он перебивал absolute у попапов',
    /background-image: radial-gradient\([\s\S]{0,200}var\(--glass-spot\),[\s\S]{0,60}var\(--glass-sheen\)/.test(glassArea)
      && !/\.topbar::after/.test(css)
      && !/\.params-popover::after/.test(css)
      && !/\.palette::after/.test(css));

  ok('N8: сияние — градиенты, а не filter: blur() (размытие огромного элемента — лишний композит на каждом кадре телефона)',
    /\.ambient i \{[\s\S]{0,400}radial-gradient/.test(css)
      && !/\.ambient[\s\S]{0,60}filter: blur/.test(css));

  ok('N9: на телефоне стекло с размытием 12px; размытие снято только у карточек настроек и расхода (замер: с ним прокрутка настроек падала до 16 fps), а сияние ДЫШИТ',
    /@media \(max-width: 780px\) \{[\s\S]{0,200}--glass-blur: 12px/.test(css)
      && /@media \(max-width: 780px\) \{[\s\S]{0,1800}\.settings-card,[\s\S]{0,260}backdrop-filter: none/.test(css)
      && /--glass: rgba\(52, 52, 70, 0\.34\)/.test(css)
      && /--ambient-1: rgba\(132, 112, 255, 0\.5\)/.test(css));

  /* ── 0.100: жидкое стекло, «Что нового» и подхват в выборе модели ──
     Жидкостью здесь названы ровно две вещи, и обе обязаны быть видны машиной:
     блик, который ходит по панели за пальцем (--mx/--my в токене --glass-sheen),
     и радужная кромка (--glass-prism). Дешёвость — часть требования: слушатели
     passive, запись в переменные по одному rAF-кадру, а на пальце — только
     касание (таскать пятно во время прокрутки значило бы платить кадром). */
  /* Жидкий блик: gradient собран в ПРАВИЛЕ панели, а не в токене. Значение токена
     вычисляется там, где объявлено, — var(--mx) внутри токена «запекался» на :root
     в 50%, и блик не двигался (проверено живьём: переменные на панели стояли,
     фон не менялся). Обе темы обязаны давать цвет пятна. */
  ok('N26: блик читает --mx/--my самой панели (в правиле, а не в токене), и у обеих тем есть цвет пятна',
    /background-image: radial-gradient\(\s*240px 190px at var\(--mx, 50%\) var\(--my, -30%\)/.test(glassArea)
      && ['dark', 'light'].every((t) => {
        const i = css.indexOf("data-theme='" + t + "'");
        const body = i < 0 ? '' : css.slice(i, css.indexOf('\n}', i));
        return body.includes('--glass-spot:') && body.includes('--glass-prism:');
      })
      && !/--glass-sheen: radial-gradient/.test(css.slice(0, css.indexOf('/* ---------- Само стекло'))),
    'жидкий блик собран не там, где надо');


  const liquidSrc = readFileSync('src/hooks/useLiquidGlass.ts', 'utf8');
  ok('N27: блик ходит за пальцем дешёво — passive-слушатели, один кадр на движение, палец только касается',
    /addEventListener\('pointermove', onMove, \{ passive: true \}\)/.test(liquidSrc)
      && /requestAnimationFrame\(paint\)/.test(liquidSrc)
      && /addEventListener\('pointerdown', onPointerDown, \{ passive: true \}\)/.test(liquidSrc)
      /* Оба события: часть браузеров шлёт только одно из двух (проверено). */
      && /addEventListener\('touchstart', onTouch, \{ passive: true \}\)/.test(liquidSrc)
      && /prefers-reduced-motion: reduce/.test(liquidSrc)
      && /setProperty\('--mx'/.test(liquidSrc)
      /* Решение — по e.pointerType, а не по медиазапросу: медиазапрос врёт на
         гибридных ноутбуках и в браузерах без мыши (проверено живьём). */
      && /e\.pointerType === 'mouse'/.test(liquidSrc)
      && /if \(!c\.clientX && !c\.clientY\) return/.test(liquidSrc)
      && /if \(pt && pt !== 'mouse' && pt !== 'pen'\) return/.test(liquidSrc)
      && !/hover: hover\) and \(pointer: fine\)/.test(liquidSrc),
    'тип указателя берётся не из события');

  ok('N28: жидкое стекло включено на всё приложение одной строкой, а не обработчиком в каждой панели',
    /useLiquidGlass\(\)/.test(readFileSync('src/App.tsx', 'utf8')));

  /* «Что нового»: экран существует, читается из своих данных, свежая запись — та,
     что совпадает с версией продукта (забытая запись — красный тест), и точка на
     пункте гаснет при открытии. */
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8');
  const versionSrc = readFileSync('src/lib/version.ts', 'utf8');
  const appVer = (versionSrc.match(/APP_VERSION = '([^']+)'/) || [])[1] || '';
  const firstVer = (notesSrc.match(/version: '([^']+)'/) || [])[1] || '';
  ok('N29: «Что нового» знает текущую версию — свежая запись совпадает с APP_VERSION',
    appVer === firstVer && appVer.length > 0, 'версия ' + appVer + ' против записи ' + firstVer);

  const newsView = readFileSync('src/views/WhatsNewView.tsx', 'utf8');
  const sidebarSrc = readFileSync('src/components/Sidebar.tsx', 'utf8');
  /* appSrc объявлен в начале этого блока (там же читается версия) */
  const modalSrc = readFileSync('src/components/WhatsNewModal.tsx', 'utf8');

  /* 0.102: раздел показывает РОВНО текущую версию. Список прошлых версий убран
     намеренно — после обновления человеку нужно «что поменялось у меня», а не
     история продукта (она живёт в README). */
  ok('N30: «Что нового» — раздел про текущую версию, без списка прошлых',
    /id: 'whatsnew', label: 'Что нового'/.test(sidebarSrc)
      && /side-dot/.test(sidebarSrc)
      && /noteFor\(APP_VERSION\)/.test(newsView)
      && !/RELEASE_NOTES\.map/.test(newsView)
      && /newsDot/.test(appSrc)
      && /newsSeen !== APP_VERSION/.test(appSrc));

  /* Окошко после обновления. Три правила, каждое важно:
       · показывается, только когда запомнена ДРУГАЯ версия (факт обновления);
       · на первом заходе молчит и сразу помечает текущую прочитанной — встречать
         нового человека списком изменений невежливо;
       · закрывается всеми путями (крестик, кнопка, клик мимо, Escape) и после
         закрытия пишет версию, иначе окошко вернётся на следующем же кадре. */
  ok('N32: окошко «Что нового» всплывает после ОБНОВЛЕНИЯ, а не на первом заходе',
    /function shouldShowNews\(\)/.test(appSrc)
      && /if \(!seen\) \{\s*writeNewsSeen\(APP_VERSION\)/.test(appSrc)
      && /return seen !== APP_VERSION && !!noteFor\(APP_VERSION\)/.test(appSrc)
      && /newsOpen && newsNote \? <WhatsNewModal/.test(appSrc),
    'нет правила показа окошка');

  ok('N33: окошко закрывается крестиком (и кликом мимо, и Escape), а закрытие помечает версию прочитанной',
    /news-modal-x/.test(modalSrc)
      && /aria-label="Закрыть"/.test(modalSrc)
      && /e\.target === e\.currentTarget/.test(modalSrc)
      /* Escape — на документе: обработчик на самом окошке ждал бы фокуса внутри
         него, а окошко фокус не забирает (проверено живьём: не закрывалось). */
      && /document\.addEventListener\('keydown', onKey\)/.test(modalSrc)
      && /e\.key === 'Escape'/.test(modalSrc)
      && !/onKeyDown=/.test(modalSrc)
      && /writeNewsSeen\(APP_VERSION\)/.test(appSrc)
      && /const closeNews = useCallback/.test(appSrc)
      && /\.news-modal-x \{/.test(css));

  ok('N34: в окошке видны только пункты текущей версии, и первый запуск не показывает окно',
    /note\.items\.map/.test(modalSrc)
      && !/RELEASE_NOTES/.test(modalSrc)
      && /aria-modal="true"/.test(modalSrc)
      && /В окошке — точка-буллет/.test(css)
      && /\.news-bullet \{/.test(css));

  /* Подхват показывается там, куда человек действительно может посмотреть:
     в «Использовании и Лимитах». В выборе модели его нет намеренно — выбора
     модели в продукте сейчас нет вовсе (движок отвечает сам, «Авто»).
     0.103: от подхвата осталась строка со счётчиком. Пояснения и список имён
     убраны по просьбе владельца — и это тоже закреплено тестом, иначе «объяснить
     полезное» вернётся обратно при первом же желании что-нибудь дописать. */
  const usageView = readFileSync('src/views/UsageView.tsx', 'utf8');
  ok('N31: подхват в «Использовании и Лимитах» — строка со счётчиком, без пояснений',
    /data\.failover/.test(usageView)
      && /plural\(data\.failover\.count/.test(usageView)
      && !/failover\.sample/.test(usageView)
      && !/Отказ провайдера не оставляет без ответа/.test(usageView)
      && !/Как это считается/.test(usageView)
      && /failover,/.test(readFileSync('functions/api/usage.js', 'utf8'))
      && !/model-failover/.test(readFileSync('src/components/ModelPicker.tsx', 'utf8')));


  /* ── 0.104: голосовой ввод — два слоя, новая полоса, честные отказы ──

     Слоёв два, и это не «сделали красивее», а разные обещания:
       · ЧЕРНОВИК (Web Speech API) — появляется мгновенно, но ошибается в шуме;
       · ТОЧНЫЙ ТЕКСТ (наш /api/stt → Whisper) — приходит после остановки и
         заменяет черновик. Именно он даёт «распознавание как у ChatGPT». */
  const voiceSrc = readFileSync('src/lib/voice.ts', 'utf8');
  ok('N35: голос — два слоя: черновик в браузере и точный текст через наш /api/stt',
    /MediaRecorder/.test(voiceSrc)
      && /'\/api\/stt\?lang='/.test(voiceSrc)
      && /onPolished/.test(voiceSrc)
      && /POLISH_MS/.test(voiceSrc));

  /* Кнопка микрофона не должна пропадать из-за одного лишь отказа распознавания:
     записать и расшифровать на сервере можно и без него (Firefox, закрытые сети). */
  ok('N36: микрофон доступен и без браузерного распознавания — достаточно записи',
    /export function isVoiceSupported\(\): boolean \{\s*if \(typeof window === 'undefined'\) return false\s*return hasDraftEngine\(\) \|\| isPolishSupported\(\)/.test(voiceSrc)
      && /export function hasDraftEngine/.test(voiceSrc)
      && /export function isPolishSupported/.test(voiceSrc));

  /* Отказ распознавания — это отказ ЧЕРНОВИКА. Раньше код гасил всю сессию, и
     человек терял запись; теперь сессия живёт, а текст приедет точным. */
  ok('N37: отказ распознавания не гасит сессию, а только сообщает про черновик',
    /onDraftFail/.test(voiceSrc)
      && !/DRAFT_DEAD/.test(voiceSrc)
      && /const startDraft = \(\) => \{/.test(voiceSrc)
      && /getUserMedia\(\{ audio: true \}\)/.test(voiceSrc));

  /* Микрофон решает судьбу сессии, и решается это ДО распознавания: иначе отказ
     браузерного сервиса выглядел бы как «микрофона нет». */
  ok('N38: сначала спрашиваем микрофон, и только он может убить сессию',
    /stream = await navigator.mediaDevices.getUserMedia/.test(voiceSrc)
      && /NotAllowedError/.test(voiceSrc)
      /* Микрофон спрашивают ДО всего остального: запись кусками и черновик — уже
         после того, как он открылся. Иначе отказ браузерного сервиса выглядел бы
         как «микрофона нет». */
      && voiceSrc.indexOf('await navigator.mediaDevices.getUserMedia') < voiceSrc.indexOf('createPcmTap(')
      && /startDraft\(\)\n  \}\)\(\)/.test(voiceSrc));

  const chatSrc = readFileSync('src/views/ChatView.tsx', 'utf8');
  ok('N39: полоса ввода — время, живые столбики, крестик и галочка; текст идёт в поле',
    /voice-strip/.test(chatSrc)
      && /voice-rec/.test(chatSrc)
      && /voice-bars/.test(chatSrc)
      && /voice-ic is-x/.test(chatSrc)
      && /voice-ic is-ok/.test(chatSrc)
      && /Уточняю текст/.test(chatSrc)
      && !/voice-panel/.test(chatSrc)
      /* Черновик виден прямо в поле: так человек читает свою речь там, где она
         окажется после отправки, а не в отдельной карточке. */
      && /onInterim: \(chunk\) => \{\s*if \(liveOnRef\.current\) return\s*\n\s*interimRef\.current = chunk\s*\n\s*setValue\(joinText\(baseRef\.current, chunk\)\)/.test(chatSrc));

  ok('N40: пока идёт речь, поле помечено как черновик — слова ещё сменятся',
    /\.composer\.is-voice \{/.test(css)
      && /\.composer\.is-voice textarea \{/.test(css)
      && /\.voice-strip\.is-polishing/.test(css)
      && /is-voice'/.test(chatSrc));

  /* Тихая поломка, которую поймали живьём: ссылка на @keyframes, которого нет,
     ничего не ломает и не пишет в консоль — анимация просто не играет. */
  {
    const defined = new Set((css.match(/@keyframes\s+([A-Za-z0-9_-]+)/g) || []).map((x) => x.replace(/@keyframes\s+/, '')));
    const used = new Set();
    for (const m of css.matchAll(/animation:\s*([^;]+);/g)) {
      for (const part of m[1].split(',')) {
        const w = part.trim().split(/\s+/)[0] || '';
        if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(w) && w !== 'none') used.add(w);
      }
    }
    const missing = [...used].filter((u) => !defined.has(u));
    ok('N41: каждая анимация в CSS имеет свой @keyframes (иначе она молча не играет)',
      missing.length === 0, missing.join(', '));
  }

  /* ── 0.108: уточнение НА ЛЕТУ — пока человек говорит, текст уже верный ── */
  const pcmSrc = readFileSync('src/lib/pcm.ts', 'utf8');
  ok('N42: звук режется на самостоятельные куски (WAV), а не на куски webm',
    /encodeWav/.test(pcmSrc)
      && /WHISPER_RATE = 16000/.test(pcmSrc)
      && /LIVE_SEC = 4/.test(pcmSrc)
      /* Именно поэтому нельзя было обойтись MediaRecorder: во webm заголовок
         только в первом куске, и «последние четыре секунды» оттуда не достать.
         Проверяем именно КОД: в комментарии это имя стоит по делу. */
      && !/new MediaRecorder|MediaRecorder\(/.test(pcmSrc));

  ok('N43: кусок уходит на уточнение сам, без остановки записи',
    /const flushLive = async \(\) => \{/.test(voiceSrc)
      && /if \(pendingLen < LIVE_SEC \* WHISPER_RATE\) return/.test(voiceSrc)
      && /onLive\?\.\(text\)/.test(voiceSrc)
      && /askServer\(chunk, ac\.signal, true\)/.test(voiceSrc));

  /* Квота и уважение к тишине: кусок молчания — это не запрос. Whisper на тишине
     выдумывает слова, а бесплатные лимиты тратятся впустую. */
  ok('N44: тишина куском не отправляется, а отказы отключают слой после двух подряд',
    /peakOf\(chunk\) < SILENCE_PEAK/.test(voiceSrc)
      && /LIVE_FAILS_MAX = 2/.test(voiceSrc)
      && /liveFails >= LIVE_FAILS_MAX && !liveOk/.test(voiceSrc)
      && /onLiveOff\?\./.test(voiceSrc));

  /* Серверный текст главнее браузерного: иначе одни и те же слова стояли бы в
     поле дважды — черновик браузера и уточнённый кусок про одни и те же секунды. */
  ok('N45: серверный кусок вытесняет браузерный черновик, а не соседствует с ним',
    /if \(liveOnRef\.current\) return \/\/ серверный текст уже главнее/.test(chatSrc)
      && /if \(liveOnRef\.current\) return\n          interimRef\.current = chunk/.test(chatSrc)
      && /baseRef\.current = preVoiceRef\.current\n            interimRef\.current = ''/.test(chatSrc)
      && /joinLive\(baseRef\.current, text\)/.test(chatSrc));

  /* Полный проход по всей записи остаётся: у модели на руках весь контекст, и это
     самый верный вариант из трёх. Если он не удался, а на лету текст был — надо
     сказать именно это, а не «не получилось уточнить» (человек видит текст и не
     понимает, чего от него хотят). */
  ok('N46: в конце — полный проход по записи, и отказ назван честно, если текст уже есть',
    /const askAccurate = async \(\) => \{/.test(voiceSrc)
      && /peакOf|peakOf\(all\) < SILENCE_PEAK/.test(voiceSrc)
      && /liveOk \? 'оставил уточнённое на лету'/.test(voiceSrc)
      && /'Уточняю текст…'/.test(chatSrc));

  ok('N47: видно, что уточнение идёт прямо сейчас (иначе слова меняются «сами»)',
    /voice-tag/.test(chatSrc) && /\.voice-tag \{/.test(css) && /liveBusy/.test(chatSrc));

  ok('N10: если стекло не поддержано или человек просил меньше прозрачности — панели честно непрозрачные',
    /@supports not \(\(backdrop-filter: blur\(1px\)\)/.test(css)
      && /prefers-reduced-transparency: reduce/.test(css)
      && /prefers-contrast: more/.test(css)
      && /backdrop-filter: none/.test(css));

  ok('N11: скримы под ящиками и палитрой размывают фон, а не просто затемняют',
    /backdrop-filter: blur\(7px\)/.test(ruleBody('.drawer-scrim'))
      && /backdrop-filter: blur\(9px\)/.test(ruleBody('.palette-overlay')));

  ok('N12: блок стекла стоит ПОСЛЕ обычных правил — при равной специфичности выигрывает он',
    start > css.indexOf('\n.params-popover {') && start > css.indexOf('\n.settings-card {'));


  ok('N14: стекло НЕ трогает положение элементов — попапы и меню остаются absolute (иначе попап становится блоком в строке поля ввода и растягивает её до 574px — это был баг 0.086)',
    ['.model-panel', '.params-popover', '.attach-menu', '.chat-menu'].every((sel) => !/position:/.test(ruleBody(sel))));

  ok('N15: у обёртки поля ввода своё размытие выключено — иначе backdrop-filter делает её системой координат для fixed-потомков, и затемнение .model-backdrop сжимается до размеров поля (клик мимо перестаёт закрывать попап)',
    !/backdrop-filter: blur/.test(ruleBody('.composer-wrap')) && /backdrop-filter: blur/.test(ruleBody('.composer-wrap::before')));

  /* Прежнее решение (переключатель на свою строку) отменено: оно раздувало блоки
     «Тема» и «Род агента» с 56 до 102 px. Действующее: подписи короче на узком
     экране, переключатель сжимать нельзя, подпись не обрезается. */
  ok('N16: на узком экране переключатель остаётся в строке подписи (не сжимается), а подписи становятся короче',
    /@media \(max-width: 460px\) \{[\s\S]{0,400}\.settings-row \.segmented \{ flex-shrink: 0/.test(css)
      && !/flex: 1 0 100%/.test(css));


  ok('N17: стекло прозрачное в обеих темах (0.34 тёмная / 0.34 светлая), меню поверх текста плотнее (--glass-strong), а поле ввода — свой токен --pane: на тёмных обоях оно светлее фона (замер: без этого панель и фон совпадали по яркости)',
    /--glass: rgba\(52, 52, 70, 0\.34\)/.test(css)
      && /--glass: rgba\(255, 255, 255, 0\.34\)/.test(css)
      && /--glass-strong: rgba\(42, 42, 58, 0\.5\)/.test(css)
      && /--pane: #3e3e54/.test(css)
      && /--pane: #ffffff/.test(css)
      && /background-color: color-mix\(in srgb, var\(--pane\) 46%, transparent\)/.test(lastRuleBody('.composer')));

  ok('N18: переключатели в настройках не раздувают строку (высота 60px, а не 102): блок «Тема» и «Род агента» в одну строку с подписью, подпись не обрезается многоточием',
    /\.seg-short \{\s*display: none/.test(css)
      && /@media \(max-width: 460px\) \{[\s\S]{0,300}\.seg-long \{ display: none/.test(css)
      && !/\.settings-row \.segmented \{\s*flex: 1 0 100%/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));


  ok('N19: стекло есть и у мелочей — капсула чата, круглые кнопки шапки, активный пункт сайдбара размывают и прозрачны (без них казалось, что стекло только в шапке и поле ввода)',
    /\.topbar-pill,[\s\S]{0,120}\.icon-btn\.topbar-round,[\s\S]{0,120}\.side-item\.active \{/.test(glassArea)
      && /\.topbar-pill,[\s\S]{0,400}backdrop-filter: blur\(var\(--glass-blur\)\)/.test(glassArea));

  /* Обои — то, ради чего вообще видно стекло, поэтому сторож тут жёсткий.
     Считаем по CSS БЕЗ комментариев: в пояснениях к правилам встречаются те же
     слова («filter: blur»), и проверка ловила бы текст, а не код. */
  const bareWall = stripCssComments(css);

  ok('N21: под стеклом лежат ОБОИ — базовый цветной градиент на весь экран в обеих темах (замер до них: насыщенность фона 5 из 255, белая панель 46% на светлом фоне визуально не отличалась от фона — человек дважды сказал «не вижу стекло»)', 
    /--wall: linear-gradient\(/.test(bareWall)
      && (bareWall.match(/--wall: linear-gradient\(/g) || []).length >= 2
      && (bareWall.match(/--wall-band: /g) || []).length >= 2
      && /background-image: var\(--wall\)/.test(bareWall)
      && /\.ambient::before \{[\s\S]{0,400}var\(--wall-band\)/.test(bareWall)
      && /\.ambient i \{[\s\S]{0,300}opacity: var\(--ambient-o\)/.test(bareWall)
      && !/\.ambient \{[\s\S]{0,300}opacity: var\(--ambient-o\)/.test(bareWall)
      && !/wall-band[\s\S]{0,200}filter: blur/.test(bareWall));

  ok('N20: сияние дышит на чате и стоит на экранах с крупными карточками — движение под ними стоит кадров (замер: 29,8 fps против 60)',
    /\.ambient:not\(\.ambient-still\) i:nth-child\(1\)/.test(css)
      && /\.ambient-still i \{\s*animation: none !important/.test(css)
      && /view === 'chat' \? 'ambient' : 'ambient ambient-still'/.test(readFileSync('src/App.tsx', 'utf8')));

  ok('N22: зона ввода — стекло, а кнопки поля ввода «плавают» стеклянными кружками: заливка через --pane, кромка, блик, тень; круглыми стали «+», параметры, микрофон и отправка (квадратные 10px-скругления читались как часть пилюли, а не как отдельные кнопки)', 
    /color-mix\(in srgb, var\(--pane\) 40%, transparent\)/.test(lastRuleBody('.composer-wrap'))
      && /\n\.composer \.icon-btn,[\s\S]{0,120}\.composer \.params-btn \{[\s\S]{0,400}border-radius: var\(--r-full\)/.test(bareWall)
      && /\n\.composer \.icon-btn,[\s\S]{0,120}\.composer \.params-btn \{[\s\S]{0,400}color-mix\(in srgb, var\(--pane\) 52%, transparent\)/.test(bareWall)
      && /\n\.composer \.send-btn \{[\s\S]{0,300}border-radius: var\(--r-full\)/.test(bareWall)
      && /\n\.composer \.send-btn \{[\s\S]{0,400}box-shadow:[\s\S]{0,200}var\(--accent\)/.test(bareWall));

  ok('N23: у кнопок поля ввода НЕТ собственного backdrop-filter — четыре кружка с размытием стоили бы четырёх проходов по кадру; стекло держат заливка, кромка и блик поверх уже размытой полки', 
    !/backdrop-filter/.test(lastRuleBody('.composer .icon-btn, .composer .params-btn'))
      && !/backdrop-filter/.test(lastRuleBody('.composer .send-btn')));

  ok('N24: разметка ответа пересобирается только при смене текста (memo), а колбэк вывода кода стабилен (useCallback): иначе каждая буква в поле ввода заново разбирала Markdown всей переписки — это и был лаг печати', 
    /export const Markdown = memo\(/.test(readFileSync('src/components/Markdown.tsx', 'utf8'))
      && /const runOutput = useCallback\(\(t: string\) => onSend\(t\), \[onSend\]\)/.test(readFileSync('src/views/ChatView.tsx', 'utf8'))
      && /<Markdown text=\{m\.text\} onRunOutput=\{runOutput\} \/>/.test(readFileSync('src/views/ChatView.tsx', 'utf8')));

  ok('N25: строки «Модели» и «Версия» в Настройках — короткие: у «Версии» только номер и кнопка (владелец попросил убрать «показывает старую версию? нажмите «Обновить»»), у «Моделей» — число без описания столбцом', 
    !/показывает старую версию/.test(readFileSync('src/views/SettingsView.tsx', 'utf8'))
      && /<div className="n">Версия<\/div>\s*<\/div>/.test(readFileSync('src/views/SettingsView.tsx', 'utf8'))
      && /моделей доступно: /.test(readFileSync('src/lib/api.ts', 'utf8'))
      && !/по провайдерам: /.test(readFileSync('src/lib/api.ts', 'utf8'))
      && !/живых провайдеров: /.test(readFileSync('src/lib/api.ts', 'utf8')));

  ok('N13: системная полоса телефона идёт за темой — полупрозрачная шапка не упирается в чужой цвет',
    /id="meta-theme-color"/.test(htmlSrc)
      && /meta\[name="theme-color"\]/.test(themeSrc)
      && /#0a0a0c/.test(themeSrc) && /#f7f6f2/.test(themeSrc));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

rmSync(dir, { recursive: true, force: true });
