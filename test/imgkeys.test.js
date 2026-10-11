/**
 * 0.169: картинки не сдаются на одном ключе и одном имени модели.
 *
 * Повод самый прямой: новый дымовой тест (0.167) на живом проде получил на просьбу
 * «нарисуй картинку» текст вместо картинки. Разбор показал три причины сразу:
 * у Gemini кончилась квота ПЕРВОГО ключа (остальные не проверялись), у odirouter
 * имя модели изменилось (model_not_found), а Pollinations честно упёрся в лимит.
 * Два из трёх — наши: ключей обычно несколько, и имя модели прописано одно.
 *
 *   node test/imgkeys.test.js
 */
import assert from 'node:assert/strict';
import { createImggen, humanWhy, packImages } from '../engine/imggen.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

/* Слой отбрасывает «картинки» короче 256 байт — заглушка обязана быть правдоподобной,
   иначе тест проверяет отказ, а не работу. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);
const b64 = PNG.toString('base64');

/** fetch-заглушка: смотрит на ключ и имя модели, ведёт счёт обращений. */
function mkFetch(opts) {
  const calls = [];
  const f = async (url, init) => {
    const u = String(url);
    const body = init && init.body ? JSON.parse(init.body) : {};
    const key = (init && init.headers && (init.headers['x-goog-api-key'] || init.headers.authorization)) || '';
    calls.push({ u, key, model: body.model, body });
    if (u.includes('generativelanguage.googleapis.com')) {
      if (opts.gemQuotaKeys && opts.gemQuotaKeys.some((k) => key.includes(k))) {
        return { ok: false, status: 429, text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } }) };
      }
      const parts = [{ inlineData: { mimeType: 'image/png', data: b64 } }];
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts } }] }) };
    }
    if (u.includes('odirouter')) {
      if (opts.odiDeadModels && opts.odiDeadModels.includes(body.model)) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 'model_not_found', message: 'model not found' } }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: b64 }] }) };
    }
    return { ok: false, status: 402, text: async () => '{}' };
  };
  f.calls = calls;
  return f;
}

console.log('\nI — ключи и имена моделей у картинок (0.169)');

/* ── GEMINI: перебор ключей ──────────────────────────────────────────────── */
{
  const env = { GEMINI_KEYS: 'k1,k2,k3' };
  const fetchImpl = mkFetch({ gemQuotaKeys: ['k1', 'k2'] });
  const layer = createImggen({ env, fetch: fetchImpl, store: null });
  const r = await layer.generate({ prompt: 'кот', size: '1024x576' });
  ok('I1: квота на первом и втором ключе — картинка всё равно выходит на третьем',
    r.ok && r.source === 'gemini', JSON.stringify({ ok: r.ok, why: r.why }));
  ok('I2: перебор пошёл именно по ключам, а не по одному адресу',
    fetchImpl.calls.filter((c) => c.u.includes('generativelanguage')).length === 3,
    fetchImpl.calls.map((c) => c.key).join(' | '));

  /* Второй вызов в том же изоляте — начинаем с рабочего ключа: лишних попыток нет. */
  const before = fetchImpl.calls.length;
  const r2 = await layer.generate({ prompt: 'кот снова' });
  const after = fetchImpl.calls.slice(before);
  ok('I3: запомнили рабочий ключ — второй раз укладываемся в один запрос',
    r2.ok && after.filter((c) => c.u.includes('generativelanguage')).length === 1,
    after.map((c) => c.key).join(' | '));
}

{
  /* Когда в лимите все ключи — причина называет их число: по ней видно масштаб. */
  const fetchImpl = mkFetch({ gemQuotaKeys: ['k1', 'k2'] });
  const layer = createImggen({ env: { GEMINI_KEYS: 'k1,k2', ODIROUTER_KEYS: '' }, fetch: fetchImpl, store: null });
  const r = await layer.generate({ prompt: 'кот' });
  ok('I4: все ключи в лимите — отказ говорит, сколько ключей проверено, а не «429» без числа',
    !r.ok && /проверено ключей: 2/.test(String(r.why)), String(r.why));
}

/* ── ODIRouter: перебор имён моделей ─────────────────────────────────────── */
{
  const fetchImpl = mkFetch({ odiDeadModels: ['free-gpt-image-2'] });
  const layer = createImggen({ env: { ODIROUTER_KEYS: 'o1' }, fetch: fetchImpl, store: null });
  const r = await layer.generate({ prompt: 'кот' });
  const tries = fetchImpl.calls.filter((c) => c.u.includes('odirouter'));
  ok('I5: «нет такой модели» на первом имени — берём следующее, а не сдаёмся',
    r.ok && tries.length >= 2 && tries[0].model === 'free-gpt-image-2' && tries[1].model !== 'free-gpt-image-2',
    tries.map((c) => c.model).join(' | '));

  /* Имя из окружения — первым: если владелец прописал рабочее, до кандидатов не дойдёт. */
  const f2 = mkFetch({});
  const l2 = createImggen({ env: { ODIROUTER_KEYS: 'o1', IMGGEN_ODI_MODEL: 'моё-имя' }, fetch: f2, store: null });
  const r2 = await l2.generate({ prompt: 'кот' });
  ok('I6: имя из окружения пробуется первым — кандидаты только запас',
    r2.ok && f2.calls.filter((c) => c.u.includes('odirouter'))[0].model === 'моё-имя',
    f2.calls.map((c) => c.model).join(' | '));
}

{
  /* Настоящая ошибка канала (не «нет модели») не должна превращаться в перебор:
     пять запросов подряд в лежащий шлюз — это минуты ожидания человеку. */
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'upstream down' } }) };
  };
  const layer = createImggen({ env: { ODIROUTER_KEYS: 'o1' }, fetch: fetchImpl, store: null });
  const r = await layer.generate({ prompt: 'кот' });
  ok('I7: сбой канала не перебирается пятью именами — одна попытка и честный отказ',
    !r.ok && calls.filter((u) => u.includes('odirouter')).length === 1, calls.length + ' запросов');
}

/* ── Причина отказа — человеку, сырая — рядом ────────────────────────────── */
{
  ok('I8: лимит называется словами, техническая строка остаётся в скобках',
    humanWhy('gemini: RESOURCE_EXHAUSTED You exceeded your current quota') === 'у бесплатных источников кончился лимит на сегодня — попробуйте позже'
      && humanWhy('odirouter: model_not_found') === 'источник больше не знает такой модели'
      && humanWhy('pollinations: http 402') === 'у бесплатных источников кончился лимит на сегодня — попробуйте позже',
    [humanWhy('odirouter: model_not_found'), humanWhy('x: timeout')].join(' | '));
  const r = await packImages('', {
    generate: async () => ({ ok: false, why: 'gemini: RESOURCE_EXHAUSTED You exceeded your current quota, please check your plan' }),
    wanted: true, text: 'нарисуй кота',
  });
  ok('I9: в тексте отказа — человеческая фраза и сырая причина в скобках',
    /не вышла: у бесплатных источников кончился лимит/.test(r.reply) && /\(gemini: RESOURCE_EXHAUSTED/.test(r.reply),
    JSON.stringify(r.reply.slice(0, 160)));
}

console.log(`\nкартинки: ${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
