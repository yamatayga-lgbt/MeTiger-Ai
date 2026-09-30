import { Folder, Sparkles, X } from 'lucide-react'
import { IconButton } from './ui'

interface WorkspaceDrawerProps {
  open: boolean
  onClose: () => void
}

/**
 * Workspace — место, где появляются файлы, созданные самим агентом.
 * Пока агент ничего не создавал — пустое состояние.
 */
export function WorkspaceDrawer({ open, onClose }: WorkspaceDrawerProps) {
  return (
    <>
      {open ? <div className="drawer-scrim" onClick={onClose} /> : null}
      <aside className={`workspace-drawer${open ? ' open' : ''}`} aria-label="Workspace">
        <div className="ws-head">
          <Folder size={17} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ws-title">Workspace</div>
            <div className="ws-sub">Создано агентом</div>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} size={16} />
        </div>

        <div className="ws-body">
          <div className="ws-empty">
            <div className="ws-empty-icon">
              <Sparkles size={22} />
            </div>
            <div className="ws-empty-title">Пока пусто</div>
            <div className="ws-empty-text">
              Здесь будут появляться файлы, которые агент создаст сам: изображения,
              документы, код и другие результаты работы.
            </div>
          </div>
        </div>

        <div className="ws-storage">
          <div className="ws-storage-row">
            <span>0 КБ</span>
            <span>1 ГБ</span>
          </div>
          <div className="storage-bar">
            <div className="storage-fill" style={{ width: '0%' }} />
          </div>
        </div>
      </aside>
    </>
  )
}
