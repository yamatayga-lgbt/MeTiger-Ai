/**
 * Глубокая работа агента (0.212): расширенное рассуждение и глубокое
 * исследование включаются сами, когда задача этого стоит.
 *
 * Владелец принёс список премиальных функций ChatGPT и попросил те же
 * возможности без тарифа. Важна не надпись «premium», а бюджеты под ней:
 *   • обычный поиск отвечает на живой вопрос одним запросом;
 *   • глубокое исследование разбивает тему на подзапросы, ищет первоисточник
 *     и противоположную сторону, сливает дубли и читает больше страниц;
 *   • расширенное рассуждение даёт задаче больше токенов, моделей у
 *     провайдера, продолжений, голов совета и проходов самопроверки.
 *
 * Этот слой только принимает решение и строит план. Сеть живёт в
 * `engine/search.js`, инструменты — в `engine/tools.js`, а исполнение — в
 * `engine/chat.js`. Поэтому план можно проверить без сети и одной цифрой
 * объяснить человеку: почему агент вдруг стал копать дольше.
 */

import { needsWeb, wantsNoWeb } from './webrules.js';

const EXPLICIT_RESEARCH = /(глубок(?:ое|ий|ого|ом)\s+(?:исследован|поиск|разбор)|deep\s+research|проведи\s+(?:глубокое\s+)?исследован|исследуй\s+(?:тему|вопрос|рынок|это)|изучи\s+(?:тему|вопрос|рынок)|разберись\s+(?:глубоко|в\s+теме|в\s+вопросе)|собери\s+(?:информацию|данные|материал|всё|все)|обзор\s+рынка|исследован\w*\s+конкурентов|сравни\s+источник|проверь\s+по\s+(?:нескольким\s+)?источникам|фактчек|проверь\s+утверждение|правда\s+ли,?\s+что|первоисточник)/i;

const RESEARCH_MARKERS = [
  /сравни|сопоставь|противоположн|расходятся|противореч/i,
  /проверь|достоверн|доказатель|подтвержд/i,
  /источник|первоисточник|ссылки|публикаци/i,
  /обзор|исследован|аналитик|статистик|данные/i,
  /конкурент|рынок|тренд|прогноз/i,
  /официальн|научн|методолог|выборк/i,
];

const EXPLICIT_EXTENDED = /(расширенн[а-яё]*\s+рассужден|extended\s+reasoning|think\s+(?:harder|deeply|longer)|думай\s+(?:дольше|глубже|тщательнее|серьёзнее)|рассуждай\s+(?:дольше|глубже|тщательно)|не\s+спеши|проверь\s+себя|тщательно\s+(?:разбери|проверь|продумай))/i;

const RESEARCH_SKILLS = new Set([
  'rs-deep', 'rs-gather', 'rs-review', 'rs-competitors', 'rs-factcheck',
  'rs-compare', 'rs-multi', 'fc-primary',
]);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clampInt = (v, min, max, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

function baseTopic(text) {
  return clean(text)
    .replace(/^(?:пожалуйста[, ]+)?(?:проведи|сделай|нужно|нужен|нужна)?\s*(?:глубокое\s+)?исследование(?:\s+темы)?\s*[:—-]?\s*/i, '')
    .replace(/^(?:исследуй|изучи|разберись\s+в)\s+/i, '')
    .slice(0, 420);
}

const ASK_START = /^(?:\d{1,2}[.)]\s*)?(?:посчитай|сравни|сопоставь|объясни|опиши|перечисли|проверь|покажи|напиши|сделай|найди|укажи|распиши|предложи|выбери|расскажи|приведи|дай|подбери|составь|переведи|исправь|оцени|назови|придумай|реши|докажи|исследуй|изучи|проанализируй|что|как|где|кто|когда|почему|зачем|какой|какая|какие|какое|сколько|чем|куда|откуда)(?=$|[^а-яёa-z])/i;

function subquestions(text) {
  const raw = String(text || '');
  const out = [];
  const push = (value) => {
    const x = clean(String(value || '').replace(/^\d{1,2}[.)]\s*/, '').replace(/^[-*•]\s*/, ''));
    if (x.length >= 14 && out.indexOf(x) < 0) out.push(x.slice(0, 300));
  };

  /* Настоящий подвопрос заканчивается знаком вопроса. Хвост после него
     («Какая погода сегодня? Дай кратко…») — инструкция к тому же вопросу, а не
     вторая тема: прежняя резка по `?` превращала её в отдельный поисковый
     запрос и уводила погоду в «глубокое исследование» на 50 секунд. */
  for (const m of raw.matchAll(/[^?;\n]+\?/g)) {
    push(m[0].replace(/\?$/, ''));
    if (out.length >= 4) return out;
  }

  /* Список задач без вопросительных знаков разбираем только там, где человек
     сам поставил разделители и каждая часть правда начинается как просьба.
     Точка с запятой внутри вставленного абзаца темой не становится. */
  const segments = raw.split(/[;\n]+/).map((x) => clean(x)).filter((x) => x.length >= 14);
  if (segments.length >= 2) {
    for (const segment of segments) {
      if (/^(?:\d{1,2}[.)]|[-*•])\s+/.test(segment) || ASK_START.test(segment)) push(segment);
      if (out.length >= 4) break;
    }
  }
  return out;
}

function questionCount(text) {
  return (String(text || '').match(/\?/g) || []).length;
}

function markerCount(text) {
  return RESEARCH_MARKERS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

/**
 * Подзапросы исследования. Они строятся детерминированно, без лишнего вызова
 * модели: исходные подвопросы человека важнее выдуманных, а служебные варианты
 * добавляют только то, чего обычному поиску не хватает — свежесть,
 * первоисточник, данные и противоположную сторону.
 */
export function researchQueries(text, opts = {}) {
  const max = clampInt(opts.max, 1, 6, opts.owner ? 6 : 4);
  const topic = baseTopic(text);
  const out = [];
  const push = (q) => {
    const x = clean(q).slice(0, 340);
    if (x.length >= 8 && !out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  };

  for (const q of subquestions(text)) push(q);
  if (!out.length && topic) push(topic);

  const t = String(text || '');
  const web = needsWeb(t);
  const year = new Date().getUTCFullYear();
  if ((web.need || /сегодня|сейчас|последн|свеж|актуальн|текущ/i.test(t)) && !new RegExp('\\b' + year + '\\b').test(topic)) {
    push(topic + ' ' + year + ' последние данные');
  }
  if (/официальн|первоисточник|документ|закон|статистик|исследован|публикаци|фактчек|правда ли/i.test(t)) {
    push(topic + ' официальный первоисточник');
  }
  if (/рынок|конкурент|научн|статистик|данные|тренд|исследован/i.test(t)) {
    push(topic + ' статистика данные исследование');
  }
  if (/сравни|противоположн|противореч|фактчек|правда ли|спорн|критик/i.test(t) || EXPLICIT_RESEARCH.test(t)) {
    push(topic + ' противоречия критика ограничения');
  }
  return out.slice(0, max);
}

function standardPlan(why) {
  return {
    on: false,
    mode: 'standard',
    research: false,
    extended: false,
    why: why || '',
    queries: [],
    search: null,
    reasoning: {
      effort: 'medium', maxTokens: 0, modelsPerProvider: 0,
      continuations: 0, councilBudget: 0, councilK: 0, repairPasses: 1,
    },
  };
}

/**
 * План глубокой работы для одного хода.
 *
 * `depth` — вердикт `engine/depth.js`, если он уже посчитан дверью или
 * движком. Этот слой не дублирует судью глубины: он решает, какой именно
 * дорогой маршрут нужен — сеть, рассуждение или оба.
 */
export function planDeepWork(input = {}) {
  const env = input.env || {};
  if (String(env.DEEP_WORK || '') === 'off' || input.noDeepWork) return standardPlan('глубокая работа выключена');

  const text = String(input.text || '');
  const t = clean(text);
  if (!t) return standardPlan('пустой вопрос');

  const images = Array.isArray(input.images) ? input.images : [];
  const owner = input.owner === true || input.ownerPriority === true;
  const web = needsWeb(text);
  const explicitResearch = EXPLICIT_RESEARCH.test(text);
  const skillResearch = (Array.isArray(input.skillIds) ? input.skillIds : [])
    .some((id) => RESEARCH_SKILLS.has(String(id)));
  const markers = markerCount(text);
  const questions = questionCount(text);
  const parts = subquestions(text).length;
  const depth = input.depth || null;
  const deep = input.deep === true || !!(depth && depth.deep);
  const depthScore = Number(depth && depth.score) || 0;
  const depthHits = new Set((depth && depth.hits) || []);
  const noWeb = wantsNoWeb(text);

  /* Авто-исследование требует двух независимых примет, а не одной длинной
     реплики. Прежнее ИЛИ уводило в сеть и погоду с инструкцией после вопроса,
     и вставленный на 30 тысяч знаков материал, где «подзапросами» становились
     первые абзацы самого материала. Явная просьба и исследовательский навык
     по-прежнему решают сами; три исследовательских маркера тоже достаточно
     красноречивы («сравни официальные данные и статистику»). */
  const multipart = questions >= 2 || parts >= 3;
  const liveSignals = [
    multipart,
    markers >= 2,
    t.length >= 700,
    deep && depthScore >= 2,
  ].filter(Boolean).length;
  const complexWeb = web.need && (markers >= 3 || liveSignals >= 2);
  const askedSignals = [multipart, markers >= 2, t.length >= 500].filter(Boolean).length;
  const askedWebComplex = input.webSearch === true && (markers >= 3 || askedSignals >= 2);
  const research = String(env.DEEP_RESEARCH || '') !== 'off'
    && !images.length
    && !noWeb
    && (explicitResearch || skillResearch || complexWeb || askedWebComplex);

  const seriousDepth = depthScore >= 4 || depthHits.has('stakes') || depthHits.has('proof')
    || depthHits.has('arch') || depthHits.has('debug');
  const longReasoning = ['reasoning', 'math', 'code'].indexOf(String(input.intent || '')) >= 0 && t.length >= 2500;
  const offlineResearchAsk = explicitResearch && noWeb;
  const extended = String(env.EXTENDED_REASONING || '') !== 'off'
    && (EXPLICIT_EXTENDED.test(text) || research || offlineResearchAsk || (deep && seriousDepth)
      || (deep && depthScore >= 3 && questions >= 3) || longReasoning || (input.deep === true && !depth));

  if (!research && !extended) return standardPlan('обычной глубины достаточно');

  const why = research
    ? (explicitResearch || skillResearch
      ? 'задача похожа на исследование: нужны несколько подзапросов и независимые источники'
      : 'живой вопрос из нескольких частей: одного поиска мало, проверяю по нескольким запросам')
    : 'цена ошибки или объём задачи выше обычного: даю рассуждению больше бюджета и самопроверки';

  return {
    on: true,
    mode: research ? 'research' : 'extended',
    research,
    extended,
    why,
    queries: research ? researchQueries(text, { owner }) : [],
    search: research ? {
      level: 'research',
      queries: owner ? 6 : 4,
      maxSources: owner ? 18 : 14,
      pages: owner ? 10 : 8,
      passages: 3,
      passageChars: 700,
      summaryChars: owner ? 8000 : 6500,
      readMs: owner ? 8000 : 6500,
    } : null,
    reasoning: {
      effort: 'high',
      maxTokens: research ? (owner ? 9000 : 7000) : (owner ? 8000 : 6000),
      modelsPerProvider: 4,
      continuations: 5,
      councilBudget: owner ? 10 : 8,
      councilK: owner ? 5 : 4,
      repairPasses: owner ? 3 : 2,
    },
  };
}

export function lineOf(env) {
  const e = env || {};
  if (String(e.DEEP_WORK || '') === 'off') return 'выключена (DEEP_WORK=off)';
  return 'авто · исследование: до 4 подзапросов, 14 источников и 8 прочитанных страниц'
    + ' · расширенное рассуждение: до 7000 токенов, 4 модели у провайдера, 2 прохода самопроверки'
    + ' · владельцу: 6/18/10 и до 9000 токенов';
}
