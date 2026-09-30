import {
  Bot,
  MessagesSquare,
  Puzzle,
  Settings,
  Sparkles,
} from 'lucide-react'
import { Logo } from './Logo'
import { Badge } from './ui'
import { displayName, initials, type TgUser } from '../lib/telegram'
import type { ViewId } from '../App'

const NAV: { id: ViewId; label: string; icon: typeof MessagesSquare }[] = [
  { id: 'chat', label: 'Чат', icon: MessagesSquare },
  { id: 'agents', label: 'Агенты', icon: Bot },
  { id: 'tools', label: 'Инструменты', icon: Puzzle },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

interface SidebarProps {
  view: ViewId
  onNavigate: (v: ViewId) => void
  onNewChat: () => void
  user: TgUser
  onProfile: () => void
}

export function Sidebar({ view, onNavigate, onNewChat, user, onProfile }: SidebarProps) {
  return (
    <aside className="sidebar">
      <Logo />

      <button type="button" className="new-chat-btn" onClick={onNewChat}>
        <Sparkles size={15} />
        Новый чат
        <kbd>⌘K</kbd>
      </button>

      <div className="side-section">Пространство</div>
      <nav className="side-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`side-item${view === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <div className="side-card">
          <div className="t">Дизайн-превью v0.1</div>
          <div className="d">
            SaaS-слой (агенты, инструменты, админка) появится следующим этапом.
          </div>
        </div>
        <button type="button" className="user-row" onClick={onProfile}>
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>
            {user.photo_url ? <img src={user.photo_url} alt="" /> : initials(user)}
          </div>
          <div className="user-meta">
            <div className="n">{displayName(user)}</div>
            <div className="u">{user.username ? `@${user.username}` : 'Telegram'}</div>
          </div>
          <Badge tone="accent">beta</Badge>
        </button>
      </div>
    </aside>
  )
}
