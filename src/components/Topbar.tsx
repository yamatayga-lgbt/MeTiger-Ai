import { Moon, Search, Sun } from 'lucide-react'
import { IconButton } from './ui'
import { LogoMark } from './Logo'
import { initials, type TgUser } from '../lib/telegram'
import type { ViewId } from '../App'

const TITLES: Record<ViewId, string> = {
  chat: 'Чат',
  agents: 'Агенты',
  tools: 'Инструменты',
  settings: 'Настройки',
}

interface TopbarProps {
  view: ViewId
  resolvedTheme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenPalette: () => void
  onProfile: () => void
  user: TgUser
}

export function Topbar({
  view,
  resolvedTheme,
  onToggleTheme,
  onOpenPalette,
  onProfile,
  user,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand" style={{ padding: 0, gap: 8 }}>
        <LogoMark size={22} />
      </div>
      <div className="page-title">{TITLES[view]}</div>
      <div className="topbar-spacer" />

      <button type="button" className="search-pill" onClick={onOpenPalette}>
        <Search size={13} />
        Поиск и команды
        <kbd>⌘K</kbd>
      </button>

      <IconButton
        icon={resolvedTheme === 'dark' ? Sun : Moon}
        label="Сменить тему"
        onClick={onToggleTheme}
      />

      <button
        type="button"
        className="avatar"
        style={{ width: 30, height: 30, fontSize: 11.5 }}
        onClick={onProfile}
        aria-label="Профиль"
      >
        {user.photo_url ? <img src={user.photo_url} alt="" /> : initials(user)}
      </button>
    </header>
  )
}
