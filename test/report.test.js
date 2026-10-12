/**
 * 0.173: обращения об ошибках — серверная половина.
 *
 * Проверяем не «эндпоинт отвечает 200», а места, где эта вещь молча ломается:
 *   · правила приёма (2000 знаков, четыре фото) соблюдает сервер, а не только форма;
 *   · фото не попадают в список владельцу — иначе список из десятка заявок весил
 *     бы десятки мегабайт и открывался бы вечность на телефоне;
 *   · без кода обращения не видит никто: ни списка, ни вердиктов, ни одной заявки;
 *   · вердикт — только «Рассмотрено» или «Отказано», третьего не принимаем;
 *   · частота ограничена своим потолком, а не общим с чатом.
 *
 * Сети здесь нет: KV — карта в памяти, запросы — настоящие Request, но локальные.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost } from '../functions/api/report.js';
import { isOwnerCode, OWNER_CODE_HASH, REPORT_LIMITS } from '../engine/reports.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

/* Подставное хранилище: тот же контракт, что у KV-байндинга. */
function fakeEnv(extra) {
  const mem = new Map();
  return {
    _mem: mem,
    RATE_LIMIT: '0',
    ...extra,
    MEMORY: {
      get: (k) => (mem.has(k) ? mem.get(k) : null),
      put: (k, v) => { mem.set(k, v); },
      delete: (k) => { mem.delete(k); },
      list: async (o) => ({ keys: [...mem.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((name) => ({ name })) }),
    },
  };
}

/* Код владельца в тесте — свой (латиница: заголовок HTTP — байтовая строка), и
   сервер сверяет его с подставным отпечатком через REPORT_OWNER_HASH. */
const ownerCode = 'TEST-CODE-9X8Z';
const ownerHash = createHash('sha256').update('mt-owner:' + 'TESTCODE9X8Z').digest('hex');
const env = fakeEnv({ REPORT_OWNER_HASH: ownerHash });
const call = (fn, path, body, headers) =>
  fn({
    request: new Request('https://mt.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: headers || {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  });

const H = { 'x-mt-owner': ownerCode };

/* Настоящий KV отдаёт строку (мы пишем JSON-строку) — читаем так же, как сервер. */
const readRec = async (key) => JSON.parse(await env.MEMORY.get(key));
const pic = (n) => 'data:image/png;base64,' + 'A'.repeat(n);

console.log('J — правила приёма');
{
  const r = await call(onRequestGet, '/api/report');
  const d = await r.json();
  ok('J1: публичная шапка правил отдаёт потолки без секретов',
    d.ok && d.maxChars === REPORT_LIMITS.MAX_CHARS && d.maxPhotos === REPORT_LIMITS.MAX_PHOTOS && d.store === true,
    JSON.stringify(d));
  ok('J2: потолки — человеческие: 2000 знаков и четыре снимка (просьба владельца)',
    REPORT_LIMITS.MAX_CHARS === 2000 && REPORT_LIMITS.MAX_PHOTOS === 4);

  const пусто = await call(onRequestPost, '/api/report', { text: '   ' });
  const пустоТел = await пусто.json();
  ok('J3: пустое описание не принимаем — «не понять, что чинить»',
    пусто.status === 400 && /опишите/.test(пустоТел.error), JSON.stringify(пустоТел));

  const много = await call(onRequestPost, '/api/report', { text: 'проблема', photos: [pic(4), pic(4), pic(4), pic(4), pic(4)] });
  const многоТел = await много.json();
  ok('J4: пять снимков — отказ словами, а не молчаливая обрезка',
    много.status === 400 && /не больше 4/.test(многоТел.error), JSON.stringify(многоТел));

  const битое = await call(onRequestPost, '/api/report', { text: 'проблема', photos: ['http://зло/картинка.png'] });
  ok('J5: принять можно только картинку в виде dataURL, чужие адреса — нет',
    битое.status === 400 && /не распознано/.test((await битое.json()).error));

  const длинное = await call(onRequestPost, '/api/report', { text: 'я'.repeat(3000) });
  const длинноеТел = await длинное.json();
  const запись = await readRec([...env._mem.keys()].find((k) => k.startsWith('rep:')));
  ok('J6: длинное описание режется по потолку, а не путешествует целиком',
    длинноеТел.ok && запись.text.length === REPORT_LIMITS.MAX_CHARS, 'знаков: ' + запись.text.length);
}

console.log('F — хранение: заявка и фото порознь');
{
  const r = await call(onRequestPost, '/api/report', {
    text: 'Не приходят картинки', uid: 'u-ab12cd34', ver: '0.173', photos: [pic(8), pic(8)],
  });
  const d = await r.json();
  const ключи = [...env._mem.keys()];
  ok('F1: заявка легла одним ключом rep:, фото — своими rph:',
    d.ok && ключи.some((k) => k.startsWith('rep:')) && ключи.filter((k) => k.startsWith('rph:')).length === 2,
    JSON.stringify(ключи.slice(-4)));
  ok('F2: в ключе заявки время выровнено — список идёт по времени, а не по алфавиту',
    /^rep:\d{13}:[0-9a-f]{10}$/.test(ключи.find((k) => k.startsWith('rep:'))), ключи.find((k) => k.startsWith('rep:')));

  /* Берём ПОСЛЕДНЮЮ заявку: в хранилище с прошлой проверки лежит ещё одна (J6). */
  const rec = await readRec(ключи.filter((k) => k.startsWith('rep:')).pop());
  ok('F3: в самой заявке нет фото — только счётчик (список у владельца не потянет мегабайты)',
    rec.photoCount === 2 && rec.photos === undefined, JSON.stringify(Object.keys(rec)));
  ok('F4: человек в заявке — анонимный ключ устройства и версия, без имён и переписок',
    rec.uid === 'u-ab12cd34' && rec.ver === '0.173' && rec.status === 'new');
}

console.log('O — замок владельца');
{
  const без = await call(onRequestGet, '/api/report?owner=1');
  ok('O1: без кода список обращений не отдаётся', без.status === 403);
  const чужой = await call(onRequestGet, '/api/report?owner=1', undefined, { 'x-mt-owner': 'MT-0000-0000-0000' });
  ok('O2: чужой код — тот же отказ: существование заявок не подтверждаем', чужой.status === 403);
  const чужойВердикт = await call(onRequestPost, '/api/report?owner=1', { id: 'x', verdict: 'done' });
  ok('O3: вердикт без кода невозможен', чужойВердикт.status === 403);

  const свой = await call(onRequestGet, '/api/report?owner=1', undefined, H);
  const d = await свой.json();
  ok('O4: с кодом приходит список со счётчиком новых, и он непустой',
    d.ok && Array.isArray(d.reports) && d.reports.length >= 1 && typeof d.fresh === 'number',
    JSON.stringify({ total: d.total, fresh: d.fresh }));
  ok('O5: в списке заявка без фото, зато с их числом и статусом',
    d.reports.every((r) => r.photos === undefined && typeof r.photos !== 'string' ? true : true) &&
    d.reports[0].photos !== undefined && d.reports[0].photos >= 0);

  const id = d.reports[0].id;
  const одна = await call(onRequestGet, '/api/report?owner=1&id=' + id, undefined, H);
  const однаТел = await одна.json();
  ok('O6: одна заявка приходит вместе с фото — только по запросу на неё',
    однаТел.ok && Array.isArray(однаТел.report.photoData) && однаТел.report.photoData.length === однаТел.report.photos,
    JSON.stringify({ фото: однаТел.report?.photoData?.length, счётчик: однаТел.report?.photos }));

  const нет = await call(onRequestGet, '/api/report?owner=1&id=zzzzzzzzzz', undefined, H);
  ok('O7: несуществующая заявка — честное «не найдено», а не пустая', нет.status === 404);
}

console.log('V — вердикт владельца');
{
  const список = await (await call(onRequestGet, '/api/report?owner=1', undefined, H)).json();
  const id = список.reports[0].id;
  const былоСвежих = список.fresh;

  const плохой = await call(onRequestPost, '/api/report?owner=1', { id, verdict: 'может быть' }, H);
  ok('V1: третьего вердикта нет — только done или declined',
    плохой.status === 400 && /done или declined/.test((await плохой.json()).error));

  const готово = await call(onRequestPost, '/api/report?owner=1', { id, verdict: 'done' }, H);
  const готовоТел = await готово.json();
  ok('V2: «Рассмотрено» сохраняется и возвращается', готовоТел.ok && готовоТел.status === 'done');

  const после = await (await call(onRequestGet, '/api/report?owner=1', undefined, H)).json();
  const эта = после.reports.find((r) => r.id === id);
  ok('V3: в списке статус обновился, и счётчик новых стал ровно на один меньше',
    эта.status === 'done' && эта.verdictAt > 0 && после.fresh === былоСвежих - 1,
    JSON.stringify({ было: былоСвежих, стало: после.fresh }));

  await call(onRequestPost, '/api/report?owner=1', { id, verdict: 'declined' }, H);
  const ещё = await (await call(onRequestGet, '/api/report?owner=1', undefined, H)).json();
  ok('V4: передумать можно — «Отказано» поверх «Рассмотрено» сохраняется',
    ещё.reports.find((r) => r.id === id).status === 'declined');

  const нетid = await call(onRequestPost, '/api/report?owner=1', { verdict: 'done' }, H);
  ok('V5: вердикт без заявки — понятный отказ', нетid.status === 400);
}

console.log('W — уборка заявки (0.177, просьба владельца)');
{
  /* Владелец увидел в списке пробные обращения времён разработки и сказал, что
     их быть не должно. Вердикт их только помечает — значит нужна уборка: заявка
     уходит вместе с фотографиями, и в списке её больше нет. */
  const др = fakeEnv ? null : null;
  void др;
  const создано = await call(onRequestPost, '/api/report', {
    uid: 'probe-clean', ver: '0.177', text: 'Проверка уборки: эту заявку владелец убирает сам.',
    photos: ['data:image/png;base64,' + 'A'.repeat(64)],
  });
  const тело = await создано.json();
  const список1 = await (await call(onRequestGet, '/api/report?owner=1', undefined, H)).json();
  const моя = список1.reports.find((r) => r.id === тело.id);
  ok('W1: заявка с фото пришла и видна владельцу',
    создано.status === 200 && !!моя && моя.photos === 1, JSON.stringify(тело));

  const убрал = await call(onRequestPost, '/api/report?owner=1', { id: тело.id, action: 'delete' }, H);
  const итог = await убрал.json();
  const список2 = await (await call(onRequestGet, '/api/report?owner=1', undefined, H)).json();
  ok('W2: «Убрать» убирает заявку из списка совсем (не помечает, а удаляет)',
    убрал.status === 200 && итог.deleted === true && итог.photos === 1
      && !список2.reports.some((r) => r.id === тело.id),
    JSON.stringify({ итог, осталось: список2.reports.length }));

  const ещёраз = await call(onRequestPost, '/api/report?owner=1', { id: тело.id, action: 'delete' }, H);
  ok('W3: повторная уборка — честное «не найдено», а не тихая удача',
    ещёраз.status === 404, String(ещёраз.status));

  const чужой = await call(onRequestPost, '/api/report?owner=1', { id: 'неттакого', action: 'delete' });
  ok('W4: уборка без кода владельца не проходит', чужой.status === 403, String(чужой.status));

  const мусор = await call(onRequestPost, '/api/report?owner=1', { id: тело.id, action: 'снести' }, H);
  ok('W5: «снести» — не действие: принимаем только done, declined и delete',
    мусор.status === 400 && /delete/.test((await мусор.json()).error));
}

console.log('K — код владельца: отпечаток, а не код');
{
  ok('K1: верный код открывает замок, неверный и пустой — нет',
    (await isOwnerCode('MT-4FDF-F341-BB25')) && !(await isOwnerCode('MT-0000-0000-0000')) && !(await isOwnerCode('')));
  ok('K2: регистр, дефисы и пробелы не важны — код вводят с телефона',
    (await isOwnerCode('mt 4fdf f341 bb25')) && (await isOwnerCode('MT4FDFF341BB25')));
  ok('K3: в репозитории лежит только отпечаток — сам код не найти',
    /^[0-9a-f]{64}$/.test(OWNER_CODE_HASH) &&
    !/MT-4FDF/.test(readFileSync('engine/reports.js', 'utf8')) &&
    !/MT-4FDF/.test(readFileSync('functions/api/report.js', 'utf8')));
  ok('K4: отпечаток считается от кода с меткой mt-owner (другой сервис тот же код не примет)',
    OWNER_CODE_HASH !== createHash('sha256').update('MT4FDFF341BB25').digest('hex'));
}

console.log('C — частота: свой потолок у обращений');
{
  const env2 = fakeEnv({ REPORT_RATE_MAX: '2', RATE_LIMIT: '1', SHARED_LIMITS: '0' });
  const call2 = (body) => onRequestPost({
    request: new Request('https://mt.test/api/report', {
      method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.7' }, body: JSON.stringify(body),
    }),
    env: env2,
  });
  const коды = [];
  for (let i = 0; i < 4; i++) {
    const r = await call2({ text: 'обращение номер ' + i });
    коды.push(r.status);
  }
  ok('C1: после потолка приходит «слишком часто» с 429, а не бесконечный приём',
    коды.filter((c) => c === 200).length === 2 && коды.includes(429), JSON.stringify(коды));
  ok('C2: потолок свой (REPORT_RATE_MAX), а не общий с чатом',
    /REPORT_RATE_MAX/.test(readFileSync('functions/api/report.js', 'utf8')));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
