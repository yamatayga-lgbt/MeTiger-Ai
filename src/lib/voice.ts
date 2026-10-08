/* ============================================================
   Голосовой ввод — два слоя, как у больших ассистентов.

   1. ЧЕРНОВИК НА ЛЕТУ. Пока человек говорит, текст пишет Web Speech API браузера
      и отдаёт его кусками — он появляется в поле ввода сразу, за десятые доли
      секунды. Это дешёвый черновик: он быстрый, но в шуме и на именах ошибается.

   2. ТОЧНЫЙ ТЕКСТ ПО ОКОНЧАНИИ. Параллельно пишется сама речь (MediaRecorder с
      того же микрофона), и на остановке запись уходит на наш /api/stt — там
      Whisper large-v3-turbo (Groq, а если он выдохся — Cloudflare Workers AI).
      Возвращённый текст заменяет черновик целиком: это уже «как у ChatGPT»,
      потому что это тот же класс модели, что стоит там.

   Почему не только второй слой: он отвечает через секунду-две после остановки.
   Без черновика человек не видел бы, что его слышат, и решил бы, что ввод сломан.

   Всё чистится при остановке/отмене/размонтировании: микрофон не остаётся
   включённым, летящий запрос обрывается AbortController'ом.
   ============================================================ */

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
  be: 'ru-RU',
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
  const raw = (
    pref ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'ru'
  ).toLowerCase()
  const base = raw.split('-')[0]
  return LANG_MAP[base] || (raw.includes('-') ? raw : 'ru-RU')
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
  /** Ход уточнения: 'start' — пошёл запрос, 'fail' — не вышло, с причиной. */
  onPolish?: (state: 'start' | 'fail', reason?: string) => void
  /** Запись сама остановилась на потолке длины (дальше уточнение). */
  onCap?: () => void
}

export interface VoiceSession {
  /** Остановить запись. Черновик остаётся, точный текст придёт через onPolished. */
  stop: () => void
  /** Остановить и отбросить всё: и запись, и летящий запрос. */
  cancel: () => void
}

/** Формат записи: что браузер умеет, в порядке предпочтения. */
function pickMime(): string {
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (m: string) => boolean } }).MediaRecorder
  if (!MR || typeof MR.isTypeSupported !== 'function') return ''
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    try {
      if (MR.isTypeSupported(m)) return m
    } catch {
      /* some browsers throw on odd types */
    }
  }
  return ''
}

export function startVoice(handlers: VoiceHandlers, lang: string): VoiceSession | null {
  const w = window as unknown as Record<string, unknown>
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined

  let stopped = false
  let cancelled = false
  let srDead = false
  let asked = false // запрос точной расшифровки уже ушёл или отправляется
  let abortRef: AbortController | null = null
  let rec: RecognitionLike | null = null

  if (!navigator.mediaDevices?.getUserMedia) return null

  // --- микрофон: один поток и на уровень, и на запись ---
  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let rafId = 0
  let lastEmit = 0
  let smoothed = 0

  const stopMic = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    try {
      void audioCtx?.close()
    } catch {
      /* noop */
    }
    audioCtx = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  // --- запись речи для точной расшифровки ---
  let mr: MediaRecorder | null = null
  const parts: Blob[] = []
  let mime = ''

  /** Отправка записи на наш /api/stt. */
  const askAccurate = async (blob: Blob) => {
    if (asked || cancelled) return
    asked = true
    handlers.onPolish?.('start')
    const ac = new AbortController()
    abortRef = ac
    const tm = setTimeout(() => ac.abort(), POLISH_MS)
    try {
      const r = await fetch('/api/stt?lang=' + encodeURIComponent(lang.split('-')[0]), {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
        signal: ac.signal,
      })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null
      if (cancelled) return
      const text = j && j.ok && typeof j.text === 'string' ? j.text.trim() : ''
      if (text) handlers.onPolished?.(text)
      else handlers.onPolish?.('fail', (j && j.error) || 'речь не разобрал')
    } catch {
      /* Оборвали сами (отмена) — молчим. Иначе честно говорим, что не вышло. */
      if (!cancelled) handlers.onPolish?.('fail', 'связь не дала уточнить')
    } finally {
      clearTimeout(tm)
    }
  }

  const startRecording = () => {
    const MR = (window as unknown as { MediaRecorder?: new (s: MediaStream, o?: MediaRecorderOptions) => MediaRecorder }).MediaRecorder
    if (!MR || !stream) return
    mime = pickMime()
    try {
      mr = new MR(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      try {
        mr = new MR(stream)
      } catch {
        mr = null
        return
      }
    }
    mr.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) parts.push(e.data)
    }
    mr.onstop = () => {
      const type = (mr && mr.mimeType) || mime || 'audio/webm'
      const blob = new Blob(parts, { type })
      parts.length = 0
      if (cancelled || !blob.size) return
      void askAccurate(blob)
    }
    try {
      /* Кусок раз в секунду: так к моменту остановки почти всё уже в памяти, и
         ждать «допишу файл» не приходится. */
      mr.start(1000)
    } catch {
      mr = null
    }
  }

  const startMeter = (s: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      audioCtx = new Ctx()
      const source = audioCtx.createMediaStreamSource(s)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const tick = () => {
        if (stopped) return
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        const target = Math.min(1, rms * 4.2)
        smoothed = smoothed * 0.72 + target * 0.28
        const now = performance.now()
        if (now - lastEmit > 85) {
          lastEmit = now
          handlers.onLevel(smoothed)
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    } catch {
      /* без уровня всё остальное работает */
    }
  }

  const startDraft = () => {
    if (!Ctor || srDead) return
    rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.lang = lang

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        const text = (r[0]?.transcript || '').trim()
        if (!text) continue
        if (r.isFinal) handlers.onFinal(text)
        else handlers.onInterim(text)
      }
    }

    rec.onerror = (ev) => {
      const code = ev?.error || ''
      if (code === 'no-speech' || code === 'aborted') return // молчание/отмена — не ошибка
      /* ЛЮБОЙ отказ распознавания — это отказ ЧЕРНОВИКА, и только его. Микрофон
         проверяется отдельно (getUserMedia выше): если он жив, запись идёт и
         точный текст приедет после остановки. Раньше отказ 'audio-capture'
         гасил всю сессию — и человек терял и запись, и текст. */
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
      // Chrome сам завершает сессию после паузы — при ручном «включено» стартуем снова
      if (stopped || srDead) return
      try {
        rec?.start()
      } catch {
        /* noop */
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
      clearTimeout(capId)
      try {
        rec?.stop()
      } catch {
        /* noop */
      }
      try {
        if (mr && mr.state !== 'inactive') mr.stop()
      } catch {
        /* noop */
      }
      stopMic()
    },
    cancel() {
      cancelled = true
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
      try {
        if (mr && mr.state !== 'inactive') mr.stop()
      } catch {
        /* noop */
      }
      stopMic()
    },
  }

  /* Порядок важен: сначала СПРАШИВАЕМ МИКРОФОН, и только он решает, жива ли
     сессия. Отказ в доступе или отсутствие устройства — вот это фатально, и об
     этом надо сказать сразу. Всё остальное (запись, уровень, черновик) —
     надстройка, каждая со своим правом упасть. */
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
    startRecording()
    startMeter(stream)
    startDraft()
  })()

  /* Потолок длины: на трёх минутах останавливаемся сами. Человек может молчать в
     кармане — запись на час не должна ни ждать, ни стоить квоты. */
  const capId = setTimeout(() => {
    if (stopped) return
    handlers.onCap?.()
    session.stop()
  }, VOICE_MAX_SEC * 1000)

  return session
}
