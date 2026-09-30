/**
 * Клиент двигателя (Этап 1 переноса из Yama AI).
 *
 * Один вызов POST /api/chat: тот же путь отдают и локальный `vite` (proxy в
 * vite.config.ts), и Pages Function на проде. Ответ — не «текст или ничего»:
 * вместе с текстом приходят провайдер, модель и намерение классификатора. По ним
 * и видно, кто сейчас говорит с человеком; без них любой сбой выглядит как
 * «модель тупит», хотя на деле кончилась квота у одного провайдера.
 *
 * Демо-ответы из mock.ts остаются только режимом разработки. В проде честная
 * ошибка лучше, чем красивая заглушка, выданная за ответ агента.
 */

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatResult {
  ok: boolean
  reply: string
  provider?: string
  model?: string
  intent?: string
  tier?: string
  ms?: number
  /** Почему не вышло — словом, чтобы это можно было показать человеку. */
  error?: string
  /** Что перебрал движок: провайдеры и причины. */
  tried?: { provider: string; model?: string; why?: string }[]
  /** Вердикт совета голов словами (пусто — значит совет молчал). */
  ensemble?: string
  /** Вердикт совета зрячих голов по картинке. */
  vision?: string
  /** Текст изменён большинством — это надо показать, а не спрятать. */
  ensembleApplied?: boolean
  visionApplied?: boolean
}

const ENDPOINT = (import.meta.env?.VITE_API_BASE || '') + '/api/chat'

export async function sendChat(
  text: string,
  history: ChatTurn[] = [],
  opts: { signal?: AbortSignal; images?: string[] } = {},
): Promise<ChatResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 75_000)
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ text, history: history.slice(-8), images: opts.images }),
    })
    const data = (await res.json().catch(() => null)) as Partial<ChatResult> | null
    if (!res.ok || !data) {
      return { ok: false, reply: '', error: (data && data.error) || `сервер ответил ${res.status}`, tried: data?.tried }
    }
    return { ok: true, reply: data.reply || '', ...data }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError'
    return { ok: false, reply: '', error: aborted ? 'время вышло' : 'сеть недоступна' }
  } finally {
    clearTimeout(timer)
  }
}


/**
 * Чем подписать ответ: кто говорил и что сказал совет.
 *
 * Совет не должен оставаться внутренней кухней движка. «сошлись 3/3» и
 * «Головы не сошлись» — это ровно то, что отличает проверку от угадывания, и
 * человек это видит. Тон подбирается по смыслу строк, а не по их наличию:
 * промолчавший совет не кричит, исправленный ответ — подсвечен.
 */
export type AdviceTone = 'ok' | 'warn' | 'quiet'

const OK_LINE = /сошлись\s+\d+\/\d+|подтверждаю|confirmed/i
const WARN_LINE = /не сошлись|разошлись|overruled|взято большинство|большинство/i

export function adviceLine(r: ChatResult): { text: string; tone: AdviceTone } | null {
  const parts = [r.ensemble, r.vision].map((x) => (x || '').trim()).filter(Boolean)
  if (!parts.length) return null
  const text = parts.join(' · ')
  const changed = r.ensembleApplied === true || r.visionApplied === true
  if (WARN_LINE.test(text) || changed) return { text, tone: 'warn' }
  if (OK_LINE.test(text)) return { text, tone: 'ok' }
  return { text, tone: 'quiet' }
}

/** Короткая строка «кто ответил» — для отладочной подписи под сообщением. */
export function sourceLine(r: ChatResult): string {
  if (!r.ok || !r.provider) return ''
  return `${r.provider} · ${r.model || '?'} · ${r.intent || '?'}/${r.tier || '?'} · ${r.ms ?? 0} мс`
}
