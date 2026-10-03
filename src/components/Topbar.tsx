import { Folder, PanelLeft } from 'lucide-react'
import { IconButton } from './ui'

interface TopbarProps {
  title: string
  onOpenMenu: () => void
  onOpenWorkspace: () => void
}

/** Верхняя панель: меню слева, заголовок строго по центру, Workspace справа. */
export function Topbar({ title, onOpenMenu, onOpenWorkspace }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-side topbar-left">
        <IconButton
          icon={PanelLeft}
          label="Меню"
          onClick={onOpenMenu}
          className="only-mobile"
        />
      </div>
      <div className="page-title">{title}</div>
      <div className="topbar-side topbar-right">
        <IconButton
          icon={Folder}
          label="Workspace"
          onClick={onOpenWorkspace}
        />
      </div>
    </header>
  )
}
