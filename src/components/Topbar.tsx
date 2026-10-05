import { Folder, PanelLeft, Settings } from 'lucide-react'
import { IconButton } from './ui'
import { haptic } from '../lib/haptic'

interface TopbarProps {
  title: string
  onOpenMenu: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
}

/** Верхняя панель: круглая кнопка меню слева, капсула по центру (вместо апселла
    подписки — у нас всё бесплатно) — показывает название чата, а нажатие на неё
    открывает настройки; круглая кнопка Workspace справа. */
export function Topbar({ title, onOpenMenu, onOpenWorkspace, onOpenSettings }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-side topbar-left">
        <IconButton
          icon={PanelLeft}
          label="Меню"
          onClick={onOpenMenu}
          className="topbar-round only-mobile"
        />
      </div>
      <button
        type="button"
        className="topbar-pill"
        title="Настройки"
        aria-label={`${title} · открыть настройки`}
        onClick={() => {
          haptic('light')
          onOpenSettings()
        }}
      >
        <Settings size={15} />
        <span>{title}</span>
      </button>
      <div className="topbar-side topbar-right">
        <IconButton
          icon={Folder}
          label="Workspace"
          onClick={onOpenWorkspace}
          className="topbar-round"
        />
      </div>
    </header>
  )
}


