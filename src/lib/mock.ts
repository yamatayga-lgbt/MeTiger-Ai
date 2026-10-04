/* ============================================================
   Демо-данные дизайн-превью MeTiger Ai.
   Один универсальный агент — без ролей и переключений.
   Позже здесь будет подключение к API агента и инструментов.
   ============================================================ */

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
  files?: { name: string; mime: string; size: number; b64: string; kind?: string; source?: string; lines?: number }[]
  /** Причина, по которой картинка или документ не пришли, — словами источника. */
  fileError?: string
  /** Навыки, включившиеся по смыслу этого вопроса. */
  skills?: string[]
  /* Файлы, которые приложил человек: только имя и вес. Base64 в localStorage
     класть нельзя — квота кончается молча, а содержимое нужно один раз, на запрос. */
  docs?: { name: string; size: number }[]
  /** Что прочитали из этих файлов (строка от /api/chat), — под ответом.
      Оставлено для обратной совместимости: новые ответы несут структурный `reads`. */
  attach?: string
  /** То же самое, но списком по файлам — для блока «Explored N reads» над ответом:
      имя, прочитали ли, и чем (формат/объём) или почему нет. */
  reads?: { name: string; ok: boolean; line: string }[]
  /** Общие пометки по вложениям, не привязанные к одному файлу (лимит штук и т.п.). */
  readNotes?: string[]
  /** Что движок подправил на входе и в окне модели — одной строкой. */
  notes?: string
  /** Вердикт совета голов словами. Пока его нет — значит совет молчал, и это тоже честно. */
  advice?: string
  adviceTone?: 'ok' | 'warn' | 'quiet'
  /** Кусок того, как модель рассуждала (только если «думать вслух» было включено). */
  reasoning?: string
  /** Сколько секунд модель думала перед ответом (для «Thought for N seconds»). */
  thinkingSec?: number
  /** Какие инструменты вызывались при подготовке ответа (web-search, calc, wiki…). */
  tools?: string[]
  /** Общее время ответа в мс. */
  ms?: number
  /** Проверенные источники ответа (заголовок + ссылка) — кликабельны под пузырём. */
  sources?: { title: string; url: string }[]
  /** Шаги поиска в интернете и чтения сайтов (Searched for / Fetched). */
  webSteps?: {
    kind: 'search' | 'fetch'
    query?: string
    url?: string
    title?: string
    results?: { title: string; url: string }[]
  }[]
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
  'Отличный вопрос! Это дизайн-превью MeTiger Ai — здесь пока живёт интерфейс, а «мозги» агента мы подключим на следующем этапе.\n\nПопробуйте спросить про код, изображения или планирование.'

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
