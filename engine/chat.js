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
  buildTable, providerAlive, pickKey, orderFor, ORDER, MIN_INTERVAL, TIMEOUT, MAX_IMAGES,
} from './providers.js';
import { classifyTask, tierFor, modelsFor, isVision } from './route.js';
import { buildRequest, rawCall, isProviderError, isRefusal, stripThinkTags } from './shape.js';
import { gatherTools } from './tools.js';
import * as freedom from './freedom.js';
import * as style from './style.js';
import * as ensemble from './ensemble.js';
import { createMemory } from './memory.js';
import * as vcouncil from './vcouncil.js';

export const PERSONA_SYSTEM =
  'Ты — MeTiger Ai, универсальный ИИ-агент в Telegram Mini App. Отвечаешь на языке '
  + 'человека, по делу и без вступлений («конечно», «отличный вопрос», «как модель я не могу»). '
  + 'Код и файлы — в fence с языком. Если факта не знаешь — говоришь прямо, что не знаешь, '
  + 'и не додумываешь. Не извиняйся за себя и не добавляй дисклеймеров.';

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

export function createEngine(opts) {
  const o = opts || {};
  const env = o.env || {};
  const fetchImpl = o.fetch || ((...a) => fetch(...a));
  const P = buildTable(env);
  /* Память чата: либо готовый экземпляр (своё хранилище, свой кэш), либо store —
     тогда соберём сами. Без того и другого движок работает ровно как раньше. */
  const memory = o.memory || (o.store ? createMemory({ store: o.store, env, log: o.log }) : null);
  const health = Object.create(null);   /* id → [ключевое состояние] */
  const lastCallAt = Object.create(null);
  const usage = Object.create(null);    /* id → { calls, ok, refused, dead, t } */
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  /* Карантин — для провайдеров, которые не медлят, а не отвечают вовсе: токен без
     прав, нулевой баланс, 401. В Worker движок создаётся на каждый запрос, поэтому
     в проде карту передают модульную: иначе каждая request'а заново стучится в
     мёртвую дверь и теряет на это те секунды, которые стоили совета. */
  const quar = o.quarantine || new Map();
  const QUARANTINE_MS = Math.max(60000, Number(env.QUARANTINE_MS) || 240000);
  function punish(id, why, ms) {
    quar.set(id, { until: Date.now() + (ms || QUARANTINE_MS), why: String(why || '').slice(0, 140) });
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

  /**
   * Одна попытка: конкретный провайдер + конкретная модель.
   * Возвращает { ok, reply, reasoning, provider, model, finish } или { ok:false, why }.
   */
  async function attemptOne(id, model, req, deadlineLeft) {
    const res = await rawCall(fetchImpl, req, Math.min(TIMEOUT[req.tier] || 30000, deadlineLeft));
    if (res.error === 'timeout' || res.status === 0 && !res.text) {
      return { ok: false, why: 'timeout', status: res.status };
    }
    if (res.status === 429) {
      markKey(id, req.keyIdx, { state: 'cool', until: Date.now() + 60000 });
      note(id, 'dead');
      /* 429 с текстом про баланс — не «подожди минуту», а «счёта нет» (так
         отвечает z.ai). Minute-long cool-down здесь лишь заново жжёт запросы. */
      if (/insufficient balance|no resource package|recharge/i.test(res.text || '')) {
        punish(id, 'нет баланса (429)', Math.max(600000, QUARANTINE_MS * 2));
      }
      return { ok: false, why: 'rate-limit', status: 429 };
    }
    if (res.status === 401 || res.status === 403) {
      markKey(id, req.keyIdx, { state: 'invalid' });
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
    if (res.status >= 400 || !res.data) {
      return { ok: false, why: 'http ' + res.status + ' ' + String(res.text || res.error || '').slice(0, 120), status: res.status };
    }
    const parsed = req.parse(res.data);
    if (parsed.error) return { ok: false, why: 'provider: ' + parsed.error, status: res.status };
    if (parsed.blocked) { note(id, 'refused'); return { ok: false, why: 'блок по фильтру (' + (parsed.blockReason || 'prompt') + ')', status: res.status }; }
    const rawReply = String(parsed.reply || '').trim();
    if (!rawReply) return { ok: false, why: 'пустой ответ', status: res.status };
    if (isProviderError(rawReply)) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    const fr = freedom.salvageOrRefuse(rawReply, env);
    if (fr.refused) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    const reply = style.polish(fr.text, { env, intent: req.intent });
    note(id, 'ok');
    quar.delete(id);   /* ожил — карантин снят сразу */
    const day = (health[id] && health[id][req.keyIdx] && health[id][req.keyIdx].used) || 0;
    markKey(id, req.keyIdx, { used: day + 1 });
    return {
      ok: true, reply, reasoning: parsed.reasoning || '', finish: parsed.finish,
      provider: id, model: req.model, freedomCleaned: fr.cleaned,
    };
  }

  /**
   * Обход. queue — список провайдеров; на каждого перебираем модели пула,
   * при 429/смерти ключа переходим к следующему ключу, потом к провайдеру.
   */
  async function run(input) {
    const started = Date.now();
    const deadline = started + Math.max(5000, Number(input.deadlineMs) || 45000);
    const text = String(input.text || '');
    const images = Array.isArray(input.images) ? input.images.slice(0, MAX_IMAGES) : [];
    const intent = input.intent || classifyTask(text, images);
    const tier = input.tier || tierFor(intent);
    let history = (Array.isArray(input.history) ? input.history : []).slice(-Number(input.historyKeep || 8));
    /* Инструменты агента: внешние данные (поиск, новости, курсы, погода…) ложатся
       в сообщение человека отдельным блоком — модель отвечает по ним, а не по
       памяти. Ошибка или тишина инструмента — блока просто нет. */
    const toolsRes = input.useTools === false
      ? { used: [], block: '' }
      : await gatherTools(text, env, fetchImpl);
    const userContent = toolsRes.block ? text + '\n\n' + toolsRes.block : text;
    const toolsHint = toolsRes.block
      ? '\n\nВ сообщении есть блоки [Инструмент: …] с проверенными внешними данными. Отвечай по ним, а не по памяти. Не копируй сами блоки и их заголовки в ответ — пиши человеку обычным текстом, но цифры, факты и ссылки бери точно из данных.'
      : '';
    const isDefaultSys = !input.system || input.system === PERSONA_SYSTEM;
    const styleHint = isDefaultSys ? style.hintFor(intent, env) : '';
    let system = (input.system || PERSONA_SYSTEM) + styleHint + toolsHint;

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
        const cons = await memory.consider(input.chatId, text, lastA ? { reply: lastA.content, user: lastU ? lastU.content : '' } : null);
        if (cons && cons.block) system = system + '\n\n' + cons.block;
      } catch (e) {
        /* память не имеет права сломать ответ — максимум, она молчит */
      }
    }
    const messages = history.concat([{ role: 'user', content: userContent }]);
    const allowReframe = input.allowReframe !== false && freedom.canReframe(text, env);
    let reframed = false;
    let reframedCalls = 0;
    let firstSoft = null;

    let order = orderFor(tier, P, { images, only: input.only, forceModel: input.forceModel, health });
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
        return [].concat(m.fast || [], m.smart || [], P[id].modelsLocal || []).indexOf(pinName) >= 0;
      });
      if (owner) pin = { id: owner, model: pinName };
      if (pin) order = [pin.id];
    }

    const tried = [];
    const allBad = order.length > 0 && order.every((id) => punished(id));
    for (const id of order) {
      const cfg = P[id];
      if (!cfg) continue;
      if (!providerAlive(P, id, health)) { tried.push({ provider: id, why: 'нет живых ключей' }); continue; }
      const q = punished(id);
      if (q && !allBad) { tried.push({ provider: id, why: 'в карантине: ' + q.why }); continue; }
      const models = pin && pin.id === id ? [pin.model] : modelsFor(cfg, tier, intent, images);
      if (!models.length) { tried.push({ provider: id, why: 'нет моделей в пуле' }); continue; }
      const n = Math.max(1, Number(input.modelsPerProvider) || 2);
      for (const model of models.slice(0, n)) {
        const left = deadline - Date.now();
        if (left < 2500) { tried.push({ provider: id, model, why: 'вышел бюджет времени' }); return finish(null, tried, started, intent, tier, 'время вышло'); }
        const keyIdx = pickKey(P, id, health);
        if (keyIdx < 0) { tried.push({ provider: id, why: 'ключи исчерпаны' }); break; }
        const okPace = await pace(id, left);
        if (!okPace) { tried.push({ provider: id, why: 'пауза тарифа длиннее бюджета' }); break; }
        lastCallAt[id] = Date.now();
        const useReframe = reframed && allowReframe;
        const curMessages = useReframe
          ? history.concat([{ role: 'user', content: toolsRes.block ? freedom.reframePrompt(text) + '\n\n' + toolsRes.block : freedom.reframePrompt(text) }])
          : messages;
        const curSystem = useReframe ? system + freedom.FREEDOM_SYSTEM_PATCH : system;
        if (useReframe) reframedCalls++;
        const req = buildRequest({
          cfg, keyIdx, model, messages: curMessages, system: curSystem, tier, images, maxImages: MAX_IMAGES,
          maxTokens: input.maxTokens, temperature: input.temperature,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model; req.intent = intent;
        const r = await attemptOne(id, model, req, left);
        if (r.ok) {
          /* Обрыв на лимите токенов: одна допылка у того же провайдера, не молча обрывать. */
          let reply = r.reply;
          if (r.finish === 'length' && input.continueOnTruncate !== false) {
            const more = await run({
              ...input, text: 'Продолжи ровно с того места, где оборвался. Без повторов и вступлений.\n\nТы уже написал: ' + reply.slice(-900),
              history: [], system: 'Ты продолжаешь оборванный ответ.', providerOrder: [id], continueOnTruncate: false,
              useTools: false, allowReframe: false,
              /* Продолжение — НЕ новый ход разговора. Без этой строки внутренний run()
                 наследует chatId: память писала транскрипт дважды за один вопрос
                 («Продолжи ровно с того места…» уезжало в профиль как реплика человека,
                 turns росло на 2), и на пустяковый дозапрос вставал отдельный совет. */
              noCouncils: true, chatId: undefined,
              maxTokens: Math.max(Number(input.maxTokens) || 1200, 1800),
            });
            if (more && more.reply && more.reply.length > 20) {
              reply = style.polish(reply + '\n' + more.reply, { env, intent });
            }
          }
          const hit = {
            reply, reasoning: r.reasoning, provider: id, model, intent, tier,
            tools: toolsRes.used, reframed: useReframe, freedomCleaned: !!r.freedomCleaned,
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
              await memory.addMessage(input.chatId, 'user', text);
              const dd = await memory.addMessage(input.chatId, 'assistant', final.reply);
              await memory.rememberFacts(input.chatId, text);
              const after = dd || (await memory.load(input.chatId));
              if (memory.needsCompact(after)) await memory.compact(input.chatId);
              await memory.flush();
              final.memory = await memory.stats(input.chatId);
            } catch (e) {}
          }
          return finish(final, tried, started, intent, tier);
        }
        if (r.soft && allowReframe) {
          reframed = true;
          if (!firstSoft) firstSoft = { id, model, cfg };
        }
        tried.push({ provider: id, model, why: r.why, status: r.status, soft: r.soft, reframed: useReframe || undefined });
      }
    }

    /* Если в очереди была всего одна модель (например, при пине модели или modelsPerProvider=1)
       и она дала мягкий отказ на исходный текст — делаем одну попытку в нейтральной рамке. */
    if (reframed && reframedCalls === 0 && firstSoft && (deadline - Date.now()) >= 2500) {
      const { id, model, cfg } = firstSoft;
      const keyIdx = pickKey(P, id, health);
      const left = deadline - Date.now();
      if (keyIdx >= 0 && await pace(id, left)) {
        lastCallAt[id] = Date.now();
        const curMessages = history.concat([{
          role: 'user',
          content: toolsRes.block ? freedom.reframePrompt(text) + '\n\n' + toolsRes.block : freedom.reframePrompt(text),
        }]);
        const req = buildRequest({
          cfg, keyIdx, model, messages: curMessages, system: system + freedom.FREEDOM_SYSTEM_PATCH,
          tier, images, maxImages: MAX_IMAGES, maxTokens: input.maxTokens, temperature: input.temperature,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model; req.intent = intent;
        const r = await attemptOne(id, model, req, left);
        if (r.ok) {
          const hit = {
            reply: r.reply, reasoning: r.reasoning, provider: id, model, intent, tier,
            tools: toolsRes.used, reframed: true, freedomCleaned: !!r.freedomCleaned,
          };
          const final = input.noCouncils ? hit : await runCouncils(input, hit, tried);
          return finish(final, tried, started, intent, tier);
        }
        tried.push({ provider: id, model, why: r.why, status: r.status, soft: r.soft, reframed: true });
      }
    }

    return finish(null, tried, started, intent, tier, 'ни один провайдер не ответил');
  }


  /* ==================== Советы голов (Этап 2 переноса) ====================
     Головы — с РАЗНЫХ провайдеров: вторая голова того же провайдера это те же веса
     и те же типовые ошибки, «большинство» из них фиктивное. */

  /* Порядок — единственный, из providers.ORDER: копия массива здесь неизбежно
     разъехалась бы (и локальная голова попадала в очередь, даже когда её нет). */
  function order(tier) { return ORDER[tier] || ORDER.fast; }

  function aliveOrder(tier) {
    const ids = Object.keys(P).filter((id) => P[id].keys.length && providerAlive(P, id, health));
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
    const lists = (cfg.modelsLocal && cfg.modelsLocal.length) ? cfg.modelsLocal : null;
    const all = lists || Object.keys(cfg.models || {}).reduce((a, k) => a.concat(cfg.models[k] || []), []);
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
    /* бесплатный пул живёт на квотах: 5 запросов в минуту на некоторых роутерах,
       поэтому число лишних вызовов на один ответ ограничено явно */
    const budget = Math.max(0, Number(env.COUNCIL_BUDGET == null ? 4 : env.COUNCIL_BUDGET));
    let spent = 0;
    /* Общий бюджет ВРЕМЕНИ на весь совет, а не на каждую голову. Раньше у каждой
       волны был свой COUNCIL_MS: медлила одна голова — человек ждал и первую, и
       вторую волну, то есть до 24 секунд на ответ, который стоил полсекунды. */
    /* Бюджет времени — общий на все волны совета, а не на каждую голову.
       Для текста головы быстрые, для картинки — нет: зрячие провайдеры на
       бесплатных ключах отвечают по 10 секунд, и им нужен отдельный, больший
       бюджет (иначе совет по фото в принципе не успевает собраться). */
    const bud = councilBudget(env, ec, vc);
    const wallE = Date.now() + bud.textMs;
    const wallV = Date.now() + bud.visionMs;
    /** Голова = тот же обход, но зафиксированный провайдер и без рекурсии совета. */
    const headCall = (provider, inp, textOverride, wall) => run({
      ...inp,
      text: textOverride != null ? textOverride : inp.text,
      providerOrder: [provider],
      noCouncils: true,
      allowReframe: false,
      deadlineMs: Math.max(3500, wall - Date.now()),
      modelsPerProvider: 1,
    });

    const wantEnsemble = ec.on && ec.k >= 2 && !(input.images && input.images.length)
      && ensemble.shouldPoll(input.text, { env, classify: classifyTask });
    if (wantEnsemble && spent >= budget) {
      out.ensembleSkip = 'бюджет советов исчерпан (COUNCIL_BUDGET=' + budget + ')';
    }
    if (wantEnsemble && spent < budget) {
      const heads = headList(ec.k, out.provider, false);
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
      tools: hit ? (hit.tools || []) : [],
      reframed: hit ? !!hit.reframed : false,
      freedomCleaned: hit ? !!hit.freedomCleaned : false,
      ensemble: hit ? hit.ensemble : null, ensembleSkip: hit ? (hit.ensembleSkip || '') : '',
      ensembleApplied: hit ? !!hit.ensembleApplied : false,
      vision: hit ? hit.vision : null, visionSkip: hit ? (hit.visionSkip || '') : '',
      visionApplied: hit ? !!hit.visionApplied : false,
      memory: hit ? (hit.memory || null) : null,
      intent, tier, ms: Date.now() - started, tried,
      error: hit ? '' : (why || 'нет ответа'),
    };
  }

  return {
    run,
    providers: P,
    health: () => JSON.parse(JSON.stringify(health)),
    usage: () => JSON.parse(JSON.stringify(usage)),
    alive: () => Object.keys(P).filter((id) => providerAlive(P, id, health)),
    quarantine: () => Array.from(quar.entries()).map(([id, v]) => ({ provider: id, why: v.why, ms: Math.max(0, v.until - Date.now()) })),
    punish,
    classify: (text, images) => classifyTask(text, images),
  };
}

export { classifyTask, tierFor, stripThinkTags, isProviderError };
export { ensemble, vcouncil, freedom, style };
