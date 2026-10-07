/**
 * TABLE бесплатных провайдеров (engine/providers.js) после живой проверки имён.
 *
 * Зачем: TABLE пишется руками, провайдеры снимают и переименовывают модели. Мёртвое
 * имя в списке — не косметика: каждый запрос сначала жжёт попытку на нём. Отсюда две
 * границы, которые надо держать машиной, а не памятью: лишнего не висит, и ни один
 * провайдер не остался без единого имени (иначе «почистили» = «выключили»).
 *
 *   node test/table.test.js
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TABLE, buildTable } from '../engine/providers.js';
import { poolsOf } from '../functions/api/models.js';
import { VERIFIED } from '../engine/models-verified.js';
import { INTENT_HEADS } from '../engine/route.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const alive = new Set(VERIFIED.alive || []), dead = new Set(VERIFIED.dead || []);
const namesOf = (def) => ['fast', 'smart'].flatMap((t) => (def.models?.[t] || []).map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean));

console.log('── T · TABLE против живого замера ───');
{
  const empties = Object.entries(TABLE).filter(([, def]) => namesOf(def).length === 0).map(([p]) => p);
  ok('T1: ни один провайдер не остался без имён — пустой пул это выключенный провайдер',
    empties.length === 0, empties.join(', '));

  /* base у `local` нет намеренно: адрес берётся из окружения (LOCAL_BASE), а не из файла.
     Поэтому требовать его у всех — значило бы вечно красный тест на честной записи. */
  const broken = Object.entries(TABLE)
    .filter(([, def]) => !def.base || !def.envPrefix || !def.limit)
    .map(([name]) => name);
  ok('T2: у каждого провайдера есть адрес, префикс ключа и потолок',
    broken.length === 0, broken.join(', '));

  const withLive = Object.entries(TABLE).filter(([, def]) => namesOf(def).some((id) => alive.has(id)));
  /* Головы интента исключаем тем же правилом, что и scripts/table-prune.mjs: замер
     судит имя, а не пару «имя + провайдер», и у OdiRouter deepseek живёт, хотя у groq
     та же строка отвечает чужой моделью. Разные правила у теста и у инструмента — это
     вечный красный тест, а не находка. */
  const pinned = new Set(Object.values(INTENT_HEADS || {}).flat());
  const ghosts = withLive.flatMap(([p, def]) => namesOf(def)
    .filter((id) => dead.has(id) && !alive.has(id) && !pinned.has(id)).map((id) => p + '/' + id));
  ok('T3: где есть живые имена, мёртвых по замеру не осталось (у иных — расхождение имён, см. --check)',
    withLive.length >= 4 && ghosts.length === 0, ghosts.slice(0, 4).join(', '));

  /* Проверка «чищен ли файл» должна меряться тем же кодом, что и чистит, а не пересказом. */
  let rc = 0;
  try { execFileSync('node', ['scripts/table-prune.mjs', '--check'], { stdio: 'pipe' }); } catch (e) { rc = e.status }
  ok('T4: scripts/table-prune.mjs --check зелёный — лишнего в файле нет', rc === 0, 'rc=' + rc);

  ok('T5: замер есть, он не просрочен и не пуст — иначе T3 ничего не стоит',
    alive.size > 20 && (Date.now() - Date.parse(VERIFIED.at || '1970-01-01')) / 86400000 < 180,
    `живых ${alive.size}, дата ${VERIFIED.at}`);
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);

/* ── 0.094/0.096: Cerebras и «Локальная модель» убраны из продукта целиком ──
   Cerebras стал платным, локальная голова требовала своего сервера и висела в
   интерфейсе обещанием, которого нет. Обе — лишняя попытка запроса и лишняя
   строка «кто отказал» в каждом ответе, если оставить их в очереди обхода. */
{
  const src = readFileSync(new URL('../engine/providers.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../engine/usage.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../engine/modelreg.js', import.meta.url), 'utf8');
  const hits = src.split('\n').filter((l) => /cerebras/i.test(l) && !/^\s*[*/]/.test(l));
  ok('T-cerebras-1: в движке нет ни одной ЖИВОЙ строки про Cerebras (только комментарии-пояснения)',
    hits.every((l) => /убран|платн|Cerebras убран/.test(l)), hits.join(' | ').slice(0, 160));

  ok('T-local-1: провайдера «local» нет в таблице вовсе — ни строки, ни пула',
    !Object.keys(TABLE).includes('local') && !Object.keys(buildTable({ LOCAL_BASE_URL: 'http://127.0.0.1:11434/v1' })).includes('local'),
    Object.keys(TABLE).join(','));
  const P = poolsOf(buildTable({ GROQ_KEYS: 'g1', LOCAL_BASE_URL: 'http://127.0.0.1:11434/v1' }));
  ok('T-local-2: и в списке моделей его нет, даже если переменные LOCAL_* остались в окружении (мёртвая настройка не воскрешает провайдера)',
    !P.pools.some((p) => p.provider === 'local') && !P.ids.includes('qwen3.5-35b-a3b'), P.pools.map((p) => p.provider).join(','));
}
