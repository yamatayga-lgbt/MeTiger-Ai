/* ============================================================
   Захват звука кусками (PCM) — основа уточнения «на лету».

   Зачем не MediaRecorder: он отдаёт webm/opus, где второй и последующие куски
   НЕ самостоятельны (заголовок только в первом). Отправить «только последние
   четыре секунды» оттуда нельзя — пришлось бы каждый раз пересылать всю запись,
   и стоимость росла бы квадратично. Здесь же мы читаем сырые сэмплы и собираем
   WAV сами: каждый кусок — самостоятельный файл, который можно расшифровать
   отдельно.

   Формат: 16 кГц, моно, 16 бит — ровно то, что ест Whisper (он всё равно
   приводит звук к этому виду). Три секунды — 96 КБ; три минуты — 5,8 МБ, то
   есть даже целая длинная запись проходит под потолок 8 МБ у /api/stt.
   ============================================================ */

/** Частота, которую ждёт Whisper. Всё остальное всё равно пересчитывается там. */
export const WHISPER_RATE = 16000

/** Сколько секунд ждём, прежде чем отправить кусок на расшифровку. */
export const LIVE_SEC = 4

/** Захват сэмплов из потока. Возвращает функцию остановки. */
export interface PcmTap {
  stop: () => void
}

export interface PcmTapOptions {
  /** Каждый кусок: Int16-сэмплы на 16 кГц. Приходит примерно раз в 250 мс. */
  onSamples: (samples: Int16Array) => void
  /** Возникла проблема с захватом — текст на лету не соберём, но микрофон жив. */
  onFail?: (why: string) => void
}

/** Прореживание с усреднением: 48 кГц → 16 кГц без «звона» и щелчков. */
export function downsample(input: Float32Array, inRate: number, outRate = WHISPER_RATE): Int16Array {
  if (outRate >= inRate) {
    const out = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) out[i] = toInt16(input[i])
    return out
  }
  const step = inRate / outRate
  const outLen = Math.floor(input.length / step)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const from = Math.floor(i * step)
    const to = Math.min(input.length, Math.floor((i + 1) * step))
    let sum = 0
    let n = 0
    for (let j = from; j < to; j++) {
      sum += input[j]
      n++
    }
    out[i] = toInt16(n ? sum / n : 0)
  }
  return out
}

function toInt16(v: number): number {
  const clamped = v < -1 ? -1 : v > 1 ? 1 : v
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

/** WAV-файл из Int16-сэмплов: 44 байта заголовка и данные. */
export function encodeWav(samples: Int16Array, sampleRate = WHISPER_RATE): Blob {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // размер блока fmt
  view.setUint16(20, 1, true) // PCM без сжатия
  view.setUint16(22, 1, true) // моно
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // байт в секунду
  view.setUint16(32, 2, true) // выравнивание блока
  view.setUint16(34, 16, true) // бит на сэмпл
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  /* Копию делаем через Uint8Array: у сэмплов буфер может быть и SharedArrayBuffer,
     а Blob его не принимает. */
  const body = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    body[i * 2] = v & 0xff
    body[i * 2 + 1] = (v >> 8) & 0xff
  }
  return new Blob([header, body], { type: 'audio/wav' })
}

/** Пик громкости куска: по нему понятно, было ли там вообще что-то слышно. */
export function peakOf(samples: Int16Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i]
    if (v > peak) peak = v
  }
  return peak / 0x8000
}

/** Процессор для AudioWorklet — маленький, поэтому живёт строкой и Blob-URL. */
const WORKLET_SRC = `
class MtMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('mt-mic', MtMic)
`

/**
 * Подключить захват к потоку микрофона.
 *
 * Два пути: AudioWorklet (правильный, живёт в отдельном потоке) и ScriptProcessor
 * (устаревший, но есть везде). Первый шаг — не «на всякий случай»: Safari и
 * старые Chrome в части сборок не дают worklet на нестандартных потоках, и без
 * второго пути текст на лету там просто не работал бы.
 */
export function createPcmTap(stream: MediaStream, opts: PcmTapOptions): PcmTap {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) {
    opts.onFail?.('браузер не умеет читать звук напрямую')
    return { stop: () => {} }
  }
  const ctx = new Ctx()
  const source = ctx.createMediaStreamSource(stream)
  let done = false
  let node: AudioNode | null = null
  let workletUrl = ''

  const stop = () => {
    if (done) return
    done = true
    try {
      node?.disconnect()
    } catch {
      /* noop */
    }
    try {
      void ctx.close()
    } catch {
      /* noop */
    }
    if (workletUrl) {
      try {
        URL.revokeObjectURL(workletUrl)
      } catch {
        /* noop */
      }
    }
  }

  const emit = (chunk: Float32Array) => {
    if (done) return
    try {
      opts.onSamples(downsample(chunk, ctx.sampleRate))
    } catch {
      /* один сбойный кусок не должен рушить запись */
    }
  }

  const useScriptProcessor = () => {
    try {
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0)
        emit(new Float32Array(ch))
      }
      source.connect(proc)
      /* ScriptProcessor без выхода наружу не запускается — ведём его в «немой»
         узел громкости 0, иначе звук из микрофона пошёл бы в колонки. */
      const mute = ctx.createGain()
      mute.gain.value = 0
      proc.connect(mute)
      mute.connect(ctx.destination)
      node = proc
    } catch {
      opts.onFail?.('не получилось слушать микрофон для уточнения')
    }
  }

  const start = async () => {
    try {
      if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
        await ctx.audioWorklet.addModule(workletUrl)
        if (done) return
        const wn = new AudioWorkletNode(ctx, 'mt-mic')
        wn.port.onmessage = (e: MessageEvent) => emit(e.data as Float32Array)
        source.connect(wn)
        /* Worklet-узел тоже надо тянуть к выходу, чтобы он обрабатывал кадры. */
        const mute = ctx.createGain()
        mute.gain.value = 0
        wn.connect(mute)
        mute.connect(ctx.destination)
        node = wn
        return
      }
    } catch {
      /* ниже упадём на ScriptProcessor */
    }
    if (!done) useScriptProcessor()
  }

  void start()
  return { stop }
}
