/** 0.146: клавиатура сжимает страницу, а жест обновления молчит при клавиатуре и зуме. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const hook = readFileSync('src/hooks/usePullToRefresh.ts', 'utf8');
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
ok('U146a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U146b клавиатура сжимает страницу, а не панорамирует её: interactive-widget=resizes-content в meta viewport',
  /<meta name="viewport" content="[^"]*interactive-widget=resizes-content[^"]*"/.test(html));

ok('U146c жест обновления молчит при открытой клавиатуре, смещённом кадре и щипковом зуме',
  /const viewportBusy = \(\): boolean =>/.test(hook)
    && /vv\.scale > 1\.02/.test(hook)
    && /vv\.offsetTop > 1 \|\| window\.innerHeight - vv\.height > 1/.test(hook)
    && /armed = !viewportBusy\(\) && atTop\(e\.target\)/.test(hook));

ok('U146d заметка о выпуске и история README содержат 0.146',
  /version: '0\.146'[\s\S]*?title: 'Поле ввода не уезжает при смахивании'/.test(notes)
    && /^> \*\*0\.146\*\*/m.test(readme));

console.log('\n4 ✔, 0 ✖');
