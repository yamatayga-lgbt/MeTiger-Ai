import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { WorkspaceDrawer } from './components/WorkspaceDrawer'
import { CommandPalette, buildActions, type PaletteAction } from './components/CommandPalette'
import { Toast } from './components/Toast'
import { CaseEditorModal } from './components/CaseEditorModal'
import { ChatView } from './views/ChatView'
import { CasesView } from './views/CasesView'
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })))
const UsageView = lazy(() => import('./views/UsageView').then((m) => ({ default: m.UsageView })))
const WhatsNewView = lazy(() => import('./views/WhatsNewView').then((m) => ({ default: m.WhatsNewView })))
import { WhatsNewModal } from './components/WhatsNewModal'
import { useTheme } from './hooks/useTheme'
import { APP_VERSION } from './lib/version'
import { noteFor } from './lib/release-notes'
import { generateReply, type ChatMessage } from './lib/mock'
import { readGender, genderForRequest } from './lib/gender'
import { sendChat, forgetThread, sourceLine, adviceLine, attachLine, notesLine, type Attachment, type WebStep } from './lib/api'
import {
  hydrateChatMedia,
  loadActiveChatId,
  loadChats,
  loadView,
  saveChats,
} from './lib/persist'
import { deleteMedia, mediaIdsOfMessage } from './lib/chatMedia'
import { caseContext, draftCaseFromChat, loadCases, newCaseDraft, saveCases, type CaseFile } from './lib/cases'
import { haptic } from './lib/haptic'
import { siteUser, type Person } from './lib/user'
import { usePersistentState } from './hooks/usePersistentState'
import {
  DEFAULT_GEN_PARAMS,
  canModelThink,
  isGenParams,
  recordModelTelemetry,
  withGenParamDefaults,
  type GenParams,
  type ReasoningEffort,
} from './lib/models'

export type ViewId = 'chat' | 'cases' | 'settings' | 'usage' | 'whatsnew'

export interface Chat {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

const TITLES: Record<ViewId, string> = {
  chat: 'Чат',
  cases: 'Дела',
  settings: 'Настройки',
  usage: 'Использование и Лимиты',
  whatsnew: 'Что нового',
}

/* Прочитанные версии «Что нового» — на устройстве. Точка на пункте гаснет, как
   только человек открыл экран: держать её «пока не понравится» значило бы
   приучать не замечать точке вовсе. */
const NEWS_KEY = 'mt-news-seen'

function readNewsSeen(): string {
  try {
    return String(localStorage.getItem(NEWS_KEY) || '')
  } catch {
    return ''
  }
}

function writeNewsSeen(version: string): void {
  try {
    localStorage.setItem(NEWS_KEY, version)
  } catch {
    /* приватный режим: окошко просто вернётся — это не повод ломать экран */
  }
}

/**
 * Показывать ли окошко «Что нового» при запуске.
 *
 * Показываем, только если на устройстве запомнена ДРУГАЯ версия, — то есть был
 * факт обновления. На первом заходе (запомненной версии нет вовсе) окошко молчит
 * и текущая версия сразу помечается прочитанной: встречать нового человека
 * списком изменений невежливо, ему нужен чат, а не релиз-ноты.
 */
function shouldShowNews(): boolean {
  const seen = readNewsSeen()
  if (!seen) {
    writeNewsSeen(APP_VERSION)
    return false
  }
  return seen !== APP_VERSION && !!noteFor(APP_VERSION)
}

let msgSeq = 0
const nextId = () => `m${++msgSeq}-${Date.now()}`
const newChatId = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const NEW_CHAT_TITLE = 'Новый чат'
/** Название чата — не длиннее 30 символов (просьба владельца, 0.140). */
const TITLE_MAX = 30
/** Автоназвание из первого сообщения: одна строка, обрезка по слову, «…» в конце. */
function titleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return NEW_CHAT_TITLE
  if (t.length <= TITLE_MAX) return t
  const cut = t.slice(0, TITLE_MAX - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 25 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, '') + '…'
}

const emptyChat = (): Chat => ({
  id: newChatId(),
  title: NEW_CHAT_TITLE,
  messages: [],
  updatedAt: Date.now(),
})

export default function App() {
  const [view, setView] = useState<ViewId>(() => loadView('chat'))
  const [chats, setChats] = useState<Chat[]>(() => loadChats(emptyChat))
  const [cases, setCases] = useState<CaseFile[]>(() => loadCases())
  const [caseEditorDraft, setCaseEditorDraft] = useState<CaseFile | null>(null)
  const [activeChatId, setActiveChatId] = useState<string>(() =>
    loadActiveChatId('c-start'),
  )
  const [typing, setTyping] = useState(false)
  /* Запрос, который сейчас в полёте — чтобы кнопка «Остановить» реально обрывала
     именно его, а не просто прятала «Печатает» на экране. Один слот: второй запрос
     поверх первого не копим (submit() в ChatView сам это проверяет через typing). */
  const abortRef = useRef<AbortController | null>(null)
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
  /* Ни состояния «Размышлять глубже», ни авточтения, ни выбора голоса здесь больше
     нет (0.121–0.123). Глубину размышления выбирает агент по самому вопросу
     (engine/depth.js) и присылает причину событием потока и полем depthWhy —
     хранить в браузере нечего: решение принимается на каждый вопрос заново. */
  /* параметры генерации: temperature, max_tokens, top_p, presence/frequency penalty */
  const [genParamsRaw, setGenParams] = usePersistentState<GenParams>(
    'mt-params',
    DEFAULT_GEN_PARAMS,
    isGenParams,
  )
  /* penalty-поля появились в 0.070 — у кого эти настройки сохранились ДО обновления,
     объект из localStorage их не содержит; без этой подстановки `undefined.toFixed()`
     в ParamsPopover уронил бы попап первым же открытием у старых пользователей. */
  const genParams = withGenParamDefaults(genParamsRaw)
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [user, setUser] = useState<Person>(siteUser())

  const { pref, resolved, setPref, toggle } = useTheme()
  const [newsSeen, setNewsSeen] = useState<string>(() => readNewsSeen())
  /* Окошко «что нового после обновления». Решение принимается один раз при
     запуске: версия запомнена другой — значит человек только что обновился. */
  const [newsOpen, setNewsOpen] = useState<boolean>(() => shouldShowNews())
  const newsNote = noteFor(APP_VERSION)

  useEffect(() => {
    setUser(siteUser())
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)
  const activeCase = cases.find((item) => item.chatId === activeChatId)

  // Сохраняем реальные чаты, активный чат и раздел (только живые данные)
  useEffect(() => {
    saveChats(chats, activeChatId, view)
  }, [chats, activeChatId, view])

  useEffect(() => {
    saveCases(cases)
  }, [cases])

  // Разовая подгрузка настоящих байт картинок/файлов из IndexedDB поверх
  // текста, который уже отрисован из localStorage — короткая вспышка
  // «картинки ещё грузятся» при холодном старте приемлема, лишь бы сама
  // переписка открывалась мгновенно, как раньше.
  useEffect(() => {
    let cancelled = false
    void hydrateChatMedia(chats).then((hydrated) => {
      if (cancelled) return
      setChats((cur) => (cur === chats ? hydrated : cur))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  /* Кнопка «Остановить» на композере: реально обрывает сетевой запрос, а не просто
     прячет индикатор — sendChat() увидит это через opts.signal и пометит r.stopped. */
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /* Открыли «Что нового» — считаем версию прочитанной (точка гаснет). */
  useEffect(() => {
    if (view !== 'whatsnew' || newsSeen === APP_VERSION) return
    writeNewsSeen(APP_VERSION)
    setNewsSeen(APP_VERSION)
  }, [view, newsSeen])

  /* Закрыли окошко любым из способов (крестик, кнопка, клик мимо, Escape) —
     версия прочитана, и до следующего обновления окошко не появится. */
  const closeNews = useCallback(() => {
    writeNewsSeen(APP_VERSION)
    setNewsSeen(APP_VERSION)
    setNewsOpen(false)
  }, [])

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
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: t.slice(0, TITLE_MAX) } : c)))
  }, [])

  const openCaseEditor = useCallback((chatId?: string, target?: CaseFile) => {
    const linked = target || (chatId ? cases.find((item) => item.chatId === chatId) : undefined)
    const chat = chatId ? chats.find((item) => item.id === chatId) : undefined
    if (chat) {
      setCaseEditorDraft(draftCaseFromChat(chat, linked))
      return
    }
    setCaseEditorDraft(linked ? { ...linked } : newCaseDraft())
  }, [cases, chats])

  const saveCase = useCallback((next: CaseFile) => {
    setCases((prev) => [next, ...prev.filter((item) => item.id !== next.id)])
    setCaseEditorDraft(null)
    notify('Контрольная точка сохранена')
  }, [notify])

  const toggleCaseStatus = useCallback((item: CaseFile) => {
    const status = item.status === 'done' ? 'active' : 'done'
    setCases((prev) => prev.map((current) => current.id === item.id
      ? { ...current, status, updatedAt: Date.now() }
      : current))
    notify(status === 'done' ? 'Дело завершено' : 'Дело снова в работе')
  }, [notify])

  const continueCase = useCallback((item: CaseFile) => {
    const linkedChat = item.chatId ? chats.find((chat) => chat.id === item.chatId) : undefined
    if (linkedChat) {
      selectChat(linkedChat.id)
      setCases((prev) => prev.map((current) => current.id === item.id && current.status === 'done'
        ? { ...current, status: 'active', updatedAt: Date.now() }
        : current))
      return
    }
    haptic('select')
    const openDraft = chats.find((chat) => chat.id === activeChatId && chat.messages.length === 0)
    const draft = openDraft && !cases.some((current) => current.id !== item.id && current.chatId === openDraft.id)
      ? openDraft
      : emptyChat()
    setChats((prev) => prev.some((chat) => chat.id === draft.id)
      ? prev
      : [...prev.filter((chat) => chat.messages.length > 0), draft])
    setActiveChatId(draft.id)
    setCases((prev) => prev.map((current) => current.id === item.id
      ? { ...current, chatId: draft.id, status: 'active', updatedAt: Date.now() }
      : current))
    setTyping(false)
    setView('chat')
    setMenuOpen(false)
  }, [activeChatId, cases, chats, selectChat])

  const deleteChat = useCallback(
    (id: string, showNotification = true) => {
      haptic('medium')
      // забыть вклад именно этого чата на сервере (факты, транскрипт, подстройка),
      // не всю память человека — другие его чаты её по-прежнему разделяют.
      // Best-effort и не блокирует удаление: см. комментарий в lib/api.ts
      forgetThread(id)
      // Карточка дела остаётся, но теряет ссылку на удалённый разговор;
      // «Продолжить» откроет новый чат и передаст туда её сохранённый контекст.
      setCases((prev) => prev.map((item) => item.chatId === id ? { ...item, chatId: undefined } : item))
      setChats((prev) => {
        // удаление окончательное: сам чат и пустые черновики уходят
        const removed = prev.find((c) => c.id === id)
        if (removed) {
          // чтобы IndexedDB не копила байты удалённых переписок годами
          deleteMedia(removed.messages.flatMap(mediaIdsOfMessage))
        }
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
      if (showNotification) notify('Чат удалён')
    },
    [activeChatId, notify],
  )

  const deleteCase = useCallback((item: CaseFile) => {
    setCases((prev) => prev.filter((current) => current.id !== item.id))
    if (item.chatId) {
      deleteChat(item.chatId, false)
      notify('Дело и связанная переписка удалены')
    } else {
      notify('Дело удалено')
    }
  }, [deleteChat, notify])

  /* Ответ агента. Этап 1 переноса: имитация из mock.ts уступила место двигателю.
     Мока осталось ровно столько, чтобы «npm run dev» жил без ключей и без сети.
     В проде подмены нет: если движок не ответил, человек видит причину, а не
     красивый текст из таблички. */
  const sendMessage = useCallback(
    (text: string, images?: string[], attachments?: Attachment[]) => {
      const chatId = activeChatId
      const current = chats.find((c) => c.id === chatId)
      const linkedCase = cases.find((item) => item.chatId === chatId)
      const history = (current?.messages ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }))
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title: c.messages.length === 0 && c.title === NEW_CHAT_TITLE ? titleFromText(text || (attachments && attachments[0] ? attachments[0].name : '')) : c.title,
                messages: [...c.messages, {
                  id: nextId(),
                  role: 'user',
                  text,
                  ts: Date.now(),
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
      const ac = new AbortController()
      abortRef.current = ac
      void (async () => {
        const r = await sendChat(text, history, {
          signal: ac.signal,
          threadId: chatId,
          ...(linkedCase ? { caseContext: caseContext(linkedCase) } : {}),
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
                /* Усилие рассуждения — настройка человека. Глубину (и «сколько
                   думать») с 0.123 выбирает агент на сервере: он сам поднимает
                   усилие, когда судья глубины поднял глубину. */
                reasoningEffort: effort,
              }
            : {}),
          temperature: genParams.temperature,
          ...(genParams.maxTokens > 0 ? { maxTokens: genParams.maxTokens } : {}),
          topP: genParams.topP,
          presencePenalty: genParams.presencePenalty,
          frequencyPenalty: genParams.frequencyPenalty,
        })
        if (r.ok) {
          recordModelTelemetry(
            model || r.model,
            r.ms,
            (r.reply ? r.reply.length : 0) + (r.reasoning ? r.reasoning.length : 0),
          )
        }
        if (abortRef.current === ac) abortRef.current = null
        if (r.stopped) {
          /* Остановили сами — это не сбой движка и не демо-ответ, в чат ничего
             дописывать не нужно: просто убираем «Печатает» и говорим короткое слово. */
          setTyping(false)
          setDraft(null)
          setDraftReasoning(null)
          setDraftWebSteps([])
          setToast('Остановлено')
          return
        }
        const finalThinkSec = Math.max(
          1,
          Math.round(((thinkEndedAt || Date.now()) - startedAt) / 1000),
        )
        /* Неполный ответ (поток оборвался, но текст успел прийти) показываем как
           есть: он настоящий, человек его уже читал. Пометка об обрыве уходит
           отдельной строкой под пузырём — не вместо ответа. */
        const reply =
          r.reply && (r.ok || r.partial)
            ? r.reply
            : import.meta.env.DEV
              ? generateReply(text) + '\n\n_демо-ответ: /api/chat не ответил (' + (r.error || 'нет связи') + ')_'
              : '⚠️ ' + (r.error || 'сервис не отвечает') + '. Это не ответ агента — движок сейчас недоступен.'
        const advice = r.ok ? adviceLine(r) : null
        const meta = r.ok || r.partial
          ? {
              src: sourceLine(r),
              advice: advice?.text || '',
              adviceTone: advice?.tone,
              /* файлы и навыки живут только в этой сессии — см. persist: base64 в
                 localStorage кончает квоту молча и ломает сохранение всего чата */
              files: r.files && r.files.length ? r.files : undefined,
              fileError: r.fileError || undefined,
              /* обрыв потока: текст оставляем, про неполноту говорим снизу */
              warn: r.partial ? '⚠️ Ответ неполный: ' + (r.error || 'хвост не пришёл') : undefined,
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
              reasoning: (r.ok || r.partial) && allowThink && r.reasoning ? String(r.reasoning).slice(0, 4000) : undefined,
              thinkingSec: (r.ok || r.partial) && allowThink && r.reasoning ? finalThinkSec : undefined,
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
                  messages: [...c.messages, { id: nextId(), role: 'assistant', text: reply, ts: Date.now(), ...meta }],
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
    [activeChatId, cases, chats, model, reasoningOn, effort, genParams],
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
        newsDot={newsSeen !== APP_VERSION}
      />

      <div className="main">
        <Topbar
          title={title}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
          {...(view === 'chat'
            ? {
                onRenameChat: (t: string) => renameChat(activeChatId, t),
                onDeleteChat: () => deleteChat(activeChatId),
                ...(activeChat && activeChat.messages.length > 0
                  ? {
                      onSaveCase: () => openCaseEditor(activeChatId),
                      saveCaseLabel: activeCase ? 'Обновить дело' : 'Записать как дело',
                    }
                  : {}),
              }
            : {})}
        />

        <main className={`content${view === 'settings' ? ' settings-scroll' : ''}`}>
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
                onStop={stopGeneration}
                genParams={genParams}
                onGenParamsChange={setGenParams}
              />
            </div>
          ) : null}
          {view === 'cases' ? (
            <CasesView
              cases={cases}
              chats={chats}
              onNew={() => openCaseEditor()}
              onEdit={(item) => openCaseEditor(item.chatId, item)}
              onContinue={continueCase}
              onToggleStatus={toggleCaseStatus}
              onDelete={deleteCase}
            />
          ) : null}
          <Suspense fallback={null}>
          {view === 'settings' ? (
            <SettingsView
              user={user}
              themePref={pref}
              onThemePref={setPref}
              notify={notify}
            />
          ) : null}
          {view === 'usage' ? <UsageView /> : null}
          {view === 'whatsnew' ? <WhatsNewView /> : null}
          </Suspense>
        </main>
      </div>

      <WorkspaceDrawer
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
      />

      <CaseEditorModal
        open={caseEditorDraft !== null}
        initial={caseEditorDraft}
        onClose={() => setCaseEditorDraft(null)}
        onSave={saveCase}
      />

      {/* Окошко поверх всего: человек вернулся в обновлённое приложение и первым
          делом видит, что изменилось. Крестик закрывает. */}
      {newsOpen && newsNote ? <WhatsNewModal note={newsNote} onClose={closeNews} /> : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={actions}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
