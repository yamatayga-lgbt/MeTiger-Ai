/**
 * Форматирование времени под сообщением: длительность ответа («4 мин 48 с»,
 * как «Thought for N seconds» — только для всего ответа целиком) и «когда
 * это было» человеческими словами («только что», «3 минуты назад», а для
 * старого — дата). Разбито на функции, а не свалено в JSX, — чтобы в
 * тестах можно было прогнать таблицу значений без рендера компонента.
 */

/** Русское склонение по числу: pluralRu(1,'минута','минуты','минут') → 'минута'. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

/** Сколько шёл ответ: «≤1 с» → «1 с», «48 с», «4 мин 48 с», «1 ч 02 мин». */
export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`
  if (m > 0) return s > 0 ? `${m} мин ${s} с` : `${m} мин`
  return `${Math.max(1, s)} с`
}

/** «Когда это было», относительно `now` (по умолчанию — текущий момент). */
export function fmtAgo(ts: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - ts) / 1000))
  if (diffSec < 10) return 'только что'
  if (diffSec < 60) return `${diffSec} ${pluralRu(diffSec, 'секунду', 'секунды', 'секунд')} назад`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} ${pluralRu(diffMin, 'минуту', 'минуты', 'минут')} назад`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour} ${pluralRu(diffHour, 'час', 'часа', 'часов')} назад`
  const diffDay = Math.round(diffHour / 24)
  if (diffDay === 1) return 'вчера'
  if (diffDay < 7) return `${diffDay} ${pluralRu(diffDay, 'день', 'дня', 'дней')} назад`
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return sameYear ? `${day}.${month}` : `${day}.${month}.${d.getFullYear()}`
}

/** Полная строка под ответом ИИ: длительность + «когда» (если длительности нет — только «когда»). */
export function fmtAssistantFooterTime(ms: number | undefined, ts: number | undefined, now: number = Date.now()): string {
  const ago = typeof ts === 'number' ? fmtAgo(ts, now) : ''
  const dur = typeof ms === 'number' && ms > 0 ? fmtDuration(ms) : ''
  if (dur && ago) return `${dur} · ${ago}`
  return dur || ago
}
