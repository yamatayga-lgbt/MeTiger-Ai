/* ============================================================
   Отдача на нажатия. Только веб: Vibration API, если браузер его даёт.
   ============================================================ */

/* Зачем. Раньше щелчки делал Telegram-вебвью (HapticFeedback). Игнорировать
   отдачу целиком — значит лишить сенсорных телефов обратной связи, а врать про
   «вибрацию есть» на десктопе нельзя: поэтому проверяем наличие API и молчим,
   когда его нет. Вызов никогда не бросает: отдача не повод ронять обработчик. */

export type Haptic = 'light' | 'medium' | 'select' | 'success' | 'error'

const PATTERN: Record<Haptic, number[]> = {
  light: [8],
  medium: [16],
  select: [10, 24, 10],
  success: [12, 40, 24],
  error: [30, 40, 30, 40, 30],
}

export function haptic(kind: Haptic = 'light'): void {
  try {
    const nav = (globalThis as { navigator?: { vibrate?: (p: number[]) => boolean } }).navigator
    const vibrate = nav && typeof nav.vibrate === 'function' ? nav.vibrate : null
    if (vibrate) vibrate(PATTERN[kind] || PATTERN.light)
  } catch {
    /* телефон отказал — не беда, нажатие всё равно случилось */
  }
}
