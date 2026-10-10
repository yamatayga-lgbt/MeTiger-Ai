/**
 * Обновление страницы смахиванием вниз — своё, безопасное (0.145).
 *
 * История: родной pull-to-refresh браузера был отключён в 0.143 вместе с багом
 * «вся оболочка едет за пальцем» (жест работает на уровне html, и его нельзя
 * оставить, не вернув дёргание). Но привычка «потянул вниз — обновилось»
 * настоящая, и владелец попросил её вернуть. Возвращаем сам жест, а не прежний
 * механизм: оболочка остаётся запертой (html/body overflow:hidden), палец
 * двигает только маленький индикатор-кружок — как в нативных приложениях.
 *
 * Правила жеста (каждое закреплено тестом ui145):
 *   · срабатывает ТОЛЬКО от верха: если любой прокручиваемый предок под пальцем
 *     уже прокручен (scrollTop > 0), это обычная прокрутка, а не «потянул»;
 *   · только вертикальный: повело вбок раньше, чем вниз, — жест отменяется
 *     (горизонтальные свайпы по коду и таблицам не должны перезагружать);
 *   · слушатели passive — прокрутка не платит за жест ни кадра;
 *   · отпустил дальше порога — перезагрузка; раньше порога — кружок уезжает.
 */
import { useEffect, type RefObject } from 'react'

/** Палец должен пройти вниз хотя бы столько, чтобы жест считался «потянул». */
const START_AT = 10
/** Отпустил, когда индикатор уехал дальше порога, — страница перезагружается. */
const THRESHOLD = 70
/** Дальше индикатор не едет: резинка, а не бесконечный лифт. */
const MAX = 104
/** Палец едет быстрее индикатора — ощущение упругости, как у родного жеста. */
const DRAG = 0.55

export function usePullToRefresh(ind: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ind.current
    if (!el || typeof window === 'undefined') return

    let x0 = 0
    let y0 = 0
    /** Касание началось там, где всё прокручено к верху, — жест возможен. */
    let armed = false
    let pulling = false
    let dist = 0
    /** Перезагрузка уже запущена — больше ничего не слушаем. */
    let busy = false

    const atTop = (t: EventTarget | null): boolean => {
      let n = t instanceof Element ? t : null
      for (; n; n = n.parentElement) {
        if (n.scrollTop > 0) return false
      }
      return true
    }

    /* Клавиатура открыта или страница увеличена щипком — жест молчит: в этих
       состояниях браузер сам панорамирует кадр, и «потянул вниз» значит
       «подвинь страницу», а не «обнови» (0.146). */
    const viewportBusy = (): boolean => {
      const vv = window.visualViewport
      if (!vv) return false
      if (vv.scale > 1.02) return true
      return vv.offsetTop > 1 || window.innerHeight - vv.height > 1
    }

    const paint = () => {
      const k = Math.min(dist, MAX)
      el.style.transform = `translate(-50%, ${k}px) rotate(${k * 2.4}deg)`
      el.style.opacity = k > 4 ? '1' : '0'
      el.classList.toggle('is-ready', dist >= THRESHOLD)
    }

    const reset = () => {
      pulling = false
      armed = false
      dist = 0
      el.classList.add('is-leaving')
      el.classList.remove('is-ready')
      el.style.transform = 'translate(-50%, 0)'
      el.style.opacity = '0'
      window.setTimeout(() => el.classList.remove('is-leaving'), 200)
    }

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      armed = !viewportBusy() && atTop(e.target)
      pulling = false
      dist = 0
    }

    const onMove = (e: TouchEvent) => {
      if (busy || !armed) return
      const dx = e.touches[0].clientX - x0
      const dy = e.touches[0].clientY - y0
      if (!pulling) {
        /* Повело вверх или вбок — это прокрутка или свайп, не наш жест. */
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          armed = false
          return
        }
        if (dy < START_AT) return
        pulling = true
        el.classList.remove('is-leaving')
      }
      dist = (dy - START_AT) * DRAG
      paint()
    }

    const onEnd = () => {
      if (busy || !pulling) {
        armed = false
        return
      }
      if (dist >= THRESHOLD) {
        busy = true
        el.classList.add('is-busy')
        el.style.transform = `translate(-50%, ${THRESHOLD}px)`
        window.location.reload()
      } else {
        reset()
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [ind])
}
