/**
 * 0.166: кнопка «Искать в интернете» у поля ввода.
 *
 * Поиск умел включаться сам, но человек не мог сказать «ответь со свежими данными»
 * прямо. Проверяем весь путь флага: кнопка → ChatView → App → тело запроса, и что
 * выключенная кнопка ничего не отправляет (иначе поиск включался бы всем и всегда,
 * а это время и чужие лимиты).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatView = readFileSync('src/views/ChatView.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const search = readFileSync('engine/search.js', 'utf8');
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
ok('U166a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && vmd.indexOf('# Version ' + currentVersion) >= 0),
  [currentVersion, pkg.version]);
ok('U166b «Что нового» и README знают про 0.166',
  /version: '0\.166'/.test(notes) && /\*\*0\.166\*\*/.test(readme));

ok('U166c кнопка есть, у неё понятная подпись и состояние для чтения с экрана',
  /aria-label=\{webForce \? 'Выключить поиск в интернете' : 'Искать в интернете'\}/.test(chatView)
    && /aria-pressed=\{webForce\}/.test(chatView) && /<Globe size=\{16\} \/>/.test(chatView));
ok('U166d переключатель запоминается, а не сбрасывается при выходе из чата',
  /usePersistentState\('mt-web-force', false\)/.test(chatView));
ok('U166e флаг доезжает от ChatView до App при отправке',
  /onSend: \(text: string, images\?: string\[\], attachments\?: Attachment\[\], web\?: boolean\) => void/.test(chatView)
    && /webForce,\n\s*\)/.test(chatView));
ok('U166f App отправляет webSearch только когда кнопка включена',
  /\.\.\.\(web \? \{ webSearch: true \} : \{\}\)/.test(app) && /web\?: boolean/.test(app));
ok('U166g api.ts кладёт webSearch в тело запроса, а не в каждый запрос по умолчанию',
  /webSearch: opts\.webSearch \? true : undefined/.test(api) && /webSearch\?: boolean/.test(api));
ok('U166h включённая кнопка видна стилем',
  /\.web-btn\.is-on/.test(css) && /var\(--accent\)/.test(css.split('.web-btn.is-on')[1].slice(0, 200)));
ok('U166i кэш поиска — час, а не десять минут',
  /const CACHE_MS = 60 \* 60 \* 1000/.test(search));
ok('U166j тест 0.166 в цепочке прогона', /node test\/ui166\.test\.js/.test(testChain));

console.log('\n0.166: все проверки пройдены');
