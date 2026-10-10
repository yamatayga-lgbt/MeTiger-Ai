/** 0.145: обновление страницы смахиванием вниз — свой жест, без прокрутки оболочки. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync('src/hooks/usePullToRefresh.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U145a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U145b жест свой и дешёвый: passive-слушатели, порог и перезагрузка',
  /addEventListener\('touchstart', onStart, \{ passive: true \}\)/.test(hook)
    && /addEventListener\('touchmove', onMove, \{ passive: true \}\)/.test(hook)
    && /THRESHOLD = 70/.test(hook)
    && /window\.location\.reload\(\)/.test(hook));

ok('U145c жест вооружается только от верха: прокрученный предок под пальцем его отменяет',
  /if \(n\.scrollTop > 0\) return false/.test(hook)
    && /armed = (!viewportBusy\(\) && )?atTop\(e\.target\)/.test(hook));

ok('U145d жест только вертикальный: повело вбок или вверх — отменяется',
  /if \(dy < 0 \|\| Math\.abs\(dx\) > Math\.abs\(dy\)\)/.test(hook));

ok('U145e оболочка остаётся запертой: html/body — overflow hidden и overscroll-behavior none',
  /html \{[^}]*overflow: hidden/.test(stripCss(css))
    && /html \{[^}]*overscroll-behavior: none/.test(stripCss(css)));

ok('U145f индикатор подключён: кружок .ptr в App вне чтения, стили и состояния на месте',
  /className="ptr" ref=\{ptrRef\} aria-hidden="true"/.test(app)
    && /usePullToRefresh\(ptrRef\)/.test(app)
    && /\.ptr \{/.test(css) && /\.ptr\.is-ready \{/.test(css)
    && /\.ptr\.is-busy svg \{/.test(css)
    && /pointer-events: none/.test(stripCss(css).slice(stripCss(css).indexOf('.ptr {'))));

ok('U145g заметка о выпуске и история README содержат 0.145',
  /version: '0\.145'[\s\S]*?title: 'Смахни вниз — страница обновится'/.test(notes)
    && /^> \*\*0\.145\*\*/m.test(readme));

console.log('\n7 ✔, 0 ✖');
