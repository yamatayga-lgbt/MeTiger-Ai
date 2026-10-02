/**
 * Голос → текст (engine/voicein.js) на поддельной сети.
 * Живых запросов нет: fetch передаётся в слой. Проверяется порядок источников,
 * перебор форматов, «тишина» без втοрого запроса и — главное — что в причине
 * отказа не течёт токен.
 * Запуск: node test/voicein.test.js
 */
import { createStt, hasWords, sttLimits } from '../engine/voicein.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

const AUDIO = new Uint8Array(2048).fill(7);
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });

/** Подделка сети: groq и openrouter отвечают по очереди ответов; вызовы пишутся в calls. */
function net(answers) {
  const calls = [];
  const seen = { groq: 0, openrouter: 0 };
  const fetchImpl = async (url, init) => {
    const key = /groq/.test(url) ? 'groq' : 'openrouter';
    const idx = seen[key]++;
    const rec = { url, init, form: null, body: null, file: null };
    if (init && init.body instanceof FormData) {
      rec.form = init.body;
      rec.file = init.body.get('file');
    } else if (init && typeof init.body === 'string') rec.body = JSON.parse(init.body);
    calls.push(rec);
    const seq = answers[key];
    if (!seq) return json({ error: { message: 'нет ответа в фикстуре' } }, 599);
    const step = seq[Math.min(idx, seq.length - 1)];
    return typeof step === 'function' ? await step(rec) : step;
  };
  return { fetchImpl, calls };
}

console.log('V — расшифровка голоса: два источника, лимиты, честные причины');
{
  ok('V1: hasWords — слова есть только если есть буквы или цифры', !hasWords('') && !hasWords('   ') && !hasWords('!?!') && hasWords('привет'));
  ok('V2: точка от шума («.») ответом не считается', !hasWords('.') && !hasWords('«»') && !hasWords('a'));
  ok('V3: переносы и двойные пробелы вычищаются, перевод строк живой', hasWords('раз\nдва  три'));
  ok('V4: лимиты наружу есть, и они не меняются', sttLimits.MAX_AUDIO === 8 * 1024 * 1024 && sttLimits.MIN_AUDIO === 400 && /ДОСЛОВНО/.test(sttLimits.PROMPT));
}
{
  const s = createStt({ env: { STT: 'off', GROQ_KEYS: 'gk1' }, fetch: async () => json({}), log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V5: STT=off — слой не трогает сеть и говорит, что выключен', r.ok === false && /CTX|STT=off/.test(r.why) && /выключено/.test(r.why), JSON.stringify(r));
}
{
  const s = createStt({ env: {}, fetch: async () => json({}), log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V6: без ключей никуда не идём, а причины названы по обоим источникам', r.ok === false && /GROQ_KEYS/.test(r.why) && /OPENROUTER_KEYS/.test(r.why), JSON.stringify(r.why));
  const empty = await s.transcribe({ bytes: new Uint8Array(0), mime: 'audio/ogg' });
  const tiny = await s.transcribe({ bytes: new Uint8Array(100), mime: 'audio/ogg' });
  const huge = await s.transcribe({ bytes: new Uint8Array(sttLimits.MAX_AUDIO + 10), mime: 'audio/ogg' });
  ok('V7: пустое и слишком короткое аудио отклоняется до сети', /пустое/.test(empty.why) && /короткое/.test(tiny.why), JSON.stringify([empty.why, tiny.why]));
  ok('V8: в 8 МБ упираемся честно, цифрами', /8 МБ/.test(huge.why), huge.why);
}
{
  const n = net({ groq: [json({ text: 'Привет, это Тигр.', language: 'ru' })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1,gk2' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V9: Groq — основной путь, текст и язык приходят как есть', r.ok && r.text === 'Привет, это Тигр.' && /groq\/whisper/.test(r.via) && r.lang === 'ru', JSON.stringify(r));
  const rec = n.calls[0];
  ok('V10: запрос — multipart с моделью, temperature 0 и промптом стенографа', rec.form.get('model') === 'whisper-large-v3-turbo' && rec.form.get('temperature') === '0' && /ДОСЛОВНО/.test(rec.form.get('prompt')) && rec.form.get('response_format') === 'verbose_json', [...rec.form.keys()].join(','));
  ok('V11: ключ передаётся заголовком, а не текстом запроса', /^Bearer gk1$/.test(rec.init.headers.authorization), JSON.stringify(rec.init.headers));
  ok('V12: в теле нет ни токена бота, ни пути к файлу на нашем диске', JSON.stringify([...rec.form.keys()]).indexOf('token') < 0 && /voice\.(ogg|opus|webm)/.test(rec.file.name || ''), String(rec.file && rec.file.name));
}
{
  const n = net({ groq: [json({ error: { message: 'Invalid file format' } }, 400), json({ text: 'слышно' })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/webm' });
  ok('V13: формат не подошёл — пробуем следующий, а не сдаёмся', r.ok && n.calls.length === 2 && /groq\//.test(r.via), JSON.stringify({ ok: r.ok, calls: n.calls.length }));
}
{
  const n = net({ groq: [json({ text: '   ' })], openrouter: [json({ choices: [{ message: { content: 'не должен вызываться' } }] })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1', OPENROUTER_KEYS: 'ork' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V14: Groq ответил «тишина» — второй источник не гоняем зря', r.ok === false && /не было/.test(r.why) && n.calls.length === 1, JSON.stringify({ why: r.why, calls: n.calls.length }));
}
{
  const n = net({ groq: [json({ error: { message: 'Rate limit reached' } }, 429)], openrouter: [json({ choices: [{ message: { content: '«Котёнок спит»' } }] })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1', OPENROUTER_KEYS: 'ork', STT_OMNI_MODEL: 'omni/x:free' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V15: Groq в 429 — форматы не крутим, а сразу падаем на OpenRouter и берём его текст',
    r.ok && r.text === 'Котёнок спит' && /openrouter\/omni/.test(r.via) && n.calls.filter((c) => /groq/.test(c.url)).length === 1, JSON.stringify({ r, calls: n.calls.length }));
  const rec = n.calls.find((c) => !/groq/.test(c.url));
  ok('V16: у OpenRouter аудио едет data-URL с форматом ogg (не opus — его он не берёт)', rec.body.messages[0].content[1].input_audio.data.indexOf('data:audio/ogg;base64,') === 0 && rec.body.messages[0].content[1].input_audio.format === 'ogg' && rec.body.model === 'omni/x:free' && rec.body.max_tokens === 900, JSON.stringify(rec.body.messages[0].content[1].input_audio).slice(0, 90));
  ok('V17: «ёлочки» от модели снимаются, а точка в конце остаётся', r.text === 'Котёнок спит', JSON.stringify(r.text));
}
{
  const n = net({ groq: [json({ error: { message: 'invalid api key Bearer gk1' } }, 401)], openrouter: [json({ error: { message: 'no credit' } }, 402)] });
  const logs = [];
  const s = createStt({ env: { GROQ_KEYS: 'gk1', OPENROUTER_KEYS: 'ork' }, fetch: n.fetchImpl, log: (...a) => logs.push(a.join(' ')) });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V18: оба источника отказали — причина собрана из обоих', r.ok === false && /groq: http 401/.test(r.why) && /openrouter: http 402/.test(r.why), JSON.stringify(r.why));
  ok('V19: в лог и в человеку не утекает наш ключ (в причинах его быть не должно)', r.why.indexOf('gk1') < 0 && r.why.indexOf('ork') < 0 && logs.join(' ').indexOf('gk1') < 0, JSON.stringify({ why: r.why.slice(0, 120), logs: logs.join('|').slice(0, 120) }));
}
{
  const n = net({ groq: [async () => new Promise(() => {})] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1', STT_TIMEOUT_MS: '5000' }, fetch: n.fetchImpl, log: () => {} });
  const t0 = Date.now();
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  const dt = Date.now() - t0;
  ok('V20: зависший источник не вешает бота — по таймауту возвращаемся с причиной', r.ok === false && /не успел/.test(r.why) && dt < 9000, JSON.stringify({ why: r.why, dt }));
}
{
  const s = createStt({ env: { GROQ_KEYS: 'gk1', OPENROUTER_KEYS: '' }, fetch: async () => json({}), log: () => {} });
  const st = s.stats();
  ok('V21: stats — флаги ключей и моделей, и ни одного секретного значения', st.on === true && st.keys.groq === true && st.keys.openrouter === false && st.maxBytes === sttLimits.MAX_AUDIO && JSON.stringify(st).indexOf('gk1') < 0, JSON.stringify(st));
  const off = createStt({ env: { STT: 'off' }, fetch: async () => json({}), log: () => {} }).stats();
  ok('V22: stats слушается выключателя STT', off.on === false && off.keys.groq === false, JSON.stringify(off));
}
{
  const n = net({ groq: [json({ text: 'одна реплика' })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1', STT_MODEL: 'other-model' }, fetch: n.fetchImpl, log: () => {} });
  await s.transcribe({ bytes: AUDIO, mime: 'audio/mpeg' });
  ok('V23: модель переключается env-ом, расширение файла берётся из mime (mp3)', n.calls[0].form.get('model') === 'other-model' && /\.mp3$/.test(n.calls[0].file.name), String(n.calls[0].file.name));
}
{
  const n = net({ groq: [json({ text: 'одна реплика' })] });
  const s = createStt({ env: { GROQ_KEYS: 'gk1' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s.transcribe({ bytes: AUDIO, mime: 'audio/unknown-mime' });
  ok('V24: неизвестный mime — не падаем, пробуем ogg', r.ok === true && /\.ogg$/.test(n.calls[0].file.name), JSON.stringify({ ok: r.ok, name: n.calls[0].file.name }));
}

{
  const n = net({ groq: [json({ text: '«Привет.»' })] });
  const s2 = createStt({ env: { GROQ_KEYS: 'gk1' }, fetch: n.fetchImpl, log: () => {} });
  const r = await s2.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V25: кавычки снимаются, а точка внутри кавычек остаётся (не режем текст)', r.ok && r.text === 'Привет.', JSON.stringify(r.text));
  const n2 = net({ groq: [json({ text: 'иногда модель пересказывает:\n\nНа аудио слышно, что человек говорит «привет».' })] });
  const s3 = createStt({ env: { GROQ_KEYS: 'gk1' }, fetch: n2.fetchImpl, log: () => {} });
  const r2 = await s3.transcribe({ bytes: AUDIO, mime: 'audio/ogg' });
  ok('V26: многострочный ответ не схлопывается в одну строку (переводы живы)', /\n/.test(r2.text) && r2.text.indexOf('  ') < 0, JSON.stringify(r2.text));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;