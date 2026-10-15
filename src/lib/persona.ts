/* ============================================================
   Персонализация (0.186) — стиль и тон агента, как в приложении
   ChatGPT: базовый стиль, дружелюбие, энтузиазм, заголовки и
   списки, эмодзи, быстрые ответы, визуальные ответы.

   Хранится одним JSON в localStorage под ключом mt-persona.
   Чтение из отправки запроса и из экрана «Персонализация» идёт
   по одному ключу, поэтому два пути не разъезжаются. Значения
   проверяются: из хранилища может прилететь что угодно, а это
   текст, который уедет в подсказку модели.
   ============================================================ */

export type StyleTone = 'default' | 'professional' | 'friendly' | 'candid' | 'quirky' | 'efficient' | 'cynical'
export type Level = 'less' | 'default' | 'more'
export type Visual = 'default' | 'simple'

/** Настройки персонализации. default/less|default|more — «человек не выбирал». */
export interface Persona {
  /** Базовый стиль и тон. */
  style: StyleTone
  /** Дружелюбие. */
  friendliness: Level
  /** Энтузиазм. */
  enthusiasm: Level
  /** Заголовки и списки. */
  headers: Level
  /** Эмодзи. */
  emoji: Level
  /** Быстрые ответы: короткий ответ сразу, без поисков и памяти. */
  quick: boolean
  /** Визуальные ответы: simple — картинки и графики только по явной просьбе. */
  visual: Visual
}

export const PERSONA_KEY = 'mt-persona'

export const DEFAULT_PERSONA: Persona = {
  style: 'default',
  friendliness: 'default',
  enthusiasm: 'default',
  headers: 'default',
  emoji: 'default',
  quick: false,
  visual: 'default',
}

const STYLES: StyleTone[] = ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient', 'cynical']
const LEVELS: Level[] = ['less', 'default', 'more']
const VISUALS: Visual[] = ['default', 'simple']

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

function local(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : (localStorage as unknown as Store)
  } catch {
    return null
  }
}

export function isStyleTone(v: unknown): v is StyleTone {
  return typeof v === 'string' && STYLES.indexOf(v as StyleTone) >= 0
}
export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && LEVELS.indexOf(v as Level) >= 0
}
export function isVisual(v: unknown): v is Visual {
  return typeof v === 'string' && VISUALS.indexOf(v as Visual) >= 0
}

/** Что угодно → честные настройки: каждое поле по белому списку, мусор — умолчание. */
export function normalizePersona(v: unknown): Persona {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    style: isStyleTone(o.style) ? o.style : 'default',
    friendliness: isLevel(o.friendliness) ? o.friendliness : 'default',
    enthusiasm: isLevel(o.enthusiasm) ? o.enthusiasm : 'default',
    headers: isLevel(o.headers) ? o.headers : 'default',
    emoji: isLevel(o.emoji) ? o.emoji : 'default',
    quick: o.quick === true,
    visual: isVisual(o.visual) ? o.visual : 'default',
  }
}

/** Есть ли хоть одна не-умолчальная настройка: нет — поле в запрос не едет вовсе. */
export function isDefaultPersona(p: Persona): boolean {
  return (
    p.style === 'default' && p.friendliness === 'default' && p.enthusiasm === 'default'
    && p.headers === 'default' && p.emoji === 'default' && p.quick === false && p.visual === 'default'
  )
}

/** Защитник типа для usePersistentState: объект настроек с полями из белых списков. */
export function isPersona(v: unknown): v is Persona {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return isStyleTone(o.style) && isLevel(o.friendliness) && isLevel(o.enthusiasm)
    && isLevel(o.headers) && isLevel(o.emoji) && isVisual(o.visual)
}

/** Что стоит сейчас. Грязь в хранилище читается как умолчания, а не как ошибка. */
export function readPersona(s: Store | null = local()): Persona {
  if (!s) return DEFAULT_PERSONA
  try {
    const raw = s.getItem(PERSONA_KEY)
    if (raw === null) return DEFAULT_PERSONA
    return normalizePersona(JSON.parse(raw))
  } catch {
    return DEFAULT_PERSONA
  }
}

/** Запись настройки. Экран пишет через usePersistentState — тот же ключ и формат. */
export function writePersona(p: Persona, s: Store | null = local()): void {
  if (!s) return
  try {
    s.setItem(PERSONA_KEY, JSON.stringify(normalizePersona(p)))
  } catch {
    /* приватный режим или переполнение — настройка не критична */
  }
}

/**
 * Значение для тела запроса. Все умолчания — undefined: на сервере тогда нет ни
 * поля, ни блока в подсказке, и промпт остаётся ровно прежним.
 */
export function personaForRequest(p: Persona = readPersona()): Persona | undefined {
  return isDefaultPersona(p) ? undefined : p
}

/* ── Подписи для экрана — один источник для строк и всплывающих меню ───────── */

export const STYLE_CHOICES: { value: StyleTone; title: string; sub: string }[] = [
  { value: 'default', title: 'По умолчанию', sub: 'Предпочитаемый стиль и тон' },
  { value: 'professional', title: 'Профессиональный', sub: 'Тактичный и точный' },
  { value: 'friendly', title: 'Дружелюбный', sub: 'Тёплый и разговорчивый' },
  { value: 'candid', title: 'Откровенный', sub: 'Прямой и мотивирующий' },
  { value: 'quirky', title: 'Причудливый', sub: 'Весёлый и творческий' },
  { value: 'efficient', title: 'Эффективный', sub: 'Немногословный и чёткий' },
  { value: 'cynical', title: 'Циничный', sub: 'Критикующий и саркастичный' },
]

export const LEVEL_TITLES: Record<Level, string> = { more: 'Более', default: 'По умолчанию', less: 'Менее' }

export const VISUAL_CHOICES: { value: Visual; title: string; sub: string }[] = [
  { value: 'default', title: 'По умолчанию', sub: 'Картинки и графики — когда они к месту' },
  { value: 'simple', title: 'Простые', sub: 'Только текст, без картинок без просьбы' },
]
