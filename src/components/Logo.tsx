import avatarUrl from '../assets/agent-avatar.png'

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
      <span className="side-badge">beta</span>
    </div>
  )
}
