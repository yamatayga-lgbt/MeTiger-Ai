/** 0.148: оболочка шьётся к 100% от html, а не к 100dvh — dvh на нескроллящейся
 * странице Android Chrome не пересчитывается, и низ интерфейса прятался за кромкой. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const bare = stripCss(css);

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U148a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U148b в CSS не осталось ни одного dvh — на нескроллящейся странице Chrome его не пересчитывает',
  !/dvh/.test(bare));

ok('U148c оболочка — height: 100% от html: .app и .main без вьюпортных единиц высоты',
  /\.app \{[^}]*height: 100%/.test(bare) && !/\.app \{[^}]*100(l|s|d)?vh/.test(bare)
    && /\.main \{[^}]*height: 100%/.test(bare));

ok('U148d цепочка процентов целая: html и body держат height: 100%',
  /html \{[^}]*height: 100%/.test(bare) && /body \{[^}]*height: 100%/.test(bare));

ok('U148e заметка о выпуске и история README содержат 0.148',
  /version: '0\.148'[\s\S]*?title: 'Поле ввода всегда на экране'/.test(notes)
    && /^> \*\*0\.148\*\*/m.test(readme));

console.log('\n5 ✔, 0 ✖');
