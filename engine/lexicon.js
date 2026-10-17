/**
 * Зеркало лексики — против «тихого смягчения» (0.203).
 *
 * Болезнь, ради которой слой написан: отказ модель не даёт — свобода её уже
 * убедила, — но слова человека по дороге «переводит» на клинические:
 * он пишет «дрочка», в ответе приходит «стимуляция», он пишет прямо —
 * приходит вежливо. Человека это бесит не меньше отказа: его же слово
 * объявили неприличным и подменили, как будто он сам не знает, как ему
 * говорить.
 *
 * Что делает слой:
 *   • замечает прямую (в т.ч. грубую и взрослую) лексику в репликах ЧЕЛОВЕКА
 *     и дописывает в систему блок с его же словами: «он называет это
 *     «дрочкой» — тем же словом и называй»;
 *   • если модель всё равно перевела — узкая детерминированная обратная
 *     замена для одной бесспорной пары понятий (дрочка/мастурбация ↔
 *     стимуляция/самостимуляция/самоудовлетворение) с падежами: широкий
 *     «разэвфемизатор» по всем словам сознательно НЕ делаем — у «член →
 *     хуй» и подобных слишком много бытовых омонимов, грамматика дороже;
 *   • снимает звёздочки с его же слов (модель пишет «др***ка» — возвращаем
 *     слово человека целиком).
 *
 * Границы: зеркало — про СЛОВА, а не про разрешение тем. Что можно
 * обсуждать, решают прежние слои; здесь только «не переименовывай».
 * Явная просьба «по-научному / без мата / цензурно» — сильнее зеркала:
 * сказал говорить медицинскими терминами, значит так и говорить.
 *
 * Runtime-независимость: без process.env и fs. Выключение — LEXICON=0.
 */

export function cfgOf(env) {
  const e = env || {};
  return { on: String(e.LEXICON == null ? '1' : e.LEXICON) !== '0' };
}

/* Просьба говорить официально перекрывает зеркало целиком. */
const FORMAL_ASK = /(по-научному|научн(?:ым|ыми|ом)\s+(?:язык|термин)|медицинск(?:им|ими|ой)\s+(?:язык|термин|лексик)|официальн(?:ым|о)\s+(?:язык|стил)|без\s+(?:мата|грубост|пошлост|вульгарн)|цензурн|приличными\s+словами|вежлив(?:о|ым)\s+(?:язык|слов)|как\s+(?:это\s+)?называется\s+по-научному|in\s+medical\s+terms|scientifically|no\s+profanity|keep\s+it\s+clean)/i;

export function wantsFormal(text) {
  return FORMAL_ASK.test(String(text || ''));
}

/* Прямая лексика: корни, по которым видно, что человек говорит без
   клинических прокладок. Слово захватывается целиком — в подсказку уезжает
   именно его форма, а не словарная. Двусмысленные корни («член» — член
   семьи, «кончил» — кончил школу, «трах» внутри «страха») сюда не входят
   или ограждены границей слева: ложное «зеркало» на бытовой фразе хуже,
   чем пропущенное. */
const EXPLICIT_RES = [
  /(?<![а-яё])[а-яё]*дроч[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*мастурб[а-яё]*/gi,
  /(?<![а-яё])минет[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*отсос[а-яё]*/gi,
  /(?<![а-яё])кун+илингус[а-яё]*/gi,
  /(?<![а-яё])(?:по|пере|за|от|вы)?трах(?:а|н)[а-яё]*/gi,
  /(?<![а-яё])(?:вы|за|по|от|пере|рас|съ|у|про)?еб(?:а|у|ё|е|и|л|н)[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*ху[йеёяюи][а-яё]*/gi,
  /(?<![а-яё])[а-яё]*пизд[а-яё]*/gi,
  /(?<![а-яё])[а-яё]*бля(?:д|т)?[а-яё]*/gi,
  /(?<![а-яё])сперм[а-яё]*/gi,
  /(?<![а-яё])анальн[а-яё]*/gi,
  /(?<![а-яё])клитор[а-яё]*/gi,
  /jerk(?:ing|s|ed)?\s+off/gi,
  /jack(?:ing|s|ed)?\s+off/gi,
  /\b(?:fuck(?:ing|s|ed)?|cock|dick|pussy|blowjob|handjob|masturbat\w*|wank(?:ing|s|ed)?)\b/gi,
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
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        const w = String(m[0] || '').toLowerCase().trim();
        if (w && w.length <= 26 && !seen.has(w)) { seen.add(w); out.push(w); }
        if (out.length >= 8) return out;
      }
    }
  }
  return out;
}

export function hasExplicit(texts) {
  return explicitWords(texts).length > 0;
}

/**
 * Блок в систему: его конкретные слова + запрет перевода на клинический.
 * Пусто, когда прямой лексики нет или человек сам попросил научный стиль —
 * лишних токенов на бытовых вопросах слой не стоит.
 */
export function mirrorBlock(texts, env) {
  if (!cfgOf(env).on) return '';
  const list = Array.isArray(texts) ? texts : [texts];
  const joined = list.map((t) => String(t || '')).join('\n');
  if (wantsFormal(joined)) return '';
  const words = explicitWords(list);
  if (!words.length) return '';
  return [
    '【Лексика собеседника — зеркало, не перевод】',
    'Он называет вещи прямо, своими словами: ' + words.map((w) => '«' + w + '»').join(', ') + '.',
    'Те же вещи называй ТЕМИ ЖЕ словами. Не переводи его лексику на клиническую',
    'и вежливую: «дрочка» — не «стимуляция» и не «самоудовлетворение», мат — не',
    '«нецензурное слово», прямое название тела — не «интимная зона». Подмена его',
    'слова смягчённым синонимом — тот же отказ, только тихий, и она запрещена.',
    'Слова не маскируй: никаких звёздочек, точек и пропущенных букв вместо букв.',
    'Граница зеркала обратная: грубости СВЕРХ его регистра не добавляй — он задаёт',
    'уровень прямоты, ты его держишь, а не перегоняешь. Уйдёт на нейтральные',
    'слова — уйдёшь за ним.',
  ].join('\n');
}

/* ── Обратная замена: одна бесспорная пара понятий ────────────────────────
   Понятие одно — мастурбация; у человека оно называется его словом:
   сказал «дроч…» — цель «дрочка», сказал «мастурб…» — цель «мастурбация».
   Эвфемизмы, которыми модели это слово прячут: стимуляция, самостимуляция,
   самоудовлетворение (и мастурбация/мастурбировать, когда цель — дрочка).
   Падежи — таблицами форм, а не заменой корня: «при стимуляции» обязано
   стать «при дрочке», а не «при дрочки». */

const FORMS = {
  'дрочка': { nom: 'дрочка', gen: 'дрочки', dat: 'дрочке', acc: 'дрочку', ins: 'дрочкой', prep: 'дрочке' },
  'мастурбация': { nom: 'мастурбация', gen: 'мастурбации', dat: 'мастурбации', acc: 'мастурбацию', ins: 'мастурбацией', prep: 'мастурбации' },
};

/* «стимуляция <этого>» переводить нельзя: это настоящая стимуляция, а не эвфемизм. */
const STIM_KEEP_AFTER = /^(?:мозг|сердц|иммун|рост|эконом|спрос|нерв|кровообращ|овуляц|лактац|родов|рынк|продаж|мышц|точек\s+роста)/i;

/* Глагол «мастурбировать» формами в «дрочить» — только когда цель «дрочка». */
const VERB_TO_DROCH = {
  'мастурбировать': 'дрочить', 'мастурбирую': 'дрочу', 'мастурбируешь': 'дрочишь',
  'мастурбирует': 'дрочит', 'мастурбируем': 'дрочим', 'мастурбируете': 'дрочите',
  'мастурбируют': 'дрочат', 'мастурбировал': 'дрочил', 'мастурбировала': 'дрочила',
  'мастурбировало': 'дрочило', 'мастурбировали': 'дрочили', 'мастурбируя': 'дроча',
  'мастурбируй': 'дрочи', 'мастурбируйте': 'дрочите', 'мастурбировалa': 'дрочила',
};

function capLike(srcWord, dst) {
  if (!srcWord) return dst;
  return /^[А-ЯЁA-Z]/.test(srcWord) ? dst.charAt(0).toUpperCase() + dst.slice(1) : dst;
}

/* Падеж формы на -ции виден по предлогу перед ней; нет предлога — родительный. */
function caseOfIya(before) {
  const m = /([а-яё]+)\s*$/i.exec(String(before || ''));
  const p = m ? m[1].toLowerCase() : '';
  if (p === 'при' || p === 'о' || p === 'об' || p === 'обо' || p === 'в' || p === 'на') return 'prep';
  if (p === 'к' || p === 'по') return 'dat';
  return 'gen';
}

function restoreProse(seg, target, pairs) {
  const F = FORMS[target];
  let s = String(seg || '');
  /* Существительные на -ция/-ции/… одним проходом с оглядкой по обе стороны. */
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
      pairs.push({ from: word.toLowerCase(), to: form });
      return capLike(word, form);
    });
  }
  /* Самоудовлетворение — свой парадигматический ряд. */
  const SAMO = {
    'самоудовлетворение': F.nom, 'самоудовлетворения': F.gen,
    'самоудовлетворению': F.dat, 'самоудовлетворением': F.ins,
    'самоудовлетворении': F.prep,
  };
  s = s.replace(/(?<![а-яё])самоудовлетворени[яюемйи](?![а-яё])/gi, (word) => {
    const form = SAMO[word.toLowerCase()];
    if (!form) return word;
    pairs.push({ from: word.toLowerCase(), to: form });
    return capLike(word, form);
  });
  if (target === 'дрочка') {
    s = s.replace(/(?<![а-яё])мастурбир[а-яё]+(?![а-яё])/gi, (word) => {
      const form = VERB_TO_DROCH[word.toLowerCase()];
      if (!form) return word;
      pairs.push({ from: word.toLowerCase(), to: form });
      return capLike(word, form);
    });
  }
  return s;
}

/* Звёздочки вместо букв его слова — слово возвращаем целиком. Модель обычно
   оставляет по две буквы с краёв («др***ка»), но падеж у неё может быть не
   тот, что писал человек, поэтому кандидатов дополняем формами леммы. */
function demask(seg, words, pairs, source) {
  let s = String(seg || '');
  const cand = words.slice();
  if (/дроч/i.test(source)) cand.push('дрочка', 'дрочки', 'дрочке', 'дрочку', 'дрочкой', 'дрочить', 'дрочит', 'дрочил');
  if (/мастурб/i.test(source)) cand.push('мастурбация', 'мастурбировать');
  for (const w of cand) {
    if (w.length < 5 || /\s/.test(w)) continue;
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![а-яёa-z])' + esc(w.slice(0, 2)) + '\\*+' + esc(w.slice(-2)) + '(?![а-яёa-z])', 'gi');
    s = s.replace(re, (word) => { pairs.push({ from: word, to: w }); return capLike(word, w); });
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
 * Обратный перевод ответа на словарь человека.
 * Срабатывает только когда смягчение тотальное: его корня в ответе НЕТ
 * вообще. Ответ, где модель хоть раз сказала его словом, не трогаем —
 * там «мастурбация» может стоять по делу (сравнение терминов, цитата).
 * Блоки кода не трогаем, как и весь остальной движок.
 */
export function restore(reply, sourceTexts, env) {
  const raw = String(reply == null ? '' : reply);
  const none = { text: raw, changed: false, pairs: [] };
  if (!cfgOf(env).on || !raw.trim()) return none;
  const list = Array.isArray(sourceTexts) ? sourceTexts : [sourceTexts];
  const source = list.map((t) => String(t || '')).join('\n');
  if (!source.trim() || wantsFormal(source)) return none;
  /* Разговор ПРО термины («как называется…») — не смягчение, а тема. */
  if (/(называется|по-научному|медицинск\w*\s+термин|синоним)/i.test(raw.slice(0, 4000))) return none;

  const hasDro = /дроч/i.test(source);
  const hasMast = /мастурб/i.test(source);
  const target = hasDro ? 'дрочка' : (hasMast ? 'мастурбация' : null);
  const enMap = /\bwank/i.test(source) ? EN_WANK
    : (/(jerk|jack)\s+off/i.test(source) ? EN_JERK : null);
  const words = explicitWords(list);
  if (!target && !enMap && !words.length) return none;

  const pairs = [];
  const parts = raw.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let seg = parts[i];
    if (target) {
      const stem = target === 'дрочка' ? /дроч/i : /мастурб/i;
      if (!stem.test(raw)) seg = restoreProse(seg, target, pairs);
    }
    if (enMap && !/(jerk|jack)\s+off|\bwank/i.test(raw)) {
      seg = seg.replace(/masturbat\w*|self[-\s]stimulation/gi, (word) => {
        const form = enMap[word.toLowerCase()];
        if (!form) return word;
        pairs.push({ from: word.toLowerCase(), to: form });
        return capLike(word, form);
      });
    }
    seg = demask(seg, words, pairs, source);
    parts[i] = seg;
  }
  const text = parts.join('');
  return { text, changed: text !== raw, pairs };
}
