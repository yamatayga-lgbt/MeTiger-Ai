/** 0.137: экран настроек не мерцает при внутренней прокрутке. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const view = readFileSync('src/views/SettingsView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
/* 0.144: жидкое стекло удалено — hooks/useLiquidGlass.ts больше не существует.
   Прежняя проверка U137e (карточка настроек вне списка панелей блика) выродилась
   в более сильную: блика нет ни у кого. */
const glassGone = !existsSync('src/hooks/useLiquidGlass.ts');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U137a APP_VERSION и package.json синхронизированы',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion) && pkg.version === currentVersion));
ok('U137b экран настроек помечен отдельным классом',
  /className="container view settings-view"/.test(view));
ok('U137c прокрутка настроек не запускает smooth-анимацию',
  /className=\{`content\$\{view === 'settings' \? ' settings-scroll' : ''\}`\}/.test(app)
    && /\.settings-scroll\s*\{\s*scroll-behavior:\s*auto;/.test(css));
ok('U137d крупные блоки настроек не анимируются и остаются видимыми',
  /\.settings-view,\s*\.settings-view \.page-head,\s*\.settings-view \.settings-group,\s*\.settings-view \.profile-card\s*\{\s*animation:\s*none !important;\s*opacity:\s*1;\s*transform:\s*none;/.test(css));
ok('U137e касание карточки настроек не запускает перерисовку блика (0.144: блик удалён вместе со стеклом)',
  glassGone && !/useLiquidGlass/.test(app));
ok('U137f заметка о выпуске и история README содержат 0.137',
  /version: '0\.137'[\s\S]*?title: 'Настройки прокручиваются без мерцания'/.test(notes)
    && /^> \*\*0\.137\*\*/m.test(readme));

console.log('\n6 ✔, 0 ✖');
