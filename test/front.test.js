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
  ok('G3: строка источника рядом, человек видит, кто именно отвечал', /gpt-oss-120b/.test(html) && /2541 мс/.test(html));
  const quiet = renderToStaticMarkup(
    React.createElement(ChatView, {
      user: { first_name: 'Тигр' },
      messages: [{ id: 'm2', role: 'assistant', text: 'привет' }],
      typing: false, onSend() {},
    }),
  );
  ok('G4: у сообщения без мета подписи нет (не пустая плашка под каждым ответом)', !/msg-meta/.test(quiet));
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
    user: { first_name: 'Тигр' }, messages: [{ id: 'x', role: 'assistant', text: 'привет' }], typing: false, onSend() {}, model: 'wide/model-b',
  }));
  ok('I9: чип в окне ввода показывает выбранную модель (в бандле — тот же кэш)', /Wide Model/.test(chip), (chip.match(/model-chip-name[^<]*<\/span>/) || [''])[0]);

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
  ok('K8: сколько моделей и по провайдерам — из ответа сервера', /моделей доступно: 12 \(в каталогах провайдеров: 40\)/.test(line) && /Groq 5, x\.ai 7/.test(line), line);
  ok('K9: живые провайдеры считаются по aliveness-списку движка', /живых провайдеров: 2 из 6/.test(line), line);
  ok('K10: время обновления каталога показано, а не «когда-то»', /каталог обновлён \d{2}\.\d{2} \d{2}:\d{2}/.test(line), line);
  const poor = countersLine({ count: 3, cached: false, updatedAt: null, pools: [] }, {});
  ok('K11: без каталога и без KV строка объясняет состояние, а не врёт про 0', /моделей доступно: 3/.test(poor) && /каталог ещё не обновлялся/.test(poor) && /без KV список живёт/.test(poor) && !/из /.test(poor), poor);
  ok('K12: пустые ответы — пустая строка (UI не покажет «undefined»)', countersLine(null, null) === '' && countersLine({}, {}) === '');
  const broken = countersLine({ count: 2, pools: [], updatedAt: 1, errors: ['у', 'двух'] }, { alive: [], providers: 4 });
  ok('K13: ошибки чтения каталога видны в строке, а не проглочены', /каталог: 2 ошибок чтения/.test(broken) && /живых провайдеров: 0 из 4/.test(broken), broken);
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

  ok('L1: к запуску допускается только явный JS (ts/python/без языка — нет)',
    S.runnable('js') && S.runnable('JavaScript') && !S.runnable('ts') && !S.runnable('python') && !S.runnable(''),
    [S.runnable('js'), S.runnable('ts'), S.runnable('')].join('/'))
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

  /* А вот это уже про вёрстку: кнопка обязана быть у JS-блока, а iframe — без same-origin. */
  const runner = readFileSync(join(process.cwd(), 'src', 'components', 'CodeRunner.tsx'), 'utf8')
  const chat = readFileSync(join(process.cwd(), 'src', 'views', 'ChatView.tsx'), 'utf8')
  ok('L13: iframe запускается строго с allow-scripts и без allow-same-origin',
    (() => { const m = /sandbox="([^"]*)"/.exec(runner); return !!m && m[1] === 'allow-scripts'; })(),
    (runner.match(/sandbox="[^"]*"/) || [''])[0])
  ok('L14: watchdog стоит, и по нему фрейм снимается (убить цикл больше нечем)',
    /setTimeout\(/.test(runner) && /setDoc\(null\)/.test(runner))
  ok('L15: JS-блок в чате помечен «песочница», а не «demo», и кнопка ему дана',
    /runnable\(lang\)[\s\S]{0,80}песочница/.test(chat) && /<CodeRunner/.test(chat))
  ok('L16: вывод можно вернуть модели — иначе цикл обрывается на «у меня упало»',
    /onSend/.test(runner) && /Вывод — модели/.test(runner) && /onRunOutput/.test(chat))
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
    const api = readFileSync('src/lib/api.ts', 'utf8');
    const chat = readFileSync('src/views/ChatView.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    ok('M20: живой канал рассуждений доехал до экрана и выглядит не как ответ',
      chat.includes('msg-reason-live') && chat.includes('aria-label="Модель думает вслух"')
        && api.includes("ev.channel === 'reasoning'"));
    ok('M21: «думает вслух» — постоянная функция для думающих моделей (управляется тумблером «Думает» в пикере, без отдельной кнопки в окне ввода)',
      app.includes("'mt-reasoning'") && app.includes('canModelThink(model)') && !chat.includes('reason-toggle'));
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

    const logoSrc = readFileSync('src/components/Logo.tsx', 'utf8');
    const favSvg = readFileSync('public/favicon.svg', 'utf8');
    ok('M26: везде вместо старой буквы «M» стоит аватарка тигра (LogoMark, favicon и чип «Авто»)',
      logoSrc.includes('agent-avatar.png')
        && !logoSrc.includes('M8.5 23V9.8')
        && !favSvg.includes('M8.5 23V9.8')
        && existsSync('public/favicon.png')
        && /class="m-av[^"]*"[^>]*><img[^>]*class="m-av-img"/.test(htmlOn));

    const out5 = join(dir, 'picker-pro.mjs');
    const entry5 = join(dir, 'picker-pro-entry.tsx');
    writeFileSync(entry5, [
      "export { ModelPicker } from '../../../src/components/ModelPicker'",
      "export { ParamsPopover } from '../../../src/components/ParamsPopover'",
      "export { ModelIcon, detectBrand } from '../../../src/components/ModelIcon'",
      "export { Topbar } from '../../../src/components/Topbar'",
      "export { canModelThink, DEFAULT_GEN_PARAMS } from '../../../src/lib/models'",
      '',
    ].join('\n'), 'utf8');
    execFileSync(bin, [
      entry5, '--bundle', '--platform=node', '--format=esm',
      '--packages=external', '--loader:.png=dataurl', '--outfile=' + out5, '--log-level=error',
    ], { stdio: 'inherit' });
    const { ModelPicker: MP5, ParamsPopover, Topbar, detectBrand, canModelThink, DEFAULT_GEN_PARAMS } = await import(out5);

    ok('M27: оригинальные бренд-иконки определяются по семейству ИИ (Google, Qwen, DeepSeek, Mistral, OpenAI, MeTiger)',
      detectBrand('') === 'metiger'
        && detectBrand('gemini-2.5-flash') === 'google'
        && detectBrand('qwen/qwen3.5-plus:free') === 'qwen'
        && detectBrand('deepseek-v4-flash') === 'deepseek'
        && detectBrand('codestral-latest') === 'mistral'
        && detectBrand('openai/gpt-oss-20b') === 'openai');

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

    const htmlTopbar = renderToStaticMarkup(
      React.createElement(Topbar, {
        title: 'Новый чат',
        onOpenMenu() {},
        onOpenWorkspace() {},
      }),
    );
    const cssSrc = readFileSync('src/styles/index.css', 'utf8');
    ok('M31: заголовок «Новый чат» центрирован в Topbar, а список моделей в пикере прокручивается (grid-template-rows: minmax(0, 1fr))',
      /class="topbar-side topbar-left"/.test(htmlTopbar)
        && /<div class="page-title">Новый чат<\/div>/.test(htmlTopbar)
        && /class="topbar-side topbar-right"/.test(htmlTopbar)
        && cssSrc.includes('grid-template-columns: 44px 1fr 44px')
        && cssSrc.includes('grid-template-rows: minmax(0, 1fr)'));

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
  }
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

rmSync(dir, { recursive: true, force: true });
