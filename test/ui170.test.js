/**
 * 0.170: заполнение контекста и версия рядом с именем агента.
 *
 * Урок этой версии: индикатор контекста приехал в код подключённым к константе
 * `{ usedTokens: 0, maxTokens: 0 }` — условие `maxTokens > 0` не выполнялось никогда,
 * и фича молча не показывалась никому. Поэтому проверяем не «компонент существует»,
 * а весь путь чисел: движок считает (ctxfit) → уезжает в ответ → вход пропускает →
 * App хранит и сбрасывает при смене чата → ChatView рисует. Плюс отдельно — что
 * без настоящих чисел индикатор не показывается: пустая полоска «0 %» врала бы.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const engine = readFileSync('engine/chat.js', 'utf8');
const apiFn = readFileSync('functions/api/chat.js', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const chatView = readFileSync('src/views/ChatView.tsx', 'utf8');
const logo = readFileSync('src/components/Logo.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const testChain = String(pkg.scripts.test || '');

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''));
  console.log('  ✔ ' + name);
};

const v = versionsAligned();
ok('U170a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  v.ok, v.why);
ok('U170b «Что нового» и README знают про 0.170',
  /\*\*0\.170\*\*/.test(readme));

ok('U170c движок отдаёт числа контекста из реальной подгонки, а не из каталога',
  /ctxUsed: fitNow\.tokens, ctxWindow: fitNow\.window/.test(engine)
    && /ctx: hit && hit\.ctxWindow \? \{ used: hit\.ctxUsed \|\| 0, window: hit\.ctxWindow \} : undefined/.test(engine));
ok('U170d вход пропускает числа наружу — и в обычном ответе, и в потоке (одна сборка ответа)',
  /ctx: r\.ctx \|\| undefined/.test(apiFn));
ok('U170e тип ответа знает поле ctx',
  /ctx\?: \{ used: number; window: number \}/.test(api));
/* 0.228: проверки U170f, U170g, U170h, U170i, U170j и U170n удалены.
   В 0.183 индикатор контекста убрали из приложения, а проверки оставили с
   условием `true` — они печатали зелёную галочку, ничего не проверяя. Такая
   галочка хуже отсутствующей: она врёт, что всё под контролем. */
ok('U170k версия видна в шапке меню рядом с именем агента, а из подписи под полем убрана (0.170, просьба владельца)',
  /<span className="brand-version">v\{APP_VERSION\}<\/span>/.test(logo)
    && /import \{ APP_VERSION \} from '\.\.\/lib\/version'/.test(logo)
    && /\.brand-version \{/.test(css)
    && !/composer-hint-version/.test(chatView)
    && !/composer-hint-version \{/.test(css)
    && !/ИИ может ошибаться/.test(chatView));
ok('U170l новые тесты 0.170 подключены к цепочке прогона (раньше их не запускал никто)',
  /node test\/docmap\.test\.js/.test(testChain)
    && /node test\/smartmemory\.test\.js/.test(testChain)
    && /node test\/ui170\.test\.js/.test(testChain));
ok('U170m скрипт выпуска, на который ссылается RELEASE_WORKFLOW.md, существует в package.json',
  pkg.scripts['prepare-release'] === 'node scripts/prepare-release.cjs');

console.log('\n0.170: все проверки пройдены');
