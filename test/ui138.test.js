/** 0.138: удаление дела удаляет и его связанную переписку. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const casesView = readFileSync('src/views/CasesView.tsx', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const check = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const deleteChat = app.slice(app.indexOf('const deleteChat ='), app.indexOf('const deleteCase ='));
const deleteCase = app.slice(app.indexOf('const deleteCase ='), app.indexOf('/* Ответ агента.'));
const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
check('U138a APP_VERSION и package.json синхронизированы',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion) && pkg.version === currentVersion));
check('U138b удаление дела запускает удаление связанного чата без второго уведомления',
  /if \(item\.chatId\)\s*\{\s*deleteChat\(item\.chatId, false\)/.test(deleteCase)
    && /notify\('Дело и связанная переписка удалены'\)/.test(deleteCase));
check('U138c связанный чат удаляется из списка и очищает вложения/серверную память',
  /forgetThread\(id\)/.test(deleteChat)
    && /deleteMedia\(removed\.messages\.flatMap\(mediaIdsOfMessage\)\)/.test(deleteChat)
    && /prev\.filter\(\(c\) => c\.id !== id/.test(deleteChat));
check('U138d подтверждение предупреждает об удалении чата и вложений',
  /связанную переписку/.test(casesView)
    && /Переписку и вложения восстановить нельзя\./.test(casesView));
check('U138e заметка о выпуске и история README содержат 0.138',
  /version: '0\.138'[\s\S]*?title: 'Удаление дела очищает и связанную переписку'/.test(notes)
    && /^> \*\*0\.138\*\*/m.test(readme));

console.log('\n5 ✔, 0 ✖');
