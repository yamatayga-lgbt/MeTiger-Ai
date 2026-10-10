/** Исторические проверки 0.135 и текущий предел длины названия чата. */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const out = '/tmp/chatgroups-test.mjs';
execFileSync('node_modules/.bin/esbuild', ['src/lib/chatGroups.ts', '--format=esm', '--outfile=' + out, '--log-level=error']);
const { groupLabel, groupChats } = await import(out);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✖ ' + n + (x ? ' — ' + x : '')); } };
const now = new Date(2026, 9, 9, 21, 0).getTime(), D = 864e5;
ok('U135a Сегодня', groupLabel(now - 3600e3, now) === 'Сегодня');
ok('U135b Вчера', groupLabel(now - D, now) === 'Вчера');
ok('U135c 7 дней', groupLabel(now - 4 * D, now) === 'Последние 7 дней');
ok('U135d 30 дней', groupLabel(now - 20 * D, now) === 'Последние 30 дней');
ok('U135e месяц', groupLabel(new Date(2026, 6, 3).getTime(), now) === 'Июль');
ok('U135f месяц прошлого года', groupLabel(new Date(2025, 11, 3).getTime(), now) === 'Декабрь 2025');
const g = groupChats([{ updatedAt: now - 2 * D }, { updatedAt: now - 60e3 }, { updatedAt: now - 3 * D }], now);
ok('U135g порядок и слияние групп', g.length === 2 && g[0].label === 'Сегодня' && g[1].items.length === 2 && g[1].items[0].updatedAt === now - 2 * D);
const app = readFileSync('src/App.tsx', 'utf8');
ok('U135h название чата ограничено 30 символами', /TITLE_MAX = 30/.test(app) && /titleFromText\(/.test(app)
  && /maxLength=\{30\}/.test(readFileSync('src/components/Sidebar.tsx', 'utf8')) && /maxLength=\{30\}/.test(readFileSync('src/components/Topbar.tsx', 'utf8')));
ok('U135i у поля ввода нет полосы прокрутки', /\.composer textarea::-webkit-scrollbar \{ display: none/.test(readFileSync('src/styles/index.css', 'utf8')));
console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
