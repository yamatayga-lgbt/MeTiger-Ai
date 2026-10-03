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

/* Витрина в окне выбора: только те имена, которые движок отдаёт под своим именем.
   Это измеряется, а не угадывается — `node scripts/models-probe.mjs --all`, снимок в
   `engine/models-verified.js`. Сюда попадают бесплатные пулы gemini/groq/mistral и реле с
   бесплатной маркировкой `:free`; всё, что провайдер объявляет у себя в `/models`, но на
   запрос отвечает другой моделью («Claude Opus 4.8», «GLM 5.3», «GPT 6 Astra» и ещё около
   150 имён), с витрины снято: выбор модели не должен быть лотереей. */
export const MODELS: ModelOption[] = [
  /* ---------- Быстрые: ответ в секунды, короткие задачи ---------- */
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    vendor: 'Google',
    desc: 'Мгновенный ответ, контекст в миллион токенов',
    avatar: AV('#4285F4', '#9B72CB', '✦'),
    tier: 'fast',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    vendor: 'Alibaba · Groq',
    desc: 'Самый быстрый из умеющих смотреть на картинку',
    avatar: AV('#615CED', '#8E86FF', 'Q'),
    tier: 'fast',
    vision: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    vendor: 'OpenAI · Groq',
    desc: 'Открытая модель OpenAI: факты и короткие задачи',
    avatar: AV('#10A37F', '#0E8C6C', '○'),
    tier: 'fast',
  },
  {
    id: 'ministral-8b-2512',
    name: 'Ministral 8B',
    vendor: 'Mistral AI',
    desc: 'Коротко, по делу, зовёт инструменты',
    avatar: AV('#FAF0DD', '#FF7000', 'M'),
    tier: 'fast',
  },
  {
    id: 'gemini-flash-lite-latest',
    name: 'Gemini Flash Lite',
    vendor: 'Google',
    desc: 'Когда нужен ответ, а не разбор',
    avatar: AV('#4285F4', '#34A853', 'L'),
    tier: 'fast',
  },

  /* ---------- Умные: глубокий разбор, сложные задачи ---------- */
  {
    id: 'codestral-latest',
    name: 'Codestral',
    vendor: 'Mistral AI',
    desc: 'Код: правки, объяснение чужого, ревью',
    avatar: AV('#FF7000', '#F2A93B', '</>'),
    tier: 'smart',
  },
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large',
    vendor: 'Mistral · реле Xkiro',
    desc: 'Тяжёлый разбор и картинки; идёт через реле',
    avatar: AV('#FF7000', '#C43E00', 'M'),
    tier: 'smart',
    vision: true,
  },
  {
    id: 'meituan/longcat-2.5-preview:free',
    name: 'LongCat 2.5',
    vendor: 'Meituan · реле Xkiro',
    desc: 'Миллион токенов контекста, инструменты',
    avatar: AV('#2E90FA', '#12B5A5', 'C'),
    tier: 'smart',
  },
  {
    id: 'cohere/command-r-plus-08-2024',
    name: 'Command R+',
    vendor: 'Cohere · реле Xkiro',
    desc: 'Длинные тексты, выжимки, цитаты из них',
    avatar: AV('#3959CC', '#0E0E0E', 'R'),
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
  /** провайдер сам сказал, что модель бесплатна (иначе — цена в списке не указана) */
  priceKnown?: boolean
  /** умеет рассуждать / принимать инструменты — по данным самого провайдера */
  reasoning?: boolean
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
