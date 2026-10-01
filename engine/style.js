/**
 * Слой манеры и чистоты текста — порт style.js из Yama AI (Этап 3).
 *
 * Бесплатные модели любят начинать с поклонов («Конечно! Отличный вопрос!
 * С удовольствием помогу вам разобраться:»), вставлять канцелярит («Подводя итог
 * всему вышесказанному, хочется отметить, что…») и заканчивать «Надеюсь, это
 * помогло! Обращайтесь, если будут вопросы!».
 *
 * Что делает слой:
 *   • срезает пустые вступления в начале ответа и пустые прощания в конце;
 *   • вычищает тяжёлый канцелярит в начале абзацев;
 *   • чинит незакрытые блоки кода ``` (чтобы оборванный fence не ломал вёрстку);
 *   • никогда не трогает содержимое внутри ```...```.
 *
 * Runtime-независимость: без process.env и fs. Управление — через env (STYLE=0).
 */

export function cfgOf(env) {
  const e = env || {};
  return {
    on: String(e.STYLE == null ? '1' : e.STYLE) !== '0',
  };
}

const INTENT_HINTS = {
  code: 'Пиши сразу рабочий код и только необходимые пояснения по делу, без общих введений.',
  math: 'Записывай расчёт прямо и явно указывай итоговый ответ.',
  fast: 'Отвечай коротко, живо и сразу по сути.',
  reasoning: 'Разбирай задачу структурно и по делу, без общих рассуждений и воды.',
};

/** Короткая добавка к системному промпту по типу задачи. */
export function hintFor(intent, env) {
  if (!cfgOf(env).on) return '';
  const h = INTENT_HINTS[String(intent || '')];
  return h ? '\n' + h : '';
}

function capFirst(s) {
  const t = String(s || '').trimStart();
  if (!t) return '';
  const ch = t[0];
  if (/[а-яёa-z]/.test(ch)) return ch.toUpperCase() + t.slice(1);
  return t;
}

/* Шаблонные поклоны в самом начале ответа. Могут идти цепочкой:
   «Отличный вопрос! Конечно, с удовольствием помогу вам разобраться: …» */
const INTRO_PATTERNS = [
  /^\s*(?:отличный|хороший|прекрасный|интересный|замечательный)\s+вопрос\s*[!.]+\s*/i,
  /^\s*(?:конечно|безусловно|разумеется)\s*[!.]+\s*/i,
  /^\s*(?:конечно|безусловно|разумеется),\s+(?:я\s+)?(?:с\s+(?:удовольствием|радостью)\s+)?(?:помогу|расскажу|объясню|отвечу|подскажу)[^\n.!?:]{0,60}[!.:]+\s*/i,
  /^\s*(?:я\s+)?с\s+(?:большим\s+)?(?:удовольствием|радостью)\s+(?:помогу|расскажу|объясню|отвечу|подскажу)[^\n.!?:]{0,60}[!.:]+\s*/i,
  /^\s*давайте\s+(?:вместе\s+)?(?:разберёмся|разберемся|посмотрим|рассмотрим)(?:\s+(?:с\s+этим(?:\s+вопросом)?|по\s+порядку|подробнее))?\s*[!.:]+\s*/i,
  /^\s*(?:вот|ниже\s+(?:приведён|приведен|представлен))\s+(?:подробный\s+|краткий\s+)?(?:ответ|разбор)(?:\s+на\s+ваш\s+вопрос)?\s*[:.]\s*/i,
  /^\s*(?:sure|certainly|of\s+course|absolutely|great\s+question|good\s+question)\s*[!.]+\s*/i,
  /* Одиночное извинение отдельной фразой перед сутью («Извини.

3 × 17 = 51»). С запятой
     НЕ трогаем: «Извини, что не ответил сразу — был монтаж» это смысл, а не рефлекс. */
  /^\s*(?:извини(?:те)?|прости(?:те)?|прошу прощения|приношу извинения)\s*[!.]+\s+/i,
  /^\s*(?:i'?d\s+be\s+)?happy\s+to\s+help(?:\s+you\s+with\s+that)?\s*[!.:]+\s*/i,
  /^\s*here(?:'s|\s+is)\s+(?:the\s+|a\s+brief\s+)?(?:answer|explanation)(?:\s+to\s+your\s+question)?\s*[:.]\s*/i,
];

export function stripIntro(text) {
  const raw = String(text || '');
  let cur = raw;
  let changed = false;
  for (let pass = 0; pass < 4; pass++) {
    let hit = false;
    for (const re of INTRO_PATTERNS) {
      const next = cur.replace(re, '');
      if (next !== cur && next.trim().length >= 6) {
        cur = next;
        changed = true;
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  return changed ? capFirst(cur) : raw;
}

/* Шаблонные прощания в самом конце ответа:
   «Надеюсь, это помогло! Если остались вопросы — обращайтесь.» */
const OUTRO_PATTERNS = [
  /(?:\n\s*\n|\s+)(?:надеюсь,?\s+(?:это\s+помогло|эта\s+информация\s+(?:была\s+|окажется\s+)?полезн(?:ой|а)|мой\s+ответ\s+(?:был\s+)?полезен|я\s+смог\s+помочь))[^\n`]*\s*$/i,
  /(?:\n\s*\n|\s+)(?:если\s+(?:у\s+вас\s+)?(?:остались|будут|возникнут|есть|появятся)\s+(?:какие-либо\s+|ещё\s+|еще\s+|дополнительные\s+)?вопросы[,—–\-\s]+(?:обращайтесь|спрашивайте|пишите|дайте\s+знать|не\s+стесняйтесь[^\n`]*))[^\n`]*\s*$/i,
  /(?:\n\s*\n|\s+)(?:(?:дайте\s+знать|обращайтесь|пишите|не\s+стесняйтесь\s+спрашивать),?\s+если\s+(?:вам\s+)?(?:нужно|потребуется|понадобится)\s+(?:что-то\s+(?:ещё|еще|уточнить|дополнить)|дополнительная\s+помощь))[^\n`]*\s*$/i,
  /(?:\n\s*\n|\s+)(?:i\s+hope\s+this\s+helps|hope\s+that\s+helps|feel\s+free\s+to\s+ask\s+if\s+you\s+have\s+any|let\s+me\s+know\s+if\s+you\s+need\s+anything\s+else)[^\n`]*\s*$/i,
];

export function stripOutro(text) {
  const raw = String(text || '');
  let cur = raw;
  for (let pass = 0; pass < 3; pass++) {
    let hit = false;
    for (const re of OUTRO_PATTERNS) {
      const m = re.exec(cur);
      if (m && m.index >= 12) {
        cur = cur.slice(0, m.index).trimEnd();
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  return cur;
}

/* Канцелярит в начале абзацев:
   «В заключение хочется отметить, что кэширование снижает нагрузку.» → «Кэширование снижает нагрузку.» */
const CLICHE_HEADS = [
  /(^|\n\n)[ \t]*(?:в\s+заключение|подводя\s+итог(?:и)?(?:\s+(?:всему\s+)?вышесказанному)?|резюмируя\s+(?:всё\s+|все\s+)?вышесказанное),?\s+(?:хочется|стоит|можно|следует|необходимо)\s+(?:отметить|сказать|подчеркнуть),?\s+что\s+([а-яёa-z])/gi,
  /(^|\n\n)[ \t]*(?:таким\s+образом,\s+)?подводя\s+итог(?:и)?,\s+можно\s+с\s+уверенностью\s+сказать,\s+что\s+([а-яёa-z])/gi,
];

export function stripCliches(text) {
  let s = String(text || '');
  for (const re of CLICHE_HEADS) {
    s = s.replace(re, (_, prefix, firstLetter) => prefix + firstLetter.toUpperCase());
  }
  return s;
}

/**
 * Если модель открыла ``` и оборвалась до закрытия — закрываем fence в конце,
 * чтобы в чате не разваливалось форматирование сообщения.
 */
export function fixFences(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const fences = s.match(/```/g);
  if (fences && fences.length % 2 === 1) {
    return s.trimEnd() + '\n```';
  }
  return s;
}

/**
 * Полная полировка ответа: чистит прозу вокруг блоков кода, не меняя сам код.
 */
export function polish(text, opts) {
  const o = opts || {};
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return '';

  const fixed = fixFences(raw);
  if (!cfgOf(o.env).on) {
    return fixed.trim();
  }

  /* Делим по блокам ```...```: чётные индексы — проза, нечётные — код. */
  const parts = fixed.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let seg = parts[i];
    if (i === 0) seg = stripIntro(seg);
    seg = stripCliches(seg);
    if (i === parts.length - 1) seg = stripOutro(seg);
    seg = seg
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    parts[i] = seg;
  }

  const out = parts.join('').trim();
  return out.length >= 2 ? out : fixed.trim();
}
