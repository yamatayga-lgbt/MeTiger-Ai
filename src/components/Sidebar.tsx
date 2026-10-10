import { useEffect, useRef, useState } from 'react'
import { groupChats } from '../lib/chatGroups'
import {
  Activity,
  Briefcase,
  Check,
  MessageSquarePlus,
  Moon,
  PenLine,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { Logo, LogoMark } from './Logo'
import { IconButton } from './ui'
import { displayName, initials, type Person } from '../lib/user'
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
  user: Person
  resolvedTheme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenPalette: () => void
  /** Есть непрочитанное обновление — точка на пункте «Что нового». */
  newsDot?: boolean
}

const SECTIONS: { id: ViewId; label: string; icon: typeof Settings }[] = [
  { id: 'cases', label: 'Дела', icon: Briefcase },
  /* Расход — пунктом раздела, а не строкой в Настройках: в Настройках он дублировал
     этот же переход, и человек искал его в двух местах вместо одного. */
  { id: 'usage', label: 'Использование и Лимиты', icon: Activity },
  /* «Что нового» — первым пунктом: после обновления человек первым делом ищет
     именно его, а точка на пункте говорит, что версия сменилась. */
  { id: 'whatsnew', label: 'Что нового', icon: Sparkles },
  { id: 'settings', label: 'Настройки', icon: Settings },
]


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
  newsDot = false,
}: SidebarProps) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.focus()
  }, [editingId])

  const groups = groupChats(chats)

  const beginRename = (chat: Chat) => {
    setMenu(null)
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
              maxLength={30}
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
                const rect = e.currentTarget.getBoundingClientRect()
                setMenu((m) =>
                  m && m.id === chat.id
                    ? null
                    : { id: chat.id, x: rect.right, y: rect.bottom },
                )
              }}
            >
              <MoreDots />
            </button>
          </>
        )}
      </div>
    )
  }

  // Меню действий чата: fixed-позиционирование вне трансформированного сайдбара,
  // открывается вверх у нижнего края экрана — не обрезается скроллом.
  const chatInMenu = menu ? chats.find((c) => c.id === menu.id) : null
  const openUp = menu ? menu.y > window.innerHeight - 130 : false
  const menuLeft = menu
    ? Math.max(8, Math.min(menu.x - 176, window.innerWidth - 184))
    : 0

  return (
    <>
      {open ? <div className="drawer-scrim" onClick={onClose} /> : null}

      {menu && chatInMenu ? (
        <>
          <div className="menu-catcher" onClick={() => setMenu(null)} />
          <div
            className="chat-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: openUp ? menu.y - 118 : menu.y + 6,
              left: menuLeft,
            }}
          >
            <button type="button" onClick={() => beginRename(chatInMenu)}>
              <PenLine size={14} />
              Переименовать
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setMenu(null)
                onDeleteChat(chatInMenu.id)
              }}
            >
              <Trash2 size={14} />
              Удалить
            </button>
          </div>
        </>
      ) : null}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <Logo />

        <button type="button" className="new-chat-btn" onClick={onNewChat}>
          <MessageSquarePlus size={15} />
          Новый чат
        </button>

        <button type="button" className="side-item" onClick={onOpenPalette}>
          <Search size={16} />
          Поиск
        </button>

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
              {item.id === 'whatsnew' && newsDot ? (
                <span className="side-dot" aria-label="есть новое" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="side-history">
          {chats.length === 0 ? (
            <div className="history-empty">Пока пусто — начните новый чат</div>
          ) : null}

          {groups.map((g) => (
            <div key={g.label} className="history-group">
              <div className="history-label">{g.label}</div>
              {g.items.map(renderChat)}
            </div>
          ))}
        </div>

        <div className="side-foot-row">
          <button type="button" className="user-row" onClick={() => onNavigate('settings')}>
            <div className="avatar" style={{ width: 30, height: 30, fontSize: 11.5 }}>
              {initials(user)}
            </div>
            <div className="user-meta">
              <div className="n">{displayName(user)}</div>
              <div className="u">{user.handle}</div>
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
