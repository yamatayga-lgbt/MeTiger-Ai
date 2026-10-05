import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Folder, PanelLeft, PenLine, Trash2 } from 'lucide-react'
import { IconButton } from './ui'
import { haptic } from '../lib/haptic'

interface TopbarProps {
  title: string
  onOpenMenu: () => void
  onOpenWorkspace: () => void
  /** Переименовать/удалить ТЕКУЩИЙ чат прямо с капсулы в шапке — есть только на
      экране чата. На «Настройках» и прочих разделах их не передают: там у
      заголовка нет своего чата, который можно было бы переименовать или удалить,
      и капсула превращается обратно в обычную неактивную подпись раздела. */
  onRenameChat?: (title: string) => void
  onDeleteChat?: () => void
}

/** Верхняя панель: круглая кнопка меню слева, капсула с названием чата по центру
    (вместо апселла подписки у ChatGPT — у нас всё бесплатно), круглая кнопка
    Workspace справа. Капсула кликабельна только на экране чата: открывает то же
    меню «Переименовать / Удалить», что и у пункта чата в боковом меню — здесь
    оно просто ближе под рукой, без необходимости открывать сайдбар. */
export function Topbar({ title, onOpenMenu, onOpenWorkspace, onRenameChat, onDeleteChat }: TopbarProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const interactive = Boolean(onRenameChat || onDeleteChat)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  useEffect(() => {
    // сменился чат (или вышли из экрана чата) — не оставляем чужое меню/поле на экране
    setMenu(null)
    setRenaming(false)
  }, [title])

  const commitRename = () => {
    const t = draft.trim()
    if (t && onRenameChat) onRenameChat(t)
    setRenaming(false)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-side topbar-left">
          <IconButton
            icon={PanelLeft}
            label="Меню"
            onClick={onOpenMenu}
            className="topbar-round only-mobile"
          />
        </div>

        {renaming ? (
          <div className="topbar-pill topbar-pill-editing">
            <input
              ref={inputRef}
              className="rename-input"
              value={draft}
              maxLength={48}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          </div>
        ) : interactive ? (
          <button
            type="button"
            className="topbar-pill"
            title={title}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(e) => {
              haptic('light')
              const rect = e.currentTarget.getBoundingClientRect()
              setMenu((m) => (m ? null : { x: rect.left + rect.width / 2, y: rect.bottom }))
            }}
          >
            <span>{title}</span>
            <ChevronDown size={14} />
          </button>
        ) : (
          // Не экран чата (например, «Настройки») — переименовывать и удалять
          // нечего, капсула просто подписывает раздел, без кнопки под ней.
          <div className="topbar-pill topbar-pill-static" title={title}>
            <span>{title}</span>
          </div>
        )}

        <div className="topbar-side topbar-right">
          <IconButton
            icon={Folder}
            label="Workspace"
            onClick={onOpenWorkspace}
            className="topbar-round"
          />
        </div>
      </header>

      {menu ? (
        <>
          <div className="menu-catcher" onClick={() => setMenu(null)} />
          <div
            className="chat-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: menu.y + 6,
              left: Math.max(8, Math.min(menu.x - 88, window.innerWidth - 184)),
            }}
          >
            {onRenameChat ? (
              <button
                type="button"
                onClick={() => {
                  setMenu(null)
                  setDraft(title)
                  setRenaming(true)
                }}
              >
                <PenLine size={14} />
                Переименовать
              </button>
            ) : null}
            {onDeleteChat ? (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setMenu(null)
                  onDeleteChat()
                }}
              >
                <Trash2 size={14} />
                Удалить
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  )
}
