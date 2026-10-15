import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { WorkspaceDrawer } from './components/WorkspaceDrawer'
import { CommandPalette, buildActions, type PaletteAction } from './components/CommandPalette'
import { Toast } from './components/Toast'
import { ChatView } from './views/ChatView'
/* Экраны грузятся отдельными файлами. lazyView вместо голого lazy (0.157):
   если вкладка открыта с прошлой выкладки, файл старой версии уже удалён — это
   не ошибка приложения, а отставание на версию, и лечится перезагрузкой
   (см. lib/chunkReload.ts). */
const ProfileView = lazyView(() => import('./views/ProfileView').then((m) => ({ default: m.ProfileView })))
const PersonalizationView = lazyView(() => import('./views/PersonalizationView').then((m) => ({ default: m.PersonalizationView })))
const MemoryView = lazyView(() => import('./views/MemoryView').then((m) => ({ default: m.MemoryView })))
const DataView = lazyView(() => import('./views/DataView').then((m) => ({ default: m.DataView })))
const InfoView = lazyView(() => import('./views/InfoView').then((m) => ({ default: m.InfoView })))
const UsageView = lazyView(() => import('./views/UsageView').then((m) => ({ default: m.UsageView })))
const WhatsNewView = lazyView(() => import('./views/WhatsNewView').then((m) => ({ default: m.WhatsNewView })))
/* «Обращения» (0.173) — служебный экран владельца. Грузится отдельным файлом,
   как и остальные экраны: у обычного человека он не откроется ниоткуда, и
   качать его вместе с чатом незачем. */
const ReportsView = lazyView(() => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })))
/* «Админ» (0.176) — устройства и обращения владельцу. Отдельным файлом по той же
   причине: обычному человеку этот экран не нужен и грузить его незачем. */
const AdminView = lazyView(() => import('./views/AdminView').then((m) => ({ default: m.AdminView })))
import { WhatsNewModal } from './components/WhatsNewModal'
import { IdCard } from './components/IdCard'
import { useTheme } from './hooks/useTheme'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { APP_VERSION } from './lib/version'
import { noteFor } from './lib/release-notes'
import { generateReply, type ChatMessage } from './lib/mock'
import { readGender, genderForRequest } from './lib/gender'
import { readPersona, personaForRequest } from './lib/persona'
import { sendChat, forgetThread, sourceLine, adviceLine, attachLine, notesLine, type Attachment, type WebStep, type ImageStep, type ChatResult } from './lib/api'
import {
  hydrateChatMedia,
  loadActiveChatId,
  loadChats,
  loadView,
  saveChats,
  sweepDeadKeys,
} from './lib/persist'
import { deleteMedia, mediaIdsOfMessage } from './lib/chatMedia'
import { haptic } from './lib/haptic'
import { lazyView } from './lib/chunkReload'
import { usePWAUpdate } from './hooks/usePWAUpdate'
import { idAsked, markIdAsked, pingDevice, type MyDevice } from './lib/devid'
import { ownerEnabled } from './lib/report'
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

export type ViewId =
  | 'chat'
  | 'usage'
  | 'whatsnew'
  /* Профиль и всё, что открывается из него. С 0.159 профиль — это и есть
     настройки: отдельный экран настроек убран, четыре его пункта переехали
     сюда (просьба владельца: «Профиль и будет читаться как Настройки»). */
  | 'profile'
  | 'personalization'
  | 'memory'
  | 'data'
  | 'info'
  /* «Обращения» и «Админ» — экраны владельца: без кода они не откроются ни из
     профиля, ни отсюда. Тип нужен всем, потому что маршрут один на всё приложение. */
  | 'reports'
  | 'admin'

export interface Chat {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

const TITLES: Record<ViewId, string> = {
  chat: 'Чат',
  usage: 'Использование и Лимиты',
  whatsnew: 'Что нового',
  profile: 'Профиль',
  personalization: 'Персонализация',
  memory: 'Память',
  data: 'Управление данными',
  info: 'Информация',
  reports: 'Обращения',
  admin: 'Админ',
}

/* Экраны, которые нельзя рисовать «въезжающей» анимацией: списки на весь экран
   мигают и дёргаются при входе (см. комментарий к .settings-scroll в styles). */
const NO_ANIM_VIEWS: ViewId[] = ['profile', 'personalization', 'memory', 'data', 'info', 'reports', 'admin']

/* Куда ведёт стрелка «назад» на вложенных экранах. Не история посещений, а
   постоянный маршрут: с любого экрана назад — туда, откуда в него попадают.
   Так поведение стрелки всегда можно объяснить словами, а не вспоминать. */
const BACK_TO: Partial<Record<ViewId, ViewId>> = {
  profile: 'chat',
  personalization: 'profile',
  memory: 'profile',
  data: 'profile',
  info: 'profile',
  reports: 'profile',
  admin: 'profile',
  /* «Использование и лимиты» открывается строкой в профиле — из сайдбара этот
     пункт убран (0.159): расход и так виден в профиле, дублировать не нужно. */
  usage: 'profile',
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
  /* Этапы рисования картинки (0.177): человек видит «рисую…» и «канал 2 из 3»,
     а не пустое ожидание на минуту. Гасится вместе с черновиком. */
  const [draftImgSteps, setDraftImgSteps] = useState<ImageStep[]>([])
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
  /* Контекст последнего ответа (0.170): сколько токенов занял запрос и в какое окно
     он влез. Живёт до смены чата — старые числа не должны выглядеть текущими, поэтому
     чистим их при переключении разговора и при новом чате. */
  const [user, setUser] = useState<Person>(siteUser())
  /* 0.176: ID устройства и его карточка. Владелец просил: вместо профилей — ID,
     устройство узнаётся по телефону, у него самого ID #Dev и доступ разработчика. */
  const [device, setDevice] = useState<MyDevice | null>(null)
  const [idCard, setIdCard] = useState(false)
  const owner = ownerEnabled()

  const { pref, resolved, setPref, toggle } = useTheme()
  /* Обновление смахиванием вниз: оболочка заперта (0.143), палец двигает только
     индикатор-кружок — см. hooks/usePullToRefresh.ts. */
  const ptrRef = useRef<HTMLDivElement>(null)
  usePullToRefresh(ptrRef)
  const [newsSeen, setNewsSeen] = useState<string>(() => readNewsSeen())
  /* Окошко «что нового после обновления». Решение принимается один раз при
     запуске: версия запомнена другой — значит человек только что обновился. */
  const [newsOpen, setNewsOpen] = useState<boolean>(() => shouldShowNews())
  const newsNote = noteFor(APP_VERSION)
  
  // Автообновление PWA
  const { hasUpdate, skipWaiting } = usePWAUpdate({
    onUpdateAvailable: (version) => {
      setToast(`Доступна новая версия ${version}. Нажмите для обновления.`)
    },
    checkInterval: 3600000, // Проверка раз в час
  })

  useEffect(() => {
    setUser(siteUser())
    /* Стереть то, что осталось на устройстве от старых версий (mt-talk, старый
       отпечаток) — «старые данные, которые хранятся до сих пор», 0.189. */
    sweepDeadKeys()
  }, [])

  /* Визит на сервер: он запоминает модель телефона, версию и время захода — это
     и есть «данные для устройства» в админ-панели. Заодно владельцу сервер
     ставит ID #Dev: «у меня сразу будет стоять айди». */
  const refreshDevice = () => {
    void pingDevice(true).then((d) => {
      if (!d) return
      setDevice(d)
      setUser(siteUser())
    })
  }

  useEffect(() => {
    let alive = true
    void pingDevice().then((d) => {
      if (!alive || !d) return
      setDevice(d)
      setUser(siteUser())
      /* ID ещё не выбран и про него не спрашивали — показываем карточку один раз. */
      if (!d.id && !idAsked()) setIdCard(true)
    })
    /* После служебного входа (или выключения) спрашиваем сервер заново: именно он
       ставит ID #Dev владельцу, и увидеть это надо сразу, а не при следующем старте. */
    const onOwner = () => refreshDevice()
    window.addEventListener('mt-owner', onOwner)
    return () => {
      alive = false
      window.removeEventListener('mt-owner', onOwner)
    }
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)

  // Сохраняем реальные чаты, активный чат и раздел (только живые данные)
  useEffect(() => {
    saveChats(chats, activeChatId, view)
  }, [chats, activeChatId, view])

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

  /* Стереть переписку, вложения и настройки НА УСТРОЙСТВЕ. Перезагрузка — часть
     смысла: половина состояния (активный чат, кэш вложений) держится в памяти
     вкладки, и без перезагрузки оно вернулось бы поверх пустого хранилища. */
  const wipeLocal = useCallback(() => {
    try {
      localStorage.clear()
    } catch {
      /* приватный режим — чистить нечего */
    }
    void Promise.allSettled(
      ['metiger-chat-media', 'metiger-attach-history'].map(
        (name) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = req.onerror = req.onblocked = () => resolve(null)
          }),
      ),
    ).then(() => location.reload())
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

  const deleteChat = useCallback(
    (id: string, showNotification = true) => {
      haptic('medium')
      // забыть вклад именно этого чата на сервере (факты, транскрипт, подстройка),
      // не всю память человека — другие его чаты её по-прежнему разделяют.
      // Best-effort и не блокирует удаление: см. комментарий в lib/api.ts
      forgetThread(id)
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

  /* Ответ агента. Этап 1 переноса: имитация из mock.ts уступила место двигателю.
     Мока осталось ровно столько, чтобы «npm run dev» жил без ключей и без сети.
     В проде подмены нет: если движок не ответил, человек видит причину, а не
     красивый текст из таблички. */
  /* Смена разговора — цифры контекста прошлого разговора больше не правда. */
  useEffect(() => {}, [activeChatId])

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
      /* Время до первого слова (0.164): первый непустой кусок черновика. Токены в
         секунду — наша метрика, человеку важно, когда агент заговорил. Если ответ
         пришёл целиком без потока, замер честно останется пустым. */
      let firstTokenAt = 0
      setTyping(true)
      setDraft('')
      setDraftReasoning(allowThink ? '' : null)
      setDraftThinkingSec(1)
      setDraftWebSteps([])
      setDraftImgSteps([])
      const ac = new AbortController()
      abortRef.current = ac
      
      /* Повтор при обрыве связи (0.180).
         Прежний повтор ловил только ИСКЛЮЧЕНИЯ, а обрыв приходит ответом
         {ok:false, error:'связь оборвалась…'} — и человек читал предупреждение там,
         где достаточно было молча спросить ещё раз. Живой стенд 12 окт: так
         закончились 4 вопроса из 20.
         Повторяем, только если ничего не показано (не partial — иначе человек уже
         читал текст), человек не останавливал запрос и беда сетевая, а не смысловая:
         «сервер ответил 400/503 про лимиты» повторять бессмысленно. */
      const TRANSPORT_BREAK = /время вышло|связь оборвалась|оборвался|сеть недоступна/
      const worthRetry = (r: ChatResult): boolean => !r.ok && !r.stopped && !r.partial
        && TRANSPORT_BREAK.test(String(r.error || ''))

      // Retry logic для sendChat
      const retrySendChat = async (maxRetries: number = 3, delay: number = 1000): Promise<ChatResult> => {
        let lastError: unknown
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const r = await sendChat(text, history, {
              signal: ac.signal,
              threadId: chatId,
              ...(images && images.length ? { images } : {}),
              ...(attachments && attachments.length ? { attachments } : {}),
              ...(model ? { model } : {}),
              gender: genderForRequest(readGender()),
              persona: personaForRequest(readPersona()),
              onDraft: (t) => {
                if (t && !firstTokenAt) firstTokenAt = Date.now()
                setDraft(t)
              },
              onWebSteps: (steps) => setDraftWebSteps(steps),
              onImageSteps: (steps) => setDraftImgSteps(steps),
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
              topP: genParams.topP,
              presencePenalty: genParams.presencePenalty,
              frequencyPenalty: genParams.frequencyPenalty,
            })
            if (worthRetry(r) && attempt < maxRetries - 1) {
              // Черновик мог остаться от оборванной попытки — снимаем, чтобы не мигал.
              setDraft(null)
              await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)))
              continue
            }
            return r
          } catch (error) {
            lastError = error
            if (attempt === maxRetries - 1) throw error
            // Подождать перед повторной попыткой
            await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)))
          }
        }
        throw lastError
      }
      
      void (async () => {
        const r = await retrySendChat()
        if (r.ok) {
          recordModelTelemetry(
            model || r.model,
            r.ms,
            (r.reply ? r.reply.length : 0) + (r.reasoning ? r.reasoning.length : 0),
            {
              msToFirst: firstTokenAt ? firstTokenAt - startedAt : 0,
              /* «Пустой» — ответ, из которого человеку нечего прочитать. Ответ со
                 одной лишь мыслью (reasoning) считаем пустым: это не ответ. */
              empty: !(r.reply || '').trim(),
            },
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
          setDraftImgSteps([])
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
        setDraftImgSteps([])
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
      {/* Кружок обновления: живёт за верхней кромкой и выезжает за пальцем.
          Вне чтения для программ — это индикатор жеста, а не содержимое. */}
      <div className="ptr" ref={ptrRef} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </div>

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
        owner={owner}
      />

      <div className="main">
        <Topbar
          title={title}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
          onOpenLimits={() => navigate('usage')}
          {...(BACK_TO[view] ? { onBack: () => navigate(BACK_TO[view] as ViewId) } : {})}
          {...(view === 'chat'
            ? {
                onRenameChat: (t: string) => renameChat(activeChatId, t),
                onDeleteChat: () => deleteChat(activeChatId),
              }
            : {})}
        />

        <main
          className={`content${NO_ANIM_VIEWS.includes(view) ? ' settings-scroll' : ''}`}
        >
          {view === 'chat' ? (
            <div className="screen-wrap">
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
                draftImgSteps={draftImgSteps}
                onSend={sendMessage}
                onStop={stopGeneration}
                genParams={genParams}
                onGenParamsChange={setGenParams}
                onOpenLimits={() => navigate('usage')}
                />
              </div>
            </div>
          ) : null}
          <Suspense fallback={null}>
          {/* Профиль — это и есть настройки (0.159): тема выбирается прямо тут,
              как и на экране настроек прежде. Отдельной вкладки настроек нет. */}
          {view === 'profile' ? (
            <div className="screen-wrap">
              <ProfileView
                user={user}
                notify={notify}
                onNavigate={navigate}
                themePref={pref}
                onThemePref={setPref}
                device={device}
                onDevice={setDevice}
                owner={owner}
              />
            </div>
          ) : null}
          {view === 'personalization' ? (
            <div className="screen-wrap">
              <PersonalizationView notify={notify} />
            </div>
          ) : null}
          {view === 'memory' ? (
            <div className="screen-wrap">
              <MemoryView notify={notify} />
            </div>
          ) : null}
          {view === 'data' ? (
            <div className="screen-wrap">
              <DataView chats={chats} notify={notify} onWipeLocal={wipeLocal} />
            </div>
          ) : null}
          {view === 'info' ? (
            <div className="screen-wrap">
              <InfoView notify={notify} onNavigate={navigate} />
            </div>
          ) : null}
          {view === 'reports' ? (
            <div className="screen-wrap">
              <ReportsView notify={notify} />
            </div>
          ) : null}
          {view === 'admin' ? (
            <div className="screen-wrap">
              <AdminView notify={notify} />
            </div>
          ) : null}
          {view === 'usage' ? (
            <div className="screen-wrap">
              <UsageView />
            </div>
          ) : null}
          {view === 'whatsnew' ? (
            <div className="screen-wrap">
              <WhatsNewView />
            </div>
          ) : null}
          </Suspense>
        </main>
      </div>

      <WorkspaceDrawer
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
      />

      {/* Окошко поверх всего: человек вернулся в обновлённое приложение и первым
          делом видит, что изменилось. Крестик закрывает. */}
      {newsOpen && newsNote ? <WhatsNewModal note={newsNote} onClose={closeNews} /> : null}

      {/* Карточка «придумайте себе ID» (0.176). Показывается один раз и не запирает:
          чат под ней живой, «позже» — тоже честный ответ. Владелец просил, чтобы
          человек сам выбирал себе ID, а не получал номерок от машины. */}
      {idCard ? (
        <IdCard
          owner={owner}
          onDone={(d) => {
            /* Спросили один раз — и запомнили, что спросили. Иначе «Позже» означало
               бы «спрашивайте при каждом заходе», а это уже приставание. Задать ID
               потом всегда можно в профиле. */
            markIdAsked()
            setIdCard(false)
            if (d) setDevice(d)
            setUser(siteUser())
          }}
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={actions}
      />
      <Toast 
        message={toast} 
        onDone={() => setToast(null)} 
        onClick={hasUpdate ? () => {
          skipWaiting()
          setToast(null)
        } : undefined}
        actionLabel={hasUpdate ? 'Обновить' : undefined}
      />
    </div>
  )
}
