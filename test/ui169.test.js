/**
 * 0.169: картинки не сдаются на одном ключе и одном имени модели.
 *
 * Проверяем, что урок дымового теста закреплён в коде: источник картинок Gemini
 * смотрит на все ключи, а не на первый; odirouter умеет перебирать имена моделей;
 * причина отказа человеку — словами, а сырая — рядом в скобках. Плюс сам дымовой
 * тест остался в CI и продолжит ловить такие поломки.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const imggen = readFileSync('engine/imggen.js', 'utf8');
const smoke = readFileSync('scripts/smoke-prod.mjs', 'utf8');
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
ok('U169a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U169b «Что нового» и README знают про 0.169',
  /version: '0\.169'/.test(notes) && /\*\*0\.169\*\*/.test(readme));

ok('U169c gemini смотрит на все ключи, а не на первый',
  /const keys = String\(env\.GEMINI_KEYS \|\| env\.GOOGLE_API_KEY \|\| ''\)/.test(imggen)
    && /\.split\(','\)\.map\(\(k\) => k\.trim\(\)\)\.filter\(Boolean\)/.test(imggen)
    && !/const key = first\(env\.GEMINI_KEYS/.test(imggen));
ok('U169d рабочий ключ запоминается на изолят, чтобы не перебирать его каждый раз',
  /let gemKeyTurn = 0/.test(imggen) && /gemKeyTurn = idx/.test(imggen) && /\(gemKeyTurn \+ i\) % keys\.length/.test(imggen));
ok('U169e ответ текстом без картинки не жжёт оставшиеся ключи — причина одна и та же',
  /модель ответила текстом без картинки/.test(imggen) && /break;\n      }/.test(imggen));
ok('U169f у odirouter перебираются имена моделей, имя из окружения — первым',
  /ODI_GEN_CANDIDATES/.test(imggen) && /IMGGEN_ODI_MODEL/.test(imggen)
    && /odiGenTurn/.test(imggen) && /model_not_found\|not found\|unknown model\|404/.test(imggen));
ok('U169g лежащий шлюз не долбится пятью именами: настоящая ошибка канала — одна попытка',
  /if \(!\/model_not_found\|not found\|unknown model\|404\/i\.test\(lastWhy\)\) break;/.test(imggen));
ok('U169h причина для человека — словами, техническая — рядом в скобках',
  /export function humanWhy/.test(imggen) && /whyWithRaw/.test(imggen)
    && /у бесплатных источников кончился лимит/.test(imggen));
ok('U169i дымовой тест, поймавший это, остаётся в CI и продолжит ловить',
  /id: 'image'/.test(smoke) && /startsWith\('image\/'\)/.test(smoke));
ok('U169j тесты 0.169 в цепочке прогона',
  /node test\/imgkeys\.test\.js/.test(testChain) && /node test\/ui169\.test\.js/.test(testChain));

console.log('\n0.169: все проверки пройдены');
