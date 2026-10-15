/**
 * 0.157: приложение больше не падает от «протухшей выкладки».
 *
 * Что случилось у владельца: окно было открыто ДО выкладки; при первом заходе
 * на ленивый экран браузер попросил файл прежней версии, которого на сервере уже
 * нет, и человек получил экран «Приложение споткнулось» с текстом
 * «Failed to fetch dynamically imported module: …/WhatsNewView-….js».
 *
 * Это не поломка приложения, а отставание на одну версию: лечится перезагрузкой.
 * Что защищаем этим стражем:
 *   • ошибка про ненайденный файл распознаётся отдельно от прочих ошибок;
 *   • ленивые экраны ловят её и один раз перезагружают страницу сами;
 *   • карусель перезагрузок невозможна — стоит защёлка с кулдауном;
 *   • Vite-событие о неудачной догрузке гасится только когда мы уходим на
 *     перезагрузку, иначе ошибка обязана дойти до Guard и быть видимой;
 *   • на этом экране нет кнопки «Сбросить данные» — переписку терять не за что.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chunk = readFileSync('src/lib/chunkReload.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const guard = readFileSync('src/components/Guard.tsx', 'utf8');
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
ok('U157a все источники версии синхронизированы (version.ts, package.json, package-lock)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion
    && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U157b ошибка «файл прежней версии не найден» распознаётся по всем формулировкам браузеров',
  /export function isChunkLoadError/.test(chunk)
    && /failed to fetch dynamically imported module/.test(chunk)
    && /importing a module script failed/.test(chunk)
    && /loading chunk \\d\+ failed/.test(chunk)
    && /error loading dynamically imported module/.test(chunk));

ok('U157c на протухшей выкладке приложение само уходит на перезагрузку',
  /export function reloadForFreshChunks/.test(chunk)
    && /window\.location\.reload\(\)/.test(chunk));

ok('U157d карусель перезагрузок невозможна: защёлка в sessionStorage и кулдаун',
  /GUARD_KEY = 'mt-chunk-reload-at'/.test(chunk)
    && /COOLDOWN_MS = \d{5}/.test(chunk)
    && /sessionStorage\.getItem\(GUARD_KEY\)/.test(chunk)
    && /sessionStorage\.setItem\(GUARD_KEY/.test(chunk)
    && /Date\.now\(\) - last < COOLDOWN_MS\) return false/.test(chunk));

ok('U157e ленивые экраны идут через lazyView, а не через голый lazy',
  /* 0.159: экранов стало шесть — настройки переехали в профиль. */
  (app.match(/lazyView\(/g) || []).length >= 6
    && !/lazy\(\(\) => import\(/.test(app)
    && /export function lazyView/.test(chunk));

ok('U157f не дождавшись загрузки, экран ошибки не показываем — React ждёт «вечный» промис',
  /return new Promise<\{ default: T \}>\(\(\) => \{\}\)/.test(chunk)
    && /if \(isChunkLoadError\(err\) && reloadForFreshChunks\(\)\)/.test(chunk));

ok('U157g Vite-событие о неудачной догрузке ловится до React и гасится только при перезагрузке',
  /addEventListener\('vite:preloadError'/.test(main)
    && /isChunkLoadError\(payload\) && reloadForFreshChunks\(\)\) event\.preventDefault\(\)/.test(main));

ok('U157h экран ошибки для протухшей версии говорит правду и даёт одну правильную кнопку',
  /isChunkLoadError\(this\.state\.error\)/.test(guard)
    && /'Есть свежая версия'/.test(guard)
    && /'Обновить и перезагрузить'/.test(guard)
    && /void forceAppUpdate\(\)/.test(guard));
ok('U157i на протухшей версии кнопки «Сбросить данные» нет — переписку терять не за что',
  /stale \? null : \(/.test(guard)
    && (guard.match(/stale \? null : \(/g) || []).length >= 2);

ok('U157j заметка о выпуске и история README содержат 0.157',
  /^> \*\*0\.157\*\*/m.test(readme));

console.log('\n10 ✔, 0 ✖');
