/**
 * 0.155: оболочка «как в приложении ChatGPT» по четырём скриншотам владельца.
 *
 * Что защищаем (это требования, а не детали реализации):
 *   • кнопка нового чата — СНИЗУ, слева, синей капсулой «Чат»;
 *   • справа в той же панели — круглая аватарка, она открывает профиль;
 *   • в настройки теперь один вход — через профиль (в сайдбаре пункта нет);
 *   • вычеркнутое красным (Плагины, Изменить план, Родительский контроль,
 *     Возраст, Общие, Уведомления, Безопасность и благополучие, Удаленное
 *     управление, Центр конфиденциальности, Управление рекламой) не сделано;
 *   • нерабочее помечено «Скоро» и не притворяется живым;
 *   • «Внешний вид» и «Акцентный цвет» — на месте, акцентный цвет синий;
 *   • порядок пунктов — как на скринах.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const bar = readFileSync('src/components/BottomBar.tsx', 'utf8');
const profile = readFileSync('src/views/ProfileView.tsx', 'utf8');
const settings = readFileSync('src/views/SettingsView.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const persist = readFileSync('src/lib/persist.ts', 'utf8');

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
/* Комментарии в исходниках объясняют, ЧЕГО мы не делаем, и называют это словами
   («Плагины», «Возраст») — поэтому проверки «этого нет в коде» смотрят на код
   без комментариев, иначе тест ловил бы сам себя. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const profileCode = code(profile);
const settingsCode = code(settings);
const sidebarCode = code(sidebar);
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U155a APP_VERSION и package.json синхронизированы',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion) && pkg.version === currentVersion));

/* --- нижняя панель: новый чат слева синей капсулой, профиль — справа --- */
ok('U155b кнопка нового чата живёт в нижней панели и подписана «Чат»',
  /className="bottombar"/.test(bar)
    && /className="bottombar-chat"/.test(bar)
    && /Чат/.test(bar)
    && !/className="new-chat-btn"/.test(bar));
ok('U155c капсула «Чат» залита синим брендом, а не акцентом темы (--accent монохромный)',
  /\.bottombar-chat\s*\{[\s\S]*?background:\s*var\(--brand\);/.test(bare)
    && /--brand:\s*#2563eb;/.test(bare)
    && /--brand:\s*#3b82f6;/.test(bare)
    && /border-radius:\s*var\(--r-full\);/.test(bare));
ok('U155d справа в панели — круглая аватарка, она открывает профиль',
  /className=\{`bottombar-avatar/.test(bar)
    && /initials\(user\)/.test(bar)
    && /onProfile/.test(bar)
    && /\.bottombar-avatar\s*\{[\s\S]*?border-radius:\s*50%;/.test(bare));
ok('U155e панель стоит в колонке приложения, а не поверх содержимого',
  /<BottomBar/.test(app)
    && /onNewChat=\{newChat\}/.test(app)
    && /onProfile=\{\(\) => navigate\('profile'\)\}/.test(app)
    && /\.bottombar\s*\{[\s\S]*?flex:\s*none;/.test(bare)
    && !/\.bottombar\s*\{[^}]*position:\s*fixed/.test(bare));

/* --- настройки: один вход, через профиль --- */
ok('U155f в сайдбаре пункта «Настройки» больше нет — вход только через профиль',
  !/id: 'settings'/.test(sidebarCode)
    && /onNavigate\('profile'\)/.test(sidebarCode));
ok('U155g профиль — новая вкладка со своим экраном и вернуться из него можно назад',
  /'profile'/.test(app)
    && /const ProfileView = lazy/.test(app)
    && /BACK_TO: Partial<Record<ViewId, ViewId>>/.test(app)
    && /profile: 'chat'/.test(app)
    && /onBack: \(\) => navigate/.test(app));

/* --- профиль: пункты ровно как на скрине, без вычеркнутого --- */
ok('U155h профиль повторяет скриншот: «Мой MeTiger» и «Учетная запись» с нужными строками',
  /Мой MeTiger/.test(profile)
    && /Учетная запись/.test(profile)
    && ['Персонализация', 'Память', 'Рабочая область', 'Личное', 'Использование и лимиты', 'Электронная почта'].every((t) => profile.includes(t)));
ok('U155i вычеркнутое красным в профиль не попало',
  !/Плагин/.test(profileCode) && !/Изменить план/.test(profileCode)
    && !/Родительский контроль/.test(profileCode) && !/Возраст/.test(profileCode));
ok('U155j нерабочие строки профиля помечены «Скоро» и не нажимаются',
  /is-soon/.test(profile)
    && /<Badge tone="gray">Скоро<\/Badge>/.test(profile)
    && /Память/.test(profile) && /onClick=\{soon\('Память'\)\}/.test(profile)
    && /Электронная почта/.test(profile)
    /* Почту не выдумываем: у нас её нет и не должно быть в коде — показываем
       честное «не указана», а не чужой адрес со скриншота. */
    && !/yamatayga@gmail\.com/.test(profile)
    && /value="не указана"/.test(profile));

/* --- список настроек: только оставленное, в порядке скрина --- */
ok('U155k порядок и состав списка настроек — как на скрине 131940',
  (() => {
    const want = [
      'Внешний вид',
      'Акцентный цвет',
      'Голос',
      'Безопасность и вход',
      'Хранилище',
      'Управление данными',
      'Сообщить об ошибке',
      'Информация',
    ];
    let at = -1;
    return want.every((t) => {
      const i = settingsCode.indexOf(t);
      if (i < 0 || i < at) return false;
      at = i;
      return true;
    });
  })());
ok('U155l вычеркнутое красным в настройки не попало',
  !/Общие/.test(settingsCode)
    && !/Уведомления/.test(settingsCode)
    && !/Безопасность и благополучие/.test(settingsCode)
    && !/Удаленное управление/.test(settingsCode)
    && !/Центр конфиденциальности/.test(settingsCode)
    && !/Управление рекламой/.test(settingsCode));
ok('U155m «Акцентный цвет — Синий» показан точкой цвета и помечен «Скоро»',
  /Акцентный цвет/.test(settings) && /Синий/.test(settings)
    && /rows-dot/.test(settings)
    && /\.rows-dot\s*\{[\s\S]*?background:\s*var\(--brand\);/.test(bare));
ok('U155n «Внешний вид» раскрывается и переключает тему (живой пункт, не заглушка)',
  /appearanceOpen/.test(settings)
    && /variant="icon"/.test(settings)
    && /onThemePref/.test(settings));
ok('U155o «Управление данными» и «Информация» — рабочие экраны, а не «Скоро»',
  !/is-soon[\s\S]{0,400}?Управление данными/.test(settings)
    && /rows-name">Управление данными/.test(settings)
    && /rows-name">Информация/.test(settings)
    && /onNavigate\('data'\)/.test(settings)
    && /onNavigate\('info'\)/.test(settings));

/* --- новые экраны: маршруты, сохранение, прокрутка --- */
ok('U155p новые экраны есть в маршрутах и переживают перезагрузку',
  ['profile', 'personalization', 'data', 'info'].every((v) => app.includes(`'${v}'`) && persist.includes(`v === '${v}'`)));
ok('U155q палитра команд знает про новые экраны',
  ['go-profile', 'go-personalization', 'go-data', 'go-info'].every((id) => readFileSync('src/components/CommandPalette.tsx', 'utf8').includes(id)));
ok('U155r верхняя панель на вложенных экранах показывает стрелку «назад»',
  /onBack/.test(readFileSync('src/components/Topbar.tsx', 'utf8'))
    && /icon=\{ArrowLeft\}/.test(readFileSync('src/components/Topbar.tsx', 'utf8')));

/* --- выпуск --- */
ok('U155s заметка о выпуске и история README содержат 0.155',
  /version: '0\.155'/.test(notes) && /^> \*\*0\.155\*\*/m.test(readme));

console.log('\n19 ✔, 0 ✖');
