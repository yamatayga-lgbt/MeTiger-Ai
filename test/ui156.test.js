/**
 * 0.156: правка владельца к 0.155 — где живёт кнопка «Чат» и что стало с настройками.
 *
 * Слова владельца с двумя скриншотами: «Почему кнопки внизу под окном ввода? Они
 * должны быть над профилем. Второй профиль иконки и нажатие не надо делать.
 * Пункты: Голос, Акцентный цвет, Безопасность и Вход, Хранилище убери».
 *
 * Что защищаем:
 *   • кнопка «Чат» — в меню, НАД строкой профиля, синей капсулой;
 *   • полосы под полем ввода больше нет — там кнопке не место;
 *   • вторая иконка профиля и её нажатие убраны: вход в профиль один — строка в меню;
 *   • верхней кнопки «Новый чат» в меню нет: две кнопки одного действия в одном
 *     меню — это и был лишний дубль;
 *   • в настройках не осталось четырёх убранных пунктов.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
/* 0.159: настройки переехали в профиль — проверяем там же. */
const settings = readFileSync('src/views/ProfileView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sidebarCode = code(sidebar);
const settingsCode = code(settings);

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U156a все источники версии синхронизированы (version.ts, package.json, package-lock)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion
    && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

/* --- кнопка «Чат»: в меню, над профилем --- */
ok('U156b кнопка «Чат» стоит в меню и подписана «Чат»',
  /className="side-newchat"/.test(sidebarCode)
    && /Чат/.test(sidebarCode)
    && /onNewChat/.test(sidebarCode));
ok('U156c она НАД строкой профиля — сразу перед .side-foot-row, а не где-то ещё',
  (() => {
    const b = sidebarCode.indexOf('side-newchat');
    const f = sidebarCode.indexOf('side-foot-row');
    return b > 0 && f > 0 && b < f;
  })());
ok('U156d капсула синяя (--brand) и круглой формы — как на скриншоте владельца',
  /\.side-newchat\s*\{[\s\S]*?background:\s*var\(--brand\);/.test(bare)
    && /\.side-newchat\s*\{[\s\S]*?border-radius:\s*var\(--r-full\);/.test(bare)
    && /--brand:\s*#2563eb;/.test(bare)
    && /--brand:\s*#3b82f6;/.test(bare));

/* --- полосы под полем ввода больше нет --- */
ok('U156e нижней панели под полем ввода нет ни в разметке, ни в стилях',
  !/BottomBar/.test(app)
    && !/bottombar/.test(bare)
    && !existsSync('src/components/BottomBar.tsx'));
ok('U156f вторая иконка профиля и её нажатие убраны — вход в профиль один',
  !/bottombar-avatar/.test(bare)
    && !/profileActive/.test(app)
    /* Единственный вход — строка профиля в меню (user-row → профиль). */
    && /className="user-row"[^>]*onClick=\{\(\) => onNavigate\('profile'\)\}/.test(sidebarCode));
ok('U156g верхняя кнопка «Новый чат» в меню убрана — действие одно и в одном месте',
  !/new-chat-btn/.test(sidebarCode) && !/\.new-chat-btn\s*\{/.test(bare));

/* --- настройки: четыре пункта убраны --- */
ok('U156h «Голос», «Акцентный цвет», «Безопасность и вход», «Хранилище» убраны из кода',
  !/Голос/.test(settingsCode)
    && !/Акцентный цвет/.test(settingsCode)
    && !/Безопасность и вход/.test(settingsCode)
    && !/Хранилище/.test(settingsCode));
ok('U156i в настройках (в профиле) осталось рабочее: Внешний вид, Управление данными, Сообщить об ошибке, Информация',
  ['Внешний вид', 'Управление данными', 'Сообщить об ошибке', 'Информация'].every((t) => settingsCode.includes(t)));

/* --- выпуск --- */
ok('U156j заметка о выпуске и история README содержат 0.156',
  /version: '0\.156'/.test(notes) && /^> \*\*0\.156\*\*/m.test(readme));

console.log('\n11 ✔, 0 ✖');
