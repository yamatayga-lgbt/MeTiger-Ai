/**
 * 0.168: поиск автоматический — кнопки нет, решает запрос.
 *
 * Владелец: «Убери кнопку поиска, поиск будет автоматическим, смотря если нужно
 * искать в интернете, зависит от запроса». Проверяем обе половины: кнопки и её
 * следов в интерфейсе не осталось, а правило выбора живёт в движке, включено в
 * инструмент веб-поиска и не теряет короткий запрос («новости», «курс»).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const chatView = readFileSync('src/views/ChatView.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const tools = readFileSync('engine/tools.js', 'utf8');
const webrules = readFileSync('engine/webrules.js', 'utf8');
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
ok('U168a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U168b «Что нового» и README знают про 0.168',
  /version: '0\.168'/.test(notes) && /\*\*0\.168\*\*/.test(readme));

ok('U168c кнопки нет: ни разметки, ни состояния, ни стиля',
  chatView.indexOf('web-btn') < 0 && chatView.indexOf('webForce') < 0
    && chatView.indexOf('mt-web-force') < 0 && css.indexOf('.web-btn') < 0);
ok('U168d App не отправляет поиск «по кнопке» — решения принимает движок',
  !/webSearch: true/.test(app) && !/web\?: boolean/.test(app));
ok('U168e правило в движке: счёт очков, порог два, причина словами',
  /export function needsWeb/.test(webrules) && /score >= 2|score < 2/.test(webrules)
    && /данные меняются/.test(webrules) && /не меняется/.test(webrules));
ok('U168f инструмент веб-поиска включается правилом, а не списком слов',
  /when: \(t\) => needsWeb\(t\)\.need/.test(tools) && /import { needsWeb } from '\.\/webrules\.js'/.test(tools));
ok('U168g короткий запрос («новости», «курс») не теряется: очищенный вопрос, а иначе сам вопрос',
  /const q = queryOf\(text\) \|\| clean\(String\(text \|\| ''\)\)\.slice\(0, 120\)/.test(tools));
ok('U168h кириллические границы в правилах не ловушка: \\b на кириллице в JS не работает',
  !/\\b(?:цены|ввп)\b/.test(webrules));
ok('U168i тесты автопоиска и 0.168 в цепочке прогона',
  /node test\/webauto\.test\.js/.test(testChain) && /node test\/ui168\.test\.js/.test(testChain));
ok('U168j старый тест кнопки 0.166 из цепочки убран',
  !/test\/ui166\.test\.js/.test(testChain));

console.log('\n0.168: все проверки пройдены');
