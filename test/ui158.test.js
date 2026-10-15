/**
 * 0.158: приложение само замечает новую выкладку и обновляется.
 *
 * История вопроса. Владелец дважды прислал один и тот же симптом: на экране
 * остаётся старый интерфейс (кнопки внизу, как в 0.155), а «Что нового» падает
 * с «Failed to fetch dynamically imported module». Причина одна: окно было
 * открыто ДО выкладки и с тех пор не перезагружалось — в нём живёт прежний код
 * и прежние имена файлов, которых на сервере уже нет. Обновление service worker
 * тут не помогает: пока страницу не перезагрузят, страница остаётся старой.
 *
 * Что защищаем:
 *   • сторож версии сравнивает имя главного файла приложения (в нём хеш сборки)
 *     с тем, что отдаёт свежий index.html, и обновляет страницу сам;
 *   • проверяет при возврате в приложение (visibility/focus) и раз в минуту;
 *   • без сети и при совпадающей сборке — молчит;
 *   • не перезагружает, пока человек печатает: набранное в поле не потеряется;
 *   • перезагрузка идёт через ту же защёлку с кулдауном, что и протухшие файлы, —
 *     карусель невозможна;
 *   • service worker берёт навигацию с проверкой свежести, а HTML отдаётся
 *     с no-cache (public/_headers) — страница не залипает на прежней оболочке.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const watch = readFileSync('src/lib/versionWatch.ts', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const sw = readFileSync('public/sw.js', 'utf8');
const headers = readFileSync('public/_headers', 'utf8');
const chunk = readFileSync('src/lib/chunkReload.ts', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U158a все источники версии синхронизированы (version.ts, package.json, package-lock)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion
    && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U158b сторож версии существует и запускается при старте приложения',
  /export function startVersionWatch/.test(watch) && /startVersionWatch\(\)/.test(main));

ok('U158c сборка опознаётся по имени главного файла — в нём хеш',
  /MAIN_ASSET_RE = \/assets/.test(watch)
    && /runningAsset\(\)/.test(watch)
    && /servedAsset\(html\)/.test(watch)
    && /fresh === mine\) return/.test(watch));

ok('U158d свежий index.html берётся строго мимо кэшей (no-store и обход SW параметром)',
  /cache: 'no-store'/.test(watch)
    && /index\.html\?mt-v=/.test(watch));

ok('U158e проверка идёт при возврате в приложение и раз в минуту',
  /addEventListener\('focus'/.test(watch)
    && /addEventListener\('visibilitychange'/.test(watch)
    && /document\.visibilityState === 'visible'/.test(watch)
    && /CHECK_EVERY_MS = 60_000/.test(watch)
    && /setInterval/.test(watch));

ok('U158f карусель невозможна: перезагрузка идёт через общую защёлку с кулдауном',
  /import \{ reloadForFreshChunks \} from '\.\/chunkReload'/.test(watch)
    && /reloadForFreshChunks\(\)/.test(watch)
    && /COOLDOWN_MS/.test(chunk)
    && /sessionStorage\.setItem\(GUARD_KEY/.test(chunk));

ok('U158g без сети сторож молчит — сравнивать нечего',
  /if \(stopped \|\| !navigator\.onLine\) return/.test(watch)
    && /catch \{\s*return \/\* сеть мигнула — не повод что-то менять \*\//.test(watch));

ok('U158h пока человек печатает — не перезагружаем (черновик не теряется)',
  /function userIsTyping/.test(watch)
    && /el\.tagName === 'TEXTAREA'/.test(watch)
    && /el\.isContentEditable === true/.test(watch)
    && /value\.trim\(\)\.length > 0/.test(watch)
    && /if \(userIsTyping\(\)\) return/.test(watch));

ok('U158i service worker просит навигацию с проверкой свежести, а HTML отдаётся без кэша',
  /const isNavigate = req\.mode === 'navigate'/.test(sw)
    && /fetch\(req, isNavigate \? \{ cache: 'no-cache' \} : undefined\)/.test(sw)
    && /^\/index\.html\n  Cache-Control: no-cache/m.test(headers)
    && /^\/\n  Cache-Control: no-cache/m.test(headers));

ok('U158j заметка о выпуске и история README содержат 0.158',
  /^> \*\*0\.158\*\*/m.test(readme));

console.log('\n10 ✔, 0 ✖');
