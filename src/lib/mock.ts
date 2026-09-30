/* ============================================================
   Демо-данные дизайн-превью MeTiger Ai.
   Позже здесь будет подключение к API агентов и инструментов.
   ============================================================ */

export interface AgentCardData {
  id: string
  name: string
  desc: string
  icon: 'sparkles' | 'code' | 'search' | 'palette' | 'chart' | 'languages'
  tone: 'accent' | 'blue' | 'green' | 'gray'
  status: 'active' | 'draft' | 'soon'
  model: string
  runs: string
}

export const AGENTS: AgentCardData[] = [
  {
    id: 'universal',
    name: 'Универсал',
    desc: 'Любые задачи: тексты, идеи, анализ и ответы на вопросы.',
    icon: 'sparkles',
    tone: 'accent',
    status: 'active',
    model: 'MeTiger Pro',
    runs: '12.4k',
  },
  {
    id: 'coder',
    name: 'Кодер',
    desc: 'Пишет и ревьюит код, находит баги, объясняет архитектуру.',
    icon: 'code',
    tone: 'blue',
    status: 'active',
    model: 'MeTiger Pro',
    runs: '8.1k',
  },
  {
    id: 'researcher',
    name: 'Исследователь',
    desc: 'Глубокий поиск, сравнение источников и короткие выжимки.',
    icon: 'search',
    tone: 'green',
    status: 'active',
    model: 'MeTiger Flash',
    runs: '5.6k',
  },
  {
    id: 'designer',
    name: 'Дизайнер',
    desc: 'Интерфейсы, макеты, визуал и фирменный стиль.',
    icon: 'palette',
    tone: 'accent',
    status: 'draft',
    model: 'MeTiger Pro',
    runs: '—',
  },
  {
    id: 'analyst',
    name: 'Аналитик',
    desc: 'Данные, таблицы, отчёты и цифры без хаоса.',
    icon: 'chart',
    tone: 'gray',
    status: 'soon',
    model: 'MeTiger Pro',
    runs: '—',
  },
  {
    id: 'translator',
    name: 'Переводчик',
    desc: 'Переводы с сохранением смысла, стиля и тона.',
    icon: 'languages',
    tone: 'gray',
    status: 'soon',
    model: 'MeTiger Flash',
    runs: '—',
  },
]

export interface ToolData {
  id: string
  name: string
  desc: string
  icon: 'globe' | 'image' | 'file' | 'terminal' | 'brain' | 'mic' | 'mail'
  enabled: boolean
  available: boolean
}

export const TOOLS: ToolData[] = [
  {
    id: 'web-search',
    name: 'Поиск в интернете',
    desc: 'Свежие данные и источники с ссылками.',
    icon: 'globe',
    enabled: true,
    available: true,
  },
  {
    id: 'image-gen',
    name: 'Генерация изображений',
    desc: 'Картинки, иллюстрации и визуал по описанию.',
    icon: 'image',
    enabled: true,
    available: true,
  },
  {
    id: 'files',
    name: 'Работа с файлами',
    desc: 'PDF, таблицы, документы и извлечение данных.',
    icon: 'file',
    enabled: true,
    available: true,
  },
  {
    id: 'code-runner',
    name: 'Python-песочница',
    desc: 'Выполнение кода и вычисления в изолированной среде.',
    icon: 'terminal',
    enabled: false,
    available: false,
  },
  {
    id: 'memory',
    name: 'Память агента',
    desc: 'Контекст прошлых диалогов и персональные настройки.',
    icon: 'brain',
    enabled: false,
    available: false,
  },
  {
    id: 'voice',
    name: 'Голосовой ввод',
    desc: 'Распознавание голосовых сообщений и ответ голосом.',
    icon: 'mic',
    enabled: false,
    available: false,
  },
  {
    id: 'mail',
    name: 'Почта и уведомления',
    desc: 'Отправка писем и уведомлений по расписанию.',
    icon: 'mail',
    enabled: false,
    available: false,
  },
]

export const SUGGESTIONS = [
  { icon: 'pen', text: 'Напиши пост для соцсетей' },
  { icon: 'code', text: 'Объясни, как работает этот код' },
  { icon: 'image', text: 'Сделай логотип для проекта' },
  { icon: 'calendar', text: 'Спланируй мне неделю' },
]

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const REPLIES: { match: RegExp; text: string }[] = [
  {
    match: /привет|здравств|хай|hello|hi/i,
    text: 'Привет! Я MeTiger Ai — ваш универсальный агент.\n\nПомогу с текстами, кодом, идеями, анализом и многим другим. Спросите что угодно — или выберите подсказку ниже.',
  },
  {
    match: /код|code|функци|python|javascript|typescript|react/i,
    text: 'Конечно! Вот пример чистой функции с проверкой входных данных:\n\n```typescript\nexport function formatPrice(value: number, currency = \"RUB\"): string {\n  if (!Number.isFinite(value)) throw new Error(\"Invalid value\")\n  return new Intl.NumberFormat(\"ru-RU\", {\n    style: \"currency\",\n    currency,\n    maximumFractionDigits: 0,\n  }).format(value)\n}\n```\n\nЭто дизайн-превью: в следующих версиях агент сможет запускать и проверять код прямо в чате.',
  },
  {
    match: /картин|изображ|логотип|дизайн|image|picture/i,
    text: 'Генерация изображений уже в списке инструментов и скоро заработает.\n\nА пока опишите задачу подробнее: стиль, цвета, настроение — я подготовлю детальное ТЗ для будущего генератора.',
  },
  {
    match: /план|недел|день|расписан|задач/i,
    text: 'Давайте соберём план. Вот простой каркас:\n\n1. Утро — главная задача дня, без отвлечений\n2. День — встречи и короткие задачи\n3. Вечер — подведение итогов и план на завтра\n\nВ следующих версиях я смогу синхронизироваться с вашим календарём.',
  },
]

const DEFAULT_REPLY =
  'Отличный вопрос! Это дизайн-превью MeTiger Ai — здесь пока живёт интерфейс, а «мозги» агента мы подключим на следующем этапе.\n\nПопробуйте спросить про код, изображения или планирование — или загляните в разделы «Агенты» и «Инструменты».'

export function generateReply(text: string): string {
  const hit = REPLIES.find((r) => r.match.test(text))
  return hit ? hit.text : DEFAULT_REPLY
}

export function timeGreeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}
