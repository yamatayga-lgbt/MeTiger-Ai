/**
 * 0.165: честные даты и ссылки (продолжение темы свежести).
 *
 * Повод конкретный: на живом проде ответ про курс валют содержал «данные на
 * 18 июля 2026» и ссылку на ЦБ — ни того, ни другого в данных инструмента не было.
 * Проверяем, что источник с датой теперь приходит от самих инструментов и что
 * модели сказано не выдумывать.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const tools = readFileSync('engine/tools.js', 'utf8');
const chat = readFileSync('engine/chat.js', 'utf8');
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
ok('U165a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U165b «Что нового» и README знают про 0.165',
  /\*\*0\.165\*\*/.test(readme));

ok('U165c курсы дают источнику дату обновления из самих данных',
  /time_last_update_unix/.test(tools) && /open\.er-api\.com\/v6\/latest\/\$\{base\}/.test(tools));
ok('U165d погода даёт источнику время наблюдения из самих данных',
  /current\.time|String\(c\.time/.test(tools) && /open-meteo\.com/.test(tools));
ok('U165e API-инструменты дают источник, но не притворяются поиском',
  /const API_SOURCE_TOOLS = new Set\(\['currency', 'weather'\]\)/.test(tools)
    && /SOURCE_TOOLS\.has\(t\.id\) \|\| API_SOURCE_TOOLS\.has\(t\.id\)/.test(tools)
    && /if \(SOURCE_TOOLS\.has\(t\.id\)\) \{/.test(tools));
ok('U165f модели прямо сказано: даты, время и адреса — только из данных',
  /Даты, время и адреса бери только из данных/.test(chat) && /выдуманн/.test(chat));
ok('U165g данные инструментов не потерялись в блоке для модели',
  /\(t\.kind === 'directive' \? directives : parts\)\.push/.test(tools));
ok('U165h тест 0.165 в цепочке прогона', /node test\/ui165\.test\.js/.test(testChain));

console.log('\n0.165: все проверки пройдены');
