/**
 * Свайп назад на вложенных экранах (0.218).
 *
 * Стрелка в шапке уже ведёт по постоянному маршруту BACK_TO (профиль → чат,
 * персонализация/память/данные/… → профиль). Палец должен делать то же самое:
 * смахнул вправо от левого края — вернулся туда, куда ведёт стрелка.
 *
 * Это не история посещений и не жест браузера «назад по вкладке». Только те
 * экраны, у которых есть стрелка; чат не трогаем.
 *
 * Правила (каждое потом держит ui218):
 *   · старт только от левого края — горизонтальная прокрутка таблиц и списков
 *     в середине экрана остаётся прокруткой;
 *   · горизонталь должна победить вертикаль, иначе это обычный скролл;
 *   · всплывающий слой (меню «+», параметры, палитра, ящик) жест не берёт —
 *     тот же замок, что у «потянул вниз — обновил»;
 *   · отпустил дальше порога — onBack(); раньше порога — ничего.
 */
import { useEffect, useRef } from 'react'
import { pageGestureLocked, touchedOverlay } from '../lib/pageGesture'

/** Касание считается «от края», если палец начал не дальше этого. */
const EDGE = 32
/** Палец должен уехать вправо хотя бы на столько. */
const THRESHOLD = 64
/** Если вертикаль выросла раньше и больше — это скролл, не назад. */
const VERTICAL_WINS = 16

export function useSwipeBack(enabled: boolean, onBack: () => void): void {
  const enabledRef = useRef(enabled)
  const onBackRef = useRef(onBack)
  enabledRef.current = enabled
  onBackRef.current = onBack

  useEffect(() => {
    if (typeof window === 'undefined') return

    let x0 = 0
    let y0 = 0
    let armed = false
    let tracking = false

    const onStart = (e: TouchEvent) => {
      armed = false
      tracking = false
      if (!enabledRef.current) return
      if (pageGestureLocked() || touchedOverlay(e.target)) return
      const t = e.touches[0]
      if (!t) return
      if (t.clientX > EDGE) return
      x0 = t.clientX
      y0 = t.clientY
      armed = true
      tracking = true
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking || !armed) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      if (Math.abs(dy) > VERTICAL_WINS && Math.abs(dy) > Math.abs(dx)) {
        armed = false
        tracking = false
      }
    }

    const finish = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t ? t.clientX - x0 : 0
      const go = armed && dx >= THRESHOLD
      armed = false
      if (go) onBackRef.current()
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', finish, { passive: true })
    document.addEventListener('touchcancel', finish, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', finish)
      document.removeEventListener('touchcancel', finish)
    }
  }, [])
}
