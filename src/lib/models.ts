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
}

export const MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    vendor: 'Anthropic',
    desc: 'Баланс разума и скорости — тексты, код, разбор',
    avatar: AV('#D97757', '#B4532F', 'Cl'),
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    desc: 'Самый глубокий разбор и длинные задачи',
    avatar: AV('#C2410C', '#7C2D12', 'Op'),
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    vendor: 'OpenAI',
    desc: 'Универсальный: рассуждения, код, драфты',
    avatar: AV('#10A37F', '#0B7A5E', 'GP'),
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    vendor: 'Google',
    desc: 'Очень быстрый, видит картинки',
    avatar: AV('#4285F4', '#9B72CB', '✦'),
    vision: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    vendor: 'Google',
    desc: 'Сильный на фактах и длинном контексте',
    avatar: AV('#1A73E8', '#7C4DFF', '✦'),
    vision: true,
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    vendor: 'xAI',
    desc: 'Прямой стиль, актуальные темы',
    avatar: AV('#334155', '#0F172A', 'X'),
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    desc: 'Математика, алгоритмы, строгий код',
    avatar: AV('#2563EB', '#1E3A8A', 'DS'),
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen 3.8 Max',
    vendor: 'Alibaba',
    desc: 'Многоязычный, силён в коде',
    avatar: AV('#7C3AED', '#5B21B6', 'Qw'),
  },
  {
    id: 'glm-5.3',
    name: 'GLM 5.3',
    vendor: 'Z.AI',
    desc: 'Рассуждения и структурные ответы',
    avatar: AV('#0EA5E9', '#0369A1', 'GL'),
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    vendor: 'Moonshot',
    desc: 'Длинные тексты и документы',
    avatar: AV('#4C1D95', '#1E1B4B', 'Ki'),
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    vendor: 'MiniMax',
    desc: 'Креатив и быстрые драфты',
    avatar: AV('#EF4444', '#991B1B', 'MM'),
  },
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large',
    vendor: 'Mistral AI',
    desc: 'Европейская классика, аккуратный язык',
    avatar: AV('#FF7000', '#C2410C', 'Mi'),
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
