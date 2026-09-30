import type { ComponentType, ReactNode, SVGProps } from 'react'
import { haptic } from '../lib/telegram'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>

/* ---------- Badge ---------- */
export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode
  tone?: 'gray' | 'accent' | 'green' | 'amber' | 'blue'
}) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>
}

/* ---------- Switch ---------- */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('switch', checked && 'is-on')}
      disabled={disabled}
      onClick={() => {
        haptic('select')
        onChange(!checked)
      }}
    >
      <span className="switch-thumb" />
    </button>
  )
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; disabled?: boolean }[]
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={cx('segmented-item', value === opt.value && 'active')}
          disabled={opt.disabled}
          onClick={() => {
            haptic('select')
            onChange(opt.value)
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Buttons ---------- */
export function Button({
  children,
  variant = 'secondary',
  icon: Icon,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: IconType
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`)}
      disabled={disabled}
      onClick={() => {
        haptic('light')
        onClick?.()
      }}
    >
      {Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  size = 17,
  className,
}: {
  icon: IconType
  label: string
  onClick?: () => void
  size?: number
  className?: string
}) {
  return (
    <button
      type="button"
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      onClick={() => {
        haptic('light')
        onClick?.()
      }}
    >
      <Icon size={size} />
    </button>
  )
}
