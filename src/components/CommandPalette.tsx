import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  Command,
  MessageSquarePlus,
  Moon,
  Puzzle,
  Settings,
  Sun,
} from 'lucide-react'
import type { IconType } from './ui'
import type { ViewId } from '../App'

export interface PaletteAction {
  id: string
  label: string
  icon: IconType
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  actions: PaletteAction[]
}

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter((a) => a.label.toLowerCase().includes(q))
  }, [actions, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  if (!open) return null

  const execute = (i: number) => {
    const action = filtered[i]
    if (!action) return
    onClose()
    action.run()
  }

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Команды">
        <div className="palette-input-row">
          <Command size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Введите команду или раздел…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                execute(index)
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">Ничего не найдено</div>
          ) : (
            filtered.map((action, i) => (
              <button
                key={action.id}
                type="button"
                className={`palette-item${i === index ? ' selected' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => execute(i)}
              >
                <action.icon size={16} />
                {action.label}
                {action.hint ? <span className="hint">{action.hint}</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> навигация
          </span>
          <span>
            <kbd>↵</kbd> открыть
          </span>
          <span>
            <kbd>Esc</kbd> закрыть
          </span>
        </div>
      </div>
    </div>
  )
}

export function buildActions({
  navigate,
  newChat,
  toggleTheme,
  resolvedTheme,
  notify,
}: {
  navigate: (v: ViewId) => void
  newChat: () => void
  toggleTheme: () => void
  resolvedTheme: 'light' | 'dark'
  notify: (msg: string) => void
}): PaletteAction[] {
  return [
    {
      id: 'new-chat',
      label: 'Новый чат',
      icon: MessageSquarePlus,
      hint: '⌘N',
      run: newChat,
    },
    {
      id: 'go-chat',
      label: 'Перейти в чат',
      icon: MessageSquarePlus,
      run: () => navigate('chat'),
    },
    {
      id: 'go-agent',
      label: 'Профиль агента',
      icon: Bot,
      run: () => navigate('agent'),
    },
    {
      id: 'go-tools',
      label: 'Перейти к инструментам',
      icon: Puzzle,
      run: () => navigate('tools'),
    },
    {
      id: 'go-settings',
      label: 'Открыть настройки',
      icon: Settings,
      run: () => navigate('settings'),
    },
    {
      id: 'toggle-theme',
      label: resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
      icon: resolvedTheme === 'dark' ? Sun : Moon,
      run: toggleTheme,
    },
    {
      id: 'about',
      label: 'О MeTiger Ai',
      icon: ArrowLeftRight,
      hint: 'v0.1.0',
      run: () => notify('MeTiger Ai · дизайн-превью v0.1.0'),
    },
  ]
}
