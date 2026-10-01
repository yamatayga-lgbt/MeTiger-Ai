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

/** Найти опцию по id; незнакомый id → Авто (как и поведение движка). */
export function modelOption(id: string | undefined | null): ModelOption {
  return ALL.find((m) => m.id === (id || '')) || MODEL_AUTO
}

/** Валидация для usePersistentState: сохраняем только известные id. */
export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && ALL.some((m) => m.id === value)
}
