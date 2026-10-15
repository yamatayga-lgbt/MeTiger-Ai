/**
 * 0.164: живость и скорость (волна «обогнать DeepSeek», пункт 4).
 *
 * Человек судит об агенте по двум числам, которых у нас не было: когда он заговорил
 * и не пришёл ли ответ пустым. Проверяем, что замер действительно снимается на
 * первом куске текста, доезжает до экрана «Использование» и что мы не показываем
 * выдуманных нулей вместо «ещё нет замеров».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const app = readFileSync('src/App.tsx', 'utf8');
const models = readFileSync('src/lib/models.ts', 'utf8');
const usage = readFileSync('src/views/UsageView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const vmd = readFileSync('VERSION.md', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const testChain = String(pkg.scripts.test || '');

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''));
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U164a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U164b «Что нового» и README знают про 0.164',
  /\*\*0\.164\*\*/.test(readme));

ok('U164c время до первого слова снимается на первом непустом куске черновика, а не на старте запроса',
  app.indexOf('let firstTokenAt = 0') >= 0
    && /onDraft: \(t\) => \{\s*\n\s*if \(t && !firstTokenAt\) firstTokenAt = Date\.now\(\)/.test(app));
ok('U164d замер уходит вместе со счётчиком запросов, и пустым считается ответ без текста',
  /msToFirst: firstTokenAt \? firstTokenAt - startedAt : 0/.test(app)
    && /empty: !\(r\.reply \|\| ''\)\.trim\(\)/.test(app));
ok('U164e модели хранят замеры отдельным ключом и не растут бесконечно',
  /const SPEED_KEY = 'mt-model-speed'/.test(models) && /const SPEED_MAX = 300/.test(models)
    && /slice\(-SPEED_MAX\)/.test(models));
ok('U164f нулевые и отрицательные замеры отбрасываются: «не поймали» — не рекорд',
  /extra\.msToFirst > 0/.test(models));
ok('U164g хвост считается ближайшим рангом (как в серверных замерах), без интерполяции',
  /export function pctl/.test(models) && /Math\.ceil\(\(p \/ 100\) \* a\.length\) - 1/.test(models));
ok('U164h сводка отдаёт p50/p95, долю пустых и умеет сбрасываться',
  /export function speedSummary/.test(models) && /firstP50/.test(models) && /firstP95/.test(models)
    && /emptyCount/.test(models) && /export function clearSpeed/.test(models));
ok('U164i на экране «Использование» есть блок «Живость и скорость» с живыми провайдерами',
  /Живость и скорость/.test(usage) && /Что живо/.test(usage) && /speed\.firstP50/.test(usage)
    && /speed\.firstP95/.test(usage) && /Первый ответ/.test(usage));
ok('U164j когда замеров нет — прочерк и слова, а не выдуманный ноль секунд',
  /speed\.firstSample \? fmtSec\(speed\.firstP50\) : '—'/.test(usage) && /пока нет замеров/.test(usage));
ok('U164k пустые ответы показаны честно и кнопка сброса чистит замеры',
  /Пустых ответов/.test(usage) && /clearSpeed\(\)/.test(usage) && /\.speed-grid/.test(css));
ok('U164l тесты 0.164 в цепочке прогона',
  /node test\/speed\.test\.js/.test(testChain) && /node test\/ui164\.test\.js/.test(testChain));

console.log('\n0.164: все проверки пройдены');
