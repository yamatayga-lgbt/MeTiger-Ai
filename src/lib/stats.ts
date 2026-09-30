/* ============================================================
   Реальная статистика запусков — уникальные устройства.
   Счётчик живёт на Cloudflare Worker + KV: каждый запуск
   мини-приложения отмечает своё устройство, сервер считает
   уникальные. Никаких «нарисованных» чисел.
   ============================================================ */

const STATS_URL = 'https://metiger-stats.yamatayga.workers.dev'
const DEVICE_KEY = 'mt-device-id'

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return `d-anon-${Date.now()}`
  }
}

/** Отмечает запуск с этого устройства и возвращает число уникальных устройств. */
export async function fetchRealRuns(): Promise<number | null> {
  try {
    const res = await fetch(
      `${STATS_URL}/hit?id=${encodeURIComponent(deviceId())}`,
      { method: 'GET' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { devices?: number }
    return typeof data.devices === 'number' ? data.devices : null
  } catch {
    return null
  }
}
