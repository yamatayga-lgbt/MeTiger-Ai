import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { WorkspaceDrawer } from './components/WorkspaceDrawer'
import { CommandPalette, buildActions, type PaletteAction } from './components/CommandPalette'
import { Toast } from './components/Toast'
import { ChatView } from './views/ChatView'
import { AgentView } from './views/AgentView'
import { SettingsView } from './views/SettingsView'
import { useTheme } from './hooks/useTheme'
import { generateReply, type ChatMessage } from './lib/mock'
import { readGender, genderForRequest } from './lib/gender'
import { sendChat, sourceLine, adviceLine, attachLine, notesLine, type Attachment, type WebStep } from './lib/api'
import {
  loadActiveChatId,
  loadChats,
  loadView,
  saveChats,
} from './lib/persist'
import { fetchRealRuns } from './lib/stats'
import { haptic } from './lib/haptic'
import { siteUser, type Person } from './lib/user'
import { usePersistentState } from './hooks/usePersistentState'
import {
  DEFAULT_GEN_PARAMS,
  canModelThink,
  isGenParams,
  recordModelTelemetry,
  type GenParams,
  type ReasoningEffort,
} from './lib/models'

export type ViewId = 'chat' | 'agent' | 'settings'

export interface Chat {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

const TITLES: Record<ViewId, string> = {
  chat: 'Чат',
  agent: 'Агент',
  settings: 'Настройки',
}

let msgSeq = 0
const nextId = () => `m${++msgSeq}-${Date.now()}`
const newChatId = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const NEW_CHAT_TITLE = 'Новый чат'

const emptyChat = (): Chat => ({
  id: newChatId(),
  title: NEW_CHAT_TITLE,
  messages: [],
  updatedAt: Date.now(),
})

export default function App() {
  const [view, setView] = useState<ViewId>(() => loadView('chat'))
  const [chats, setChats] = useState<Chat[]>(() => loadChats(emptyChat))
  const [activeChatId, setActiveChatId] = useState<string>(() =>
    loadActiveChatId('c-start'),
  )
  const [typing, setTyping] = useState(false)
  /* черновик текущего ответа: приходит кусками из /api/chat, пока он идёт */
  const [draft, setDraft] = useState<string | null>(null)
  /* черновик рассуждений той же головы — отдельная строка над ответом, только когда
     человек сам попросил «думать вслух» */
  const [draftReasoning, setDraftReasoning] = useState<string | null>(null)
  /* сколько секунд шло рассуждение текущего черновика (для «Thought for N seconds») */
  const [draftThinkingSec, setDraftThinkingSec] = useState<number>(1)
  /* живые шаги веб-поиска и чтения страниц (Searching the web -> Searched for / Fetched) */
  const [draftWebSteps, setDraftWebSteps] = useState<WebStep[]>([])
  /* Это Агент, а не витрина чужих моделей: выбор модели убран из интерфейса
     (0.057) — движок сам решает, кем ответить, под капотом (model: '' = Авто).
     «Думает» стала постоянной функцией: включена всегда, когда авто-модель это
     умеет, — без тумблера и без эффекта выбора в UI. */
  const model = ''
  const reasoningOn = true
  const effort: ReasoningEffort = 'medium'
  /* параметры генерации: temperature, max_tokens, top_p */
  const [genParams, setGenParams] = usePersistentState<GenParams>(
    'mt-params',
    DEFAULT_GEN_PARAMS,
    isGenParams,
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [user, setUser] = useState<Person>(siteUser())
  const [realRuns, setRealRuns] = useState<number | null>(null)

  const { pref, resolved, setPref, toggle } = useTheme()

  useEffect(() => {
    setUser(siteUser())
    void fetchRealRuns().then(setRealRuns)
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)

  // Сохраняем реальные чаты, активный чат и раздел (только живые данные)
  useEffect(() => {
    saveChats(chats, activeChatId, view)
  }, [chats, activeChatId, view])

  // Починка ссылок: активный чат должен существовать
  useEffect(() => {
    if (chats.some((c) => c.id === activeChatId)) return
    const first = chats.find((c) => c.messages.length > 0)
    if (first) {
      setActiveChatId(first.id)
    } else {
      const chat = emptyChat()
      setChats([chat])
      setActiveChatId(chat.id)
    }
  }, [chats, activeChatId])

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
    setPaletteOpen(false)
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

  /* Ответ агента. Этап 1 переноса: имитация из mock.ts уступила место двигателю.
     Мока осталось ровно столько, чтобы «npm run dev» жил без ключей и без сети.
     В проде подмены нет: если движок не ответил, человек видит причину, а не
     красивый текст из таблички. */
  const sendMessage = useCallback(
    (text: string, images?: string[], attachments?: Attachment[]) => {
      const chatId = activeChatId
      const current = chats.find((c) => c.id === chatId)
      const history = (current?.messages ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }))
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [...c.messages, {
                  id: nextId(),
                  role: 'user',
                  text,
                  ...(images && images.length ? { images } : {}),
                  /* имена и вес — чтобы чат после перезагрузки показывал, что файл
                     отправляли; содержимое нужно только на сам запрос */
                  ...(attachments && attachments.length ? { docs: attachments.map((f) => ({ name: f.name, size: f.size })) } : {}),
                }],
                updatedAt: Date.now(),
              }
            : c,
        ),
      )
      const allowThink = reasoningOn && canModelThink(model)
      const startedAt = Date.now()
      let thinkEndedAt = 0
      setTyping(true)
      setDraft('')
      setDraftReasoning(allowThink ? '' : null)
      setDraftThinkingSec(1)
      setDraftWebSteps([])
      void (async () => {
        const r = await sendChat(text, history, {
          ...(images && images.length ? { images } : {}),
          ...(attachments && attachments.length ? { attachments } : {}),
          ...(model ? { model } : {}),
          gender: genderForRequest(readGender()),
          /* ответ показывается по мере чтения провайдера; null — попытка ушла в запасной
             пул, обрывки с экрана убираем */
          onDraft: (t) => setDraft(t),
          onWebSteps: (steps) => setDraftWebSteps(steps),
          ...(allowThink
            ? {
                onReasoning: (t: string | null) => {
                  if (t) {
                    thinkEndedAt = Date.now()
                    setDraftThinkingSec(Math.max(1, Math.round((thinkEndedAt - startedAt) / 1000)))
                  } else if (t === null) {
                    thinkEndedAt = 0
                  }
                  setDraftReasoning(t)
                },
                reasoningEffort: effort,
              }
            : {}),
          temperature: genParams.temperature,
          ...(genParams.maxTokens > 0 ? { maxTokens: genParams.maxTokens } : {}),
          topP: genParams.topP,
        })
        if (r.ok) {
          recordModelTelemetry(
            model || r.model,
            r.ms,
            (r.reply ? r.reply.length : 0) + (r.reasoning ? r.reasoning.length : 0),
          )
        }
        const finalThinkSec = Math.max(
          1,
          Math.round(((thinkEndedAt || Date.now()) - startedAt) / 1000),
        )
        const reply =
          r.ok && r.reply
            ? r.reply
            : import.meta.env.DEV
              ? generateReply(text) + '\n\n_демо-ответ: /api/chat не ответил (' + (r.error || 'нет связи') + ')_'
              : '⚠️ ' + (r.error || 'сервис не отвечает') + '. Это не ответ агента — движок сейчас недоступен.'
        const advice = r.ok ? adviceLine(r) : null
        const meta = r.ok
          ? {
              src: sourceLine(r),
              advice: advice?.text || '',
              adviceTone: advice?.tone,
              /* файлы и навыки живут только в этой сессии — см. persist: base64 в
                 localStorage кончает квоту молча и ломает сохранение всего чата */
              files: r.files && r.files.length ? r.files : undefined,
              fileError: r.fileError || undefined,
              skills: r.skills && r.skills.length ? r.skills : undefined,
              tools: r.tools && r.tools.length ? r.tools : undefined,
              ms: r.ms,
              /* что прочитали из вложений и чем оплатили окно — две строки под ответом */
              attach: r.ok ? attachLine(r) || undefined : undefined,
              /* те же вложения, но списком — для «Explored N reads» над ответом */
              reads: r.ok && Array.isArray(r.attachments) && r.attachments.length ? r.attachments : undefined,
              readNotes: r.ok && Array.isArray(r.attachNotes) && r.attachNotes.length ? r.attachNotes : undefined,
              notes: r.ok ? notesLine(r) || undefined : undefined,
              /* что модель передумала по дороге — над ответом, автоматически свёрнуто в <details>:
                 думать вслух — постоянная функция для думающих моделей */
              reasoning: r.ok && allowThink && r.reasoning ? String(r.reasoning).slice(0, 4000) : undefined,
              thinkingSec: r.ok && allowThink && r.reasoning ? finalThinkSec : undefined,
              /* проверенные ссылки из поиска/вики/новостей — кликабельны под ответом */
              sources: r.ok && Array.isArray(r.sources) && r.sources.length ? r.sources.slice(0, 8) : undefined,
              /* шаги веб-поиска (Searched for / Fetched) для блока Searching the web */
              webSteps: r.ok && Array.isArray(r.webSteps) && r.webSteps.length ? r.webSteps : undefined,
            }
          : ({} as { src?: string; advice?: string; adviceTone?: 'ok' | 'warn' | 'quiet' })
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: [...c.messages, { id: nextId(), role: 'assistant', text: reply, ...meta }],
                  updatedAt: Date.now(),
                }
              : c,
          ),
        )
        setTyping(false)
        setDraft(null)
        setDraftReasoning(null)
        setDraftWebSteps([])
        /* поток мог оборваться в самом конце: текст на экране, хвоста нет — это
           не причина звать ответ неудачным, но сказать про него надо */
        if (r.ok && r.streamError) setToast('хвост ответа не дописан: ' + r.streamError)
      })()
    },
    [activeChatId, chats, model, reasoningOn, effort, genParams],
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
                key={activeChatId}
                user={user}
                messages={activeChat?.messages ?? []}
                typing={typing}
                draft={draft}
                draftReasoning={draftReasoning}
                draftThinkingSec={draftThinkingSec}
                draftWebSteps={draftWebSteps}
                onSend={sendMessage}
                genParams={genParams}
                onGenParamsChange={setGenParams}
              />
            </div>
          ) : null}
          {view === 'agent' ? <AgentView runs={realRuns} /> : null}
          {view === 'settings' ? (
            <SettingsView
              user={user}
              themePref={pref}
              onThemePref={setPref}
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
