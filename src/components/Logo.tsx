interface LogoMarkProps {
  size?: number
  className?: string
}

/** Фирменный знак MeTiger Ai — «M» в тигровом градиенте. */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mt-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFB13D" />
          <stop offset="1" stopColor="#F07A1A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#mt-g)" />
      <path
        d="M8.5 23V9.8L16 17.6L23.5 9.8V23"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
