/**
 * 💾 Память чата — порт `memory.js` из Yama AI (1.0.228) на хранилище Cloudflare.
 *
 * Что это даёт: разговор перестаёт быть серией независимых запросов. Сводка
 * прошлого, факты о человеке, выученные уроки и профиль подстройки (attune)
 * доезжают до модели в системном промпте, а не живут в памяти браузера.
 *
 * Чем порт отличается от донора — и почему:
 *   • ни `fs`, ни `process.env`, ни `setTimeout` на фон: в Worker/File-Function
 *     нельзя рассчитывать, что таймер доживёт до следующей request'ы. Хранилище
 *     приходит снаружи объектом `{ get, put, delete? }` (KV подходит как есть,
 *     для D1 будет такой же адаптер);
 *   • в нормализованной записи НЕТ полей рода/ориентации/эмоционального
 *     состояния и «стилей» — это персонажные слои Yama, они в MeTiger не
 *     переносятся без отдельного слова владельца;
 *   • запись читается ОДИН раз на ключ: одновременные запросы одного чата ждут
 *     одно и то же обещание, а не плодят гонку «кто кого перезапишет» (у донора
 *     за это отвечал `restoreQueued`, здесь — `loading`).
 *
 * Всё, что связано с памятью, не имеет права сломать ответ: наружу идут
 * пустые блоки и `lastError`, а не исключение.
 */

import { readIntent, readReaction, directivesFrom, buildAttunePrompt, resolveIntent } from './attune.js';
import { kvKey } from './kvkey.js';

export const LIMITS = {
  hot: 40,          // сколько последних реплик отдаются целиком
  compactAt: 120,   // когда пора сжимать
  keepAfter: 30,    // сколько оставить после сжатия
  factsMax: 40,
  lessonsMax: 6,
  prefsMax: 12,
  goalsMax: 12,
  msgChars: 20000,
  factChars: 300,
  cacheMax: 60,     // записей в isolate-кэше
};

/** Настройки из окружения (в Worker нет process.env — env приходит параметром). */
export function cfgOf(env) {
  const e = env || {};
  const num = (name, def, min) => Math.max(min, Number(e[name]) || def);
  return {
    on: e.MEMORY !== '0',
    hot: num('MEMORY_HOT_MSGS', LIMITS.hot, 4),
    compactAt: num('MEMORY_COMPACT_AT', LIMITS.compactAt, 20),
    keepAfter: num('MEMORY_KEEP_AFTER', LIMITS.keepAfter, 5),
    factsMax: num('MEMORY_FACTS_MAX', LIMITS.factsMax, 5),
    prefsMax: num('MEMORY_PREFS_MAX', LIMITS.prefsMax, 3),
    cacheMax: num('MEMORY_CACHE_MAX', LIMITS.cacheMax, 2),
    /** Сводку пишет модель только по явному включению: это лишние вызовы провайдера. */
    summarize: e.MEMORY_SUMMARIZE === '1',
  };
}

/**
 * Ключ в хранилище: одна схема для KV и D1, чтобы не размывать пространство имён.
 * Строит `engine/kvkey.js`: KV не принимает кириллицу и точки в начале, а старое
 * правило «вырезали лишнее — и пишем» склеивало два разных русских имени чата в
 * один ключ, то есть в одну память на двоих. Здесь вырезанное дописывается хэшем.
 */
export function keyFor(chatId) {
  return kvKey('chat', chatId || 'guest');
}

/**
 * Полная форма записи. Обязана быть ОДНОЙ для загрузки и для anything-иного:
 * у донора фоновое восстановление клало в кэш обрубленный объект, и первая же
 * запись закрепляла потерю полей на диске. Здесь то же правило — поля, которых
 * нет в normalize, жить не должны вовсе.
 */
export function normalize(chatId, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    chatId: String(chatId || d.chatId || 'guest'),
    updatedAt: Number(d.updatedAt) || 0,
    summary: String(d.summary || '').slice(0, 20000),
    messages: Array.isArray(d.messages)
      ? d.messages
        .filter((m) => m && typeof m.content === 'string')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content).slice(0, LIMITS.msgChars),
          ts: Number(m.ts) || 0,
          /* Из какого чата приложения пришла реплика (не адрес хранения — у
             одного человека несколько чатов физически делят одну запись, см.
             memoryKey в engine/profile.js). Пусто — запись старше этого поля
             или пришла без привязки (бот, curl): трогать её при forgetOrigin
             нельзя, мы не знаем, чья она. */
          origin: String(m.origin || '').slice(0, 80),
        }))
      : [],
    /* Факты и уроки раньше были просто строками — тег «из какого чата» неоткуда
       взять у старых записей. normalize() принимает обе формы: голую строку
       заворачивает в { text, origin: '', ts: 0 } (безопасно — такую запись
       forgetOrigin не тронет ни для одного чата, чтобы не удалить чужое по
       ошибке), а новые приходят уже объектом. */
    facts: Array.isArray(d.facts)
      ? d.facts
        .map((f) => (typeof f === 'string' ? { text: f, origin: '', ts: 0 } : f))
        .filter((f) => f && typeof f.text === 'string')
        .map((f) => ({ text: String(f.text).slice(0, LIMITS.factChars), origin: String(f.origin || '').slice(0, 80), ts: Number(f.ts) || 0 }))
        .filter((f) => f.text)
        .slice(-LIMITS.factsMax)
      : [],
    lessons: Array.isArray(d.lessons)
      ? d.lessons
        .map((l) => (typeof l === 'string' ? { text: l, origin: '', ts: 0 } : l))
        .filter((l) => l && typeof l.text === 'string')
        .map((l) => ({ text: String(l.text).slice(0, 400), origin: String(l.origin || '').slice(0, 80), ts: Number(l.ts) || 0 }))
        .filter((l) => l.text)
        .slice(-LIMITS.lessonsMax)
      : [],
    images: Array.isArray(d.images)
      ? d.images
        .filter((x) => x && typeof x.description === 'string')
        .map((x) => ({ ts: Number(x.ts) || 0, description: String(x.description).slice(0, 2000), snippet: String(x.snippet || '').slice(0, 300), origin: String(x.origin || '').slice(0, 80) }))
        .slice(-12)
      : [],
    attune: {
      prefs: Array.isArray(d.attune && d.attune.prefs)
        ? d.attune.prefs
          .filter((p) => p && typeof p.text === 'string')
          .map((p) => ({ key: String(p.key || p.text.slice(0, 24)), text: String(p.text).slice(0, 200), count: Number(p.count) || 1, ts: Number(p.ts) || 0, origin: String(p.origin || '').slice(0, 80) }))
        : [],
      turns: Number(d.attune && d.attune.turns) || 0,
      hits: Number(d.attune && d.attune.hits) || 0,
      misses: Number(d.attune && d.attune.misses) || 0,
      goals: Array.isArray(d.attune && d.attune.goals) ? d.attune.goals.map(String).slice(-LIMITS.goalsMax) : [],

    },
  };
}

/* ==================== Что о собеседнике стоит запомнить ==================== */
/* \\b в JS не знает кириллицы — поэтому свой разделитель слова. */
const WB = '(?:^|[^\\u0430-\\u044f\\u0451a-z0-9])';
export const FACT_RULES = [
  [new RegExp(WB + '(?:меня зовут|зовут меня|моё имя|мое имя)\\s+([а-яёa-z-]{2,24})', 'i'), (m) => 'звать ' + m[1]],
  [new RegExp(WB + 'я из ([а-яёa-z-]{2,28})', 'i'), (m) => 'из ' + m[1]],
  [new RegExp(WB + 'живу в ([а-яёa-z-]{2,28})', 'i'), (m) => 'живёт в ' + m[1]],
  [new RegExp(WB + 'мне (\\d{1,3})\\s*(?:лет|года|год)', 'i'), (m) => m[1] + ' лет'],
  [new RegExp(WB + '(?:я |очень )?люблю ([^.,!?\\n]{3,60})', 'i'), (m) => 'любит ' + m[1].trim()],
  [new RegExp(WB + '(?:мне )?нравится ([^.,!?\\n]{3,60})', 'i'), (m) => 'нравится ' + m[1].trim()],
  [new RegExp(WB + 'увлекаюсь ([^.,!?\\n]{3,60})', 'i'), (m) => 'увлекается ' + m[1].trim()],
  [new RegExp(WB + 'работаю ([^.,!?\\n]{3,60})', 'i'), (m) => 'работает: ' + m[1].trim()],
  [new RegExp(WB + 'я ([а-яё]{3,24}) по профессии', 'i'), (m) => 'профессия: ' + m[1]],
  [new RegExp(WB + 'учусь (?:в|на) ([^.,!?\\n]{3,60})', 'i'), (m) => 'учится: ' + m[1].trim()],
  [new RegExp(WB + 'у меня есть ([^.,!?\\n]{3,60})', 'i'), (m) => 'у него есть ' + m[1].trim()],
  [new RegExp(WB + '(?:я )?хочу (?!узнать|найти|проверить|посчитать|перевести)([^.,!?\\n]{3,60})', 'i'), (m) => 'хочет ' + m[1].trim()],
  [new RegExp(WB + 'мечтаю ([^.,!?\\n]{3,60})', 'i'), (m) => 'мечтает ' + m[1].trim()],
  [new RegExp(WB + 'планирую ([^.,!?\\n]{3,60})', 'i'), (m) => 'планирует ' + m[1].trim()],
];

/** Вытащить из реплики то, что человек рассказал о себе. */
export function extractFacts(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 900) return [];
  const out = [];
  for (const [re, fmt] of FACT_RULES) {
    const m = t.match(re);
    if (m) {
      const v = fmt(m).replace(/\s+/g, ' ').trim();
      if (v && v.length > 3 && out.indexOf(v) < 0) out.push(v);
    }
  }
  /* короткая личная реплика целиком — тоже память (но не вопрос: на вопрос отвечают, а не запоминают) */
  if (!out.length && t.length < 180 && t.indexOf('?') < 0 && /(я|меня|мне|мной|мой|моя|моё|мое|у меня)(?![а-яё])/i.test(t)) out.push(t);
  return out.slice(0, 3);
}

/* ==================== Память ==================== */

export function createMemory(opts) {
  const o = opts || {};
  const cfg = cfgOf(o.env);
  const store = o.store || null;
  const now = o.now || (() => Date.now());
  const log = o.log || (() => {});
  const summarize = o.summarize || null;

  const cache = new Map();     // key → запись (LRU: «свежесть» = переустановка ключа)
  const loading = new Map();   // key → Promise, чтобы одновременные запросы одного чата не плодили гонок
  const pending = new Set();   // обещания записи, которых ждёт flush()
  let lastError = '';

  const enabled = cfg.on && !!store && typeof store.get === 'function' && typeof store.put === 'function';

  function touch(key, rec) {
    cache.delete(key);
    cache.set(key, rec);
    while (cache.size > cfg.cacheMax) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  async function read(key) {
    if (!enabled) return null;
    try {
      const raw = await store.get(key);
      return raw == null ? null : raw;
    } catch (e) {
      lastError = 'хранилище не отдало память: ' + msg(e);
      log('warn', lastError);
      return null;
    }
  }

  function write(key, rec) {
    if (!enabled) return Promise.resolve();
    touch(key, rec);
    const p = Promise.resolve()
      .then(() => store.put(key, rec))
      .catch((e) => {
        lastError = 'хранилище не приняло память: ' + msg(e);
        log('warn', lastError);
      });
    pending.add(p);
    p.then(() => pending.delete(p));
    return p;
  }

  /** Прочитать (или взять из кэша) полную запись чата. */
  async function load(chatId) {
    const key = keyFor(chatId);
    const hit = cache.get(key);
    if (hit) {
      touch(key, hit);
      return hit;
    }
    if (!enabled) return normalize(chatId, null);
    if (loading.has(key)) return loading.get(key);
    const p = (async () => {
      const raw = await read(key);
      const rec = normalize(chatId, raw);
      touch(key, rec);
      return rec;
    })();
    loading.set(key, p);
    p.catch(() => {}).then(() => loading.delete(key));
    return p;
  }

  async function save(chatId, rec) {
    const key = keyFor(chatId);
    const next = normalize(chatId, Object.assign({}, rec, { updatedAt: now() }));
    await write(key, next);
    return next;
  }

  async function addMessage(chatId, role, content, origin) {
    const d = await load(chatId);
    d.messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: String(content || '').slice(0, LIMITS.msgChars), ts: now(), origin: String(origin || '') });
    /* жёсткий потолок длины истории: KV не безразмерен, а старое уже есть в сводке */
    const cap = Math.max(cfg.compactAt * 4, 200);
    if (d.messages.length > cap) d.messages = d.messages.slice(-cap);
    return save(chatId, d);
  }

  async function addFact(chatId, fact, origin) {
    const f = String(fact || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.factChars);
    if (!f) return null;
    const d = await load(chatId);
    if (!d.facts.some((x) => x.text === f)) {
      d.facts.push({ text: f, origin: String(origin || ''), ts: now() });
      if (d.facts.length > cfg.factsMax) d.facts = d.facts.slice(-cfg.factsMax);
      return save(chatId, d);
    }
    return d;
  }

  async function rememberFacts(chatId, text, origin) {
    const list = extractFacts(text);
    for (const f of list) await addFact(chatId, f, origin);
    return list;
  }

  async function addLesson(chatId, text, origin) {
    const l = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!l) return null;
    const d = await load(chatId);
    if (!d.lessons.some((x) => x.text === l)) {
      d.lessons.push({ text: l, origin: String(origin || ''), ts: now() });
      if (d.lessons.length > LIMITS.lessonsMax) d.lessons = d.lessons.slice(-LIMITS.lessonsMax);
      return save(chatId, d);
    }
    return d;
  }

  /* ==================== Подстройка (attune) ==================== */

  async function addPref(chatId, key, text, origin) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) return null;
    const k = String(key || t.slice(0, 24));
    const d = await load(chatId);
    const a = d.attune;
    const found = a.prefs.find((p) => p.key === k);
    if (found) {
      found.count = (found.count || 1) + 1;
      found.ts = now();
      found.text = t;
      /* origin НЕ трогаем: правило закреплено за чатом, где оно родилось
         первый раз, даже если позже подтверждалось в другом чате того же
         человека — иначе forgetOrigin при удалении того, другого чата,
         нечаянно стёр бы чужое (для него) правило. */
    } else {
      a.prefs.push({ key: k, text: t, count: 1, ts: now(), origin: String(origin || '') });
      if (a.prefs.length > cfg.prefsMax) {
        /* прощаем то, что не подтверждалось: вытесняем самое слабое и самое старое */
        a.prefs.sort((x, y) => (x.count - y.count) || (x.ts - y.ts));
        a.prefs.shift();
        a.prefs.sort((x, y) => x.ts - y.ts);
      }
    }
    await save(chatId, d);
    return a.prefs.slice();
  }

  async function bumpAttune(chatId, patch) {
    const p = patch || {};
    const d = await load(chatId);
    const a = d.attune;
    a.turns = (a.turns || 0) + 1;
    if (p.goal && a.goals[a.goals.length - 1] !== p.goal) {
      a.goals.push(p.goal);
      if (a.goals.length > LIMITS.goalsMax) a.goals = a.goals.slice(-LIMITS.goalsMax);
    }
    if (p.result === 'hit') a.hits = (a.hits || 0) + 1;
    if (p.result === 'miss') a.misses = (a.misses || 0) + 1;
    await save(chatId, d);
    return { turns: a.turns, hits: a.hits, misses: a.misses, prefs: a.prefs.length };
  }

  /* ==================== Контекст для модели ==================== */

  function keywords(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 24);
  }

  function score(text, kws) {
    const t = String(text || '').toLowerCase();
    let n = 0;
    kws.forEach((k) => {
      if (t.indexOf(k) >= 0) n++;
    });
    return n;
  }

  /** Сводка + релевантное из раннего + свежие реплики. Возвращает { block, recent, total }. */
  function blockOf(d, goal, opts) {
    const fast = !!(opts && opts.fast);
    if (!d || (!d.messages.length && !d.summary && !d.facts.length)) return { block: '', recent: [], total: 0 };
    const hot = d.messages.slice(-cfg.hot);
    const parts = [];
    if (d.summary) parts.push('【Сводка прошлого разговора】\n' + d.summary);
    if (d.facts.length) parts.push('【Что важно помнить о собеседнике】\n' + d.facts.map((f) => '• ' + f.text).join('\n'));
    if (!fast && d.lessons.length) parts.push('【Выученное в этом чате】\n' + d.lessons.map((l) => '• ' + l.text).join('\n'));
    if (!fast && d.images.length) {
      parts.push('【Что было на картинках】\n' + d.images.slice(-3).map((x) => '• ' + x.description.slice(0, 300)).join('\n'));
    }
    let relevant = [];
    if (!fast) {
      const kws = keywords(goal);
      const older = d.messages.slice(0, Math.max(0, d.messages.length - cfg.hot));
      if (kws.length && older.length) {
        relevant = older
          .map((m) => ({ m, s: score(m.content, kws) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 8)
          .map((x) => x.m);
      }
    }
    if (relevant.length) {
      parts.push('【Релевантное из ранней истории чата】\n' + relevant.map((m) => (m.role === 'assistant' ? 'Агент' : 'Пользователь') + ': ' + m.content.slice(0, 400)).join('\n'));
    }
    const block = parts.length ? '【Память чата — используй её, это продолжение того же разговора】\n' + parts.join('\n\n') : '';
    return { block, recent: hot, total: d.messages.length };
  }

  /**
   * Только память: сводка, факты, уроки, свежие реплики. Настройку на человека
   * (attune) собирает consider() — иначе блок попадал в промпт дважды, что
   * замечено и на доноре.
   */
  async function contextFor(chatId, goal, opts) {
    const d = await load(chatId);
    const ctx = blockOf(d, goal, opts);
    return { block: ctx.block, recent: ctx.recent, total: ctx.total, prefs: d.attune.prefs.length, turns: d.attune.turns };
  }

  /**
   * Реакция на ПРОШЛЫЙ ответ + цель СЕЙЧАС — и всё, что из этого следует.
   * Вызывается до генерации: поправка должна попасть в этот же ответ.
   */
  async function consider(chatId, text, prev, origin) {
    if (!enabled) return null;
    const d = await load(chatId);
    const prevUser = prev && prev.user;
    const prevReply = prev && prev.reply;
    const reaction = prevReply ? readReaction(text, prevReply, prevUser) : null;
    const intent = resolveIntent(text, d.messages.filter((m) => m.role === 'user').map((m) => m.content), reaction, d.attune.goals[d.attune.goals.length - 1]);
    const dirs = directivesFrom(reaction, intent);
    for (const x of dirs) await addPref(chatId, x.key, x.text, origin);
    if (reaction && reaction.kind !== 'neutral') {
      await bumpAttune(chatId, { result: reaction.kind === 'hit' ? 'hit' : 'miss', goal: intent && intent.key });
    } else if (intent) {
      await bumpAttune(chatId, { goal: intent.key });
    }
    const block = buildAttunePrompt({ intent, reaction, prefs: (await load(chatId)).attune.prefs, turns: d.attune.turns + 1 });
    return { block, intent, reaction, directives: dirs };
  }

  /* ==================== Компакция ==================== */

  function needsCompact(d) {
    return !!d && d.messages.length > cfg.compactAt;
  }

  const compacting = new Set();

  /**
   * Сжать старое в сводку. Без модели — честная механическая сворачивающая
   * сводка (первые строки реплик); с `summarize` — то, что делал донор.
   * Двойной вход запрещён: два concurrent-прохода дублировали сводку и
   * выкидывали сообщения дважды (у донора это был реальный потерь истории).
   */
  async function compact(chatId) {
    const key = keyFor(chatId);
    if (compacting.has(key)) return null;
    /* Флаг — ДО первого await: иначе два соседних запроса успевают проверить
       «не идёт ли» одновременно и сжать один и тот же хвост дважды (у донора
       второй проход резал уже урезанный массив — это была реальная потеря). */
    compacting.add(key);
    try {
      const d0 = await load(chatId);
      if (!needsCompact(d0)) return null;
      const d = await load(chatId);
      if (!needsCompact(d)) return null;
      const cut = d.messages.length - cfg.keepAfter;
      const old = d.messages.slice(0, Math.max(0, cut));
      if (!old.length) return null;
      const text = old.map((m) => (m.role === 'assistant' ? 'Агент' : 'Пользователь') + ': ' + m.content.slice(0, 600)).join('\n');
      let summary = '';
      if (cfg.summarize && typeof summarize === 'function') {
        try {
          summary = String((await summarize(text, d.summary)) || '').trim();
        } catch (e) {
          summary = '';
        }
      }
      if (!summary) summary = fold(text);
      /* пока ждали, в чат могли написать: убираем ровно те объекты, что свернули */
      const cur = await load(chatId);
      const drop = new Set(old);
      cur.summary = (cur.summary ? cur.summary + '\n' : '') + summary;
      cur.messages = cur.messages.filter((m) => !drop.has(m));
      return await save(chatId, cur);
    } finally {
      compacting.delete(key);
    }
  }

  /** Механическая сводка без обращения к модели: по первой строке каждой реплики. */
  function fold(text) {
    const lines = String(text)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const took = lines.length > 40 ? lines.filter((_, i) => i % 2 === 0) : lines;
    return 'Сжато механически (' + lines.length + ' реплик): ' + took.slice(0, 24).join(' | ').slice(0, 4000);
  }

  async function forget(chatId) {
    const key = keyFor(chatId);
    cache.delete(key);
    if (enabled && typeof store.delete === 'function') {
      try {
        await store.delete(key);
      } catch (e) {
        lastError = 'хранилище не удалило память: ' + msg(e);
      }
    }
    return true;
  }

  /**
   * Стереть вклад ОДНОГО чата приложения (origin), не трогая всю запись: у
   * человека несколько чатов физически делят одну запись в хранилище (см.
   * memoryKey в engine/profile.js — один адрес на всего человека, не на чат),
   * поэтому полный forget() стёр бы заодно и другие его чаты. Здесь — точечно:
   * из транскрипта, фактов, уроков и предпочтений убирается только то, что
   * помечено этим origin, остальное остаётся как было.
   *
   * Чего это НЕ делает (и не может): сводка (summary) уже слита в один текст
   * из реплик разных чатов до того, как они были стёрты компакцией — вычленить
   * из неё кусок одного чата нельзя. Это редкий случай (сжатие срабатывает
   * только на очень длинной истории, см. LIMITS.compactAt) и честно не
   * выдаётся за полное удаление: только то, что ещё хранится отдельно.
   */
  async function forgetOrigin(chatId, origin) {
    const o = String(origin || '').trim();
    if (!o) return null;
    const d = await load(chatId);
    const before = {
      messages: d.messages.length,
      facts: d.facts.length,
      lessons: d.lessons.length,
      prefs: d.attune.prefs.length,
    };
    d.messages = d.messages.filter((m) => m.origin !== o);
    d.facts = d.facts.filter((f) => f.origin !== o);
    d.lessons = d.lessons.filter((l) => l.origin !== o);
    d.images = d.images.filter((x) => x.origin !== o);
    d.attune.prefs = d.attune.prefs.filter((p) => p.origin !== o);
    await save(chatId, d);
    return {
      messages: before.messages - d.messages.length,
      facts: before.facts - d.facts.length,
      lessons: before.lessons - d.lessons.length,
      prefs: before.prefs - d.attune.prefs.length,
    };
  }

  async function stats(chatId) {
    const d = await load(chatId);
    return {
      on: enabled,
      messages: d.messages.length,
      facts: d.facts.length,
      lessons: d.lessons.length,
      summaryChars: d.summary.length,
      prefs: d.attune.prefs.length,
      turns: d.attune.turns,
      hits: d.attune.hits,
      misses: d.attune.misses,
      updatedAt: d.updatedAt,
      error: lastError,
    };
  }

  return {
    enabled,
    cfg,
    keyFor,
    load,
    save,
    addMessage,
    addFact,
    rememberFacts,
    addLesson,
    addPref,
    bumpAttune,
    blockOf,
    contextFor,
    consider,
    needsCompact,
    compact,
    forget,
    forgetOrigin,
    stats,
    flush: () => Promise.all(Array.from(pending)),
  };
}

function msg(e) {
  return (e && e.message) || String(e || '');
}
