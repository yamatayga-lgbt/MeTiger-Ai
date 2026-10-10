/**
 * Жидкое стекло: блик ходит по панели вслед за пальцем или курсором.
 *
 * Правило простое и намеренно узкое: панель под указателем получает --mx/--my
 * (в процентах), а токен --glass-sheen рисует светлое пятно в этой точке. Ушли
 * с панели — переменные снимаются, и пятно возвращается на отдых у верхней
 * кромки. Никакой раскладки это не трогает: меняется только фон одного элемента.
 *
 * Почему именно так, а не «анимация стекла»:
 *   · слушатели passive и пишутся в CSS-переменные по одному rAF-кадру на
 *     движение — на телефоне прокрутка не платит за эффект;
 *   · на устройствах без настоящего курсора (палец) пятно ставится по касанию
 *     и через полсекунды «таяет» — таскать его за пальцем во время скролла
 *     значило бы перерисовывать панель на каждом кадре прокрутки;
 *   · выключенные анимации/прозрачность (настройка системы) — эффект просто не
 *     включается: он декоративный, и спорить с человеком ему нечем.
 */
import { useEffect } from 'react'

/** Панели для подвижного блика. Длинные карточки настроек исключены: при касании
 * во время прокрутки им не нужно заново отрисовывать стеклянный фон. */
const SURFACE = [
  '.topbar',
  '.composer',
  '.model-panel',
  '.params-popover',
  '.attach-menu',
  '.chat-menu',
  '.palette',
  '.toast',
  '.workspace-drawer',
  '.sidebar',
  '.usage-card',
].join(', ')

const REST_MS = 450

export function useLiquidGlass(): void {
  useEffect(() => {
    /* Системная просьба «меньше движения» — уважаем без споров. */
    const calm =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (calm || typeof document === 'undefined') return

    let frame = 0
    let target: HTMLElement | null = null
    let px = 0
    let py = 0
    let melt = 0

    const rest = (el: HTMLElement | null) => {
      if (!el) return
      el.style.removeProperty('--mx')
      el.style.removeProperty('--my')
    }

    const paint = () => {
      frame = 0
      if (!target || !target.isConnected) {
        target = null
        return
      }
      const r = target.getBoundingClientRect()
      if (!r.width || !r.height) return
      const x = ((px - r.left) / r.width) * 100
      const y = ((py - r.top) / r.height) * 100
      /* Держим пятно в границах панели: за кромкой оно не видно, а лишний
         пересчёт фона на каждый пиксель мыши — нет. */
      target.style.setProperty('--mx', Math.max(-10, Math.min(110, x)).toFixed(2) + '%')
      target.style.setProperty('--my', Math.max(-10, Math.min(110, y)).toFixed(2) + '%')
    }

    const under = (node: EventTarget | null): HTMLElement | null => {
      const el = node as HTMLElement | null
      if (!el || typeof el.closest !== 'function') return null
      return el.closest(SURFACE) as HTMLElement | null
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      const el = under(e.target)
      if (el !== target) {
        rest(target)
        target = el
      }
      if (!target) return
      px = e.clientX
      py = e.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }

    /* Палец: блик вспыхивает там, где коснулись, и тает. Движение пальцем во
       время прокрутки намеренно НЕ ведёт пятно — это стоило бы кадра.

       Слушаем И touchstart, И pointerdown, и это не дублирование: часть браузеров
       (и headless-движок в проверке) шлёт только одно из двух. Повторный вызов
       безвреден — он ставит те же координаты и продлевает таяние.

       И тип указателя берём из САМОГО события, а не из медиазапроса: медиазапрос
       врёт на гибридных ноутбуках и в браузерах без мыши (проверено: широкий
       экран без мыши отвечает «pointer: coarse», и блик не двигался за курсором). */
    const flash = (node: EventTarget | null, cx: number, cy: number) => {
      const el = under(node)
      if (!el) return
      if (melt) window.clearTimeout(melt)
      rest(target)
      target = el
      px = cx
      py = cy
      if (!frame) frame = requestAnimationFrame(paint)
      melt = window.setTimeout(() => {
        melt = 0
        rest(el)
        if (target === el) target = null
      }, REST_MS)
    }

    const onTouch = (e: TouchEvent) => {
      const t = e.touches && e.touches[0]
      const c = t || (e.changedTouches && e.changedTouches[0])
      if (!c) return
      /* Синтетический touchstart (его порождает сам браузер из pointer-события)
         приходит с нулевыми координатами: ставить пятно в угол экрана нельзя. */
      if (!c.clientX && !c.clientY) return
      flash(e.target, c.clientX, c.clientY)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      flash(e.target, e.clientX, e.clientY)
    }

    /* Уходим с панели — пятно возвращается на отдых. Но: касание порождает и
       pointerleave (палец «уходит» сразу после нажатия), и без проверки типа
       блик гас в тот же кадр, в котором вспыхнул — проверено живьём. */
    const onLeave = (e: Event) => {
      const pt = (e as PointerEvent).pointerType
      if (pt && pt !== 'mouse' && pt !== 'pen') return
      rest(target)
      target = null
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('touchstart', onTouch, { passive: true })
    document.addEventListener('pointerleave', onLeave, { passive: true })
    window.addEventListener('blur', onLeave)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (melt) window.clearTimeout(melt)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchstart', onTouch)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])
}
