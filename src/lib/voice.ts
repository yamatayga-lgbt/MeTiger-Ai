/* ============================================================
   Голосовой ввод — три слоя, как у больших ассистентов.

   1. ЧЕРНОВИК НА ЛЕТУ. Пока человек говорит, текст пишет Web Speech API браузера
      и отдаёт его кусками — он появляется в поле ввода сразу, за десятые доли
      секунды. Это дешёвый черновик: он быстрый, но в шуме и на именах ошибается.

   2. УТОЧНЕНИЕ НА ЛЕТУ (0.108). Параллельно пишется сама речь, и каждые четыре
      секунды накопленный кусок уходит на наш /api/stt — там Whisper
      large-v3-turbo. Ответ заменяет черновик: пока человек говорит, текст уже
      становится точным, а не ждёт остановки. Кусок — самостоятельный WAV
      (src/lib/pcm.ts), поэтому пересылать всю запись не приходится.

   3. ТОЧНЫЙ ТЕКСТ ПО ОКОНЧАНИИ. На остановке вся запись уходит на /api/stt
      одним файлом и заменяет всё, что было раньше: у модели на руках весь
      контекст целиком, поэтому это самый верный вариант из трёх.

   Почему не только второй слой: он отвечает через секунду-две после остановки.
   Без черновика человек не видел бы, что его слышат, и решил бы, что ввод сломан.

   Всё чистится при остановке/отмене/размонтировании: микрофон не остаётся
   включённым, летящий запрос обрывается AbortController'ом.
   ============================================================ */

import { createPcmTap, encodeWav, peakOf, LIVE_SEC, WHISPER_RATE } from './pcm'

/**
 * Склейка соседних кусков. Куски идут встык, и на стыке одно и то же слово
 * попадает в оба: Whisper слышит «привет мир» и «мир как дела». Убираем ведущие
 * слова нового куска, пока они совпадают с хвостом сказанного, — иначе в поле
 * появлялись бы «мир мир».
 */
export function joinLive(prev: string, next: string): string {
  /* NFC makes composed/decomposed spellings equal for comparison; retaining \p{M}
     avoids discarding diacritics. The transcript itself is never normalized. */
  const clean = (w: string) => w.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
  const prevWords = prev.trim().split(/\s+/).filter(Boolean).map(clean)
  const nextWords = next.trim().split(/\s+/).filter(Boolean)
  let drop = 0
  /* До 8 слов: на стыке пауз и длинных серверных кусков убираем весь повтор хвоста. */
  for (let k = Math.min(8, prevWords.length, nextWords.length); k >= 1; k--) {
    const tail = prevWords.slice(prevWords.length - k).join(' ')
    const head = nextWords.slice(0, k).map(clean).join(' ')
    if (tail === head && tail.length > 0) {
      drop = k
      break
    }
  }
  return nextWords.slice(drop).join(' ').trim()
}

/**
 * 0.239: Безударная склейка пауз при голосовой диктовке с телефона.
 *
 * Решает три реальные беды мобильного распознавания на ходу:
 * 1) На Android Chrome движок после паузы часто присылает кумулятивный повтор
 *    уже сказанного («посчитай смету» → «посчитай смету с доставкой») — отсекаем
 *    совпадающий хвост до 12 слов и полный дубль фразы.
 * 2) Знак препинания в начале нового куска («, а потом») приклеивается к слову
 *    без лишнего пробела перед запятой.
 * 3) После точки, вопросительного/восклицательного знака или новой строки первая
 *    буква следующей фразы поднимается в заглавную автоматически.
 */
export function stitchDictation(prev: string, next: string): string {
  const a = String(prev || '').replace(/[ \t]+$/g, '')
  const bRaw = String(next || '').trim()
  if (!bRaw) return a
  if (!a.trim()) {
    return bRaw.charAt(0).toUpperCase() + bRaw.slice(1)
  }

  const clean = (w: string) => w.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
  const prevTokens = a.trim().split(/\s+/).filter(Boolean)
  const nextTokens = bRaw.split(/\s+/).filter(Boolean)
  const prevClean = prevTokens.map(clean)
  const nextClean = nextTokens.map(clean)

  // Полный повтор последнего куска (частый баг перезапуска SpeechRecognition после паузы).
  if (
    nextClean.length > 0 &&
    nextClean.length <= prevClean.length &&
    prevClean.slice(prevClean.length - nextClean.length).join(' ') === nextClean.join(' ')
  ) {
    return a
  }

  let drop = 0
  const maxOverlap = Math.min(12, prevClean.length, nextClean.length)
  for (let k = maxOverlap; k >= 1; k--) {
    const tail = prevClean.slice(prevClean.length - k).join(' ')
    const head = nextClean.slice(0, k).join(' ')
    if (tail && tail === head) {
      drop = k
      break
    }
  }

  let tailText = nextTokens.slice(drop).join(' ').trim()
  if (!tailText) return a

  // Если предыдущая фраза закончилась концом предложения или переводом строки — заглавная буква.
  if (/(?:[.!?…]|\n)\s*$/.test(a)) {
    tailText = tailText.replace(/^([\p{L}])/u, (m) => m.toUpperCase())
  }

  // Если новый кусок начинается со знака препинания — лепим без пробела.
  if (/^[,.;:!?)]/.test(tailText)) {
    return a + tailText
  }
  if (a.endsWith('\n')) {
    return a + tailText
  }
  return a + ' ' + tailText
}

/* ============================================================
   Пунктуация голосом (0.188) — для браузерного черновика.

   Web Speech API на телефоне пишет текст БЕЗ знаков: «привет мир как дела».
   Gboard расставляет их сам, а чистый распознаватель — нет. Теперь знаки
   можно диктовать словами: «точка», «запятая», «новая строка» — команда
   превращается в знак прямо в поле. Ноль запросов: это замена текста.

   Серверный путь (Whisper) не трогаем — он пунктуацию ставит сам.
   ============================================================ */

/** Команды пунктуации: что говорит человек → какой знак остаётся в поле.
    Границы слова — через смотровые окна \p{L}\p{N}: \b в JS не знает кириллицы. */
const PUNCT: [RegExp, string][] = [
  [/(?<![\p{L}\p{N}])(?:точка|период|full stop|period)(?![\p{L}\p{N}])/giu, '.'],
  [/(?<![\p{L}\p{N}])(?:запятая|запятой|comma)(?![\p{L}\p{N}])/giu, ','],
  [/(?<![\p{L}\p{N}])(?:вопросительный знак|знак вопроса|question mark)(?![\p{L}\p{N}])/giu, '?'],
  [/(?<![\p{L}\p{N}])(?:восклицательный знак|знак восклицания|exclamation mark|exclamation point)(?![\p{L}\p{N}])/giu, '!'],
  [/(?<![\p{L}\p{N}])(?:двоеточие|colon)(?![\p{L}\p{N}])/giu, ':'],
  [/(?<![\p{L}\p{N}])(?:точка с запятой|semicolon)(?![\p{L}\p{N}])/giu, ';'],
  [/(?<![\p{L}\p{N}])(?:тире|дефис|dash)(?![\p{L}\p{N}])/giu, ' — '],
  [/(?<![\p{L}\p{N}])(?:новая строка|с новой строки|new line|newline)(?![\p{L}\p{N}])/giu, '\n'],
  [/(?<![\p{L}\p{N}])(?:абзац|new paragraph)(?![\p{L}\p{N}])/giu, '\n\n'],
]

/**
 * Заменить сказанные команды на знаки. Край: человек говорит «точка» как слово
 * («в этой точке») — не тронем: команда узнаётся словом целиком среди букв и
 * цифр, а «запятую» в слове «запятой» во фразе «с точки зрения запятой» ловит
 * только отдельное слово. Знак лепится к предыдущему слову, после запятой и
 * друзей — пробел, после точки — тоже (кроме «1.5», где дальше цифра).
 */
export function punctuate(s: string): string {
  let out = String(s || '')
  for (const [re, mark] of PUNCT) out = out.replace(re, mark)
  /* Знак прилип к слову: «мир .» → «мир.» */
  out = out.replace(/[ \t]+([.,!?;:])/g, '$1')
  /* После знака — пробел, если его нет: «мир,как» → «мир, как».
     Цифра после запятой — это «1,5»: пробел туда не нужен. */
  out = out.replace(/([,;:!?])(?=[^\s\d.,!?;:)\]])/gu, '$1 ')
  out = out.replace(/\.(?=[^\s\d.)\]])/gu, '. ')
  /* «1 запятая 5» — это десятичная дробь, без пробела */
  out = out.replace(/(\d),\s+(?=\d)/gu, '$1,')
  /* Тире — ровно с одним пробелом с каждой стороны */
  out = out.replace(/[ \t]*—[ \t]*/g, ' — ')
  /* Переводы строк — без хвостовых пробелов */
  out = out.replace(/[ \t]*\n[ \t]*/g, '\n')
  return out
}

/**
 * Сколько секунд речи ждать от браузерного движка, прежде чем признать его молчащим.
 *
 * Зачем сторож. С 0.150 текст браузера — финал, и серверные слои включались только
 * после ЯВНОЙ ошибки движка (srDead). Но у движка есть третье состояние: он принял
 * сессию, не сказал ни слова и не пожаловался. Так ведёт себя Chrome, когда служба
 * распознавания недоступна устройству. Человек при этом видит «Слушаю», микрофон
 * работает, а текста нет — ровно это и приехало 12 окт («почини голосовой ввод»).
 * Четырёх секунд речи хватает, чтобы отличить молчащий движок от медленного: рабочий
 * отдаёт первый результат за доли секунды.
 */
export const SILENT_DRAFT_SEC = 4

interface SpeechResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResultLike }
}

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechEventLike) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
}

/**
 * Есть ли чем диктовать. Это НЕ «есть ли распознавание речи в браузере»: черновик
 * на лету — удобство, а не условие. Достаточно микрофона и записи — тогда после
 * остановки текст придёт точным с сервера. Так голосовой ввод работает и в
 * браузерах без Web Speech API (Firefox), и там, где сервис распознавания
 * недоступен (корпоративная сеть, отключённый сервис) — раньше в этих случаях
 * кнопки микрофона не было вовсе.
 */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  return hasDraftEngine() || isPolishSupported()
}

/** Есть ли браузерное распознавание — только для черновика на лету. */
export function hasDraftEngine(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/** Есть ли чем записать речь для точной расшифровки (микрофон + MediaRecorder). */
export function isPolishSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

const LANG_MAP: Record<string, string> = {
  ru: 'ru-RU',
  be: 'be-BY',
  uk: 'uk-UA',
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  pl: 'pl-PL',
  tr: 'tr-TR',
  kk: 'kk-KZ',
  uz: 'uz-UZ',
  az: 'az-AZ',
  hy: 'hy-AM',
  ka: 'ka-GE',
  he: 'he-IL',
  ar: 'ar-SA',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
}

/** Язык распознавания: по языку Telegram/браузера, по умолчанию ru-RU. */
export function voiceLang(pref?: string): string {
  const raw = String(
    pref ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'ru'
  ).trim().replace(/_/g, '-')
  const parts = raw.split('-')
  const base = parts[0].toLowerCase()
  const canonical = [base, ...parts.slice(1).map((part) => {
    if (part.length === 2 || /^\d{3}$/.test(part)) return part.toUpperCase()
    if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase()
    return part.toLowerCase()
  })].join('-')
  /* Регион браузера важен для распознавания (en-GB, zh-TW, pt-BR и т. п.). */
  if (parts.length > 1 && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(canonical)) return canonical
  return LANG_MAP[base] || (canonical.includes('-') ? canonical : 'ru-RU')
}

/** Тот же язык, но коротко («ru») — в таком виде его понимает Whisper. */
export function voiceLangShort(pref?: string): string {
  return voiceLang(pref).split('-')[0]
}

const ERROR_RU: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону — разрешите его в настройках браузера',
  'service-not-allowed': 'Голосовой ввод заблокирован браузером',
  'audio-capture': 'Микрофон не найден',
  network: 'Сервис распознавания недоступен — проверьте интернет',
  'language-not-supported': 'Язык распознавания не поддерживается',
}

/** Потолок одной записи: 3 минуты. Дольше — это уже не «сказать запрос». */
export const VOICE_MAX_SEC = 180

/** Сколько ждём ответ на кусок «на лету», прежде чем считать его потерянным. */
const LIVE_MS = 12000

/** Сколько раз подряд можно не получить ответ, прежде чем выключить слой. */
const LIVE_FAILS_MAX = 2

/** Тишина громче этого пика куском не считается — квоту на неё не тратим. */
const SILENCE_PEAK = 0.02

/** Сколько ждём точную расшифровку, прежде чем оставить черновик как есть. */
const POLISH_MS = 25000

export interface VoiceHandlers {
  /** Подтверждённый кусок речи (черновик). */
  onFinal: (chunk: string) => void
  /** Незакреплённый кусок — живой предпросмотр. */
  onInterim: (chunk: string) => void
  /** Уровень сигнала микрофона 0..1 (≈12 раз в секунду). */
  onLevel: (level: number) => void
  /** Фатальная ошибка — сессия завершается (микрофона нет вовсе). */
  onError: (message: string) => void
  /**
   * Черновик писать нечем, но микрофон жив: запись продолжается, и текст приедет
   * точным после остановки. Отдельный обработчик нужен потому, что это НЕ повод
   * гасить сессию — иначе отказ браузерного распознавания уносил бы с собой и
   * серверный, который в этот момент ещё даже не начинался.
   */
  onDraftFail?: (message: string) => void
  /** Точный текст на всю сессию: заменяет черновик целиком. */
  onPolished?: (text: string) => void
  /** Кусок, уточнённый НА ЛЕТУ: добавляется к сказанному, черновик вытесняет. */
  onLive?: (text: string) => void
  /** Идёт запрос за куском — можно показать, что уточнение работает. */
  onLiveBusy?: (busy: boolean) => void
  /** Слой уточнения на лету выключился (частые отказы) — дальше только черновик. */
  onLiveOff?: (reason: string) => void
  /** Хвост уже подтверждённого текста — для связности соседних кусков. */
  liveContext?: () => string
  /** Ход уточнения: 'start' — пошёл запрос, 'fail' — не вышло, с причиной. */
  onPolish?: (state: 'start' | 'fail', reason?: string) => void
  /**
   * Браузерный движок молчит, текст пойдёт сервером (сработал сторож). Человеку
   * об этом говорить нечем и незачем: он просто получает текст — но разговору
   * вслух нужно знать, что расшифровка ещё в пути, и не отправлять пустое.
   */
  onServerLayers?: () => void
  /** Запись сама остановилась на потолке длины (дальше уточнение). */
  onCap?: () => void
}

export interface VoiceSession {
  /** Остановить запись. Черновик остаётся, точный текст придёт через onPolished. */
  stop: () => void
  /** Можно ли повторить точную расшифровку сохранённой записи. */
  canRetry: () => boolean
  /** Повторить точную расшифровку после восстановления связи. */
  retry: () => boolean
  /** Остановить и отбросить всё: и запись, и летящий запрос. */
  cancel: () => void
}

export function startVoice(handlers: VoiceHandlers, lang: string): VoiceSession | null {
  const w = window as unknown as Record<string, unknown>
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined

  let stopped = false
  let cancelled = false
  let srDead = false
  /* Сторож молчащего черновика: был ли от движка хоть один текст, шёл ли звук
     выше тишины, и не сработал ли сторож уже. */
  let draftGot = false
  let draftHeard = false
  let draftFlip = false
  let asked = false // запрос точного текста по всей записи уже ушёл
  let abortRef: AbortController | null = null
  let rec: RecognitionLike | null = null

  if (!navigator.mediaDevices?.getUserMedia) return null

  /* 0.150: текст браузера — ФИНАЛ. Серверные слои (уточнение кусками на лету и
     расшифровка всей записи после остановки) работают только когда браузерного
     движка речи нет вовсе или он умер по ходу записи: владелец попросил «чисто
     мой голос и авто-вставка» — без ожидания моделей и предупреждений о связи. */
  const serverLayers = () => !Ctor || srDead

  let stream: MediaStream | null = null
  const stopMic = () => {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  // --- слой 2: запись кусками и уточнение на лету ---
  const pcm: Int16Array[] = [] // вся запись — для точного текста в конце
  let pcmLen = 0
  let pending: Int16Array[] = [] // то, что ещё не отправлено на уточнение
  let pendingLen = 0
  let inFlight = false
  let liveFails = 0
  let liveOk = false
  let liveOff = false
  let tap: { stop: () => void } | null = null

  const flushLive = async () => {
    if (!serverLayers() || liveOff || inFlight || cancelled) return
    if (pendingLen < LIVE_SEC * WHISPER_RATE) return
    const chunk = concat(pending)
    const keep = pending[pending.length - 1]?.length || 0
    pending = []
    pendingLen = 0
    if (peakOf(chunk) < SILENCE_PEAK) return // была тишина — молчим и дальше
    inFlight = true
    handlers.onLiveBusy?.(true)
    const ac = new AbortController()
    const tm = setTimeout(() => ac.abort(), LIVE_MS)
    try {
      const text = await askServer(chunk, ac.signal, true)
      if (cancelled) return
      liveFails = 0
      if (text) {
        liveOk = true
        handlers.onLive?.(text)
      }
    } catch {
      liveFails++
      if (liveFails >= LIVE_FAILS_MAX && !liveOk) {
        liveOff = true
        handlers.onLiveOff?.('куски не расшифровываются')
      }
    } finally {
      clearTimeout(tm)
      inFlight = false
      handlers.onLiveBusy?.(false)
    }
    void keep
  }

  /** Общий путь отправки: и кусок, и вся запись. */
  const askServer = async (samples: Int16Array, signal?: AbortSignal, live?: boolean): Promise<string> => {
    const blob = encodeWav(samples)
    const tail = String((live && handlers.liveContext && handlers.liveContext()) || '').slice(-120)
    const url = '/api/stt?lang=' + encodeURIComponent(lang.split('-')[0]) + (tail ? '&prev=' + encodeURIComponent(tail) : '')
    const request = new AbortController()
    const abortFromCaller = () => request.abort()
    if (signal?.aborted) request.abort()
    else signal?.addEventListener('abort', abortFromCaller, { once: true })
    const tm = live ? null : setTimeout(() => request.abort(), POLISH_MS)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: blob,
        signal: request.signal,
      })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null
      const text = j && j.ok && typeof j.text === 'string' ? j.text.trim() : ''
      if (!text && !live) throw new Error((j && j.error) || 'речь не разобрал')
      if (!text && live) throw new Error((j && j.error) || 'пусто')
      return text
    } finally {
      if (tm) clearTimeout(tm)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  const concat = (parts: Int16Array[]): Int16Array => {
    let n = 0
    for (const p of parts) n += p.length
    const out = new Int16Array(n)
    let off = 0
    for (const p of parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }

  const hasRetryableRecording = () => {
    if (!stopped || cancelled || !pcmLen) return false
    return peakOf(concat(pcm)) >= SILENCE_PEAK
  }

  /** Вся запись целиком — точный текст. Сессию держим до успеха или отмены,
   *  чтобы при сетевом сбое её можно было повторить, не диктуя заново. */
  let polishBusy = false
  const transcribeAll = async () => {
    if (cancelled || polishBusy) return
    const all = concat(pcm)
    if (!all.length || peakOf(all) < SILENCE_PEAK) {
      handlers.onPolish?.('fail', 'записи нет')
      return
    }
    polishBusy = true
    handlers.onPolish?.('start')
    const ac = new AbortController()
    abortRef = ac
    try {
      const text = await askServer(all, ac.signal, false)
      if (cancelled) return
      handlers.onPolished?.(text)
    } catch {
      if (!cancelled) {
        handlers.onPolish?.(
          'fail',
          /* Если на лету уже был текст — он остаётся, и человеку важно это знать. */
          liveOk ? 'оставил уточнённое на лету' : 'связь не дала уточнить',
        )
      }
    } finally {
      polishBusy = false
      if (abortRef === ac) abortRef = null
    }
  }

  const askAccurate = async () => {
    /* Браузер уже написал финальный текст — сервер не дёргаем вовсе (0.150). */
    if (!serverLayers()) return
    if (asked || cancelled) return
    asked = true
    await transcribeAll()
  }

  // --- уровень сигнала: берём прямо из кусков, отдельный анализатор не нужен ---
  let lastEmit = 0
  let smoothed = 0
  const emitLevel = (samples: Int16Array) => {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 0x8000
      sum += v * v
    }
    const rms = Math.sqrt(sum / Math.max(1, samples.length))
    const target = Math.min(1, rms * 4.2)
    smoothed = smoothed * 0.72 + target * 0.28
    const now = performance.now()
    if (now - lastEmit > 85) {
      lastEmit = now
      handlers.onLevel(smoothed)
    }
  }

  // --- слой 1: черновик браузером (пока сервер не догнал) ---
  let uncommittedInterim = ''
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const flushUncommittedInterim = () => {
    const chunk = uncommittedInterim.trim()
    uncommittedInterim = ''
    if (chunk && !cancelled) {
      handlers.onFinal(chunk)
    }
  }

  const startDraft = () => {
    if (!Ctor || srDead || stopped || cancelled) return
    rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.lang = lang

    rec.onresult = (ev) => {
      const interimParts: string[] = []
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        /* Пунктуация голосом (0.188): «точка», «запятая», «новая строка» —
           это знаки в поле, а не слова. Только для браузерного черновика:
           серверный Whisper пунктуацию ставит сам. */
        const text = punctuate((r[0]?.transcript || '').trim())
        if (!text.trim()) continue
        draftGot = true
        if (r.isFinal) {
          uncommittedInterim = ''
          handlers.onFinal(text)
        } else {
          interimParts.push(text)
        }
      }
      if (interimParts.length > 0) {
        const combined = interimParts.join(' ').trim()
        uncommittedInterim = combined
        handlers.onInterim(combined)
      }
    }

    rec.onerror = (ev) => {
      const code = ev?.error || ''
      if (code === 'no-speech' || code === 'aborted') return
      // Сохраняем уже произнесённый кусок до переключения на серверный путь.
      flushUncommittedInterim()
      if (!srDead) {
        srDead = true
        handlers.onDraftFail?.(
          code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Браузер не даёт распознавать речь'
            : ERROR_RU[code] || 'Черновик на лету не пишется',
        )
      }
    }

    rec.onend = () => {
      /* 0.239: на телефоне пауза в 1,5–2 с часто завершает текущий сеанс Web Speech API
         без финального флага isFinal. Закрепляем надиктованный кусок ДО перезапуска,
         чтобы следующая фраза после паузы не затёрла предыдущую. */
      flushUncommittedInterim()
      if (stopped || srDead || cancelled) return
      try {
        rec?.start()
      } catch {
        /* В мобильном WebKit мгновенный rec.start() внутри onend иногда бросает
           InvalidStateError — пересоздаём распознаватель через короткую паузу. */
        if (restartTimer) clearTimeout(restartTimer)
        restartTimer = setTimeout(() => {
          restartTimer = null
          if (!stopped && !srDead && !cancelled) startDraft()
        }, 90)
      }
    }

    try {
      rec.start()
    } catch {
      srDead = true
      handlers.onDraftFail?.('Черновик на лету не пишется')
    }
  }

  const session: VoiceSession = {
    stop() {
      if (stopped) return
      stopped = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      clearTimeout(capId)
      flushUncommittedInterim()
      try {
        rec?.stop()
      } catch {
        /* noop */
      }
      tap?.stop()
      stopMic()
      void flushLive()
      void askAccurate()
    },
    canRetry() {
      return hasRetryableRecording()
    },
    retry() {
      if (!hasRetryableRecording() || polishBusy) return false
      void transcribeAll()
      return true
    },
    cancel() {
      cancelled = true
      uncommittedInterim = ''
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      clearTimeout(capId)
      stopped = true
      try {
        abortRef?.abort()
      } catch {
        /* noop */
      }
      try {
        rec?.abort()
      } catch {
        /* noop */
      }
      tap?.stop()
      stopMic()
      pcm.length = 0
      pending.length = 0
    },
  }

  /* Порядок важен: сначала СПРАШИВАЕМ МИКРОФОН, и только он решает, жива ли
     сессия. Всё остальное — надстройка, каждая со своим правом упасть. */
  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = String((e as { name?: string })?.name || '')
      handlers.onError(
        name === 'NotAllowedError'
          ? 'Нет доступа к микрофону — разрешите его в настройках браузера'
          : name === 'NotFoundError'
            ? 'Микрофон не найден'
            : 'Микрофон не открылся — попробуйте ещё раз',
      )
      session.cancel()
      return
    }
    if (stopped || cancelled) {
      stopMic()
      return
    }
    tap = createPcmTap(stream, {
      onSamples: (samples) => {
        if (stopped) return
        pcm.push(samples)
        pcmLen += samples.length
        /* Всю запись храним до трёх минут: 16 кГц × 2 байта × 180 с ≈ 5,8 МБ. */
        if (pcmLen > VOICE_MAX_SEC * WHISPER_RATE + WHISPER_RATE) {
          /* Больше потолка не копим — лишнее просто не путешествует на сервер. */
          pcmLen -= samples.length
          pcm.pop()
        }
        pending.push(samples)
        pendingLen += samples.length
        emitLevel(samples)
        if (peakOf(samples) >= SILENCE_PEAK) draftHeard = true
        /* Сторож: звук идёт, а движок за SILENT_DRAFT_SEC не сказал ни слова —
           значит расшифровку берёт на себя сервер (см. SILENT_DRAFT_SEC). */
        if (!draftFlip && !srDead && !draftGot && draftHeard && pcmLen >= SILENT_DRAFT_SEC * WHISPER_RATE) {
          draftFlip = true
          srDead = true
          try {
            rec?.abort()
          } catch {
            /* движок уже мёртв — тем более работаем сервером */
          }
          handlers.onServerLayers?.()
        }
        void flushLive()
      },
      onFail: (why) => handlers.onLiveOff?.(why),
    })
    startDraft()
  })()

  /* Потолок длины: на трёх минутах останавливаемся сами. */
  const capId = setTimeout(() => {
    if (stopped) return
    handlers.onCap?.()
    session.stop()
  }, VOICE_MAX_SEC * 1000)

  return session
}
