/**
 * 0.161: большие документы читаются по частям (волна «обогнать DeepSeek», пункт 1).
 *
 * Что защищаем — решения, а не буквы:
 *   • текст файла помнит больше прежних 24 000 знаков, а окно — больше 60 000 токенов;
 *   • сборщик вложений умеет НЕ вклеивать документ в сообщение (режим defer) и отдаёт
 *     его движку отдельным полем — решать «целиком или по частям» должен движок;
 *   • движок: влезает — целиком, не влезает — по частям, с запасным путём без модели;
 *   • выписки ложатся в память чата, а вопрос про файл из прошлой реплики их находит;
 *   • головы совета файл видят, но своими вызовами не перечитывают; починка и
 *     продолжение документа не перечитывают вовсе;
 *   • под ответом сказано, как файл прочитан, и строку эту даёт движок (он один
 *     знает правду про окно);
 *   • потолок частей — 8: каждый вызов части стоит живого запроса к бесплатной голове.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const attach = readFileSync('engine/attach.js', 'utf8');
const longdoc = readFileSync('engine/longdoc.js', 'utf8');
const chat = readFileSync('engine/chat.js', 'utf8');
const ctxfit = readFileSync('engine/ctxfit.js', 'utf8');
const memory = readFileSync('engine/memory.js', 'utf8');
const apiChat = readFileSync('functions/api/chat.js', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const vmd = readFileSync('VERSION.md', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const testChain = String(pkg.scripts.test || '');

/** Комментарии вырезаем: проверки «чего нет» иначе ловят слова из объяснений. */
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

/* Версия не прибита к «0.161»: страж обязан пережить следующую версию, иначе
   каждая выкладка ломает прогон на пустом месте. Проверяем ФОРМУ и согласие
   всех источников — это и есть то, что может сломаться по невнимательности. */
const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U161a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U161b «Что нового» и README знают про 0.161 (человек узнаёт, что изменилось)',
  /\*\*0\.161\*\*/.test(readme));

/* Порог, а не литерал: 0.161 обещала «не меньше 160 000 знаков», а 0.170 подняла
   потолок до 200 000. Прибитый к числу страж ловит подъём потолка как поломку —
   ровно так упал Deploy 0.170. Проверяем обещание, а не конкретную цифру. */
ok('U161c текст файла принимается не меньше чем до 160 000 знаков (0.161; сейчас — больше)',
  (() => { const m = /export const DOC_CHARS = (\d+);/.exec(bare(attach)); return !!m && Number(m[1]) >= 160000; })(),
  (() => { const m = /export const DOC_CHARS = (\d+);/.exec(bare(attach)); return m ? m[1] : 'не найдено'; })());
ok('U161d потолок окна поднят не меньше чем до 120 000 токенов (файл доезжает широкой голове целиком)',
  (() => { const m = /export const CTX_WINDOW_MAX = (\d+);/.exec(bare(ctxfit)); return !!m && Number(m[1]) >= 120000; })(),
  (() => { const m = /export const CTX_WINDOW_MAX = (\d+);/.exec(bare(ctxfit)); return m ? m[1] : 'не найдено'; })());
ok('U161e сборщик вложений умеет отдать документ движку отдельным полем (defer → docBlocks)',
  /* Строку возврата посимвольно не сверяем: в 0.180 к ней добавились указание по
     записи и строка о ней, и прибитая «notes, docBlocks }» упала бы на живой
     правке вместо поломки. Проверяем, что поле уезжает наружу. */
  /media && media\.defer/.test(bare(attach)) && /docBlocks\.push\(/.test(bare(attach))
    && /docBlocks,/.test(bare(attach)));
ok('U161f без defer (бот) документ по-прежнему вклеен в сообщение — поведение канала не сломано',
  /if \(!defer\) \{/.test(bare(attach)) && /'\[Файл: ' \+ d\.name/.test(bare(attach)));

ok('U161g длинные документы живут в своём модуле и проверяются без сети',
  /export function splitParts/.test(longdoc) && /export function plan/.test(longdoc)
    && /export function readPrompt/.test(longdoc) && /export function localPick/.test(longdoc)
    && /export function blockOf/.test(longdoc) && /export function lineOf/.test(longdoc)
    && /export const MAX_PARTS = 16;/.test(longdoc) && /export const MIN_PART_CHARS = 2000;/.test(longdoc));
ok('U161h слова вопроса с цифрами («п. 7.3») считаются словами, а не выбрасываются',
  /&& !\/\\d\/\.test\(w\)/.test(bare(longdoc)) && /function terms/.test(longdoc));

const chatBare = bare(chat);
ok('U161i движок читает документы: влезает — целиком, не влезает — по частям',
  /import \* as longdoc from '\.\/longdoc\.js'/.test(chat)
    && /const docReads = \[\]/.test(chatBare)
    && /Array\.isArray\(input\.docs\) && input\.docs\.length/.test(chatBare)
    && /fitsWhole/.test(chatBare) && /longdoc\.plan\(/.test(chatBare)
    && /longdoc\.readPrompt\(/.test(chatBare) && /longdoc\.blockOf\(/.test(chatBare));
ok('U161j решение «по частям» не окружено условием о советах (иначе пин модели ломал бы файл)',
  !/Array\.isArray\(input\.docs\) && input\.docs\.length && !input\.noCouncils/.test(chatBare));
ok('U161k модель на части зовут только когда это не голова совета (квота)',
  /input\.docsMap !== false/.test(chatBare) && /docsMap: false,/.test(chat));
ok('U161l отказ модели на части не теряет файл — ищем по вопросу сами',
  /longdoc\.localPick\(part\.text/.test(chatBare));
ok('U161m починка и продолжение документа не перечитывают (не новый ход разговора)',
  (chatBare.match(/docs: null/g) || []).length >= 3);
ok('U161n чем обернулся файл, видно наружу — строку собирает движок',
  /out\.docs = docReads\.map\(/.test(chatBare) && /longdoc\.lineOf\(\{ line: x\.line, kept: x\.parts, total: x\.total \}\)/.test(chatBare));

ok('U161o выписки по файлу остаются в памяти чата',
  /async function rememberDoc\(chatId, doc\)/.test(memory) && /async function docFor\(chatId\)/.test(memory)
    && /rememberDoc,/.test(memory) && /docFor,/.test(memory)
    && /docChars: 12000/.test(memory) && /if \(useMem && docReads\.length\)/.test(chatBare));
ok('U161p выписки достаются только на вопрос про файл (окно не жжём каждый ход)',
  /const ASKS_FILE = \/файл\|документ/.test(chatBare) && /memory\.docFor\(input\.chatId\)/.test(chatBare)
    && /\[Ранее приложенный файл: /.test(chatBare));

ok('U161q вход отдаёт движку документы отдельно и знает про defer',
  /composeAttach\(\{ has: true, defer: true \}/.test(bare(apiChat)) && /docs: \(composed && composed\.docBlocks/.test(bare(apiChat)));
ok('U161r список прочитанного под ответом собирает движок, читалка — только дополняет',
  /* У функции появился третий довод — запись (0.180): она тоже вложение, и её
     строка стоит под ответом первой. Проверяем обе части вызова, а не форму
     списка доводов целиком: прибитая форма падала бы на живой правке. */
  /function attachmentsOut\(att, r, voice\)/.test(apiChat)
    && /attachments: attachmentsOut\(att, r, composed && composed\.voice\)/.test(apiChat)
    && /for \(const x of \(\(r && r\.docs\) \|\| \[\]\)\)/.test(apiChat));

ok('U161s новые тесты в цепочке прогона (longdoc, bigdoc, ui161)',
  /node test\/longdoc\.test\.js/.test(testChain) && /node test\/bigdoc\.test\.js/.test(testChain)
    && /node test\/ui161\.test\.js/.test(testChain));

console.log('\n0.161: все проверки пройдены');
