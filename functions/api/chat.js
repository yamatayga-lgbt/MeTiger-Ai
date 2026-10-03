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

/** Чем читаем вложения веб-чата — одной строкой для curl-диагностики. */
function attachLine(env) {
  const e = env || {};
  const on = String(e.ATTACH || '') !== 'off';
  const stt = createStt({ env: e, fetch: () => Promise.reject(new Error('диагностика сеть не трогает')), log: () => {} }).stats();
  const chars = Math.max(2000, Number(e.ATTACH_DOC_CHARS) || DOC_CHARS);
  return (on ? 'вложения включены' : 'выключены (ATTACH=off)')
    + ' · до ' + ATT_MAX + ' файлов по ' + mb(ATT_FILE_BYTES) + ' МБ · потолок запроса ' + mb(ATT_TOTAL_BYTES) + ' МБ'
    + ' · файла показываем ' + chars + ' знаков'
    + ' · голос: ' + (!stt.on ? 'выключен (STT=off)' : (stt.keys.groq || stt.keys.openrouter ? (stt.models.groq || stt.models.omni) : 'нет ключей'));
}

/** одной строкой — сколько навыков на ходу и чем выключены (для curl-диагностики) */
function skillLine(env, imgReady) {
  const s = skillStats({ imgToolReady: { imggen: !!imgReady } });
  return env && env.SKILLS === 'off'
    ? 'выключены (SKILLS=off)'
    : `на ходу ${s.on} из ${s.total}` + (s.off ? ` · выключено ${s.off}: ${s.reasons.slice(0, 2).join('; ')}` : '');
}
import { createMemory } from '../../engine/memory.js';
import * as modelreg from '../../engine/modelreg.js';
import { lineOf as imgLineOf } from '../../engine/imggen.js';
import { normalizeFields, stats as ctxStats } from '../../engine/ctxfit.js';
import { createProfile, memoryKey, sanitizeUserId } from '../../engine/profile.js';
import { compose as composeAttach, readDocBytes, readVoiceBytes, DOC_CHARS, IMAGE_NAME, sniffImageMime } from '../../engine/attach.js';
import { createStt } from '../../engine/voicein.js';

/* Карантин мёртвых провайдеров держим НАД движком: движок создаётся под каждый
   запрос, а «токен не принят» и «нет баланса» за одну request'у не лечатся.
   Без этой карты каждый запрос заново стучится в закрытую дверь и отдаёт под
   это время совета — те самые секунды, которые человек ждёт ответа. */
const QUARANTINE = new Map();

const MAX_IMG_BYTES = 4 * 1024 * 1024;

/* Вложения из браузера. Своего хранилища нет — файл приходит base64-ом в теле
   запроса и живёт ровно столько, пока движок его читает. Поэтому потолки жёсткие:
   3 файла, 4 МБ на файл, 8 МБ на весь запрос. Base64 раздувает тело на ~33%, а
   Pages Function обрезает запрос раньше, чем мы успеем что-нибудь прочитать, —
   отказ словами здесь дешевле, чем молчаливый огрызок. */
const ATT_MAX = 3;
const ATT_FILE_BYTES = 4 * 1024 * 1024;
const ATT_TOTAL_BYTES = 8 * 1024 * 1024;

/** base64 (голый или data:URL) → Uint8Array. Мусор — null, а не исключение. */
function fromB64(s) {
  const raw = String(s || '').replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (!raw || raw.length % 4 > 2) return null;
  let bin = '';
  try { bin = atob(raw); } catch (e) { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const mb = (n) => Math.round((n / 1048576) * 10) / 10;

/**
 * Что человек приложил в веб-чате → тот же вид, что отдаёт Telegram-слой
 * (engine/attach.js): картинки отдельным полем, файлы — текстовыми блоками,
 * голос — расшифровкой. Читалка и распознавание общие, разной может быть только
 * сеть, а её здесь нет: байты уже в теле запроса.
 */
export async function readAttachments(list, env, fetchImpl, log) {
  const got = { images: [], docs: [], voiceText: '', notes: [], tried: 0 };
  const all = Array.isArray(list) ? list : [];
  if (!all.length) return got;
  const chars = Math.max(2000, Number(env.ATTACH_DOC_CHARS) || DOC_CHARS);
  let total = 0;
  let skipped = 0;
  const stt = String(env.STT || '') === 'off' ? null : createStt({ env, fetch: fetchImpl, log });
  for (const a of all.slice(0, ATT_MAX)) {
    const name = String((a && a.name) || 'файл').slice(0, 120);
    const mime = String((a && a.mime) || '').toLowerCase();
    const bytes = fromB64(a && (a.b64 || a.data));
    if (!bytes || !bytes.length) { got.notes.push(name + ': приложение не распознано (не base64)'); continue; }
    if (bytes.length > ATT_FILE_BYTES) { got.notes.push(name + ': ' + mb(bytes.length) + ' МБ — больше ' + mb(ATT_FILE_BYTES) + ' МБ не читаем'); continue; }
    if (total + bytes.length > ATT_TOTAL_BYTES) { got.notes.push(name + ': вложений на ' + mb(total + bytes.length) + ' МБ — потолок запроса ' + mb(ATT_TOTAL_BYTES) + ' МБ'); continue; }
    total += bytes.length;
    got.tried++;
    /* Картинка — по MIME, по имени или по первым байтам. Правило имени живёт в
       engine/attach.js и общее с Telegram: если слои разойдутся, фото начнёт работать
       в боте и молча ломаться в веб-чате (или наоборот) — это уже чинили. */
    const sniffed = sniffImageMime(bytes);
    if (/^image\//.test(mime) || IMAGE_NAME.test(name) || sniffed) {
      const real = /^image\//.test(mime) ? mime : sniffed;
      if (!real) {
        got.notes.push(name + ': не похоже на картинку, которую модель разглядит (нужны png/jpeg/webp/gif/bmp)');
        continue;
      }
      if (/^image\/(heic|heif|tiff?|avif|svg\+xml)$/i.test(real)) {
        got.notes.push(name + ': формат ' + real.slice(6).toUpperCase() + ' модель не читает — пришлите JPEG или PNG');
        continue;
      }
      got.images.push('data:' + real + ';base64,' + b64of(bytes));
      continue;
    }
    const isVoice = a.kind === 'voice' || a.kind === 'audio' || /^audio\//.test(mime);
    if (isVoice) {
      const v = await readVoiceBytes(bytes, mime || 'audio/ogg', { stt, log });
      if (v.ok) got.voiceText = v.text;
      else got.notes.push('запись не расшифрована: ' + v.why + (v.via ? ' [' + v.via + ']' : ''));
      continue;
    }
    got.docs.push(readDocBytes(bytes, name, { chars }));
  }
  if (all.length > ATT_MAX) got.notes.push('файлов ' + all.length + ' — читаю первые ' + ATT_MAX);
  void skipped;
  return got;
}

/** Uint8Array → base64 чанками: one-shot fromCharCode на 4 МБ кладёт стек. */
function b64of(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

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

  const words = String((body && body.text) || '').trim();
  if (words.length > 24000) return json({ ok: false, error: 'слишком длинный запрос' }, 413);

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

  /* Документы, голос и картинки, приложенные в браузере (engine/attach.js). Их
     читаем ДО нормализации полей: текст файла становится частью запроса, и потолок
     на длину запроса обязан считаться уже по собранному тексту, а не по словам
     человека. Ничего не прочитано и слов нет — отказ 422 со списком причин: слать
     движку «посмотри, что я прислал», когда смотреть нечего, значит тратить квоту
     бесплатной модели на извинение. */
  const hasAtt = Array.isArray(body.attachments) && body.attachments.length > 0;
  const att = hasAtt ? await readAttachments(body.attachments, env, (u, i) => fetch(u, i), () => {}) : null;
  const attNothing = !!att && !att.images.length && !att.voiceText && !att.docs.some((d) => d.ok);
  if (!words && att && attNothing) {
    return json({ ok: false, error: 'не прочитал ни одного вложения', attachNotes: att.notes }, 422);
  }
  const text = att ? composeAttach({ has: true }, att, words).text : words;
  if (!text) return json({ ok: false, error: 'пустой запрос' }, 400);
  const allImages = images.concat((att && att.images) || []);
  if (allImages.length > 2) allImages.length = 2;

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

  /* Чат, к которому приклеена память. Раньше адрес брался из канала: у телеграма
     свой id беседы, а у всего веба — ОДИН общий «web», то есть у незнакомых людей
     была одна память на всех (чужие факты, чужие предпочтения). Теперь адрес
     выводится из человека: `userId` из приложения (или id чата в Telegram, где он
     и так личный — его не переименовываем, чтобы не потерять накопленное). */
  /* Поля запроса в безопасный вид (engine/ctxfit.js): «system» от клиента не
     должен иметь возможности прислать мегабайт текста, temperature — улететь за
     разумный диапазон, а история — притащить пустые реплики. Что пришлось
     поправить — возвращается словами, а не молча. */
  const norm = normalizeFields(Object.assign({}, body, { text }), context.env);
  const userId = sanitizeUserId(body.userId)
    || (/^tg_[0-9]{3,}$/.test(String(norm.chatId || '')) ? norm.chatId : '');
  const chatId = memoryKey(userId, norm.chatId || String(request.headers.get('x-mt-chat') || 'web').slice(0, 80));
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
  const history = norm.history;
  /* Профиль — то, что человек написал о себе сам в Настройках. Читается один раз на
     запрос и не имеет права его сломать: нет KV, нет сети — ответ выходит обычный,
     просто без персонализации. */
  let profileBlock = '';
  let profileWhy = '';
  if (userId) {
    try {
      const got = await createProfile({ env, store, log: (k, m, x) => console.log(k, m, String(x || '').slice(0, 120)) }).get(userId);
      if (got && got.ok) { profileBlock = String(got.block || ''); profileWhy = got.why || ''; }
      else profileWhy = (got && got.why) || 'профиль не читается';
    } catch (e) {
      profileWhy = String((e && e.message) || e).slice(0, 120);
    }
  }

  const r = await engine.run({
    /* нормализованные поля, а не сырые из тела: иначе потолок из env на «system»
       и «text» был бы просто украшением, а provider с путью дошёл бы до выбора */
    text: norm.text || text, history,
    chatId: memory ? chatId : undefined,
    images: allImages,
    tier: body.tier === 'fast' || body.tier === 'smart' ? body.tier : undefined,
    only: norm.provider,
    /* Человек выбрал модель в окне ввода — она и отвечает. Советы голов в этом
       режиме выключены: «взято большинство» переписало бы ответ той самой модели,
       которую человек и просил. */
    model: norm.model || undefined,
    noCouncils: !!norm.model,
    temperature: norm.temperature,
    system: norm.system || PERSONA_SYSTEM,
    /* Род агента — настройка человека из приложения (Авто/М/Ж). Сюда идёт pick(), а
       не normalize(): распознанное значение едет в движок, пустое и мусорное — не
       едет вовсе, и тогда работает AGENT_GENDER развертывания. С normalize() поле
       «не прислано» превращалось в явное `auto` и затырало настройку сервера у
       каждого, кто про поле не знает (Telegram, curl, старые клиенты). */
    gender: genderLayer.pick(body.gender),
    /* Блок профиля уходит в system после персоны и до резки окна (см. engine/chat.js):
       его же читают и головы совета — у них входа отдельно от ctx.system нет. */
    profile: profileBlock || undefined,
    deadlineMs: Number(env.CHAT_DEADLINE_MS || 50000),
  });

  /* Наказания, набранные в этом ответе, уходят в общее хранилище уже после того,
     как человек получил свой текст: одна запись не должна добавлять ему секунд. */
  const after = () => Promise.all([
    quarantine.flush().catch(() => null),
    brave.flush().catch(() => null),
  ]).then(() => null);
  if (context.waitUntil) { try { context.waitUntil(after()); } catch (e) { await after(); } } else { await after(); }

  if (!r.ok) {
    /* «провайдеры легли» и «картинку некому разглядеть» — разные беды: во втором
       случае повторять запрос бессмысленно, надо менять вложение или снимает пин. */
    const blind = allImages.length > 0 && r.tried.length > 0
      && r.tried.every((t) => /читает картинки/.test(String((t && t.why) || '')));
    return json({
      ok: false,
      error: blind
        ? 'ни одна доступная модель не читает картинки: в пулах нет зрячей — попробуйте позже, снимите пин модели или задайте вопрос текстом'
        : r.error,
      intent: r.intent, tier: r.tier, ms: r.ms, tried: r.tried.slice(0, 10),
      blindVision: blind ? true : undefined,
    }, blind ? 422 : 503);
  }
  return json({
    /* заметки нормализации входа и то, что движок подогнал под окно модели:
       «я тебе ответил иначе, потому что ты прислал» должно быть видно, а не молчать */
    /* куда легла память этого человека — по строке видно, что веб больше не общий
       котёл: 'u-ab12…' значит «память этого человека», 'web' — ключ не пришёл */
    memoryChatId: chatId,
    profile: userId ? (profileBlock ? 'учтён' : 'пусто') : 'нет идентификатора' + (profileWhy ? ' · ' + profileWhy : ''),
    inputNotes: norm.notes.length ? norm.notes : undefined,
    ctxFit: r.cxFit || undefined,
    /* чем обернулись приложенные файлы: что прочитано (имя · формат · знаков) и почему
       остальное не дошло — человек должен видеть это под ответом, а не в логах */
    attachments: att && att.docs.length
      ? att.docs.map((d) => ({ name: d.name, ok: !!d.ok, line: d.ok ? d.line : (d.why || 'не прочитан') }))
      : undefined,
    attachNotes: att && att.notes.length ? att.notes : undefined,
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
    /* каким каналом сделана картинка этого ответа — по нему видно, живой ли источник
       сегодня отвечает, а не числится ли по наличию ключа */
    imgSource: r.imgSource || undefined,
    /* почему файл или картинка не вышли — строкой, чтобы фронт и curl
       видели причину, а не пустой список файлов */
    fileError: r.fileError || undefined,
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
    skills: skillLine(context.env, engine.img().sources.some((x) => x.ready)),
    /* чем именно картинки делаются сегодня: без этой строки человек гадает,
       почему «нарисуй» отвечает текстом */
    imggen: imgLineOf(engine.img()),
    /* подгонка под окно модели: видно, какое окно считаем и включена ли резка */
    ctx: ctxStats(context.env).line,
    /* профиль и адрес памяти: чем/personой храним и что умеем подставлять в промпт */
    profile: (() => {
      const st = createProfile({ env: context.env, store: memoryStore(context.env) }).stats();
      return (st.on ? 'профили включены' : 'профили выключены (PROFILE=off)')
        + ' · ' + (st.store ? 'связка KV есть' : 'связки KV нет — сохранять некуда')
        + ' · поля имя/профессия/о себе до ' + st.caps.name + '/' + st.caps.job + '/' + st.caps.about + ' знаков'
        + ' · запись не чаще раза в ' + st.writeMs + ' мс';
    })(),
    /* чем читаем приложенное из браузера: лимиты и есть ли чем распознавать голос */
    attach: attachLine(context.env),
    /* чем именно движок считает мёртвым — чтобы не гадать по логам */
    dead: engine.quarantine(),
  });
}
