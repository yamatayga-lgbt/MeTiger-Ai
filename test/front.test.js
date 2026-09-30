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
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

rmSync(dir, { recursive: true, force: true });
