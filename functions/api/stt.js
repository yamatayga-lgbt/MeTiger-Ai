/**
 * POST /api/stt — голос в текст для голосового ввода в приложении.
 *
 * Зачем отдельный вход, если расшифровка уже есть в движке (engine/voicein.js):
 * там она работает для голосовых из Telegram — аудио уже лежит файлом на стороне
 * Bot API. В браузере аудио рождается на устройстве, и его надо принять сырыми
 * байтами. Никаких новых ключей и сервисов не заводим: расшифровывают те же
 * Groq и Cloudflare, что уже отвечают за чат.
 *
 * Как принимаем:
 *   · тело — сырые байты записи (MediaRecorder на телефоне даёт webm/opus, на
 *     Safari — mp4), формат берём из Content-Type, а не гадаем по имени файла;
 *   · `?lang=ru` — язык пишущего. Браузер его знает точно, а на короткой фразе
 *     автоопределение Whisper иногда уезжает в чужой язык;
 *   · потолок размера тот же, что в движке (8 МБ): это примерно час речи в opus.
 *
 * Ответ: { ok, text, provider } либо { ok: false, error } с человеческой
 * причиной. Причину отдаём как есть из движка — она уже написана без токенов.
 */
import { createStt, sttLimits } from '../../engine/voicein.js';
import { cfgOf as limitsCfg, createRateLimiter } from '../../engine/limits.js';
import { limitsStore, realClientIp, RATE_LOCAL } from './chat.js';

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Формат по заголовку. Без заголовка — webm: так пишет Chrome на телефоне. */
export function mimeOf(request) {
  const raw = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!raw || raw === 'application/octet-stream' || raw === 'application/json') return 'audio/webm';
  return raw;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  /* Тот же ограничитель частоты, что у чата, — намеренно тот же: ключ в
     хранилище один (rl:<ip>), и человек у нас один. Своя карта на стороне голоса
     дала бы два счётчика по одному ключу, которые спорят друг с другом. */
  if (env.RATE_LIMIT !== '0') {
    const rate = createRateLimiter({ store: limitsStore(env), cfg: limitsCfg(env), base: RATE_LOCAL });
    const r = await rate.check(realClientIp(request, env));
    if (r.limited) return json({ ok: false, error: 'слишком часто — подожди минуту' }, 429);
  }

  let bytes;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ ok: false, error: 'запись не прочиталась' }, 400);
  }
  if (!bytes.length) return json({ ok: false, error: 'запись пустая' }, 400);
  if (bytes.length > sttLimits.MAX_AUDIO) {
    return json({
      ok: false,
      error: `запись ${Math.round((bytes.length / 1024 / 1024) * 10) / 10} МБ — больше ${Math.round(sttLimits.MAX_AUDIO / 1024 / 1024)} МБ не расшифровываем`,
    }, 413);
  }

  const stt = createStt({ env, log: () => {} });
  const res = await stt.transcribe({ bytes, mime: mimeOf(request), lang: url.searchParams.get('lang') || '' });
  if (!res.ok) return json({ ok: false, error: res.why || 'речь не разобрал' }, 200);
  return json({ ok: true, text: res.text, provider: res.via || '' });
}

/** GET — только для проверки, что вход жив: расшифровки тут не кэшируем. */
export async function onRequestGet(context) {
  const stats = createStt({ env: context.env, log: () => {} }).stats();
  return json({ ok: true, accepts: 'POST с аудио в теле', maxBytes: sttLimits.MAX_AUDIO, sources: stats });
}
