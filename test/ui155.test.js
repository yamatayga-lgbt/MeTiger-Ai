/**
 * 0.155: оболочка «как в приложении ChatGPT» по четырём скриншотам владельца.
 *
 * Что защищаем (это требования, а не детали реализации):
 *   • экран профиля с пунктами ровно как на скрине, вычеркнутое красным — не сделано;
 *   • в настройки один вход — через профиль (в сайдбаре пункта нет);
 *   • нерабочее помечено «Скоро» и не притворяется живым;
 *   • список настроек — только то, что осталось после вычеркиваний;
 *   • «Внешний вид» переключает тему по-настоящему;
 *   • новые экраны живут в маршрутах, в персисте и в палитре команд.
 *
 * Место кнопки «Чат» и отсутствие второй иконки профиля — предмет правки 0.156,
 * их стережёт test/ui156.test.js (в 0.155 кнопка стояла в полосе под полем ввода,
 * и владелец это отменил).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
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

/* --- профиль: пункты ровно как на скрине, без вычеркнутого --- */
ok('U155b профиль повторяет скриншот: «Мой MeTiger» и «Учетная запись» с нужными строками',
  /Мой MeTiger/.test(profile)
    && /Учетная запись/.test(profile)
    && ['Персонализация', 'Память', 'Рабочая область', 'Личное', 'Использование и лимиты', 'Электронная почта'].every((t) => profile.includes(t)));
ok('U155c вычеркнутое красным в профиль не попало',
  !/Плагин/.test(profileCode) && !/Изменить план/.test(profileCode)
    && !/Родительский контроль/.test(profileCode) && !/Возраст/.test(profileCode));
ok('U155d нерабочие строки профиля помечены «Скоро» и не нажимаются',
  /is-soon/.test(profile)
    && /<Badge tone="gray">Скоро<\/Badge>/.test(profile)
    && /Память/.test(profile) && /onClick=\{soon\('Память'\)\}/.test(profile)
    && /Электронная почта/.test(profile)
    /* Почту не выдумываем: у нас её нет и не должно быть в коде — показываем
       честное «не указана», а не чужой адрес со скриншота. */
    && !/yamatayga@gmail\.com/.test(profile)
    && /value="не указана"/.test(profile));

/* --- вход в настройки один: через профиль --- */
ok('U155e в сайдбаре пункта «Настройки» больше нет — вход только через профиль',
  !/id: 'settings'/.test(sidebarCode)
    && /onNavigate\('profile'\)/.test(sidebarCode));
ok('U155f профиль — новая вкладка со своим экраном и вернуться из него можно назад',
  /'profile'/.test(app)
    && /const ProfileView = lazy/.test(app)
    && /BACK_TO: Partial<Record<ViewId, ViewId>>/.test(app)
    && /profile: 'chat'/.test(app)
    && /onBack: \(\) => navigate/.test(app));

/* --- список настроек: только оставленное, в порядке скрина --- */
ok('U155g в настройках осталось ровно рабочее, в порядке скрина',
  (() => {
    /* 0.156: «Голос», «Безопасность и вход», «Хранилище» и «Акцентный цвет»
       владелец убрал — это были заглушки. Оставшееся проверяем по порядку. */
    const want = ['Внешний вид', 'Управление данными', 'Сообщить об ошибке', 'Информация'];
    let at = -1;
    return want.every((t) => {
      const i = settingsCode.indexOf(t);
      if (i < 0 || i < at) return false;
      at = i;
      return true;
    });
  })());
ok('U155h вычеркнутое красным (и снятое владельцем в 0.156) в настройки не попало',
  !/Общие/.test(settingsCode)
    && !/Уведомления/.test(settingsCode)
    && !/Безопасность и благополучие/.test(settingsCode)
    && !/Удаленное управление/.test(settingsCode)
    && !/Центр конфиденциальности/.test(settingsCode)
    && !/Управление рекламой/.test(settingsCode)
    && !/Акцентный цвет/.test(settingsCode)
    && !/Хранилище/.test(settingsCode)
    && !/Безопасность и вход/.test(settingsCode));
ok('U155i «Внешний вид» раскрывается и переключает тему (живой пункт, не заглушка)',
  /appearanceOpen/.test(settings)
    && /variant="icon"/.test(settings)
    && /onThemePref/.test(settings));
ok('U155j «Управление данными» и «Информация» — рабочие экраны, а не «Скоро»',
  /rows-name">Управление данными/.test(settings)
    && /rows-name">Информация/.test(settings)
    && /onNavigate\('data'\)/.test(settings)
    && /onNavigate\('info'\)/.test(settings));

/* --- новые экраны: маршруты, сохранение, палитра --- */
ok('U155k новые экраны есть в маршрутах и переживают перезагрузку',
  ['profile', 'personalization', 'data', 'info'].every((v) => app.includes(`'${v}'`) && persist.includes(`v === '${v}'`)));
ok('U155l палитра команд знает про новые экраны и стрелку «назад»',
  ['go-profile', 'go-personalization', 'go-data', 'go-info'].every((id) => readFileSync('src/components/CommandPalette.tsx', 'utf8').includes(id))
    && /icon=\{ArrowLeft\}/.test(readFileSync('src/components/Topbar.tsx', 'utf8'))
    && /onBack/.test(readFileSync('src/components/Topbar.tsx', 'utf8')));
ok('U155m плоские списки строк на месте — профиль и настройки не «въезжают» анимацией',
  /\.rows-row\s*\{/.test(bare) && /\.rows-ic\s*\{/.test(bare) && /NO_ANIM_VIEWS/.test(app));

/* --- выпуск --- */
ok('U155n заметка о выпуске и история README содержат 0.155',
  /version: '0\.155'/.test(notes) && /^> \*\*0\.155\*\*/m.test(readme));

console.log('\n14 ✔, 0 ✖');
