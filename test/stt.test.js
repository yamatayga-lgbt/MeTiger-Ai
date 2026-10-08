/**
 * POST /api/stt — голос в текст для приложения (0.104).
 * Живых запросов нет: сеть поддельная, как в voicein.test.js. Проверяется не
 * «сходили и ладно», а четыре вещи, которые легко сломать молча:
 *   · формат берётся из Content-Type, а не угадывается;
 *   · язык пишущего доезжает до провайдера (на короткой фразе он решает);
 *   · причина отказа приходит человеку без токена и без URL;
 *   · потолок размера и ограничитель частоты стоят на входе, а не после работы.
 * Запуск: node test/stt.test.js
 */
import { onRequestPost, onRequestGet, mimeOf } from '../functions/api/stt.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
const AUDIO = new Uint8Array(4096).fill(9);

/** Поддельная сеть: первый ответ — тот, что подан; дальше повтор. Вызовы пишутся. */
function net(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return typeof answer === 'function' ? await answer(url, init) : answer;
  };
  return { fetchImpl, calls };
}

function req(body, opts) {
  const o = opts || {};
  return new Request('https://metiger-ai.pages.dev/api/stt' + (o.query || ''), {
    method: 'POST',
    headers: o.mime === null ? {} : { 'content-type': o.mime || 'audio/webm' },
    body,
  });
}

console.log('STT — голосовой ввод приложения: вход, форматы, язык, причины');
{
  const n = net(json({ text: 'Привет, это проверка.' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = n.fetchImpl;
  try {
    const res = await onRequestPost({ request: req(AUDIO, { query: '?lang=ru&userId=u1' }), env: { GROQ_KEYS: 'gk1', RATE_LIMIT: '0' } });
    const d = await res.json();
    ok('S1: успешная расшифровка отдаётся как { ok, text, provider }',
      res.status === 200 && d.ok === true && d.text === 'Привет, это проверка.' && /groq/.test(d.provider), JSON.stringify(d));
    ok('S2: тело уходит провайдеру формой с моделью, а не сырыми байтами в JSON',
      n.calls.length === 1 && n.calls[0].init.body instanceof FormData
        && n.calls[0].init.body.get('file') instanceof Blob, String(n.calls.length));
    ok('S3: язык пишущего доехал до провайдера (браузер знает его точно)',
      n.calls[0].init.body.get('language') === 'ru', String(n.calls[0].init.body.get('language')));
  } finally { globalThis.fetch = realFetch; }
}
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ error: { message: 'не должен вызываться' } });
  try {
    const empty = await onRequestPost({ request: req(new Uint8Array(0)), env: { GROQ_KEYS: 'gk1', RATE_LIMIT: '0' } });
    const de = await empty.json();
    ok('S4: пустая запись отклоняется до сети, с причиной для человека',
      empty.status === 400 && de.ok === false && /пуст/i.test(de.error), JSON.stringify(de));
    const big = await onRequestPost({ request: req(new Uint8Array(8 * 1024 * 1024 + 16)), env: { GROQ_KEYS: 'gk1', RATE_LIMIT: '0' } });
    const db = await big.json();
    ok('S5: больше 8 МБ — честный отказ цифрами и 413, а не «что-то пошло не так»',
      big.status === 413 && /8 МБ/.test(db.error), JSON.stringify(db));
  } finally { globalThis.fetch = realFetch; }
}
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ text: 'ок' });
  try {
    /* RATE_MAX=1 — так ограничитель виден сразу: второй запрос в ту же минуту мимо. */
    const env = { GROQ_KEYS: 'gk1', RATE_MAX: '1', RATE_WINDOW_MS: '60000' };
    const one = await onRequestPost({ request: req(AUDIO), env });
    const two = await onRequestPost({ request: req(AUDIO), env });
    const d2 = await two.json();
    ok('S6: на входе стоит тот же ограничитель частоты, что у чата (второй запрос — 429)',
      one.status === 200 && two.status === 429 && d2.ok === false && /часто/.test(d2.error), JSON.stringify({ one: one.status, two: two.status, d2 }));
  } finally { globalThis.fetch = realFetch; }
}
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ error: { message: 'Invalid file format: token gsk_secret123' } }, 400);
  try {
    const res = await onRequestPost({ request: req(AUDIO), env: { GROQ_KEYS: 'gk_secret_groq_value', RATE_LIMIT: '0' } });
    const d = await res.json();
    const body = JSON.stringify(d);
    ok('S7: отказ провайдера превращается в причину для человека',
      res.status === 200 && d.ok === false && /Invalid file format/.test(d.error), body);
    ok('S8: в ответе нет нашего ключа — ни целиком, ни куском',
      body.indexOf('gk_secret_groq_value') < 0 && body.indexOf('gk_secret') < 0, body);
  } finally { globalThis.fetch = realFetch; }
}
{
  ok('S9: формат берётся из Content-Type как есть (Safari пишет mp4, Chrome — webm)',
    mimeOf({ headers: { get: () => 'audio/mp4' } }) === 'audio/mp4'
      && mimeOf({ headers: { get: () => 'audio/webm;codecs=opus' } }) === 'audio/webm'
      && mimeOf({ headers: { get: () => null } }) === 'audio/webm', 'mimeOf');
  const res = await onRequestGet({ env: { GROQ_KEYS: 'gk1' } });
  const d = await res.json();
  ok('S10: GET показывает, что вход жив, сколько принимает и кто расшифровывает',
    res.status === 200 && d.ok === true && d.maxBytes === 8 * 1024 * 1024 && !!d.sources && !!d.sources.models, JSON.stringify(d).slice(0, 160));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
