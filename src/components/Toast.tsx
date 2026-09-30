import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(onDone, 2400)
    return () => window.clearTimeout(t)
  }, [message, onDone])

  if (!message) return null

  return (
    <div className="toast-wrap" role="status">
      <div className="toast">
        <Sparkles size={15} />
        {message}
      </div>
    </div>
  )
}
