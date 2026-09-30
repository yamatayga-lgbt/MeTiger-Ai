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
import { fetchRealRuns } from './lib/stats'
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

// Чистый старт при каждой загрузке — без демо-данных и без сохранений.
function initialChats(): Chat[] {
  return [
    {
      id: 'c-start',
      title: NEW_CHAT_TITLE,
      messages: [],
      updatedAt: Date.now(),
    },
  ]
}

const emptyChat = (): Chat => ({
  id: newChatId(),
  title: NEW_CHAT_TITLE,
  messages: [],
  updatedAt: Date.now(),
})

export default function App() {
  const [view, setView] = useState<ViewId>('chat')
  const [chats, setChats] = useState<Chat[]>(initialChats)
  const [activeChatId, setActiveChatId] = useState<string>('c-start')
  const [typing, setTyping] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [user, setUser] = useState<TgUser>(getUser())
  const [realRuns, setRealRuns] = useState<number | null>(null)

  const { pref, resolved, setPref, toggle } = useTheme()

  useEffect(() => {
    setUser(getUser())
    void fetchRealRuns().then(setRealRuns)
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
    setTyping(false)
    setView('chat')
    setMenuOpen(false)
    setChats((prev) => {
      const kept = prev.filter((c) => c.messages.length > 0 || c.id === activeChatId)
      const active = kept.find((c) => c.id === activeChatId)
      // уже открыт пустой черновик — не создаём новый
      if (active && active.messages.length === 0) return kept
      const chat = emptyChat()
      setActiveChatId(chat.id)
      return [...kept.filter((c) => c.messages.length > 0), chat]
    })
  }, [activeChatId])

  const selectChat = useCallback((id: string) => {
    haptic('select')
    // пустые черновики выбрасываем — они не сохраняются
    setChats((prev) => prev.filter((c) => c.messages.length > 0 || c.id === id))
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
        // удаление окончательное: сам чат и пустые черновики уходят
        const next = prev.filter((c) => c.id !== id && c.messages.length > 0)
        if (next.length === 0) {
          const chat = emptyChat()
          setActiveChatId(chat.id)
          return [chat]
        }
        if (id === activeChatId) {
          setActiveChatId(next[0].id)
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

  const title = view === 'chat' ? activeChat?.title || NEW_CHAT_TITLE : TITLES[view]

  return (
    <div className="app">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        view={view}
        onNavigate={navigate}
        chats={chats.filter((c) => c.messages.length > 0)}
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
            <div className="chat-shell">
              <ChatView
                user={user}
                messages={activeChat?.messages ?? []}
                typing={typing}
                onSend={sendMessage}
              />
            </div>
          ) : null}
          {view === 'agent' ? <AgentView runs={realRuns} /> : null}
          {view === 'tools' ? <ToolsView /> : null}
          {view === 'settings' ? (
            <SettingsView
              user={user}
              themePref={pref}
              onThemePref={setPref}
              isTelegram={isTelegram()}
              notify={notify}
            />
          ) : null}
        </main>
      </div>

      <WorkspaceDrawer
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
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
