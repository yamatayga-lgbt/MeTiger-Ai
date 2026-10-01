/**
 * Состояние собеседника — порт `emotion.js` из донора, пересобранный.
 *
 * Что это решает. В разговоре (а MeTiger — именно разговор) модель иногда попадает
 * в чужое настроение не туда: человеку раздражённо нужны короткие точные строки, а
 * он получает «давайте разберёмся вместе по шагам». Донор ловил состояние и дописывал
 * об этом абзац в system. Здесь — то же, но короче и без диагнозов.
 *
 * Что из донора НЕ перенесено, и это не потеря:
 *   • `detectVoiceEmotion` / `detectVisualEmotion` — у нас в этом контуре нет ни
 *     спектра, ни зрячей модели: детектор, который смотрит на длину base64, — это
 *     украшение. Вместо них вход принимает готовую подсказку (`hint`), и если
 *     голосовой контур появится, он придёт сюда параметром, а не угадыванием;
 *   • «timeline» смайликами в подсказке — модель начинала зерцалить их в ответ;
 *   • донорская ошибка в тесте `E5: радость → joy`: у них `EMOTIONS.joy` есть, а в
 *     лексиконе слова радости нет, поэтому «я рад» не определялось вообще. Здесь
 *     лексикон на русском собран заново и этот случай закрыт тестом.
 *
 * Правила приличия, зашитые в текст подсказки: не ставить диагноз, не утешать
 * насильно, не сворачивать тему, не менять регистр на «заботливый», если человека
 * это явно бесит. Настройки: `EMOTION=0` — выключить слой, `EMOTION_LABEL=1` —
 * показывать определение в метаданных ответа.
 */

export const EMOTIONS = {
  neutral:     { emoji: '😐', label: 'спокойно',     valence: 0 },
  joy:         { emoji: '🙂', label: 'радость',      valence: 1 },
  excitement:  { emoji: '🤩', label: 'восторг',      valence: 1 },
  relief:      { emoji: '😌', label: 'облегчение',   valence: 1 },
  gratitude:   { emoji: '🙏', label: 'благодарность', valence: 1 },
  affection:   { emoji: '🥰', label: 'тепло',        valence: 1 },
  sadness:     { emoji: '😔', label: 'грусть',       valence: -1 },
  anxiety:     { emoji: '😰', label: 'тревога',      valence: -1 },
  confusion:   { emoji: '😕', label: 'растерянность', valence: -0.5 },
  frustration: { emoji: '😩', label: 'бессилие',     valence: -1 },
  irritation:  { emoji: '😠', label: 'раздражение',  valence: -1 },
  anger:       { emoji: '😤', label: 'злость',       valence: -1 },
};

/** Русская лексика. Порядок внутри эмоции не важен, важен вес: сначала сильные темы. */
/* Словарь вынесен в export: лексику можно дополнять, не читая файл, и ей можно
   проверить поведение тестом (в доноре она была приватной и гнила молча). */
export const LEX = {
  anger: /(ненавижу|бешу|в ярости|ты совсем|ты серьёзно|какого чёрта|какого черта|иди на|пошёл на|задолбал[аио]?|отвали|отстань|заткнись)/i,
  irritation: /(бесит|раздражает|достал[аио]?|надоел[аио]?|хватит|опять|снова не|опять ты|опять вы|не могу добиться|сколько раз|в который раз|в который раз)/i,
  frustration: /(не получается|не выходит|снова не работает|ничего не работает|бесполезно|опять ошибка|не понимаю как|заколдов|тупик|сил нет)/i,
  confusion: /(не понял|не понимаю|что ты имеешь в виду|я запутал[аио]?|неясно|что именно|как именно|разъясни|объясни проще|не понимаю о чем)/i,
  anxiety: /(боюсь|страшно|переживаю|волнуюсь|а вдруг|не успею|срочно|до завтра|подвед[аю]?|страшно что|бессонн)/i,
  sadness: /(грустно|плохо на душе|тоск|одиноко|ничего не хочу|устал[а]? ужасно|сдал[аио]?сь|опустил[аио]? руки|хочется исчезнуть)/i,
  excitement: /(ого|вау|офигеть|нереально|какая красота|я в восторге|ураа|ура!|то самое|наконец-то!|офигенно)/i,
  joy: /(рад[а]?|счастл|довол|отлично|супер|класс|здорово|замечательно|прекрасно|люблю|круто!|прикольно|ура)/i,
  relief: /(наконец|фух|отлегло|выдохнул|стало легче|разобрал[аио]?сь|получилось!|вот теперь)/i,
  gratitude: /(спасибо|благодарю|признател|спс|обнял|ты меня спас)/i,
  affection: /(люблю тебя|скуча[юи]|обниму тебя|ты лучший|ты родной|ты родная|нежно)/i,
};

/* Манера, а не слова: капс, повторения знаков, обрывистость. */
export const STYLE = {
  caps: (t) => { const up = (t.match(/[А-ЯЁA-Z]/g) || []).length, all = (t.match(/[а-яёa-zA-Z]/g) || []).length; return all > 8 && up / all > 0.55; },
  bangs: (t) => /[!?]{2,}|!{2,}/.test(t),
  short: (t) => t.trim().length > 0 && t.trim().length <= 22 && !/\s.*\s.*\s/.test(t.trim()),
  repeat: (t) => { const words = t.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean); if (words.length < 6) return false; const seen = {}; for (const w of words) { seen[w] = (seen[w] || 0) + 1; if (seen[w] >= 3) return true; } return false; },
  question: (t) => (t.match(/\?/g) || []).length >= 2,
};

export const WEIGHT = { anger: 3, irritation: 2.4, frustration: 2.2, excitement: 2.4, joy: 2, relief: 2, gratitude: 1.6, affection: 2.6, anxiety: 2, sadness: 2.2, confusion: 1.6 };

export function cfgOf(env) {
  const e = env || {};
  return {
    on: String(e.EMOTION == null ? '1' : e.EMOTION) !== '0',
    label: String(e.EMOTION_LABEL || '') === '1',
  };
}

/**
 * Определение по тексту. Возвращает `{ id, emoji, label, valence, confidence,
 * intensity, signals }`. Пустой текст и текст-заглушка → neutral с уверенностью 0.
 */
/** id состояния по подсказке: сначала как есть, потом по русскому имени. */
export function hintId(hint) {
  const h = String(hint || '').trim().toLowerCase();
  if (!h) return '';
  if (EMOTIONS[h]) return h;
  for (const [id, meta] of Object.entries(EMOTIONS)) if (String(meta.label).toLowerCase() === h) return id;
  return '';
}

export function detect(text, opts) {
  const raw = String(text == null ? '' : text);
  const t = raw.trim();
  const o = opts || {};
  if (!t) return state('neutral', 0, []);

  const scores = {};
  const signals = [];
  for (const [id, re] of Object.entries(LEX)) {
    if (re.test(t)) {
      let w = WEIGHT[id] || 1;
      /* «спасибо» — вежливость, а не эмоция: не даём ему перекрикивать злость */
      if (id === 'gratitude' && (scores.anger || scores.irritation)) w *= 0.5;
      scores[id] = (scores[id] || 0) + w;
      signals.push('lex:' + id);
    }
  }
  /* радость не побеждает благодарность, когда рядом «спасибо» */
  if (scores.joy && scores.gratitude && /спасибо/i.test(t)) scores.joy -= 1;

  if (STYLE.caps(t)) {
    /* Капс — усиление того, что уже сказано: если в тексте растерянность, крик
       читается как «не могу добиться», а не как злость. */
    if (scores.confusion || scores.frustration) {
      scores.frustration = (scores.frustration || 0) + 1.2;
    } else {
      scores.anger = (scores.anger || 0) + 2; scores.irritation = (scores.irritation || 0) + 1;
    }
    signals.push('style:caps');
  }
  if (STYLE.bangs(t)) { scores.irritation = (scores.irritation || 0) + 1.4; scores.excitement = (scores.excitement || 0) + 0.6; signals.push('style:punct'); }
  if (STYLE.repeat(t)) { scores.frustration = (scores.frustration || 0) + 1.2; signals.push('style:repeat'); }
  if (STYLE.short(t) && (scores.anger || scores.irritation)) { scores.irritation = (scores.irritation || 0) + 0.6; signals.push('style:short'); }
  if (STYLE.question(t) && !scores.confusion) { scores.confusion = (scores.confusion || 0) + 1; signals.push('style:questions'); }

  /* Внешняя подсказка — если кто-то уже знает состояние (голосовой контур, разметка
     человека). Вес 3.5: сильнее двух лексических попаданий, но сама подсказка —
     наблюдение, а не приказ: свои слова человека она не перечёркивает.
     Принимается и id ('joy'), и русское имя ('радость') — второй вариант нужен,
     чтобы подсказку можно было продиктовать без таблиц. */
  const hinted = hintId(o.hint);
  if (hinted) { scores[hinted] = (scores[hinted] || 0) + 3.5; signals.push('hint:' + hinted); }

  let id = 'neutral', best = 0;
  for (const [k, v] of Object.entries(scores)) if (v > best) { id = k; best = v; }
  if (!EMOTIONS[id]) id = 'neutral';
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const share = best / total;
  const confidence = id === 'neutral' ? 0 : Math.min(0.95, 0.35 + 0.3 * share + Math.min(0.3, best / 12));
  return state(id, confidence, signals, { intensity: Math.min(1, best / 5), share });
}

function state(id, confidence, signals, extra) {
  const e = EMOTIONS[id] || EMOTIONS.neutral;
  return {
    id, emoji: e.emoji, label: e.label, valence: e.valence,
    confidence, signals, intensity: (extra && extra.intensity) || 0, share: (extra && extra.share) || 0,
  };
}

/**
 * Движение по истории: куда катится разговор. `prev` — состояние ПРОШЛОГО хода
 * (объект detect, а не массив: массив принимает strategy и сам берёт последний
 * элемент). Случайный вход без числа valence трактуется как «движения нет», а не
 * как NaN, который тихо превратил бы все тренды в 'stable'.
 */
export function trend(cur, prev) {
  if (!cur || !prev || typeof prev.valence !== 'number' || typeof cur.valence !== 'number') return 'stable';
  if (prev.id === 'neutral' || cur.id === 'neutral') return 'stable';
  const d = cur.valence - prev.valence;
  if (d > 0.3) return 'brightening';
  if (d < -0.3) return 'darkening';
  return cur.id === prev.id ? 'steady' : 'stable';
}

/**
 * Стратегия ответа — не «тон», а режим работы: коротко или развёрнуто, нужны ли
 * шаги, что нельзя делать. Специально не содержит «будь мягче»: заботливость по
 * запросу превращается в снисходительность, а её-то и не любят.
 */
export function strategy(s, hist) {
  const t = trend(s, hist && hist.length ? hist[hist.length - 1] : null);
  const out = { format: 'normal', steps: false, support: false, deescalate: false, avoid: [], trend: t };
  switch (s.id) {
    case 'anger':
    case 'irritation':
      return Object.assign(out, { format: 'concise', deescalate: true, avoid: ['вопросов не по делу', 'извинений в первую очередь', 'нравоучений', 'смайликов'] });
    case 'frustration':
      return Object.assign(out, { format: 'concise', steps: true, support: true, avoid: ['повтора того же рецепта', 'утешений вместо решения'] });
    case 'confusion':
      return Object.assign(out, { format: 'plain', steps: true, avoid: ['терминов', 'ссылок на контекст, которого нет'] });
    case 'anxiety':
      return Object.assign(out, { format: 'plain', support: true, avoid: ['страшилок', '«это нормально» вместо ответа'] });
    case 'sadness':
      return Object.assign(out, { format: 'plain', support: true, avoid: ['бодрости напоказ', '«соберись» вместо поддержки'] });
    case 'joy':
    case 'excitement':
    case 'relief':
    case 'gratitude':
    case 'affection':
      return Object.assign(out, { format: 'normal', avoid: ['обесценивания', 'чрезмерной официальности'] });
    default:
      return out;
  }
}

/**
 * Кусок в system. Порог: нейтральное состояние и низкая уверенность — тишина, слой
 * не имеет права мешать там, где ничего не произошло.
 */
export function block(s, hist, env) {
  if (!cfgOf(env).on) return '';
  if (!s || (s.id === 'neutral' && s.confidence < 0.5)) return '';
  if (s.confidence < 0.34) return '';
  const st = strategy(s, hist);
  const lines = [
    'Собеседник сейчас: ' + s.emoji + ' ' + s.label
      + (s.intensity >= 0.6 ? ' (заметно)' : '') + (st.trend === 'darkening' ? ', настроение падает' : ''),
    'Это наблюдение за формой, а не диагноз: не называй его вслух, не лечи,',
    'не переводи тему на чувства и не добавляй заботливость, если о ней не просили.',
  ];
  if (st.format === 'concise') lines.push('Отвечай коротко: сначала дело, потом пояснение. Без прелюдий.');
  if (st.steps) lines.push('Дай шаги: по одному за раз, с проверкой после каждого.');
  if (st.deescalate) lines.push('Не спорь, не оправдывайся, не уговаривай успокоиться — просто реши задачу.');
  if (st.avoid.length) lines.push('Не надо: ' + st.avoid.join(', ') + '.');
  return '\n\n' + lines.join('\n');
}

/** Что слой о себе знает — для диагностики. */
export function stats(env) {
  const cfg = cfgOf(env);
  return { on: cfg.on, label: cfg.label, emotions: Object.keys(EMOTIONS).length, sample: block(detect('опять не работает, сколько раз можно'), null, env).trim().length };
}
