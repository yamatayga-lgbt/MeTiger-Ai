import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'

export function Toast({
  message,
  onDone,
  onClick,
  actionLabel,
}: {
  message: string | null
  onDone: () => void
  onClick?: () => void
  actionLabel?: string
}) {
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(onDone, onClick ? 10000 : 2400)
    return () => window.clearTimeout(t)
  }, [message, onDone, onClick])

  if (!message) return null

  return (
    <div className="toast-wrap" role="status" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
      <div className="toast">
        <Sparkles size={15} />
        {message}
        {onClick && actionLabel && (
          <button 
            className="toast-action" 
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
