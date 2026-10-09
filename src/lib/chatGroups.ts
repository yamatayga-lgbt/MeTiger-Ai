/* Группы истории по времени последней сессии (0.135): Сегодня, Вчера, 7 дней,
   30 дней, дальше — по месяцам («Август», «Декабрь 2025»). */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function groupLabel(ts: number, now: number = Date.now()): string {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0)
  const day = d0.getTime()
  if (ts >= day) return 'Сегодня'
  const y = new Date(d0); y.setDate(y.getDate() - 1)
  if (ts >= y.getTime()) return 'Вчера'
  const w = new Date(d0); w.setDate(w.getDate() - 7)
  if (ts >= w.getTime()) return 'Последние 7 дней'
  const m = new Date(d0); m.setDate(m.getDate() - 30)
  if (ts >= m.getTime()) return 'Последние 30 дней'
  const d = new Date(ts)
  return MONTHS[d.getMonth()] + (d.getFullYear() === d0.getFullYear() ? '' : ' ' + d.getFullYear())
}

export function groupChats<T extends { updatedAt: number }>(chats: T[], now: number = Date.now()): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = []
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const label = groupLabel(c.updatedAt, now)
    const last = out[out.length - 1]
    if (last && last.label === label) last.items.push(c)
    else out.push({ label, items: [c] })
  }
  return out
}
