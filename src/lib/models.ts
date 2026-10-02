/**
 * Каталог моделей для выбора в окне ввода.
 *
 * Список — не все 100+ строк из пулов движка, а витрина: те имена, которые
 * человек узнаёт. Каждый id — настоящий id из TABLE движка (engine/providers.js):
 * пин в engine/chat.js ищет провайдера, у которого такой id есть в пуле, и ведёт
 * запрос именно к нему. Незнакомый/устаревший id молча снимается — работает авто-режим.
 *
 * Аватарки — CSS-градиент + монограмма: без картинок, чтобы список грузился
 * мгновенно и одинаково выглядел и в Telegram-вебвью, и в браузере.
 */

export interface ModelAvatar {
  /** CSS-градиент фона. */
  bg: string
  /** Монограмма (1–2 символа). */
  mark: string
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
}

const AV = (a: string, b: string, mark: string): ModelAvatar => ({
  bg: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
  mark,
})

export const MODEL_AUTO: ModelOption = {
  id: '',
  name: 'Авто',
  vendor: 'Ядро MeTiger',
  desc: 'Сам выберу модель под задачу: код, анализ, картинки',
  avatar: AV('#F59E0B', '#EA580C', 'Me'),
  tier: 'fast',
}

export const MODELS: ModelOption[] = [
  /* ---------- Быстрые: ответ в секунды, короткие задачи ---------- */
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    vendor: 'Google',
    desc: 'Мгновенный ответ, видит картинки',
    avatar: AV('#4285F4', '#9B72CB', '✦'),
    tier: 'fast',
    vision: true,
  },
  {
    id: 'free-gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    vendor: 'Google',
    desc: 'Скорость и свежие версии',
    avatar: AV('#7DD3FC', '#4285F4', '✦'),
    tier: 'fast',
    vision: true,
  },
  {
    id: 'free-claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    vendor: 'Anthropic',
    desc: 'Лёгкий Claude — быстрые правки и вопросы',
    avatar: AV('#E7A084', '#D97757', 'Ha'),
    tier: 'fast',
  },
  {
    id: 'qwen/qwen3.7-flash:free',
    name: 'Qwen 3.7 Flash',
    vendor: 'Alibaba',
    desc: 'Прыть в коде и переводах',
    avatar: AV('#A78BFA', '#7C3AED', 'Qw'),
    tier: 'fast',
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM 4.7 Flash',
    vendor: 'Z.AI',
    desc: 'Быстрые рассуждения без пауз',
    avatar: AV('#38BDF8', '#0284C7', 'GL'),
    tier: 'fast',
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    vendor: 'OpenAI',
    desc: 'Открытая GPT, быстрый код',
    avatar: AV('#34D399', '#0F766E', 'OS'),
    tier: 'fast',
  },
  {
    id: 'ministral-8b-2512',
    name: 'Ministral 8B',
    vendor: 'Mistral AI',
    desc: 'Маленький и экономный',
    avatar: AV('#FB923C', '#EA580C', 'Ms'),
    tier: 'fast',
  },
  {
    id: 'minimax/minimax-m2.7-highspeed:free',
    name: 'MiniMax M2.7',
    vendor: 'MiniMax',
    desc: 'Высокоскоростной режим',
    avatar: AV('#F87171', '#DC2626', 'MM'),
    tier: 'fast',
  },

  /* ---------- Умные: глубокий разбор, сложные задачи ---------- */
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    vendor: 'Anthropic',
    desc: 'Баланс разума и скорости — тексты, код, разбор',
    avatar: AV('#D97757', '#B4532F', 'Cl'),
    tier: 'smart',
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    desc: 'Самый глубокий разбор и длинные задачи',
    avatar: AV('#C2410C', '#7C2D12', 'Op'),
    tier: 'smart',
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    vendor: 'OpenAI',
    desc: 'Универсальный: рассуждения, код, драфты',
    avatar: AV('#10A37F', '#0B7A5E', 'GP'),
    tier: 'smart',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    vendor: 'Google',
    desc: 'Сильный на фактах и длинном контексте',
    avatar: AV('#1A73E8', '#7C4DFF', '✦'),
    tier: 'smart',
    vision: true,
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    vendor: 'xAI',
    desc: 'Прямой стиль, актуальные темы',
    avatar: AV('#334155', '#0F172A', 'X'),
    tier: 'smart',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    desc: 'Математика, алгоритмы, строгий код',
    avatar: AV('#2563EB', '#1E3A8A', 'DS'),
    tier: 'smart',
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen 3.8 Max',
    vendor: 'Alibaba',
    desc: 'Многоязычный, силён в коде',
    avatar: AV('#7C3AED', '#5B21B6', 'Qw'),
    tier: 'smart',
  },
  {
    id: 'glm-5.3',
    name: 'GLM 5.3',
    vendor: 'Z.AI',
    desc: 'Рассуждения и структурные ответы',
    avatar: AV('#0EA5E9', '#0369A1', 'GL'),
    tier: 'smart',
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    vendor: 'Moonshot',
    desc: 'Длинные тексты и документы',
    avatar: AV('#4C1D95', '#1E1B4B', 'Ki'),
    tier: 'smart',
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    vendor: 'MiniMax',
    desc: 'Креатив и глубокие драфты',
    avatar: AV('#EF4444', '#991B1B', 'MM'),
    tier: 'smart',
  },
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large',
    vendor: 'Mistral AI',
    desc: 'Европейская классика, аккуратный язык',
    avatar: AV('#FF7000', '#C2410C', 'Mi'),
    tier: 'smart',
  },
]

const ALL: ModelOption[] = [MODEL_AUTO, ...MODELS]


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
}

export interface ModelCatalog {
  models: CatalogEntry[]
  updatedAt: number | null
  /** каталог протух и обновится при следующем удобном случае */
  stale: boolean
  count: number
  /** сколько строк дал живой каталог (0 — сеть молчала, видны только пулы) */
  catalogCount: number
}

let LAST: ModelCatalog | null = null
let INFLIGHT: Promise<ModelCatalog | null> | null = null

export function catalogCache(): ModelCatalog | null {
  return LAST
}

/**
 * Список моделей для окна выбора. Ошибка сети не показывается человеку:
 * тогда остаются вручную проверенные 19 строк, и выбор работает как раньше.
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
 * Аватарка каталожной модели: цвет по вендору (у одного вендора всегда один
 * градиент), монограмма из имени. Картинок не заводим — список из 180 строк
 * должен открываться мгновенно.
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
 * врал бы, что выбор не сработал. Совсем незнакомого id не бывает: движок
 * сам снимает пин, и чип честно остаётся «Авто».
 */
export function modelOption(id: string | undefined | null): ModelOption {
  const key = id || ''
  const mine = ALL.find((m) => m.id === key)
  if (mine) return mine
  const c = catalogEntry(key)
  if (!c) return MODEL_AUTO
  const av = avatarFor(c)
  const ceil = ceilingsLine(c)
  return {
    id: c.id,
    name: c.name || c.id,
    vendor: c.vendor || '',
    desc: ceil || 'из каталога',
    avatar: av,
    tier: c.tier === 'smart' ? 'smart' : 'fast',
    vision: c.vision === true,
  }
}

/** Валидация для usePersistentState: известные витрине + живой каталог + формат id. */
export function isModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (ALL.some((m) => m.id === value)) return true
  if (catalogEntry(value)) return true
  /* id мог прийти из каталога в прошлый раз, а кэш ещё пуст — терять выбор из-за
     этого нельзя: движок сам решит, снимать пин или нет. */
  return looksLikeModelId(value)
}
