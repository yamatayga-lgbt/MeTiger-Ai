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
import { TABLE, buildTable, providerAlive, pickKey } from '../engine/providers.js';
import * as modelreg from '../engine/modelreg.js';
import * as shape from '../engine/shape.js';
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

  /* base, envPrefix и limit есть у всех пулов: у OVHcloud ключ не нужен вовсе
     (noAuth), и его «ключ» в настройках пишется словом keyless — префикс всё
     равно обязан быть, иначе провайдера не включить в окружении. */
  const broken = Object.entries(TABLE)
    .filter(([, def]) => !def.base || !def.envPrefix || !def.limit)
    .map(([name]) => name);
  ok('T2: у каждого провайдера есть адрес, префикс ключа и потолок',
    broken.length === 0, broken.join(', '));

  /* Пулы с poolFromCatalog вне сравнения: их имена пришли из живого каталога самого
     провайдера, а замер судит имя как таковое (gpt-oss-120b мёртв у Groq и жив у
     SambaNova). То же правило у scripts/table-prune.mjs — иначе вечный красный тест. */
  const withLive = Object.entries(TABLE)
    .filter(([, def]) => !def.poolFromCatalog)
    .filter(([, def]) => namesOf(def).some((id) => alive.has(id)));
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

/* ── 0.097/0.099: вторая волна бесплатных пулов — дубли моделей ради взаимозамены ──
   Смысл добавления: если один провайдер не ответил на модель, ту же модель
   спросим у второго. Отсюда три вещи, которые должны быть верны машиной:
     · имя, живущее у двоих, — ОДНА строка в списке выбора (иначе человек видит
       дубль и выбирает наугад, какая «настоящая»);
     · имена из каталога самого провайдера (poolFromCatalog) замер не режет;
     · провайдер без ключа вовсе (keyless: LLM7, Kilo) — живой: он обязан
       попадать в очередь и не слать заголовок авторизации, пока ключа нет. */
{
  /* SambaNova и GitHub ждут ключей; LLM7 и Kilo работают вообще без них. */
  const P = buildTable({ SAMBANOVA_KEYS: 'sn-1', GITHUB_KEYS: 'gh1' });
  const ids4 = ['sambanova', 'github', 'llm7', 'kilo'];
  const missing = ids4.filter((id) => !P[id] || !P[id].models.fast.length || !P[id].models.smart.length);
  ok('T-new-1: четыре новых пула на месте и дают имена в обоих слоях', missing.length === 0, missing.join(', '));

  /* Четыре пула волны — из живых каталогов провайдеров, у llm7 и kilo ключа нет вовсе. */
  ok('T-new-1b: LLM7 и Kilo живут без ключей (keyless), SambaNova без ключа выпадает',
    providerAlive(P, 'llm7', {}) && providerAlive(P, 'kilo', {}) && pickKey(P, 'llm7', {}) === 0
      && !providerAlive(buildTable({}), 'sambanova', {}) && !providerAlive(buildTable({}), 'github', {}),
    'llm7=' + providerAlive(P, 'llm7', {}) + ' sambanova=' + providerAlive(P, 'sambanova', {}));

  const { pools, ids } = poolsOf(P);
  /* Дубли считаются по ТОЧНОМУ имени: оно и есть адрес модели у провайдера, и
     «Meta-Llama-3.3-70B-Instruct» у SambaNova — не то же имя, что
     «Meta-Llama-3_3-70B-Instruct» у OVHcloud (подчёркивание вместо точки).
     Свести их к одной строке значило бы послать одному из двоих чужое имя. */
  const inTwo = ids.filter((id) => pools.filter((p) => p.fast.concat(p.smart).includes(id)).length >= 2);
  /* nemotron-3-ultra-550b-a55b:free живёт у Kilo и у OpenRouter — тот самый дубль. */
  ok('T-new-2: модель, живущая у двух провайдеров, — одна строка в списке (без дублей)',
    inTwo.includes('nvidia/nemotron-3-ultra-550b-a55b:free') && inTwo.every((id) => ids.filter((x) => x === id).length === 1),
    'живут у двоих: ' + inTwo.join(', ') + '; ids=' + ids.length);

  /* Замер живости (снимок 2026-10-03) зовёт gpt-oss-120b мёртвым. Для пула из
     каталога SambaNova это неправда, и витрина обязана оставить строку. */
  const dead = { at: '2026-10-03', alive: ['free-qwen3.5-plus'], dead: ['gpt-oss-120b'] };
  const withoutTrust = modelreg.showcase({ updatedAt: 1, models: [], byId: {} },
    { pickIds: ['gpt-oss-120b'], curatedIds: ['gpt-oss-120b'], verified: dead, tierOf: () => 'smart' });
  const withTrust = modelreg.showcase({ updatedAt: 1, models: [], byId: {} },
    { pickIds: ['gpt-oss-120b'], curatedIds: ['gpt-oss-120b'], verified: dead, trusted: ['gpt-oss-120b'], tierOf: () => 'smart' });
  ok('T-new-3: имя из живого каталога провайдера замер не режет (иначе дубль-спасатель исчезает из выбора)',
    withoutTrust.length === 0 && withTrust.length === 1, `без пометки ${withoutTrust.length}, с пометкой ${withTrust.length}`);

  /* Флаг обязан доехать до живого P: без него /api/models считает trusted пустым,
     и gpt-oss-120b (мёртвый по общему замеру) исчезает из выбора совсем — на проде
     это и случилось в 0.097, пока флаг не прокинули через buildTable. */
  const live = buildTable({ SAMBANOVA_KEYS: 'sn-1', GITHUB_KEYS: 'gh1' });
  const noFlag = ids4.filter((id) => !live[id].poolFromCatalog);
  const tr = poolsOf(live).pools.filter((p) => live[p.provider].poolFromCatalog).flatMap((p) => p.fast.concat(p.smart));
  ok('T-new-5: пометка «имена из каталога» доезжает до живого P и покрывает дубль-спасателя',
    noFlag.length === 0 && tr.includes('gpt-oss-120b'), noFlag.join(',') + ' | ' + tr.length + ' имён');

  const req = (env) => {
    const cfg = buildTable(env).llm7;
    return shape.buildRequest({ cfg, model: 'GLM-5.3-Flash', keyIdx: 0, messages: [{ role: 'user', content: 'привет' }], system: '', maxTokens: 16 });
  };
  const anon = req({}), real = req({ LLM7_KEYS: 'llm7-key' });
  ok('T-new-4: провайдер без ключа идёт без заголовка авторизации, а с ключом — как все',
    !('authorization' in anon.headers) && !!anon.headers['content-type'] && real.headers.authorization === 'Bearer llm7-key',
    JSON.stringify(anon.headers));
}

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

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
