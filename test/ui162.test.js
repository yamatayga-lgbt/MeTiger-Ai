/**
 * 0.162: копия данных одним файлом (волна «обогнать DeepSeek», пункт 2).
 *
 * Что защищаем:
 *   • копия собирает переписку, настройки, байты вложений и историю вложений — и
 *     НЕ трогает чужие ключи браузера;
 *   • чужой файл, мусор и пустая копия отвергаются ДО записи в хранилище;
 *   • замена идёт в правильном порядке (сначала переписка, потом байты) и только
 *     после второго нажатия;
 *   • на экране «Управление данными» есть обе кнопки, выбор файла и предпросмотр
 *     того, что именно заменит данные.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backup = readFileSync('src/lib/backup.ts', 'utf8');
const dataView = readFileSync('src/views/DataView.tsx', 'utf8');
const media = readFileSync('src/lib/chatMedia.ts', 'utf8');
const hist = readFileSync('src/lib/attachHistory.ts', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const vmd = readFileSync('VERSION.md', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const testChain = String(pkg.scripts.test || '');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U162a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && new RegExp('# Version ' + String(currentVersion).replace('.', '\\.')).test(vmd)),
  [currentVersion, pkg.version].join('/'));
ok('U162b «Что нового» и README знают про 0.162',
  /version: '0\.162'/.test(notes) && /title: 'Переписка переезжает на новый телефон одним файлом'/.test(notes) && /\*\*0\.162\*\*/.test(readme));

ok('U162c копия собирает только ключи приложения (префикс mt-), список не зашит',
  /export const LOCAL_PREFIX = 'mt-'/.test(backup) && /k\.indexOf\(LOCAL_PREFIX\) !== 0\) continue/.test(backup));
ok('U162d в копию входят байты вложений и история вложений, а не только текст',
  /dumpMedia\(\)/.test(backup) && /dumpHistory\(\)/.test(backup) && /media: BackupMedia\[\]/.test(backup));
ok('U162e чужой файл и мусор отвергаются до всякой записи',
  /d\.app !== BACKUP_APP/.test(backup) && /в копии чужие данные — не буду их подставлять/.test(backup)
    && /в копии нет данных: файл пустой или обрезан/.test(backup) && /это не файл копии: внутри не читается ни строчки/.test(backup));
ok('U162f порядок замены: сначала переписка и настройки, потом байты (текст важнее картинок)',
  /const local = applyLocal\(localStorage as unknown as StorageLike, b\.local\)[\s\S]{0,220}await restoreMedia\(b\.media\)/.test(backup));
ok('U162g восстановление байтов снимает запрет «уже пробовали записать»',
  /tried\.clear\(\)/.test(media) && /export async function restoreMedia/.test(media) && /export async function dumpMedia/.test(media));
ok('U162h история вложений: дамп и заливка целиком, с честным числом',
  /export async function dumpHistory/.test(hist) && /export async function restoreHistory/.test(hist) && /store\.clear\(\)/.test(hist));

ok('U162i на экране данных есть обе кнопки — сохранить и загрузить',
  /Сохранить копию в файл/.test(dataView) && /Загрузить из файла/.test(dataView)
    && /type="file"/.test(dataView) && /accept="application\/json,\.json"/.test(dataView));
ok('U162j замена данных — только после второго нажатия, с предпросмотром файла',
  /copyArm \? 'primary' : 'secondary'/.test(dataView) && /Точно заменить\? Нажмите ещё раз/.test(dataView)
    && /Файл прочитан:/.test(dataView) && /describeBackup\(copy\)\.when/.test(dataView));
ok('U162k человеку говорят, что ключ устройства переезжает (память на сервере найдётся сама)',
  /ключ устройства/i.test(notes) || /Ключ устройства тоже переезжает/.test(notes));
ok('U162l новый экран подписан стилем (карточка предпросмотра не голая)',
  /\.restore-box/.test(css) && /className="restore-box"/.test(dataView));
ok('U162m новые тесты в цепочке прогона (backup, ui162)',
  /node test\/backup\.test\.js/.test(testChain) && /node test\/ui162\.test\.js/.test(testChain));

console.log('\n0.162: все проверки пройдены');
