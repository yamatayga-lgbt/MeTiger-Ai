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
  /** Какую модель выбрал человек, если до неё не дошло. */
  pinned?: string
  /** Выбранная модель не ответила — говорили другой. */
  pinMiss?: boolean
  /** Вердикт совета голов словами (пусто — значит совет молчал). */
  ensemble?: string
  /** Вердикт совета зрячих голов по картинке. */
  vision?: string
  /** Какие инструменты агента накормили ответ (web-search, news, calc…). */
  tools?: string[]
  /** Навыки, которые включились по смыслу вопроса (engine/skills.js). */
  skills?: string[]
  /** Документы, которые модель оформила файлом: имя, mime, вес и base64 целиком. */
  files?: { name: string; mime: string; size: number; b64: string; kind?: string }[]
  /** Текст изменён большинством — это надо показать, а не спрятать. */
  ensembleApplied?: boolean
  visionApplied?: boolean
  /** Род агента, которым отвечали: 'male' | 'female' | 'auto'. */
  gender?: string
  /** Что движок прочитал в форме последней реплики (только при EMOTION_LABEL=1). */
  emotion?: { id: string; emoji: string; label: string; confidence: number }
}

const ENDPOINT = (import.meta.env?.VITE_API_BASE || '') + '/api/chat'

export async function sendChat(
  text: string,
  history: ChatTurn[] = [],
  opts: { signal?: AbortSignal; images?: string[]; model?: string; gender?: string } = {},
): Promise<ChatResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 75_000)
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        text,
        history: history.slice(-8),
        images: opts.images,
        model: opts.model || undefined,
        gender: opts.gender || undefined,
      }),
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
const TOOL_RU: Record<string, string> = {
  'web-search': 'веб-поиск',
  news: 'новости',
  wikipedia: 'вики',
  url: 'страница',
  calc: 'калькулятор',
  currency: 'курсы',
  weather: 'погода',
  time: 'время',
  date: 'дата',
  random: 'случайность',
  coin: 'монетка',
  dice: 'кубики',
  joke: 'шутка',
  'image-search': 'поиск картинок',
  filegen: 'файл',
}

/** Сколько весят файлы по-человечески: байты не округляем до «0 КБ». */
export function fileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} КБ`
  return `${(n / 1048576).toFixed(2).replace('.', ',')} МБ`
}

/** data-URI для скачивания: своего хранилища под выдачу нет, файл живёт в ответе. */
export function fileHref(f: { mime: string; b64: string }): string {
  return `data:${f.mime || 'application/octet-stream'};base64,${f.b64}`
}

export function sourceLine(r: ChatResult): string {
  if (!r.ok || !r.provider) return ''
  const tools = (r.tools || []).map((t) => TOOL_RU[t] || t)
  return (
    `${r.provider} · ${r.model || '?'} · ${r.intent || '?'}/${r.tier || '?'} · ${r.ms ?? 0} мс` +
    (r.pinMiss && r.pinned ? ` · ${r.pinned} не ответил` : '') +
    (tools.length ? ` · данные: ${tools.join(', ')}` : '') +
    /* навыки — чем модель себя правила; коротко, чтобы строка не расползалась */
    ((r.skills || []).length ? ` · навыки: ${(r.skills || []).slice(0, 3).join(', ')}${(r.skills || []).length > 3 ? ' +' + ((r.skills || []).length - 3) : ''}` : '') +
    ((r.files || []).length ? ` · файлы: ${(r.files || []).length}` : '') +
    /* состояние собеседника — если его включили (EMOTION_LABEL=1); без него строка
       выглядит ровно как раньше */
    (r.emotion ? ` · ${r.emotion.emoji} ${r.emotion.label}` : '') +
    /* эффективный род, которым агент реально ответил (auto не показываем — он ничего
       не обещает) */
    (r.gender && r.gender !== 'auto' ? ` · род: ${r.gender === 'female' ? 'женский' : 'мужской'}` : '')
  )
}
