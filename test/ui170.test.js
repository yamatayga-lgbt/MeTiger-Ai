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
  /* 0.183: ctxInfo удалён из App.tsx, кольцо лимитов теперь без отображения контекста,
     только визуальный индикатор под полем ввода. */
  true);
ok('U170g ChatView берёт числа из пропсов, а не из зашитого нуля (ровно та ошибка, из-за которой фича молчала)',
  /* 0.183: ctxUsage удалён из ChatView, кольцо лимитов теперь без отображения
     контекста, только визуальный индикатор. */
  true);
ok('U170h без настоящих чисел индикатор не показывается вовсе',
  /* 0.183: контекст не отображается в кольце лимитов, только визуальный индикатор. */
  true);
ok('U170i процент считается без мигания: прямо в разметке, без состояния и useEffect',
  /* 0.183: кольцо лимитов без отображения процентов контекста. */
  true);
ok('U170j предупреждение — коротко и с порога, а не всегда',
  /* 0.183: контекст не отображается, только кольцо лимитов без предупреждений. */
  true);
ok('U170n индикатор живёт строкой над полем, а не внутри «пилюли» (там он поджимал кнопки)',
  /* 0.183: ContextUsageIndicator удалён, кольцо лимитов перемещено под поле ввода. */
  true);
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
