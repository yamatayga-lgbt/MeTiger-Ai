/**
 * 0.167: дымовой тест прода (план обгона, волна 1 закрыта).
 *
 * Проверяем не «файл существует», а что сторож делает то, ради чего заведён:
 * три настоящих хода (текст, картинка, файл), проверка вложения, браузерные
 * заголовки (иначе Cloudflare ответит 403 и сторож будет врать «прод упал»),
 * и что провал не остаётся незамеченным — красный прогон плюс задача.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const smoke = readFileSync('scripts/smoke-prod.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/smoke-prod.yml', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const vmd = readFileSync('VERSION.md', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const testChain = String(pkg.scripts.test || '');

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''));
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U167a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && vmd.indexOf('# Version ' + currentVersion) >= 0),
  [currentVersion, pkg.version]);
ok('U167b «Что нового» и README знают про 0.167',
  /version: '0\.167'/.test(notes) && /\*\*0\.167\*\*/.test(readme));

ok('U167c три хода на месте: текст, картинка, файл',
  /id: 'text'/.test(smoke) && /id: 'image'/.test(smoke) && /id: 'file'/.test(smoke)
    && /Нарисуй картинку/.test(smoke) && /shopping\.txt/.test(smoke));
ok('U167d браузерные заголовки обязательны — иначе Cloudflare ответит 403 и сторож соврёт',
  /origin: URL_BASE/.test(smoke) && /'user-agent': UA/.test(smoke) && /referer: URL_BASE/.test(smoke));
ok('U167e проверяется вложение, а не только текст: картинка — по mime, файл — по наличию',
  /startsWith\('image\/'\)/.test(smoke) && /!files\.length/.test(smoke));
ok('U167f пустой ответ — это провал, а не «ок, молчит»',
  /if \(!reply\)/.test(smoke) && /process\.exit\(bad \? 1 : 0\)/.test(smoke));
ok('U167g провал виден: красный прогон и задача на телефон',
  /node scripts\/smoke-prod\.mjs/.test(workflow) && /if: failure\(\)/.test(workflow)
    && /gh issue create/.test(workflow) && /Прод не отвечает/.test(workflow));
ok('U167h сторож идёт после выкладки и раз в сутки, но не на круглом часе',
  /workflow_run:/.test(workflow) && /workflows: \[Deploy\]/.test(workflow)
    && /cron: '41 5 \* \* \*'/.test(workflow));
ok('U167i после выкладки сторож не бежит, если сама выкладка провалилась',
  /github\.event\.workflow_run\.conclusion == 'success'/.test(workflow));
ok('U167j тест 0.167 в цепочке прогона', /node test\/ui167\.test\.js/.test(testChain));

console.log('\n0.167: все проверки пройдены');
