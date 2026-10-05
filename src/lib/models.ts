/**
 * Каталог моделей для выбора в окне ввода.
 *
 * Список — витрина проверенных моделей по семействам ИИ (Google, Qwen, DeepSeek,
 * Mistral, OpenAI, Z.AI, Meta, Cohere) + живой каталог провайдеров (/api/models).
 * Каждый id — настоящий id из TABLE движка (engine/providers.js): пин в engine/chat.js
 * ищет провайдера, у которого такой id есть в пуле, и ведёт запрос именно к нему.
 */

export interface ModelAvatar {
  /** CSS-градиент фона. */
  bg: string
  /** Монограмма (1–2 символа). */
  mark: string
}

export type ReasoningEffort = 'low' | 'medium' | 'high'

export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Низкое',
  medium: 'Среднее',
  high: 'Высокое',
}

export interface GenParams {
  temperature: number
  /** 0 = Макс. (потолок самой модели), иначе 256..8192 */
  maxTokens: number
  topP: number
  /** -2..2, 0 = выключено. Положительное — реже повторяет уже сказанные темы целиком. */
  presencePenalty: number
  /** -2..2, 0 = выключено. Положительное — реже повторяет одни и те же слова/фразы. */
  frequencyPenalty: number
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  temperature: 1.0,
  maxTokens: 0,
  topP: 0.95,
  presencePenalty: 0,
  frequencyPenalty: 0,
}

export function isGenParams(v: unknown): v is GenParams {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.temperature === 'number' &&
    typeof o.maxTokens === 'number' &&
    typeof o.topP === 'number' &&
    /* поля появились в 0.070 — старое сохранённое состояние (до обновления) их не
       содержит, поэтому отсутствие трактуем как 0 (выключено), а не как брак данных */
    (o.presencePenalty === undefined || typeof o.presencePenalty === 'number') &&
    (o.frequencyPenalty === undefined || typeof o.frequencyPenalty === 'number')
  )
}

/** Старое сохранённое состояние (до 0.070) не несёт новых полей — подставляем нейтраль. */
export function withGenParamDefaults(p: GenParams): GenParams {
  return {
    ...p,
    presencePenalty: typeof p.presencePenalty === 'number' ? p.presencePenalty : 0,
    frequencyPenalty: typeof p.frequencyPenalty === 'number' ? p.frequencyPenalty : 0,
  }
}

export function isDefaultGenParams(p: GenParams): boolean {
  return (
    Math.abs(p.temperature - DEFAULT_GEN_PARAMS.temperature) < 0.01 &&
    p.maxTokens === DEFAULT_GEN_PARAMS.maxTokens &&
    Math.abs(p.topP - DEFAULT_GEN_PARAMS.topP) < 0.01 &&
    Math.abs((p.presencePenalty || 0) - DEFAULT_GEN_PARAMS.presencePenalty) < 0.01 &&
    Math.abs((p.frequencyPenalty || 0) - DEFAULT_GEN_PARAMS.frequencyPenalty) < 0.01
  )
}


export interface ModelOption {
  /** '' = Авто: движок сам выберет модель под задачу. */
  id: string
  name: string
  vendor: string
  desc: string
  avatar: ModelAvatar
  /** Слой скорости: fast — мгновенно, smart — глубже и медленнее. */
  tier: 'fast' | 'smart'
  /** Модель видит картинки — для значка «глаз» в списке. */
  vision?: boolean
  /** Размер контекстного окна в токенах. */
  ctx?: number
  /** Ориентировочная скорость генерации (токенов/сек). */
  tokPerSec?: number
  /** Лимит запросов в день (RPD). */
  rpd?: number
  /** Лимит запросов в минуту (RPM), если есть. */
  rpm?: number
  /** Поддерживает ли модель режим рассуждений («Думает»). */
  canThink?: boolean
  /** Поддерживает ли модель выбор усилия («Низкое / Среднее / Высокое»). */
  supportsEffort?: boolean
  /** Категория вендора для группировки в списке. */
  category?: string
}

const AV = (a: string, b: string, mark: string): ModelAvatar => ({
  bg: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
  mark,
})

export const MODEL_AUTO: ModelOption = {
  id: '',
  name: 'Авто',
  vendor: 'Ядро MeTiger',
  desc: 'Сам выберу лучшую модель под задачу: код, анализ, математика, картинки',
  avatar: AV('#F59E0B', '#EA580C', 'Me'),
  tier: 'fast',
  vision: true,
  ctx: 1048576,
  tokPerSec: 185,
  canThink: true,
  supportsEffort: true,
  category: 'MeTiger Ai',
}

export const MODELS: ModelOption[] = [
  /* ---------- Google Gemini ---------- */
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    vendor: 'Google',
    desc: 'Быстрая мультимодальная модель Google с окном 1M токенов и управляемым размышлением',
    avatar: AV('#4285F4', '#EA4335', '✦'),
    tier: 'fast',
    vision: true,
    ctx: 1048576,
    tokPerSec: 165,
    canThink: true,
    supportsEffort: true,
    category: 'Google',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    vendor: 'Google',
    desc: 'Сбалансированная модель Gemini для глубокого анализа, кода и работы с изображениями',
    avatar: AV('#4285F4', '#FBBC04', '✦'),
    tier: 'smart',
    vision: true,
    ctx: 1048576,
    tokPerSec: 155,
    canThink: true,
    supportsEffort: true,
    category: 'Google',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    vendor: 'Google',
    desc: 'Мгновенный ответ, контекст в миллион токенов и зрение',
    avatar: AV('#4285F4', '#9B72CB', '✦'),
    tier: 'fast',
    vision: true,
    ctx: 1048576,
    tokPerSec: 170,
    canThink: true,
    supportsEffort: true,
    category: 'Google',
  },
  {
    id: 'gemini-flash-lite-latest',
    name: 'Gemini Flash Lite',
    vendor: 'Google',
    desc: 'Ультра-быстрый режим без задержки на размышления: когда нужен мгновенный ответ',
    avatar: AV('#4285F4', '#34A853', 'L'),
    tier: 'fast',
    vision: true,
    ctx: 1048576,
    tokPerSec: 220,
    canThink: false,
    supportsEffort: false,
    category: 'Google',
  },

  /* ---------- Qwen (Alibaba) ---------- */
  {
    id: 'qwen/qwen3.8-max:free',
    name: 'Qwen3.8 Max (Free)',
    vendor: 'Qwen',
    desc: 'Флагманская модель Alibaba Qwen с глубоким рассуждением и контекстом 1M токенов',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'smart',
    ctx: 1048576,
    tokPerSec: 95,
    canThink: true,
    supportsEffort: true,
    category: 'Qwen',
  },
  {
    id: 'qwen/qwen3.8-omni-flash:free',
    name: 'Qwen3.8 Omni Flash (Free)',
    vendor: 'Qwen',
    desc: 'Мультимодальная модель Qwen3.8: видит картинки, быстро думает и пишет чистый код',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'fast',
    vision: true,
    ctx: 262144,
    tokPerSec: 145,
    canThink: true,
    supportsEffort: true,
    category: 'Qwen',
  },
  {
    id: 'qwen/qwen3.7-max:free',
    name: 'Qwen3.7 Max (Free)',
    vendor: 'Qwen',
    desc: 'Старшая модель линейки Qwen 3.7 для сложной логики, архитектуры и длинных текстов',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'smart',
    ctx: 262144,
    tokPerSec: 100,
    canThink: true,
    supportsEffort: true,
    category: 'Qwen',
  },
  {
    id: 'qwen/qwen3.5-plus:free',
    name: 'Qwen3.5 Plus (Free)',
    vendor: 'Qwen',
    desc: 'Надёжная универсальная модель Qwen с цепочкой рассуждений на русском и английском',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'smart',
    ctx: 262144,
    tokPerSec: 135,
    canThink: true,
    supportsEffort: true,
    category: 'Qwen',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    vendor: 'Qwen · Groq',
    desc: 'Самый быстрый Qwen на ускорителях Groq: зрение и рассуждение за доли секунды',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'fast',
    vision: true,
    ctx: 131072,
    tokPerSec: 240,
    canThink: true,
    supportsEffort: true,
    category: 'Qwen',
  },

  /* ---------- Cohere ---------- */
  {
    id: 'cohere/command-a-reasoning',
    name: 'Command A Reasoning',
    vendor: 'Cohere',
    desc: 'Флагман Cohere с глубоким пошаговым рассуждением, аналитикой и работой по источникам',
    avatar: AV('#3959CC', '#D97757', 'R'),
    tier: 'smart',
    ctx: 262144,
    tokPerSec: 110,
    canThink: true,
    supportsEffort: true,
    category: 'Cohere',
  },
  {
    id: 'cohere/command-r-plus-08-2024',
    name: 'Command R+',
    vendor: 'Cohere · реле Xkiro',
    desc: 'Длинные тексты, точные выжимки и работа по источникам',
    avatar: AV('#3959CC', '#0E0E0E', 'R'),
    tier: 'smart',
    ctx: 131072,
    tokPerSec: 95,
    canThink: false,
    supportsEffort: false,
    category: 'Cohere',
  },

  /* ---------- Mistral AI ---------- */
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large 3',
    vendor: 'Mistral',
    desc: 'Флагман Mistral AI: глубокий разбор документов, работа с изображениями и стилем',
    avatar: AV('#FF7000', '#C43E00', 'M'),
    tier: 'smart',
    vision: true,
    ctx: 131072,
    tokPerSec: 95,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },
  {
    id: 'mistralai/mistral-medium-3.5',
    name: 'Mistral Medium 3.5',
    vendor: 'Mistral',
    desc: 'Универсальная модель Mistral с поддержкой режима рассуждений',
    avatar: AV('#FF7000', '#EA580C', 'M'),
    tier: 'smart',
    ctx: 131072,
    tokPerSec: 120,
    canThink: true,
    supportsEffort: true,
    category: 'Mistral',
  },
  {
    id: 'mistralai/mistral-small-2603',
    name: 'Mistral Small 4',
    vendor: 'Mistral',
    desc: 'Быстрая сбалансированная модель Mistral 4-го поколения с режимом рассуждений',
    avatar: AV('#FF7000', '#F59E0B', 'M'),
    tier: 'fast',
    ctx: 131072,
    tokPerSec: 150,
    canThink: true,
    supportsEffort: true,
    category: 'Mistral',
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    vendor: 'Mistral',
    desc: 'Специализированная модель для кода: генерация, рефакторинг, тесты и ревью',
    avatar: AV('#FF7000', '#F2A93B', '</>'),
    tier: 'smart',
    ctx: 262144,
    tokPerSec: 160,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },
  {
    id: 'mistralai/devstral-medium',
    name: 'Devstral 2',
    vendor: 'Mistral',
    desc: 'Инженерная модель Mistral для архитектуры проектов и отладки сложных багов',
    avatar: AV('#FF7000', '#D97706', 'D'),
    tier: 'smart',
    ctx: 131072,
    tokPerSec: 135,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },
  {
    id: 'ministral-14b-2512',
    name: 'Ministral 3 14B',
    vendor: 'Mistral',
    desc: 'Старшая модель линейки Ministral 3: быстрый точный ответ без воды',
    avatar: AV('#FAF0DD', '#FF7000', 'M'),
    tier: 'fast',
    ctx: 131072,
    tokPerSec: 165,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },
  {
    id: 'ministral-8b-2512',
    name: 'Ministral 3 8B',
    vendor: 'Mistral',
    desc: 'Компактная быстрая модель Mistral: коротко, по делу, без лишней воды',
    avatar: AV('#FAF0DD', '#FF7000', 'M'),
    tier: 'fast',
    ctx: 131072,
    tokPerSec: 185,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },
  {
    id: 'ministral-3b-2512',
    name: 'Ministral 3 3B',
    vendor: 'Mistral',
    desc: 'Сверхлёгкая модель Mistral 3B для мгновенных ответов',
    avatar: AV('#FAF0DD', '#FF7000', 'M'),
    tier: 'fast',
    ctx: 131072,
    tokPerSec: 220,
    canThink: false,
    supportsEffort: false,
    category: 'Mistral',
  },

  /* ---------- OpenAI / Другие ---------- */
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    vendor: 'OpenAI · Groq',
    desc: 'Открытая модель OpenAI на ускорителях Groq с настраиваемым усилием рассуждения',
    avatar: AV('#10A37F', '#0E8C6C', '○'),
    tier: 'fast',
    ctx: 131072,
    tokPerSec: 260,
    canThink: true,
    supportsEffort: true,
    category: 'OpenAI',
  },
  {
    id: 'meituan/longcat-2.5-preview:free',
    name: 'LongCat 2.5',
    vendor: 'Meituan · реле Xkiro',
    desc: 'Миллион токенов контекста и вызов инструментов',
    avatar: AV('#2E90FA', '#12B5A5', 'C'),
    tier: 'smart',
    ctx: 1048576,
    tokPerSec: 120,
    canThink: false,
    supportsEffort: false,
    category: 'Другие',
  },
]

const ALL: ModelOption[] = [MODEL_AUTO, ...MODELS]

/**
 * Умеет ли модель думать («Думает»).
 * Если модель думать не умеет (например, Codestral, Ministral, Mistral Large 3,
 * Gemini Flash Lite, Command R+), переключатель «Думает» и выбор «Усилие» скрываются.
 */
export function canModelThink(
  id?: string,
  meta?: { canThink?: boolean; reasoning?: boolean; canExcludeReasoning?: boolean },
): boolean {
  if (!id) return true // Авто (Ядро MeTiger) умеет думать
  if (meta && typeof meta.canThink === 'boolean') return meta.canThink
  if (meta && (meta.reasoning === true || meta.canExcludeReasoning === true)) return true
  const s = id.toLowerCase()
  if (/flash-lite|codestral|devstral|ministral|mistral-large|command-r|longcat|llama-3\.[12]|granite/.test(s)) {
    return false
  }
  return /(gemini-(?:2\.5|3)|qwen3|qwen-3|qwq|deepseek|gpt-oss|\bo1\b|\bo3\b|\bo4\b|glm-(?:4\.7|5)|mistral-medium|mistral-small-(?:4|26)|magistral|reasoning|thinking|think|r1-|nex-n2\.5-pro|dots-3)/.test(
    s,
  )
}

/** Поддерживает ли модель выбор усилия рассуждения (Низкое / Среднее / Высокое). */
export function canModelEffort(
  id?: string,
  meta?: { canThink?: boolean; supportsEffort?: boolean; reasoning?: boolean; canExcludeReasoning?: boolean },
): boolean {
  if (!canModelThink(id, meta)) return false
  if (meta && typeof meta.supportsEffort === 'boolean') return meta.supportsEffort
  return true
}

/** Определяет категорию ИИ-семейства для группировки моделей. */
export function vendorCategory(id?: string, vendor?: string, name?: string): string {
  if (!id) return 'MeTiger Ai'
  const s = `${id} ${vendor || ''} ${name || ''}`.toLowerCase()
  if (/gemini|gemma|\bgoogle\b/.test(s)) return 'Google'
  if (/qwen|qwq|alibaba|tongyi/.test(s)) return 'Qwen'
  if (/deepseek/.test(s)) return 'DeepSeek'
  if (/mistral|ministral|codestral|devstral|pixtral|magistral/.test(s)) return 'Mistral'
  if (/openai|gpt-oss|\bgpt\b|\bo1\b|\bo3\b|\bo4\b/.test(s)) return 'OpenAI'
  if (/claude|anthropic/.test(s)) return 'Anthropic'
  if (/grok|\bxai\b|x\.ai/.test(s)) return 'xAI'
  if (/\bglm\b|\bzai\b|z\.ai|z-ai|zhipu/.test(s)) return 'Z.AI'
  if (/llama|\bmeta\b/.test(s)) return 'Meta'
  if (/cohere|command-r|\bnorth\b/.test(s)) return 'Cohere'
  if (/nemotron|nvidia/.test(s)) return 'Nvidia'
  const clean = String(vendor || '').split('·')[0].trim()
  return clean || 'Другие'
}

/** Форматирует контекстное окно в виде «1M Контекст», «128K Контекст». */
export function formatContextBadge(ctx?: number): string {
  const n = Number(ctx) || 131072
  if (n >= 1000000) {
    const m = Math.round((n / 1000000) * 10) / 10
    return `${m >= 1 && n >= 1000000 ? Math.round(n / 1000000) || 1 : m}M Контекст`
  }
  if (n >= 1024) {
    return `${Math.round(n / 1024)}K Контекст`
  }
  return `${n} Контекст`
}

/* ==================== Счётчик запросов (в день / в минуту) и скорость (ток/с) ==================== */

export interface ModelTelemetryEntry {
  requests: number
  day?: string
  dayCount?: number
  minStamps?: number[]
  tokPerSec?: number
}

const TELEMETRY_KEY = 'mt-model-telemetry'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Определяет лимиты запросов в день и в минуту по модели и источнику (engine/providers.js). */
export function modelLimitsFor(
  id?: string,
  src?: string,
  meta?: { rpd?: number; rpm?: number },
): { rpd: number; rpm?: number } {
  if (meta?.rpd) return { rpd: meta.rpd, rpm: meta.rpm }
  if (!id) return { rpd: 5000, rpm: 60 }
  const s = `${id} ${src || ''}`.toLowerCase()
  if (/gemini|gemma/.test(s) && src !== 'odirouter') return { rpd: 250, rpm: 15 }
  if (src === 'groq' || /gpt-oss|qwen3\.8-27b/.test(s)) return { rpd: 1000, rpm: 30 }
  if (src === 'openrouter') return { rpd: 50, rpm: 20 }
  if (src === 'cerebras') return { rpd: 900, rpm: 30 }
  if (src === 'odirouter') return { rpd: 1000, rpm: 15 }
  if (src === 'zai' || /\bglm\b/.test(s)) return { rpd: 1000, rpm: 30 }
  if (src === 'mistral' || /ministral|codestral|devstral|mistral/.test(s)) return { rpd: 1000, rpm: 60 }
  return { rpd: 1000, rpm: 60 }
}

function readTelemetryMap(): Record<string, ModelTelemetryEntry> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(TELEMETRY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function getModelTelemetry(
  id: string,
  fallbackTps?: number,
  src?: string,
  meta?: { rpd?: number; rpm?: number },
): {
  requests: number
  dayUsed: number
  minUsed: number
  rpd: number
  rpm?: number
  quotaLabel: string
  totalRequests: number
  tokPerSec: number
} {
  const map = readTelemetryMap()
  const key = id || '_auto'
  const entry = map[key]
  const total = map._total?.requests || 0
  const today = todayIso()
  const dayUsed = entry?.day === today ? entry?.dayCount || 0 : 0
  const now = Date.now()
  const minUsed = Array.isArray(entry?.minStamps)
    ? entry.minStamps.filter((t) => now - t < 60_000).length
    : 0
  const { rpd, rpm } = modelLimitsFor(id, src, meta)
  const dayPart = dayUsed > 0 ? `${dayUsed}/${rpd} в день` : `${rpd}/день`
  const minPart = rpm ? (minUsed > 0 ? `${minUsed}/${rpm} в мин` : `${rpm}/мин`) : ''
  const quotaLabel = [dayPart, minPart].filter(Boolean).join(' · ')
  return {
    requests: entry?.requests || 0,
    dayUsed,
    minUsed,
    rpd,
    rpm,
    quotaLabel,
    totalRequests: total,
    tokPerSec: entry?.tokPerSec || fallbackTps || 135,
  }
}

export function recordModelTelemetry(id: string | undefined, ms?: number, chars?: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    const map = readTelemetryMap()
    const key = id || '_auto'
    const prev = map[key] || { requests: 0 }
    const today = todayIso()
    const now = Date.now()
    const dayCount = (prev.day === today ? prev.dayCount || 0 : 0) + 1
    const minStamps = (Array.isArray(prev.minStamps) ? prev.minStamps.filter((t) => now - t < 60_000) : []).concat(now)
    let tps = prev.tokPerSec
    if (ms && ms > 100 && chars && chars > 12) {
      const estTokens = Math.max(4, Math.round(chars / 3.3))
      const measured = Math.min(450, Math.max(15, Math.round((estTokens * 1000) / ms)))
      tps = prev.tokPerSec ? Math.round(prev.tokPerSec * 0.6 + measured * 0.4) : measured
    }
    map[key] = {
      requests: (prev.requests || 0) + 1,
      day: today,
      dayCount,
      minStamps,
      ...(tps ? { tokPerSec: tps } : {}),
    }
    const totalPrev = map._total?.requests || 0
    map._total = { requests: totalPrev + 1, ...(tps ? { tokPerSec: tps } : {}) }
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(map))
  } catch {
    // ignore quota/SSR errors
  }
}

/* ==================== живой каталог (GET /api/models) ==================== */

/** Строка каталога — то же, что отдаёт functions/api/models.js. */
export interface CatalogEntry {
  id: string
  name: string
  vendor: string
  tier?: 'fast' | 'smart'
  /** true — видит картинки, false — не видит, null/undefined — не знаем. */
  vision?: boolean | null
  ctx?: number
  maxOut?: number
  /** id есть в пулах движка: её он сам подставит в ротацию. */
  curated?: boolean
  /** откуда взята: openrouter | xkiro | pool. */
  src?: string
  desc?: string
  uncensored?: boolean
  /** провайдер сам сказал, что модель бесплатна (иначе — цена в списке не указана) */
  priceKnown?: boolean
  /** умеет рассуждать / принимать инструменты — по данным самого провайдера */
  reasoning?: boolean
  canExcludeReasoning?: boolean
  tools?: boolean
  /** чем провайдер предлагает заменить снятую модель */
  replaces?: string
  /** рейтинг смелых: как модель вела себя на темах, где обычно включают фильтр */
  brave?: { ok: number; refused: number; total: number; score: number; provider?: string }
}

/**
 * Что рейтинг говорит словами. Порог 2/3 и 1/3 — те же, по которым движок
 * переставляет пул: «уверенно везёт», «упирается», «на грани» (у последней
 * строки смысла в бейдже нет, поэтому её не возвращаем).
 */
export function braveLine(m: CatalogEntry): string {
  const b = m.brave
  if (!b || !b.total) return ''
  if (b.score >= 0.67) return `везёт без отказа ${Math.round(b.ok)}/${Math.round(b.total)}`
  if (b.score <= 0.33) return `упирается ${Math.round(b.refused)}/${Math.round(b.total)}`
  return ''
}

/**
 * Чьё это: каталожная строка знает источник, и человеку важно видеть, что
 * `mistral-medium-latest` — это Mistral, а не «какая-то модель из списка».
 */
export const PROVIDER_LABEL: Record<string, string> = {
  openrouter: 'OpenRouter',
  xkiro: 'Xкиро',
  groq: 'Groq',
  mistral: 'Mistral',
  gemini: 'Gemini',
  zai: 'Z.AI',
  cerebras: 'Cerebras',
  cloudflare: 'Workers AI',
  odirouter: 'OdiRouter',
  sharellm: 'ShareLLM',
  atria: 'Atria',
  local: 'локально',
  pool: 'наши пулы',
}

export function providerLabel(src?: string): string {
  if (!src) return ''
  return PROVIDER_LABEL[src] || src.toUpperCase()
}

export interface ModelCatalog {
  models: CatalogEntry[]
  updatedAt: number | null
  /** каталог протух и обновится при следующем удобном случае */
  stale: boolean
  count: number
  /** сколько строк дал живой каталог (0 — сеть молчала, видны только пулы) */
  catalogCount: number
  /** чьи собственные списки прочитаны в этом обновлении */
  read?: Record<string, boolean> | null
  pools?: { provider: string; label: string; count: number }[]
}

let LAST: ModelCatalog | null = null
let INFLIGHT: Promise<ModelCatalog | null> | null = null

export function catalogCache(): ModelCatalog | null {
  return LAST
}

/**
 * Список моделей для окна выбора. Ошибка сети не показывается человеку:
 * тогда остаются вручную проверенные строки витрины, и выбор работает как раньше.
 */
export async function loadCatalog(opts: { force?: boolean } = {}): Promise<ModelCatalog | null> {
  if (LAST && !opts.force) return LAST
  if (INFLIGHT && !opts.force) return INFLIGHT
  INFLIGHT = (async () => {
    try {
      const init: RequestInit = {}
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        init.signal = AbortSignal.timeout(4000)
      }
      const r = await fetch('/api/models' + (opts.force ? '?refresh=1' : ''), init)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const d = (await r.json()) as Partial<ModelCatalog> & { models?: CatalogEntry[] }
      const models = Array.isArray(d.models) ? d.models : []
      if (!models.length) throw new Error('пустой список')
      LAST = {
        models,
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : null,
        stale: !!d.stale,
        count: typeof d.count === 'number' ? d.count : models.length,
        catalogCount: typeof d.catalogCount === 'number' ? d.catalogCount : 0,
      }
      return LAST
    } catch {
      return LAST
    } finally {
      INFLIGHT = null
    }
  })()
  return INFLIGHT
}

/** Принудительно перечитать каталог у провайдеров (кнопка «обновить»). */
export async function refreshCatalog(): Promise<ModelCatalog | null> {
  LAST = null
  return loadCatalog({ force: true })
}

export function catalogEntry(id: string): CatalogEntry | undefined {
  if (!LAST) return undefined
  return LAST.models.find((m) => m.id === id)
}

/** Похоже на id модели? Нужно, чтобы выбор из каталога переживал перезагрузку. */
const ID_SHAPE = /^[A-Za-z0-9][\w./:@-]{2,63}$/
export function looksLikeModelId(value: unknown): value is string {
  return typeof value === 'string' && ID_SHAPE.test(value)
}

const PALETTE = [
  ['#4285F4', '#9B72CB'], ['#F59E0B', '#EA580C'], ['#10B981', '#047857'],
  ['#8B5CF6', '#4C1D95'], ['#EC4899', '#9D174D'], ['#06B6D4', '#0E7490'],
  ['#84CC16', '#3F6212'], ['#F97316', '#B91C1C'],
]

/**
 * Аватарка каталожной модели: цвет по вендору, монограмма из имени.
 */
export function avatarFor(m: CatalogEntry): ModelAvatar {
  const v = String(m.vendor || m.id)
  let h = 0
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0
  const [a, b] = PALETTE[h % PALETTE.length]
  const letters = String(m.name || m.id).replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/)
  const mark = (letters[0] || '?').slice(0, 1).toUpperCase() + (letters[1] ? letters[1].slice(0, 1).toUpperCase() : '')
  return { bg: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`, mark: mark || '?' }
}

/** Потолки одной строкой: человек выбирает модель и видит, на что способен потолок. */
export function ceilingsLine(m: CatalogEntry): string {
  const kb = (n?: number) => (n ? (n >= 1024 ? Math.round(n / 1024) + 'К' : String(n)) : '')
  const ctx = kb(m.ctx)
  const out = kb(m.maxOut)
  if (!ctx && !out) return ''
  if (ctx && out) return `контекст ${ctx} · ответ до ${out}`
  return ctx ? `контекст ${ctx}` : `ответ до ${out}`
}

/**
 * Найти опцию по id. Неизвестный витрине id больше не «Авто»: если он есть в
 * живом каталоге, показываем его имя — иначе человек выбрал модель, а чип
 * врал бы, что выбор не сработал.
 */
export function modelOption(id: string | undefined | null): ModelOption {
  const key = id || ''
  const mine = ALL.find((m) => m.id === key)
  if (mine) return mine
  const c = catalogEntry(key)
  if (!c) return MODEL_AUTO
  const av = avatarFor(c)
  const ceil = ceilingsLine(c)
  const think = canModelThink(c.id, c)
  return {
    id: c.id,
    name: c.name || c.id,
    vendor: c.vendor || '',
    desc: c.desc || ceil || 'из каталога',
    avatar: av,
    tier: c.tier === 'smart' ? 'smart' : 'fast',
    vision: c.vision === true,
    ctx: c.ctx || 131072,
    tokPerSec: c.src === 'groq' || c.src === 'cerebras' ? 240 : c.tier === 'smart' ? 105 : 150,
    canThink: think,
    supportsEffort: canModelEffort(c.id, c),
    category: vendorCategory(c.id, c.vendor, c.name),
  }
}

/** Валидация для usePersistentState: известные витрине + живой каталог + формат id. */
export function isModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (ALL.some((m) => m.id === value)) return true
  if (catalogEntry(value)) return true
  return looksLikeModelId(value)
}
