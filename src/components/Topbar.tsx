import { Folder, PanelLeft } from 'lucide-react'
import { IconButton } from './ui'

interface TopbarProps {
  title: string
  onOpenMenu: () => void
  onOpenWorkspace: () => void
}

/** Верхняя панель: меню слева, заголовок по центру, Workspace справа. */
export function Topbar({ title, onOpenMenu, onOpenWorkspace }: TopbarProps) {
  return (
    <header className="topbar">
      <IconButton
        icon={PanelLeft}
        label="Меню"
        onClick={onOpenMenu}
        className="only-mobile"
      />
      <div className="page-title">{title}</div>
      <div className="topbar-spacer" />
      <IconButton
        icon={Folder}
        label="Workspace"
        onClick={onOpenWorkspace}
      />
    </header>
  )
}
