/* Единственный пропускной пункт для слоя навыков: после правки одного файла — одна команда.
   Собирает всё, что раньше находили в конце фазы (и чинили возвращением): лимиты с учётом
   рамки, короткие тексты вместо prompt, ссылки на несуществующие инструменты, разрыв
   OURS↔реестр, корпус живых фраз и бытовой корпус. Плюс вызывает линт регуляркой.

   Запуск:  node scripts/skillcheck.mjs                     — весь реестр
            node scripts/skillcheck.mjs engine/skills/db.js  — и то же, но с акцентом на файл
   Выход:   0 — можно идти дальше; 1 — вперёд ничего не тащим. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { SKILLS, CATS, FRAMES, detect, skillById, stats } from '../engine/skills.js';
import { TOOLS } from '../engine/tools.js';
import { CANON, MUNDANE, GUARDED } from '../test/skills.corpus.mjs';

const focus = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const problems = [];
const note = (msg) => problems.push(msg);
const cap = 500;

/* 0. линт регулярков — то, что ломает файл молча */
try {
  const all = fs.readdirSync('engine/skills').filter((f) => f.endsWith('.js')).map((f) => 'engine/skills/' + f);
  const args = focus.length ? ['scripts/regexlint.mjs', '--hints', ...focus] : ['scripts/regexlint.mjs', ...all];
  const out = execFileSync('node', args, { encoding: 'utf8' });
  process.stdout.write(out.replace('лайнтер чист', '  · линт регулярков: чист'));
} catch (e) {
  note('лайнт регулярков: ' + String(e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | '));
}

const toolNames = new Set((TOOLS || []).map((t) => t.id));

/* 1. реестр и OURS: молча выпавший навык — самая дорогая из ошибок */
const test = fs.readFileSync('test/skills.test.js', 'utf8');
const oursSrc = (test.match(/const OURS = \[([\s\S]*?)\n\];/) || [, ''])[1];
const ours = [...oursSrc.matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
const oursSet = new Set(ours);
const guardedIds = SKILLS.filter((s) => GUARDED.some((g) => s.id.startsWith(g + '-'))).map((s) => s.id);
const unclaimed = guardedIds.filter((id) => !oursSet.has(id));
if (unclaimed.length) note('в OURS (test/skills.test.js) нет ' + unclaimed.length + ' id: ' + unclaimed.join(', ') + ' — A1 перестанет их считать');
const ghost = ours.filter((id) => !skillById(id));
if (ghost.length) note('OURS ссылается на ' + ghost.length + ' несуществующих id: ' + ghost.join(', '));

/* 2. тексты: потолок со склеенной рамкой и «не desc вместо prompt» */
const oursSkills = SKILLS.filter((s) => oursSet.has(s.id));
const over = oursSkills.filter((s) => s.text.length > cap);
if (over.length) note('сверх потолка ' + cap + ': ' + over.map((s) => s.id + '=' + s.text.length).join(' ') + ' — резать по text.length, а не «на глаз»');
const short = oursSkills.filter((s) => s.text.length <= 120);
if (short.length) note('короткие тексты (похоже на desc вместо prompt): ' + short.map((s) => s.id + '=' + s.text.length).join(' '));

/* 3. витрина: desc читаем целиком, заголовки не дублируются внутри категории */
const badDesc = oursSkills.filter((s) => !s.desc || s.desc.length < 8 || s.desc.length > 64);
if (badDesc.length) note('desc вне 8..64 знаков: ' + badDesc.map((s) => s.id + '=' + (s.desc || '').length).join(' '));
const seen = new Map();
for (const s of oursSkills) {
  const key = s.cat + '|' + s.title;
  if (seen.has(key)) note('дубль заголовка в категории ' + s.cat + ': «' + s.title + '» (' + seen.get(key) + ' и ' + s.id + ')');
  seen.set(key, s.id);
}

/* 4. инструменты и ссылки: ни одной несуществующей */
const badNeed = oursSkills.filter((s) => (s.need || []).some((t) => !toolNames.has(t)));
if (badNeed.length) note('need ссылается на несуществующий инструмент: ' + badNeed.map((s) => s.id + '→' + s.need.join('/')).join(' '));
const badSup = oursSkills.filter((s) => (s.supersedes || []).some((x) => !skillById(x)));
if (badSup.length) note('supersedes в никуда: ' + badSup.map((s) => s.id).join(' '));
const withTools = oursSkills.filter((s) => (s.tools || []).length || (s.need || []).length);
if (withTools.length) console.log('  · навыков с инструментами среди наших: ' + withTools.length + ' (' + withTools.map((s) => s.id).join(' ') + ')');

/* 5. рамки: приклеены ровно там, где обещание действия невозможно */
for (const [cat, frame] of Object.entries(FRAMES)) {
  const list = SKILLS.filter((s) => s.cat === cat && !s.off);
  const naked = list.filter((s) => !s.text.includes(frame.trim().slice(0, 24)));
  if (naked.length) note('рамка «' + cat + '» не доехала до ' + naked.length + ' навыков: ' + naked.map((s) => s.id).join(' '));
}
console.log('  · рамки: ' + Object.entries(FRAMES).map(([k, v]) => k + '(' + v.length + ')').join(' '));

/* 6. корпус: живой язык слышен, бытовой молчит, coverage обязательна */
const fired = (q) => detect(q, {}).map((x) => x.id);
const deaf = CANON.filter(([q, id]) => !fired(q).includes(id));
if (deaf.length) note('CORPUS: ' + deaf.length + ' фраз не тянут навык — ' + deaf.slice(0, 4).map(([q, id]) => q + ' ≠' + id + ' → [' + fired(q).join(',') + ']').join(' ;; '));
const per = {};
for (const [, id] of CANON) per[id] = (per[id] || 0) + 1;
const thin = guardedIds.filter((id) => (per[id] || 0) < 2);
if (thin.length) note('CORPUS: у ' + thin.length + ' новых навыков меньше двух живых фраз: ' + thin.join(', ') + ' — добавьте формулировки, а не один термин из заголовка');
const spilled = MUNDANE.filter((q) => fired(q).some((id) => guardedIds.includes(id)));
if (spilled.length) note('CORPUS: бытовой корпус будит новые навыки — ' + spilled.slice(0, 4).map((q) => q + ' → ' + fired(q).filter((id) => guardedIds.includes(id)).join(',')).join(' ;; '));
const budget = fired(CANON.map((x) => x[0]).join(' и '));
if (budget.length > 16) note('весь корпус разом не влезает в бюджет: ' + budget.length + ' > 16');

/* 6.5 омонимы: спорный корень без технической опоры — тот же дефект, что ловили трижды
   (палитра для гостиной, инструкция по сборке шкафа, состояние дороги). Проверка генеративная:
   она не зависит от того, вспомнил ли кто-то конкретную фразу, — список корней растёт, а
   фразы собираются сами. Бытовыми считаются рамки без единого технического слова. */
const AMBIG = ['палитру', 'палитра', 'шрифт', 'шрифты', 'типографику', 'состояния', 'состояние',
  'макет', 'прототип', 'сетку', 'направление', 'согласованность', 'доступность', 'обратную связь',
  'инструкцию', 'руководство', 'гайд', 'мануал', 'спецификацию',
  'документацию', 'историю изменений', /* changelog, readme и runbook в быт не переходят: опора ради них только мешает */ 'чек-лист', 'поток',
  'сценарий', 'композицию', 'плотность', 'отступы', 'роли цветов', 'вёрстку', 'навигацию',
  'состояние дороги', 'размеры', 'цвета', 'палитру для стен'];
const BYT = ['для гостиной', 'для кухни', 'в саду', 'на даче', 'для ремонта', 'для свадьбы',
  'в машине', 'для собаки', 'у духовки', 'для отпуска', 'в коридоре', 'для дачного домика'];
const OMO_FRAMES = ['%s %s', 'подбери %s %s', 'напиши %s %s', 'проверь %s %s'];
const guardedSkills = SKILLS.filter((x) => !x.off && GUARDED.some((g) => x.id.startsWith(g + '-')) && x.re);
const omono = [];
for (const r of AMBIG) for (const c of BYT) for (const f of OMO_FRAMES) omono.push(f.replace('%s', r).replace('%s', c));
const omonoHit = [];
for (const q of omono) {
  const who = guardedSkills.filter((x) => x.re.test(q)).map((x) => x.id);
  if (who.length) omonoHit.push(q + ' → ' + [...new Set(who)].join(','));
}
const omonoBy = new Map();
for (const q of omono) {
  for (const x of guardedSkills.filter((y) => y.re.test(q))) {
    const root = AMBIG.find((r) => q.includes(r)) || '?';
    const k = root + ' → ' + x.id;
    omonoBy.set(k, (omonoBy.get(k) || 0) + 1);
  }
}
if (process.argv.includes('--omono')) {
  console.log('OMONIM: сводка (корень → навык, сколько бытовых фраз):');
  for (const [k, n] of [...omonoBy].sort((x, y) => y[1] - x[1])) console.log('  ', k.padEnd(34), n);
}
if (omonoHit.length) {
  note('OMONIM: ' + omonoHit.length + ' бытовых фраз будят наши навыки — у ветки нет доменной опоры: '
    + omonoHit.slice(0, 6).join(' ;; ') + (omonoHit.length > 6 ? ' …' : ''));
}

/* 7. итог */
const st = stats();
console.log('  · реестр: ' + st.total + ' | на ходу ' + st.on + ' | off ' + st.off + ' | категорий ' + CATS.length +
  ' | наших ' + ours.length + ' | новых (GUARDED) ' + guardedIds.length +
  ' | корпус ' + CANON.length + '×' + 'фраз + ' + MUNDANE.length + ' бытовых');
if (focus.length) {
  for (const f of focus) {
    const src = fs.readFileSync(f, 'utf8');
    const ids = [...src.matchAll(/S\('([\w-]+)'/g)].map((m) => m[1]);
    const max = Math.max(0, ...ids.map((id) => (skillById(id) || { text: '' }).text.length));
    const miss = ids.filter((id) => !skillById(id));
    console.log('  · ' + f.split('/').pop() + ': ' + ids.length + ' навыков, ' + (miss.length ? 'НЕ В РЕЕСТРЕ: ' + miss.join(',') : 'все в реестре') + ', макс. текст ' + max);
    if (miss.length) note('файл ' + f + ' объявляет ' + miss.length + ' навыков, которых нет в реестре — импорт или spread потерян');
  }
}
if (problems.length) {
  console.log('\nзамечаний: ' + problems.length);
  for (const p of problems) console.log('✗ ' + p);
  process.exit(1);
}
console.log('\n✓ замечаний нет — слой проходит пропускной пункт, можно идти дальше');
