/**
 * Клиент панели «Использование и Лимиты» — GET /api/usage.
 *
 * Панель показывает две разные правды рядом и не смешивает их:
 *   • «всего» — счёт сервера: сколько запросов ушло к каждому провайдеру за сутки
 *     (UTC) по всем людям, сколько из них ушло в отказ или в смерть ключа;
 *   • «на устройстве» — счёт браузера (localStorage): он мгновенный и точный, но
 *     только про этого человека.
 *
 * Опрос живёт, пока открыт экран и вкладка видима: держать сеть в фоне на телефоне
 * незачем — там это стоит батареи, а не пользы. Ошибка не выбрасывает прежние
 * числа: «не обновилось» и «расход ноль» — разные вещи.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UsagePause {
  until: number
  why: string
}

export interface UsageRow {
  id: string
  label: string
  keys: number
  live: boolean
  dayLimit: number
  rpm: number
  attempt: number
  ok: number
  refused: number
  dead: number
  minute: number
  lastAt: number
  model: string
  pause: UsagePause | null
  remaining: number | null
  pct: number | null
}

export interface UsageSnapshot {
  ok: boolean
  at: number
  day: string
  tz: string
  resetInMs: number
  kv: boolean
  off: boolean
  totals: { attempt: number; ok: number; refused: number; dead: number }
  providers: UsageRow[]
  rate: { max: number; windowMs: number; on: boolean; why: string }
  precision: {
    approx: boolean
    writeMs: number
    readMs: number
    writes: number
    reads: number
    unsaved: number
    note: string
  }
}

export interface UsageResult {
  ok: boolean
  data?: UsageSnapshot
  error?: string
}

/** Один запрос к /api/usage. `refresh` — попросить сервер перечитать хранилище. */
export async function fetchUsage(refresh = false): Promise<UsageResult> {
  try {
    const res = await fetch(`/api/usage${refresh ? '?refresh=1' : ''}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, error: `сервер ответил ${res.status}` }
    const data = (await res.json()) as UsageSnapshot
    if (!data || data.ok !== true) return { ok: false, error: 'ответ без данных' }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: 'сеть недоступна' }
  }
}

export interface UsageLive {
  data: UsageSnapshot | null
  error: string
  /** когда пришли последние данные (мс) — по нему панель пишет «обновлено N с назад» */
  at: number
  loading: boolean
  refresh: (silent?: boolean) => void
}

/**
 * Живой опрос. `active` — открыт ли экран: закрыли — опрос стоит, открыли — сразу
 * спрашиваем заново (человек вернулся на экран не для того, чтобы смотреть вчерашнее).
 */
export function useUsageLive(active: boolean, everyMs = 5000): UsageLive {
  const [data, setData] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState('')
  const [at, setAt] = useState(0)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const load = useCallback(async (silent: boolean) => {
    if (busy.current) return
    busy.current = true
    if (!silent) setLoading(true)
    const r = await fetchUsage(false)
    busy.current = false
    setLoading(false)
    if (r.ok && r.data) {
      setData(r.data)
      setAt(Date.now())
      setError('')
    } else {
      /* Прежние числа оставляем: «не обновилось» не равно «расход ноль». */
      setError(r.error || 'не обновилось')
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let stopped = false
    void load(false)
    const tick = () => {
      if (stopped) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load(true)
    }
    const id = window.setInterval(tick, Math.max(2000, everyMs))
    const onVis = () => { if (document.visibilityState === 'visible') void load(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [active, everyMs, load])

  const refresh = useCallback((silent = false) => { void load(silent) }, [load])
  return { data, error, at, loading, refresh }
}
