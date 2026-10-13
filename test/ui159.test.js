/**
 * 0.159: меню без «Дел» и без дублей, профиль = настройки, шторка параметров.
 *
 * Четыре просьбы владельца со скриншотом:
 *   1. «Убери в разделе вкладку "Дела" и всё что с ней связано»;
 *   2. «"Использование и Лимиты" из разделов убери, потому что они есть в Настройках»;
 *   3. «Настроек вкладку убери и перемести 4 компонента во вкладку Профиль.
 *      Потому что Профиль и будет читаться как Настройки»;
 *   4. «Плоская серая линия… сделай так чтобы эта линия тоже сворачивалась пальцем.
 *      Ну так же и сделай компактное меню параметров, а то высота высокая».
 *
 * Что защищаем этим стражем:
 *   • «Дел» нет нигде: ни файлов, ни пункта меню, ни маршрута, ни кнопки в шапке;
 *   • из разделов меню убраны и «Дела», и «Использование и Лимиты»; расход
 *     остался строкой в профиле и открывается оттуда;
 *   • отдельного экрана настроек нет, а его четыре компонента живут в профиле;
 *   • «Внешний вид» по-прежнему раскрывается и переключает тему;
 *   • ручка шторки параметров стала областью захвата и закрывает панель жестом
 *     вниз; панель сжата по высоте.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
const profile = readFileSync('src/views/ProfileView.tsx', 'utf8');
const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8');
const topbar = readFileSync('src/components/Topbar.tsx', 'utf8');
const persist = readFileSync('src/lib/persist.ts', 'utf8');
const params = readFileSync('src/components/ParamsPopover.tsx', 'utf8');
const chatView = readFileSync('src/views/ChatView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const appCode = code(app);
const sidebarCode = code(sidebar);
const profileCode = code(profile);

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U159a все источники версии синхронизированы (version.ts, package.json, package-lock)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion
    && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

/* --- 1. «Дела» убраны целиком --- */
ok('U159b «Дела» не существуют как код: файлы удалены, тесты сняты',
  !existsSync('src/views/CasesView.tsx')
    && !existsSync('src/components/CaseEditorModal.tsx')
    && !existsSync('src/lib/cases.ts')
    && !existsSync('test/cases.test.js')
    && !existsSync('test/ui138.test.js'));
ok('U159c «Дела» не существуют как интерфейс: ни маршрута, ни пункта, ни кнопки в шапке',
  !appCode.includes("'cases'")
    && !/id: 'cases'/.test(sidebarCode)
    && !/CasesView|CaseEditorModal|caseContext|loadCases|saveCases/.test(appCode)
    && !/Записать как дело|Обновить дело|onSaveCase/.test(appCode)
    && !/onSaveCase|Записать как дело/.test(code(topbar)));
ok('U159d из палитры команд переход в «Дела» убран',
  !/go-cases/.test(palette) && !/navigate\('cases'\)/.test(palette));

/* --- 2. «Использование и Лимиты» — только строкой в профиле --- */
ok('U159e в разделах меню нет «Использования и Лимитов», но экран жив и открывается из профиля',
  !/id: 'usage'/.test(sidebarCode)
    && /label="Использование и лимиты"/.test(profileCode)
    && /onNavigate\('usage'\)/.test(profileCode)
    && /view === 'usage' \?/.test(app) && /<UsageView \/>/.test(app));
ok('U159f из «Использования и лимитов» назад ведут в профиль',
  /usage: 'profile'/.test(app));

/* --- 3. Отдельного экрана настроек нет — они в профиле --- */
ok('U159g экрана настроек нет: файл удалён, маршрут убран, палитра о профиле',
  !existsSync('src/views/SettingsView.tsx')
    && !appCode.includes("'settings'")
    && !/go-settings|navigate\('settings'\)/.test(palette)
    && /Открыть профиль и настройки/.test(palette));
ok('U159h четыре компонента настроек переехали в профиль и работают',
  ['Внешний вид', 'Управление данными', 'Сообщить об ошибке', 'Информация'].every((t) => profileCode.includes(t))
    && /appearanceOpen/.test(profileCode)
    && /onThemePref/.test(profileCode)
    && /variant="icon"/.test(profileCode)
    && /onNavigate\('data'\)/.test(profileCode)
    && /onNavigate\('info'\)/.test(profileCode));
ok('U159i строка «Настройки» из профиля убрана — профиль и есть настройки',
  !/rows-name">Настройки</.test(profileCode));
ok('U159j из вложенных экранов стрелка «назад» ведёт в профиль',
  /personalization: 'profile'/.test(app)
    && /data: 'profile'/.test(app)
    && /info: 'profile'/.test(app));
ok('U159k сохранённый раздел из прошлых версий не ломает старт: «Настройки» → профиль, «Дела» → чат',
  /if \(v === 'cases'\) return 'chat'/.test(persist)
    && /if \(v === 'settings'\) return 'profile'/.test(persist));

/* --- 4. Шторка параметров: ручка-жест и компактность --- */
ok('U159l ручка шторки стала областью захвата и закрывает панель жестом вниз',
  /className="params-grab"/.test(params)
    && /onPointerDown=\{onPointerDown\}/.test(params)
    && /onPointerUp=\{finishDrag\}/.test(params)
    && /setPointerCapture/.test(params)
    && /CLOSE_AFTER_PX = \d+/.test(params)
    && /if \(dy > CLOSE_AFTER_PX && onClose\)/.test(params));
ok('U159m жест не мешает нажатиям: кнопка «Сброс» и ползунки его не запускают',
  /closest\('button'\)\) return/.test(params));
ok('U159n панель параметров закрывается по этому жесту — onClose передан из чата',
  /onClose=\{\(\) => setParamsOpen\(false\)\}/.test(chatView));
ok('U159o панель параметров сжата по высоте: отступы, подписи и ползунки меньше',
  /\.params-popover\s*\{[\s\S]*?padding:\s*6px 14px 10px;/.test(bare)
    && /\.params-group\s*\{\s*padding:\s*8px 0;/.test(bare)
    && /\.params-row-head\s*\{[\s\S]*?margin-bottom:\s*5px;/.test(bare)
    && /\.params-slider\s*\{[\s\S]*?height:\s*5px;/.test(bare)
    && /\.params-hint\s*\{\s*margin-top:\s*5px;\s*font-size:\s*11\.5px;/.test(bare));
ok('U159p область захвата шире полоски и выключает прокрутку под пальцем',
  /\.params-grab\s*\{[\s\S]*?height:\s*22px;/.test(bare)
    && /\.params-grab\s*\{[\s\S]*?touch-action:\s*none;/.test(bare)
    && /\.params-popover\.is-dragging/.test(bare));

/* --- выпуск --- */
ok('U159q заметка о выпуске и история README содержат 0.159',
  /version: '0\.159'/.test(notes) && /^> \*\*0\.159\*\*/m.test(readme));

console.log('\n17 ✔, 0 ✖');
