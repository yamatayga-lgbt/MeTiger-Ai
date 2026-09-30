import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  MessageSquarePlus,
  Moon,
  PenLine,
  Puzzle,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { Logo, LogoMark } from './Logo'
import { IconButton } from './ui'
import { displayName, initials, type TgUser } from '../lib/telegram'
import type { Chat, ViewId } from '../App'

interface SidebarProps {
  open: boolean
  onClose: () => void
  view: ViewId
  onNavigate: (v: ViewId) => void
  chats: Chat[]
  activeChatId: string
  onSelectChat: (id: string) => void
  onNewChat: () => void
  onRenameChat: (id: string, title: string) => void
  onDeleteChat: (id: string) => void
  user: TgUser
  resolvedTheme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenPalette: () => void
}

const SECTIONS: { id: ViewId; label: string; icon: typeof Bot }[] = [
  { id: 'agent', label: 'Агент', icon: Bot },
  { id: 'tools', label: 'Инструменты', icon: Puzzle },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

function startOfDay(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function Sidebar({
  open,
  onClose,
  view,
  onNavigate,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  user,
  resolvedTheme,
  onToggleTheme,
  onOpenPalette,
}: SidebarProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.focus()
  }, [editingId])

  const dayStart = startOfDay()
  const today = chats.filter((c) => c.updatedAt >= dayStart)
  const older = chats.filter((c) => c.updatedAt < dayStart)

  const beginRename = (chat: Chat) => {
    setMenuFor(null)
    setEditingId(chat.id)
    setDraft(chat.title)
  }

  const commitRename = () => {
    if (editingId) onRenameChat(editingId, draft)
    setEditingId(null)
  }

  const renderChat = (chat: Chat) => {
    const isActive = chat.id === activeChatId
    const isEditing = editingId === chat.id
    return (
      <div key={chat.id} className={`chat-item${isActive ? ' active' : ''}`}>
        {isEditing ? (
          <>
            <LogoMark size={16} />
            <input
              ref={inputRef}
              className="rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
            />
            <button
              type="button"
              className="more-btn"
              aria-label="Сохранить"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitRename}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="more-btn"
              aria-label="Отмена"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditingId(null)}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="chat-select"
              onClick={() => onSelectChat(chat.id)}
            >
              <LogoMark size={16} />
              <span className="title">{chat.title}</span>
            </button>
            <button
              type="button"
              className="more-btn"
              aria-label="Действия чата"
              onClick={(e) => {
                e.stopPropagation()
                setMenuFor((v) => (v === chat.id ? null : chat.id))
              }}
            >
              <MoreDots />
            </button>
            {menuFor === chat.id ? (
              <>
                <div className="menu-catcher" onClick={() => setMenuFor(null)} />
                <div className="chat-menu" role="menu">
                  <button type="button" onClick={() => beginRename(chat)}>
                    <PenLine size={14} />
                    Переименовать
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setMenuFor(null)
                      onDeleteChat(chat.id)
                    }}
                  >
                    <Trash2 size={14} />
                    Удалить
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {open ? <div className="drawer-scrim" onClick={onClose} /> : null}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <Logo />

        <button type="button" className="new-chat-btn" onClick={onNewChat}>
          <MessageSquarePlus size={15} />
          Новый чат
          <kbd>⌘N</kbd>
        </button>

        <button type="button" className="side-item" onClick={onOpenPalette}>
          <Search size={16} />
          Поиск
          <kbd style={{ marginLeft: 'auto' }}>⌘K</kbd>
        </button>

        <div className="side-section">История</div>
        <div className="side-history">
          {chats.length === 0 ? (
            <div className="history-empty">Пока пусто — начните новый чат</div>
          ) : null}

          {today.length > 0 ? (
            <>
              <div className="history-label">Сегодня</div>
              {today.map(renderChat)}
            </>
          ) : null}

          {older.length > 0 ? (
            <>
              <div className="history-label">Раньше</div>
              {older.map(renderChat)}
            </>
          ) : null}
        </div>

        <div className="side-section">Разделы</div>
        <nav className="side-nav">
          {SECTIONS.map((item) => (
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

        <div className="side-foot-row">
          <button type="button" className="user-row" onClick={() => onNavigate('settings')}>
            <div className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>
              {user.photo_url ? <img src={user.photo_url} alt="" /> : initials(user)}
            </div>
            <div className="user-meta">
              <div className="n">{displayName(user)}</div>
              <div className="u">{user.username ? `@${user.username}` : 'Telegram'}</div>
            </div>
          </button>
          <IconButton
            icon={resolvedTheme === 'dark' ? Sun : Moon}
            label="Сменить тему"
            onClick={onToggleTheme}
            size={16}
          />
        </div>
      </aside>
    </>
  )
}

function MoreDots() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  )
}
