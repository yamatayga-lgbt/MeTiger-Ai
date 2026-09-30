import { Bot, MessagesSquare, Puzzle, Settings } from 'lucide-react'
import type { ViewId } from '../App'

const TABS: { id: ViewId; label: string; icon: typeof MessagesSquare }[] = [
  { id: 'chat', label: 'Чат', icon: MessagesSquare },
  { id: 'agent', label: 'Агент', icon: Bot },
  { id: 'tools', label: 'Инструменты', icon: Puzzle },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

export function BottomNav({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  return (
    <nav className="tabbar" aria-label="Основная навигация">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-item${view === tab.id ? ' active' : ''}`}
          aria-current={view === tab.id ? 'page' : undefined}
          onClick={() => onNavigate(tab.id)}
        >
          <tab.icon size={20} />
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
