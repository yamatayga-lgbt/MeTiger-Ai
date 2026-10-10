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
  /* До трёх слов: на стыке повторяется слово или короткая фраза, не больше. */
  for (let k = Math.min(3, prevWords.length, nextWords.length); k >= 1; k--) {
    const tail = prevWords.slice(prevWords.length - k).join(' ')
    const head = nextWords.slice(0, k).map(clean).join(' ')
    if (tail === head) {
      drop = k
      break
    }
  }
  return nextWords.slice(drop).join(' ').trim()
}

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
      if (code === 'no-speech' || code === 'aborted') return
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
