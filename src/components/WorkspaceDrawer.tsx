import { Code2, FileText, Folder, Image, Table2, Upload, X } from 'lucide-react'
import { IconButton, type IconType } from './ui'
import { WORKSPACE_FILES, type WorkspaceFile } from '../lib/mock'

const ICONS: Record<WorkspaceFile['kind'], IconType> = {
  folder: Folder,
  md: FileText,
  image: Image,
  sheet: Table2,
  pdf: FileText,
  code: Code2,
}

interface WorkspaceDrawerProps {
  open: boolean
  onClose: () => void
  notify: (msg: string) => void
}

/** Панель файлов рабочего пространства (справа сверху, кнопка-папка). */
export function WorkspaceDrawer({ open, onClose, notify }: WorkspaceDrawerProps) {
  return (
    <>
      {open ? <div className="drawer-scrim" onClick={onClose} /> : null}
      <aside className={`workspace-drawer${open ? ' open' : ''}`} aria-label="Workspace">
        <div className="ws-head">
          <Folder size={17} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ws-title">Workspace</div>
            <div className="ws-sub">Файлы агента</div>
          </div>
          <IconButton
            icon={Upload}
            label="Загрузить файл"
            onClick={() => notify('Загрузка файлов — скоро')}
            size={16}
          />
          <IconButton icon={X} label="Закрыть" onClick={onClose} size={16} />
        </div>

        <div className="ws-body">
          {WORKSPACE_FILES.map((file, i) => {
            const Icon = ICONS[file.kind]
            return (
              <button
                key={file.id}
                type="button"
                className="ws-row"
                style={{ animationDelay: `${i * 35}ms` }}
                onClick={() => notify(`«${file.name}» — скоро`)}
              >
                <div className={`ws-icon${file.kind === 'folder' ? ' folder' : ''}`}>
                  <Icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ws-name">{file.name}</div>
                  <div className="ws-meta">{file.meta}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="ws-storage">
          <div className="ws-storage-row">
            <span>299 КБ</span>
            <span>1 ГБ</span>
          </div>
          <div className="storage-bar">
            <div className="storage-fill" style={{ width: '3%' }} />
          </div>
        </div>
      </aside>
    </>
  )
}
