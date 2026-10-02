/**
 * POST /api/chat — вход в двигатель (Этап 1 переноса из Yama AI).
 *
 * Pages Function: тот же движок, что и в Worker, без отдельного сервиса.
 * Ключи лежат в секретах Pages (`wrangler pages secret put`), в коде их нет.
 *
 *   { text, history?: [{ role, text }], images?: [dataUrl], provider?, temperature? }
 *   → { ok, reply, provider, model, intent, tier, ms, tried }
 *
 * Ошибку не прячем: если ни один провайдер не ответил, приходит 503 со списком
 * попыток — фронт по нему и решает, показывать моку или честное «сервис не отвечает».
 */
import { createEngine, PERSONA_SYSTEM, ensemble, vcouncil } from '../../engine/chat.js';
import * as genderLayer from '../../engine/gender.js';
import { cfgOf as limitsCfg, createQuarantine, createRateLimiter, limitsInfo } from '../../engine/limits.js';
import { createBrave } from '../../engine/brave.js';
import * as emotionLayer from '../../engine/emotion.js';
import { TOOL_IDS } from '../../engine/tools.js';
import { stats as skillStats } from '../../engine/skills.js';

/** одной строкой — сколько навыков на ходу и чем выключены (для curl-диагностики) */
function skillLine(env) {
  const s = skillStats();
  return env && env.SKILLS === 'off'
    ? 'выключены (SKILLS=off)'
    : `на ходу ${s.on} из ${s.total}` + (s.off ? ` · выключено ${s.off}: ${s.reasons.slice(0, 2).join('; ')}` : '');
}
import { createMemory } from '../../engine/memory.js';
import * as modelreg from '../../engine/modelreg.js';

/* Карантин мёртвых провайдеров держим НАД движком: движок создаётся под каждый
   запрос, а «токен не принят» и «нет баланса» за одну request'у не лечатся.
   Без этой карты каждый запрос заново стучится в закрытую дверь и отдаёт под
   это время совета — те самые секунды, которые человек ждёт ответа. */
const QUARANTINE = new Map();

const MAX_IMG_BYTES = 4 * 1024 * 1024;

/**
 * KV-адаптер памяти: Pages Function отдаёт связку MEMORY объектом с get/put/delete.
 * Читаем как 'json' (иначе normalize получил бы строку), пишем строкой — KV не
 * знает, что у нас внутри объект, и 25 МБ лимита считает по байтам.
 */
export function memoryStore(env) {
  const kv = env && env.MEMORY;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  const store = {
    get: async (key) => {
      try { return await kv.get(key, 'json'); } catch (e) { return null; }
    },
    put: async (key, value) => { await kv.put(key, JSON.stringify(value)); },
  };
  if (typeof kv.delete === 'function') store.delete = (key) => kv.delete(key);
  return store;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

/* Лимит частоты и карантин провайдеров.
   Карты живут в модуле — воркер создаётся на каждый запрос, и без общей карты
   счётчик обнулился бы в каждой request'е. Поверх них `engine/limits.js` надстраивает
   общий слой в KV: тогда «12 запросов в минуту» держится на все изоляторы, а
   наказание провайдера переживает холодный старт. Без связки MEMORY карты остаются
   единственными — ровно то поведение, что было до слоя.
   Про задержку распространения: KV консервативно-согласован (запись доходит до
   других краёв до ~60 секунд), поэтому счётчик общий, но приближённый; на окне в
   минуту и карантине в 4 минуты это не враньё, а достаточная грубость. */
const RATE_LOCAL = new Map();   /* сама карта карантина объявлена выше — она и есть общий слой между запросами */

/** KV-байндинг в форме, нужной общему слою: JSON + TTL на запись. */
export function limitsStore(env) {
  const kv = env && env.MEMORY;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  return {
    /* Форму значения отдаёт разную: настоящий KV-байндинг возвращает строку (мы
       пишем строку), а локальная заглушка из scripts/api-dev.js — уже разобранный
       объект. Разбор tolerant, иначе на локальном запуске слой читал бы null и
       поведение расходилось бы с продом. */
    get: (key) => Promise.resolve(kv.get(key)).then((raw) => {
      if (raw == null) return null;
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }, () => null),
    put: (key, value, ttlSec) => Promise.resolve(kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec })),
    delete: (key) => Promise.resolve(typeof kv.delete === 'function' ? kv.delete(key) : null),
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'нужен JSON' }, 400); }

  const text = String((body && body.text) || '').trim();
  if (!text) return json({ ok: false, error: 'пустой запрос' }, 400);
  if (text.length > 24000) return json({ ok: false, error: 'слишком длинный запрос' }, 413);

  /* Картинки: ровно столько, сколько принимает движок (две), и с потолком веса.
     Бесплатный провайдер обрезает тело запроса раньше, чем мы успеем спросить,
     а_pages function упирается в лимит запроса — лучше отказать словами сразу. */
  /* Форму data URL проверяет движок (parseDataUrl), здесь — только тип и количество:
     «длина больше 32» отрезало крошечные, но настоящие картинки и молча убивало
     весь смысл запроса «что на фото». */
  const images = Array.isArray(body.images)
    ? body.images.filter((x) => typeof x === 'string' && x.indexOf('data:') === 0)
    : [];
  if (images.length > 2) return json({ ok: false, error: 'больше двух картинок я не спрашиваю' }, 413);
  for (const im of images) {
    if (im.length * 0.74 > MAX_IMG_BYTES) return json({ ok: false, error: 'картинка тяжелее ' + Math.round(MAX_IMG_BYTES / 1024 / 1024) + ' МБ — сожми её' }, 413);
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anon';
  const limits = limitsStore(env);
  const rate = createRateLimiter({ store: limits, cfg: limitsCfg(env), base: RATE_LOCAL });
  if (env.RATE_LIMIT !== '0') {
    const r = await rate.check(ip);
    if (r.limited) {
      return json({
        ok: false,
        error: 'слишком часто — подожди минуту',
        /* видно, по общему счётчику отказ или по локальному: без этого «почему меня
           пустили в другом изоляторе» невыяснимо */
        rate: { n: r.n, max: rate.cfg.rateMax, shared: r.shared },
      }, 429);
    }
  }

  /* Чат, к которому приклеена память: свой chatId у клиента (телеграм- id
     пользователя или id беседы), иначе — общий «web». Без него память
     превратилась бы в один большой общий котёл. */
  const chatId = String(body.chatId || request.headers.get('x-mt-chat') || 'web').slice(0, 80);
  const store = memoryStore(env);
  /* Каталог моделей — до движка: без этого на холодном изоляте выбор модели из
     каталога снимается молча, и человек получает ответ не той модели. */
  await modelreg.warm(env, store, context.waitUntil);
  const memory = store ? createMemory({ store, env }) : null;
  if (memory && body.forget === true) {
    await memory.forget(chatId);
    return json({ ok: true, forgotten: true, chatId, memory: await memory.stats(chatId) });
  }
  const quarantine = createQuarantine({ store: limits, cfg: limitsCfg(env), base: QUARANTINE });
  await quarantine.pull();
  /* Рейтинг смелых — тот же KV, другой ключ. Читаем до движка (порядок моделей
     нужен на этом же запросе), пишем после ответа и не чаще раза в минуту. */
  const brave = createBrave({ env, store });
  await brave.pull();
  const engine = createEngine({ env, fetch: (u, i) => fetch(u, i), quarantine, memory, brave });
  const history = Array.isArray(body.history)
    ? body.history.slice(-8).filter((m) => m && m.text).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 4000) }))
    : [];

  const r = await engine.run({
    text, history,
    chatId: memory ? chatId : undefined,
    images,
    tier: body.tier === 'fast' || body.tier === 'smart' ? body.tier : undefined,
    only: body.provider || undefined,
    /* Человек выбрал модель в окне ввода — она и отвечает. Советы голов в этом
       режиме выключены: «взято большинство» переписало бы ответ той самой модели,
       которую человек и просил. */
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    noCouncils: !!(typeof body.model === 'string' && body.model.trim()),
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    system: typeof body.system === 'string' && body.system ? body.system : PERSONA_SYSTEM,
    /* Род агента — настройка человека из приложения (Авто/М/Ж). Сюда идёт pick(), а
       не normalize(): распознанное значение едет в движок, пустое и мусорное — не
       едет вовсе, и тогда работает AGENT_GENDER развертывания. С normalize() поле
       «не прислано» превращалось в явное `auto` и затырало настройку сервера у
       каждого, кто про поле не знает (Telegram, curl, старые клиенты). */
    gender: genderLayer.pick(body.gender),
    deadlineMs: Number(env.CHAT_DEADLINE_MS || 50000),
  });

  /* Наказания, набранные в этом ответе, уходят в общее хранилище уже после того,
     как человек получил свой текст: одна запись не должна добавлять ему секунд. */
  const after = () => Promise.all([
    quarantine.flush().catch(() => null),
    brave.flush().catch(() => null),
  ]).then(() => null);
  if (context.waitUntil) { try { context.waitUntil(after()); } catch (e) { await after(); } } else { await after(); }

  if (!r.ok) return json({ ok: false, error: r.error, intent: r.intent, tier: r.tier, ms: r.ms, tried: r.tried.slice(0, 10) }, 503);
  return json({
    ok: true, reply: r.reply, reasoning: r.reasoning || '',
    provider: r.provider, model: r.model, intent: r.intent, tier: r.tier, ms: r.ms,
    /* выбранная модель не смогла ответить — фронт подписывает это словами,
       чтобы «я выбрал X, а ответил Y» не выглядело поломкой выбора */
    pinned: r.pinned, pinMiss: !!r.pinMiss,
    /* Как ответили — родом и (по желанию) наблюдением о состоянии собеседника.
       Фронт показывает род в подписи, emotion — только если включён EMOTION_LABEL. */
    gender: r.gender, emotion: r.emotion || undefined,
    /* Какие инструменты реально накормили ответ — видно в подписи под пузырём. */
    tools: r.tools || [],
    /* навыки (engine/skills.js): чем именно модель себя правила на этом вопросе, и
       что человек может проверить сам — тот же curl покажет список, а не догадку */
    skills: (r.skills || []).map((s) => s.title),
    skillsOn: (r.skills || []).map((s) => s.id),
    /* файлы, которые модель оформила блоком ```file:…``` — б64 кладём прямо в ответ:
       своего хранилища под выдачу нет, а 512 КБ — потолок одного файла */
    files: r.files || [],
    reframed: !!r.reframed,
    freedomCleaned: !!r.freedomCleaned,
    tried: r.tried.slice(0, 6),
    /* Советы голов (Этап 2) — строками, чтобы их было видно из фронтенда и из curl:
       «сошлись 2/3 (groq,cloudflare)» и «confirmed 3/3» означают, что факт проверен
       большинством; «пропущено: …» — что проверка не настроена или не к месту.
       Пустая строка — молчание контура, а оно в проде неотличимо от поломки (урок
       Yama 1.0.227: ансамбль «не работал» ровно потому, что молчал). */
    /* что памяти реально наросло — чтобы «он забыл» можно было проверить, а не угадывать */
    memory: r.memory || (memory ? null : { on: false, why: 'хранилище не подключено (нет связки MEMORY)' }),
    ensemble: r.ensemble ? ensemble.lineOf(r.ensemble) + (r.ensembleApplied ? ' → взято большинство' : '')
      : (r.ensembleSkip ? 'пропущено: ' + r.ensembleSkip : ''),
    vision: r.vision ? vcouncil.visionLine(r.vision) + (r.visionApplied ? ' → взято большинство' : '')
      : (r.visionSkip ? 'пропущено: ' + r.visionSkip : ''),
  });
}

export async function onRequestGet(context) {
  const engine = createEngine({ env: context.env, fetch: (u, i) => fetch(u, i), quarantine: QUARANTINE });
  return json({
    ok: true, alive: engine.alive(), providers: Object.keys(engine.providers).length,
    /* как отвечаем по умолчанию — человек видит это одним curl, не читая код */
    /* чем именно движок считает мёртвым — чтобы не гадать по логам */
    limits: limitsInfo(context.env, limitsStore(context.env)),
    gender: genderLayer.label(context.env && context.env.AGENT_GENDER),
    emotion: emotionLayer.stats(context.env).on
      ? 'включён · ' + (emotionLayer.stats(context.env).label ? 'метка в ответе' : 'метка выключена')
      : 'выключен (EMOTION=0)',
    tools: TOOL_IDS(),
    skills: skillLine(context.env),
    /* чем именно движок считает мёртвым — чтобы не гадать по логам */
    dead: engine.quarantine(),
  });
}
