import avatarUrl from '../assets/agent-avatar.webp'
import { APP_VERSION } from '../lib/version'

interface LogoMarkProps {
  size?: number
  className?: string
}

/** Фирменный знак MeTiger Ai — аватар тигра (вместо прежней буквы «M»). */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  const radius = Math.max(4, Math.round(size * 0.28))
  return (
    <img
      src={avatarUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className ? `logo-mark ${className}` : 'logo-mark'}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
      }}
    />
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" style={compact ? { padding: 0 } : undefined}>
      <LogoMark size={26} />
      <div className="brand-name">
        MeTiger <span className="dim">Ai</span>
      </div>
      {/* Версия — здесь, а не под полем ввода (0.170): в шапке меню её видно сразу,
          а место между именем и значком beta всё равно пустовало — владелец обвёл
          его на снимке 12 окт. Номер меняется только с выпуском: это отметка сборки. */}
      <span className="brand-version">v{APP_VERSION}</span>
      <span className="side-badge">beta</span>
    </div>
  )
}
