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
import type { LimitsPool } from './limits'
import { ownerCode } from './report'

/**
 * Дверь /api/usage двухъярусная (0.202). Без кода владельца сервер отдаёт только
 * «жив/лимит»: процент общего дневного запаса и время сброса. Полная раскладка по
 * провайдерам — по коду (тот же, что у «Ведомства»). Заголовок шлём, когда код на
 * устройстве есть; сервер сам решит, подошёл ли он, — клиент про это ничего не знает.
 */
function ownerHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' }
  try {
    const code = ownerCode()
    if (code) h['x-mt-owner'] = code
  } catch {
    /* приватный режим — попросим публичную дверь */
  }
  return h
}

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

/**
 * Что сервер отдал. `scope:'public'` — без кода владельца: есть только pool.pct и
 * cap, полей providers/totals/precision нет вовсе. Все «полные» поля поэтому
 * необязательные: экран обязан работать на обоих ярусах, а тип — напоминать об этом.
 */
export interface UsageSnapshot {
  ok: boolean
  /** 'public' — «жив/лимит»; 'owner' — полная раскладка (или старый сервер: undefined). */
  scope?: 'public' | 'owner'
  at?: number
  day: string
  tz: string
  resetInMs: number
  kv?: boolean
  off?: boolean
  totals?: { attempt: number; ok: number; refused: number; dead: number }
  /** Общий запас агента (0.179) — та же цифра, что у кольца в шапке: сервер
      складывает дневные потолки живых источников и уже сделанный расход. */
  pool: LimitsPool
  /** Суточный потолок (0.202) — теперь он главный ограничитель, а не квоты. */
  cap?: UsageCap
  providers?: UsageRow[]
  rate?: { max: number; windowMs: number; on: boolean; why: string }
  /** Подхват: имена моделей, живущие у двух и более провайдеров. */
  failover?: { count: number; sample: { model: string; providers: string[] }[] }
  note?: string
  precision?: {
    approx: boolean
    writeMs: number
    readMs: number
    writeCap?: number
    writes: number
    reads: number
    unsaved: number
    note: string
  }
}

/**
 * Суточный потолок агента (0.202): общий на всех, попытки к провайдерам за сутки UTC.
 * `pct` — сколько осталось в процентах; `on:false` — потолок выключен владельцем.
 */
export interface UsageCap {
  on: boolean
  pct?: number | null
  /** Остаток в сообщениях, вниз до десятков (0.224). Понятнее процента. */
  left?: number | null
  /** Запас ниже 20 % — панель говорит об этом словами, а не цветом кольца. */
  low?: boolean
  used?: number
  max?: number
  remaining?: number | null
  blocked?: boolean
  degraded?: boolean
  resetInMs?: number
  day?: string
  note?: string
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
      headers: ownerHeaders(),
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
