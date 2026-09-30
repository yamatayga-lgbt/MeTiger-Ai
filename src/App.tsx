import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { WorkspaceDrawer } from './components/WorkspaceDrawer'
import { CommandPalette, buildActions, type PaletteAction } from './components/CommandPalette'
import { Toast } from './components/Toast'
import { ChatView } from './views/ChatView'
import { AgentView } from './views/AgentView'
import { ToolsView } from './views/ToolsView'
import { SettingsView } from './views/SettingsView'
import { useTheme } from './hooks/useTheme'
import { generateReply, type ChatMessage } from './lib/mock'
import { getUser, haptic, isTelegram, type TgUser } from './lib/telegram'

export type ViewId = 'chat' | 'agent' | 'tools' | 'settings'

export interface Chat {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

const TITLES: Record<ViewId, string> = {
  chat: 'Чат',
  agent: 'Агент',
  tools: 'Инструменты',
  settings: 'Настройки',
}

let msgSeq = 0
const nextId = () => `m${++msgSeq}-${Date.now()}`
const newChatId = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const NEW_CHAT_TITLE = 'Новый чат'

function seedChats(): Chat[] {
  const now = Date.now()
  return [
    {
      id: 'c-demo-1',
      title: 'Дизайн интерфейса MeTiger Ai',
      updatedAt: now - 40 * 60 * 1000,
      messages: [
        {
          id: 'seed-1',
          role: 'user',
          text: 'Сделай минималистичный дизайн в духе Claude и Linear',
        },
        {
          id: 'seed-2',
          role: 'assistant',
          text: 'Принял! Основа дизайн-системы: тёплая светлая тема, тонкие границы, тигровый акцент и много воздуха. Всё уже собрано в этом превью — смотрите разделы «Агент» и «Инструменты».',
        },
      ],
    },
    {
      id: 'c-demo-2',
      title: 'Идеи для стартапа',
      updatedAt: now - 3 * 24 * 60 * 60 * 1000,
      messages: [],
    },
  ]
}

export default function App() {
  const [view, setView] = useState<ViewId>('chat')
  const [chats, setChats] = useState<Chat[]>(seedChats)
  const [activeChatId, setActiveChatId] = useState<string>('c-demo-1')
  const [typing, setTyping] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [model, setModel] = useState('pro')
  const [user, setUser] = useState<TgUser>(getUser())

  const { pref, resolved, setPref, toggle } = useTheme()

  useEffect(() => {
    setUser(getUser())
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)

  const notify = useCallback((msg: string) => setToast(msg), [])

  const navigate = useCallback((v: ViewId) => {
    haptic('select')
    setView(v)
    setMenuOpen(false)
  }, [])

  const newChat = useCallback(() => {
    haptic('medium')
    const chat: Chat = {
      id: newChatId(),
      title: NEW_CHAT_TITLE,
      messages: [],
      updatedAt: Date.now(),
    }
    setChats((prev) => [chat, ...prev])
    setActiveChatId(chat.id)
    setTyping(false)
    setView('chat')
    setMenuOpen(false)
  }, [])

  const selectChat = useCallback((id: string) => {
    haptic('select')
    setActiveChatId(id)
    setTyping(false)
    setView('chat')
    setMenuOpen(false)
  }, [])

  const renameChat = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: t } : c)))
  }, [])

  const deleteChat = useCallback(
    (id: string) => {
      haptic('medium')
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id)
        if (id === activeChatId) {
          if (next.length > 0) {
            setActiveChatId(next[0].id)
          } else {
            const chat: Chat = {
              id: newChatId(),
              title: NEW_CHAT_TITLE,
              messages: [],
              updatedAt: Date.now(),
            }
            setActiveChatId(chat.id)
            return [chat]
          }
        }
        return next
      })
      notify('Чат удалён')
    },
    [activeChatId, notify],
  )

  const sendMessage = useCallback(
    (text: string) => {
      const chatId = activeChatId
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title:
                  c.messages.length === 0 && c.title === NEW_CHAT_TITLE
                    ? text.slice(0, 48)
                    : c.title,
                messages: [...c.messages, { id: nextId(), role: 'user', text }],
                updatedAt: Date.now(),
              }
            : c,
        ),
      )
      setTyping(true)
      window.setTimeout(
        () => {
          setTyping(false)
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      { id: nextId(), role: 'assistant', text: generateReply(text) },
                    ],
                    updatedAt: Date.now(),
                  }
                : c,
            ),
          )
        },
        900 + Math.random() * 600,
      )
    },
    [activeChatId],
  )

  // ⌘K — палитра, ⌘N — новый чат, Esc — закрыть оверлеи
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newChat()
      } else if (e.key === 'Escape') {
        setPaletteOpen(false)
        setWorkspaceOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  const actions: PaletteAction[] = buildActions({
    navigate,
    newChat,
    toggleTheme: toggle,
    resolvedTheme: resolved,
    openWorkspace: () => setWorkspaceOpen(true),
    notify,
  })

  const title =
    view === 'chat' ? activeChat?.title || NEW_CHAT_TITLE : TITLES[view]

  return (
    <div className="app">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        view={view}
        onNavigate={navigate}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={selectChat}
        onNewChat={newChat}
        onRenameChat={renameChat}
        onDeleteChat={deleteChat}
        user={user}
        resolvedTheme={resolved}
        onToggleTheme={toggle}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="main">
        <Topbar
          title={title}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
        />

        <main className="content">
          {view === 'chat' ? (
            <div style={{ minHeight: '100%', display: 'flex' }}>
              <ChatView
                user={user}
                messages={activeChat?.messages ?? []}
                typing={typing}
                onSend={sendMessage}
              />
            </div>
          ) : null}
          {view === 'agent' ? <AgentView /> : null}
          {view === 'tools' ? <ToolsView /> : null}
          {view === 'settings' ? (
            <SettingsView
              user={user}
              themePref={pref}
              onThemePref={setPref}
              model={model}
              onModel={setModel}
              isTelegram={isTelegram()}
              notify={notify}
            />
          ) : null}
        </main>
      </div>

      <WorkspaceDrawer
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        notify={notify}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={actions}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
