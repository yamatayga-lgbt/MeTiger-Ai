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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
if (!existsSync(bin)) {
  console.log('фронт: esbuild не установлен — проверки подписи пропущены (не найден ' + bin + ')');
  process.exit(0);
}

/* Временные файлы — внутри node_modules/.cache: react и react-dom должны
   разрешиться оттуда так же, как в приложении (в /tmp импорт упал бы в
   ERR_MODULE_NOT_FOUND, и проверка «проверяла бы» отсутствие react). */
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-front');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = join(dir, 'api.mjs');
execFileSync(bin, ['src/lib/api.ts', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
const { adviceLine, sourceLine } = await import(out);
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
    /Витрина/.test(html) && /Пулы движка · 1/.test(html) && /Каталог провайдеров · 2/.test(html), (html.match(/model-section-title">[^<]*/g) || []).join('|'));
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
    /Витрина/.test(offline) && /каталог недоступен/.test(offline) && /Gemini 3\.8 Flash/.test(offline), (offline.match(/каталог недоступен[^<]*/) || [''])[0]);
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

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

rmSync(dir, { recursive: true, force: true });
