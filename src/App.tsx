import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { BottomNav } from './components/BottomNav'
import { Topbar } from './components/Topbar'
import { CommandPalette, buildActions, type PaletteAction } from './components/CommandPalette'
import { Toast } from './components/Toast'
import { ChatView } from './views/ChatView'
import { AgentsView } from './views/AgentsView'
import { ToolsView } from './views/ToolsView'
import { SettingsView } from './views/SettingsView'
import { useTheme } from './hooks/useTheme'
import { generateReply, type ChatMessage } from './lib/mock'
import { getUser, haptic, isTelegram, type TgUser } from './lib/telegram'

export type ViewId = 'chat' | 'agents' | 'tools' | 'settings'

let msgSeq = 0
const nextId = () => `m${++msgSeq}-${Date.now()}`

export default function App() {
  const [view, setView] = useState<ViewId>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [model, setModel] = useState('pro')
  const [user, setUser] = useState<TgUser>(getUser())

  const { pref, resolved, setPref, toggle } = useTheme()

  // Данные пользователя приходят из Telegram после загрузки SDK
  useEffect(() => {
    setUser(getUser())
  }, [])

  const notify = useCallback((msg: string) => {
    setToast(msg)
  }, [])

  const navigate = useCallback((v: ViewId) => {
    haptic('select')
    setView(v)
  }, [])

  const newChat = useCallback(() => {
    haptic('medium')
    setMessages([])
    setTyping(false)
    setView('chat')
  }, [])

  const sendMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }])
    setTyping(true)
    window.setTimeout(() => {
      setTyping(false)
      setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: generateReply(text) }])
    }, 900 + Math.random() * 600)
  }, [])

  // ⌘K / Ctrl+K — командная палитра, ⌘N — новый чат
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
    notify,
  })

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={navigate}
        onNewChat={newChat}
        user={user}
        onProfile={() => navigate('settings')}
      />

      <div className="main">
        <Topbar
          view={view}
          resolvedTheme={resolved}
          onToggleTheme={toggle}
          onOpenPalette={() => setPaletteOpen(true)}
          onProfile={() => navigate('settings')}
          user={user}
        />

        <main className="content">
          {view === 'chat' ? (
            <div style={{ minHeight: '100%', display: 'flex' }}>
              <ChatView
                user={user}
                messages={messages}
                typing={typing}
                onSend={sendMessage}
              />
            </div>
          ) : null}
          {view === 'agents' ? (
            <AgentsView onOpen={(name) => notify(`«${name}» — скоро в эфире`)} />
          ) : null}
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

        <BottomNav view={view} onNavigate={navigate} />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={actions}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
