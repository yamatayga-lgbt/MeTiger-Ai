import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, Crop, Mic, Pin, Plus, SlidersHorizontal, Square, X } from 'lucide-react'
import { haptic } from '../lib/haptic'
import { type Person } from '../lib/user'
import type { ChatMessage } from '../lib/mock'
import { approxDataUrlBytes, fileToDataUrl, filesFromTransfer, MAX_IMAGES, pickImages, type ShotMeta } from '../lib/images'
import { PhotoPrepModal } from '../components/PhotoPrepModal'
import { isVoiceSupported, isPolishSupported, startVoice, voiceLang, joinLive, stitchDictation, VOICE_MAX_SEC, type VoiceSession } from '../lib/voice'
import { DEFAULT_GEN_PARAMS, type GenParams } from '../lib/models'
import { ParamsPopover } from '../components/ParamsPopover'
import { AttachMenu } from '../components/AttachMenu'
import { Guard } from '../components/Guard'

/* Последний черновик поля ввода (0.189, правка 0.218): один на приложение,
   самый свежий. Подставляется при каждом открытии экрана чата — иначе уход
   в профиль размонтирует поле, и набор пропадал бы, хотя ключ ещё жив. */
const DRAFT_KEY = 'mt-draft'
const DRAFT_MAX = 96000

import { LimitsRing } from '../components/LimitsRing'
import { lazy as lazyLoad, Suspense as LazyBoundary } from 'react'
/* Markdown (react-markdown + remark-gfm + формулы + песочница кода) — самый тяжёлый
   кусок интерфейса. Грузится отдельным файлом при первом ответе; до загрузки текст
   виден как есть (pre-wrap), так что пустого места не бывает. */
const Markdown = lazyLoad(() => import('../components/Markdown').then((m) => ({ default: m.Markdown })))
import { ATTACH_ACCEPT, ATTACH_MAX, attachmentKind, fileHref, fileToAttachment, fileSize, modelLabel, pickAttachments, pluralRu, sourceDate, type Attachment, type WebStep, type ImageStep } from '../lib/api'
import { addToHistory, dataUrlToB64, type HistoryItem } from '../lib/attachHistory'
import { listPinnedDocs, readPinnedSummary, readProjectMemory, saveProjectMemory, setPinnedDocEnabled } from '../lib/pinnedMemory'
import { AgentTrace } from '../components/AgentTrace'
import { fmtAgo, fmtAssistantFooterTime } from '../lib/time'
import { enterKeySends } from '../lib/platform'

/** Картинки из ответа: превью прямо в пузыре, файл — рядом чипом, чтобы его
    можно было забрать. Ссылка (data-URI) считается один раз на файл: генерация
    весит килобайты, дважды в DOM её тащить незачем. */
function isImgFile(f: { mime: string; kind?: string }): boolean {
  /* источник может и не попасть в ответ — тогда в подписи только тип */
  return f.kind === 'image' || /^image\//i.test(f.mime || '')
}

function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

async function shareGeneratedFile(f: { name: string; mime: string; b64?: string }, href: string) {
  try {
    const res = await fetch(href)
    const blob = await res.blob()
    const file = new File([blob], f.name, { type: f.mime || 'application/octet-stream' })
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
    if (!nav.canShare || nav.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: f.name })
      return
    }
  } catch { /* отмена шторки или отказ браузера — тихо падаем в скачивание */ }
}

function FileChips({ files, onOpen }: { files: NonNullable<ChatMessage['files']>; onOpen: (src: string, name: string) => void }) {
  const items = files.map((f) => ({ f, href: fileHref(f), img: isImgFile(f) }))
  const imgs = items.filter((x) => x.img)
  const shareable = canShareFiles()
  return (
    <div className="msg-files">
      {imgs.length ? (
        <div className="msg-imgs">
          {imgs.map((x, i) => (
            <button
              key={`i${i}`}
              type="button"
              className="msg-img"
              onClick={() => onOpen(x.href, x.f.name)}
              title={x.f.source ? `${x.f.name} · ${x.f.mime} · ${x.f.source}` : `${x.f.name} · ${x.f.mime}`}
            >
              <img src={x.href} alt={x.f.name} loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="msg-files-row">
        {items.map((x, i) => (
          <span key={i} className="file-chip-group">
            <a className="file-chip" href={x.href} download={x.f.name} title={x.f.source ? `${x.f.mime} · ${x.f.source}` : x.f.mime}>
              <span className="file-name">{x.f.name}</span>
              <span className="file-size">{fileSize(x.f.size)}</span>
            </a>
            {shareable && !x.img ? (
              <button
                type="button"
                className="file-share-btn"
                onClick={() => shareGeneratedFile(x.f, x.href)}
                title="Отправить файл на телефоне"
              >
                Поделиться
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}

function joinText(base: string, extra: string): string {
  const b = base.trimEnd()
  const e = extra.trim()
  if (!b) return e
  if (!e) return b
  return `${b} ${e}`
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Копирование в буфер: сперва нормальный Clipboard API, а в контексте без него
    (старый WebView, http без TLS) — запасной путь через скрытый textarea, чтобы
    кнопка не была бесполезной именно там, где чаще всего открыт этот чат. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* падаем на запасной путь ниже */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Строка под пузырём: копировать + «N минут назад» (у ответа — ещё и сколько
    он шёл). Иконка меняется на галочку на полторы секунды после удачного
    копирования — обратная связь без тоста, который на телефоне лишний.
    Кнопки «озвучить» больше нет (0.188, решение владельца): озвучку убрали совсем. */
function MsgFooter({ text, time, model, align = 'left' }: {
  text: string
  time: string
  model?: string
  align?: 'left' | 'right'
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const onCopy = async () => {
    haptic('light')
    const ok = await copyText(text)
    if (!ok) return
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={`msg-footer${align === 'right' ? ' msg-footer-right' : ''}`}>
      <button type="button" className="msg-copy-btn" onClick={onCopy} aria-label="Скопировать текст">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {time ? <span className="msg-time">{time}</span> : null}
      {model ? <span className="msg-model" title={model}>{model}</span> : null}
    </div>
  )
}

/* Столбиков в полосе уровня. Больше — мельче и без толку, меньше — уже не видно
   разницы между «шепчет» и «молчит». */
const BARS = 14

/* Автостоп диктовки (0.188): как только человек сказал хоть что-то, столько
   секунд тишины закрывают запись сами — кнопку «готово» давить не нужно.
   VOICE_LOUD — уровень, с которого считаем, что человек говорит (шкала та же,
   что у столбиков: 0…1); VOICE_AUTO_MS — сколько ждём тишины. Пауза подумать
   короче — не рвёт диктовку. */
const VOICE_LOUD = 0.18
const VOICE_AUTO_MS = 7000


/** Карандаш поверх листа — значок «создал файл», парный к «прочитал» в ленте шагов. */
function WriteFileGlyph() {
  return (
    <svg
      className="write-file-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="m17.5 3.5 3 3L12 15l-4 1 1-4 8.5-8.5Z" />
    </svg>
  )
}

/**
 * «Создал <файл> · N строк» — строка над ответом на каждый файл, который агент
 * оформил через filegen (docx/xlsx/csv/txt/md/html). Это результат работы, а не
 * шаг подготовки, поэтому лентой шагов (0.229) он не прячется — файл должен
 * быть на виду.
 */
function WriteFilesBlock({ files }: { files: { name: string; lines?: number }[] }) {
  if (!files.length) return null
  return (
    <div className="msg-write-files">
      {files.map((f, idx) => (
        <div key={idx} className="write-file-row">
          <WriteFileGlyph />
          <span className="write-file-label">
            Создал <span className="write-file-name">{f.name}</span>
          </span>
          {typeof f.lines === 'number' ? (
            <span className="write-file-lines">
              {pluralRu(f.lines, 'строка', 'строки', 'строк')}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Служебные блоки (```img```, ```file```) во время письма человеку не показываем.
 *
 * Движок вынимает их из готового ответа, но по потоку они приходят раньше — и на
 * проде человек успевал прочитать «```img|cat_on_windowsill» с английским описанием
 * прямо посреди ответа (замечено 12 окт, 0.177). Прячем и целые блоки, и хвост,
 * который ещё не закрылся: пока блок не закрыт, это тем более не ответ, а заказ.
 */
function hideServiceBlocks(text: string): string {
  return String(text || '')
    .replace(/```[ \t]*(?:img|file)(?:[ \t]*[:|][^\n`]*)?[ \t]*\r?\n[\s\S]*?```/gi, '')
    .replace(/```[ \t]*(?:img|file)(?:[ \t]*[:|][^\n`]*)?[ \t]*\r?\n?[\s\S]*$/i, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


interface ChatViewProps {
  user: Person
  messages: ChatMessage[]
  typing: boolean
  /** Живой черновик ответа (пустая строка = ждём первый кусок, null = его нет) */
  draft?: string | null
  /** Черновик рассуждений — той же головы, но над ответом и другим стилем */
  draftReasoning?: string | null
  /** Сколько секунд модель думала над текущим черновиком */
  draftThinkingSec?: number
  /** Живые шаги поиска в интернете (Searching the web -> Searched for / Fetched) */
  draftWebSteps?: WebStep[]
  /** Этапы рисования картинки во время запроса (0.177). */
  draftImgSteps?: ImageStep[]
  /** Переключатель глубокого поиска («поиск») в панели ввода */
  searchOn?: boolean
  onToggleSearch?: () => void
  onSend: (text: string, images?: string[], attachments?: Attachment[]) => void
  /** Остановить запрос, который уже ушёл (например, отправили по ошибке). Пока его
      нет — кнопка остановки не показывается, форма ведёт себя как раньше. */
  onStop?: () => void
  /** 0.233: дописать ответ с места обрыва и повторить упавший запрос одним касанием. */
  onContinue?: (msgId: string) => void
  onRetry?: (msgId: string) => void
  /** Параметры генерации (temperature, top_p) */
  genParams?: GenParams
  onGenParamsChange?: (next: GenParams) => void
  /** Открыть экран «Использование и лимиты» */
  onOpenLimits?: () => void
  /** Экран чата сейчас виден. Пока узел display:none, высота textarea
      считается нулём — без этого поле схлопывается после возврата (0.221). */
  active?: boolean
}

export function ChatView({
  user,
  messages,
  typing,
  draft,
  draftReasoning,
  draftThinkingSec = 1,
  draftWebSteps = [],
  draftImgSteps = [],
  onSend,
  onStop,
  onContinue,
  onRetry,
  genParams = DEFAULT_GEN_PARAMS,
  onGenParamsChange,
  onOpenLimits,
  active = true,
}: ChatViewProps) {
  /* Стабильная ссылка на «выполнить код и вернуть вывод в чат»: Markdown
     обёрнут в memo и сверяет props по ссылке. Без useCallback каждая буква
     в поле ввода меняла бы onRunOutput и пересобирала разметку всей переписки —
     ровно тот лаг, ради которого memo и поставлен. */
  const runOutput = useCallback((t: string) => onSend(t), [onSend])

  /* Озвучки здесь больше нет вовсе (0.188, решение владельца): ни авточтения,
     ни кнопки «озвучить» у ответа — ответы только текстом. Серверный голос
     (/api/tts, engine/voiceout.js) остался для внешних клиентов API. */

  /* Последний черновик (0.189 / 0.218): набранный текст переживает обновление,
     перезагрузку и уход с экрана чата. Хранится ровно ОДИН черновик — самый
     свежий, без истории по чатам. Читаем при каждом монтировании ChatView:
     экран чата при уходе в профиль размонтируется целиком. */
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      return typeof saved === 'string' && saved ? saved.slice(0, DRAFT_MAX) : ''
    } catch {
      return ''
    }
  })
  /* Черновик пишется на каждый набор и стирается при отправке (поле пустеет —
     ключ уходит). Первая отрисовка экземпляра в хранилище не пишет: при
     переключении чата поле нового чата пустое, и затирать им черновик,
     набранный в прошлом чате, нельзя — черновик один и он самый свежий. */
  const draftSkip = useRef(true)
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
    if (draftSkip.current) {
      draftSkip.current = false
      return
    }
    try {
      if (value) localStorage.setItem(DRAFT_KEY, value.slice(0, DRAFT_MAX))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* переполнение квоты — черновик просто не сохранится, это не поломка */
    }
  }, [value])
  /* Уход с экрана чата — черновик тоже сохраняем (переключение, обновление страницы). */
  useEffect(() => () => {
    try {
      const v = valueRef.current
      if (v) localStorage.setItem(DRAFT_KEY, v.slice(0, DRAFT_MAX))
    } catch {
      /* noop */
    }
  }, [])
  const [shots, setShots] = useState<string[]>([])
  const [shotMetas, setShotMetas] = useState<ShotMeta[]>([])
  const [editingShotIdx, setEditingShotIdx] = useState<number | null>(null)
  const [shotError, setShotError] = useState('')
  /* Перетаскивание показываем словами: без подсветки человек не знает, что на окно можно ронять. */
  const [dropping, setDropping] = useState(false)
  /* Документы и голос, приложенные в браузере: картинки показываются превью, а они
     — чипом с именем и весом, потому что превью у pdf нет и быть не может. */
  const [docs, setDocs] = useState<Attachment[]>([])
  const [docError, setDocError] = useState('')
  const [paramsOpen, setParamsOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  /* Информация о контексте для индикатора */
  /* Цифры приходят из ответа движка (props.ctxUsage), а не считаются здесь: фронт
     не знает ни системных подсказок, ни окна выбранной модели — любая его оценка
     была бы выдумкой. До первого ответа показывать нечего. */
  /* Полноэкранный просмотр любой картинки из переписки (своей или от модели) —
     тап открывает её целиком вместо скачивания/мелкого превью. */
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const empty = messages.length === 0
  /* 0.229: пока идёт запрос — над пишущимся ответом живёт одна лента шагов.
     Раньше это были три независимых блока (картинка, поиск, мысли), и каждый
     показывался по своему условию; теперь условие одно. */
  const traceLive = typing

  /* Автоскролл вниз при новых сообщениях (0.199).
     Было: «был ли я внизу» считалось ПОСЛЕ того, как сообщение уже раздуло ленту,
     — и после первого же длинного ответа разница переваливала за 100 px, условие
     навсегда становилось ложным, и лента замирала: новые реплики и весь поток
     ответа оставались под сгибом. Человек видел «ничего не происходит».
     Стало: «липнем ко дну», пока человек сам не отлистал вверх.
     Листаем по факту изменения содержимого (MutationObserver): ответ печатается
     из отдельного состояния (draft) и растёт кусками, а Markdown пересобирается
     целыми узлами — ни число сообщений, ни ResizeObserver на одном узле этого не
     ловят (узел пересоздаётся, и наблюдение уходит в старый). */
  const stickToBottomRef = useRef(true)
  useEffect(() => {
    const el = threadScrollRef.current
    if (!el || empty) return
    /* Свою прокрутку не считаем за «человек отлистал»: scroll-событие приходит
       асинхронно, уже после того как лента подросла, и честная позиция «внизу»
       выглядела бы как «наверху». */
    let lock = 0
    const follow = () => {
      if (!stickToBottomRef.current) return
      lock = Date.now() + 250
      el.scrollTop = el.scrollHeight
    }
    const onScroll = () => {
      if (Date.now() < lock) return
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(follow)
    if (mo) mo.observe(el, { childList: true, subtree: true, characterData: true })
    follow()
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (mo) mo.disconnect()
    }
  }, [empty])

  /* «N минут назад» под сообщениями сама не обновится без перерисовки —
     тикаем раз в полминуты, этого достаточно и не грузит телефон. */
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // --- голосовой ввод ---
  const voiceSupported = isVoiceSupported()
  const voicePolish = isPolishSupported()
  const [listening, setListening] = useState(false)
  /* polishing — запись уже остановлена, точный текст ещё едет с сервера.
     Пока он едет, черновик виден как есть: человек не сидит перед пустым полем. */
  const [polishing, setPolishing] = useState(false)
  /* Ждём ответ за очередной кусок — по этому признаку видно, что уточнение идёт
     прямо во время речи, а не только после остановки. */
  const [liveBusy, setLiveBusy] = useState(false)
  /* Слой «на лету» заработал хоть раз: с этого момента серверный текст главнее
     браузерного черновика, и черновик больше не подмешивается (иначе одни и те же
     слова стояли бы в поле дважды). */
  const liveOnRef = useRef(false)
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0))
  const [seconds, setSeconds] = useState(0)
  const [voiceError, setVoiceError] = useState('')
  /* Мягкая заметка о голосе: не беда, а пояснение (например, черновик не пишется,
     но запись идёт и точный текст придёт после остановки). Красным такое красить
     нельзя — человек решит, что всё сломалось, и бросит диктовать. */
  const [voiceNote, setVoiceNote] = useState('')
  /* В этой записи уже была речь и когда её слышали в последний раз — по этому
     автостоп (0.188) понимает «человек договорил» и закрывает запись сам. */
  const heardRef = useRef(false)
  const lastLoudRef = useRef(0)
  /* Расшифровка едет сервером (браузерный движок молчит) — см. voice.ts. */
  const serverLayersRef = useRef(false)

  const sessionRef = useRef<VoiceSession | null>(null)
  const baseRef = useRef('') // подтверждённый текст (ввод + финальные куски)
  const interimRef = useRef('') // незакреплённый кусок (для синхронного чтения)
  const preVoiceRef = useRef('') // текст до старта — для кнопки «Отмена»
  /* 0.239: страховочный снимок подтверждённой речи браузера и флаг быстрой отправки
     одним касанием прямо с голосовой полосы. */
  const browserSavedRef = useRef('')
  const quickSendAfterPolishRef = useRef(false)

  // таймер записи
  useEffect(() => {
    if (!listening) return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [listening])

  // Esc закрывает оверлеи этого экрана — глобальный обработчик в App.tsx не
  // видит локальное состояние ChatView (меню вложений, параметры, просмотр
  // картинки), а клавиатурный Esc должен работать одинаково для всех них.
  useEffect(() => {
    if (!addMenuOpen && !paramsOpen && !lightbox && editingShotIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAddMenuOpen(false)
      setParamsOpen(false)
      setLightbox(null)
      setEditingShotIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMenuOpen, paramsOpen, lightbox, editingShotIdx])

  // авто-высота поля: при наборе, голосе и когда чат снова виден. Пока родитель
  // display:none, scrollHeight = 0 — такую высоту не ставим, иначе поле схлопнется.
  useEffect(() => {
    if (!active) return
    const el = textareaRef.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const h = el.scrollHeight
      if (h < 8) return
      el.style.height = `${Math.min(h, 160)}px`
    }
    fit()
    const id = window.requestAnimationFrame(fit)
    return () => window.cancelAnimationFrame(id)
  }, [value, active])

  // при уходе со экрана микрофон выключается; при возврате интернета тихо дотягиваем запасную запись
  useEffect(() => {
    const onOnline = () => {
      if (sessionRef.current?.canRetry()) {
        setVoiceNote('')
        sessionRef.current.retry()
      }
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      sessionRef.current?.cancel()
    }
  }, [])

  /* Автостоп диктовки (0.188): человек сказал — и замолчал на VOICE_AUTO_MS —
     запись закрывается сама, кнопка «готово» не нужна. Порог тишины намеренный:
     короткая пауза «подумать» внутри фразы не рвёт диктовку. Работает во всех
     режимах ввода, а не только в разговоре вслух (тот убран в 0.188). */
  useEffect(() => {
    if (!listening) return
    const id = window.setInterval(() => {
      if (!heardRef.current) return
      if (Date.now() - lastLoudRef.current >= VOICE_AUTO_MS) stopVoiceInput()
    }, 200)
    return () => window.clearInterval(id)
  }, [listening])

  /* После остановки оставляем сессию в памяти до успеха: если сервер не ответил,
     запись можно будет отправить на расшифровку повторно, не говоря заново. */
  const stopVoiceInput = (): string => {
    const session = sessionRef.current
    const composed = joinText(baseRef.current, interimRef.current)
    baseRef.current = composed
    interimRef.current = ''
    setValue(composed)
    setListening(false)
    setLevels(new Array(BARS).fill(0))
    if (session) session.stop()
    haptic('light')
    return composed
  }

  const cancelVoiceInput = () => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    quickSendAfterPolishRef.current = false
    baseRef.current = preVoiceRef.current
    browserSavedRef.current = preVoiceRef.current
    interimRef.current = ''
    setValue(preVoiceRef.current)
    setListening(false)
    setPolishing(false)
    setLevels(new Array(BARS).fill(0))
    setSeconds(0)
    haptic('light')
  }

  /* 0.150: красного предупреждения и кнопки повтора больше нет — по просьбе
     владельца распознаёт браузер, и его текст сразу остаётся в поле. Сюда мы
     попадаем только на запасном серверном пути (браузер без движка речи):
     текст в поле и так сохранён, а если его совсем нет — мягкая заметка. */
  const voicePolishFailed = (reason?: string) => {
    setPolishing(false)
    quickSendAfterPolishRef.current = false
    /* 0.239: если сервер не ответил, а до обрыва браузер уже успел сохранить речь —
       возвращаем её целиком, чтобы ни одно сказанное слово не пропало. */
    if (!baseRef.current.trim() && browserSavedRef.current.trim()) {
      baseRef.current = browserSavedRef.current
    }
    const hasDraft = baseRef.current.trim() !== preVoiceRef.current.trim()
    setValue((current) => (current.trim() ? current : baseRef.current))
    if (!hasDraft) setVoiceNote(`Не расслышал (${reason || 'нет связи'}) — попробуйте ещё раз`)
  }

  /* 0.237: компактная полоска активной памяти проекта/закреплённых файлов над полем ввода. */
  const readActiveMemoryBadge = useCallback(() => {
    const proj = readProjectMemory()
    const summary = readPinnedSummary().filter((p) => p.enabled)
    const projTitle = proj.enabled ? (proj.title.trim() || (proj.note.trim() ? 'Памятка проекта' : '')) : ''
    return { projTitle, pinnedCount: summary.length, pinnedNames: summary.map((p) => p.name) }
  }, [])
  const [memBadge, setMemBadge] = useState(readActiveMemoryBadge)

  useEffect(() => {
    const refresh = () => setMemBadge(readActiveMemoryBadge())
    refresh()
    void listPinnedDocs().then(refresh)
    window.addEventListener('mt-pinned-change', refresh)
    return () => window.removeEventListener('mt-pinned-change', refresh)
  }, [readActiveMemoryBadge])

  const pauseAllMemory = async () => {
    haptic('light')
    const proj = readProjectMemory()
    if (proj.enabled && (proj.title.trim() || proj.note.trim())) {
      saveProjectMemory({ ...proj, enabled: false })
    }
    const docsList = await listPinnedDocs()
    for (const d of docsList) {
      if (d.enabled) await setPinnedDocEnabled(d.id, false)
    }
    setMemBadge(readActiveMemoryBadge())
  }

  const startVoiceInput = () => {
    if (!voiceSupported) {
      setVoiceError('Голосовой ввод не поддерживается в этом браузере')
      return
    }
    sessionRef.current?.cancel()
    sessionRef.current = null
    haptic('medium')
    setVoiceError('')
    setPolishing(false)
    setVoiceNote('')
    quickSendAfterPolishRef.current = false
    liveOnRef.current = false
    preVoiceRef.current = value
    baseRef.current = value
    browserSavedRef.current = value
    interimRef.current = ''
    heardRef.current = false
    lastLoudRef.current = 0
    serverLayersRef.current = false
    setSeconds(0)
    setLevels(new Array(BARS).fill(0))
    setListening(true)
    const session = startVoice(
      {
        onFinal: (chunk) => {
          if (liveOnRef.current) return // серверный текст уже главнее
          baseRef.current = stitchDictation(baseRef.current, chunk)
          browserSavedRef.current = baseRef.current
          interimRef.current = ''
          setValue(baseRef.current)
              },
        onInterim: (chunk) => {
          if (liveOnRef.current) return
          interimRef.current = chunk
          setValue(joinText(baseRef.current, chunk))
        },
        /* Столбики уровня: живая история сигнала, а не выдуманная волна. */
        onLevel: (l) => {
          setLevels((prev) => [...prev.slice(1), l])
          if (l > VOICE_LOUD) {
            heardRef.current = true
            lastLoudRef.current = Date.now()
          }
        },
        onError: (message) => {
          setVoiceError(message)
          cancelVoiceInput()
        },
        /* Кусок, уточнённый на лету. Первый такой кусок вытесняет браузерный
           черновик целиком: он был всего лишь заглушкой на время ожидания. */
        onLive: (text) => {
          if (!liveOnRef.current) {
            liveOnRef.current = true
            /* Черновик браузера перекрыт серверным текстом: то, что он успел
               написать, относится к тем же секундам — оставляем только сервер. */
            baseRef.current = preVoiceRef.current
            interimRef.current = ''
            setVoiceNote('')
          }
          const merged = joinLive(baseRef.current, text)
          baseRef.current = stitchDictation(baseRef.current, merged)
          setValue(baseRef.current)
        },
        onLiveBusy: (busy) => setLiveBusy(busy),
        /* Движок браузера молчит — расшифровку делает сервер. Разговору вслух это
           важно знать: отправка хода ждёт точный текст, а не пустое поле. */
        onServerLayers: () => {
          serverLayersRef.current = true
        },
        onLiveOff: (why) => {
          /* Слой уточнения на лету не поехал — говорим мягко и не мешаем диктовать:
             текст всё равно придёт точным после остановки. */
          if (!liveOnRef.current) setVoiceNote(`Точный текст на лету не идёт (${why}) — придёт после остановки`)
        },
        liveContext: () => baseRef.current,
        onDraftFail: (message) => {
          setVoiceNote(`${message} — говорите дальше, точный текст приедет после остановки`)
        },
        /* Точный текст пришёл: он заменяет ВЕСЬ кусок этой сессии, а текст, что был
           в поле до микрофона, остаётся на месте. */
        onPolished: (text) => {
          const composed = stitchDictation(preVoiceRef.current, text)
          baseRef.current = composed
          interimRef.current = ''
          sessionRef.current = null
          setValue(composed)
          setPolishing(false)
          setVoiceError('')
          haptic('light')
          if (quickSendAfterPolishRef.current) {
            quickSendAfterPolishRef.current = false
            if (composed.trim() || shots.length || docs.length) submit(composed)
          }
        },
        onPolish: (state, reason) => {
          if (state === 'start') {
            setPolishing(true)
            setVoiceError('')
          } else voicePolishFailed(reason)
        },
        onCap: () => {
          setVoiceError(`Запись остановлена сама: больше ${VOICE_MAX_SEC / 60} минут подряд не пишу`)
        },
      },
      voiceLang(user.language_code),
    )
    if (!session) {
      setListening(false)
      setVoiceError('Не получилось запустить голосовой ввод — попробуйте ещё раз')
      return
    }
    sessionRef.current = session
  }

  const submit = (forced?: string) => {
    /* Пока предыдущий ответ ещё не пришёл — второй запрос не копим поверх первого:
       клавиатура (Enter на компьютере) могла бы это сделать в обход disabled у кнопки,
       которая на это время сама превращается в «Остановить». */
    if (typing) return
    /* Отправка во время записи/уточнения: берём видимый черновик и гасим запрос,
       иначе точный текст вернётся в уже очищенное поле после отправки. */
    let text = typeof forced === 'string' ? forced : value
    if (listening && typeof forced !== 'string') {
      text = stopVoiceInput()
      sessionRef.current?.cancel()
      sessionRef.current = null
      setPolishing(false)
    } else if (polishing && typeof forced !== 'string') {
      sessionRef.current?.cancel()
      sessionRef.current = null
      setPolishing(false)
    }
    setVoiceNote('')
    quickSendAfterPolishRef.current = false
    text = text.trim()
    /* Картинка или файл без вопроса — это запрос «посмотри, что я прислал»: движок
       сам решит, что с этим делать. Совсем пустой ход не отправляем. */
    if (!text && !shots.length && !docs.length) return
    /* Свою реплику человек хочет видеть: отправил — значит, едем вниз, даже если
       до этого читал историю выше. Иначе ответ придёт «в пустоту» под сгибом. */
    stickToBottomRef.current = true
    haptic('medium')
    onSend(
      text || (docs.length ? 'Посмотри, что я приложил' : 'Что на картинке?'),
      shots.length ? shots : undefined,
      docs.length ? docs : undefined,
    )
    setValue('')
    baseRef.current = ''
    setShots([])
    setDocs([])
    setDocError('')
    setShotError('')
    setShotMetas([])
    setEditingShotIdx(null)
    setVoiceError('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  /* 0.239: быстрая отправка голосового черновика одним касанием с полосы записи. */
  const quickSendVoice = () => {
    if (typing) return
    if (listening) {
      const ready = stopVoiceInput().trim()
      if (ready || shots.length > 0 || docs.length > 0) {
        sessionRef.current?.cancel()
        sessionRef.current = null
        setPolishing(false)
        submit(ready)
        return
      }
      // Серверный путь без браузерного черновика: отправим автоматически сразу по готовности.
      quickSendAfterPolishRef.current = true
      setVoiceNote('Отправлю сразу после расшифровки…')
      return
    }
    if (polishing) {
      const ready = value.trim()
      if (ready || shots.length > 0 || docs.length > 0) {
        sessionRef.current?.cancel()
        sessionRef.current = null
        setPolishing(false)
        submit(ready)
        return
      }
      quickSendAfterPolishRef.current = true
      setVoiceNote('Отправлю сразу после расшифровки…')
    }
  }

  const addFiles = async (list: FileList | File[] | null, fromCamera = false) => {
    const all = list ? Array.from(list) : []
    if (!all.length) return
    /* Сколько картинок ещё влезает по MAX_IMAGES; всё, что сверх, раньше молча
       отрезалось — ни превью, ни ошибки, ни сообщения. Человек понимал это как «фото
       не отправляются». */
    const baseIdx = shots.length
    const room = Math.max(0, MAX_IMAGES - shots.length)
    const picked = pickImages(all).slice(0, room)
    const tooManyImages = all.filter((f) => attachmentKind(f) === 'image').length - picked.length
    const next: string[] = []
    const nextMetas: ShotMeta[] = []
    for (const f of picked) {
      const r = await fileToDataUrl(f, undefined, { keepSource: true })
      if (r.ok) {
        next.push(r.dataUrl)
        const sentBytes = r.meta?.sentBytes ?? approxDataUrlBytes(r.dataUrl)
        nextMetas.push(
          r.meta || {
            origBytes: f.size || sentBytes,
            sentBytes,
            savedPct: 0,
            width: 0,
            height: 0,
            isDoc: false,
            sourceDataUrl: r.dataUrl,
          },
        )
        /* В историю «Файлы → Недавние» кладём то же сжатое превью, что уйдёт
           модели, — не исходное фото телефона (весит мегабайты зря). */
        void addToHistory({
          name: f.name || 'фото.jpg',
          mime: 'image/jpeg',
          size: Math.round(r.dataUrl.length * 0.74),
          kind: 'image',
          b64: dataUrlToB64(r.dataUrl),
        })
      } else setShotError(r.error)
    }
    if (tooManyImages > 0) setShotError(`картинок приложено ${tooManyImages} сверх меры — беру столько, сколько помещается (${MAX_IMAGES})`)
    if (next.length) {
      setShots((prev) => prev.concat(next).slice(0, MAX_IMAGES))
      setShotMetas((prev) => prev.concat(nextMetas).slice(0, MAX_IMAGES))
      /* 0.238: снимок с камеры телефона сразу открывает быстрое кадрирование/поворот/режим чека
         (сам сжатый снимок уже лежит в списке — закрытие окна ничего не потеряет). */
      if (fromCamera && next.length === 1) {
        setEditingShotIdx(baseIdx)
      }
    }
    /* остальное — документы и аудио: их не превьюим, а читаем на сервере */
    const rest = all.filter((f) => attachmentKind(f) !== 'image')
    if (rest.length) {
      const { taken, tooBig, extra } = pickAttachments(rest)
      const byName = new Map(rest.map((f) => [f.name, f]))
      const made: Attachment[] = []
      const errs: string[] = tooBig.slice()
      for (const f of taken) {
        const file = byName.get(f.name)
        if (!file) continue
        const r = await fileToAttachment(file)
        if (r.ok) {
          made.push(r.att)
          void addToHistory({ name: r.att.name, mime: r.att.mime, size: r.att.size, kind: r.att.kind, b64: r.att.b64 })
        } else errs.push(r.error)
      }
      if (extra > 0) errs.push(`лишних файлов ${extra} — читаю не больше ${ATTACH_MAX}`)
      setDocs((prev) => prev.concat(made).slice(0, ATTACH_MAX))
      setDocError(errs.join(' · '))
    }
    if (cameraRef.current) cameraRef.current.value = ''
    if (photoRef.current) photoRef.current.value = ''
    if (uploadRef.current) uploadRef.current.value = ''
  }

  /** Повторное прикрепление из «Файлы → Недавние» — без диска и без сети, уже готово. */
  const addFromHistory = (h: HistoryItem) => {
    haptic('light')
    if (h.kind === 'image') {
      if (shots.length >= MAX_IMAGES) { setShotError(`картинок уже ${MAX_IMAGES} — больше не влезет, уберите одну`); return }
      const href = fileHref(h)
      setShots((prev) => prev.concat(href).slice(0, MAX_IMAGES))
      setShotMetas((prev) =>
        prev
          .concat({
            origBytes: h.size,
            sentBytes: h.size,
            savedPct: 0,
            width: 0,
            height: 0,
            isDoc: false,
            sourceDataUrl: href,
          })
          .slice(0, MAX_IMAGES),
      )
      return
    }
    if (docs.length >= ATTACH_MAX) { setDocError(`файлов уже ${ATTACH_MAX} — больше не влезет, уберите один`); return }
    setDocs((prev) => prev.concat({ name: h.name, mime: h.mime, size: h.size, b64: h.b64, kind: h.kind }).slice(0, ATTACH_MAX))
  }

  return (
    <div
      className="chat-root"
      onDragOver={(e) => {
        const t = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : []
        if (t.indexOf('Files') >= 0) { e.preventDefault(); if (!dropping) setDropping(true) }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const fs = filesFromTransfer(e.dataTransfer)
        e.preventDefault()
        setDropping(false)
        if (fs.length) void addFiles(fs)
      }}
    >
      {dropping ? (
        <div
          style={{
            position: 'fixed', left: '50%', top: 12, transform: 'translateX(-50%)', zIndex: 40,
            padding: '6px 12px', borderRadius: 999, background: 'rgba(18,18,22,.92)',
            color: '#fff', fontSize: 13, pointerEvents: 'none',
          }}
        >
          отпустите — приложу фото или файл
        </div>
      ) : null}
      <div className="thread-scroll" ref={threadScrollRef}>
      {empty ? null : (
        <div className="thread">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                <div className="msg-user-col">
                  <div className="bubble">
                    {m.images && m.images.length ? (
                      <div className="shot-row">
                        {m.images.map((src, i) => (
                          <button
                            key={i}
                            type="button"
                            className="shot-btn"
                            onClick={() => src && setLightbox({ src })}
                          >
                            <img className="shot" src={src} alt="" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {m.docs && m.docs.length ? (
                      <div className="sent-files">
                        {m.docs.map((d, i) => (
                          <span className="sent-file" key={i}>{d.name} · {fileSize(d.size)}</span>
                        ))}
                      </div>
                    ) : null}
                    {m.text ? <div className="msg-text">{m.text}</div> : null}
                  </div>
                  {m.text ? (
                    <MsgFooter text={m.text} time={m.ts ? fmtAgo(m.ts, nowTick) : ''} align="right" />
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={m.id} className="msg msg-ai">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ai-name">MeTiger Ai</div>
                  {/* 0.229: весь ход работы — одной лентой: мысли, прочитанные
                      файлы, поиск, инструменты. У готового ответа главное — ответ,
                      поэтому лента свёрнута в одну строку. */}
                  <AgentTrace
                    reasoning={m.reasoning || ''}
                    thinkingSec={m.thinkingSec}
                    webSteps={Array.isArray(m.webSteps) ? m.webSteps : []}
                    reads={Array.isArray(m.reads) ? m.reads : []}
                    readNotes={Array.isArray(m.readNotes) ? m.readNotes : []}
                    tools={Array.isArray(m.tools) ? m.tools : []}
                    ms={m.ms}
                  />
                  {/* Оговорка инструмента — видимой строкой, а не в логах: если
                      свежий поиск лёг и ответ собран по Википедии, человек должен
                      знать это до того, как поверит фактам. */}
                  {Array.isArray(m.toolNotes) && m.toolNotes.length ? (
                    <div className="msg-tool-note" role="note">
                      <span aria-hidden="true">⚠️</span> {m.toolNotes.join(' · ')}
                    </div>
                  ) : null}
                  {Array.isArray(m.files) && m.files.length ? <WriteFilesBlock files={m.files} /> : null}
                  <div className="bubble">
                    {/* Guard (0.151): упал Markdown-рендер ЭТОГО сообщения —
                        серая плашка с причиной и сырым текстом вместо белого
                        экрана на всю переписку при каждой загрузке. */}
                    <Guard fallback={(why) => (
                      <>
                        <div className="msg-broken">Не удалось отрисовать это сообщение ({why}) — показываю как есть:</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      </>
                    )}>
                      <LazyBoundary fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}><Markdown text={m.text} onRunOutput={runOutput} sources={m.sources} /></LazyBoundary>
                    </Guard>
                  </div>
                  {/* Кто ответил и что сказал совет. Это не украшение: по ней видно,
                      что ответ проверяли, а не угадали, и где его исправили. */}
                  {/* Файлы, которые модель оформила блоком. Ссылка — data-URI:
                      своего хранилища под раздачу нет, файл живёт, пока открыта
                      вкладка. После перезагрузки его нужно попросить заново. */}
                  {Array.isArray(m.files) && m.files.length ? (
                    <FileChips files={m.files} onOpen={(src, name) => setLightbox({ src, name })} />
                  ) : null}
                  {/* Причина, по которой вложения нет. Прячем её под ответ, а не в
                      конец текста: человек должен увидеть отказ до того, как
                      станет искать картинку. */}
                  {m.fileError ? <div className="msg-warn">{m.fileError}</div> : null}
                  {/* Поток оборвался: ответ есть, хвоста нет — говорим об этом снизу,
                      а не выбрасываем написанное (0.111). В 0.233 рядом кнопка дописать
                      ровно с места обрыва одним касанием на телефоне. */}
                  {m.warn ? <div className="msg-warn">{m.warn}</div> : null}
                  {m.warn && !typing && onContinue ? (
                    <div className="msg-recover-row">
                      <button
                        type="button"
                        className="msg-recover-btn"
                        onClick={() => {
                          haptic('light')
                          onContinue(m.id)
                        }}
                      >
                        Дописать с места обрыва
                      </button>
                    </div>
                  ) : null}
                  {m.failed && !typing && onRetry ? (
                    <div className="msg-recover-row">
                      <button
                        type="button"
                        className="msg-recover-btn"
                        onClick={() => {
                          haptic('light')
                          onRetry(m.id)
                        }}
                      >
                        Повторить запрос
                      </button>
                    </div>
                  ) : null}
                  {/* Что агент прочитал из приложенного — чтобы «он же не видел мой
                      файл» не превращалось в спор. Новые ответы показывают это выше,
                      блоком «Explored N reads»; эта строка — обратная совместимость
                      для ответов без структурного m.reads. */}
                  {!m.reads?.length && m.attach ? <div className="msg-read">{m.attach}</div> : null}
                  {/* Чем оплатили окно и чужой «system»: история урезана, подсказки
                      обрезаны. Это не предупреждение, это условия ответа. */}
                  {m.notes ? <div className="msg-note">{m.notes}</div> : null}
                  {Array.isArray(m.sources) && m.sources.length ? (
                    <div className="msg-sources" aria-label="Источники">
                      {m.sources.map((s, i) => (
                        <a
                          key={i}
                          className="msg-source-chip"
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.url}
                        >
                          <span className="msg-source-idx">[{i + 1}]</span>
                          <span className="msg-source-title">{s.title || s.url}</span>
                          {/* Дата видна на плашке: «сегодня» / «3 дня назад» / дата. Без
                              неё человек не отличает вчерашнюю новость от статьи 2021 года,
                              а модель — тоже (0.163). */}
                          {s.date && sourceDate(s.date) ? (
                            <span className="msg-source-date">{sourceDate(s.date)}</span>
                          ) : null}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {/* Провайдер, режим и сырые миллисекунды не показываем (0.058), а
                      само имя модели выводится полупрозрачной строкой в футере под
                      каждым ответом по прямому решению владельца (0.240). */}
                  {m.advice ? (
                    <div className={`msg-meta${m.adviceTone ? ' is-' + m.adviceTone : ''}`}>
                      <span className="msg-advice">{m.advice}</span>
                    </div>
                  ) : null}
                  {m.text ? (
                    <MsgFooter
                      text={m.text}
                      time={fmtAssistantFooterTime(m.ms, m.ts, nowTick)}
                      model={modelLabel(m)}
                    />
                  ) : null}
                </div>
              </div>
            ),
          )}

          {typing ? (
            <div className="msg msg-ai msg-arrive">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ai-name">MeTiger Ai</div>
                {/* 0.229: живая лента — те же шаги, что у готового ответа, только
                    раскрытая и с таймером. Как только пошёл текст ответа, панель
                    сворачивается сама (см. AgentTrace). */}
                {traceLive ? (
                  <AgentTrace
                    live={!draft}
                    reasoning={draftReasoning || ''}
                    thinkingSec={draftThinkingSec}
                    webSteps={Array.isArray(draftWebSteps) ? draftWebSteps : []}
                    imgSteps={Array.isArray(draftImgSteps) ? draftImgSteps : []}
                  />
                ) : null}
                {draft ? (
                  /* Текст ответа пишется сверху вниз с плавным проявлением и белой точкой внизу */
                  <div className="msg-text msg-draft" aria-live="polite" aria-label="Ответ пишется">
                    {hideServiceBlocks(draft)}
                    <span className="draft-caret" aria-hidden="true" />
                  </div>
                ) : null}
                <div className="stream-dot-row" aria-hidden="true">
                  <span className="stream-dot" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      </div>

      <div className="composer-wrap">
        {listening || polishing ? (
          <div className={'voice-strip' + (polishing ? ' is-polishing' : '')} role="status" aria-live="polite">
            <span className="voice-rec" aria-hidden="true" />
            <span className="voice-when">
              {polishing ? 'Уточняю текст…' : `Слушаю · ${fmtTime(seconds)}`}
            </span>
            {/* Видно, что уточнение идёт прямо сейчас: без этой отметки человек не
                понимает, отчего слова в поле меняются сами. */}
            {listening && liveBusy ? <span className="voice-tag">уточняю</span> : null}
            <span className="voice-bars" aria-hidden="true">
              {levels.map((v, i) => (
                <i key={i} style={{ transform: `scaleY(${(0.14 + v * 0.86).toFixed(3)})` }} />
              ))}
            </span>
            <button type="button" className="voice-ic is-x" onClick={cancelVoiceInput} aria-label="Отменить запись" title="Отменить запись">
              <X size={14} />
            </button>
            <button
              type="button"
              className="voice-ic is-ok"
              onClick={() => stopVoiceInput()}
              disabled={polishing}
              aria-label="Готово"
              title={voicePolish ? 'Готово — уточню текст и вставлю в поле' : 'Готово'}
            >
              <Check size={15} />
            </button>
            {!typing ? (
              <button
                type="button"
                className="voice-ic is-send"
                onClick={quickSendVoice}
                aria-label="Сразу отправить"
                title="Остановить запись и сразу отправить сообщение"
              >
                <ArrowUp size={15} />
              </button>
            ) : null}
          </div>
        ) : null}

        {memBadge.projTitle || memBadge.pinnedCount > 0 ? (
          <div className="pinned-strip" role="status" aria-live="polite">
            <Pin size={13} className="pinned-strip-ic" />
            <span className="pinned-strip-text" title={memBadge.pinnedNames.join(', ')}>
              В памяти:{' '}
              {[
                memBadge.projTitle,
                memBadge.pinnedCount > 0
                  ? `${memBadge.pinnedCount} ${pluralRu(memBadge.pinnedCount, 'файл', 'файла', 'файлов')}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button
              type="button"
              className="pinned-strip-pause"
              onClick={() => void pauseAllMemory()}
              title="Поставить память проекта и файлов на паузу"
            >
              Пауза
            </button>
          </div>
        ) : null}

        {shots.length || docs.length || shotError || docError ? (
          <div className="attach-strip">
            {shots.map((src, i) => {
              const meta = shotMetas[i]
              return (
                <div className="attach-chip" key={i}>
                  <img src={src} alt="" onClick={() => setEditingShotIdx(i)} />
                  {meta ? (
                    <span className="attach-chip-badge">
                      {meta.isDoc ? 'Чек · ' : ''}
                      {fileSize(meta.sentBytes)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="attach-chip-crop"
                    aria-label={'кадрировать картинку ' + (i + 1)}
                    title="Кадрировать, повернуть или усилить чёткость текста"
                    onClick={() => {
                      haptic('light')
                      setEditingShotIdx(i)
                    }}
                  >
                    <Crop size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label={'убрать картинку ' + (i + 1)}
                    onClick={() => {
                      setShots((prev) => prev.filter((_, j) => j !== i))
                      setShotMetas((prev) => prev.filter((_, j) => j !== i))
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
            {docs.map((d, i) => (
              <div className="doc-chip" key={`d${i}`} title={`${d.name} · ${d.kind === 'voice' ? 'голос' : 'файл'}`}>
                <span className="doc-chip-name">{d.name}</span>
                <span className="doc-chip-size">{fileSize(d.size)}</span>
                <button
                  type="button"
                  aria-label={`убрать ${d.name}`}
                  onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {shotError ? <span className="attach-error">{shotError}</span> : null}
            {docError ? <span className="attach-error">{docError}</span> : null}
            <span className="attach-hint">
              картинок: {shots.length}/{MAX_IMAGES}{docs.length ? ` · файлов: ${docs.length}/${ATTACH_MAX}` : ''}
            </span>
          </div>
        ) : null}
        <form
          className={'composer' + (listening || polishing ? ' is-voice' : '')}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="composer-main">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              placeholder="Спросите что угодно"
              onChange={(e) => {
                const el = e.target
                if (!listening) baseRef.current = el.value
                setValue(el.value)
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
              onPaste={(e) => {
                /* Вставка из буфера — второй способ, которым фото реально шлют: скриншот
                   или копия из галереи. Файлов в буфере нет → событие не трогаем, текст
                   вставляется как вставлялся. */
                const fs = filesFromTransfer(e.clipboardData)
                if (fs.length) { e.preventDefault(); void addFiles(fs) }
              }}
              onKeyDown={(e) => {
                /* На компьютере (есть hover и точный указатель — мышь/трекпад) Enter
                   отправляет, Shift+Enter переносит строку — обычное дело для чата.
                   На телефоне у клавиши «следующая строка» то же событие Enter, а
                   Shift взять неоткуда — там Enter обязан просто переводить строку,
                   отправляет только кнопка (см. src/lib/platform.ts). */
                if (e.key === 'Enter' && !e.shiftKey && enterKeySends()) {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape' && listening) {
                  e.preventDefault()
                  stopVoiceInput()
                }
              }}
            />
          </div>

          {/* Ряд 2: слева — «+», параметры и кольцо лимитов; справа — микрофон и отправка */}
          <div className="composer-buttons">
            <div className="composer-buttons-left">
              <button
                type="button"
                className={`icon-btn plus-btn${addMenuOpen ? ' is-open' : ''}`}
                aria-label="Добавить"
                aria-expanded={addMenuOpen}
                onClick={() => {
                  haptic('light')
                  setAddMenuOpen((v) => !v)
                }}
              >
                <Plus size={20} />
              </button>
              <button
                type="button"
                className={`params-btn${paramsOpen ? ' is-open' : ''}`}
                aria-label="Параметры генерации"
                aria-expanded={paramsOpen}
                title="Параметры: temperature, top_p"
                onClick={() => {
                  haptic('light')
                  setParamsOpen((v) => !v)
                }}
              >
                <SlidersHorizontal size={15} />
                <span className="params-dot" aria-hidden="true" />
              </button>
              {onOpenLimits ? <LimitsRing onOpen={onOpenLimits} /> : null}
              {/* Камера — снимок сразу с устройства (capture заставляет открыть именно камеру, не выбор приложения). */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => void addFiles(e.target.files, true)}
              />
              {/* Фото — системная галерея устройства, без camera-capture. */}
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
              {/* Файлы → «Загрузить файлы» — любой документ/аудио, как раньше у скрепки. */}
              <input
                ref={uploadRef}
                type="file"
                accept={ATTACH_ACCEPT}
                multiple
                hidden
                data-role="attach"
                onChange={(e) => void addFiles(e.target.files)}
              />
            </div>
            <div className="composer-buttons-right">
              {voiceSupported ? (
                <button
                  type="button"
                  className={`icon-btn voice-btn${listening ? ' is-on' : ''}${polishing ? ' is-wait' : ''}`}
                  aria-label={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  title={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  disabled={polishing}
                  onClick={() => {
                    if (listening) stopVoiceInput()
                    else startVoiceInput()
                  }}
                >
                  {listening ? <Square size={13} /> : <Mic size={17} />}
                </button>
              ) : null}

              {typing ? (
                /* Запрос уже ушёл — например, отправили по ошибке. Стоп реально
                   обрывает сетевой запрос (AbortController в App.tsx), а не просто
                   прячет «Печатает» на экране — см. src/lib/api.ts (поле stopped). */
                <button
                  type="button"
                  className="send-btn stop-btn"
                  aria-label="Остановить"
                  title="Остановить генерацию"
                  onClick={() => {
                    haptic('light')
                    onStop?.()
                  }}
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-btn"
                  disabled={!value.trim() && shots.length === 0 && docs.length === 0}
                  aria-label="Отправить"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>

          {addMenuOpen ? (
            <>
              <div className="model-backdrop" onClick={() => setAddMenuOpen(false)} />
              <AttachMenu
                onCamera={() => cameraRef.current?.click()}
                onPhoto={() => photoRef.current?.click()}
                onUploadFiles={() => uploadRef.current?.click()}
                onPickHistory={addFromHistory}
                onClose={() => setAddMenuOpen(false)}
              />
            </>
          ) : null}

          {paramsOpen ? (
            <>
              <div className="model-backdrop" onClick={() => setParamsOpen(false)} />
              <ParamsPopover
                params={genParams}
                onChange={(next) => onGenParamsChange?.(next)}
                onClose={() => setParamsOpen(false)}
              />
            </>
          ) : null}
        </form>
        {voiceError ? (
          <div className="voice-error" role="status" aria-live="polite">
            <span>{voiceError}</span>
          </div>
        ) : null}
        {voiceNote ? <div className="voice-note">{voiceNote}</div> : null}
      </div>
      {editingShotIdx !== null && shots[editingShotIdx] ? (
        <PhotoPrepModal
          sourceDataUrl={shotMetas[editingShotIdx]?.sourceDataUrl || shots[editingShotIdx]}
          initialDoc={Boolean(shotMetas[editingShotIdx]?.isDoc)}
          origBytes={shotMetas[editingShotIdx]?.origBytes || approxDataUrlBytes(shots[editingShotIdx])}
          onClose={() => setEditingShotIdx(null)}
          onApply={(nextUrl, nextMeta) => {
            const idx = editingShotIdx
            setShots((prev) => prev.map((s, j) => (j === idx ? nextUrl : s)))
            setShotMetas((prev) => prev.map((m, j) => (j === idx ? nextMeta : m)))
            setEditingShotIdx(null)
          }}
        />
      ) : null}
      {lightbox ? (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button type="button" className="lightbox-close" aria-label="Закрыть" onClick={() => setLightbox(null)}>
            <X size={22} />
          </button>
          <img
            className="lightbox-img"
            src={lightbox.src}
            alt={lightbox.name || ''}
            onClick={(e) => e.stopPropagation()}
          />
          <a
            className="lightbox-download"
            href={lightbox.src}
            download={lightbox.name || 'image.png'}
            onClick={(e) => e.stopPropagation()}
          >
            Скачать
          </a>
        </div>
      ) : null}
    </div>
  )
}
