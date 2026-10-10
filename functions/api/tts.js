/**
 * POST /api/tts — ответы вслух для приложения.
 *
 * Зачем отдельный вход, если озвучка живёт в движке (engine/voiceout.js): движок —
 * это протокол и текст, а вход — про то, что видит человек: потолок длины, частота
 * запросов, понятная причина отказа и готовый mp3 одним ответом. Ключей и настроек
 * тут нет ни одного: голос берётся у бесплатной службы Microsoft (движок «читать
 * вслух»), поэтому этот вход нельзя «сломать» отсутствием секрета.
 *
 * Тело: { text, gender?: 'male' | 'female', voice?: '...', language?: BCP-47 }.
 * Ответ: аудио (audio/mpeg) либо { ok: false, error } с человеческой причиной.
 *
 * Почему не отдаём потоком: mp3 весит десятки килобайт на фразу, и собрать его
 * целиком дешевле, чем городить потоковую передачу. Плеер на клиенте играет
 * готовый файл и умеет останавливаться.
 */
import { synthesize, speechText, pickVoice, clampSpeech, languageTag, TTS_LIMITS } from '../../engine/voiceout.js';
import { cfgOf as limitsCfg, createRateLimiter } from '../../engine/limits.js';
import { limitsStore, realClientIp } from './chat.js';

/* Своя карта частоты: голос — это отдельное действие, и человек вправе озвучить
   несколько ответов подряд, пока не съел потолок чата. */
const RATE_LOCAL = new Map();
const TTS_RATE_DEFAULT = 20;

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Сколько знаков принимаем: потолок движка, но его можно ужать настройкой. */
export function textLimit(env) {
  const n = Number((env && env.TTS_MAX_CHARS) || 0);
  return n > 0 ? Math.min(n, 8000) : TTS_LIMITS.MAX_CHARS;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  /* ?text=1 — «дай устную форму, говорить буду сам». Нужен запасному пути на
     клиенте (речь устройства): разбор формул и разметки живёт в движке, и
     держать его вторую копию в браузере незачем. */
  if (url.searchParams.get('text') === '1') {
    let body = null;
    try { body = await request.json(); } catch { /* ниже отдадим причину */ }
    const t = String((body && body.text) || '');
    if (!t.trim()) return json({ ok: false, error: 'нечего читать' }, 400);
    const { text: forVoice } = clampSpeech(speechText(t), textLimit(env));
    const language = languageTag(forVoice, body && body.language);
    return json({ ok: true, speech: forVoice, language });
  }
  if (env.RATE_LIMIT !== '0') {
    const cfg = limitsCfg(env);
    const max = Math.max(1, Number(env.TTS_RATE_MAX) || TTS_RATE_DEFAULT);
    const rate = createRateLimiter({ store: limitsStore(env), cfg: { ...cfg, rateMax: max }, base: RATE_LOCAL });
    const r = await rate.check(realClientIp(request, env));
    if (r.limited) return json({ ok: false, error: 'слишком часто — подожди минуту' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'не разобрал запрос' }, 400);
  }
  const text = String((body && body.text) || '');
  if (!text.trim()) return json({ ok: false, error: 'нечего читать' }, 400);
  const limit = textLimit(env);
  if (text.length > limit) {
    return json({ ok: false, error: `текст длиннее ${limit} знаков — озвучиваю началом ответа` }, 413);
  }

  const gender = body && body.gender === 'male' ? 'male' : 'female';
  const language = String((body && body.language) || '');
  const voice = (body && String(body.voice || '')) || pickVoice(text, gender, language);
  /* ?debug=1 — служебный разбор: сколько кадров пришло и что в них было. Нужен,
     чтобы отличать «служба молчит» от «кадры пришли, но разобрались как чужие». */
  const debug = url.searchParams.get('debug') === '1';
  const res = await synthesize(text, { voice, gender, language, env, debug });
  if (!res.ok) {
    /* 200 с причиной, а не 5xx: это не сбой нашего входа, а «голос сейчас не
       ответил», и клиенту по этой причине надо перейти на речь устройства.
       С ?debug=1 причина едет вместе с разбором кадров (иначе разбор некуда девать). */
    const отказ = { ok: false, error: res.why || 'голос не ответил' };
    if (debug && res.debug) отказ.debug = res.debug;
    return json(отказ, 200);
  }
  const bytes = res.audio;
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.length),
      /* Голос по одному и тому же тексту одинаковый, поэтому кэш уместен: повторное
         «озвучить» не дёргает службу и звучит мгновенно. */
      'cache-control': 'private, max-age=3600',
      'x-tts-voice': res.voice,
      'x-tts-chars': String(res.chars || 0),
      'x-tts-cut': res.cut ? '1' : '0',
    },
  });
}

/** GET — проверка входа и подсказка клиенту: что принимаем и каким голосом говорим. */
export async function onRequestGet(context) {
  const env = (context && context.env) || {};
  return json({
    ok: true,
    accepts: 'POST { text, gender, language? }',
    maxChars: textLimit(env),
    voices: { ru: ['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural'], en: ['en-US-AndrewNeural', 'en-US-AriaNeural'] },
    example: speechText('\\(\\sqrt{2}\\) — иррациональное число.'),
  });
}
