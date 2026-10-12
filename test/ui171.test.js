/**
 * 0.171: презентация (PPTX).
 *
 * Версия маленькая по коду и большая по смыслу: это первый формат на выход, который
 * пришлось собирать «с нуля» после docx/xlsx. Проверяем не «файл создался», а те
 * места, где версия молча ломается: формат определяется верно (презентация не должна
 * уезжать в docx-умолчание), правило разметки доходит до модели, список форматов у
 * инструмента и упаковщика — один и тот же, версия в четырёх источниках и запись
 * «Что нового» на месте. Полностью собранный файл разбирается в test/filegen.test.js
 * (A15–A22): там свой читальщик ZIP и проверка частей пакета.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FMT, formatFromText, generate, packFiles } from '../engine/filegen.js';
import { TOOLS } from '../engine/tools.js';
import { versionsAligned } from './version-sync.js';

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''));
  console.log('  ✔ ' + name);
};

const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const filegen = readFileSync('engine/filegen.js', 'utf8');
const tools = readFileSync('engine/tools.js', 'utf8');
const chain = String(pkg.scripts.test || '');

const v = versionsAligned();
ok('P171a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)', v.ok, v.why);
ok('P171b «Что нового» и README знают про 0.171', /version: '0\.171'/.test(notes) && /\*\*0\.171\*\*/.test(readme));
ok('P171c запись 0.171 говорит про презентацию и слайды человеку, а не про код',
  /Презентация/.test(notes) && /pptx/.test(notes) && /слайд/i.test(notes));

ok('P171d формат pptx зарегистрирован с правильным типом файла',
  FMT.pptx && FMT.pptx.ext === 'pptx'
    && FMT.pptx.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  FMT.pptx);

ok('P171e презентация побеждает docx-умолчание и не путается с таблицей',
  formatFromText('сделай презентацию про космос на 10 слайдов') === 'pptx'
    && formatFromText('нужны слайды к уроку') === 'pptx'
    && formatFromText('сделай таблицу xlsx') === 'xlsx'
    && formatFromText('оформи в docx') === 'docx');

ok('P171f файл собирается и доезжает до человека через обычный путь (блок ```file:pptx```)',
  (() => {
    const r = packFiles('Готово, вот презентация.\n\n```file:pptx|Космос\n# Космос\n- Ракеты\n- Спутники\n```', {});
    return r.files.length === 1 && r.files[0].name === 'Космос.pptx'
      && r.files[0].mime === FMT.pptx.mime && r.reply.includes('Готово');
  })());

ok('P171g пустая презентация честно отказывается, а не отдаёт битый файл',
  (() => { try { generate({ format: 'pptx', name: 'пусто', content: '  \n\n ' }); return false; } catch (e) { return /пустое содержимое/.test(e.message); } })());

ok('P171h в коде нет чужих библиотек для pptx — только свой zip и OOXML',
  !/from ['"](pptxgenjs|officegen|jszip)/.test(filegen) && /function makePptx/.test(filegen) && /zipStore\(parts\)/.test(filegen));

ok('P171i правило разметки слайдов уходит модели (заголовок = новый слайд), а не додумывается упаковщиком',
  /Заголовок слайда/.test(tools) && /file:pptx/.test(tools));

ok('P171j инструмент срабатывает на просьбу про презентацию',
  (() => { const fg = TOOLS.find((t) => t.id === 'filegen'); return fg.when('сделай презентацию про космос на 10 слайдов') && fg.when('оформи в файл смету'); })());

ok('P171k новый тест подключён к цепочке прогона', /node test\/ui171\.test\.js/.test(chain));

console.log('\n0.171: все проверки пройдены');
