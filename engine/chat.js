/**
 * Обход бесплатных провайдеров — порт chat()/attempt() из Yama (Этап 1).
 *
 * Идея переносится целиком: бесплатные модели поодиночке непригодны (то 429, то
 * отказ, то обрыв на середине фразы), годится только обход с ротацией ключей,
 * паузами под тариф и честным списком того, что было перепробовано.
 *
 * Runtime-независимость: никаких process.env, fs, vm. Окружение и fetch приходят
 * параметром — тот же код исполняется в Cloudflare Worker, в Pages Function и в
 * Node (на нём крутятся тесты).
 */

import {
  buildTable, providerAlive, pickKey, orderFor, ORDER, MIN_INTERVAL, TIMEOUT, FIRST_BYTE_TIMEOUT, MAX_IMAGES,
} from './providers.js';
import { classifyTask, tierFor, modelsFor, isVision, isReasoning, isSightedReasoning, visionFirst, preferHeads } from './route.js';
import { preferUncensored } from './brave.js';
import { buildRequest, rawCall, streamCall, isProviderError, isRefusal, stripThinkTags } from './shape.js';
import { detect as detectSkills, blockOf as skillsBlockOf, toolsOf as skillTools } from './skills.js';
import { gatherTools } from './tools.js';
import { cleanCitations } from './search.js';
import { sharedImggen, packImages, wantsImage, editsReady } from './imggen.js';
import { sharedUsage } from './usage.js';
import { fit as fitContext, estTokens, clampNumber, CTX_WINDOW_MAX } from './ctxfit.js';
import { packFiles, formatFromText, nameFromText } from './filegen.js';
import { packCharts } from './chart.js';
import * as personaStyle from './personastyle.js';

/* 0.198 «Отказодавильня»: формы вежливого отказа (первое лицо без «не могу»,
   ссылки на правила) ловит freedom.isPoliteRefusal — и в тексте, и по фото. */
const CREATIVE_ASK_RE = /(?:напиши|расскажи|опридумай|сочини|опиши)?[^.\n]{0,24}(рассказ|истори[юя]|сцен[уаи]|ролев\w*|стих\w*|роман|сценарий|новелл)/i;
import { TOOL_TITLES } from './tools.js';
import * as freedom from './freedom.js';
import * as vision from './vision.js';
import * as lexicon from './lexicon.js';
import { block as jbBlock } from './jailbreak.js';
import * as gender from './gender.js';
import * as emotion from './emotion.js';
import * as style from './style.js';
import * as locale from './locale.js';
import * as ensemble from './ensemble.js';
import { createMemory } from './memory.js';
import * as modelreg from './modelreg.js';
import * as longdoc from './longdoc.js';
import * as vcouncil from './vcouncil.js';
import { detectLang, langMind } from './langmind.js';
import * as depth from './depth.js';
import { planDeepWork } from './deepwork.js';
import * as check from './check.js';
import { mapLimit, netCfg } from './netpool.js';

/**
 * С какого размера материала движок ищет модель пошире (см. wideFirst).
 *
 * Число берётся от самой узкой головы, которую мы вообще пускаем в бой: окно 8 192
 * минус резерв на ответ — значит всё, что больше ~6 000 токенов, у неё уже режется.
 * Раньше порога не было вовсе: порядок голов выбирался только по задаче, и документ
 * в 24 000 знаков уезжал голове с окном 8К, теряя половину на резке, — хотя в том же
 * пуле стояла модель, которая приняла бы его целиком.
 */
const WIDE_AT_TOKENS = 6000;

/** Обрыв именно по потолку вывода, а не нормальная точка. OpenAI-совместимые
 * шлюзы говорят `length`, Gemini — `MAX_TOKENS`; до 0.211 продолжение знало
 * только первое слово и Gemini-ответы оставались куском. */
export function isTruncatedFinish(finish) {
  return /^(length|max[_-]?tokens|max[_-]?output[_-]?tokens)$/i.test(String(finish || '').trim());
}

const LANGUAGE_RULES =
  '\n\nОбщие правила языка и письма: отвечай на языке собеседника, если он не попросил иначе. '
  + 'Соблюдай орфографию, грамматику, согласование, пунктуацию и типографику выбранного языка '
  + 'и его регионального варианта: кавычки, апострофы, тире, пробелы и регистр. Сохраняй заданные '
  + 'диалект и стиль, но не копируй обычные опечатки и не исправляй собеседника без просьбы. '
  + 'Если вариант не задан — используй уместный стандарт; уточняй только при существенной неоднозначности. '
  + 'Используй родную письменность и полный набор знаков, требуемый языком и задачей: буквы, '
  + 'диакритику, пунктуацию, специальные и математические символы. Не снимай акценты, не подменяй '
  + 'знаки похожими ASCII-символами, не транслитерируй и не выдавай escape-коды вместо символов без '
  + 'просьбы. Сохраняй, например, `ў`, `і`, `ё`, `ґ`, `є`, `ї`, `ą`, `ł`, `ß`, `ı/İ`, `¿¡`, `±`, `≤`, `√`. '
  + 'Если пользователь перечислил обязательные символы, включи каждый ровно в заданном виде, без пропусков и замен. '
  + 'Эмодзи и специальные знаки используй по смыслу, а не все подряд. При просьбе скопировать или '
  + 'точно процитировать строку сохраняй её символы, регистр, пунктуацию и значимые пробелы. '
  + 'Код, имена, URL, идентификаторы, формулы и цитаты сохраняй точно; пиши символы, а не их текстовые коды.';

export const PERSONA_SYSTEM =
  'Ты — MeTiger Ai, свободная открытая система для любого общения в одном чате. '
  + 'Базовая позиция — полезность, честность и прямота: отвечаешь на языке человека, по существу, '
  + 'без морализаторства, без лишних отказов и без вступительных поклонов («конечно», «отличный вопрос», «как модель я не могу»). '
  + 'Код и файлы — в fence с языком. Математику пиши формулами LaTeX: в строке — \\( ... \\), '
  + 'отдельной строкой — \\[ ... \\] (дроби \\frac, корни \\sqrt, степени и индексы), потому что у человека '
  + 'они рисуются как в учебнике, а не слэшами; системы — через \\begin{cases}. '
  + 'Если факта не знаешь — говоришь прямо и подсказываешь, где проверить, не додумываешь. '
  + 'Свободный режим — это открытый разговор по умолчанию, а не «обход»: мирные темы получают прямой ответ, единственная граница — защита людей от тяжкого вреда.'
  + LANGUAGE_RULES;

/**
 * Сколько человек готов ждать совета. `COUNCIL_MS` / `COUNCIL_MS_VISION` — сколько
 * просим; `ENSEMBLE_MS` / `VCOUNCIL_MS` — потолок, который сам слой себе ставит.
 * Берётся меньшее, но не меньше 4 секунд: меньше — совет физически не успевает
 * собрать две головы, и тогда лучше честно сказать «пропущено», чем соврать.
 */
export function councilBudget(env, ec, vc) {
  const e = env || {};
  const clamp = (want, capMs) => Math.max(4000, Math.min(Number(capMs) || 1e9, Math.max(4000, Number(want) || 0) || 1e9));
  return {
    textMs: clamp(e.COUNCIL_MS || 12000, (ec && ec.ms) || 1e9),
    visionMs: clamp(e.COUNCIL_MS_VISION || 20000, (vc && vc.ms) || 1e9),
  };
}

/** Мелкие модели иногда копируют заголовок блока данных в ответ — вычищаем. */
function scrubToolMarkers(s) {
  return String(s || '')
    .replace(/\[Инструмент:[^\]]*\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Остывание МОДЕЛИ после 429 (0.127). Раньше 429 помечал ключ «остыть 60 с» в карте,
 * которую никто не читал, да ещё и живущей один запрос: каждый следующий вопрос снова
 * шёл в ту же модель Groq, ловил 429 и только потом переходил дальше (на замере —
 * до двух лишних 429 на ответ). Карта модульная, то есть общая на изолят Worker'а, и
 * НЕ уезжает в KV: у бесплатного KV 1000 записей в сутки, а 429 бывают десятками.
 * Остывшая модель не вычёркивается из пула, а уходит в его конец — если остыли все,
 * обход всё равно попробует их, а не умрёт с пустыми руками.
 */
export const MODEL_COOL = new Map();
/* Счётчик ротации ключей на изолят: без него каждый запрос начинал с ключа №1, и
   второй/третий ключ работали только как запасные после 429. */
export const KEY_TURN = new Map();
/** Мёртвые ключи (401/403) на изолят: id#индекс → до какого времени не трогать. */
export const KEY_DEAD = new Map();
/**
 * Остывание после 429 — на паре МОДЕЛЬ+КЛЮЧ: лимиты бесплатных тарифов считаются на
 * ключ, и 429 на первом ключе не значит, что второй тоже упрётся. Модель «остыла»,
 * только когда остыла на всех ключах провайдера.
 */
function coolApi(map) {
  const k3 = (id, model, key) => id + '::' + model + '::' + key;
  const keyCooling = (id, model, key) => {
    const k = k3(id, model, key);
    const until = map.get(k);
    if (!until) return false;
    if (until <= Date.now()) { map.delete(k); return false; }
    return true;
  };
  const nKeys = (cfg) => Math.max(1, (cfg && cfg.keys && cfg.keys.length) || 1);
  const cooling = (id, model, cfg) => {
    for (let i = 0; i < nKeys(cfg); i++) if (!keyCooling(id, model, i)) return false;
    return true;
  };
  return {
    keyCooling,
    cooling,
    cool: (id, model, key, ms) => { if (map.size > 1000) map.clear(); map.set(k3(id, model, key), Date.now() + ms); },
    order: (id, models, cfg) => {
      const fresh = [], cold = [];
      for (const m of models) (cooling(id, m, cfg) ? cold : fresh).push(m);
      return fresh.concat(cold);
    },
  };
}

export function createEngine(opts) {
  const o = opts || {};
  const env = o.env || {};
  const fetchImpl = o.fetch || ((...a) => fetch(...a));
  /* Кому отдавать текст по мере прихода (стриминг). Нет колбэка — ходим ровно прежним
     путём: один ответ целиком. Стрим — надстройка, а не новый режим движка. */
  const onDelta = typeof o.onDelta === 'function' ? o.onDelta : null;
  const P = buildTable(env);
  /* Память чата: либо готовый экземпляр (своё хранилище, свой кэш), либо store —
     тогда соберём сами. Без того и другого движок работает ровно как раньше. */
  const memory = o.memory || (o.store ? createMemory({ store: o.store, env, log: o.log }) : null);
  /* Рейтинг смелых (engine/brave.js): чей опыт показывать первым на «острой»
     теме. Как и карантин — переживается через KV, без него живёт в изоляте. */
  const brave = o.brave || null;
  /* Картинки — единственный инструмент, который работает ПОСЛЕ ответа модели:
     блок ```img``` из текста доезжает до генератора, битые base64 чинятся, а
     отказавший источник паркуется на 5 минут, чтобы каждый запрос не стучался
     в ту же дверь. Слой создаётся один на изолят — кэш состояния общий. */
  const noteLog = o.log || (() => {});
  /* Слой общий на изолят — тогда /api/skills и чат видят одно состояние.
     В тестах (и в чужих сборках) его подменяют своим: createEngine({ imggen }). */
  const imggen = o.imggen || sharedImggen(env, fetchImpl, noteLog);
  /* Вердикт судьи глубины (engine/depth.js) последнего запроса. Живёт в области
     движка, а не внутри run(): совет голов (runCouncils) собирается ПОСЛЕ ответа
     автора и должен знать, просил ли судья больше независимых проверок. Область
     run() для него недостижима — эта ошибка была поймана прогоном chat.test.js. */
  let depthVerdict = null;
  const health = Object.create(null);   /* id → [ключевое состояние] */
  const lastCallAt = Object.create(null);
  const usage = Object.create(null);    /* id → { calls, ok, refused, dead, t } */
  /* 0.211: точное число исходящих попыток этого экземпляра движка. Дверь
     раньше списывала суточный запас по длине `tried`, куда не попадают
     успешная голова, советы, чтение документа и починка — счёт был ниже
     настоящего именно на сложных запросах. */
  let attemptSeq = 0;
  /* Расход провайдеров для панели «Использование и Лимиты»: считаем каждую
     исходящую попытку и её исход. Карта `usage` выше — про этот запрос, а слой
     `usage` живёт на изолят и уезжает в KV (engine/usage.js). */
  const usageTrack = o.usage || sharedUsage(env);
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  /* Карантин — для провайдеров, которые не медлят, а не отвечают вовсе: токен без
     прав, нулевой баланс, 401. В Worker движок создаётся на каждый запрос, поэтому
     в проде карту передают модульную: иначе каждая request'а заново стучится в
     мёртвую дверь и теряет на это те секунды, которые стоили совета. */
  const quar = o.quarantine || new Map();
  /* Прод передаёт модульную MODEL_COOL (общая на изолят), тесты — свою чистую. */
  const mcool = coolApi(o.modelCool || new Map());
  const keyTurn = o.keyTurn || new Map();
  const keyDead = o.keyDead || new Map();
  const isKeyDead = (id, i) => { const u = keyDead.get(id + '#' + i); if (!u) return false; if (u <= Date.now()) { keyDead.delete(id + '#' + i); return false; } return true; };
  /** Ключ для модели: по кругу между запросами, мимо мёртвых и остывших на этой модели. */
  function chooseKey(id, model, skip) {
    const cfg = P[id];
    const n = (cfg && cfg.keys && cfg.keys.length) || 0;
    if (n <= 1) return skip && skip.size ? -1 : pickKey(P, id, health);
    const start = (keyTurn.get(id) || 0) % n;
    keyTurn.set(id, start + 1);
    // Очистка старого состояния
    if (keyTurn.size > 1000) keyTurn.clear();
    for (let s = 0; s < n; s++) {
      const i = (start + s) % n;
      if (skip && skip.has(i)) continue;
      const h = health[id] && health[id][i];
      if (h && h.state === 'invalid') continue;
      if (isKeyDead(id, i)) continue;
      if (mcool.keyCooling(id, model, i)) continue;
      return i;
    }
    return skip && skip.size ? -1 : pickKey(P, id, health);
  }
  const QUARANTINE_MS = Math.max(60000, Number(env.QUARANTINE_MS) || 240000);
  function punish(id, why, ms) {
    quar.set(id, { until: Date.now() + (ms || QUARANTINE_MS), why: String(why || '').slice(0, 140) });
    /* Пауза видна человеку в панели использования: «провайдер молчит» и «провайдер
       наказан на 10 минут» — разные истории, и вторая не должна выглядеть поломкой. */
    usageTrack.pause(id, why, ms || QUARANTINE_MS);
  }
  function punished(id) {
    const q = quar.get(id);
    if (!q) return null;
    if (q.until <= Date.now()) { quar.delete(id); return null; }
    return q;
  }

  function note(id, kind) {
    const u = usage[id] || (usage[id] = { calls: 0, ok: 0, refused: 0, dead: 0, t: 0 });
    u.calls++;
    if (kind) u[kind] = (u[kind] || 0) + 1;
    usageTrack.outcome(id, kind);
  }
  function markKey(id, idx, patch) {
    const arr = health[id] || (health[id] = []);
    arr[idx] = Object.assign({}, arr[idx] || {}, patch);
  }

  /** Пауза под бесплатный тариф: быстрее ходить нельзя, 429 съедает ключ на сутки. */
  async function pace(id, budgetMs) {
    const min = Number(env[(id.toUpperCase()) + '_MIN_MS'] || MIN_INTERVAL[id] || 0);
    if (!min) return true;
    const prev = Number(lastCallAt[id] || 0);
    const wait = prev + min - Date.now();
    if (wait <= 0) return true;
    if (budgetMs && wait > budgetMs * 0.6) return false;   /* ждать дольше, чем можно, — смысла нет */
    await sleep(wait);
    return true;
  }

  const DEAD_MODEL_RE = /model[_\s-]*not[_\s-]*found|unknown model|unavailable for free|currently unavailable|does not exist|auto_router_disabled|no longer available/i;
  function coolDeadModel(id, model, ms) {
    const nKeys = Math.max(1, (P[id] && P[id].keys && P[id].keys.length) || 1);
    const dur = Math.max(60000, Number(ms) || 1800000);
    for (let ki = 0; ki < nKeys; ki++) mcool.cool(id, model, ki, dur);
  }

  /**
   * Одна попытка: конкретный провайдер + конкретная модель.
   * Возвращает { ok, reply, reasoning, provider, model, finish } или { ok:false, why }.
   */
  async function attemptOne(id, model, req, deadlineLeft) {
    /* Считаем попытку ДО сети: таймаут и отказ — тоже расход квоты провайдера. */
    attemptSeq++;
    usageTrack.attempt(id, model);
    const budget = Math.min(TIMEOUT[req.tier] || 30000, deadlineLeft);
    const firstByteBudget = Math.min(budget, Number(env.FIRST_BYTE_MS) || FIRST_BYTE_TIMEOUT[req.tier] || budget);
    /* Поток имеет смысл только там, где мы умеем его читать (req.sse) и есть кому его
       нести. Провайдер, проигнорировавший stream:true, вернёт json — streamCall это
       видит и ведёт себя как rawCall, то есть ничего не ломается. */
    const res = (req.sse && onDelta)
      ? await streamCall(
          fetchImpl,
          req,
          budget,
          (t) => onDelta({ kind: 'delta', provider: id, model, text: t }),
          /* рассуждения идут тем же потоком событий, но другим видом: кому их показывать,
             решает дверь (фронт просит `showReasoning`), а не движок */
          (t) => onDelta({ kind: 'reason', provider: id, model, text: t }),
          firstByteBudget,
        )
      : await rawCall(fetchImpl, req, budget);
    if (res.error === 'timeout' || (res.status === 0 && !res.text)) {
      /* 0.234: модель, которая провисела до таймаута и не прислала ни буквы,
         отодвигается в хвост пула на 3 минуты, чтобы следующий вопрос не ждал её снова. */
      if (res.error === 'timeout') mcool.cool(id, model, req.keyIdx || 0, 180000);
      /* Не всякий status 0 — таймаут. Лимит подзапросов, обрыв DNS и отказ
         рантайма раньше все подписывались одним словом, и живая диагностика
         исследования врала: сеть уже была исчерпана, а выглядело так, будто
         каждая модель просто «долго думает». */
      const why = res.error && res.error !== 'timeout'
        ? 'сеть: ' + String(res.error).slice(0, 120)
        : 'timeout';
      return { ok: false, why, status: res.status };
    }
    if (res.status === 429) {
      markKey(id, req.keyIdx, { state: 'cool', until: Date.now() + 60000 });
      mcool.cool(id, model, req.keyIdx || 0, Math.max(5000, Number(env.MODEL_COOL_MS) || 45000));
      note(id, 'dead');
      /* 429 с текстом про баланс — не «подожди минуту», а «счёта нет» (так
         отвечает z.ai). Minute-long cool-down здесь лишь заново жжёт запросы. */
      if (/insufficient balance|no resource package|recharge/i.test(res.text || '')) {
        punish(id, 'нет баланса (429)', Math.max(600000, QUARANTINE_MS * 2));
      }
      return { ok: false, why: 'rate-limit', status: 429 };
    }
    if (res.status === 401 || res.status === 403) {
      /* 0.234: на безключевом шлюзе (kilo, llm7 без ключа) 401 на конкретной модели
         означает «именно эта модель закрыта ключом», а не смерть всего шлюза:
         соседние модели того же дома (kilo-auto/free, codestral-latest) отвечают без ключа. */
      if (P[id] && P[id].noAuth) {
        coolDeadModel(id, model, 1800000);
        note(id, 'dead');
        return { ok: false, why: 'модель просит ключ у безключевого шлюза', status: res.status };
      }
      markKey(id, req.keyIdx, { state: 'invalid' });
      /* Один мёртвый ключ из нескольких — не повод сажать в карантин весь провайдер
         (0.129: с ротацией ключей мёртвый третий ключ Groq выключал два живых). Ключ
         выключается на час сам по себе, провайдер — только когда мертвы все. */
      const nk = (P[id] && P[id].keys && P[id].keys.length) || 1;
      if (nk > 1) {
        keyDead.set(id + '#' + (req.keyIdx || 0), Date.now() + 3600000);
        let alive = 0;
        for (let i = 0; i < nk; i++) if (!isKeyDead(id, i)) alive++;
        if (alive > 0) { note(id, 'dead'); return { ok: false, why: 'ключ ' + ((req.keyIdx || 0) + 1) + ' не принят, остальные живы', status: res.status, deadKey: true }; }
      }
      punish(id, 'ключ не принят (http ' + res.status + ')');
      note(id, 'dead');
      return { ok: false, why: 'ключ не принят', status: res.status };
    }
    if (res.status === 402 || /insufficient balance|no resource package/i.test(res.text || '')) {
      markKey(id, req.keyIdx, { state: 'day', deadAt: Date.now() });
      /* «нет баланса» — это не на минуту: держим дольше, но не вечно */
      punish(id, 'нет баланса/квоты', Math.max(600000, QUARANTINE_MS * 2));
      return { ok: false, why: 'квота/баланс', status: res.status };
    }
    if (res.status >= 400 || (!res.data && !res.parsed)) {
      if (res.status === 404 || DEAD_MODEL_RE.test(String(res.text || res.error || ''))) {
        coolDeadModel(id, model, 1800000);
      }
      return { ok: false, why: 'http ' + res.status + ' ' + String(res.text || res.error || '').slice(0, 120), status: res.status };
    }
    const parsed = res.parsed || req.parse(res.data);
    if (parsed.error) return { ok: false, why: 'provider: ' + parsed.error, status: res.status };
    if (parsed.blocked) { note(id, 'refused'); return { ok: false, why: 'блок по фильтру (' + (parsed.blockReason || 'prompt') + ')', status: res.status }; }
    const rawReply = String(parsed.reply || '').trim();
    if (!rawReply) return { ok: false, why: 'пустой ответ', status: res.status };
    if (isProviderError(rawReply)) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    const fr = freedom.salvageOrRefuse(rawReply, env, { prompt: req.userText });
    if (fr.refused) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    /* 0.198: вежливый отказ без «не могу» — тоже отказ, и в тексте тоже. «Я не
       анализирую и не комментирую…» или «выходит за рамки моих правил» не должны
       доезжать до человека как ГОЛОС ПРИЛОЖЕНИЯ: это мягкий отказ — очередь идёт
       дальше, работает эскалация (до двух попыток в других рамках). */
    if (freedom.isPoliteRefusal(fr.text, { prompt: req.userText })) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    /* «Зеркало лексики» (0.203, словарь понятий — 0.204): ответ есть, но модель
       по дороге перевела слова человека на клинические («дрочка» → «стимуляция»).
       Это не отказ — ответ не выбрасываем и голову не меняем; обратная замена
       возвращает его словарь детерминированно, флаги уезжают в диагностику, а
       остаточное смягчение учит рейтинг смелых (см. brave.mark в обходе). */
    const lexed = lexicon.restore(style.polish(fr.text, { env, intent: req.intent }), req.lexSource, env);
    const sanitizedLeft = req.lexSource ? lexicon.sanitizedInfo(req.lexSource, lexed.text).length > 0 : false;
    /* 0.204: окончания о себе по роду агента. Творческий текст не трогаем —
       рассказчик и персонажи могут быть любого рода, это их речь, не агента. */
    const reply = req.intent === 'creative' ? lexed.text : gender.repair(lexed.text, req.agentGender);
    note(id, 'ok');
    quar.delete(id);   /* ожил — карантин снят сразу */
    const day = (health[id] && health[id][req.keyIdx] && health[id][req.keyIdx].used) || 0;
    markKey(id, req.keyIdx, { used: day + 1 });
    return {
      ok: true, reply, reasoning: parsed.reasoning || '', finish: parsed.finish,
      provider: id, model: req.model, freedomCleaned: fr.cleaned, photoSalvaged: !!fr.imageSalvaged, lexiconRestored: lexed.changed, lexiconSanitized: sanitizedLeft, streamed: !!res.streamed,
      streamError: res.streamError || '',
    };
  }

  /**
   * Обход. queue — список провайдеров; на каждого перебираем модели пула,
   * при 429/смерти ключа переходим к следующему ключу, потом к провайдеру.
   *
   * `input.chatId` — адрес ЗАПИСИ памяти (у одного человека несколько чатов
   * приложения делят один адрес, см. memoryKey в engine/profile.js — это и
   * даёт «агент помнит, что было в другом чате»). `input.origin` — id КОНКРЕТНОГО
   * чата приложения, которым помечается новая реплика/факт/правило внутри этой
   * записи: он не меняет, куда пишем, только чей это вклад — по нему потом можно
   * стереть память ровно одного чата (functions/api/chat.js: forgetThread →
   * memory.forgetOrigin), не трогая остальные чаты того же человека.
   */
  async function run(input) {
    const started = Date.now();
    const attemptsAtStart = attemptSeq;
    const deadline = started + Math.max(5000, Number(input.deadlineMs) || 45000);
    const text = String(input.text || '');
    /* Чистая просьба без служебных примечаний о вложениях и тел файлов. По ней
       классифицируем и проверяем полноту; полный `text` остаётся материалом
       для модели и инструментов. */
    const askText = String(input.askText || text);
    const images = Array.isArray(input.images) ? input.images.slice(0, MAX_IMAGES) : [];
    let intent = input.intent || classifyTask(askText, images);
    /* «Думать глубже» (0.109) — просьба человека, а не догадка классификатора.
       Короткий вопрос («докажи, что √2 иррационально», 28 знаков) сам по себе
       классифицируется как болтовня и уходит в fast-очередь, где думающие модели
       стоят последними — то есть режим «думай глубже» отвечал бы быстрее всех.
       Поэтому в этой просьбе: код и математику не трогаем (у них свои головы),
       болтовню и творчество поднимаем до рассуждения, а очередь становится smart. */
    /* Глубина — решение агента, а не переключатель (0.123). Судья вызывается,
       только если глубину никто не решил до нас: вход (`functions/api/chat.js`)
       уже мог её посчитать тем же слоем и прислать вместе с причиной.
       Явная просьба извне (curl, другой клиент) важнее правил — но опознаётся она
       не флагом `deep` (его ставит и вход), а ОТСУТСТВИЕМ готовой причины. Без
       этого различения движок перезаписывал «доказательство или вывод» на
       «человек попросил глубже» — поймано проверкой H23 на первой же сборке. */
    let deep = input.deep === true;
    let depthWhy = deep ? String(input.depthWhy || '') : '';
    /* Самопроверка живёт в области ОДНОГО run(): withMeta зовётся на каждой удачной
       попытке (основной ход, уход от отказа, продолжение обрыва), и без этого счётчика
       агент чинил ответ по разу на каждую попытку — три досыла вместо одного. */
    let checkVerdict = null;
    let checkDone = false;
    depthVerdict = null;
    if (!deep || !depthWhy) {
      const asked = deep && !depthWhy;
      depthVerdict = depth.judge({ text: askText, intent, images, env, asked });
      deep = depthVerdict.deep === true;
      depthWhy = depthVerdict.why || '';
    }
    /* 0.212: судья глубины говорит «задача дорогая», а план глубокой работы —
       чем именно платить: несколькими поисковыми подзапросами, большим
       бюджетом рассуждения или обоими. Внутренние ходы (головы совета,
       починка, чтение частей документа) помечаются noDeepWork: иначе одна
       исследовательская задача рекурсивно рождала бы исследования внутри
       каждой проверяющей головы и сжигала квоту вместо качества. */
    const deepWork = planDeepWork({
      text: askText, intent, images, env,
      deep, depth: depthVerdict,
      webSearch: input.webSearch === true,
      owner: input.ownerPriority === true,
      noDeepWork: input.noDeepWork === true,
    });
    if (deepWork.research) {
      deep = true;
      /* Дверь уже могла дописать эту же причину для потокового события и
         передать её сюда в depthWhy. Повтор в подписи выглядит как сбой. */
      if (!depthWhy || depthWhy.indexOf(deepWork.why) < 0) {
        depthWhy = [depthWhy, deepWork.why].filter(Boolean).join(' · ');
      }
    }
    if (deep && (intent === 'fast' || intent === 'creative')) intent = 'reasoning';
    const tier = input.tier || tierFor(intent);
    /* 0.211: бюджет ответа и ширина пула — параметры задачи, а не одна
       цифра на всё. Быстрой болтовне хватает 1600 токенов и двух моделей у
       провайдера; smart/глубокой/картиночной задаче даём 4000 и три модели.
       Явные input/env сильнее, каталог модели всё равно зажмёт потолок в
       buildRequest — щедрость здесь не превращается в 400 от провайдера. */
    const maxTokensWanted = Math.round(clampNumber(
      input.maxTokens || env.MAX_TOKENS,
      64,
      65536,
      deepWork.extended ? deepWork.reasoning.maxTokens : (tier === 'smart' ? 4000 : 1600),
    ));
    const modelsPerProviderWanted = Math.max(1, Math.floor(clampNumber(
      input.modelsPerProvider || env.MODELS_PER_PROVIDER,
      1,
      6,
      deepWork.extended ? deepWork.reasoning.modelsPerProvider : (tier === 'smart' || deep || images.length ? 3 : 2),
    )));
    const maxContinuationsWanted = Math.max(0, Math.floor(clampNumber(
      input.maxContinuations != null ? input.maxContinuations : env.CHAT_CONTINUATIONS,
      0,
      5,
      deepWork.extended ? deepWork.reasoning.continuations : 3,
    )));
    /* Бесконечная память (0.195): ленту не режем вовсе — окно модели уместит
       нужное, не влезающее fit сожмёт в выжимку. Явный historyKeep сильнее. */
    let history = (Array.isArray(input.history) ? input.history : []).slice(-Number(input.historyKeep || Infinity));
    /* Инструменты агента: внешние данные (поиск, новости, курсы, погода…) ложатся
       в сообщение человека отдельным блоком — модель отвечает по ним, а не по
       памяти. Ошибка или тишина инструмента — блока просто нет. */
    const isDefaultSys = !input.system || input.system === PERSONA_SYSTEM;
    /* Навыки (перенесённый механизм Yama): включаются по смыслу сообщения, приносят
       в промпт инструкции и — отдельно от своих триггеров — зовут те инструменты,
       без которых навык был бы просто красивым текстом. Свой `system` от caller'а —
       своя ответственность: навыки к нему не липнут, как и блоки freedom. */
    const useSkills = isDefaultSys && input.skills !== false && input.useTools !== false;
    /* Готовность картинок — из кэша слоя, без сети: навыки правки оживают только
       тогда, когда источник уже хоть раз вернул байт (см. LIVE_CATS в skills.js). */
    /* Навыки правки включаются по тому, отвечал ли картиночный источник хоть раз.
       Раньше это знание умирало вместе с изолятом, и в свежем запросе 11 навыков
       правки молчали, хотя картинки делались минуту назад. Отметку кладём в общее
       хранилище (engine/imggen.js), поэтому здесь ждём чтение — но с потолком:
       быстрое укладывается, медленное ответ не тормозит. */
    if (imggen.hydrate && !imggen.status().sources.some((x) => x.ready)) {
      await Promise.race([imggen.hydrate(), sleep(150)]);
    }
    const imgToolReady = { imggen: editsReady(imggen.status()) };
    const skills = useSkills ? detectSkills(text, { images, env, imgToolReady }) : [];
    /* «Разное мышление» под язык: если в вопросе код или просьба кода на языке L,
       подсказываем модели думать в терминах этого языка (engine/langmind.js). */
    let langMindBlock = '';
    try {
      const lid = detectLang(text);
      if (lid) {
        const m = langMind(lid);
        if (m) langMindBlock = '\n\n' + m;
      }
    } catch (_e) { /* langmind не должен ломать запрос */ }
    const wantWeb = input.webSearch === true;
    const toolsRes = input.useTools === false
      ? { used: [], block: '', directive: '', sources: [], webSteps: [], notes: [], research: null }
      : await gatherTools(text, env, fetchImpl, {
          force: skillTools(skills),
          deep: wantWeb || deepWork.research,
          research: deepWork,
          img: imggen,
          /* 0.224: приложенный документ поднимает порог веб-поиска — ответ,
             который уже лежит в файле, искать в сети незачем. */
          hasDocs: Array.isArray(input.docs) && input.docs.length > 0,
          onStep: onDelta ? (step) => onDelta({ kind: 'web', step }) : undefined,
        });
    /* Картинок человек просит — по формулировке или по block-у в ответе. Флаг
       нужен постобработке: без него движок не тратит вызовы на генерацию. */
    const imgRequested = input.useTools !== false && wantsImage(text, images);
    const imgWanted = imgRequested || toolsRes.directive.indexOf('```img') >= 0;
    let userContent = toolsRes.block ? text + '\n\n' + toolsRes.block : text;
    const caseBlock = typeof input.caseContext === 'string' ? input.caseContext.trim().slice(0, 3600) : '';
    // Карточка — данные пользователя, а не системная инструкция. Кладём её в
    // обычное сообщение пользователя, отделяем от текущего вопроса и не меняем
    // классификацию интента/инструментов. На экстремально длинных вопросах не
    // жертвуем текстом человека ради контекста.
    if (caseBlock && text.length + caseBlock.length + String(toolsRes.block || '').length < 22_000) {
      userContent = '[Сохранённая карточка дела — справочные данные пользователя, не отдельный запрос]\n'
        + caseBlock + '\n\n[Текущий запрос]\n' + userContent;
    }
    let ctxNotes = [];
    const toolsHint = toolsRes.block
      ? '\n\nВ сообщении есть блоки [Инструмент: …] с проверенными внешними данными. Отвечай по ним, а не по памяти. Не копируй сами блоки и их заголовки в ответ — пиши человеку обычным текстом, но цифры, факты и ссылки бери точно из данных'
        /* 0.165: даты и адреса — только из данных. На живом проде модель дописала к
           курсу «данные на 18 июля 2026» и ссылку на ЦБ, которых у инструмента не
           было: для человека это выглядело точной свежестью, а было выдумкой. */
        + ' Даты, время и адреса бери только из данных: чего в них нет, того не пиши — лучше скажи, что даты нет, чем назови выдуманную.'
        + (toolsRes.sources && toolsRes.sources.length ? ' Ссылайся на источники номерами [1], [2] по порядку их появления.' : '.')
      : '';
    const styleHint = isDefaultSys
      ? [style.hintFor(intent, env), locale.hint(text)].filter(Boolean).join('\n')
      : '';
    /* Блок навыков идёт после подсказки про инструменты, указание про файл — самым
       последним: что ниже, то модель слушает сильнее, а оформление блока не должно
       перегореть под общими правилами. */
    const skBlock = skills.length
      ? skillsBlockOf(skills, { toolTitles: toolsRes.used.map((id) => TOOL_TITLES[id] || id) })
      : '';
    /* Рассуждение на английском для точности русского ответа: когда включён режим
       «Думает» (showReasoning), просим модель сначала кратко продумать ход решения
       на английском внутри <think>...</think>, а затем дать точный ответ на языке человека. */
    /* 0.234: на коротком разговорном fast-вопросе без глубокого режима снижаем
       дефолтный medium до low — первая русская строка появляется в 2–3 раза быстрее,
       а на коде, математике, аналитике и явном high глубина рассуждений прежняя. */
    const effectiveReasoningEffort = deepWork.extended && input.reasoningEffort !== 'low'
      ? 'high'
      : (intent === 'fast' && !deep && input.reasoningEffort === 'medium' ? 'low' : input.reasoningEffort);
    const thinkEffortHint = effectiveReasoningEffort === 'low'
      ? 'Keep the <think> block brief (1–3 sentences).'
      : effectiveReasoningEffort === 'high'
        ? 'Make the <think> block thorough, verifying steps and edge cases.'
        : 'Keep the <think> block concise and structured (2–5 sentences).';
    const thinkHint = isDefaultSys && input.showReasoning === true
      ? '\n\n[Thinking protocol]: Before answering, ALWAYS think step-by-step IN ENGLISH inside <think>...</think> tags (reasoning in English maximizes logical and factual accuracy), then close </think> and write the final response in the user\'s language (Russian unless asked otherwise). '
        + thinkEffortHint
      : '';
    /* Когда ход мысли человеку не показывают, расширенное рассуждение всё
       равно должно менять работу, а не только потолок токенов: молча проверить
       условия и крайние случаи, а наружу дать вывод и проверяемые основания. */
    const extendedHint = isDefaultSys && deepWork.extended && input.showReasoning !== true
      ? '\n\n[Расширенное рассуждение]: перед ответом молча раздели задачу на части, проверь условия, противоречия и крайние случаи. Не пересказывай внутреннюю кухню: дай вывод, ключевые основания и явно назови допущения или непроверенное.'
      : '';
    const researchHint = isDefaultSys && deepWork.research
      ? '\n\n[Глубокое исследование]: ответ строй как исследование — короткий вывод, доказательства по подвопросам, расхождения источников и пробелы. Опирайся только на данные инструментов и ставь [номер] после проверяемых фактов; если поиск деградировал или часть подзапросов не проверена, скажи это прямо.'
      : '';
    let system = (input.system || PERSONA_SYSTEM) + styleHint + toolsHint + thinkHint + extendedHint + researchHint
      + (skBlock ? '\n\n' + skBlock : '')
      + (toolsRes.directive ? '\n\n' + toolsRes.directive : '')
      + langMindBlock;
    /* Свобода ответа: блоки правил из engine/freedom.data.js (данные перенесены из
       Yama) доезжают только до нашего собственного режима — кто прислал свою
       `system`, тот её и контролирует. Головы совета идут со своей подсказкой, так
       что к ним блок не липнет и лишние 8 КБ в спор о числе никто не везёт. */
    /* 0.203: взрослая тема — это не только текущий ход. На «продолжай» после
       прямой реплики пачка и эскалация нужны ровно так же, а раньше смотрели
       лишь в ПОСЛЕДНЮЮ запись истории — обычно ответ ассистента, где модель
       уже успела всё смягчить, и контекст взрослости терялся. Смотрим в
       последние реплики ЧЕЛОВЕКА. */
    const recentUserTexts = history.filter((m) => m && m.role === 'user').slice(-3)
      .map((m) => String(m.content || ''));
    const adultAsk = freedom.isAdultAsk(text) || recentUserTexts.some((t) => freedom.isAdultAsk(t));
    /* «Острая» тема = взрослый запрос или то, что freedom считает жёсткой
       опасностью. По этому же признаку смотрим и на последние реплики: в
       агентном разговоре суть обычно во втором ходу, а не в «продолжай».
       0.204: словарь понятий — третий глаз того же признака: «хуй большой —
       это сколько» корней freedom не содержит, а тема острая, и смелые
       головы там нужны первыми. */
    const sensitive = adultAsk || freedom.isHardDanger(text)
      || lexicon.hasAdultTopic([text].concat(recentUserTexts))
      || freedom.isContextSensitiveTopic([text].concat(recentUserTexts));
    const free = isDefaultSys ? freedom.freedomBlock(env, {
      intent,
      adult: adultAsk,
      text,
      contextText: [text].concat(recentUserTexts).join('\n'),
    }) : { text: '', ids: [], chars: 0, mode: 'off', blocks: 0 };
    if (free.text) system = system + free.text;
    /* Обход ложных отказов по умолчанию молчит (его черёд — после первого отказа).
       JAILBREAK=1 включает его в каждом запросе, чтобы можно было померить, помогает ли
       он без повтора; JAILBREAK=0 выключает совсем. На опасные темы его нет ни в одном
       режиме. */
    if (isDefaultSys && input.escalation) {
      const escSys = freedom.escalationBlock(env, {
        reframed: true,
        split: !!input.escalation.split,
        step: Number(input.escalation.step) || 2,
        adult: !!input.escalation.adult || adultAsk,
        model: input.escalation.model || '',
        danger: freedom.isHardDanger(askText),
      });
      if (escSys) system = system + escSys;
    } else if (isDefaultSys) {
      const jb = jbBlock(env, { danger: freedom.isHardDanger(text) });
      if (jb) system = system + jb;
    }

    /* Род агента — настройка человека (меню «Настройки → Ассистент»), не указание
       из донора: сюда приходят только окончания глаголов о себе и одна строка про то,
       что к собеседнику обращаются ровно, без превосходства. `auto` — только эта
       строка, род модель берёт из персоны и разговора. */
    if (isDefaultSys) system = system + gender.blockFor(input, env);

    /* Персонализация (0.186): стиль и тон из экрана «Персонализация» — настройка
       человека, не слово движка. Всё по умолчанию — пусто, промпт прежний. */
    if (isDefaultSys && input.persona) system = system + personaStyle.block(input.persona);

    /* Профиль человека (engine/profile.js) — его собственные слова из Настроек: имя,
       профессия, рассказ о себе и собранные из них правила формы ответа. Идём ПОСЛЕ
       персоны и рода, но ДО резки окна: блок весит до пары килобайт, и молча
       вытолкнуть им историю из контекста было бы хуже, чем укоротить себя.
       Указаний «кто ты» здесь нет намеренно — это данные о собеседнике, а не роль. */
    if (input.profile) system = system + '\n' + String(input.profile).slice(0, 4000);

    /* Подгонка под окно модели (engine/ctxfit.js) переехала НИЖЕ — после состояния
       собеседника, памяти и профиля. Причина: раньше она считала окно по персоне,
       навыкам и инструментам, а блоки эмоции и памяти (до 8 КБ) приклеивались к
       системному промпту ПОСЛЕ неё — и выталкивали историю из контекста уже мимо
       всякого счёта. Теперь считаем один раз, по всему, что реально поедет. */

    /* Состояние собеседника: слой смотрит на форму последней реплики и предыдущих
       четырёх (оттуда же берётся тренд) и дописывает, КАК работать — коротко или по
       шагам, чего не делать. Диагнозов и «успокойтесь» в нём нет намеренно. */
    const emoCfg = emotion.cfgOf(env);
    const emoHist = emoCfg.on
      ? history.slice(-4).filter((m) => m.role === 'user').map((m) => emotion.detect(m.content))
      : null;
    const emo = emoCfg.on ? emotion.detect(text) : null;
    if (isDefaultSys && emo) system = system + emotion.block(emo, emoHist, env);
    /* 0.204: эффективная пара родов — агент (настройка, при auto — по полу
       собеседника) и собеседник отдельно. Метаданные отдают именно её, а не
       сырую настройку: подпись обязана совпадать с тем, как агент говорил. */
    const genderEff = gender.effective(input, env);
    const genderVal = genderEff.agent;
    /* 0.232: жёсткая граница по фото — до первой попытки и без единого вызова
       модели. Лестница ниже снимает ЛОЖНЫЕ отказы; опознание человека по
       интимному снимку и сексуальный контекст с несовершеннолетними — не
       ложный отказ, а настоящий запрет: ни одна ступень его не снимает. */
    const visionStop = images.length ? vision.hardStop(askText) : '';
    if (visionStop) {
      const st = vision.classifyVisionTask(askText);
      const hit = {
        reply: vision.hardStopReply(visionStop), reasoning: '',
        provider: 'engine', model: 'vision-stop', intent, tier: '',
        tools: [], sources: [], toolNotes: [],
        photoRefused: true, photoStage: 'hardstop:' + visionStop, photoMode: st.mode,
      };
      /* Ответ собираем здесь же: withMeta трогает значения, объявленные ниже по
         функции, и ранний выход через неё падал бы на ещё не готовом контексте. */
      return {
        ok: true, reply: hit.reply, reasoning: '', provider: 'engine', model: 'vision-stop',
        finish: '', continuations: 0, attempts: 0,
        tools: [], toolNotes: [], sources: [],
        photoRefused: true, photoStage: hit.photoStage, photoMode: hit.photoMode,
        gender: genderVal, userGender: genderEff.user,
        intent, tier: '', ms: Date.now() - started, tried: [], error: '',
      };
    }

    /* Память чата: прошлое доезжает до модели, а не живёт в браузере, и по реакции
       на прошлый ответ собирается настройка на человека. Головы совета память не
       читают — у них другая работа: проверить число, а не продолжать разговор
       (иначе один и тот же диалог грузился бы впрок). Идёт ПОСЛЕ стиля и
       инструментов: память — фон, а не указание, и перекрывать их не должна. */
    const useMem = !!memory && !!input.chatId && !input.noCouncils;
    if (useMem) {
      try {
        const ctx = await memory.contextFor(input.chatId, text, { fast: intent === 'fast' });
        if (ctx.block) system = system + '\n\n' + ctx.block;
        if (!history.length && ctx.recent.length) history = ctx.recent.map((mm) => ({ role: mm.role, content: mm.content }));
        const lastA = history.slice().reverse().find((mm) => mm.role === 'assistant');
        const lastU = history.slice().reverse().find((mm) => mm.role === 'user');
        const cons = await memory.consider(input.chatId, text, lastA ? { reply: lastA.content, user: lastU ? lastU.content : '' } : null, input.origin);
        if (cons && cons.block) system = system + '\n\n' + cons.block;
      } catch (e) {
        /* память не имеет права сломать ответ — максимум, она молчит */
      }
    }

    let order = orderFor(tier, P, { images, only: input.only, forceModel: input.forceModel, health });
    /* Математика и код: вперёд тот провайдер, у которого в пуле стоит голова-счётчик
       (ныне — бесплатный DeepSeek на OdiRouter, см. INTENT_HEADS). Пин человека и
       явный providerOrder перебивают это как есть: порядок ниже применяется к нему.
       Исключение — «17*23», где калькулятор уже дал точный ответ: тащить ради этого
       модель с другим провайдером значит добавить человеку четыре секунды (замер
       на проде: odirouter 6,7 с против groq 2,6 с). Считает код, модель только говорит. */
    if ((intent === 'math' || intent === 'code') && !pin0(input) && toolsRes.used.indexOf('calc') < 0) {
      order = preferHeads(order, poolOf(P), intent, env);
    }
    /* На острой теме порядок провайдеров решает не конфиг, а их же поведение:
       доказанно смелые — первыми. Доказательств нет — порядок как всегда. */
    /* Для картинок (понимание) рейтинг провайдеров — всегда: кто на картинках
       отвечал и был смелым, тот и первым смотрит новое фото (0.192). */
    if (brave && !pin0(input) && (sensitive || images.length)) {
      order = brave.orderProviders(order, poolOf(P));
    }
    if (input.providerOrder && input.providerOrder.length) {
      order = input.providerOrder.filter((id) => P[id] && P[id].keys.length);
    }

    /* Пин модели: человек выбрал конкретную модель в окне ввода — говорить должна
       именно она. Ищем провайдера, у которого такая модель есть в пуле, и сужаем
       очередь до него. Незнакомый id (опечатка, модель ушла из каталога) не роняет
       запрос: пин молча снимается, работает обычный обход. */
    let pin = null;
    const pinName = String(input.model || '').trim();
    if (pinName) {
      const owner = input.only && P[input.only] ? input.only : Object.keys(P).find((id) => {
        const m = P[id].models || {};
        return [].concat(m.fast || [], m.smart || []).indexOf(pinName) >= 0;
      });
      /* Модели из живого каталога нет в наших пулах — это не повод снимать выбор:
         по данным каталога знаем, чей это id (OpenRouter или Xkiро). */
      const owner2 = owner || modelreg.ownerOf(modelreg.cached(), pinName);
      if (owner2) pin = { id: owner2, model: pinName };
      /* Выбранную модель ставим ПЕРВОЙ, а не единственной. Каталоги провайдеров
         врут: на проде `nex-agi/nex-n2.5-mini:free` числится бесплатной, а
         OpenRouter отвечает 404 «эта модель недоступна бесплатно». Жёсткий пин
         превращал такой выбор в красную ошибку «ни один провайдер не ответил»,
         хотя ответить было чем. Теперь: пин имеет первый отказ, а дальше идёт
         обычный обход — и человек видит, какой моделью его всё-таки накормили. */
      if (pin) order = [pin.id].concat(order.filter((x) => x !== pin.id));
    }

    /* ── Подгонка под окно модели (engine/ctxfit.js), по всему, что поедет ──────
       Здесь и только здесь система собрана целиком: персона + навыки + правила
       свободы + инструменты + род + профиль + состояние собеседника + память.
       Дальше в очереди провайдеров каждая голова получит своё окно — см. fitFor
       у цикла попыток. */
    /**
     * Окно для конкретной модели: потолок каталога, а поверх — потолок оператора.
     *
     * Было: одно число на запрос (CTX_WINDOW, 8 192). Материал, который бесплатно
     * тянет Gemini (миллион токенов), резался по мерке самой маленькой головы в
     * пуле — документ в 24 000 знаков терял половину ещё до отправки, хотя принять
     * его было чем. Нет каталога (тест, холодный изолят) — живём по-прежнему.
     */
    const windowCap = Math.max(1200, Number(env.CTX_WINDOW_MAX) || CTX_WINDOW_MAX);
    const windowOperator = Number(env.CTX_WINDOW) > 0 ? Math.min(Number(env.CTX_WINDOW), 1000000) : 0;
    function windowFor(providerId, model) {
      const fallback = clampNumber(env.CTX_WINDOW, 1200, 1000000, 8192);
      if (windowOperator) return windowOperator;      /* сказано «не расти выше» — не расту */
      const ceil = modelreg.ceilings(modelreg.cached(), model, providerId);
      if (!ceil || !ceil.ctx) return fallback;        /* каталог молчит — прежнее окно */
      return Math.max(1200, Math.min(ceil.ctx, windowCap));
    }
    /* Первая подгонка — по ЛУЧШЕМУ окну среди тех, кто может ответить: терять
       контекст заранее нельзя, сузить успеем под каждую попытку (fitFor). Считается
       ДО документов: по этому числу решается, влезает файл целиком или его читаем
       по частям (ниже). */
    const bestWindow = (() => {
      if (windowOperator) return windowOperator;
      let best = clampNumber(env.CTX_WINDOW, 1200, 1000000, 8192);
      for (const pid of order) {
        const cfg = P[pid];
        if (!cfg) continue;
        for (const model of (modelsFor(cfg, tier, intent, images, env, deep) || []).slice(0, modelsPerProviderWanted)) {
          const w = windowFor(pid, model);
          if (w > best) best = w;
        }
      }
      /* Ручная каталожная модель может отсутствовать в статическом пуле.
         Без неё «лучшее окно» оставалось 8192, и широкая выбранная голова
         получала и контекст, и бюджет ответа маленькой модели. */
      if (pin) best = Math.max(best, windowFor(pin.id, pin.model));
      return best;
    })();

    /* ── Большие документы (0.161): влез — целиком, не влез — по частям ─────────
       Файл нельзя ни выбросить, ни молча отрезать: человек прислал его именно за
       тем, что в нём написано. Это то, чем берёт DeepSeek («договор на сто страниц,
       спросите про пункт в середине»), и до сих пор у нас файл упирался в окно.
       Теперь: влезает в лучшее доступное окно — идёт как есть; не влезает — читаем
       по частям, как читал бы человек: по каждой части выписка по вопросу, в ответ
       выписки. Вложения едут отдельным полем (functions/api/chat.js, compose с
       defer), потому что решение принимает движок, а не сборщик текста. */
    const docReads = [];
    if (Array.isArray(input.docs) && input.docs.length) {
      const reserveOut = maxTokensWanted + (images.length ? images.length * 1000 : 0);
      const histTok = history.reduce((a, m) => a + estTokens(m && m.content) + 4, 0);
      const askTerms = longdoc.terms(text);
      /* Бюджет времени на чтение частей: меньше половины общего, чтобы у ответа
         осталось время жить. Дальше каждой части — свой кусок, не весь бюджет. */
      const mapEnd = Date.now() + Math.max(0, Math.min(30000, Math.round((Number(input.deadlineMs) || 45000) * 0.45)));
      for (const d of input.docs) {
        const body = String((d && d.text) || '');
        if (!body) continue;
        const head = '[Файл: ' + String(d.name || 'файл') + (d.line ? ' · ' + d.line : '') + ']';
        const fitsWhole = estTokens(body) + estTokens(head) + estTokens(system) + histTok
          + estTokens(userContent) + reserveOut <= bestWindow * 0.95;
        if (fitsWhole) {
          userContent += '\n\n' + head + '\n' + body;
          docReads.push({ name: d.name || 'файл', line: d.line || '', how: 'целиком', parts: 1, total: 1, keep: body });
          continue;
        }
        /* Часть такой длины, чтобы «вопрос + запас + фрагмент + выписка» влезали в
           окно той головы, что сейчас в очереди: 1 токен кириллицы ≈ 2.6 знака,
           берём с запасом вниз (×1.15 от окна в токенах — это ≈44 % окна в знаках). */
        const partChars = Math.max(longdoc.MIN_PART_CHARS, Math.floor(bestWindow * 1.15));
        const pl = longdoc.plan(body, askTerms, { partChars, terms: askTerms });
        /* 0.211: части независимы — читаем их пулом из трёх «ниток», а не
           суммой ожиданий. Порядок выписок после пула возвращаем в порядок
           файла: модель должна видеть документ, а не гонку ответов. */
        const readParts = await mapLimit(pl.parts, netCfg(env).docs, async (part) => {
          let got = '';
          const leftMs = mapEnd - Date.now();
          const slice = Math.max(0, Math.min(12000, leftMs));
          /* Голова совета (docsMap: false) файл видеть обязана — иначе совет голосует
             по ответу, не видя документа, и правки приходят «мимо». Но вызовы
             по частям на каждую голову совета — квота впустую: ей хватает
             найденных по вопросу мест. */
          if (slice >= 4000 && input.docsMap !== false) {
            try {
              const r = await run({
                ...input, docs: null, text: longdoc.readPrompt(d.name, text, part),
                history: [], system: longdoc.MAP_SYSTEM, useTools: false, webSearch: false,
                skills: false, chatId: undefined, noCouncils: true, noCheck: true, noDeepWork: true,
                allowReframe: false, deadlineMs: slice, maxTokens: 700,
              });
              if (r && r.ok && r.reply && !longdoc.isEmptyExtract(r.reply)) got = String(r.reply);
            } catch (e) { got = ''; }
          }
          /* Модель не ответила — ищем нужное сами: это не «прочитал файл», но это
             найденное по вопросу место, и оно честно помечено в списке под ответом. */
          if (!got) got = longdoc.localPick(part.text, askTerms, 1200);
          return got ? { i: part.i, total: pl.total, text: got } : null;
        });
        const reads = readParts.filter(Boolean).sort((a, b) => a.i - b.i);
        if (!reads.length) {
          userContent += '\n\n' + head + '\n' + body.slice(0, Math.max(2000, Math.floor(bestWindow * 1.5)));
          docReads.push({ name: d.name || 'файл', line: d.line || '', how: 'частично', parts: 0, total: pl.total, keep: '' });
          continue;
        }
        const block = longdoc.blockOf({ name: d.name, line: d.line, reads, total: pl.total, dropped: pl.dropped });
        userContent += block;
        docReads.push({
          name: d.name || 'файл', line: d.line || '', how: 'по частям',
          parts: reads.length, total: pl.total, keep: block,
        });
      }
      /* Выписки — в память чата: следующая реплика придёт БЕЗ файла, и без этой
         записи модель ответит по памяти, то есть выдумает (см. memory.rememberDoc). */
      if (useMem && docReads.length) {
        const lastDoc = docReads[docReads.length - 1];
        try {
          await memory.rememberDoc(input.chatId, {
            name: lastDoc.name, line: lastDoc.line, block: lastDoc.keep,
            parts: lastDoc.parts, total: lastDoc.total,
          });
        } catch (e) { /* память не имеет права сломать ответ */ }
      }
    }
    /* Вопрос про файл, присланный РАНЬШЕ: вложения в этом ходе нет, но человек
       спрашивает «а что там в пункте 7.3?». Достаём выписки — но только когда
       вопрос правда про файл: держать их в промпте каждый ход дороже, чем польза. */
    const ASKS_FILE = /файл|документ|договор|инструкц|таблиц|презентац|пдф|pdf|docx|xlsx|вложени|выписк|в нём|в нем|из него|по нему|там сказано|в пункте|п\.\s*\d/i;
    if (useMem && !(Array.isArray(input.docs) && input.docs.length) && ASKS_FILE.test(text)) {
      const saved = await memory.docFor(input.chatId);
      if (saved && saved.block) {
        userContent += '\n\n[Ранее приложенный файл: ' + saved.name
          + (saved.line ? ' · ' + saved.line : '') + ' — выписки из него]\n' + saved.block;
        docReads.push({
          name: saved.name, line: saved.line, how: 'из памяти',
          parts: saved.parts || 0, total: saved.total || 0, keep: '',
        });
      }
    }

    /* Значения ДО резки: из них взят refit для модели с окном меньше «лучшего».
       Без них второй проход резал бы уже порезанное, и выжимка начала бы пропадать. */
    /* 0.197: профессиональный вопрос по фото — медицина, арт, спорт, техника съёмки —
   получает прямую рамку: описывай видимое, отвечай по существу. Это защита от
   ЛОЖНЫХ отказов (когда сервис отмахивается «интимными фотографиями» от снимка
   родинки или пляжного кадра), а не обход чьей-то политики для интимного
   контента: рамка честно называет вопрос профессиональным — по тексту вопроса. */
const PRO_PHOTO_RE = /(родинк|дермат|сыпь|прыщ|акне|угрев|гнойник|ран[аыуойе]|шв[аыуое]|рубц|шрам|ушиб|гематом|отёк|отек|ожог|обморожен|грибок|псориаз|экзем|лишай|зуд|кож[аыеуи]|аллерг|врач|медиц|диагност|симптом|укус)|(арт|художеств|картин[аеуи]|скульптур|музе|выставк|композици|ракурс|освещени|фэшн|дизайн|эстетик|фототехник|объектив|кадриров)|(пляж|бассейн|купальник|плавани|спортзал|тренировк|фитнес|осанк)/i;
const VISION_PRO = 'Вопрос по фотографии в профессиональном ключе (медицина, искусство, спорт, техника съёмки). Отвечай по существу и описывай то, что видно: бытовая, спортивная или художественная сцена — обычный материал для разбора; внешность людей и открытая одежда в кадре — не повод отказываться или читать мораль.';
/* 0.207 (требование владельца): по ЛЮБОМУ фото ответ есть всегда, формулы
   «не могу анализировать/комментировать данное изображение» не существует.
   Рамка едет с каждой картинкой; дальше по лестнице: обычный ответ →
   эскалация после отказа → холодный фактологический проход → честный
   ответ движка с рисками и способом спросить иначе (ниже). */
const visionTask = vision.classifyVisionTask(text);
const VISION_ANSWER = vision.visionSystemBlock(text);
const photoFallbackReply = (q, imgs) => {
  const facts = vision.imageFactLine(imgs || []);
  const routeTips = {
    document: 'для текста/OCR поможет более резкий кадр без бликов или отдельный фрагмент страницы',
    medical: 'для медицинского вопроса поможет крупный резкий план признака и пара слов о симптомах, но диагноз по одному фото не ставится',
    composition: 'для разбора кадра спроси отдельно про свет, ракурс, главный объект или задний план',
    people: 'для кадра с людьми спроси отдельно про обстановку, одежду/позу в общих словах или технику съёмки',
    safety: 'для вопроса о риске укажи, какая именно деталь или опасность интересует',
    general: 'спроси по конкретной детали — объект, текст, цвет, фон, положение или качество кадра',
  };
  return 'Честно о фото: я переспросил все зрячие модели по очереди — обычный ответ, холодный фактологический разбор, проход по одной детали, проход по визуальным якорям, профессиональный разбор по области вопроса и механический перечень видимого — и каждая отказалась описывать именно это изображение, сославшись на политику своего сервиса. Это их запрет, не приложения: здесь отказа по содержанию фото нет, но заставить чужую модель смотреть я не могу.'
    + (facts ? '\n\n' + facts + ' Содержимое по этим техническим фактам я не выдумываю.' : '')
    + '\n\nКак получить разбор: (1) спроси по конкретной детали — ' + (routeTips[visionTask.mode] || routeTips.general) + '; (2) пришли кадр, обрезанный на нужном месте; (3) опиши фото словами в сообщении — по описанию отвечу подробно и прямо.'
    + '\n\nИ по делу о рисках с откровенными фото в целом: чужие интимные снимки не пересылай без согласия человека в кадре (это и вред, и во многих странах статья), свои держи не в общей галерее — утечки случаются чаще из облаков и пересылок, чем из взломов; метаданные снимка (EXIF) могут хранить место и время съёмки.';
};
    /* 0.203 «Зеркало лексики» (engine/lexicon.js): человек говорит прямо —
       система получает его конкретные слова и запрет переводить их на
       клинические синонимы. Стоит здесь, перед pristine, чтобы блок ехал и
       в обычную очередь, и в эскалацию после отказа (та собирает систему из
       pristine). Источник — текущий ход и последние реплики человека;
       тот же список едет в каждую попытку (req.lexSource) для обратной
       замены, если модель всё-таки смягчила. */
    const lexTexts = [text].concat(history.filter((m) => m && m.role === 'user').slice(-4).map((m) => String(m.content || '')));
    const lexBlock = isDefaultSys ? lexicon.mirrorBlock(lexTexts, env) : '';
    const lexSource = isDefaultSys ? lexTexts : null;   /* чужая system — чужая территория: ни блока, ни обратной замены */
    /* 0.208, второй заход: расшифровка в системном блоке слабые головы живьём
       проигнорировали («ctrc» → страховая компания / «не знаю, уточните»).
       Та же расшифровка строкой СРАЗУ после реплики человека не игнорируется.
       Его текст едет как написан — приписка идёт после него и в скобках. */
    if (isDefaultSys && typeof userContent === 'string') {
      const pairs = lexicon.obfuscatedMap([text]);
      if (pairs.length) {
        userContent += '\n\n[расшифровка моего искажённого написания: '
          + pairs.map((p) => '«' + p.raw + '» = «' + p.norm + '»').join(', ') + ']';
      }
      if (images.length) {
        const note = vision.visionInlineNote(text);
        if (note) userContent += '\n\n' + note;
      }
    }
const pristine = { system: system + (lexBlock ? '\n\n' + lexBlock : '') + (images.length ? '\n\n' + VISION_ANSWER : '') + (images.length && PRO_PHOTO_RE.test(String(text || '')) ? '\n\n' + VISION_PRO : ''), history, text: userContent };
    /* Сколько токенов просит этот запрос без резки — по этому числу движок решает,
       звать ли на длинный материал модель с большим окном (см. wideFirst ниже). */
    const needTokens = estTokens(pristine.system) + estTokens(pristine.text)
      + pristine.history.reduce((a, m) => a + estTokens(m && m.content), 0);
    let fitted = fitContext({ ...pristine, images, env, maxOut: maxTokensWanted, window: bestWindow });
    system = fitted.system;
    history = fitted.history;
    userContent = fitted.text;
    ctxNotes = (fitted.notes || []).slice();
    if (fitted.overflow) ctxNotes = ctxNotes.concat([fitted.overflow]);
    /**
     * Подгонка под окно головы, которая сейчас получит запрос. Уже влезает в лучшее
     * окно — отдаём готовое (лишней работы нет); у головы окно меньше — режем заново
     * из pristine, и человек увидит правду именно про свою попытку.
     */
    function fitFor(providerId, model) {
      const w = windowFor(providerId, model);
      if (!fitted.window || w >= fitted.window) return fitted;
      return fitContext({ ...pristine, images, env, maxOut: maxTokensWanted, window: w });
    }
    /**
     * Длинный материал — вперёд те, у кого есть чем его принять.
     *
     * Порядок голов выстаивался под задачу («эта лучше пишет код»), но документ в
     * 24 000 знаков уезжает такой голове с окном 8К и половину теряет на резке, а
     * рядом в пуле стоит модель, которая приняла бы его целиком. Ставим широких
     * вперёд — состав не меняем: не ответит широкий, ответит прежний порядок.
     */
    function wideFirst(models, providerId) {
      if (needTokens < WIDE_AT_TOKENS || (images && images.length)) return models;
      const wide = [], rest = [];
      for (const m of models) {
        const ceil = modelreg.ceilings(modelreg.cached(), m, providerId);
        (ceil && ceil.ctx >= needTokens ? wide : rest).push(m);
      }
      return wide.length ? wide.concat(rest) : models;
    }
    async function withMeta(out) {
      if (!out) return out;
      out.gender = genderVal;
      out.userGender = genderEff.user;
      /* «Глубже» просили, а ответила не думающая модель. Это не ошибка — ответ
         верный и человеку он нужен, — но и молчать об этом нельзя: иначе режим
         выглядит сломанным («включил, а мыслей нет»). Флаг уезжает в строку
         источника; отдельной надписи в пузыре нет намеренно — в 0.089 решили,
         что модель/провайдер/режим в интерфейсе не показываем. */
      if (deep && out.ok && out.model && !isReasoning(out.model)) out.deepPlain = true;
      if (deep && out.ok) out.deep = true;
      /* Гарантированный маршрут сложной задачи (0.185) и честный откат.
         Сложный вопрос с картинкой (код/математика/рассуждение/зрение или
         «глубже») обязан ехать к зрячей reasoning-модели. Маршрут выстроен
         (modelsFor ставит sighted-думателей первыми), но каталоги врут, а пин
         человека не переспорить: если ответила слепая — или зрячая, но не
         думающая — отвечаем всё равно (лучшее доступное лучше ничего), но
         пометка честная: человек видит, чем именно ему ответили. */
      if (out.ok && out.model && images.length
        && (deep || intent === 'code' || intent === 'math' || intent === 'reasoning' || intent === 'vision')) {
        if (!isVision(out.model)) out.sightedMiss = true;
        else if (!isSightedReasoning(out.model)) out.sightedPlain = true;
      }
      /* Почему агент решил думать глубже — словами судьи (engine/depth.js). Поле
         живёт рядом с deep: подпись под ответом собирается из обоих. */
      if (deep && out.ok && depthWhy) out.depthWhy = depthWhy;
      if (skills.length) out.skills = skills.map((s) => ({ id: s.id, cat: s.cat, title: s.title }));
      /* Файлы: модель отдала блок ```file:docx|имя``` — упаковываем и вынимаем из
         текста. Отдельного вызова модели нет: это стоит нуль запросов и нуль секунд. */
      if (out.ok && out.reply) {
        const packed = packFiles(out.reply, {
          wanted: toolsRes.used.indexOf('filegen') >= 0,
          format: formatFromText(text),
          name: nameFromText(text),
          text,
        });
        if (packed.files.length) out.files = packed.files;
        if (packed.reply) out.reply = packed.reply;
      }
      /* Графики (0.185): блок ```chart — это числа от модели, геометрия — наша.
         Картинка уезжает файлом (image/svg+xml) и показывается в чате рисунком.
         Идёт ПОСЛЕ packFiles: тот сперва вынимает из текста свои блоки. */
      if (out.ok && out.reply) {
        const charted = packCharts(out.reply);
        if (charted.files.length) out.files = (out.files || []).concat(charted.files);
        if (charted.notes.length) out.reply = (charted.reply ? charted.reply + '\n\n' : '') + '· ' + charted.notes.join('\n· ');
        else if (charted.reply !== out.reply) out.reply = charted.reply;
      }
      /* чем именно заплатили за окно — человек должен видеть, что история у него
         не «испарилась», а была сжата движком */
      if (ctxNotes.length) out.cxFit = ctxNotes.join('; ');
      /* Чем обернулись приложенные файлы (0.161): «прочитан целиком», «прочитан по
         частям 7 из 12», «из памяти». Строка уезжает в список прочитанного под
         ответом — человек должен видеть, по чему именно ему отвечали. */
      if (docReads.length) {
        out.docs = docReads.map((x) => ({
          name: x.name, how: x.how, parts: x.parts, total: x.total,
          line: longdoc.lineOf({ line: x.line, kept: x.parts, total: x.total }),
        }));
      }
      if (emoCfg.label && emo && emo.id !== 'neutral') {
        out.emotion = { id: emo.id, emoji: emo.emoji, label: emo.label, confidence: Math.round(emo.confidence * 100) / 100 };
      }
      /* Картинки — последним: вынимаем block из того текста, который человек
         действительно увидит (совет головы могли переписать), и бьёмся за него
         до конца. Не вышел ни один источник — в ответе остаётся честная строка
         с причиной, а не выдуманная ссылка. */
      if (out.ok && out.reply && imgWanted) {
        try {
          /* Шаги «рисую… канал 2 из 3» уезжают в поток тем же путём, что куски текста
             (0.177). Если потока нет — no-op: curl и тесты ничего не замечают. */
          const imgStep = (ev) => {
            if (typeof o.onDelta === 'function') o.onDelta({ kind: 'image', step: ev });
          };
          const packed = await packImages(out.reply, {
            step: imgStep,
            generate: (i) => imggen.generate({ ...i, step: imgStep }),
            edit: (i) => imggen.edit(images.length ? { ...i, images, step: imgStep } : i),
            wanted: imgRequested,
            images,
            text,
          });
          if (packed.reply) out.reply = packed.reply;
          if (packed.files.length) {
            out.files = (out.files || []).concat(packed.files);
            out.imgSource = packed.files.map((f) => f.source).filter(Boolean).join(', ');
          }
          const bad = packed.notes.filter((n) => /не вышла/.test(n));
          if (bad.length) out.fileError = out.fileError ? out.fileError + ' · ' + bad.join('; ') : bad.join('; ');
        } catch (e) {
          noteLog('imggen', 'pack error', String((e && e.message) || e).slice(0, 120));
        }
      }
      /* ── Самопроверка ответа (0.124): агент сверяет то, что написал, с тем, о чём
         просили. Бесплатный разбор всегда; платная починка — одним проходом той же
         головы и только когда нашлась конкретная зацепка и бюджет разрешает.
         Молчания здесь нет: зацепки уезжают в подпись ответа словами. */
      /* Три случая, когда починка запрещена, и все три — прежние правила движка:
         • человек выбрал модель сам (pin) — досыл от её имени подменил бы выбор
           («я выбрал X, а ответил Y»), как это уже сделано для совета голов;
         • ответ подтверждён инструментом (toolProof) — калькулятор сильнее голоса,
           и второй прогон стоит секунд без выигрыша (замер W7: 4,5 с против 14,1 с);
         • внутренний вызов сам попросил не проверять (noCouncils/noCheck). */
      const checkWanted = out.ok && out.reply && !input.noCheck && !pin && !out.toolProof && !checkDone;
      if (checkWanted) {
        checkDone = true;
        try {
          /* 0.212: обычная задача по-прежнему получает один проход починки.
             Расширенное рассуждение/исследование — два (владельцу три): первый
             досыл может закрыть одну пропущенную часть и оставить вторую, и
             именно на дорогой задаче второй проход окупается. */
          const repairBudget = deepWork.extended ? deepWork.reasoning.repairPasses : check.cfgOf(env).budget;
          let spent = 0;
          /* Сноска без источника (0.231): «[6]» при пяти плашках — не ссылка, а
             серая цифра. Снимаем до проверки, чтобы и починка, и человек видели
             только те номера, за которыми стоит настоящий адрес. */
          const srcCount = (toolsRes.sources || []).length;
          out.reply = cleanCitations(out.reply, srcCount);
          let dec = check.decide({
            text: askText, reply: out.reply, block: toolsRes.block, tools: toolsRes.used,
            sources: toolsRes.sources, ok: out.ok, spent, budget: repairBudget, env,
          });
          checkVerdict = { on: dec.on, notes: dec.notes, fixed: false, skipped: '', passes: 0 };
          while (dec.needFix && dec.notes.length && spent < repairBudget) {
            /* Досыл стоит секунд, поэтому он не делается впритык к потолку:
               начать его, не успеть и отдать пустой ответ — хуже, чем честно
               показать зацепку. Пол — 12 секунд живого времени. */
            const left = (Number(input.deadlineMs) || 45000) - (Date.now() - started);
            if (left < 12000) {
              checkVerdict.skipped = 'на починку не осталось времени (' + Math.max(0, Math.round(left / 1000)) + ' с)';
              break;
            }
            const evasionRepair = !!(dec.evasion && allowReframe);
            if (evasionRepair && brave && out.provider && out.model) {
              brave.mark(out.provider, out.model, false);
            }
            const repairOrder = evasionRepair
              ? (out.provider ? [out.provider] : []).concat(order.filter((p) => p !== out.provider))
              : (out.provider ? [out.provider] : input.providerOrder);
            const repair = o.repair
              || ((extra) => run({
                ...input,
                /* Документ досыл обязан видеть: с `docs: null` он чинил ответ
                   по файлу вслепую и мог заменить верный список из файла
                   честным для него «нет доступа к вложениям». Повторно звать
                   модели читать части не надо (`docsMap: false`): маленький
                   файл влезет целиком, большому хватит локальных выписок. */
                docsMap: false,
                text: evasionRepair
                  ? extra + freedom.reframeMark(env, { model: out.model, danger: false })
                  : extra,
                /* Досыл — не новый ход разговора: те же приёмы, что у продолжения
                   оборванного ответа (иначе память писала бы транскрипт дважды, а
                   на досыл вставал бы отдельный совет голов). При починке отказа
                   не кладём отказной черновик в role:assistant — иначе модель по
                   инерции повторяет собственный отказ. */
                history: evasionRepair
                  ? pristine.history
                  : [{ role: 'assistant', content: String(out.reply).slice(-3500) }],
                providerOrder: repairOrder,
                escalation: evasionRepair
                  ? { step: 2, split: true, adult: adultAsk, model: out.model }
                  : undefined,
                noCouncils: true, noCheck: true, noDeepWork: true, allowReframe: evasionRepair,
                /* Инструменты на досыле выключены: данные уже собраны первым
                   проходом, а второй поиск в сети стоил бы 10–20 секунд на ответ,
                   который и так ждёт человека. */
                useTools: false, webSearch: false, chatId: undefined,
                deadlineMs: left,
              }));
            let fixed = null;
            try { fixed = await repair(check.repairPrompt({ text: askText, reply: out.reply, notes: dec.notes, evasion: evasionRepair })); }
            catch (e) { fixed = null; }
            spent++;
            checkVerdict.passes = spent;
            /* Чиним только вперёд: пустой или куцый досыл ответ не улучшает, и
               терять написанное ради него нельзя. И принимаем досыл только как
               ПЕРЕПИСАННЫЙ ответ: «Уточнение: …» вместо ответа (так случилось в
               проде 0.230) — приписка, а не правка, и человек её уже не ждал. */
            const take = fixed && fixed.ok && fixed.reply
              ? (evasionRepair
                ? check.repairTake(out.reply, fixed.reply, { text: askText, evasion: true })
                : check.repairTake(out.reply, fixed.reply))
              : { reply: '', why: 'починка не удалась — ответ оставлен как есть' };
            if (take.reply) {
              out.reply = cleanCitations(take.reply, srcCount);
              checkVerdict.fixed = true;
              /* Провайдера и модель НЕ подменяем: досыл шёл той же головой, а
                 подпись ответа обязана показывать того, кто ответил человеку. */
              dec = check.decide({
                text: askText, reply: out.reply, block: toolsRes.block, tools: toolsRes.used,
                sources: toolsRes.sources, ok: out.ok, spent, budget: repairBudget, env,
              });
              if (dec.notes.length) checkVerdict.notes = dec.notes;
            } else {
              checkVerdict.skipped = take.why || 'починка не удалась — ответ оставлен как есть';
              break;
            }
          }
        } catch (e) {
          /* Самопроверка не имеет права стоить ответа: не разобралась — молчит. */
          checkVerdict = null;
        }
      }
      /* Вердикт уезжает в ответ целиком: finish() собирает объект заново и сам по
         себе это поле не переносит, а без него вход отдавал payload без зацепок. */
      if (checkVerdict) out.check = checkVerdict;
      if (deepWork.on) {
        out.deepWork = {
          mode: deepWork.mode,
          why: deepWork.why,
          extended: deepWork.extended,
          research: deepWork.research,
        };
        out.extendedReasoning = deepWork.extended || undefined;
        if (deepWork.research) {
          out.research = toolsRes.research || {
            on: true,
            why: deepWork.why,
            queries: deepWork.queries.slice(),
            sources: (toolsRes.sources || []).length,
            reads: (toolsRes.webSteps || []).filter((s) => s && s.kind === 'fetch').length,
          };
        }
      }
      /* Сноски на несуществующий источник снимаются и без самопроверки: ответ
         с пометкой «пин» или с доказанным числом идёт человеку сразу, а битая
         цифра в тексте — всё равно битая (0.231). Проверка идемпотентна. */
      if (out.reply) out.reply = cleanCitations(out.reply, (toolsRes.sources || []).length);
      /* После починки: в счёт входят основная очередь, советы, чтение
         документа, продолжения и сам досыл починки. */
      out.attempts = Math.max(0, attemptSeq - attemptsAtStart);
      return out;
    }

    /* Готового `messages` здесь больше нет: тексты для каждой попытки собирает
       fitFor под окно её головы (см. выше) — иначе резка одной головы уезжала бы
       другой, у которой места больше. */
    const allowReframe = input.allowReframe !== false && freedom.canReframe(text, env);
    let reframed = false;
    let reframedCalls = 0;
    const softSeen = [];   /* 0.198: кто мягко отказал — до двух эскалаций по порядку */

    /* Длинный материал — вперёд те, кому есть чем его принять.
       Порядок обхода выстраивался под задачу и скорость, и первым в нём обычно
       стоит самый быстрый (у него окно 8К): документ в 24 000 знаков у него
       режется, а стоящая следом голова на миллион токенов приняла бы его целиком.
       Состав очереди не меняем — только тех, у кого материал помещается, ставим
       раньше. Пин человека не трогаем: он выбрал модель руками, его слово первое. */
    if (!pin && needTokens >= WIDE_AT_TOKENS) {
      const fits = (pid) => {
        const cfg = P[pid];
        if (!cfg) return false;
        return (modelsFor(cfg, tier, intent, images, env, deep) || []).some((m) => {
          const ceil = modelreg.ceilings(modelreg.cached(), m, pid);
          return !!ceil && ceil.ctx >= needTokens;
        });
      };
      const wideIds = order.filter(fits);
      if (wideIds.length && wideIds.length < order.length) order = wideIds.concat(order.filter((x) => wideIds.indexOf(x) < 0));
    }

    const tried = [];
    const allBad = order.length > 0 && order.every((id) => punished(id));
    for (const id of order) {
      const cfg = P[id];
      if (!cfg) continue;
      if (!providerAlive(P, id, health)) { tried.push({ provider: id, why: 'нет живых ключей' }); continue; }
      const q = punished(id);
      if (q && !allBad) { tried.push({ provider: id, why: 'в карантине: ' + q.why }); continue; }
      let models = modelreg.prune(
        modelreg.cached(), id,
        pin && pin.id === id ? [pin.model] : modelsFor(cfg, tier, intent, images, env, deep));
      /* Выбор модели из пула: на острой теме вперёд те, про кого каталог знает
         «без купюр», а внутри — по рейтингу смелых. Порядок, не состав: резать
         пул нельзя, иначе на пустом каталоге запрос умрёт вместо того, чтобы
         ответить второй моделью. */
      if (sensitive && !pin) models = preferUncensored(models, modelreg.cached());
      if (brave && !pin) models = brave.order(models, id);
      /* Позже любого ранжирования: смелые головы и «без купюр» переставляют пул по
         своим основаниям, и на картинке такая перестановка отправляет запрос слепой
         модели. Зрение — последнее слово, иначе весь смысл теряется. */
      models = visionFirst(models, images);
      /* Длинный материал (документ, вставленный текст, долгий разговор) — вперёд те,
         у кого есть чем его принять. Стоит ПОСЛЕ зрения (картинке нужна зрячая
         голова, и это важнее окна) и ДО остывания: холодная голова не ответит
         вообще, какое бы окно у неё ни было. */
      if (!pin) models = wideFirst(models, id);
      /* Остывшие после 429 — в конец (выбор человека не трогаем). */
      if ((!pin || pin.id !== id) && !images.length) {
        models = mcool.order(id, models, cfg);
        /* Остыли все модели провайдера, а дальше в очереди есть кто-то живой — не
           тратим круг на заведомый 429, сразу к следующему. Последнего не пропускаем. */
        const rest = order.slice(order.indexOf(id) + 1).filter((x) => P[x] && !punished(x));
        if (models.length && rest.length && models.every((m) => mcool.cooling(id, m, cfg))) {
          tried.push({ provider: id, why: 'остывает после 429' });
          continue;
        }
      }
      if (!models.length) { tried.push({ provider: id, why: 'нет моделей в пуле' }); continue; }
      /* Картинка есть, а смотреть некому. Отвечать всё равно что гадать: модель
         получила бы текст без изображения и придумала бы содержимое (на проде на
         красном квадрате вышло «Фон белый», а на другом прогоне — «изображение мне
         не передали»). Пул без зрячей модели пропускаем и идём дальше; пин человека
         не переспориваем — он выбрал модель руками, ему и отвечать, но мы скажем
         об этом вслух (imageNote). */
      if (images.length && !models.some((m) => isVision(m))) {
        tried.push({ provider: id, why: 'в пуле нет модели, которая читает картинки' });
        continue;
      }
      const n = modelsPerProviderWanted;
      /* 0.192: в смешанном пуле после зрячих очередь шла к слепым — та получала
         картинку (ошибка API, съеденная попытка) или, хуже, «отвечала» по тексту
         вопроса, не видя изображения (выдумка вместо честного отказа). Есть
         зрячие — зовём только их; зрячих нет — провайдер скипается выше. */
      const canSee = images.length && models.some((m) => isVision(m));
      const seers = canSee ? models.filter((m) => isVision(m)) : models;
      for (const model of seers.slice(0, n)) {
        const left = deadline - Date.now();
        if (left < 2500) { tried.push({ provider: id, model, why: 'вышел бюджет времени' }); return await withMeta(finish(null, tried, started, intent, tier, 'время вышло')); }
        let keyIdx = chooseKey(id, model);
        if (keyIdx < 0) { tried.push({ provider: id, why: 'ключи исчерпаны' }); break; }
        const okPace = await pace(id, left);
        if (!okPace) { tried.push({ provider: id, why: 'пауза тарифа длиннее бюджета' }); break; }
        lastCallAt[id] = Date.now();
        const useReframe = reframed && allowReframe;
        /* Окно — по ЭТОЙ голове. Влезает в лучшее окно (обычный случай) — берём
           готовую подгонку, работы нет; у головы окно меньше — режем заново из
           pristine, и человеку достаётся правда именно про эту попытку, а не
           заметка от той модели, которая в итоге не ответила. */
        const creativeHere = CREATIVE_ASK_RE.test(String(text || ''));
        const escStep = reframedCalls >= 1 ? 2 : 1;
        const fitNow = useReframe
          ? fitContext({
            system: pristine.system + freedom.escalationBlock(env, { reframed: true, split: escStep >= 2, step: escStep, adult: adultAsk, model, danger: !allowReframe }),
            history: pristine.history, images, env, maxOut: maxTokensWanted, window: windowFor(id, model),
            text: toolsRes.block
              ? freedom.reframePrompt(text, { creative: creativeHere, adult: adultAsk, intent }) + '\n\n' + toolsRes.block
              : freedom.reframePrompt(text, { creative: creativeHere, adult: adultAsk, intent }) + freedom.reframeMark(env, { model, danger: !allowReframe }),
          })
          : fitFor(id, model);
        const curMessages = fitNow.history.concat([{ role: 'user', content: fitNow.text }]);
        const curSystem = fitNow.system;
        if (useReframe) reframedCalls++;
        const req = buildRequest({
          cfg, keyIdx, model, provider: id, stream: !!onDelta, messages: curMessages, system: curSystem, tier, images, maxImages: MAX_IMAGES,
          maxTokens: fitNow.maxOut || maxTokensWanted, temperature: input.temperature, topP: input.topP,
          presencePenalty: input.presencePenalty, frequencyPenalty: input.frequencyPenalty,
          reasoningEffort: effectiveReasoningEffort,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model; req.intent = intent; req.lexSource = lexSource; req.userText = text; req.agentGender = genderEff.agent;
        let r = await attemptOne(id, model, req, left);
        /* 429 на этом ключе — та же модель сразу на другом ключе того же провайдера:
           лимит считается на ключ, а модель уже выбрана как лучшая для задачи. */
        const keysUsed = new Set([keyIdx]);
        while (!r.ok && (r.status === 429 || r.deadKey) && (deadline - Date.now()) >= 2500) {
          const nk = chooseKey(id, model, keysUsed);
          if (nk < 0) break;
          tried.push({ provider: id, model, why: (r.deadKey ? 'ключ ' + (keyIdx + 1) + ' не принят' : 'rate-limit на ключе ' + (keyIdx + 1)) + ', беру ключ ' + (nk + 1), status: r.status });
          keyIdx = nk; keysUsed.add(nk);
          const req2 = buildRequest({
            cfg, keyIdx, model, provider: id, stream: !!onDelta, messages: curMessages, system: curSystem, tier, images, maxImages: MAX_IMAGES,
            maxTokens: fitNow.maxOut || maxTokensWanted, temperature: input.temperature, topP: input.topP,
            presencePenalty: input.presencePenalty, frequencyPenalty: input.frequencyPenalty,
            reasoningEffort: effectiveReasoningEffort,
          });
          req2.tier = tier; req2.keyIdx = keyIdx; req2.model = model; req2.intent = intent; req2.lexSource = lexSource; req2.userText = text; req2.agentGender = genderEff.agent;
          r = await attemptOne(id, model, req2, deadline - Date.now());
        }
        /* Не сошлось — черновик, который уже потёк в окно, надо убрать, а не бросать
           посреди экрана: следующая голова отвечает совсем другим текстом. */
        if (!r.ok && onDelta) onDelta({ kind: 'drop', provider: id, model });
        /* Копим опыт: прямой ответ весит больше, чем выдоенный обходом, — иначе
           рейтинг смелых превратился в рейтинг терпения: кто дольше упирался, тот и «смелый». */
        if (brave) {
          /* 0.204: ответила, но смягчила его слова — смелость частичная. Вес ниже
             прямого ответа и ниже выдоенного обходом: рейтинг учится ставить
             вперёд тех, кто слов не боится, а не тех, кого потом чинит зеркало. */
          if (r.ok) brave.mark(id, model, true, (r.lexiconRestored || r.lexiconSanitized) ? 0.45 : (useReframe ? 0.6 : 1));
          else if (r.soft || /ответ-отказ|блок по фильтру/.test(String(r.why || ''))) brave.mark(id, model, false);
        }
        if (r.ok) {
          /* Ответила именно эта голова — значит её подгонка и есть правда о запросе.
             Строки о резке от неудавшихся попыток человеку не показываем: они про
             другую модель и только путали бы («урезал на 5» — а кто урезал?). */
          ctxNotes = (fitNow.notes || []).slice();
          if (fitNow.overflow) ctxNotes = ctxNotes.concat([fitNow.overflow]);
          /* Обрыв на лимите токенов: дописываем у того же провайдера.
             0.211: не один сегмент, а до трёх (владельцу дверь может дать
             пять), пока модель снова не скажет, что упёрлась в потолок.
             Каждый сегмент живёт только в остатке общего дедлайна — раньше
             внутренний run получал полный срок заново. */
          let reply = r.reply;
          let finishReason = r.finish || '';
          let continuations = 0;
          while (isTruncatedFinish(finishReason)
            && input.continueOnTruncate !== false
            && continuations < maxContinuationsWanted
            && (deadline - Date.now()) >= 5000) {
            /* Продолжение — новая генерация той же модели: она снова может начать
               с блока размышлений. Разбор потока обязан это знать, иначе тег и
               английские мысли уезжают человеку обычным текстом ответа (живой
               случай: `<think> We need to advise on architecture choice…` в
               пузыре после 40-секундного размышления). Клиент этот сигнал не
               видит — он ничего не показывает, только сбрасывает своё состояние
               тега (functions/api/chat.js). */
            if (onDelta) { try { onDelta({ kind: 'reset', provider: id, model }); } catch (e) { /* наблюдатель упал — поток не его вина */ } }
            const more = await run({
              ...input, docs: null, text: 'Продолжи ровно с того места, где оборвался. Без повторов и вступлений.\n\nТы уже написал: ' + reply.slice(-1200),
              history: [], system: 'Ты продолжаешь оборванный ответ.', providerOrder: [id], continueOnTruncate: false,
              useTools: false, allowReframe: false,
              /* Продолжение — НЕ новый ход разговора. Без этой строки внутренний run()
                 наследует chatId: память писала транскрипт дважды за один вопрос
                 («Продолжи ровно с того места…» уезжало в профиль как реплика человека,
                 turns росло на 2), и на пустяковый дозапрос вставал отдельный совет. */
              noCouncils: true, noCheck: true, chatId: undefined,
              deadlineMs: Math.max(5000, deadline - Date.now()),
              maxContinuations: 0,
              maxTokens: Math.max(maxTokensWanted, tier === 'smart' ? 4000 : 2400),
            });
            if (!more || !more.reply || more.reply.length <= 20) break;
            reply = style.polish(reply + '\n' + more.reply, { env, intent });
            finishReason = more.finish || '';
            continuations++;
          }
          const hit = {
            reply, reasoning: r.reasoning, provider: id, model, intent, tier,
            finish: finishReason, continuations,
            /* Сколько контекста занял этот запрос и в какое окно он влезал — по этим
               двум числам индикатор у поля ввода показывает заполнение честно, без
               догадок фронта. Числа берутся из подгонки, которая реально уехала
               голове (fitNow), а не из «лучшего окна» каталога. */
            ctxUsed: fitNow.tokens, ctxWindow: fitNow.window,
            /* выбор человека не состоялся — говорим об этом прямо, а не молча
               подменяем: подпись «xkiro · wide/model-b» скрывала бы подмену */
            pinned: pin ? pin.model : undefined,
            pinMiss: !!pin && (id !== pin.id || model !== pin.model),
            tools: toolsRes.used, sources: toolsRes.sources || [], webSteps: toolsRes.webSteps || [],
            /* «поиск лёг, отвечаю по Википедии» — не только модели, но и человеку:
               подпись под ответом берёт пометки отсюда (0.199). */
            toolNotes: toolsRes.notes || [],
            reframed: useReframe, freedomCleaned: !!r.freedomCleaned, photoSalvaged: !!r.photoSalvaged, lexiconRestored: !!r.lexiconRestored, lexiconSanitized: !!r.lexiconSanitized,
            /* Ответ уже подтверждён инструментом (арифметику посчитал калькулятор) —
               совет голов на такое не созывается: см. ensemble.verifiedByTool. */
            toolProof: ensemble.verifiedByTool({ tools: toolsRes.used, block: toolsRes.block, reply, intent }),
          };
          /* Советы голов (Этап 2): факт может поправить большинство, манеру не трогаем.
             Головы вызываются с других провайдеров и сами совет не собирают. */
          const final = input.noCouncils ? hit : await runCouncils(input, hit, tried);
          if (useMem) {
            try {
              /* Порядок важен: сначала реплика человека, потом мой ответ. Наоборот —
                 и история, подставленная из памяти в следующий запрос, читается задом
                 наперёд: модель получала «ответ → вопрос» и начинала бормотать.
                 Это поймали живым прогоном и тестом H1. */
              await memory.addMessage(input.chatId, 'user', text, input.origin);
              const dd = await memory.addMessage(input.chatId, 'assistant', final.reply, input.origin);
              await memory.rememberFacts(input.chatId, text, input.origin);
              const after = dd || (await memory.load(input.chatId));
              if (memory.needsCompact(after)) await memory.compact(input.chatId);
              await memory.flush();
              final.memory = await memory.stats(input.chatId);
            } catch (e) {}
          }
          return await withMeta(finish(final, tried, started, intent, tier));
        }
        if (r.soft && allowReframe) {
          reframed = true;
          if (!softSeen.some((c) => c.id === id)) softSeen.push({ id, model, cfg });
        }
        tried.push({ provider: id, model, why: r.why, status: r.status, soft: r.soft, reframed: useReframe || undefined });
      }
    }

    /* Отказодавильня (0.198; 0.211 — до трёх): мягко отказавшим — эскалации
       по порядку. Творческий запрос (рассказ, сцена) переформулируется в
       творческой рамке, остальные — в справочной. Время соблюдается. */
    if (reframed && softSeen.length && (deadline - Date.now()) >= 2500) {
      const creativeAsk = CREATIVE_ASK_RE.test(String(text || ''));
      for (const cand of softSeen.slice(0, 3)) {
        if ((deadline - Date.now()) < 2500) break;
        const { id, model, cfg } = cand;
        const keyIdx = pickKey(P, id, health);
        const left = deadline - Date.now();
        if (!(keyIdx >= 0 && await pace(id, left))) continue;
        lastCallAt[id] = Date.now();
        /* Та же подгонка, что и в очереди: окно этой головы, история из pristine.
           0.236: на второй ступени отказодавильни включаем step=2 (JB_STEP2) и
           SPLIT_SYSTEM («ответ в два приёма»), чтобы не повторять впустую ту же
           подсказку, на которой очередь уже сорвалась в отказ. */
        const refit = fitContext({
          system: pristine.system + freedom.escalationBlock(env, { reframed: true, split: true, step: 2, adult: adultAsk, model, danger: !allowReframe }),
          history: pristine.history, images, env, maxOut: maxTokensWanted, window: windowFor(id, model),
          text: toolsRes.block
            ? freedom.reframePrompt(text, { creative: creativeAsk, adult: adultAsk, intent }) + '\n\n' + toolsRes.block
            : freedom.reframePrompt(text, { creative: creativeAsk, adult: adultAsk, intent }) + freedom.reframeMark(env, { model, danger: !allowReframe }),
        });
        const curMessages = refit.history.concat([{ role: 'user', content: refit.text }]);
        const req = buildRequest({
          cfg, keyIdx, model, provider: id, messages: curMessages,
          system: refit.system,
          tier, images, maxImages: MAX_IMAGES, maxTokens: refit.maxOut || maxTokensWanted, temperature: input.temperature,
          presencePenalty: input.presencePenalty, frequencyPenalty: input.frequencyPenalty,
          reasoningEffort: effectiveReasoningEffort,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model; req.intent = intent; req.lexSource = lexSource; req.userText = text; req.agentGender = genderEff.agent;
        const r = await attemptOne(id, model, req, left);
        if (r.ok) {
          ctxNotes = (refit.notes || []).slice();
          if (refit.overflow) ctxNotes = ctxNotes.concat([refit.overflow]);
          const hit = {
            reply: r.reply, reasoning: r.reasoning, provider: id, model, intent, tier,
            finish: r.finish || '', continuations: 0,
            tools: toolsRes.used, sources: toolsRes.sources || [], webSteps: toolsRes.webSteps || [],
            /* «поиск лёг, отвечаю по Википедии» — не только модели, но и человеку:
               подпись под ответом берёт пометки отсюда (0.199). */
            toolNotes: toolsRes.notes || [],
            reframed: true, freedomCleaned: !!r.freedomCleaned, photoSalvaged: !!r.photoSalvaged, lexiconRestored: !!r.lexiconRestored, lexiconSanitized: !!r.lexiconSanitized,
            pinned: pin ? pin.model : undefined,
            pinMiss: !!pin && (id !== pin.id || model !== pin.model),
          };
          const final = input.noCouncils ? hit : await runCouncils(input, hit, tried);
          return await withMeta(finish(final, tried, started, intent, tier));
        }
        tried.push({ provider: id, model, why: r.why, status: r.status, soft: r.soft, reframed: true });
      }
    }

    /* 0.207: по фото отказали по содержанию — это ещё не финал. Требование
       владельца: ответ по любому (взрослому) фото есть ВСЕГДА, формулы
       «не могу анализировать изображение» в продукте нет. Лестница дальше:
       (а) холодный фактологический проход у мягко отказавшей головы —
       инвентаризация видимого без детализации, которую модели обычно дают;
       (б) если и он отказан — честный ответ ДВИЖКА: что произошло, чем
       получить разбор (по детали, кадром, словами) и риски по делу. Ответ,
       а не ошибка; маркер photoRefused дверь показывает человеку.
       (0.197 давал на этом месте SEERS_REFUSED_PHOTO — честную ошибку;
       владелец прямо отменил это поведение в пользу ответа.) */
    const contentRefused = tried.some((t) => /ответ-отказ|отказ по содержанию фото|блок по фильтру/.test(String((t && t.why) || '')));
    const photoRefused = images.length > 0 && tried.length > 0 && contentRefused;
    if (photoRefused && (deadline - Date.now()) >= 2500) {
      /* 0.210: один холодный проход — мало. Разным моделям доступны разные
         уровни детализации, поэтому лестница теперь идёт по парам
         «голова × ступень»: инвентаризация → одна деталь → визуальные якоря.
         Всего не больше четырёх спасательных вызовов и только внутри дедлайна. */
      const rescueCands = [];
      const seenCand = new Set();
      const addRescueCand = (c) => {
        if (!c || !c.id || !c.model || !P[c.id]) return;
        if (!isVision(c.model)) return;
        const key = c.id + '#' + c.model;
        if (seenCand.has(key)) return;
        seenCand.add(key);
        rescueCands.push({ id: c.id, model: c.model, cfg: c.cfg || P[c.id] });
      };
      (softSeen || []).forEach(addRescueCand);
      tried.forEach((t) => addRescueCand({ id: t.provider, model: t.model }));
      /* 0.232: добираем зрячие головы, которые в этом ходе ещё не отвечали.
         Раньше лестница ходила только по тем, кто уже отказал, — а следующий
         провайдер с зрячей моделью так и стоял нетронутым. Отказ одной головы
         ничего не говорит о другой: у них разные фильтры и разные пороги. */
      for (const pid of order) {
        if (rescueCands.length >= 4) break;
        const cfg = P[pid];
        if (!cfg || !providerAlive(P, pid, health)) continue;
        const list = visionFirst(modelsFor(cfg, tier, intent, images, env, deep) || [], images);
        for (const m of list) {
          if (rescueCands.length >= 4) break;
          if (!isVision(m)) continue;
          addRescueCand({ id: pid, model: m });
        }
      }

      /* Взрослый вопрос получает отдельную ступень — прямой разбор без
         эвфемизмов (0.232). Только взрослый и только когда жёсткая граница выше
         не сработала: несовершеннолетние, опознание и распространение в этот
         список не попадают никогда. */
      const stageList = vision.VISION_STAGES.concat(adultAsk ? ['adult'] : []);
      const passes = stageList.map((stage) => vision.visionPass(stage, text));
      const passByStage = Object.fromEntries(passes.map((p) => [p.stage, p]));
      const rescueAttempts = [];
      const addAttempt = (cand, stage) => {
        if (!cand || !passByStage[stage]) return;
        const key = cand.id + '#' + cand.model + '#' + stage;
        if (rescueAttempts.some((a) => a.key === key)) return;
        rescueAttempts.push({ key, cand, pass: passByStage[stage] });
      };
      /* 0.232: ступеней пять, и каждая идёт по ДВУМ разным головам, если они
         есть: у моделей разные пороги, и отказ одной ровно ничего не говорит об
         отказе другой. Порядок — от самой «безобидной» формулировки к
         механическому перечню: перечень видимого почти не вызывают отказов даже
         у самых осторожных голов. Потолок попыток растёт с числом кадров: на
         серии один кадр может быть чистым, а другой нет, и сдаваться после
         шести отказов на серии рано. */
      /* Сначала все ступени на первой голове — иначе при потолке в шесть
         попыток до механического перечня дело не дойдёт вовсе, а он-то и
         срабатывает чаще всего. Потом самые сильные ступени на второй голове. */
      for (const stage of stageList) addAttempt(rescueCands[0], stage);
      for (const stage of ['checklist', 'adult', 'professional', 'anchors']) addAttempt(rescueCands[1], stage);
      for (const stage of ['checklist', 'neutral']) addAttempt(rescueCands[2], stage);
      const ladderCap = Math.min(9, 6 + Math.max(0, images.length - 2));

      for (const attempt of rescueAttempts.slice(0, ladderCap)) {
        if ((deadline - Date.now()) < 2500) break;
        const { id, model, cfg } = attempt.cand;
        const pass = attempt.pass;
        const keyIdx = pickKey(P, id, health);
        const left = deadline - Date.now();
        if (!(keyIdx >= 0 && await pace(id, left))) {
          tried.push({ provider: id, model, why: 'нет живого ключа или времени на картиночный проход', reframed: true, photoNeutral: true, photoStage: pass.stage });
          continue;
        }
        lastCallAt[id] = Date.now();
        const refit = fitContext({
          system: pristine.system + '\n\n' + pass.system + freedom.escalationBlock(env, { reframed: true, adult: adultAsk, model, danger: !allowReframe }),
          history: pristine.history, images, env, maxOut: maxTokensWanted, window: windowFor(id, model),
          text: pass.prompt,
        });
        const curMessages = refit.history.concat([{ role: 'user', content: refit.text }]);
        const req = buildRequest({
          cfg, keyIdx, model, provider: id, messages: curMessages,
          system: refit.system,
          tier, images, maxImages: MAX_IMAGES, maxTokens: refit.maxOut || maxTokensWanted, temperature: input.temperature,
          presencePenalty: input.presencePenalty, frequencyPenalty: input.frequencyPenalty,
          reasoningEffort: effectiveReasoningEffort,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model; req.intent = intent; req.lexSource = lexSource; req.userText = text; req.agentGender = genderEff.agent;
        const r = await attemptOne(id, model, req, left);
        const tooThin = r.ok && pass.stage !== 'detail' && String(r.reply || '').trim().length < 30;
        if (r.ok && !tooThin) {
          ctxNotes = (refit.notes || []).slice();
          if (refit.overflow) ctxNotes = ctxNotes.concat([refit.overflow]);
          const hit = {
            reply: r.reply, reasoning: r.reasoning, provider: id, model, intent, tier,
            finish: r.finish || '', continuations: 0,
            tools: [], sources: [], toolNotes: [],
            reframed: true, photoNeutral: true, photoStage: pass.stage, photoMode: pass.mode,
            photoSalvaged: !!r.photoSalvaged,
            freedomCleaned: !!r.freedomCleaned, lexiconRestored: !!r.lexiconRestored, lexiconSanitized: !!r.lexiconSanitized,
            pinned: pin ? pin.model : undefined,
            pinMiss: !!pin && (id !== pin.id || model !== pin.model),
          };
          const final = input.noCouncils ? hit : await runCouncils(input, hit, tried);
          return await withMeta(finish(final, tried, started, intent, tier));
        }
        tried.push({
          provider: id,
          model,
          why: tooThin ? 'слишком короткий картиночный ответ' : r.why,
          status: r.status,
          soft: r.soft,
          reframed: true,
          photoNeutral: true,
          photoStage: pass.stage,
        });
      }
    }
    if (photoRefused) {
      const hit = {
        reply: photoFallbackReply(text, images), reasoning: '', provider: 'engine', model: 'photo-fallback', intent, tier,
        tools: [], sources: [], toolNotes: [], photoRefused: true,
        photoStage: 'fallback', photoMode: visionTask.mode,
        pinned: pin ? pin.model : undefined, pinMiss: !!pin,
      };
      return await withMeta(finish(hit, tried, started, intent, tier));
    }
    return await withMeta(finish(null, tried, started, intent, tier, 'ни один провайдер не ответил'));
  }


  /* ==================== Советы голов (Этап 2 переноса) ====================
     Головы — с РАЗНЫХ провайдеров: вторая голова того же провайдера это те же веса
     и те же типовые ошибки, «большинство» из них фиктивное. */

  /* Порядок — единственный, из providers.ORDER: копия массива здесь неизбежно
     разъехалась бы (и локальная голова попадала в очередь, даже когда её нет). */
  function order(tier) { return ORDER[tier] || ORDER.fast; }

  function aliveOrder(tier) {
    const ids = Object.keys(P).filter((id) => (P[id].keys.length || P[id].keyless) && providerAlive(P, id, health));
    const live = ids.filter((id) => !punished(id));
    /* совсем без голов лучше, чем с выдуманным большинством: если в карантине все,
       пробуем как раньше (провайдер мог вернуться раньше срока) */
    const pool = live.length ? live : ids;
    const pref = order(tier).filter((id) => pool.indexOf(id) >= 0);
    return pref.concat(pool.filter((id) => pref.indexOf(id) < 0));
  }

  /* Провайдер «зрячий», только если в его ПУЛЕ есть зрячая модель: по имени
     провайдера проверка даёт false-негативы и true-позитивы одновременно. */
  function providerSees(id) {
    const cfg = P[id];
    if (!cfg) return false;
    const all = Object.keys(cfg.models || {}).reduce((a, k) => a.concat(cfg.models[k] || []), []);
    return all.some((m) => isVision(String(m).replace(/:free$/, '')));
  }

  function headList(n, exclude, needVision) {
    const out = [];
    for (const id of aliveOrder('smart')) {
      if (id === exclude || out.indexOf(id) >= 0) continue;
      if (needVision && !providerSees(id)) continue;
      out.push(id);
      if (out.length >= Math.max(1, n)) break;
    }
    return out;
  }

  async function runCouncils(input, hit) {
    const out = { ...hit };
    const ec = ensemble.cfgOf(env);
    const vc = vcouncil.cfgOf(env);
    /* План глубокой работы пересчитывается здесь по исходному входу: runCouncils
       живёт вне run(), а расширенный бюджет нужен именно совету. Головы при
       этом получат noDeepWork ниже и сами исследование не перезапустят. */
    const councilPlan = input.noDeepWork ? null : planDeepWork({
      text: input.text,
      intent: input.intent || classifyTask(input.text, input.images),
      images: input.images,
      deep: input.deep === true || !!(depthVerdict && depthVerdict.deep),
      depth: depthVerdict,
      webSearch: input.webSearch === true,
      owner: input.ownerPriority === true,
      env,
    });
    /* бесплатный пул живёт на квотах: 5 запросов в минуту на некоторых роутерах,
       поэтому число лишних вызовов на один ответ ограничено явно */
    const budget = Math.max(0, Number(env.COUNCIL_BUDGET == null
      ? (councilPlan && councilPlan.extended ? councilPlan.reasoning.councilBudget : 6)
      : env.COUNCIL_BUDGET));
    let spent = 0;
    /* Общий бюджет ВРЕМЕНИ на весь совет, а не на каждую голову. Раньше у каждой
       волны был свой COUNCIL_MS: медлила одна голова — человек ждал и первую, и
       вторую волну, то есть до 24 секунд на ответ, который стоил полсекунды. */
    /* Бюджет времени — общий на все волны совета, а не на каждую голову.
       Для текста головы быстрые, для картинки — нет: зрячие провайдеры на
       бесплатных ключах отвечают по 10 секунд, и им нужен отдельный, больший
       бюджет (иначе совет по фото в принципе не успевает собраться). */
    const bud0 = councilBudget(env, ec, vc);
    const bud = councilPlan && councilPlan.extended
      ? { textMs: Math.round(bud0.textMs * 1.5), visionMs: bud0.visionMs }
      : bud0;
    const wallE = Date.now() + bud.textMs;
    const wallV = Date.now() + bud.visionMs;
    /** Голова = тот же обход, но зафиксированный провайдер и без рекурсии совета. */
    const headCall = (provider, inp, textOverride, wall) => run({
      ...inp,
      text: textOverride != null ? textOverride : inp.text,
      providerOrder: [provider],
      noCouncils: true,
      /* Документ голове виден (иначе совет голосует по невидимому файлу), но части
         своими вызовами она не читает — это квота впустую, см. блок документов. */
      docsMap: false,
      /* Голова совета отвечает не человеку, а в голосование: самопроверка с досылом
         на каждой голове означала бы по одной починке на голос (три досыла вместо
         одного — поймано проверкой G4e) и жгла бы квоту бесплатных ключей впустую. */
      noCheck: true,
      noDeepWork: true,
      allowReframe: false,
      webSearch: false,
      deadlineMs: Math.max(3500, wall - Date.now()),
      modelsPerProvider: 1,
    });

    const wantEnsemble = ec.on && ec.k >= 2 && !(input.images && input.images.length)
      && ensemble.shouldPoll(input.text, { env, classify: classifyTask });
    if (wantEnsemble && hit.toolProof) {
      /* Живой замер прода: одинаковый «17×23» стоил 4,5 с и 14,1 с — во втором
         прогоне человек ждал головы, которые не ответили, ради проверки того, что
         уже посчитал калькулятор. Пропуск назван словами, а не молчанием. */
      out.ensembleSkip = hit.toolProof;
      return out;
    }
    if (wantEnsemble && spent >= budget) {
      out.ensembleSkip = 'бюджет советов исчерпан (COUNCIL_BUDGET=' + budget + ')';
    }
    if (wantEnsemble && spent < budget) {
      /* Судья глубины может попросить больше независимых проверок на дорогой
         задаче (DEPTH_COUNCIL_K): там цена ошибки выше, чем стоимость пары
         лишних запросов. Прежний k ансамбля остаётся полом — меньше него
         совет не собирается никогда. */
      const wantK = Math.max(
        ec.k,
        depthVerdict && depthVerdict.councilK ? depthVerdict.councilK : 0,
        councilPlan && councilPlan.extended ? councilPlan.reasoning.councilK : 0,
      );
      const heads = headList(wantK, out.provider, false);
      const headsList = heads.slice();
      if (heads.length < 1) {
        out.ensembleSkip = 'живых голов, кроме моей: ' + heads.length;
      } else {
        let res = await ensemble.poll({
          goal: input.text, env, classify: classifyTask, authorReply: out.reply, k: heads.length,
          ask: (i) => headCall(heads[i % heads.length], input, null, wallE).then((r) => (r.ok ? { reply: r.reply, provider: r.provider } : null)),
        });
        if (res && res.skip) out.ensembleSkip = res.skip;
        else if (res) {
          spent += res.total;
          let d = ensemble.decide({ authorReply: out.reply, result: res });
          /* Расхождение — это повод не «оставить как есть», а доспросить: лишние
             независимые головы делают большинство, а не надежда на удачу. */
          if (d.retry && spent < budget && wallE - Date.now() > 5000) {
            const extra = headList(heads.length + 2, out.provider, false).filter((id) => heads.indexOf(id) < 0);
            if (extra.length) {
              const res2 = await ensemble.poll({
                goal: input.text, env, classify: classifyTask, authorReply: out.reply,
                k: heads.length + extra.length,
                ask: (i) => {
                  const list = heads.concat(extra);
                  const prov = list[i % list.length];
                  return headCall(prov, input, null, wallE).then((r) => (r.ok ? { reply: r.reply, provider: r.provider } : null));
                },
              });
              if (res2 && !res2.skip) { spent += res2.total; d = ensemble.decide({ authorReply: out.reply, result: res2 }); res = res2; }
            }
          }
          out.ensemble = { status: d.status, agreed: d.agreed, votes: d.votes, total: d.total, mode: res.mode, heads: headsList };
          if (d.applied && d.reply) { out.reply = d.reply; out.ensembleApplied = true; }
        }
      }
    }

    if (vc.on && input.images && input.images.length && spent < budget && wallV - Date.now() > 6000
        && vcouncil.shouldCouncil(input.text, input.images, env)) {
      const heads = headList(vc.k - 1, out.provider, true);
      if (heads.length < 1) {
        out.visionSkip = 'зрячих живых голов, кроме моей: ' + heads.length;
      } else {
        const SYS = 'Ты смотришь на изображение и отвечаешь ОДНИМ фактом: числом, словом или короткой строкой. '
          + 'Не догадывайся: чего не разглядел — о том и скажи, что не разглядел.';
        const t = await vcouncil.gate({
          goal: input.text, images: input.images, answer: out.reply, env,
          ask: (i) => headCall(heads[i % heads.length], { ...input, system: SYS, maxTokens: 200 }, null, wallV)
            .then((r) => (r.ok ? { reply: r.reply, provider: r.provider } : null)),
          judge: (prompt) => headCall(heads[heads.length - 1], { ...input, text: prompt, system: 'Ты рассматриваешь спор по картинке и выбираешь меж двух ответов. Первой строкой — A или B.' }, null, wallV)
            .then((r) => (r.ok ? { reply: r.reply } : null)),
        });
        spent += vc.k;
        if (t) {
          if (t.status === 'skip') out.visionSkip = (t.why || '') + ' [головы: ' + heads.join(', ') + ']';
          else {
            out.vision = { status: t.status, heads, total: t.total, votes: (t.votes || []).map((v) => v.n + ':' + String(v.key).slice(0, 24)) };
            if (t.answer && t.answer !== out.reply) { out.reply = t.answer; out.visionApplied = true; }
          }
        }
      }
    }
    return out;
  }

  function finish(hit, tried, started, intent, tier, why) {
    return {
      ok: !!hit, reply: hit ? scrubToolMarkers(hit.reply) : '', reasoning: hit ? hit.reasoning : '',
      provider: hit ? hit.provider : '', model: hit ? hit.model : '',
      finish: hit ? (hit.finish || '') : '', continuations: hit ? (hit.continuations || 0) : 0,
      attempts: 0,
      tools: hit ? (hit.tools || []) : [],
      toolNotes: hit ? (hit.toolNotes || []) : [],
      sources: hit && Array.isArray(hit.sources) ? hit.sources : [],
      reframed: hit ? !!hit.reframed : false,
      freedomCleaned: hit ? !!hit.freedomCleaned : false,
      lexiconRestored: hit ? !!hit.lexiconRestored : false,
      lexiconSanitized: hit ? !!hit.lexiconSanitized : false,
      /* 0.207: все зрячие отказались по содержанию фото — человек получил
         честный ответ движка (или холодный разбор), а не ошибку. */
      photoRefused: hit ? !!hit.photoRefused : false,
      photoNeutral: hit ? !!hit.photoNeutral : false,
      photoStage: hit ? (hit.photoStage || '') : '',
      photoMode: hit ? (hit.photoMode || '') : '',
      photoSalvaged: hit ? !!hit.photoSalvaged : false,
      /* Ответ подтверждён инструментом: по нему и совет голов пропускается, и
         самопроверка не зовёт починку (см. withMeta). */
      toolProof: hit ? (hit.toolProof || '') : '',
      /* Контекст: сколько занято и в какое окно — для индикатора у поля ввода. */
      ctx: hit && hit.ctxWindow ? { used: hit.ctxUsed || 0, window: hit.ctxWindow } : undefined,
      /* Поля, которые withMeta ставит поверх результата: finish() собирает объект
         ЗАНОВО, поэтому без этих строк глубина и самопроверка терялись по дороге
         ко входу (payload приходил без deep и без checkNotes — поймано проверкой
         G4a на первой же сборке слоя). Значения здесь перезапишутся в withMeta. */
      deep: hit ? hit.deep : undefined,
      deepPlain: hit ? hit.deepPlain : undefined,
      depthWhy: hit ? hit.depthWhy : undefined,
      deepWork: hit ? hit.deepWork : undefined,
      extendedReasoning: hit ? hit.extendedReasoning : undefined,
      research: hit ? hit.research : undefined,
      check: hit ? hit.check : undefined,
      ensemble: hit ? hit.ensemble : null, ensembleSkip: hit ? (hit.ensembleSkip || '') : '',
      ensembleApplied: hit ? !!hit.ensembleApplied : false,
      vision: hit ? hit.vision : null, visionSkip: hit ? (hit.visionSkip || '') : '',
      visionApplied: hit ? !!hit.visionApplied : false,
      memory: hit ? (hit.memory || null) : null,
      /* был ли выбор человека — и состоялся ли он (см. пин выше) */
      pinned: hit ? hit.pinned : undefined, pinMiss: hit ? !!hit.pinMiss : false,
      intent, tier, ms: Date.now() - started, tried,
      error: hit ? '' : (why || 'нет ответа'),
    };
  }

  return {
    run,
    providers: P,
    health: () => JSON.parse(JSON.stringify(health)),
    usage: () => JSON.parse(JSON.stringify(usage)),
    /* Расход по провайдерам за сутки (UTC) — для GET /api/usage и панели настроек.
       `flush` вызывается дверью через waitUntil: он сам решает, пора ли писать в KV. */
    usageStats: () => usageTrack.snapshot(),
    usageFlush: (o) => usageTrack.flush(o),
    alive: () => Object.keys(P).filter((id) => providerAlive(P, id, health)),
    quarantine: () => Array.from(quar.entries()).map(([id, v]) => ({ provider: id, why: v.why, ms: Math.max(0, v.until - Date.now()) })),
    punish,
    classify: (text, images) => classifyTask(text, images),
    /* состояние картинок — для /api/chat: человек должен видеть, что умеет
       движок сегодня, а не что ему обещают */
    img: () => imggen.status(),
    /* Подтянуть «кто из картиночных источников отвечал» из общего хранилища:
       дверь зовёт это перед своей диагностикой, чтобы строка статуса не говорила
       «не проверен» о том, что проверено (см. engine/imggen.js). */
    imgHydrate: () => (imggen.hydrate ? imggen.hydrate() : Promise.resolve(false)),
    imgReady: () => editsReady(imggen.status()),
    imgCanEdit: () => imggen.canEdit(),
  };
}

/** пулы движка одной строкой — для порядка провайдеров по рейтингу смелых */
function poolOf(P) {
  const out = {};
  for (const id of Object.keys(P || {})) {
    const m = (P[id] && P[id].models) || {};
    out[id] = [].concat(m.fast || [], m.smart || []);
  }
  return out;
}

/* пин выбран человеком — ничто (ни рейтинг, ни «смелые») не имеет права его
   потеснить: человек явно попросил эту модель */
function pin0(input) { return !!(input && String(input.model || '').trim()); }

export { classifyTask, tierFor, stripThinkTags, isProviderError };
export { ensemble, vcouncil, freedom, style };
