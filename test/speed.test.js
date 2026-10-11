/**
 * Скорость до первого слова и пустые ответы (src/lib/models.ts, 0.164).
 *
 * Проверяем ровно то, из-за чего такие метрики врут: рекорды из «не поймали»
 * (ноль миллисекунд), хвост по интерполяции вместо ближайшего ранга, бессрочный
 * рост массива и — главное — что «пустой ответ» считается пустым, а не исчезает.
 *
 *   node test/speed.test.js
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
if (!existsSync(bin)) {
  console.log('✖ скорость: esbuild не найден — проверки НЕ выполнены. Нужно `npm ci`.');
  process.exit(1);
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-speed');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = join(dir, 'models.mjs');
execFileSync(bin, ['src/lib/models.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm',
  '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
const { recordSpeed, pctl, speedSummary, clearSpeed, fmtSec, recordModelTelemetry } = await import(out);

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    dump: () => Object.fromEntries(map),
  };
}

console.log('\nQ — скорость и пустые ответы');

{
  global.localStorage = fakeStorage();
  const s0 = speedSummary();
  ok('Q1: пустая история — нули, а не выдуманные «0,0 с»',
    s0.firstSample === 0 && s0.firstP50 === 0 && s0.emptySample === 0,
    JSON.stringify(s0));
}

{
  global.localStorage = fakeStorage();
  /* Один ответ — медиана и хвост совпадают: это честно, а не упрощение. */
  recordSpeed({ msToFirst: 1200, empty: false });
  const s = speedSummary();
  ok('Q2: один замер — и p50, и p95 равны ему', s.firstP50 === 1200 && s.firstP95 === 1200, JSON.stringify(s));
  ok('Q3: ответ с текстом не считается пустым', s.emptySample === 1 && s.emptyCount === 0, JSON.stringify(s));
}

{
  global.localStorage = fakeStorage();
  /* Ноль миллисекунд — это «не поймали», а не «мгновенно»: такой замер обязан
     исчезнуть, иначе медиана поедет к нулю. */
  recordSpeed({ msToFirst: 0 });
  recordSpeed({ msToFirst: -5 });
  ok('Q4: ноль и отрицательные не попадают в замеры', speedSummary().firstSample === 0);
  recordSpeed({ msToFirst: 800 });
  ok('Q5: нормальный замер после мусорных — на месте', speedSummary().firstSample === 1);
}

{
  global.localStorage = fakeStorage();
  /* Ближайший ранг, без интерполяции: у 1..10 p50 = 5, p95 = 10. Если кто-то
     однажды заменит на интерполяцию, числа перестанут совпадать с серверными. */
  ok('Q6: p50 по 1..10 — ровно 5', pctl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5, pctl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50));
  ok('Q7: p95 по 1..10 — ровно 10', pctl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10, pctl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95));
  ok('Q8: на пустом массиве — 0, без NaN', pctl([], 50) === 0);
}

{
  global.localStorage = fakeStorage();
  /* 21 замер: медиана — 11-й по возрастанию, хвост — 20-й. Держим это тестом,
     чтобы формула ранга не уехала на единицу. */
  for (let i = 1; i <= 21; i++) recordSpeed({ msToFirst: i * 100 });
  const s = speedSummary();
  ok('Q9: на 21 замере p50 — 11-й (1100 мс), p95 — 20-й (2000 мс)',
    s.firstP50 === 1100 && s.firstP95 === 2000, JSON.stringify(s));
  ok('Q10: пустые считаются отдельной выборкой, а не смешиваются со скоростью',
    s.emptySample === 0 && s.firstSample === 21, JSON.stringify(s));
}

{
  global.localStorage = fakeStorage();
  for (let i = 0; i < 5; i++) recordSpeed({ msToFirst: 500, empty: i === 2 });
  const s = speedSummary();
  ok('Q11: пустой ответ виден в счёте (1 из 5), а не потерян',
    s.emptySample === 5 && s.emptyCount === 1, JSON.stringify(s));
}

{
  global.localStorage = fakeStorage();
  for (let i = 0; i < 400; i++) recordSpeed({ msToFirst: 1000 + i, empty: false });
  const s = speedSummary();
  ok('Q12: хранилище не растёт бесконечно (держим последние 300)', s.firstSample === 300 && s.emptySample === 300, JSON.stringify(s));
}

{
  global.localStorage = fakeStorage();
  for (let i = 0; i < 3; i++) recordSpeed({ msToFirst: 900, empty: false });
  clearSpeed();
  ok('Q13: сброс убирает замеры целиком — старые числа не выглядят сегодняшними',
    speedSummary().firstSample === 0 && speedSummary().emptySample === 0);
}

{
  global.localStorage = fakeStorage();
  /* Замер приходит тем же вызовом, что и счётчик запросов: если однажды свяжут
     только счётчик, скорость молча перестанет копиться. */
  recordModelTelemetry('gemini-2.5-flash', 2400, 800, { msToFirst: 1400, empty: false });
  const s = speedSummary();
  ok('Q14: recordModelTelemetry доносит замер до истории скорости', s.firstSample === 1 && s.firstP50 === 1400, JSON.stringify(s));
  const raw = JSON.parse(global.localStorage.getItem('mt-model-speed'));
  ok('Q15: ключ замера отдельный от счётчика (mt-model-speed) и читаемый',
    Array.isArray(raw.first) && Array.isArray(raw.empty) && raw.first[0] === 1400, JSON.stringify(raw));
}

{
  /* Подписи: «0,4 с» читается по-русски, длинные — целыми секундами. */
  ok('Q16: fmtSec пишет «0,4 с» и «12 с», а не «400 мс»',
    fmtSec(400) === '0,4 с' && fmtSec(12000) === '12 с' && fmtSec(0) === '—',
    [fmtSec(400), fmtSec(12000), fmtSec(0)].join(' | '));
}

console.log(`\nскорость: ${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
