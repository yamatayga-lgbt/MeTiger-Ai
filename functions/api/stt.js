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
import { limitsStore, realClientIp } from './chat.js';

/*
 * Своя карта частоты и свой потолок — в отличие от 0.104, когда счёт был общим с
 * чатом. Причина поменялась вместе с устройством ввода: уточнение «на лету»
 * отправляет кусок каждые четыре секунды, то есть одна диктовка — это десяток
 * запросов. Общий счётчик в 12 запросов в минуту съедался бы речью, и человек
 * получал бы «слишком часто» на первом же длинном сообщении, ещё даже не отправив
 * его. Голос и текст считаются порознь; оба потолка настоящие.
 */
const RATE_LOCAL = new Map();
const STT_RATE_DEFAULT = 30;

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

  /* Ограничитель частоты — как у чата, но с СВОИМ потолком (STT_RATE_MAX, 30 по
     умолчанию): уточнение на лету шлёт кусок каждые четыре секунды, и общий
     потолок в 12 запросов в минуту съедался бы речью — человек получал бы
     «слишком часто» на первом же длинном сообщении. */
  if (env.RATE_LIMIT !== '0') {
    const cfg = limitsCfg(env);
    const max = Math.max(1, Number(env.STT_RATE_MAX) || STT_RATE_DEFAULT);
    /* Потолок поднимаем только здесь: окно и запись в хранилище берём те же —
       иначе получились бы две несовместимые политики на одних и тех же ключах. */
    const rate = createRateLimiter({ store: limitsStore(env), cfg: { ...cfg, rateMax: max }, base: RATE_LOCAL });
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
  /* ?via=groq|cloudflare|openrouter — служебная проверка одного источника. Без неё
     запасной путь нельзя подтвердить живьём, пока первый отвечает: остаётся
     «написано и покрыто заглушками», а это не проверка. */
  const via = String(url.searchParams.get('via') || '').toLowerCase();
  const res = await stt.transcribe({
    bytes,
    mime: mimeOf(request),
    lang: url.searchParams.get('lang') || '',
    /* prev — хвост уже сказанного: с ним соседние куски диктовки держат нить. */
    prev: url.searchParams.get('prev') || '',
    via: ['groq', 'cloudflare', 'openrouter'].includes(via) ? via : '',
  });
  if (!res.ok) return json({ ok: false, error: res.why || 'речь не разобрал' }, 200);
  return json({ ok: true, text: res.text, provider: res.via || '' });
}

/** GET — только для проверки, что вход жив: расшифровки тут не кэшируем. */
export async function onRequestGet(context) {
  const stats = createStt({ env: context.env, log: () => {} }).stats();
  return json({ ok: true, accepts: 'POST с аудио в теле', maxBytes: sttLimits.MAX_AUDIO, sources: stats });
}
