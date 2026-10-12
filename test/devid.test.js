/**
 * 0.176: ID устройства и админ-панель — серверная половина.
 *
 * Владелец: «Вместо профилей, будет ID:Аккаунтов… У моего айди будет доступ
 * Разработчика… Ошибки они отправляют разрабу. Мой айди будет #Dev». И уточнил:
 * ID человек выбирает сам, только буквы, максимум 15; менять раз в неделю.
 *
 * Проверяем то, где это молча ломается:
 *   · «только буквы» — цифры и знаки не проходят ни в каком виде;
 *   · неделя — срок держит СЕРВЕР: подделав часы на телефоне, ID не сменить;
 *   · #Dev закрыт для всех, кроме владельца, — и «admin» тоже;
 *   · один занятый ID не может достаться двум устройствам;
 *   · список устройств отдаётся только по коду владельца;
 *   · в обращении видны ID и модель телефона.
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/device.js';
import { onRequestGet as reportGet, onRequestPost as reportPost } from '../functions/api/report.js';
import { ID_MAX, ID_MIN, DEV_ID, idProblem, renameLeft, RENAME_MS, modelFromUa, canRename } from '../engine/devid.js';

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

function fakeEnv(extra) {
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
    ...extra,
  };
}

const env = fakeEnv();
const call = (fn, path, body, headers) =>
  fn({
    request: new Request('https://mt.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  });

const dev = (over = {}) => ({ device: 'dev-aaa111', id: undefined, model: 'SM-A546B', ver: '0.176', ...over });
const ownerH = { 'x-mt-owner': OWNER };

console.log('I — правила ID');
{
  ok('I1: буквы 4–15 — то, что просил владелец',
    idProblem('KTFZ') === '' && idProblem('A'.repeat(15)) === '' && ID_MIN === 4 && ID_MAX === 15);
  ok('I2: цифры и знаки не проходят — словами, а не молча',
    /только латинские буквы/.test(idProblem('KTF4')) && /только латинские буквы/.test(idProblem('KTF Z'))
    && /только латинские буквы/.test(idProblem('КTФZ')), idProblem('KTF4'));
  ok('I3: короткий и длинный ID отклоняются с указанием длины',
    /не меньше 4/.test(idProblem('ABC')) && /не больше 15/.test(idProblem('A'.repeat(16))));
  ok('I4: #Dev и служебные имена закрыты для обычного человека, а для владельца — нет',
    /занят служебно/.test(idProblem('Dev')) && /занят служебно/.test(idProblem('admin'))
    && idProblem('Dev', { owner: true }) === '');
  ok('I5: «#KTFZ» с решёткой не ошибка — решётку человек не обязан вводить', idProblem('#KTFZ') === '');
  ok('I6: модель по строке браузера разбирается, а «K» — не модель',
    modelFromUa('Mozilla/5.0 (Linux; Android 13; SM-A546B Build/TP1A)') === 'SM-A546B'
    && modelFromUa('Mozilla/5.0 (Linux; Android 10; K)') === '' && modelFromUa('iPhone; CPU iPhone OS 17_0') === 'iPhone');
}

console.log('N — запись устройства и ID');
{
  const r = await call(onRequestPost, '/api/device', dev());
  const d = await r.json();
  ok('N1: визит записан: без ID, но с моделью и версией',
    r.status === 200 && d.ok && d.device.id === '' && d.device.model === 'SM-A546B', JSON.stringify(d.device));
  ok('N2: запись лежит под ключом устройства', env._mem.has('dev:devaaa111'), [...env._mem.keys()].slice(0, 3));

  const claim = await call(onRequestPost, '/api/device', dev({ id: 'KTFZ' }));
  const cd = await claim.json();
  ok('N3: первый выбор ID проходит сразу, ID и индекс записаны',
    cd.ok && cd.device.id === 'KTFZ' && cd.renamed && env._mem.has('ididx:ktfz'));

  const second = await call(onRequestPost, '/api/device', dev({ id: 'KTF4' }));
  ok('N4: цифра в ID не проходит (и подсказка объясняет почему)', second.status === 400 && /только латинские буквы/.test((await second.json()).error));

  const other = await call(onRequestPost, '/api/device', { device: 'dev-bbb222', id: 'KTFZ', model: 'iPhone' });
  ok('N5: занятый ID не достаётся другому устройству — 409 со словами',
    other.status === 409 && /уже занят/.test((await other.json()).error));

  const devTry = await call(onRequestPost, '/api/device', { device: 'dev-bbb222', id: 'Dev' });
  ok('N6: обычному человеку #Dev не даётся', devTry.status === 400 && /занят служебно/.test((await devTry.json()).error));
}

console.log('O — владелец');
{
  const r = await call(onRequestPost, '/api/device', { device: 'dev-owner1', model: 'Pixel 8', ver: '0.176' }, ownerH);
  const d = await r.json();
  ok('O1: с кодом владельца ID становится #Dev — «у меня сразу будет стоять айди»',
    d.ok && d.device.id === DEV_ID && d.device.owner === true && d.device.locked === true, JSON.stringify(d.device));
  ok('O2: индекс #Dev указывает на устройство владельца', JSON.parse(env._mem.get('ididx:dev') || '{}').key === 'devowner1');

  const change = await call(onRequestPost, '/api/device', { device: 'dev-owner1', id: 'Drugoy' }, ownerH);
  const chd = await change.json();
  ok('O3: владельцу ID не меняют — отвечаем словами, а не молчанием',
    chd.ok && /закреплён/.test(String(chd.note)), JSON.stringify(chd).slice(0, 120));

  const list = await call(onRequestGet, '/api/device?owner=1', undefined, ownerH);
  const ld = await list.json();
  ok('O4: список устройств отдан с ID, моделью и счётчиками',
    list.status === 200 && ld.total >= 2
    && ld.devices.some((x) => x.id === 'KTFZ' && x.model === 'SM-A546B')
    && ld.devices.some((x) => x.owner && x.id === DEV_ID), ld.total);
  ok('O5: свежие заходы сверху (владелец видит живых первыми)',
    ld.devices[0].lastAt >= ld.devices[ld.devices.length - 1].lastAt);
  ok('O6: без кода список не отдаётся', (await call(onRequestGet, '/api/device?owner=1')).status === 403);
}

console.log('W — неделя на смену ID');
{
  const t = Date.now();
  const rec = { id: 'KTFZ', idChangedAt: t };
  ok('W1: сразу после смены менять нельзя, срок считает сервер',
    !canRename(rec, t) && renameLeft(rec, t) > RENAME_MS - 60000 && renameLeft(rec, t) <= RENAME_MS);
  ok('W2: через неделю — можно', canRename(rec, t + RENAME_MS + 1000));

  const soon = await call(onRequestPost, '/api/device', dev({ id: 'MURZIK' }));
  const sd = await soon.json();
  ok('W3: смена раньше срока отклоняется по-человечески («раз в неделю»)',
    soon.status === 409 && /раз в неделю/.test(sd.error) && sd.renameInDays >= 6, JSON.stringify(sd).slice(0, 120));

  /* Прошла неделя — меняем, старый индекс должен освободиться. */
  const mem = env._mem;
  const rec2 = JSON.parse(mem.get('dev:devaaa111'));
  rec2.idChangedAt = Date.now() - RENAME_MS - 1000;
  mem.set('dev:devaaa111', JSON.stringify(rec2));
  const after = await call(onRequestPost, '/api/device', dev({ id: 'MURZIK' }));
  const ad = await after.json();
  ok('W4: после недели смена проходит, новый ID в индексе, старый освобождён',
    ad.ok && ad.device.id === 'MURZIK' && env._mem.has('ididx:murzik') && !env._mem.has('ididx:ktfz'));
}

console.log('R — обращения видят устройство');
{
  const send = await call(reportPost, '/api/report', {
    text: 'Написал вопрос — ответ пришёл пустой, и картинки не было.',
    photos: [], uid: 'devaaa111', device: 'dev-aaa111', did: 'MURZIK', model: 'SM-A546B', ver: '0.176',
  });
  const sd = await send.json();
  ok('R1: заявка принята', send.status === 200 && sd.ok, JSON.stringify(sd));

  const list = await call(reportGet, '/api/report?owner=1', undefined, ownerH);
  const ld = await list.json();
  const rec = (ld.reports || []).find((x) => x.id === sd.id);
  ok('R2: в обращении видны ID и модель телефона — владелец просил «и в обращениях тоже»',
    !!rec && rec.did === 'MURZIK' && rec.model === 'SM-A546B', rec);

  const devs = await (await call(onRequestGet, '/api/device?owner=1', undefined, ownerH)).json();
  const mine = devs.devices.find((d) => d.id === 'MURZIK');
  ok('R3: счётчик обращений у устройства вырос (видно, кто сколько писал)', mine && mine.reports === 1, mine && mine.reports);
}

console.log('V — двери и связи');
{
  const free = await (await call(onRequestGet, '/api/device?id=Svoboda')).json();
  ok('V1: «свободен ли ID» спрашивается без кода — это не тайна',
    free.ok && free.free === true && free.id === 'Svoboda');
  const busy = await (await call(onRequestGet, '/api/device?id=MURZIK')).json();
  ok('V2: занятый ID честно помечен', busy.ok && busy.free === false && busy.busy === true);
  const devOne = await (await call(onRequestGet, '/api/device?id=dev')).json();
  ok('V3: #Dev помечен служебным', devOne.reserved === true && devOne.free === false);
  const noDev = await call(onRequestPost, '/api/device', { model: 'iPhone' });
  ok('V4: без ключа устройства запись не создаётся', noDev.status === 400);
}

console.log('F — одно устройство: одна запись (0.177)');
{
  /* Владелец открыл админ-панель и увидел три строки «без ID · SM-A546B» вместо
     одной. Причина: ключ устройства (mt-uid) случайный и умирает вместе с чисткой
     данных сайта — тот же телефон заводил вторую запись. Теперь визит приносит ещё
     и отпечаток устройства, и сервер по нему узнаёт уже знакомый телефон. */
  const env1 = fakeEnv();
  const call1 = (fn, path, body, headers) =>
    fn({ request: new Request('https://mt.test' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env: env1 });

  const fp = 'a1b2c3d4e5f60718';
  const первый = await (await call1(onRequestPost, '/api/device', { device: 'uid0000000000001', fp, model: 'SM-A546B', ver: '0.177' })).json();
  ok('F1: первый визит заводит запись устройства', первый.ok === true, JSON.stringify(первый).slice(0, 120));

  const ключи1 = [...env1._mem.keys()].filter((k) => k.startsWith('dev:'));
  ok('F2: записей ровно одна, и к ней привязан отпечаток',
    ключи1.length === 1 && [...env1._mem.keys()].some((k) => k === 'fp:' + fp), JSON.stringify(ключи1));

  /* Тот же телефон, но данные сайта почищены: mt-uid новый, отпечаток прежний. */
  const второй = await (await call1(onRequestPost, '/api/device', { device: 'uid9999999999999', fp, model: 'SM-A546B', ver: '0.177', id: 'Kotik' })).json();
  const ключи2 = [...env1._mem.keys()].filter((k) => k.startsWith('dev:'));
  const запись = JSON.parse(env1._mem.get(ключи1[0]));
  ok('F3: второй заход с чистого localStorage не заводит новую запись — телефон остаётся один',
    ключи2.length === 1 && второй.ok === true && запись.visits >= 1,
    JSON.stringify({ ключи: ключи2, visits: запись.visits }));
  ok('F4: ID, занятый после чистки, лёг в ту же самую запись',
    второй.device && второй.device.id === 'Kotik' && запись.id === 'Kotik',
    JSON.stringify({ отв: второй.device, вЗаписи: запись.id }));

  /* А другой телефон (другой отпечаток) обязан остаться отдельной записью. */
  await call1(onRequestPost, '/api/device', { device: 'uid1111111111111', fp: '9999888877776666', model: 'Pixel 8', ver: '0.177' });
  const ключи3 = [...env1._mem.keys()].filter((k) => k.startsWith('dev:'));
  ok('F5: второй телефон — отдельная запись (склейка идёт по отпечатку, а не по модели)',
    ключи3.length === 2, JSON.stringify(ключи3));

  /* Пустую запись, заведённую новым ключом до склейки, сервер убирает за собой:
     иначе в админ-панели остаются пустые строки «без ID». */
  const третий = await (await call1(onRequestPost, '/api/device', { device: 'uid2222222222222', fp, model: 'SM-A546B', ver: '0.177' })).json();
  const ключи4 = [...env1._mem.keys()].filter((k) => k.startsWith('dev:'));
  ok('F6: новая пустая запись не остаётся мусором в списке устройств',
    третий.ok === true && ключи4.length === 2
      && !ключи4.some((k) => k.includes('uid2222222222222')),
    JSON.stringify(ключи4));

  /* Отпечаток-мусор не должен ничего склеивать. */
  const короткий = await (await call1(onRequestPost, '/api/device', { device: 'uid3333333333333', fp: 'ab', model: 'Nokia', ver: '0.177' })).json();
  const ключи5 = [...env1._mem.keys()].filter((k) => k.startsWith('dev:'));
  ok('F7: слишком короткий отпечаток не принимается — склейки наугад нет',
    короткий.ok === true && ключи5.length === 3 && ![...env1._mem.keys()].some((k) => k === 'fp:ab'),
    JSON.stringify(ключи5));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
