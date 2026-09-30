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

/** Короткая строка «кто ответил» — для отладочной подписи под сообщением. */
export function sourceLine(r: ChatResult): string {
  if (!r.ok || !r.provider) return ''
  return `${r.provider} · ${r.model || '?'} · ${r.intent || '?'}/${r.tier || '?'} · ${r.ms ?? 0} мс`
}
