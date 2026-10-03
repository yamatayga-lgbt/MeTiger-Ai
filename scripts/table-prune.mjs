#!/usr/bin/env node
/**
 * Чистка TABLE от имён, на которых провайдер не отвечает под своим.
 *
 * Зачем: список `engine/providers.js` пишется руками, и часть имён провайдеры
 * уже сняли или переименовали. Такое имя не просто лишнее — каждый запрос сначала
 * жжёт попытку на нём и только потом уходит к следующему. Живость имён меряет
 * `scripts/models-probe.mjs`; отсюда и правило: убираем то, что на последнем
 * измерении оказалось мёртвым (молчание, ошибка, ответ чужой моделью).
 *
 *   · не трогает имена, на которые движок опирается намеренно (INTENT_HEADS: головы
 *     интента для математики и кода). Замер судит имени как такового, а не пары
 *     «имя + провайдер»: `deepseek-v4-flash` у groq действительно отвечает чужой
 *     моделью, а у OdiRouter та же строка — рабочая голова, её снимаешь — и математика
 *     считается автором. Для таких имён приговор должен быть померен по провайдеру.
 * Чего скрипт принципиально не делает:
 *   · не трогает провайдера, у которого после чистки не осталось бы ни одного имени, —
 *     это значило бы «выключить провайдера» ради порядка в списке; для таких он только
 *     сообщает цифру и оставляет строки на месте (их имена расходятся с написанными
 *     руками, чинится перечитыванием their /models, а не удалением);
 *   · ничего не выдумывает: если снимок проверки пуст или просрочен, он ничего не режет.
 *
 *   node scripts/table-prune.mjs           — посмотреть и вычистить
 *   node scripts/table-prune.mjs --check   — только проверить (для тестов и CI), код 1 если есть что убрать
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFIED } from '../engine/models-verified.js';
import { INTENT_HEADS } from '../engine/route.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'engine', 'providers.js');
const CHECK = process.argv.includes('--check');

/* Снимок старше полугода — не основание резать: провайдеры добавляют имена пачками. */
const MAX_AGE_DAYS = 180;
const age = (Date.now() - Date.parse(VERIFIED.at || '1970-01-01')) / 86400000;
if (!VERIFIED.dead?.length || age > MAX_AGE_DAYS) {
  console.log(`снимок проверки пуст или просрочен (живых ${VERIFIED.alive?.length || 0}, дата ${VERIFIED.at}) — режет нечего, чистим молча`);
  process.exit(CHECK ? 1 : 0);
}

const dead = new Set(VERIFIED.dead);
const alive = new Set(VERIFIED.alive);
/* Головы интента (и их переопределения через окружение) — вне подозрения замера. */
const pinned = new Set([
  ...Object.values(INTENT_HEADS || {}).flat(),
  ...String(process.env.MATH_HEADS || '').split(','), ...String(process.env.CODE_HEADS || '').split(','),
].map((x) => String(x || '').trim()).filter(Boolean));
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/* Границы блока провайдера: `  имя: {` … `  },` — ищем только внутри models. */
const PROV = /^  ([a-z][a-z0-9]*): \{$/;
const TIER = /^(\s*)(fast|smart): \[(.*)\],$/;

const blocks = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const m = PROV.exec(lines[i]);
  if (m) { cur = { name: m[1], from: i }; blocks.push(cur); continue }
  if (cur && /^  \},$/.test(lines[i])) { cur.to = i; cur = null }
}

const removed = {}, blocked = [];
for (const b of blocks.filter((x) => x.to !== undefined)) {
  const body = lines.slice(b.from, b.to);
  const tierLines = [];
  let have = 0;
  for (let i = 0; i < body.length; i++) {
    const t = TIER.exec(body[i]);
    if (t) { tierLines.push({ i, indent: t[1], tier: t[2], items: t[3] }); have += (t[3].match(/["']/g) || []).length / 2 }
  }
  if (!tierLines.length) continue;

  let left = 0;
  const plan = [];
  for (const tl of tierLines) {
    const items = [...tl.items.matchAll(/(["'])(.*?)\1/g)].map((mm) => ({ raw: mm[0], id: mm[2] }));
    if (!items.length) { left++; continue }
    const keep = items.filter((x) => !dead.has(x.id) || alive.has(x.id) || pinned.has(x.id));
    left += keep.length;
    if (keep.length !== items.length) plan.push({ ...tl, items, keep });
  }
  if (!plan.length) continue;
  if (left <= 0) { blocked.push(`${b.name}: осталось бы 0 имён — не трогаем (${plan.reduce((n, p) => n + (p.items.length - p.keep.length), 0)} мёртвых висят)`); continue }

  for (const p of plan) {
    const list = p.keep.map((x) => x.raw).join(',');
    lines[b.from + p.i] = `${p.indent}${p.tier}: [${list}],`;
    removed[b.name] = (removed[b.name] || 0) + (p.items.length - p.keep.length);
  }
}

const total = Object.values(removed).reduce((a, b) => a + b, 0);
if (!total && !blocked.length) { console.log('TABLE уже вычищена: убирать нечего'); process.exit(0) }
if (CHECK) {
  if (total) { console.log(`TABLE не вычищена: мёртвых имён на удаление ${total}`); process.exit(1) }
  /* Прогнать --check после чистки должно быть зелено ДАЖЕ с blocked: эти имена
     убрать нельзя без выключения провайдера, и тест меряет именно « лишнего не осталось». */
  console.log(`TABLE вычищена; не тронуто намеренно ${blocked.length} провайдеров (имена расходятся, не мёртвые)`);
  process.exit(0);
}
writeFileSync(FILE, lines.join('\n'));
console.log(`TABLE: убрано ${total} имён · ${Object.entries(removed).map(([k, v]) => k + ' −' + v).join(', ')}`);
if (pinned.size) console.log(`голов интента защищено: ${pinned.size} (${[...pinned].join(', ')})`);
if (blocked.length) console.log('не тронуто (иначе провайдеру некому отвечать):\n  ' + blocked.join('\n  '));
console.log('после правки: npm test и node scripts/table-prune.mjs --check (должно быть «уже вычищена»)');
