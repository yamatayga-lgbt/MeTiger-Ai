/* ============================================================
   Демо-данные дизайн-превью MeTiger Ai.
   Один универсальный агент — без ролей и переключений.
   Позже здесь будет подключение к API агента и инструментов.
   ============================================================ */

import { APP_VERSION } from './version'

export interface AgentProfile {
  name: string
  desc: string
  version: string
}

export const AGENT: AgentProfile = {
  name: 'MeTiger Ai',
  desc: 'Один универсальный агент для любых задач: тексты, код, идеи, анализ и многое другое. Без ролей и переключений — он растёт и скоро сможет всё.',
  version: APP_VERSION,
}

export interface Capability {
  id: string
  label: string
  icon:
    | 'pen'
    | 'code'
    | 'lightbulb'
    | 'chart'
    | 'languages'
    | 'globe'
    | 'image'
    | 'file'
    | 'mic'
    | 'brain'
  soon?: boolean
}

export const CAPABILITIES: Capability[] = [
  { id: 'text', label: 'Тексты и идеи', icon: 'pen' },
  { id: 'code', label: 'Код', icon: 'code' },
  { id: 'answers', label: 'Ответы на вопросы', icon: 'lightbulb' },
  { id: 'analysis', label: 'Анализ', icon: 'chart' },
  { id: 'translate', label: 'Переводы', icon: 'languages' },
  { id: 'voice', label: 'Голос', icon: 'mic' },
  { id: 'web', label: 'Поиск в интернете', icon: 'globe', soon: true },
  { id: 'image', label: 'Изображения', icon: 'image', soon: true },
  { id: 'files', label: 'Файлы', icon: 'file', soon: true },
  { id: 'memory', label: 'Память', icon: 'brain', soon: true },
]

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Кто отвечал и за сколько — подпись под пузырём (пусто для сообщений юзера). */
  src?: string
  /** Прикреплённые картинки реплики (в localStorage не сохраняются — см. persist). */
  images?: string[]
  /** Документы, которые модель оформила файлом (в localStorage не пишутся — тот же
      мотив, что и с картинками: base64 съедает квоту молча). */
  files?: { name: string; mime: string; size: number; b64: string; kind?: string; source?: string }[]
  /** Навыки, включившиеся по смыслу этого вопроса. */
  skills?: string[]
  /** Вердикт совета голов словами. Пока его нет — значит совет молчал, и это тоже честно. */
  advice?: string
  adviceTone?: 'ok' | 'warn' | 'quiet'
}

const REPLIES: { match: RegExp; text: string }[] = [
  {
    match: /привет|здравств|хай|hello|hi/i,
    text: 'Привет! Я MeTiger Ai — универсальный агент.\n\nПомогу с текстами, кодом, идеями, анализом и многим другим. Спросите что угодно — или выберите подсказку ниже.',
  },
  {
    match: /код|code|функци|python|javascript|typescript|react/i,
    text: 'Конечно! Вот пример чистой функции с проверкой входных данных:\n\n```typescript\nexport function formatPrice(value: number, currency = "RUB"): string {\n  if (!Number.isFinite(value)) throw new Error("Invalid value")\n  return new Intl.NumberFormat("ru-RU", {\n    style: "currency\",\n    currency,\n    maximumFractionDigits: 0,\n  }).format(value)\n}\n```\n\nЭто дизайн-превью: в следующих версиях я смогу запускать и проверять код прямо в чате.',
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
  'Отличный вопрос! Это дизайн-превью MeTiger Ai — здесь пока живёт интерфейс, а «мозги» агента мы подключим на следующем этапе.\n\nПопробуйте спросить про код, изображения или планирование — или загляните в раздел «Агент».'

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
