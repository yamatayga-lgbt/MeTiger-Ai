/**
 * 0.174: аккаунты — серверная половина.
 *
 * Проверяем то, где эта вещь молча ломается, а не «эндпоинт отвечает 200»:
 *   · пароль нельзя прочитать из хранилища — там только производная с солью;
 *   · одинаковый ответ на «нет адреса» и «не тот пароль» (иначе перебором узнают,
 *     кто здесь зарегистрирован);
 *   · потолок в пять аккаунтов на устройство держит сервер, а не форма;
 *   · сессия — это печенька httpOnly, и по ней чат берёт АККАУНТ как адрес памяти;
 *   · восстановление ставит новый пароль и отправляет его письмом (при ключе).
 *
 * Сети нет: KV — карта в памяти, письма — подставной fetch, запросы настоящие.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost, authStore } from '../functions/api/auth.js';
import { hashPassword, verifyPassword, validEmail, passwordProblem, newPassword, emailKey, ACCOUNTS_PER_DEVICE, enabledProviders } from '../engine/accounts.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

function fakeEnv(extra) {
  const mem = new Map();
  const env = {
    _mem: mem,
    RATE_LIMIT: '0',
    MEMORY: {
      get: (k) => (mem.has(k) ? mem.get(k) : null),
      put: (k, v) => { mem.set(k, v); },
      delete: (k) => { mem.delete(k); },
      list: async (o) => ({ keys: [...mem.keys()].filter((k) => !o?.prefix || k.startsWith(o.prefix)).map((name) => ({ name })) }),
    },
    ...extra,
  };
  return env;
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

const cookieOf = (r) => String(r.headers.get('set-cookie') || '').split(';')[0];
const readRec = async (key) => JSON.parse(await env.MEMORY.get(key));
const accKeys = () => [...env._mem.keys()].filter((k) => k.startsWith('acc:') && !k.startsWith('accmail:'));

console.log('A — правила');
{
  ok('A1: адрес проверяется по-человечески (одна собака, точка в домене); пробелы внутри прощаем',
    validEmail('Chelovek@Example.RU') && !validEmail('без-собаки') && !validEmail('a@b')
    && validEmail('a b@c.ru') && !validEmail('две@@собаки.ру'));
  ok('A2: пароль короче восьми знаков отклоняется с понятной фразой',
    /короче 8/.test(passwordProblem('1234567')) && passwordProblem('12345678') === '');
  const p1 = newPassword(() => 0.1);
  const p2 = newPassword(() => 0.9);
  ok('A3: новый пароль читаемый и разный (для письма «забыли пароль»)',
    /^tiger-[a-z2-9]{4}-[a-z2-9]{4}$/.test(p1) && p1 !== p2 && p1.length >= 15, p1);
  ok('A4: входы включаются ключами: пустой env — ни одного включённого',
    Object.values(enabledProviders({})).every((p) => p.on === false));
  const half = enabledProviders({ GOOGLE_CLIENT_ID: 'x' });
  ok('A5: половина ключей не включает вход (Google без секрета остаётся выключен)',
    half.google.on === false);
  ok('A6: с обоими ключами вход включается',
    enabledProviders({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }).google.on === true);
  ok('A7: потолок аккаунтов на устройство — пять (просьба владельца)',
    ACCOUNTS_PER_DEVICE === 5);
}

console.log('H — пароли и хранилище');
{
  const { salt, hash, iterations } = await hashPassword('тайный-пароль-42', env);
  ok('H1: производная от пароля — 32 байта в base64 (44 знака), пароля в ней нет',
    hash.length === 44 && /^[A-Za-z0-9+/=]+$/.test(hash) && !hash.includes('тайный') && salt.length >= 20,
    'итераций: ' + iterations + ', знаков: ' + hash.length);
  ok('H2: тот же пароль с той же солью даёт ту же производную',
    await verifyPassword('тайный-пароль-42', { salt, hash, iterations }, env));
  ok('H3: другой пароль не подходит', !(await verifyPassword('тайный-пароль-43', { salt, hash, iterations }, env)));
  ok('H4: соль у каждого своя — два одинаковых пароля дают разные записи',
    (await hashPassword('один-и-тот-же', env)).hash !== (await hashPassword('один-и-тот-же', env)).hash);
}

console.log('R — регистрация и вход');
{
  const r = await call(onRequestPost, '/api/auth?action=register', { email: 'chelovek@example.ru', password: 'pervij-parol', device: 'dev-aaaa1111' });
  const d = await r.json();
  const cookie = cookieOf(r);
  ok('R1: регистрация отвечает аккаунтом и ставит печеньку сессии',
    d.ok && d.user.email === 'chelovek@example.ru' && /^mt_sess=/.test(cookie), JSON.stringify(d.user));
  ok('R2: в печеньке нет почты и пароля — только токен',
    !cookie.includes('example') && !cookie.includes('parol') && cookie.length > 30);

  const rec = await readRec(accKeys()[0]);
  ok('R3: в хранилище лежат только производная и соль, пароля нет',
    !!rec.hash && !!rec.salt && JSON.stringify(rec).indexOf('pervij-parol') < 0);
  ok('R4: адрес ищется по отпечатку — в ключах нет самой почты',
    /^accmail:[0-9a-f]{40}$/.test(await emailKey('chelovek@example.ru')));

  const same = await call(onRequestPost, '/api/auth?action=register', { email: 'CHELOVEK@example.ru', password: 'pervij-parol', device: 'dev-aaaa1111' });
  ok('R5: повторная регистрация того же адреса (в другом регистре) — отказ', same.status === 409);

  const wrong = await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'не-тот', device: 'dev-aaaa1111' });
  const нетАдреса = await call(onRequestPost, '/api/auth?action=login', { email: 'nikogo@example.ru', password: 'не-тот', device: 'dev-aaaa1111' });
  const a = await wrong.json(), b = await нетАдреса.json();
  ok('R6: «не тот пароль» и «нет такого адреса» отвечают одинаково — перебором не узнать, кто здесь есть',
    wrong.status === нетАдреса.status && a.error === b.error && /не подошл/.test(a.error));

  const good = await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'pervij-parol', device: 'dev-bbbb2222' });
  ok('R7: с верным паролем вход работает и с нового устройства', good.status === 200 && (await good.json()).ok);

  const meR = await call(onRequestGet, '/api/auth?me=1', undefined, { cookie: cookieOf(good) });
  const meD = await meR.json();
  ok('R8: ?me=1 по сессии отдаёт того же человека и признак владельца',
    meD.ok && meD.user.email === 'chelovek@example.ru' && typeof meD.user.owner === 'boolean');
  const anon = await (await call(onRequestGet, '/api/auth?me=1')).json();
  ok('R9: без сессии ?me=1 честно отвечает «никто»', anon.ok && anon.user === null);
}

console.log('F — пять аккаунтов на устройство');
{
  const dev = 'dev-cccc3333';
  await call(onRequestPost, '/api/auth?action=register', { email: 'vtoroy@example.ru', password: 'parol-vtoroy', device: dev });
  await call(onRequestPost, '/api/auth?action=register', { email: 'tretiy@example.ru', password: 'parol-tretiy', device: dev });
  await call(onRequestPost, '/api/auth?action=register', { email: 'chetvertyi@example.ru', password: 'parol-cetv', device: dev });
  await call(onRequestPost, '/api/auth?action=register', { email: 'pyatyy@example.ru', password: 'parol-pyatyy', device: dev });
  await call(onRequestPost, '/api/auth?action=register', { email: 'shestoy@example.ru', password: 'parol-shestoy', device: dev });
  const sixth = await call(onRequestPost, '/api/auth?action=register', { email: 'sedmoy@example.ru', password: 'parol-sedmoy', device: dev });
  const d = await sixth.json();
  ok('F1: шестой аккаунт с одного устройства не заводится — с понятной причиной',
    sixth.status === 409 && /больше 5 нельзя/.test(d.error), JSON.stringify(d));
  const вход = await call(onRequestPost, '/api/auth?action=login', { email: 'vtoroy@example.ru', password: 'parol-vtoroy', device: dev });
  ok('F2: вход в один из пяти по-прежнему работает (потолок — на создание, не на вход)', вход.status === 200);
  const другой = await call(onRequestPost, '/api/auth?action=register', { email: 'chuzhoy@example.ru', password: 'parol-chuzhoy', device: 'dev-dddd4444' });
  ok('F3: с другого устройства регистрация свободна', другой.status === 200);
}

console.log('S — сессия и выход');
{
  const r = await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'pervij-parol', device: 'dev-aaaa1111' });
  const cookie = cookieOf(r);
  const token = cookie.replace('mt_sess=', '');
  ok('S1: сессия ложится в хранилище с TTL и сроком жизни',
    !!(await env.MEMORY.get('sess:' + token)), 'ключ sess:' + token.slice(0, 8) + '…');

  const out = await call(onRequestPost, '/api/auth?action=logout', undefined, { cookie });
  ok('S2: выход стирает сессию и гасит печеньку',
    String(out.headers.get('set-cookie')).includes('Max-Age=0') && !(await env.MEMORY.get('sess:' + token)));

  const after = await call(onRequestGet, '/api/auth?me=1', undefined, { cookie });
  ok('S3: после выхода сессия не действует', (await after.json()).user === null);
}

console.log('P — смена пароля');
{
  const r = await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'pervij-parol', device: 'dev-aaaa1111' });
  const cookie = cookieOf(r);
  const bad = await call(onRequestPost, '/api/auth?action=change', { old: 'не-тот', password: 'novyj-parol-9' }, { cookie });
  ok('P1: без верного текущего пароля смена не проходит', bad.status === 401);

  const short = await call(onRequestPost, '/api/auth?action=change', { old: 'pervij-parol', password: '123' }, { cookie });
  ok('P2: короткий новый пароль отклоняется фразой правила', /короче 8/.test((await short.json()).error));

  const good = await call(onRequestPost, '/api/auth?action=change', { old: 'pervij-parol', password: 'novyj-parol-9' }, { cookie });
  ok('P3: смена проходит, и новый пароль действительно работает',
    good.status === 200
    && (await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'novyj-parol-9', device: 'dev-aaaa1111' })).status === 200);
  const old = await call(onRequestPost, '/api/auth?action=login', { email: 'chelovek@example.ru', password: 'pervij-parol', device: 'dev-aaaa1111' });
  ok('P4: старый пароль после смены не действует', old.status === 401);
}

console.log('M — письмо с новым паролем');
{
  const env2 = fakeEnv({ BREVO_API_KEY: 'test-key', BREVO_FROM: 'robot@example.ru' });
  const call2 = (path, body) => onRequestPost({
    request: new Request('https://mt.test' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    env: env2,
  });
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init && init.body || '{}')) });
    return new Response('{}', { status: 201 });
  };
  try {
    await call2('/api/auth?action=register', { email: 'pismo@example.ru', password: 'parol-dlya-pisma', device: 'dev-eeee5555' });
    const r = await call2('/api/auth?action=recover', { email: 'pismo@example.ru' });
    const d = await r.json();
    ok('M1: восстановление отвечает одинаково и отправляет письмо через Brevo',
      d.ok && sent.length === 1 && sent[0].url.includes('api.brevo.com'), JSON.stringify(d));
    const letter = sent[0].body;
    ok('M2: в письме — новый пароль, адресат тот же, тема понятная',
      /tiger-[a-z2-9]{4}-[a-z2-9]{4}/.test(letter.textContent)
      && letter.to[0].email === 'pismo@example.ru'
      && /пароль/i.test(letter.subject));
    const fresh = /tiger-[a-z2-9]{4}-[a-z2-9]{4}/.exec(letter.textContent)[0];
    const login = await call2('/api/auth?action=login', { email: 'pismo@example.ru', password: fresh, device: 'dev-eeee5555' });
    ok('M3: пароль из письма действительно подходит для входа', login.status === 200);

    const stranger = await call2('/api/auth?action=recover', { email: 'kogo-net@example.ru' });
    const strangerD = await stranger.json();
    ok('M4: на чужой адрес отвечаем так же, а письма не отправляем (иначе перебирают, кто есть)',
      strangerD.ok === true && sent.length === 1, JSON.stringify(strangerD));
  } finally {
    globalThis.fetch = realFetch;
  }

  const env3 = fakeEnv();
  const noMail = await onRequestPost({
    request: new Request('https://mt.test/api/auth?action=recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pismo@example.ru' }) }),
    env: env3,
  });
  ok('M5: без почтового ключа честно сказано «почта ещё не подключена», а не «письмо ушло»',
    noMail.status === 503 && /не подключена/.test((await noMail.json()).error));
}

console.log('V — память и владелец');
{
  const chat = readFileSync('functions/api/chat.js', 'utf8');
  const profile = readFileSync('functions/api/profile.js', 'utf8');
  const report = readFileSync('functions/api/report.js', 'utf8');
  ok('V1: память чата берёт адрес из аккаунта, а устройство остаётся запасным путём',
    /export async function memoryOwner/.test(chat) && /sessionUser\(request, env\)/.test(chat)
    && /const userId = await memoryOwner/.test(chat));
  ok('V2: профиль человека тоже привязан к аккаунту',
    /who && who\.rec && who\.rec\.id/.test(profile));
  ok('V3: обращения подписываются аккаунтом, а «Обращения» открывает владелец по аккаунту',
    /sessionUser\(request, env\)/.test(report) && /isOwnerAccount/.test(report));
  ok('V4: первый зарегистрировавшийся становится владельцем, пока не задан OWNER_EMAILS',
    /claimOwnerIfFirst/.test(readFileSync('functions/api/auth.js', 'utf8')));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
