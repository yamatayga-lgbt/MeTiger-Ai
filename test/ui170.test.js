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
const indicatorRaw = readFileSync('src/components/ContextUsageIndicator.tsx', 'utf8');
/* Комментарии срезаем: они объясняют код словами, и поиск по словам ловил бы в них
   то, чего в самом коде нет (та же ловушка, что с тестами формы в 0.160). */
const indicator = indicatorRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
  /version: '0\.170'/.test(notes) && /\*\*0\.170\*\*/.test(readme));

ok('U170c движок отдаёт числа контекста из реальной подгонки, а не из каталога',
  /ctxUsed: fitNow\.tokens, ctxWindow: fitNow\.window/.test(engine)
    && /ctx: hit && hit\.ctxWindow \? \{ used: hit\.ctxUsed \|\| 0, window: hit\.ctxWindow \} : undefined/.test(engine));
ok('U170d вход пропускает числа наружу — и в обычном ответе, и в потоке (одна сборка ответа)',
  /ctx: r\.ctx \|\| undefined/.test(apiFn));
ok('U170e тип ответа знает поле ctx',
  /ctx\?: \{ used: number; window: number \}/.test(api));
ok('U170f App хранит числа и сбрасывает их при смене чата — старые числа не выглядят текущими',
  /const \[ctxInfo, setCtxInfo\] = useState<\{ used: number; window: number \} \| null>\(null\)/.test(app)
    && /if \(r\.ok && r\.ctx && r\.ctx\.window > 0\) setCtxInfo\(r\.ctx\)/.test(app)
    && /useEffect\(\(\) => \{ setCtxInfo\(null\) \}, \[activeChatId\]\)/.test(app)
    && /ctxUsage=\{ctxInfo\}/.test(app));
ok('U170g ChatView берёт числа из пропсов, а не из зашитого нуля (ровно та ошибка, из-за которой фича молчала)',
  /ctxUsage\?: \{ used: number; window: number \} \| null/.test(chatView)
    && !/useState\(\{ usedTokens: 0, maxTokens: 0 \}\)/.test(chatView)
    && /const contextInfo = ctxUsage && ctxUsage\.window > 0/.test(chatView));
ok('U170h без настоящих чисел индикатор не показывается вовсе',
  /\{contextInfo\.maxTokens > 0 \? \(/.test(chatView) && /if \(!\(maxTokens > 0\)\) return null/.test(indicator));
ok('U170i процент считается без мигания: прямо в разметке, без состояния и useEffect',
  !/useEffect/.test(indicator) && !/useState/.test(indicator) && /Math\.min\(100, Math\.round\(\(used \/ maxTokens\) \* 100\)\)/.test(indicator));
ok('U170j предупреждение — коротко и с порога, а не всегда',
  /context-usage-alert/.test(indicator) && /почти полон/.test(indicator)
    && /percent >= warningThreshold \* 100/.test(indicator) && /\.context-usage-alert/.test(css));
ok('U170n индикатор живёт строкой над полем, а не внутри «пилюли» (там он поджимал кнопки)',
  /contextInfo\.maxTokens > 0 \? \(/.test(chatView)
    && chatView.indexOf('</form>') < chatView.indexOf('<ContextUsageIndicator')
    && /white-space: nowrap/.test(css) && /\.context-usage-nums/.test(css));
ok('U170k версия видна рядом с именем агента в подсказке у поля ввода',
  /composer-hint-version/.test(chatView) && /v\{APP_VERSION\}/.test(chatView));
ok('U170l новые тесты 0.170 подключены к цепочке прогона (раньше их не запускал никто)',
  /node test\/docmap\.test\.js/.test(testChain)
    && /node test\/smartmemory\.test\.js/.test(testChain)
    && /node test\/ui170\.test\.js/.test(testChain));
ok('U170m скрипт выпуска, на который ссылается RELEASE_WORKFLOW.md, существует в package.json',
  pkg.scripts['prepare-release'] === 'node scripts/prepare-release.cjs');

console.log('\n0.170: все проверки пройдены');
