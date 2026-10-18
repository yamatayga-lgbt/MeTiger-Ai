/**
 * Лимиты агента для человека (0.179). Просьба владельца: «удобная кнопка как
 * „Просмотреть лимиты“ рядом с иконкой Workspace… если всего 5к в день запросов,
 * то это 100 %, если 2,5к — уже 50 %… с 100 % зелёный, на 50 % жёлтое, ближе к 0 %
 * красное, и 0 % красный мигает».
 *
 * Здесь только счёт и вид — ни одного запроса и ни одной картинки: кольцо в шапке
 * (src/components/LimitsRing.tsx) и панель «Использование и лимиты» берут числа из
 * одного места, поэтому цифра в шапке и цифра на экране не могут разойтись.
 *
 * Проценты — с десятыми и русской запятой: «98,9 %». Целые врали бы на большом
 * запасе (сутки стоят «на 99 %», хотя расход идёт), а точка в русском интерфейсе
 * читалась бы как опечатка.
 */

/** Общий запас агента: то, что отдаёт /api/usage полем `pool`. */
export interface LimitsPool {
  /** Сколько живых источников стоит за цифрой. */
  live: number
  /** Дневной потолок всех живых источников, запросов. */
  capacity: number
  /** Сколько уже израсходовано сегодня. */
  used: number
  /** Сколько осталось: capacity − used. */
  remaining: number
  /** Доля остатка в процентах (0…100, с десятыми) или null, если живых нет. */
  pct: number | null
}

/**
 * Одна цифра запаса для шапки, профиля и экрана лимитов.
 *
 * Когда включён суточный потолок — он и есть запас (квот провайдеров больше,
 * чем агенту разрешено потратить за сутки). Без потолка остаётся сумма живых
 * источников. Фронт свой процент не считает: берёт то, что уже посчитал сервер.
 */
export function reservePct(data: {
  cap?: { on?: boolean; pct?: number | null } | null
  pool?: { pct?: number | null } | null
} | null | undefined): number | null {
  if (!data) return null
  if (data.cap && data.cap.on && data.cap.pct != null && Number.isFinite(Number(data.cap.pct))) {
    return Number(data.cap.pct)
  }
  if (data.pool && data.pool.pct != null && Number.isFinite(Number(data.pool.pct))) {
    return Number(data.pool.pct)
  }
  return null
}

/** «98,9 %» — процент с десятыми, русской запятой и неразрывным пробелом. */
export function fmtPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return '—'
  const v = Math.max(0, Math.min(100, Number(pct)))
  return v.toFixed(1).replace('.', ',') + '\u00a0%'
}

/**
 * Оттенок кольца: 100 % — зелёный (120°), 50 % — жёлтый (60°), 0 % — красный (0°).
 * Линейно, без ступенек: «чуть прижелтевшее» владелец просил именно так — цвет
 * уезжает вместе с запасом, а не переключается рывком на пороге.
 */
export function ringHue(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(Number(pct))) return 120
  const v = Math.max(0, Math.min(100, Number(pct)))
  return 1.2 * v
}

/** Насыщенность и светлота кольца — общие для кольца и подписи. */
export const RING_SAT = 62
/** Светлая тема: тот же оттенок, но приглушённый — на светлом фоне этого хватает. */
export const RING_LIGHT = 42
/** Тёмная тема: на почти чёрном фоне 42 % тускнеет (красное на 12 % запаса читалось
    хуже всего) — берём ту же насыщенность, но светлее. Оттенок НЕ меняется: зелёное
    остаётся зелёным, красное красным, а «дорога» от запаса к запасу — прежней. */
export const RING_LIGHT_DARK = 58

/** Цвет кольца и подписи. В теме приложения его подставляет CSS (`--ring-h`), а
    эта функция — та же формула в числах: ею пользуются проверки и серверные
    подписи, и она не даёт правилу в стилях разойтись с кодом. */
export function ringColor(pct: number | null | undefined, theme: 'light' | 'dark' = 'light'): string {
  const light = theme === 'dark' ? RING_LIGHT_DARK : RING_LIGHT
  return `hsl(${ringHue(pct).toFixed(1)} ${RING_SAT}% ${light}%)`
}

/**
 * Запас исчерпан — кольцо мигает. Порог 0,05 %: мигание включается ровно тогда,
 * когда человек видит «0,0 %», а не когда на кольце ещё «0,1 %».
 */
export function isExhausted(pct: number | null | undefined): boolean {
  if (pct == null || !Number.isFinite(Number(pct))) return false
  return Number(pct) < 0.05
}

/** «запрос / запроса / запросов» — иначе «осталось 1 запросов». */
export function requestsWord(n: number): string {
  const v = Math.abs(Math.floor(Number(n) || 0)) % 100
  const d = v % 10
  if (v > 10 && v < 20) return 'запросов'
  if (d === 1) return 'запрос'
  if (d >= 2 && d <= 4) return 'запроса'
  return 'запросов'
}

/** «9 788 запросов из 9 900» — одна строка для панели и для подписи кнопки. */
export function poolLine(pool: LimitsPool | null | undefined): string {
  if (!pool || pool.pct == null) return 'общего запаса нет: ни один источник не отозвался'
  /* 0.202: без кода владельца /api/usage отдаёт только процент — имён
     провайдеров и абсолютных чисел наружу больше нет. Считать «сколько из
     скольких» не из чего, поэтому честно говорим долю, а не выдумываем нули. */
  if (!Number.isFinite(Number(pool.remaining)) || !Number.isFinite(Number(pool.capacity))) {
    return `осталось ${fmtPct(pool.pct)} общего дневного запаса`
  }
  const left = Math.max(0, Math.round(pool.remaining)).toLocaleString('ru-RU')
  const all = Math.max(0, Math.round(pool.capacity)).toLocaleString('ru-RU')
  return `осталось ${left} ${requestsWord(pool.remaining)} из ${all}`
}

/**
 * «Сколько осталось» словами — для тех, кто читает подпись, а не кольцо.
 * Совпадает с порядком величины: запас есть → «хватает», пусто → «кончился».
 */
export function poolNote(pool: LimitsPool | null | undefined): string {
  if (!pool || pool.pct == null) return 'источники не отвечают'
  if (isExhausted(pool.pct)) return 'запас на сегодня кончился — новый откроется после полуночи по UTC'
  if (pool.pct < 20) return 'запас на исходе — отвечать будет труднее'
  if (pool.pct < 50) return 'запас убывает'
  return 'запас в порядке'
}
