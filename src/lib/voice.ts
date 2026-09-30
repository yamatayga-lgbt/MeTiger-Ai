/* ============================================================
   Голосовой ввод — на максимум.
   Распознавание: Web Speech API (живая транскрипция, авто-рестарт
   пауз, ручное вкл/выкл). Уровень микрофона: настоящий сигнал
   через getUserMedia + AnalyserNode (волна в UI). Всё чистится
   при остановке/отмене/размонтировании.
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

export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
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

const ERROR_RU: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону — разрешите его в настройках браузера',
  'service-not-allowed': 'Голосовой ввод заблокирован браузером',
  'audio-capture': 'Микрофон не найден',
  network: 'Сервис распознавания недоступен — проверьте интернет',
  'language-not-supported': 'Язык распознавания не поддерживается',
}

export interface VoiceHandlers {
  /** Подтверждённый кусок речи. */
  onFinal: (chunk: string) => void
  /** Незакреплённый кусок — живой предпросмотр. */
  onInterim: (chunk: string) => void
  /** Уровень сигнала микрофона 0..1 (≈12 раз в секунду). */
  onLevel: (level: number) => void
  /** Фатальная ошибка — сессия завершается. */
  onError: (message: string) => void
}

export interface VoiceSession {
  /** Остановить и оставить распознанный текст. */
  stop: () => void
  /** Остановить и отбросить всё, что распознали в этой сессии. */
  cancel: () => void
}

export function startVoice(handlers: VoiceHandlers, lang: string): VoiceSession | null {
  const w = window as unknown as Record<string, unknown>
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => RecognitionLike)
    | undefined
  if (!Ctor) return null

  const rec: RecognitionLike = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1
  rec.lang = lang

  let stopped = false
  let fatal = false

  // --- уровень микрофона (волна) ---
  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let rafId = 0
  let lastEmit = 0
  let smoothed = 0

  const stopMeter = () => {
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

  const startMeter = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      audioCtx = new Ctx()
      const source = audioCtx.createMediaStreamSource(stream)
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
      /* без уровня — распознавание продолжается */
    }
  }

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
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      fatal = true
      stopped = true
    }
    handlers.onError(ERROR_RU[code] || 'Не получилось распознать речь — попробуйте ещё раз')
  }

  rec.onend = () => {
    // Chrome сам завершает сессию после паузы — при ручном «включено» стартуем снова
    if (stopped || fatal) {
      stopMeter()
      return
    }
    try {
      rec.start()
    } catch {
      /* noop */
    }
  }

  try {
    rec.start()
  } catch {
    handlers.onError('Не получилось запустить голосовой ввод — попробуйте ещё раз')
    return null
  }
  void startMeter()

  return {
    stop() {
      if (stopped) return
      stopped = true
      try {
        rec.stop()
      } catch {
        /* noop */
      }
      stopMeter()
    },
    cancel() {
      if (stopped && !stream && !rafId) {
        try {
          rec.abort()
        } catch {
          /* noop */
        }
        return
      }
      stopped = true
      try {
        rec.abort()
      } catch {
        /* noop */
      }
      stopMeter()
    },
  }
}
