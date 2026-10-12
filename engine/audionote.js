/**
 * Конспект записи с таймкодами (0.180) — «загрузил аудио → расшифровка → конспект
 * с таймкодами», вторая половина версии «Свежесть и звук».
 *
 * Зачем отдельный слой, если расшифровка уже есть. Расшифровка отвечает на вопрос
 * «что сказано», а человек с получасовой записью спрашивает «где это сказано»:
 * ему нужен конспект с метками времени, по которым он вернётся к нужному месту.
 * Whisper отдаёт отрезки речи с началом и концом (`engine/voicein.js`,
 * `readSegments`), и всё, что нужно, — собрать из них читаемую дорожку и попросить
 * модель пересказать по ней. Работает это без единого нового ключа и сервиса.
 *
 * Три правила, из-за которых слой вообще существует:
 *   • короткая голосовая — НЕ запись. Человек надиктовал вопрос на двадцать
 *     секунд, и «конспект» из одного пункта с таймкодом [0:00] был бы издевательством:
 *     такие ходы идут как раньше — обычной расшифровкой в подписи «[Голосом: …]».
 *   • таймкодов нет — конспект без таймкодов. Обещать метки, которых не отдал
 *     источник, значит заставлять модель их выдумывать: в указании прямо сказано
 *     не выдумывать и пересказывать так.
 *   • дорожка — не весь текст подряд. Отрезки склеиваются в реплики по паузам
 *     (пауза ≥ `GAP_SEC` — новая строка) и по общему потолку знаков: в указание
 *     модели нечего везти получасовой текст целиком, у неё есть та же расшифровка
 *     в сообщении.
 */

/** Короче этого запись считается голосовой, а не «аудио на конспект». */
export const NOTE_MIN_SEC = 45;
/** Или столько отрезков: даже короткая запись с репликами — уже разговор. */
export const NOTE_MIN_SEGMENTS = 3;
/** Пауза, которая начинает новую строку дорожки. */
export const GAP_SEC = 2.2;
/** Потолок знаков дорожки: остальное — в самой расшифровке рядом. */
export const TIMELINE_CHARS = 2400;

/** Секунды → «0:07», «12:34», «1:02:03». Часы — только когда они есть. */
export function fmtStamp(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(ss) : m + ':' + two(ss);
}

/** «3 мин 20 с» — длительность словами, для строки о записи. */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? m + ' мин ' + rest + ' с' : m + ' мин';
  const h = Math.floor(m / 60);
  return h + ' ч ' + (m % 60) + ' мин';
}

/**
 * Отрезки → дорожка «[0:12] текст». Реплики склеиваются по паузам; длинная
 * реплика режется на строки по 300 знаков (читать простыню на телефоне нельзя).
 * Возвращает { lines, chars, full } — full значит «всё уместилось».
 */
export function timeline(segments, opts) {
  const o = opts || {};
  const maxChars = Math.max(200, Number(o.chars) || TIMELINE_CHARS);
  const gap = Number(o.gap) || GAP_SEC;
  const segs = (Array.isArray(segments) ? segments : []).filter((s) => s && s.text);
  if (!segs.length) return { lines: [], chars: 0, full: true };

  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && Number(s.from) - last.to < gap) {
      last.text += ' ' + String(s.text).trim();
      last.to = Math.max(last.to, Number(s.to) || last.to);
    } else {
      merged.push({ from: Math.max(0, Number(s.from) || 0), to: Math.max(0, Number(s.to) || 0), text: String(s.text).trim() });
    }
  }

  const lines = [];
  let chars = 0;
  let full = true;
  for (const m of merged) {
    /* Реплика в 800 знаков — это уже монолог: режем по 300, каждая строка со
       своим временем (по доле длины — приблизительно, и это честнее, чем вешать
       всё на начало реплики). */
    const chunks = [];
    let rest = m.text;
    let from = m.from;
    while (rest.length > 300) {
      let cut = rest.lastIndexOf(' ', 300);
      if (cut < 120) cut = 300;
      chunks.push({ text: rest.slice(0, cut).trim(), from });
      const share = cut / Math.max(1, m.text.length);
      from = m.from + (m.to - m.from) * share;
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push({ text: rest, from });
    for (const c of chunks) {
      const line = '[' + fmtStamp(c.from) + '] ' + c.text.replace(/\s+/g, ' ');
      if (chars + line.length + 1 > maxChars) { full = false; break; }
      lines.push(line);
      chars += line.length + 1;
    }
    if (!full) break;
  }
  return { lines, chars, full };
}

/**
 * Нужен ли конспект: запись длинная или в ней уже несколько реплик.
 * Голосовой вопрос («напомни купить хлеб») остаётся вопросом.
 */
export function wantsNote({ segments, seconds } = {}) {
  const segs = Array.isArray(segments) ? segments.filter((s) => s && s.text).length : 0;
  const len = Number(seconds) || 0;
  if (segs >= NOTE_MIN_SEGMENTS && len >= NOTE_MIN_SEC * 0.6) return true;
  return len >= NOTE_MIN_SEC;
}

/** Указание модели. Таймкодов нет — прямо запрещаем их выдумывать. */
export function noteDirective({ hasStamps } = {}) {
  const base = 'Человек прислал ЗАПИСЬ (аудио), а не вопрос словами. Ответь конспектом по СОДЕРЖАНИЮ записи: '
    + 'о чём говорили, что решили, какие сроки и цифры названы. '
    + /* Живая находка первой пробы (12 окт): модель пересказала саму шапку блока —
       «указано название файла…, далее следует расшифровка с таймкодами» — и на
       этом конспект кончился. Поэтому запрет назван словами, а не оставлен на
       догадливость. */
    'Не описывай файл, расшифровку и сам блок: фраз вроде «указано название файла», «далее следует расшифровка», «в записи сказано» быть не должно — пиши сразу по делу.'
    + ' Сначала одна-две фразы о сути записи, затем 3–7 коротких пунктов по порядку. '
    /* Пример формы — самый сильный сигнал для модели: без него первый заход
       отвечал одной строкой про сам файл (живая проба 12 окт, дважды). */
    + 'Пример формы (содержание, разумеется, своё): «Совещание о бюджете и сроках; договорились о предоплате 30 %. – [0:00] Бюджет: 120 000, из них 30 000 — реклама. – [0:26] Сроки: первый этап до 15-го, второй — до конца месяца.» '

    + 'Не пересказывай запись целиком и не цитируй её длинно — человек может открыть расшифровку. '
    + 'Если в записи есть просьба или вопрос к тебе — выполни их, а не пересказывай.';
  return base + (hasStamps
    ? ' В начале каждого пункта ставь таймкод в квадратных скобках — ровно тот, что стоит у соответствующего места в дорожке: [2:15]. Таймкоды бери только из дорожки, своих не придумывай.'
    : ' Таймкодов в расшифровке нет — не выдумывай их и не пиши «[00:00]».');
}

/**
 * Собрать блок и указание для движка по одной записи.
 * → { mode: 'note' | 'plain', block, directive, stamps, seconds, words }
 */
export function noteOf({ text, segments, seconds, name } = {}) {
  const clean = String(text || '').trim();
  const segs = (Array.isArray(segments) ? segments : []).filter((s) => s && s.text);
  const len = Number(seconds) || (segs.length ? Number(segs[segs.length - 1].to) || 0 : 0);
  /* Шапка блока — только метаданные, коротко: чем больше в ней слов, тем охотнее
     модель их пересказывает вместо содержания (живая проба 12 окт). */
  const brief = '[' + (name ? name + ', ' : '') + 'запись' + (len ? ' ' + fmtDuration(len) : '') + ']';

  if (!wantsNote({ segments: segs, seconds: len })) {
    /* Короткая голосовая: как было — расшифровка вместо слов человека. */
    return { mode: 'plain', block: clean ? '[Голосом: ' + clean + ']' : '', directive: '', stamps: 0, seconds: len, words: countWords(clean) };
  }

  const t = timeline(segs);
  const head = brief + (t.lines.length ? ' — что говорилось, с метками времени:' : ' — расшифровка:');
  const block = (t.lines.length
    ? head + '\n' + t.lines.join('\n') + (t.full ? '' : '\n…(дальше дорожка не поместилась — расшифровка ниже целиком)')
    : head + '\n' + clean) + '\n\n' + NOTE_ASK;
  return {
    mode: 'note',
    block,
    directive: noteDirective({ hasStamps: t.lines.length > 0 }),
    stamps: t.lines.length,
    seconds: len,
    words: countWords(clean),
  };
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/**
 * Просьба, которая едет в сообщении после дорожки.
 *
 * Живая проба (12 окт) дважды дала ответ «об файле» вместо конспекта: сообщение
 * состояло только из метаданных и расшифровки, и модель не понимала, чего от неё
 * хотят. Просьба в конце сообщения — то место, которое модель слушает сильнее
 * всего (правило проекта «что ниже, то сильнее»), и она же закрывает дыру «в
 * сообщении нет ни одного слова человека».
 */
export const NOTE_ASK = 'Сделай конспект этой записи: что решили и о чём говорили, пункты с таймкодами из дорожки.';

/** Строка для человека под ответом: «Запись 3 мин 20 с · расшифровка, 412 слов». */
export function noteLine(info) {
  if (!info) return '';
  const parts = [];
  if (info.seconds) parts.push('Запись ' + fmtDuration(info.seconds));
  if (info.words) parts.push('расшифровка, ' + info.words + ' ' + wordsWord(info.words));
  if (info.mode === 'note' && info.stamps) parts.push('конспект с таймкодами');
  return parts.join(' · ');
}

/** «1 слово / 2 слова / 5 слов» — иначе «412 слов» через раз выходит «слов». */
export function wordsWord(n) {
  const v = Math.abs(Math.floor(Number(n) || 0)) % 100;
  const d = v % 10;
  if (v > 10 && v < 20) return 'слов';
  if (d === 1) return 'слово';
  if (d >= 2 && d <= 4) return 'слова';
  return 'слов';
}
