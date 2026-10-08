/**
 * Голос в обратную сторону: ответы вслух.
 *
 * Почему именно этот голос. Нужен русский, бесплатный и без карты.
 *   · MeloTTS у Cloudflare (была первая мысль) — русского не знает вовсе:
 *     английский, испанский, французский, китайский, японский, корейский;
 *     и наш действующий токен на этот доступ отвечает «Authentication error».
 *   · Голоса в браузере (речь устройства) — работают, но звучат механически и
 *     на телефоне зависят от того, установлен ли русский движок.
 *   · Движок «читать вслух» Microsoft (тот, что в Edge) — те же нейронные голоса,
 *     что у платных Azure-голосов, но без ключей и карт. Русских голосов два:
 *     Дмитрий и Светлана. Это и есть «озвучка»: рот говорит живым голосом,
 *     а не роботом. Плата — честная: сервис неофициальный (никакого договора),
 *     может закрыться или попросить больше данных; поэтому здесь нет ни одного
 *     обязательства, а на клиенте есть запасной путь — речь устройства.
 *
 * Протокол повторён по рабочей библиотеке edge-tts 7.2.8 (питон не годится в
 * Cloudflare, поэтому повтор на JS, побайтово тот же): соединение WebSocket,
 * токен и подпись времени (Sec-MS-GEC) — В АДРЕСЕ, а не в заголовках; сначала
 * конверт с настройками, затем SSML; аудио приходит кадрами, где первые два
 * байта — длина заголовка. Проба сошлась до байта: тот же текст даёт те же
 * 30 384 байта, что у библиотеки.
 *
 * Отдельная забота — ЧТО произносить. Ответы приходят разметкой: звёздочки,
 * таблицы, блоки кода и формулы LaTeX. Читать это вслух нельзя («обратный слэш
 * ф-ра-к»), поэтому текст сначала приводится к устной форме (speechText):
 * формулы становятся словами («корень из двух», «два в квадрате», «дробь»),
 * код пропускается, ссылки — своим текстом, таблицы — строками.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM = '143.0.3650.75';
const WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

/** Голоса по языкам. Русских два — мужской и женский; это и есть выбор человека. */
export const VOICES = {
  ru: { male: 'ru-RU-DmitryNeural', female: 'ru-RU-SvetlanaNeural' },
  en: { male: 'en-US-AndrewNeural', female: 'en-US-AriaNeural' },
};

/** Потолки: длинный ответ в речь целиком не влезает — режем по границе фразы. */
export const TTS_LIMITS = {
  /** Сколько знаков озвучиваем. Это примерно три минуты речи. */
  MAX_CHARS: 3000,
  /** Минимум: одну букву озвучивать незачем. */
  MIN_CHARS: 1,
  /** Потолок ожидания голоса. Модель речи отвечает за секунды, но сеть бывает злой. */
  TIMEOUT_MS: 20000,
};

/**
 * Подпись времени для службы голоса (Sec-MS-GEC).
 *
 * Считается от «времени файлов» Windows, округлённого вниз до пяти минут, и
 * открытого ключа. Складывать такие числа в double нельзя: 1.39e17 уже не
 * влезает точно, и подпись разъезжается — поэтому приведение к целому идёт
 * через BigInt (та же точность, что в питоне).
 */
export async function gecToken(nowMs = Date.now()) {
  let t = nowMs / 1000 + 11644473600;
  t -= t % 300;
  t *= 1e7;
  const ticks = String(BigInt(Math.round(t)));
  /* Шифрование берём встроенное (crypto.subtle): оно есть и в Cloudflare, и в
     браузере, и в node — без дополнительных согласий и без nodejs-набора. */
  const байты = new TextEncoder().encode(ticks + TRUSTED_CLIENT_TOKEN);
  const хеш = await crypto.subtle.digest('SHA-256', байты);
  return [...new Uint8Array(хеш)].map((б) => б.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Разбор кадра от службы: текст или аудио. Используется и в проверках. */
export function parseFrame(data) {
  if (typeof data === 'string') {
    const head = data.slice(0, data.indexOf('\r\n\r\n'));
    const path = (/(?:^|\r\n)Path:([^\r\n]+)/.exec(head) || [])[1] || '';
    const tail = data.indexOf('\r\n\r\n') >= 0 ? data.slice(data.indexOf('\r\n\r\n') + 4) : '';
    return { kind: path.trim() === 'turn.end' ? 'end' : 'meta', path: path.trim(), text: tail };
  }
  if (data instanceof ArrayBuffer) return разобратьБайты(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return разобратьБайты(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  /* Сюда попадает всё остальное (Blob, поток): их надо сначала превратить в байты
     — этим занимается toBytes в самом синтезе, а не разбор кадра. */
  return { kind: 'плохой' };
}

/** Форма кадра словами — для разбора неполадок: рантаймы присылают по-разному. */
export function frameShape(data) {
  if (typeof data === 'string') return 'строка';
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return 'ArrayBuffer';
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) return (data.constructor && data.constructor.name) || 'вид массива';
  if (typeof Blob !== 'undefined' && data instanceof Blob) return 'Blob';
  if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) return 'поток';
  if (data && typeof data.arrayBuffer === 'function') return 'arrayBuffer()';
  return typeof data;
}

/** Кадр в байты: в проде бинарные кадры приходят Blob-ом, а не ArrayBuffer — их надо прочитать. */
export async function toBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) {
    return new Uint8Array(await new Response(data).arrayBuffer());
  }
  if (typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(0);
}

function разобратьБайты(buf) {
  if (buf.length < 2) return { kind: 'плохой' };
  const headerLength = (buf[0] << 8) | buf[1];
  if (headerLength > buf.length) return { kind: 'плохой' };
  const head = new TextDecoder().decode(buf.slice(2, headerLength));
  const path = (/(?:^|\r\n)Path:([^\r\n]+)/.exec(head) || [])[1] || '';
  if (path.trim() !== 'audio') return { kind: 'чужой', path: path.trim() };
  return { kind: 'audio', audio: buf.slice(headerLength + 2) };
}

/** Язык ответа: по доле кириллицы. Короткие ответы («да», «ок») — тоже русские. */
export function guessLang(text) {
  const s = String(text || '');
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters) return 'ru';
  const cyr = (s.match(/[\u0400-\u04FF]/g) || []).length;
  return cyr / letters.length >= 0.15 ? 'ru' : 'en';
}

/** Голос под текст и пожелание человека. По умолчанию — женский, как у ассистентов. */
export function pickVoice(text, gender) {
  const lang = guessLang(text);
  const set = VOICES[lang] || VOICES.ru;
  return gender === 'male' ? set.male : set.female;
}

/* ───────────────────────── текст для устной речи ───────────────────────── */

/** Берёт группу в фигурных скобках со счётом вложенности: `{-b\pm\sqrt{b^{2}}}` — одна группа. */
function takeBraced(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return null;
}

/**
 * Дроби и корни — словами, с учётом вложенности.
 * Регулярным выражением это не берётся: числитель дроби часто сам со скобками
 * (`\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}`), и «скобки без скобок внутри» на нём
 * ломается — на живой пробе выходило «frac -b плюс-минус sqrt ...».
 */
function expandBraced(s, depth = 0) {
  if (depth > 12) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const m = /^\\[dt]?frac|^\\sqrt/.exec(s.slice(i));
    if (m) {
      const cmd = m[0];
      let j = i + cmd.length;
      let opt = null;
      if (cmd === '\\sqrt' && s[j] === '[') {
        const close = s.indexOf(']', j);
        if (close > 0) { opt = s.slice(j + 1, close); j = close + 1; }
      }
      const g1 = takeBraced(s, j);
      if (g1) {
        const a = expandBraced(g1[0], depth + 1);
        if (cmd === '\\sqrt') {
          out += opt === '3' ? ' кубический корень из ' + a
            : opt ? ' корень степени ' + opt + ' из ' + a : ' корень из ' + a;
          i = g1[1];
          continue;
        }
        const g2 = takeBraced(s, g1[1]);
        if (g2) {
          out += ' дробь ' + a + ' на ' + expandBraced(g2[0], depth + 1);
          i = g2[1];
          continue;
        }
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

/** Формула в произносимый вид: \frac{a}{b} → «дробь a на b», \sqrt{x} → «корень из x». */
function spokenFormula(body) {
  let s = String(body || '');
  s = expandBraced(s)

    .replace(/\^\{?2\}?/g, ' в квадрате')
    .replace(/\^\{?3\}?/g, ' в кубе')
    /* Пробел в конце не для красоты: без него «x^{n}y» слипалось в «в степени ny». */
    .replace(/\^\{([^{}]*)\}/g, ' в степени $1 ')
    .replace(/\^(-?\w)/g, ' в степени $1 ')
    .replace(/_(\{([^{}]*)\}|\w)/g, (m, a) => ' индекс ' + String(a).replace(/[{}]/g, '') + ' ');
  /* Знаки и функции — словами. */
  /* Порядок и границы важны: `\left` начинается с `\le`, и без проверки «команда
     кончилась» на живой пробе выходило «меньше или равно ft(...». Поэтому сперва
     парные скобки и длинные связки, а у коротких команд — запрет на букву следом. */
  const знаки = [
    [/\\left|\\right/g, ''],
    [/\\to\s*\\infty/g, ' стремится к бесконечности '],
    [/\\pm/g, '\u0001'], [/\\cdot/g, ' умножить на '], [/\\times/g, ' умножить на '],
    [/\\div(?![a-zA-Z])/g, ' разделить на '], [/\\le(?![a-zA-Z])/g, ' меньше или равно '],
    [/\\ge(?![a-zA-Z])/g, ' больше или равно '], [/\\neq/g, ' не равно '], [/\\approx/g, ' приблизительно '],
    [/\\to(?![a-zA-Z])/g, ' стремится к '], [/\\in(?![a-zA-Z])/g, ' принадлежит '],
    [/\\infty/g, ' бесконечность '], [/\\Delta/g, ' дельта '], [/\\alpha/g, ' альфа '],
    [/\\beta/g, ' бета '], [/\\gamma/g, ' гамма '], [/\\pi(?![a-zA-Z])/g, ' пи '],
    [/\\sigma/g, ' сигма '], [/\\mu(?![a-zA-Z])/g, ' мю '], [/\\lambda/g, ' лямбда '],
    [/\\sum/g, ' сумма '], [/\\int/g, ' интеграл '], [/\\lim/g, ' предел '],
    [/\\begin\{cases\}/g, ' система: '], [/\\end\{cases\}/g, '; '],
    [/\\\\/g, '; '], [/&/g, ' '],
  ];
  for (const [что, чем] of знаки) s = s.replace(что, чем);
  /* Слова внутри \\text{…} освобождаем ДО знаков действия: иначе «что-то» станет
     «что минус то» (живая проба). После раскрытия в тексте остаются только знаки
     выражения, и минус можно читать словом. */
  s = s.replace(/\\(?:text|mathbb|mathrm|operatorname)\s*\{([^{}]*)\}/g, '$1');
  /* Знаки действий — словами. Минус — только между частями выражения. */
  s = s.replace(/\+/g, ' плюс ')
    /* Дефис в «плюс-минус» (он лежит под меткой \u0001) минусом не считается,
       как и дефис внутри русского слова: «что-то» — это слово, а «x-y» — вычитание. */
    .replace(/-/g, (m, off, str) => {
      const до = str[off - 1] || '';
      const после = str[off + 1] || '';
      if (до === '\u0001' || после === '\u0001') return m;
      if (/[А-Яа-яЁё]/.test(до) && /[А-Яа-яЁё]/.test(после)) return m;
      return ' минус ';
    })
    .replace(/(?<![<>!=])=(?!=)/g, ' равно ')
    .replace(/\s*\/\s*/g, ' делить на ');
  /* Теперь — \\text{…} и остатки служебных знаков. */
  s = s.replace(/[{}]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\u0001/g, ' плюс-минус ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Ответ модели → то, что читают вслух.
 * Код пропускаем (слушать его бессмысленно), формулы произносим словами,
 * разметку убираем, ссылки оставляем своим текстом, таблицы — строками.
 */
export function speechText(md) {
  let s = String(md || '');
  s = s.replace(/```[\s\S]*?```/g, ' Пример кода. ');
  s = s.replace(/`([^`]*)`/g, '$1');
  /* Формулы — до прочей разметки, иначе подчёркивания уйдут в курсив. */
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => ' ' + spokenFormula(body) + ' ');
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => ' ' + spokenFormula(body) + ' ');
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body) => ' ' + spokenFormula(body) + ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/^#{1,6}\s*/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/^\s*[-*•]\s+/gm, '. ');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '. ');
  s = s.replace(/\|/g, ', ');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/[_~]/g, '');
  /* Значки и эмодзи вслух не читаются. */
  s = s.replace(/[\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/g, '');
  s = s.replace(/[\u{1F000}-\u{1FAFF}]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Обрезка по границе фразы: длинный ответ читаем началом, а не обрывком слова. */
export function clampSpeech(text, limit = TTS_LIMITS.MAX_CHARS) {
  const s = String(text || '');
  if (s.length <= limit) return { text: s, cut: false };
  const кусок = s.slice(0, limit);
  const точка = Math.max(кусок.lastIndexOf('. '), кусок.lastIndexOf('! '), кусок.lastIndexOf('? '));
  return { text: (точка > limit * 0.5 ? кусок.slice(0, точка + 1) : кусок).trim(), cut: true };
}

/* ─────────────────────────── сама озвучка ─────────────────────────── */

/**
 * Соединение со службой голоса.
 *
 * В Cloudflare исходящий WebSocket открывается НЕ схемой `wss://`, а запросом к
 * `https://` с заголовком Upgrade: `fetch` со `wss://` в рантайме отвечает
 * «Fetch API cannot load: wss://…» (видели живьём на местном рантайме). Поэтому
 * адрес переводим в https — путь и параметры те же.
 */
async function wsConnect(url, headers) {
  const res = await fetch(url.replace(/^wss:/, 'https:'), { headers: { ...headers, Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error('служба голоса не дала соединения');
  ws.accept();
  return ws;
}

/**
 * Синтез речи: текст → mp3 (Promise<ArrayBuffer> в обёртке с причиной).
 * `connect` можно подменить — так проверки гоняют протокол без сети.
 */
export async function synthesize(text, opts = {}) {
  const speech = speechText(text);
  if (speech.length < TTS_LIMITS.MIN_CHARS) return { ok: false, why: 'нечего читать' };
  const { text: forVoice, cut } = clampSpeech(speech, opts.maxChars || TTS_LIMITS.MAX_CHARS);
  const voice = opts.voice || pickVoice(forVoice, opts.gender);
  const rate = opts.rate || '+0%';
  const pitch = opts.pitch || '+0Hz';
  const connect = opts.connect || wsConnect;
  const now = opts.now || Date.now;

  const url = WSS + '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN
    + '&ConnectionId=' + (opts.connectionId || randomId())
    + '&Sec-MS-GEC=' + (await gecToken(now()))
    + '&Sec-MS-GEC-Version=1-' + CHROMIUM;
  const headers = {
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
  };

  let ws;
  try {
    ws = await connect(url, headers);
  } catch (e) {
    return { ok: false, why: 'служба голоса недоступна: ' + short(e) };
  }

  const куски = [];
  const обещания = [];
  /* Разбор при неполадке: сколько кадров пришло и какими они были. Без этого
     «не прислала звук» одинаково выглядит и при молчании службы, и при том, что
     кадры пришли, но разобрались как чужие (например, сжатые). */
  const счёт = { кадров: 0, текстовых: 0, бинарных: 0, аудио: 0, конец: 0, форма: '', первых: '' };
  const ждём = new Promise((resolve) => {
    const таймер = setTimeout(() => { try { ws.close(); } catch { /* уже закрыто */ } resolve(); }, opts.timeoutMs || TTS_LIMITS.TIMEOUT_MS);
    const закончить = () => { clearTimeout(таймер); resolve(); };
    /* Кадры со звуком разные рантаймы отдают по-разному: в wrangler это
       ArrayBuffer, а в проде — Blob. Своё «читаем как байты» делать нечем
       синхронно, поэтому бинарные кадры копим обещаниями и разбираем их
       по порядку после конца разговора: иначе куски звука схлопнутся не в том
       порядке, а на Blob-е не разберётся ни один кадр вовсе — так и вышло на
       проде: 49 бинарных кадров, 0 байт звука. */
    const onMessage = (ev) => {
      счёт.кадров++;
      const данные = ev.data;
      if (typeof данные === 'string') {
        счёт.текстовых++;
        try {
          const кадр = parseFrame(данные);
          if (кадр.kind === 'end') { счёт.конец++; try { ws.close(); } catch { /* уже закрыто */ } закончить(); }
        } catch { /* битый кадр — пропускаем */ }
        return;
      }
      счёт.бинарных++;
      if (!счёт.форма) счёт.форма = frameShape(данные);
      обещания.push(toBytes(данные));
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', закончить);
    ws.addEventListener('error', закончить);
    /* Конверт настроек, затем SSML — порядок обязателен. */
    const конверт = JSON.stringify({
      context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } },
    });
    const id = randomId();
    ws.send('X-Timestamp:' + new Date().toString() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' + конверт);
    const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='"
      + (guessLang(forVoice) === 'ru' ? 'ru-RU' : 'en-US') + "'><voice name='" + voice
      + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='+0%'>"
      + escapeXml(forVoice) + '</prosody></voice></speak>';
    ws.send('X-RequestId:' + id + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + new Date().toString() + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
  });

  await ждём;
  for (const обещание of обещания) {
    let buf;
    try { buf = await обещание; } catch { continue; }
    if (!счёт.первых && buf.length) {
      /* Первые байты первого кадра со звуком: по ним видно, наши это байты
         (0xff 0xf3 — начало mp3) или что-то чужое. */
      счёт.первых = [...buf.slice(0, 12)].map((б) => б.toString(16).padStart(2, '0')).join(' ');
    }
    const кадр = parseFrame(buf);
    if (кадр.kind === 'audio' && кадр.audio && кадр.audio.length) { куски.push(кадр.audio); счёт.аудио++; }
  }
  const всего = concat(куски);
  if (!всего.length) {
    /* Причина словами + разбор, если он запрошен: у службы бывает по-разному —
       и «молчит вовсе», и «прислала кадры, но не звук» (это разные болезни). */
    const причина = счёт.аудио || счёт.конец ? 'служба голоса не прислала звук' : 'служба голоса молчит';
    return opts.debug
      ? { ok: false, why: причина, debug: { ...счёт, url: url.slice(0, 96) + '…', voice, заголовки: Object.keys(headers) } }
      : { ok: false, why: причина };
  }
  return { ok: true, audio: всего, mime: 'audio/mpeg', voice, cut, chars: forVoice.length };
}

function short(e) {
  return String((e && e.message) || e || 'ошибка').slice(0, 120);
}

function randomId() {
  const х = () => Math.floor(Math.random() * 16).toString(16);
  let s = '';
  /* 32 знака: столько же, сколько в UUID без дефисов у библиотеки. */
  for (let i = 0; i < 32; i++) s += х();
  return s;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function concat(куски) {
  const длина = куски.reduce((н, к) => н + к.length, 0);
  const out = new Uint8Array(длина);
  let смещение = 0;
  for (const к of куски) { out.set(к, смещение); смещение += к.length; }
  return out;
}
