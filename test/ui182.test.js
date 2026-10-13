/**
 * 0.182: одно устройство — одна запись, даже если браузеров два.
 *
 * Слова владельца 12 окт, глядя на вторую строку в админ-панели: «Второе устройство
 * это я же, просто оно считается с другого браузера». Причина была в отпечатке: он
 * считался по полной строке браузера, а у Chrome и Samsung Internet на одном телефоне
 * строки разные — телефон выглядел двумя устройствами.
 *
 * Здесь проверяем всю цепочку целиком — на живых функциях, а не на чтении файла:
 *   F1–F2  отпечаток «про телефон»: у двух браузеров одной машины он совпадёт, а у
 *          разных систем — нет (на живом модуле, с подставленными window/screen);
 *   F3     визит из второго браузера приписывается записи владельца;
 *   F4     настоящей остаётся ЛУЧШАЯ запись: пустая не может «переехать» поверх
 *          записи владельца, даже если указатель отпечатка смотрит на неё;
 *   F5     два человека с одним телефоном, но разными ID — не склеиваются;
 *   F6     владелец со вторым браузером и несовпавшим отпечатком — всё равно один
 *          (узнаём по коду и модели), а ноутбук владельца остаётся своей строкой.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onRequestPost } from '../functions/api/device.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
};

const OWNER = 'TEST-CODE-9X8Z';
const OWNER_HASH = (await (async () => {
  const norm = OWNER.replace(/[\s-]+/g, '').toUpperCase();
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt-owner:' + norm));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
})());

function fakeEnv() {
  const mem = new Map();
  return {
    _mem: mem,
    RATE_LIMIT: '0',
    REPORT_OWNER_HASH: OWNER_HASH,
    MEMORY: {
      get: (k) => (mem.has(k) ? mem.get(k) : null),
      put: (k, v) => { mem.set(k, v); },
      delete: (k) => { mem.delete(k); },
      list: async (o) => ({ keys: [...mem.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((name) => ({ name })) }),
    },
  };
}

const env = fakeEnv();
const call = (body, headers) =>
  onRequestPost({
    request: new Request('https://mt.test/api/device', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(body),
    }),
    env,
  });
const ownerH = { 'x-mt-owner': OWNER };
/* Хранилище кладёт значения строкой (как настоящий KV) — читаем их так же, как сервер. */
const recOf = (store, key) => {
  const v = store.get(key);
  if (v == null) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
};
const FP = 'abcabcabcabcabca';
const dev = (over = {}, headers) => call({ device: 'dev-aaa111', model: 'SM-A155F', ver: '0.182', fp: FP, ...over }, headers);

/* ── F1–F2: отпечаток считается «про телефон», а не «про браузер» ────────────── */
console.log('F — отпечаток телефона, а не браузера');
{
  /* Считаем отпечаток ЖИВОЙ функцией из src/lib/devid.ts (эсбабилд снимает типы):
     подставляем телефон так, как это сделал бы он сам, — сначала Chrome, потом
     Samsung Internet на том же аппарате. Разница только в строке браузера и списке
     языков, и отпечаток обязан совпасть: ровно этого не хватало 12 окт, когда
     владелец увидел своё же второе устройство. */
  const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'mt-fp-'));
  const entry = join(dir, 'fp-entry.ts');
  writeFileSync(entry, "export { deviceFp, osFamily, langBase } from '" + join(process.cwd(), 'src/lib/devid.ts') + "'\n", 'utf8');
  const out = join(dir, 'fp.mjs');
  execFileSync(bin, [entry, '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=' + out, '--log-level=error'], { stdio: 'inherit' });
  const mod = await import(out);

  const phone = (ua, langs) => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    globalThis.navigator = { userAgent: ua, language: langs[0], languages: langs, hardwareConcurrency: 8, deviceMemory: 4 };
    globalThis.screen = { width: 412, height: 915, colorDepth: 24 };
    globalThis.window = { devicePixelRatio: 2.625 };
    /* Модель телефон кэширует в localStorage — кладём её так, как это делает клиент. */
    store.set('mt-dev-model', 'SM-A155F');
    return mod.deviceFp();
  };

  const fpChrome = await phone('Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', ['ru-RU', 'ru', 'en-US']);
  const fpSamsung = await phone('Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36', ['ru-RU', 'ru']);
  const fpOther = await phone('Mozilla/5.0 (Linux; Android 13; SM-A155F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', ['ru-RU']);

  ok('F1: два браузера на одном телефоне дают ОДИН отпечаток', fpChrome === fpSamsung && /^[a-f0-9]{16}$/.test(fpChrome), [fpChrome, fpSamsung]);

  ok('F2: разные системы — разные отпечатки (склейка не «всё в одну строку»)',
    fpOther !== fpChrome, [fpChrome, fpOther]);
}

/* ── F3–F4: склейка записей ─────────────────────────────────────────────────── */
console.log('F3–F4: второй браузер приписывается записи владельца');
{
  /* Первый браузер: владелец заходит с кодом — заводится запись с #Dev. */
  const a = await dev({ device: 'dev-brauzer1' }, ownerH);
  const da = await a.json();
  ok('F3a: владелец завёл запись с #Dev', da.ok && da.device.owner && da.device.id === 'Dev', JSON.stringify(da.device));

  /* Второй браузер на том же телефоне: отпечаток тот же, ключ другой, кода нет. */
  const b = await dev({ device: 'dev-brauzer2' });
  const db = await b.json();
  ok('F3b: визит из второго браузера попал в ту же запись, а не завёл вторую',
    db.ok && da.device.id === db.device.id && env._mem.has('dev:devbrauzer1') && !env._mem.has('dev:devbrauzer2'),
    [...env._mem.keys()].filter((k) => k.startsWith('dev:')));

  /* Обратный порядок: пустая запись уже лежит под отпечатком, потом заходит владелец.
     Прежнее правило приписало бы визит владельца к пустой — и запись владельца
     «переехала» бы. Настоящей должна остаться запись владельца. */
  const env2 = fakeEnv();
  const env2call = (body, headers) => onRequestPost({
    request: new Request('https://mt.test/api/device', { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }),
    env: env2,
  });
  await env2call({ device: 'dev-empty1', model: 'SM-A155F', fp: FP, ver: '0.182' });
  await env2call({ device: 'dev-owner1', model: 'SM-A155F', fp: FP, ver: '0.182' }, ownerH);
  const devKeys = [...env2._mem.keys()].filter((k) => k.startsWith('dev:'));
  const first = devKeys.length === 1 ? recOf(env2._mem, devKeys[0]) : null;
  ok('F4: пустая запись под отпечатком не заводит второе «моё устройство» — запись одна и она владельца',
    devKeys.length === 1 && !!first && first.owner === true && first.id === 'Dev'
      && recOf(env2._mem, 'fp:' + FP).key === first.key,
    [...env2._mem.keys()]);
}

/* ── F5: разные люди с одинаковым телефоном ─────────────────────────────────── */
console.log('F5: один телефон — не один человек');
{
  const env3 = fakeEnv();
  const c3 = (body, headers) => onRequestPost({
    request: new Request('https://mt.test/api/device', { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }),
    env: env3,
  });
  await c3({ device: 'dev-petya', model: 'SM-A155F', fp: FP, ver: '0.182', id: 'Petya' });
  const r2 = await c3({ device: 'dev-vasya', model: 'SM-A155F', fp: FP, ver: '0.182', id: 'Vasya' });
  const d2 = await r2.json();
  ok('F5: два человека с разными ID одну запись не делят, даже если аппарат одинаковый',
    d2.ok && d2.device.id === 'Vasya' && env3._mem.has('dev:devpetya') && env3._mem.has('dev:devvasya'),
    [...env3._mem.keys()].filter((k) => k.startsWith('dev:')));
}

/* ── F6: владелец, у которого отпечаток не сошёлся ──────────────────────────── */
console.log('F6: владельца узнаём и без отпечатка');
{
  const env4 = fakeEnv();
  const c4 = (body, headers) => onRequestPost({
    request: new Request('https://mt.test/api/device', { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }),
    env: env4,
  });
  await c4({ device: 'dev-own1', model: 'SM-A155F', fp: 'aaaaaaaaaaaaaaaa', ver: '0.182' }, ownerH);
  /* Второй браузер: другой отпечаток (иное окно — полноэкранный режим), та же модель,
     код владельца есть (он его ввёл и здесь). */
  const r = await c4({ device: 'dev-own2', model: 'SM-A155F', fp: 'bbbbbbbbbbbbbbbb', ver: '0.182' }, ownerH);
  const d = await r.json();
  ok('F6a: владелец со вторым браузером и другим отпечатком — всё равно одна запись',
    d.ok && d.device.owner && d.device.id === 'Dev'
      && env4._mem.has('dev:devown1') && !env4._mem.has('dev:devown2'),
    [...env4._mem.keys()].filter((k) => k.startsWith('dev:')));

  /* Другое устройство владельца (ноутбук) остаётся своей строкой: это разные вещи. */
  const r2 = await c4({ device: 'dev-noutbuk', model: 'Windows', fp: 'cccccccccccccccc', ver: '0.182' }, ownerH);
  await r2.json();
  const laptop = recOf(env4._mem, 'dev:devnoutbuk');
  ok('F6b: ноутбук владельца — отдельная строка, а не тот же телефон',
    !!laptop && laptop.model === 'Windows' && laptop.owner === true);
}

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
console.log('✔ 0.182: одно устройство — одна запись, даже из другого браузера — проверки пройдены');
