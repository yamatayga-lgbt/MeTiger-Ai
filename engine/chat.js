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
  buildTable, providerAlive, pickKey, orderFor, MIN_INTERVAL, TIMEOUT, MAX_IMAGES,
} from './providers.js';
import { classifyTask, tierFor, modelsFor } from './route.js';
import { buildRequest, rawCall, isProviderError, isRefusal, stripThinkTags } from './shape.js';

export const PERSONA_SYSTEM =
  'Ты — MeTiger Ai, универсальный ИИ-агент в Telegram Mini App. Отвечаешь на языке '
  + 'человека, по делу и без вступлений («конечно», «отличный вопрос», «как модель я не могу»). '
  + 'Код и файлы — в fence с языком. Если факта не знаешь — говоришь прямо, что не знаешь, '
  + 'и не додумываешь. Не извиняешься за себя и не добавляю дисклеймеров.';

export function createEngine(opts) {
  const o = opts || {};
  const env = o.env || {};
  const fetchImpl = o.fetch || ((...a) => fetch(...a));
  const P = buildTable(env);
  const health = Object.create(null);   /* id → [ключевое состояние] */
  const lastCallAt = Object.create(null);
  const usage = Object.create(null);    /* id → { calls, ok, refused, dead, t } */
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

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
      return { ok: false, why: 'rate-limit', status: 429 };
    }
    if (res.status === 401 || res.status === 403) {
      markKey(id, req.keyIdx, { state: 'invalid' });
      note(id, 'dead');
      return { ok: false, why: 'ключ не принят', status: res.status };
    }
    if (res.status === 402 || /insufficient balance|credit/i.test(res.text || '')) {
      markKey(id, req.keyIdx, { state: 'day', deadAt: Date.now() });
      return { ok: false, why: 'квота/баланс', status: res.status };
    }
    if (res.status >= 400 || !res.data) {
      return { ok: false, why: 'http ' + res.status + ' ' + String(res.text || res.error || '').slice(0, 120), status: res.status };
    }
    const parsed = req.parse(res.data);
    if (parsed.error) return { ok: false, why: 'provider: ' + parsed.error, status: res.status };
    if (parsed.blocked) { note(id, 'refused'); return { ok: false, why: 'блок по фильтру (' + (parsed.blockReason || 'prompt') + ')', status: res.status }; }
    const reply = String(parsed.reply || '').trim();
    if (!reply) return { ok: false, why: 'пустой ответ', status: res.status };
    if (isProviderError(reply) || isRefusal(reply)) { note(id, 'refused'); return { ok: false, why: 'ответ-отказ', status: res.status, soft: true }; }
    note(id, 'ok');
    const day = (health[id] && health[id][req.keyIdx] && health[id][req.keyIdx].used) || 0;
    markKey(id, req.keyIdx, { used: day + 1 });
    return { ok: true, reply, reasoning: parsed.reasoning || '', finish: parsed.finish, provider: id, model: req.model };
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
    const history = (Array.isArray(input.history) ? input.history : []).slice(-Number(input.historyKeep || 8));
    const messages = history.concat([{ role: 'user', content: text }]);
    const system = input.system || PERSONA_SYSTEM;

    let order = orderFor(tier, P, { images, only: input.only, forceModel: input.forceModel, health });
    if (input.providerOrder && input.providerOrder.length) {
      order = input.providerOrder.filter((id) => P[id] && P[id].keys.length);
    }

    const tried = [];
    for (const id of order) {
      const cfg = P[id];
      if (!cfg) continue;
      if (!providerAlive(P, id, health)) { tried.push({ provider: id, why: 'нет живых ключей' }); continue; }
      const models = modelsFor(cfg, tier, intent, images);
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
        const req = buildRequest({
          cfg, keyIdx, model, messages, system, tier, images, maxImages: MAX_IMAGES,
          maxTokens: input.maxTokens, temperature: input.temperature,
        });
        req.tier = tier; req.keyIdx = keyIdx; req.model = model;
        const r = await attemptOne(id, model, req, left);
        if (r.ok) {
          /* Обрыв на лимите токенов: одна допылка у того же провайдера, не молча обрывать. */
          let reply = r.reply;
          if (r.finish === 'length' && input.continueOnTruncate !== false) {
            const more = await run({
              ...input, text: 'Продолжи ровно с того места, где оборвался. Без повторов и вступлений.\n\nТы уже написал: ' + reply.slice(-900),
              history: [], system: 'Ты продолжаешь оборванный ответ.', providerOrder: [id], continueOnTruncate: false,
              maxTokens: Math.max(Number(input.maxTokens) || 1200, 1800),
            });
            if (more && more.reply && more.reply.length > 20) reply = reply + '\n' + more.reply;
          }
          return finish({ reply, reasoning: r.reasoning, provider: id, model, intent, tier }, tried, started, intent, tier);
        }
        tried.push({ provider: id, model, why: r.why, status: r.status, soft: r.soft });
      }
    }
    return finish(null, tried, started, intent, tier, 'ни один провайдер не ответил');
  }

  function finish(hit, tried, started, intent, tier, why) {
    return {
      ok: !!hit, reply: hit ? hit.reply : '', reasoning: hit ? hit.reasoning : '',
      provider: hit ? hit.provider : '', model: hit ? hit.model : '',
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
    classify: (text, images) => classifyTask(text, images),
  };
}

export { classifyTask, tierFor, stripThinkTags, isProviderError };
