/**
 * «Сколько шёл ответ» и «когда это было» под сообщением (0.067).
 * Логика живёт в src/lib/time.ts (TypeScript) — проверка берёт её настоящим
 * импортом через esbuild, как остальные lib-тесты в этом проекте.
 *
 *   node test/msgtime.test.js
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
  console.log('✖ время под сообщением: esbuild не найден (' + bin + ') — проверки НЕ выполнены. Нужно `npm install`.');
  process.exit(1);
}

const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-msgtime');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = join(dir, 'time.mjs');
execFileSync(bin, ['src/lib/time.ts', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
const { pluralRu, fmtDuration, fmtAgo, fmtAssistantFooterTime } = await import(out);

console.log('T — склонение (минута/минуты/минут и т.п.)');
ok('T1: 1 минута', pluralRu(1, 'минута', 'минуты', 'минут') === 'минута');
ok('T2: 2 минуты', pluralRu(2, 'минута', 'минуты', 'минут') === 'минуты');
ok('T3: 5 минут', pluralRu(5, 'минута', 'минуты', 'минут') === 'минут');
ok('T4: 11 минут (не «минута» по последней цифре!)', pluralRu(11, 'минута', 'минуты', 'минут') === 'минут');
ok('T5: 21 минута', pluralRu(21, 'минута', 'минуты', 'минут') === 'минута');

console.log('D — длительность ответа');
ok('D1: меньше секунды всё равно не «0 с»', fmtDuration(400) === '1 с');
ok('D2: 48 секунд', fmtDuration(48000) === '48 с');
ok('D3: 4 мин 48 с', fmtDuration(4 * 60000 + 48000) === '4 мин 48 с');
ok('D4: ровно 5 минут — без «0 с» в хвосте', fmtDuration(5 * 60000) === '5 мин');
ok('D5: больше часа', fmtDuration(3600000 + 2 * 60000) === '1 ч 02 мин');

console.log('A — «когда это было»');
const now = Date.now();
ok('A1: только что (<10с)', fmtAgo(now - 3000, now) === 'только что');
ok('A2: секунды', fmtAgo(now - 40000, now) === '40 секунд назад');
ok('A3: минуты', fmtAgo(now - 9 * 60000, now) === '9 минут назад');
ok('A4: одна минута — верное склонение', fmtAgo(now - 60000, now) === '1 минуту назад');
ok('A5: часы', fmtAgo(now - 3 * 3600000, now) === '3 часа назад');
ok('A6: вчера', fmtAgo(now - 26 * 3600000, now) === 'вчера');
ok('A7: несколько дней', fmtAgo(now - 3 * 86400000, now) === '3 дня назад');
ok('A8: больше недели — дата, а не «N дней назад»', /^\d{2}\.\d{2}$/.test(fmtAgo(now - 20 * 86400000, now)));

console.log('F — итоговая строка под ответом ИИ');
ok('F1: есть и длительность, и «когда» — через точку', fmtAssistantFooterTime(48000, now - 60000, now) === '48 с · 1 минуту назад');
ok('F2: нет длительности (старое сообщение до 0.067) — остаётся только «когда»', fmtAssistantFooterTime(undefined, now - 60000, now) === '1 минуту назад');
ok('F3: нет вообще ничего — пустая строка, а не «undefined»', fmtAssistantFooterTime(undefined, undefined, now) === '');

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

rmSync(dir, { recursive: true, force: true });
