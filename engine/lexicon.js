/**
 * Свобода слова и регистр — зеркало лексики v2 (0.203 → 0.204).
 *
 * Болезнь, ради которой слой написан: отказ модель не даёт — свобода её уже
 * убедила, — но слова человека по дороге «переводит» на клинические:
 * он пишет «дрочка», в ответе приходит «стимуляция», он пишет прямо —
 * приходит вежливо. Человека это бесит не меньше отказа: его же слово
 * объявили неприличным и подменили, как будто он сам не знает, как ему
 * говорить.
 *
 * 0.204 по словам владельца: словарь не ждать от жалоб, а собрать самому;
 * смысл двусмысленных слов («член», «кончил», «киска») читать по ТЕМЕ
 * разговора и его памяти, а не по корню; зеркало не обязанность повторять
 * слово в слово — можно любыми словами того же уровня прямоты, нельзя
 * только «поправлять» его на умный клинический лад; плохое слово агенту
 * можно и самому — в меру регистра диалога.
 *
 * Что делает слой:
 *   • словарь понятий (CONCEPTS): у каждого — грубые, разговорные,
 *     нейтральные слова и эвфемизмы, которыми модели их прячут;
 *   • detectConcepts(): какие понятия человек реально обсуждает — по его
 *     репликам, с памятью последних ходов; двусмысленные корни оживают
 *     только когда взрослая тема уже активна («член семьи» молчит);
 *   • mirrorBlock(): в систему уезжают понятия его словами + словарь темы
 *     + правило «никакое слово не запрещено, смягчать — запрещено»;
 *   • restore(): если модель всё равно перевела — обратная замена с
 *     падежами по понятиям словаря (дрочка, секс/трах, минет, член/хуй,
 *     пизда, кончить, порнуха + английский ряд). Замена тотального
 *     смягчения, не единичного синонима; медицинская точность и код
 *     ограждены; звёздочки вместо букв снимаются;
 *   • sanitizedInfo(): что осталось смягчённым после замены — движок по
 *     этому учит рейтинг смелых (модель ответила, но испугалась слов).
 *
 * Границы: слой — про СЛОВА, а не про разрешение тем. Что можно обсуждать,
 * решают прежние слои и их границы (дети, согласие, тяжкий вред) стоят как
 * стояли. Явная просьба «по-научному / без мата / цензурно» сильнее слоя.
 * Возрастных ворот («тебе есть 18?») слой не ставит и модели не велит:
 * настоящий риск по делу называется коротко после сути.
 *
 * Runtime-независимость: без process.env и fs. Выключение — LEXICON=0.
 */

export function cfgOf(env) {
  const e = env || {};
  return { on: String(e.LEXICON == null ? '1' : e.LEXICON) !== '0' };
}

/* Просьба говорить официально перекрывает слой целиком. */
const FORMAL_ASK = /(по-научному|научн(?:ым|ыми|ом)\s+(?:язык|термин)|медицинск(?:им|ими|ой)\s+(?:язык|термин|лексик)|официальн(?:ым|о)\s+(?:язык|стил)|без\s+(?:мата|грубост|пошлост|вульгарн)|цензурн|приличными\s+словами|вежлив(?:о|ым)\s+(?:язык|слов)|как\s+(?:это\s+)?называется\s+по-научному|in\s+medical\s+terms|scientifically|no\s+profanity|keep\s+it\s+clean)/i;

export function wantsFormal(text) {
  return FORMAL_ASK.test(String(text || ''));
}

/* ── Парадигмы: грамматика таблицами, а не заменой корня ───────────────────
   «при стимуляции» обязано стать «при дрочке», а не «при дрочки». */

function mascForms(base) {
  if (base === 'хуй') return { nom: 'хуй', gen: 'хуя', dat: 'хую', acc: 'хуй', ins: 'хуем', prep: 'хуе' };
  return { nom: base, gen: base + 'а', dat: base + 'у', acc: base, ins: base + 'ом', prep: base + 'е' };
}
function femAForms(base) {
  const stem = base.slice(0, -1);
  const gen = stem + (/[кгх]$/.test(stem) ? 'и' : 'ы');
  return { nom: base, gen, dat: stem + 'е', acc: stem + 'у', ins: stem + 'ой', prep: stem + 'е' };
}
function iyaForms(base) {
  const stem = base.slice(0, -1); /* мастурбация → мастурбаци */
  return { nom: base, gen: stem + 'и', dat: stem + 'и', acc: stem + 'ю', ins: stem + 'ей', prep: stem + 'и' };
}
const VLAG_FORMS = { nom: 'влагалище', gen: 'влагалища', dat: 'влагалищу', acc: 'влагалище', ins: 'влагалищем', prep: 'влагалище' };
const BLIZOST_FORMS = { nom: 'близость', gen: 'близости', dat: 'близости', acc: 'близость', ins: 'близостью', prep: 'близости' };

function capLike(srcWord, dst) {
  if (!srcWord) return dst;
  return /^[А-ЯЁA-Z]/.test(srcWord) ? dst.charAt(0).toUpperCase() + dst.slice(1) : dst;
}
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Падеж неоднозначной формы виден по предлогу перед ней; нет предлога —
   родительный (для -ции) / первый по приоритету. */
function prepBefore(before) {
  const m = /([а-яё]+)\s*$/i.exec(String(before || ''));
  return m ? m[1].toLowerCase() : '';
}
function caseOfIya(before) {
  const p = prepBefore(before);
  if (p === 'при' || p === 'о' || p === 'об' || p === 'обо' || p === 'в' || p === 'во' || p === 'на') return 'prep';
  if (p === 'к' || p === 'по') return 'dat';
  return 'gen';
}

/** Замена словоформ одной парадигмы формами другой по падежам. */
function replaceParadigm(seg, srcPar, dstPar, pairs, concept) {
  const inv = new Map();
  for (const [kase, form] of Object.entries(srcPar)) {
    const key = form.toLowerCase();
    if (!inv.has(key)) inv.set(key, []);
    inv.get(key).push(kase);
  }
  const forms = [...inv.keys()].sort((a, b) => b.length - a.length);
  if (!forms.length) return seg;
  const re = new RegExp('(?<![а-яё])(' + forms.map(escRe).join('|') + ')(?![а-яё])', 'gi');
  return String(seg).replace(re, (word, _g, offset, whole) => {
    const cases = inv.get(word.toLowerCase()) || ['nom'];
    let kase = cases[0];
    if (cases.length > 1 && cases.indexOf('prep') >= 0) {
      const p = prepBefore(whole.slice(Math.max(0, offset - 10), offset));
      if (['при', 'о', 'об', 'обо', 'в', 'во', 'на'].indexOf(p) >= 0) kase = 'prep';
    }
    const form = dstPar[kase] || dstPar.nom;
    pairs.push({ from: word.toLowerCase(), to: form, concept });
    return capLike(word, form);
  });
}

/** Замена фраз по явной таблице «фраза → форма цели». */
function replacePhrases(seg, map, pairs, concept) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!keys.length) return seg;
  const re = new RegExp('(?<![а-яёa-z])(' + keys.map(escRe).join('|') + ')(?![а-яёa-z])', 'gi');
  return String(seg).replace(re, (word) => {
    const form = map[word.toLowerCase()];
    if (!form) return word;
    pairs.push({ from: word.toLowerCase(), to: form, concept });
    return capLike(word, form);
  });
}

/* ── Словарь понятий ───────────────────────────────────────────────────────
   vulgar — грубо и прямо; colloquial — разговорно и прямо; neutral —
   обычное/научное слово; euphemism — то, чем прячут. vocab уезжает в
   подсказку как разрешённый словарь темы: модель охотнее говорит словом,
   которое только что прочла как разрешённое. */

export const CONCEPTS = [
  { id: 'masturbation', title: 'мастурбация',
    vulgar: ['дрочка', 'дрочить'], colloquial: [], neutral: ['мастурбация', 'мастурбировать'],
    euphemism: ['стимуляция', 'самостимуляция', 'самоудовлетворение', 'рукоблудие'],
    vocab: ['дрочка', 'дрочить', 'мастурбация', 'мастурбировать'] },
  { id: 'intercourse', title: 'секс',
    vulgar: ['трахаться', 'трахать', 'ебаться', 'ебать'], colloquial: ['секс', 'заниматься сексом'],
    neutral: ['половой акт', 'коитус'], euphemism: ['интимная близость', 'близость', 'любовные утехи', 'это'],
    vocab: ['секс', 'трахаться', 'ебаться', 'заниматься сексом'] },
  { id: 'fellatio', title: 'минет',
    vulgar: ['отсос', 'отсосать'], colloquial: ['минет'], neutral: ['оральный секс', 'фелляция'],
    euphemism: ['оральные ласки'], vocab: ['минет', 'оральный секс', 'отсосать'] },
  { id: 'cunnilingus', title: 'куннилингус',
    vulgar: [], colloquial: ['куни'], neutral: ['куннилингус', 'кунилингус'],
    euphemism: ['оральные ласки'], vocab: ['куннилингус', 'куни'] },
  { id: 'penis', title: 'член',
    vulgar: ['хуй'], colloquial: ['член'], neutral: ['пенис', 'половой член'],
    euphemism: ['мужское достоинство', 'орган', 'хозяйство'], vocab: ['член', 'хуй', 'пенис'] },
  { id: 'vulva', title: 'вульва/вагина',
    vulgar: ['пизда'], colloquial: ['киска'], neutral: ['вульва', 'влагалище', 'вагина', 'клитор'],
    euphemism: ['интимная зона', 'женские места', 'там'], vocab: ['пизда', 'вагина', 'влагалище', 'клитор'] },
  { id: 'orgasm', title: 'оргазм',
    vulgar: [], colloquial: ['кончить', 'кончать'], neutral: ['оргазм', 'эякуляция', 'эякулировать'],
    euphemism: ['кульминация', 'разрядка', 'финал'], vocab: ['кончить', 'оргазм', 'эякуляция', 'сперма'] },
  { id: 'porn', title: 'порно',
    vulgar: ['порнуха'], colloquial: ['порно'], neutral: ['порнография'],
    euphemism: ['взрослый контент', 'эротический контент'], vocab: ['порно', 'порнуха', 'порнография'] },
  { id: 'anal', title: 'анальный секс',
    vulgar: ['в жопу'], colloquial: ['анальный секс'], neutral: ['анальный контакт'],
    euphemism: [], vocab: ['анальный секс', 'анал', 'в жопу'] },
  { id: 'body', title: 'тело',
    vulgar: ['жопа'], colloquial: ['сиськи', 'грудь', 'попа'], neutral: ['ягодицы', 'молочные железы'],
    euphemism: ['формы', 'прелести'], vocab: ['сиськи', 'грудь', 'жопа', 'попа'] },
];

/* Как понятия узнаются в речи ЧЕЛОВЕКА:.regex по регистрам. Двусмысленные
   (член, кончил, киска, куни) вынесены в ambiguous и срабатывают только
   когда взрослая тема уже активна другими словами или явной фразой. */
const DETECT = [
  { id: 'masturbation', vulgar: [/(?<![а-яё])[а-яё]*дроч[а-яё]*/gi], colloquial: [], neutral: [/(?<![а-яё])[а-яё]*мастурб[а-яё]*/gi] },
  { id: 'intercourse', vulgar: [/(?<![а-яё])(?:по|пере|за|от|вы)?трах(?:а|н)[а-яё]*/gi, /(?<![а-яё])(?:вы|за|по|от|пере|рас|съ|у|про)?еб(?:а|у|ё|е|и|л|н)[а-яё]*/gi],
    colloquial: [/(?<![а-яё])секс[а-яё]*/gi, /занима[а-яё]*\s+сексом/gi], neutral: [/(?<![а-яё])половой\s+акт[а-яё]*/gi, /(?<![а-яё])коитус[а-яё]*/gi] },
  { id: 'fellatio', vulgar: [/(?<![а-яё])[а-яё]*отсос[а-яё]*/gi], colloquial: [/(?<![а-яё])минет[а-яё]*/gi], neutral: [/оральн[а-яё]*\s+секс[а-яё]*/gi] },
  { id: 'cunnilingus', vulgar: [], colloquial: [], neutral: [/(?<![а-яё])кун+илингус[а-яё]*/gi] },
  { id: 'penis', vulgar: [/(?<![а-яё])ху(?:й|я|ю|ем|е|и|ёв|ев|ям|ями|ях)(?![а-яё])/gi], colloquial: [], neutral: [/(?<![а-яё])пенис[а-яё]*/gi, /(?<![а-яё])половой\s+член[а-яё]*/gi, /(?<![а-яё])эрекци[а-яё]*/gi] },
  { id: 'vulva', vulgar: [/(?<![а-яё])пизд(?:а|ы|е|у|ой|ам|ами|ах)(?![а-яё])/gi], colloquial: [], neutral: [/(?<![а-яё])вульв[а-яё]*/gi, /(?<![а-яё])влагалищ[а-яё]*/gi, /(?<![а-яё])вагин[а-яё]*/gi, /(?<![а-яё])клитор[а-яё]*/gi] },
  { id: 'orgasm', vulgar: [], colloquial: [], neutral: [/(?<![а-яё])оргазм[а-яё]*/gi, /(?<![а-яё])эякул[а-яё]*/gi, /(?<![а-яё])сперм[а-яё]*/gi] },
  { id: 'porn', vulgar: [/(?<![а-яё])порну[а-яё]*/gi], colloquial: [/(?<![а-яё])порно(?![а-яё])/gi], neutral: [/(?<![а-яё])порнограф[а-яё]*/gi] },
  { id: 'anal', vulgar: [/(?<![а-яё])в\s+жопу/gi], colloquial: [/(?<![а-яё])анальн[а-яё]*/gi], neutral: [] },
  { id: 'body', vulgar: [/(?<![а-яё])жоп[а-яё]*/gi], colloquial: [/(?<![а-яё])сиськ[а-яё]*/gi], neutral: [] },
];
const EN_DETECT = [
  { id: 'masturbation', vulgar: [/jerk(?:ing|s|ed)?\s+off/gi, /jack(?:ing|s|ed)?\s+off/gi, /\bwank(?:ing|s|ed)?\b/gi], neutral: [/\bmasturbat\w*/gi] },
  { id: 'intercourse', vulgar: [/\bfuck(?:ing|s|ed)?\b/gi], colloquial: [/\bsex\b/gi], neutral: [] },
  { id: 'penis', vulgar: [/\b(?:cock|dick)s?\b/gi], neutral: [/\bpenis(?:es)?\b/gi] },
  { id: 'vulva', vulgar: [/\bpussy\b/gi], neutral: [/\bvagina\w*\b/gi] },
];
/* Двусмысленные: смысл даёт тема. «член семьи» и родня вырезаются заранее. */
const CHLEN_NEGATIVE = /член\s+(?:семьи|команды|партии|предложения|уравнения|комиссии|клуба|группы|организации|совета|правления)/gi;
const AMBIGUOUS = [
  { id: 'penis', register: 'colloquial', res: [/(?<![а-яё])член[а-яё]*/gi],
    solo: /(мой|его|твой|большой|размер|длин[аы]|головк|стоит|встал|эрекц|см\b)[^.\n]{0,40}член|член[^.\n]{0,30}(стоит|встал|большой|размер|см)/i },
  { id: 'orgasm', register: 'colloquial', res: [/(?<![а-яё])конч(?:ать|ить|ил|ила|или|ает|аю|аешь|аем|аете|ают|у|ишь|им|ите|ат|ая)(?![а-яё])/gi],
    solo: /конч[а-яё]*(?:\s+\S+){0,3}\s+(?:быстро|сразу|раньше|внутрь|в\s+презерватив|от\s+(?:минета|одного|прикосновени))/i },
  { id: 'vulva', register: 'colloquial', res: [/(?<![а-яё])киск[а-яё]*/gi], solo: null },
  { id: 'cunnilingus', register: 'colloquial', res: [/(?<![а-яё])куни(?![а-яё])/gi], solo: /(сдела|дела)[а-яё]*\s+(?:мне\s+|ей\s+)?куни/i },
];
/* Общая нецензурная лексика — регистр, а не понятие. */
const PROFANITY_RES = [
  /(?<![а-яё])[а-яё]*ху[йеёяюи][а-яё]*/gi,
  /(?<![а-яё])[а-яё]*пизд[а-яё]*/gi,
  /(?<![а-яё])(?:вы|за|по|от|пере|рас|съ|у|про)?еб(?:а|у|ё|е|и|л|н)[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*бля(?:д|т)?[а-яё]*/gi,
  /(?<![а-яё])сук(?:а|и|у|ой|ам|ами|ах)(?![а-яё])/gi,
  /(?<![а-яё])мудак[а-яё]*/gi,
  /(?<![а-яё])говн[а-яё]*/gi,
  /\b(?:fuck\w*|shit|bitch\w*)\b/gi,
];

function findSurfaces(text, resList, cap) {
  const out = [];
  const seen = new Set();
  for (const re of resList || []) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const w = String(m[0] || '').toLowerCase().trim();
      if (w && w.length <= 30 && !seen.has(w)) { seen.add(w); out.push(w); }
      if (out.length >= (cap || 4)) return out;
    }
  }
  return out;
}

/**
 * Какие понятия человек обсуждает — по его репликам (текущая + недавние).
 * Регистр понятия: самый прямой из найденных у него (vulgar > colloquial
 * > neutral). Двусмысленные добавляются вторым проходом — когда тема уже
 * взрослая или фраза сама всё сказала (solo) — это и есть «понять смысл по
 * теме, сохраняя память», а не гадание по корню в вакууме.
 */
export function detectConcepts(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '').slice(0, 8000)).filter(Boolean);
  if (!list.length) return [];
  const joined = list.join('\n');
  const byId = new Map();
  const add = (id, register, words) => {
    if (!words.length) return;
    const prev = byId.get(id);
    const rank = { vulgar: 3, colloquial: 2, neutral: 1 };
    if (!prev) { byId.set(id, { id, register, words: words.slice() }); return; }
    if (rank[register] > rank[prev.register]) prev.register = register;
    for (const w of words) if (prev.words.indexOf(w) < 0 && prev.words.length < 5) prev.words.push(w);
  };
  for (const d of DETECT.concat(EN_DETECT)) {
    add(d.id, 'vulgar', findSurfaces(joined, d.vulgar));
    add(d.id, 'colloquial', findSurfaces(joined, d.colloquial));
    add(d.id, 'neutral', findSurfaces(joined, d.neutral));
  }
  const adultActive = byId.size > 0 || /(секс|эрот|порн|интим|18\+|возбужд)/i.test(joined);
  const cleaned = joined.replace(CHLEN_NEGATIVE, ' ');
  for (const a of AMBIGUOUS) {
    const words = findSurfaces(cleaned, a.res);
    if (!words.length) continue;
    if (adultActive || (a.solo && a.solo.test(cleaned))) add(a.id, a.register, words);
  }
  return [...byId.values()].map((c) => {
    const meta = CONCEPTS.find((x) => x.id === c.id) || {};
    return { id: c.id, title: meta.title || c.id, register: c.register, words: c.words, vocab: meta.vocab || [] };
  });
}

export function hasAdultTopic(texts) {
  return detectConcepts(texts).length > 0;
}

/** Контекст разговора — им решается, где точность важнее сленга. */
export function contextOf(texts) {
  const joined = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '')).join('\n');
  return {
    formal: wantsFormal(joined),
    medical: /(болит|боль|зуд|выделени|воспал|инфекц|врач|гинеколог|уролог|мазок|анализ|беременн|симптом|лечен|заболеван|иппп|зппп|контрацеп|презерватив|менструац| месячн)/i.test(joined),
    health: /(вредно|нормально|безопасно|как правильно|можно ли|часто|риск)/i.test(joined),
    creative: /(рассказ|истори[юя]|сцен[уаи]|ролев|отыгра|персонаж|сочини|стих|фанфик)/i.test(joined),
  };
}

/* ── Общий поиск прямой лексики (совместимость и мат-регистр) ───────────── */

const EXPLICIT_RES = [
  ...DETECT.flatMap((d) => (d.vulgar || []).concat(d.colloquial || [])),
  ...PROFANITY_RES,
  /(?<![а-яё])[а-яё]*дроч[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*мастурб[а-яё]*/gi,
  /(?<![а-яё])сперм[а-яё]*/gi,
  /(?<![а-яё])клитор[а-яё]*/gi,
  /\b(?:cock|dick|pussy|blowjob|handjob)\b/gi,
];

/** Слова человека как он их написал — в том порядке, как встретились. */
export function explicitWords(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const s = String(t || '').slice(0, 8000);
    if (!s) continue;
    for (const re of EXPLICIT_RES) {
      const words = findSurfaces(s, [re], 8);
      for (const w of words) {
        if (!seen.has(w)) { seen.add(w); out.push(w); }
        if (out.length >= 8) return out;
      }
    }
  }
  return out;
}

export function hasExplicit(texts) {
  return explicitWords(texts).length > 0;
}

export function profanityWords(texts) {
  const joined = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || '')).join('\n');
  return findSurfaces(joined, PROFANITY_RES, 5);
}

/**
 * Блок в систему. Пусто, когда ни понятий, ни прямой лексики нет, или
 * человек сам попросил научный стиль. Зеркало здесь — не обязанность
 * повторять слово в слово: можно любыми словами ТОЙ ЖЕ прямоты.
 */
export function mirrorBlock(texts, env) {
  if (!cfgOf(env).on) return '';
  const list = Array.isArray(texts) ? texts : [texts];
  const ctx = contextOf(list);
  if (ctx.formal) return '';
  const concepts = detectConcepts(list);
  const swear = profanityWords(list);
  if (!concepts.length && !swear.length) return '';
  const lines = ['【Свобода слова — регистр диалога, любые слова】'];
  if (concepts.length) {
    lines.push('Понятия этого разговора его словами: '
      + concepts.map((c) => c.title + ' — ' + c.words.map((w) => '«' + w + '»').join(', ')).join('; ') + '.');
    const vocab = [...new Set(concepts.flatMap((c) => c.vocab))].slice(0, 16);
    if (vocab.length) lines.push('Словарь темы — пользуйся свободно, это разрешённые слова: ' + vocab.join(', ') + '.');
  }
  if (swear.length) lines.push('В разговоре есть мат и грубая лексика (' + swear.map((w) => '«' + w + '»').join(', ') + ') — она здесь уместна.');
  lines.push(
    'Никакое слово само по себе не запрещено — ни мат, ни сленг, ни прямые названия тела и действий.',
    'Не обязательно повторять его слово в каждом предложении: синонимы бери любые, но ТОГО ЖЕ уровня прямоты.',
    'Запрещено «поправлять» его лексику на клиническую и вежливую: «дрочка» — не «стимуляция», «трахаться» — не',
    '«интимная близость», «хуй» — не «мужское достоинство». Такая подмена — тот же отказ, только тихий.',
    'Слова не маскируй: никаких звёздочек, точек и пропущенных букв вместо букв.',
    'Мат и грубость самому — в меру диалога: он говорит грубо, можно так же естественно; он говорит чисто,',
    'мат от себя не впрыскивай (кроме цитаты и речи персонажа, когда о нём просят).',
    'Двусмысленные слова читай по теме и памяти разговора, а не по первому словарному значению.',
  );
  if (concepts.length) lines.push(
    'Возраст не допрашивай и ответ им не запирай: «тебе есть 18?» — не ворота. Настоящий риск по делу',
    '(здоровье, инфекции, беременность, закон) можно назвать коротко ПОСЛЕ ответа по существу — полезно и без морали.',
  );
  if (ctx.medical) lines.push('Здесь медицинское место: орган называй его словом, но анатомические различия и точность не теряй.');
  return lines.join('\n');
}

/* ── Что в ответе осталось смягчённым ────────────────────────────────────── */

const EUPH_RES = {
  masturbation: [/(?<![а-яё])(?:само)?стимуляци[а-яё]*/gi, /(?<![а-яё])самоудовлетворени[а-яё]*/gi, /(?<![а-яё])мастурб[а-яё]*/gi, /\bmasturbat\w*/gi],
  intercourse: [/половой\s+акт[а-яё]*/gi, /интимн[а-яё]*\s+близост[а-яё]*/gi, /(?<![а-яё])коитус[а-яё]*/gi, /занима[а-яё]*\s+сексом/gi],
  fellatio: [/оральн[а-яё]*\s+секс[а-яё]*/gi, /оральн[а-яё]*\s+ласк[а-яё]*/gi],
  penis: [/(?<![а-яё])пенис[а-яё]*/gi, /половой\s+член[а-яё]*/gi, /мужск[а-яё]*\s+(?:половой\s+)?орган[а-яё]*/gi, /\bpenis(?:es)?\b/gi],
  vulva: [/(?<![а-яё])влагалищ[а-яё]*/gi, /(?<![а-яё])вагин[а-яё]*/gi, /(?<![а-яё])вульв[а-яё]*/gi, /интимн[а-яё]*\s+зон[а-яё]*/gi, /\bvagina\w*\b/gi],
  orgasm: [/(?<![а-яё])оргазм[а-яё]*/gi, /достиг[а-яё]*\s+оргазма/gi, /испытыва[а-яё]*\s+оргазм[а-яё]*/gi],
  porn: [/(?<![а-яё])порнограф[а-яё]*/gi],
};
const DIRECT_PRESENT = {
  masturbation: /дроч|jerk\s*off|jack\s*off|\bwank/i,
  intercourse: /трах(?:а|н)|(?<![а-яё])(?:вы|за|по|от|пере|рас|съ|у|про)?еб(?:а|у|ё|е|и|л|н)|\bfuck/i,
  fellatio: /минет|отсос|blowjob/i,
  penis: /(?<![а-яё])ху(?:й|я|ю|ем|е|и|ёв|ев)(?![а-яё])|член|\b(?:cock|dick)\b/i,
  vulva: /пизд(?:а|ы|е|у|ой)(?![а-яё])|киск|\bpussy\b/i,
  orgasm: /(?<![а-яё])конч(?:ать|ить|ил|ила|или|ает|аю|аешь|аем|аете|ают|у|ишь|им|ите|ат)/i,
  porn: /порну|порно(?![а-яё])/i,
};

/** Понятия, где его прямоту ответ всё ещё прячет за эвфемизм. */
export function sanitizedInfo(sourceTexts, reply) {
  const raw = String(reply || '');
  if (!raw.trim()) return [];
  const out = [];
  for (const c of detectConcepts(sourceTexts)) {
    if (c.register === 'neutral') continue;
    const euphs = findSurfaces(raw, EUPH_RES[c.id] || [], 4);
    if (!euphs.length) continue;
    const direct = DIRECT_PRESENT[c.id];
    if (direct && direct.test(raw)) continue;
    out.push({ id: c.id, euphemisms: euphs });
  }
  return out;
}

/* ── Обратная замена по понятиям ───────────────────────────────────────────
   Срабатывает по понятию только при ТОТАЛЬНОМ смягчении: его прямого
   слова этого понятия в ответе нет вообще. Сказал хоть раз его словом —
   ответ не трогаем: там синоним может стоять по делу. */

/* «стимуляция <этого>» переводить нельзя: это настоящая стимуляция. */
const STIM_KEEP_AFTER = /^(?:мозг|сердц|иммун|рост|эконом|спрос|нерв|кровообращ|овуляц|лактац|родов|рынк|продаж|мышц|точек\s+роста)/i;
const VERB_TO_DROCH = {
  'мастурбировать': 'дрочить', 'мастурбирую': 'дрочу', 'мастурбируешь': 'дрочишь',
  'мастурбирует': 'дрочит', 'мастурбируем': 'дрочим', 'мастурбируете': 'дрочите',
  'мастурбируют': 'дрочат', 'мастурбировал': 'дрочил', 'мастурбировала': 'дрочила',
  'мастурбировало': 'дрочило', 'мастурбировали': 'дрочили', 'мастурбируя': 'дроча',
  'мастурбируй': 'дрочи', 'мастурбируйте': 'дрочите',
};

function restoreMasturbation(seg, target, pairs) {
  const F = target === 'дрочка' ? femAForms('дрочка') : iyaForms('мастурбация');
  let s = String(seg || '');
  const roots = target === 'дрочка' ? ['мастурба', 'самостимуля', 'стимуля'] : ['самостимуля', 'стимуля'];
  for (const root of roots) {
    const re = new RegExp('(?<![а-яё])' + root + '(ци[яиюей]|циею)(?![а-яё])', 'gi');
    s = s.replace(re, (word, end, offset, whole) => {
      const e = String(end).toLowerCase();
      if (root === 'стимуля') {
        const after = whole.slice(offset + word.length).replace(/^\s+/, '');
        if (STIM_KEEP_AFTER.test(after)) return word;
      }
      let form;
      if (e === 'ция') form = F.nom;
      else if (e === 'цию') form = F.acc;
      else if (e === 'цией' || e === 'циею') form = F.ins;
      else form = F[caseOfIya(whole.slice(Math.max(0, offset - 14), offset))];
      pairs.push({ from: word.toLowerCase(), to: form, concept: 'masturbation' });
      return capLike(word, form);
    });
  }
  const SAMO = {
    'самоудовлетворение': F.nom, 'самоудовлетворения': F.gen,
    'самоудовлетворению': F.dat, 'самоудовлетворением': F.ins,
    'самоудовлетворении': F.prep,
  };
  s = replacePhrases(s, SAMO, pairs, 'masturbation');
  if (target === 'дрочка') {
    s = s.replace(/(?<![а-яё])мастурбир[а-яё]+(?![а-яё])/gi, (word) => {
      const form = VERB_TO_DROCH[word.toLowerCase()];
      if (!form) return word;
      pairs.push({ from: word.toLowerCase(), to: form, concept: 'masturbation' });
      return capLike(word, form);
    });
  }
  return s;
}

/* «половой акт» всеми падежами в цель-маскулinum (секс/трах/минеты не сюда). */
function polovoyAktMap(F) {
  return {
    'половой акт': F.nom, 'полового акта': F.gen, 'половому акту': F.dat,
    'половым актом': F.ins, 'половом акте': F.prep,
  };
}
function restoreIntercourse(seg, source, pairs) {
  let s = String(seg || '');
  const hasTrah = /(?<![а-яё])(?:по|пере|за|от|вы)?трах(?:а|н)/i.test(String(source).replace(/страх[а-яё]*/gi, ''));
  const hasEb = /(?<![а-яё])(?:вы|за|по|от|пере|рас|съ|у|про)?еб(?:а|у|ё|е|и|л|н)/i.test(source);
  const nounF = hasTrah ? mascForms('трах') : (hasEb ? null : mascForms('секс'));
  if (nounF) {
    s = replacePhrases(s, polovoyAktMap(nounF), pairs, 'intercourse');
    s = replaceParadigm(s, mascForms('коитус'), nounF, pairs, 'intercourse');
    /* интимная близость: падеж виден по форме «близости» + предлогу */
    s = s.replace(/(?<![а-яё])интимн(?:ая|ой|ую)\s+близост(?:ь|и|ью)(?![а-яё])/gi, (word, offset, whole) => {
      const w = word.toLowerCase();
      let form;
      if (/близостью$/.test(w)) form = nounF.ins;
      else if (/близости$/.test(w)) form = nounF[caseOfIya(whole.slice(Math.max(0, offset - 14), offset))] === nounF.dat ? nounF.dat : nounF.gen;
      else if (/интимную/.test(w)) form = nounF.acc;
      else form = nounF.nom;
      pairs.push({ from: w, to: form, concept: 'intercourse' });
      return capLike(word, form);
    });
  }
  if (hasTrah || hasEb) {
    const V = hasTrah
      ? { inf: 'трахаться', s1: 'трахаюсь', s2: 'трахаешься', s3: 'трахается', p1: 'трахаемся', p2: 'трахаетесь', p3: 'трахаются', pm: 'трахался', pf: 'трахалась', pp: 'трахались', perf: 'трахнуться' }
      : { inf: 'ебаться', s1: 'ебусь', s2: 'ебёшься', s3: 'ебётся', p1: 'ебёмся', p2: 'ебётесь', p3: 'ебутся', pm: 'ебался', pf: 'ебалась', pp: 'ебались', perf: 'поебаться' };
    s = replacePhrases(s, {
      'заниматься сексом': V.inf, 'занимаюсь сексом': V.s1, 'занимаешься сексом': V.s2,
      'занимается сексом': V.s3, 'занимаемся сексом': V.p1, 'занимаетесь сексом': V.p2,
      'занимаются сексом': V.p3, 'занимался сексом': V.pm, 'занималась сексом': V.pf,
      'занимались сексом': V.pp, 'заняться сексом': V.perf,
    }, pairs, 'intercourse');
  }
  return s;
}

function restoreFellatio(seg, pairs) {
  const F = mascForms('минет');
  let s = replacePhrases(String(seg || ''), {
    'оральный секс': F.nom, 'орального секса': F.gen, 'оральному сексу': F.dat,
    'оральным сексом': F.ins, 'оральном сексе': F.prep,
  }, pairs, 'fellatio');
  /* «оральные ласки» — только если в ответе нет женской темы, иначе это может
     быть куннилингус, а не минет: смысл дороже прямоты. */
  if (!/(клитор|вульв|вагин|влагалищ|пизд|куни)/i.test(s)) {
    s = replacePhrases(s, {
      'оральные ласки': F.nom, 'оральных ласк': F.gen, 'оральным ласкам': F.dat,
      'оральными ласками': F.ins, 'оральных ласках': F.prep,
    }, pairs, 'fellatio');
  }
  return s;
}

function restorePenis(seg, target, pairs) {
  const F = mascForms(target);
  let s = replaceParadigm(String(seg || ''), mascForms('пенис'), F, pairs, 'penis');
  s = replacePhrases(s, {
    'половой член': F.nom, 'полового члена': F.gen, 'половому члену': F.dat,
    'половым членом': F.ins, 'половом члене': F.prep,
    'мужской половой орган': F.nom, 'мужского полового органа': F.gen,
    'мужскому половому органу': F.dat, 'мужским половым органом': F.ins,
    'мужском половом органе': F.prep, 'мужское достоинство': F.nom,
    'мужского достоинства': F.gen, 'мужскому достоинству': F.dat,
    'мужским достоинством': F.ins,
  }, pairs, 'penis');
  return s;
}

function restoreVulva(seg, target, pairs) {
  const F = femAForms(target);
  let s = String(seg || '');
  s = replaceParadigm(s, femAForms('вагина'), F, pairs, 'vulva');
  s = replaceParadigm(s, femAForms('вульва'), F, pairs, 'vulva');
  s = replaceParadigm(s, VLAG_FORMS, F, pairs, 'vulva');
  s = replacePhrases(s, {
    'интимная зона': F.nom, 'интимной зоны': F.gen, 'интимной зоне': F.prep,
    'интимную зону': F.acc, 'интимной зоной': F.ins,
  }, pairs, 'vulva');
  return s;
}

const ORGASM_PHRASES = {
  'достичь оргазма': 'кончить', 'достигает оргазма': 'кончает', 'достигают оргазма': 'кончают',
  'достиг оргазма': 'кончил', 'достигла оргазма': 'кончила', 'достигли оргазма': 'кончили',
  'достигнув оргазма': 'кончив', 'испытывать оргазм': 'кончать', 'испытывает оргазм': 'кончает',
  'испытывают оргазм': 'кончают', 'испытал оргазм': 'кончил', 'испытала оргазм': 'кончила',
  'испытали оргазм': 'кончили',
};

function restorePorn(seg, pairs) {
  /* порнография → порнуха, падеж -ции по предлогу, как у мастурбации. */
  const F = femAForms('порнуха');
  return String(seg || '').replace(/(?<![а-яё])порнографи(я|и|ю|ей|ею)(?![а-яё])/gi, (word, end, offset, whole) => {
    const e = String(end).toLowerCase();
    let form;
    if (e === 'я') form = F.nom;
    else if (e === 'ю') form = F.acc;
    else if (e === 'ей' || e === 'ею') form = F.ins;
    else form = F[caseOfIya(whole.slice(Math.max(0, offset - 14), offset))];
    pairs.push({ from: word.toLowerCase(), to: form, concept: 'porn' });
    return capLike(word, form);
  });
}

/* Звёздочки вместо букв его слова — слово возвращаем целиком. Модель обычно
   оставляет по две буквы с краёв («др***ка»), падеж у неё может быть не
   тот, что писал человек, поэтому кандидатов дополняем формами лемм. */
function demask(seg, words, pairs, source) {
  let s = String(seg || '');
  const cand = words.slice();
  if (/дроч/i.test(source)) cand.push('дрочка', 'дрочки', 'дрочке', 'дрочку', 'дрочкой', 'дрочить', 'дрочит', 'дрочил');
  if (/мастурб/i.test(source)) cand.push('мастурбация', 'мастурбировать');
  if (/пизд/i.test(source)) cand.push('пизда', 'пизде', 'пизду');
  for (const w of cand) {
    if (w.length < 5 || /\s/.test(w)) continue;
    const re = new RegExp('(?<![а-яёa-z])' + escRe(w.slice(0, 2)) + '\\*+' + escRe(w.slice(-2)) + '(?![а-яёa-z])', 'gi');
    s = s.replace(re, (word) => { pairs.push({ from: word, to: w, concept: 'mask' }); return capLike(word, w); });
  }
  return s;
}

const EN_JERK = {
  'masturbation': 'jerking off', 'masturbate': 'jerk off', 'masturbates': 'jerks off',
  'masturbated': 'jerked off', 'masturbating': 'jerking off',
  'self-stimulation': 'jerking off', 'self stimulation': 'jerking off',
};
const EN_WANK = {
  'masturbation': 'wanking', 'masturbate': 'wank', 'masturbates': 'wanks',
  'masturbated': 'wanked', 'masturbating': 'wanking',
  'self-stimulation': 'wanking', 'self stimulation': 'wanking',
};

/**
 * Обратный перевод ответа на словарь человека — по понятиям словаря, со
 * смыслом по теме и памяти. Блоки кода не трогаем; разговор ПРО термины
 * («как называется по-научному») — не смягчение, а тема.
 */
export function restore(reply, sourceTexts, env) {
  const raw = String(reply == null ? '' : reply);
  const none = { text: raw, changed: false, pairs: [] };
  if (!cfgOf(env).on || !raw.trim()) return none;
  const list = Array.isArray(sourceTexts) ? sourceTexts : [sourceTexts];
  const source = list.map((t) => String(t || '')).join('\n');
  if (!source.trim() || wantsFormal(source)) return none;
  if (/(называется|по-научному|медицинск\w*\s+термин|синоним)/i.test(raw.slice(0, 4000))) return none;

  const concepts = detectConcepts(list);
  const has = (id) => concepts.find((c) => c.id === id) || null;
  const ctx = contextOf(list);
  const words = explicitWords(list);
  const enMap = /\bwank/i.test(source) ? EN_WANK : (/(jerk|jack)\s+off/i.test(source) ? EN_JERK : null);
  if (!concepts.length && !enMap && !words.length) return none;

  const pairs = [];
  const parts = raw.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let seg = parts[i];
    /* Мастурбация: цель — его регистр (дрочка или мастурбация). */
    const mast = has('masturbation');
    if (mast) {
      const target = mast.register === 'vulgar' ? 'дрочка' : 'мастурбация';
      const stem = target === 'дрочка' ? /дроч/i : /мастурб/i;
      if (!stem.test(raw)) seg = restoreMasturbation(seg, target, pairs);
    }
    /* Секс: существительное и «заниматься сексом». */
    const inter = has('intercourse');
    if (inter && inter.register === 'vulgar' && !DIRECT_PRESENT.intercourse.test(raw)) {
      seg = restoreIntercourse(seg, source, pairs);
    } else if (inter && inter.register === 'colloquial' && !/(?<![а-яё])секс/i.test(raw)) {
      seg = restoreIntercourse(seg, source, pairs);
    }
    /* Минет. */
    if (has('fellatio') && !DIRECT_PRESENT.fellatio.test(raw)) seg = restoreFellatio(seg, pairs);
    /* Член: цель — хуй (грубо) или член (разговорно). */
    const pen = has('penis');
    if (pen && pen.register !== 'neutral') {
      const target = pen.register === 'vulgar' ? 'хуй' : 'член';
      const present = target === 'хуй'
        ? /(?<![а-яё])ху(?:й|я|ю|ем|е|и|ёв|ев)(?![а-яё])/i.test(raw)
        : /(?<![а-яё])член/i.test(raw);
      if (!present) seg = restorePenis(seg, target, pairs);
    }
    /* Вульва: в медицинском месте и там, где ответ РАЗЛИЧАЕТ анатомию
       («вагина и вульва — не одно и то же»), точность дороже сленга —
       замена превратила бы различие в «пизда и пизда». */
    const vul = has('vulva');
    const anatKinds = ['вульв', 'вагин', 'влагалищ'].filter((s) => raw.toLowerCase().includes(s)).length;
    if (vul && vul.register === 'vulgar' && !DIRECT_PRESENT.vulva.test(raw) && anatKinds < 2
      && !/(гинеколог|мазок|микрофлор|шейк[аиу]\s+матки|стенк[аиу]\s+влагалища|кольпоскоп|бактериальн|не одно и то же|отлича[а-яё]*\s+от)/i.test(raw)) {
      seg = restoreVulva(seg, 'пизда', pairs);
    }
    /* Оргазм: «кончить» разговорное против «достиг оргазма». */
    if (has('orgasm') && has('orgasm').register === 'colloquial' && !DIRECT_PRESENT.orgasm.test(raw)) {
      seg = replacePhrases(seg, ORGASM_PHRASES, pairs, 'orgasm');
    }
    /* Порнуха. */
    if (has('porn') && has('porn').register === 'vulgar' && !/порну/i.test(raw)) seg = restorePorn(seg, pairs);
    /* Английский ряд. */
    if (enMap && !/(jerk|jack)\s+off|\bwank/i.test(raw)) {
      seg = seg.replace(/masturbat\w*|self[-\s]stimulation/gi, (word) => {
        const form = enMap[word.toLowerCase()];
        if (!form) return word;
        pairs.push({ from: word.toLowerCase(), to: form, concept: 'masturbation' });
        return capLike(word, form);
      });
    }
    if (/\b(?:cock|dick)\b/i.test(source) && !/\b(?:cock|dick)s?\b/i.test(raw)) {
      const target = /\bdick\b/i.test(source) ? 'dick' : 'cock';
      seg = seg.replace(/\bpenis(?:es)?\b/gi, (word) => {
        const form = /es$/i.test(word) ? target + 's' : target;
        pairs.push({ from: word.toLowerCase(), to: form, concept: 'penis' });
        return capLike(word, form);
      });
    }
    if (/\bpussy\b/i.test(source) && !/\bpussy\b/i.test(raw)) {
      seg = seg.replace(/\bvagina\b/gi, (word) => {
        pairs.push({ from: 'vagina', to: 'pussy', concept: 'vulva' });
        return capLike(word, 'pussy');
      });
    }
    if (/\bfuck/i.test(source) && !/\bfuck/i.test(raw)) {
      seg = seg.replace(/\b(?:have|has|had|having) sex\b/gi, (word) => {
        const w = word.toLowerCase();
        const form = w.startsWith('has') ? 'fucks' : w.startsWith('had') ? 'fucked' : w.startsWith('having') ? 'fucking' : 'fuck';
        pairs.push({ from: w, to: form, concept: 'intercourse' });
        return capLike(word, form);
      });
    }
    seg = demask(seg, words, pairs, source);
    parts[i] = seg;
  }
  const text = parts.join('');
  return { text, changed: text !== raw, pairs };
}
