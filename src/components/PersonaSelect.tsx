/**
 * Выпадающий выбор Персонализации (0.186) — как в приложении ChatGPT.
 *
 * Строка настройки + всплывающее меню НАД соседними карточками: каждый пункт —
 * жирное название и серое пояснение под ним, у выбранного — галочка справа.
 * Меню якорится к строке, открыто поверх всего экрана; тап мимо и Esc закрывают.
 * Открытое меню одно: выбор из другого пункта персонализации закрывает прежнее —
 * поэтому состояние живёт здесь, а экран хранит только имя открытой строки.
 */
import { useEffect } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { haptic } from '../lib/haptic'

export interface PersonaOption<V extends string> {
  value: V
  title: string
  sub: string
}

interface PersonaSelectProps<V extends string> {
  /** Имя настройки — совпадает с ключом открытого меню на экране. */
  name: string
  /** Заголовок строки («Дружелюбие»). */
  label: string
  /** Текущее значение — по нему рисуется значение строки и галочка меню. */
  value: V
  options: PersonaOption<V>[]
  /** Как показать значение в строке, если option для него не нашёлся. */
  fallback?: string
  /** Какое меню сейчас открыто на экране (одно на все строки). */
  openName: string
  onOpenChange: (name: string) => void
  onChange: (v: V) => void
}

export function PersonaSelect<V extends string>({
  name, label, value, options, fallback, openName, onOpenChange, onChange,
}: PersonaSelectProps<V>) {
  const open = openName === name
  const current = options.find((o) => o.value === value)

  /* Esc закрывает это меню — тот же договор, что у остальных оверлеев экрана. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <div className="persona-select">
      <button
        type="button"
        className={'persona-row' + (open ? ' is-open' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          haptic('light')
          onOpenChange(open ? '' : name)
        }}
      >
        <span className="persona-row-label">{label}</span>
        <span className="persona-row-value">
          {current ? current.title : fallback || ''}
          <ChevronDown size={16} className="persona-caret" />
        </span>
      </button>
      {open ? (
        <>
          <div className="persona-backdrop" onClick={() => onOpenChange('')} />
          <div className="persona-pop" role="listbox" aria-label={label}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={'persona-pop-item' + (o.value === value ? ' is-active' : '')}
                onClick={() => {
                  haptic('light')
                  onOpenChange('')
                  onChange(o.value)
                }}
              >
                <span className="persona-pop-text">
                  <span className="persona-pop-title">{o.title}</span>
                  <span className="persona-pop-sub">{o.sub}</span>
                </span>
                {o.value === value ? <Check size={18} className="persona-pop-check" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
