/**
 * 0.160: сворачивание шторки больше не обновляет страницу.
 *
 * Слова владельца: «Когда я сворачиваю окно параметров, то и страница вместе
 * обновляется, я её задеваю». Причина: жест «потянул вниз — страница обновилась»
 * (0.145) слушает весь документ и не знал, что палец тянет шторку «Параметры»:
 * то же движение он считал своим и в конце перезагружал страницу.
 *
 * Что защищаем:
 *   • касание, начавшееся внутри всплывающего слоя, страничный жест не запускает;
 *   • у замка есть явный счётчик — им пользуется открытая шторка параметров;
 *   • панель параметров ставит замок при открытии и снимает при закрытии;
 *   • у самой панели докрутка до края гаснет внутри неё (overscroll-behavior).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/lib/pageGesture.ts', 'utf8');
const hook = readFileSync('src/hooks/usePullToRefresh.ts', 'utf8');
const params = readFileSync('src/components/ParamsPopover.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U160a все источники версии синхронизированы (version.ts, package.json, package-lock)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion
    && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U160b список слоёв, внутри которых страничный жест молчит, включает шторку параметров и её тень',
  /export const PAGE_GESTURE_OVERLAYS/.test(page)
    && /'\.params-popover'/.test(page)
    && /'\.model-backdrop'/.test(page)
    && /'\.model-panel'/.test(page)
    && /'\.palette'/.test(page)
    && /'\.workspace-drawer'/.test(page));
ok('U160c началось внутри слоя — значит это жест слоя, а не страницы',
  /export function touchedOverlay/.test(page)
    && /target\.closest\(PAGE_GESTURE_OVERLAYS\) !== null/.test(page));
ok('U160d у замка счётчик: вложенные блокировки не ломают друг друга',
  /let locks = 0/.test(page)
    && /locks \+= 1/.test(page)
    && /Math\.max\(0, locks - 1\)/.test(page)
    && /export function pageGestureLocked\(\): boolean \{\s*return locks > 0/.test(page));

ok('U160e жест обновления проверяет и слой, и замок ДО геометрии',
  /import \{ pageGestureLocked, touchedOverlay \} from '\.\.\/lib\/pageGesture'/.test(hook)
    && /const overlay = touchedOverlay\(e\.target\)/.test(hook)
    && /armed = !overlay && !pageGestureLocked\(\) && !viewportBusy\(\) && atTop\(e\.target\)/.test(hook));

ok('U160f открытая шторка параметров держит замок и снимает его при закрытии',
  /lockPageGesture\(\)/.test(params)
    && /return \(\) => unlockPageGesture\(\)/.test(params)
    && /useEffect\(\(\) => \{[\s\S]{0,160}lockPageGesture\(\)[\s\S]{0,80}unlockPageGesture\(\)[\s\S]{0,40}\}, \[\]\)/.test(params));

ok('U160g у панели параметров докрутка гаснет внутри неё, а не уезжает странице',
  /\.params-popover\s*\{[\s\S]*?overscroll-behavior:\s*contain;/.test(bare));

ok('U160h заметка о выпуске и история README содержат 0.160',
  /^> \*\*0\.160\*\*/m.test(readme));

console.log('\n8 ✔, 0 ✖');
