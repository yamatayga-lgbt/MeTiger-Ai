/**
 * 0.154: полосы прокрутки убраны, настройки снова прокручиваются.
 *
 * Владелец прислал скриншот с телефона: серый столбик у правого края, серый
 * ползунок под полем ввода, а экран настроек вообще не листается. Причины были
 * три, и все три — из чужой правки 77297bb («Fix critical bugs»):
 *
 *   1) глобальные правила `::-webkit-scrollbar` (без media) заставляли Chrome на
 *      телефоне рисовать СВОЮ полосу вместо системной накладной — та не исчезает
 *      сама, в отличие от системной;
 *   2) `.chat-shell { overflow-y: auto }` из блока «iOS Fixes» давал чату ВТОРОЙ
 *      скролл внутри первого — оттуда и вертикальная, и горизонтальная полосы;
 *      `body { overflow-y: auto }` в том же блоке возвращал прокрутку корню,
 *      которую 0.143 специально запирал против «оболочка едет за пальцем»;
 *   3) у сетки `.app` неявная строка была `auto`, поэтому на длинном экране
 *      `.main` вырастал до 1642px при экране 851 — `.content` получал ту же
 *      высоту, прокручивать ему было нечего, и низ настроек просто отрезало
 *      `overflow: hidden`.
 *
 * Запуск: node test/ui154.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Код без комментариев: иначе объяснение «почему так нельзя» само попадается
   под проверку «так нельзя» — на этом уже спотыкались в этом же файле. */
const css = readFileSync('src/styles/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U154a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

/* 1. Замок высоты: строка сетки ровно во весь экран. Без неё настройки не листаются. */
ok('U154b строка сетки .app фиксирована (100%), а не «по содержимому» — иначе настройки не скроллятся',
  /\.app\s*\{[^}]*grid-template-rows:\s*100%/s.test(css));
ok('U154c .main ограничен высотой оболочки и не даёт контенту вылезти за экран',
  /\.main\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s.test(css));
ok('U154d внутренняя зона прокрутки .content на месте — листается именно она',
  /\.content\s*\{[^}]*overflow-y:\s*auto/s.test(css));

/* 2. Полосы: по умолчанию их нет нигде, и только с мышью — 8px. */
ok('U154e полосы скрыты по умолчанию для всех элементов (scrollbar-width: none)',
  /\*\s*\{[^}]*scrollbar-width:\s*none/s.test(css));
ok('U154f webkit-полоса шириной 0 во всех элементах',
  /\*::-webkit-scrollbar\s*\{[^}]*width:\s*0/s.test(css));
ok('U154g на устройстве с мышью полоса возвращается — 8px внутри (hover: hover) and (pointer: fine)',
  /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\*::-webkit-scrollbar\s*\{[^}]*width:\s*8px/s.test(css));
ok('U154h прежних глобальных правил полосы без media больше нет (они и рисовали столбик на телефоне)',
  !/\n::-webkit-scrollbar\s*\{\s*\n?\s*width:\s*8px/m.test(css));

/* 3. Возврат чужой правки: у .chat-shell нет своего скролла, у корня — своего overflow-y. */
ok('U154i у .chat-shell больше нет собственного overflow-y (это был второй скролл внутри первого)',
  !/\.chat-shell\s*,\s*\n\s*\.side-history/.test(css)
    && !/\.chat-shell\s*\{[^}]*overflow-y:\s*auto/s.test(css));
ok('U154j прокрутка корня не возвращается: нет body { overflow-y: auto } в блоке @supports',
  !/@supports[^{]*\{[\s\S]*?body\s*\{[^}]*overflow-y:\s*auto/.test(css));
ok('U154k инерция прокрутки отдана настоящим скролл-зонам',
  /\.side-history,\s*\n\s*\.ws-body,\s*\n\s*\.thread-scroll/s.test(css));

/* 4. Настройки идут через ту же зону, что и раньше (класс не потерян по пути). */
ok('U154l экран настроек по-прежнему получает .settings-scroll (зона прокрутки не менялась)',
  /settings-scroll/.test(app) && /\.settings-scroll\s*\{/.test(css));

/* 5. След в документации. */
ok('U154m заметка о выпуске и история README содержат 0.154',
  /version: '0\.154'/.test(notes) && /^> \*\*0\.154\*\*/m.test(readme));

console.log('\n5 блоков, 13 проверок — все зелёные');
