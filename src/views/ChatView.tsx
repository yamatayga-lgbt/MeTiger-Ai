import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Copy, Mic, Plus, SlidersHorizontal, Square, X } from 'lucide-react'
import { haptic } from '../lib/haptic'
import { type Person } from '../lib/user'
import type { ChatMessage } from '../lib/mock'
import { fileToDataUrl, filesFromTransfer, MAX_IMAGES, pickImages } from '../lib/images'
import { isVoiceSupported, isPolishSupported, startVoice, voiceLang, joinLive, VOICE_MAX_SEC, type VoiceSession } from '../lib/voice'
import { DEFAULT_GEN_PARAMS, type GenParams } from '../lib/models'
import { ParamsPopover } from '../components/ParamsPopover'
import { AttachMenu } from '../components/AttachMenu'
import { Markdown } from '../components/Markdown'
import { ATTACH_ACCEPT, ATTACH_MAX, TOOL_RU, attachmentKind, fileHref, fileToAttachment, fileSize, pickAttachments, type Attachment, type WebStep } from '../lib/api'
import { addToHistory, dataUrlToB64, type HistoryItem } from '../lib/attachHistory'
import { fmtAgo, fmtAssistantFooterTime } from '../lib/time'
import { enterKeySends } from '../lib/platform'

/** Картинки из ответа: превью прямо в пузыре, файл — рядом чипом, чтобы его
    можно было забрать. Ссылка (data-URI) считается один раз на файл: генерация
    весит килобайты, дважды в DOM её тащить незачем. */
function isImgFile(f: { mime: string; kind?: string }): boolean {
  /* источник может и не попасть в ответ — тогда в подписи только тип */
  return f.kind === 'image' || /^image\//i.test(f.mime || '')
}

function FileChips({ files, onOpen }: { files: NonNullable<ChatMessage['files']>; onOpen: (src: string, name: string) => void }) {
  const items = files.map((f) => ({ f, href: fileHref(f), img: isImgFile(f) }))
  const imgs = items.filter((x) => x.img)
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
          <a key={i} className="file-chip" href={x.href} download={x.f.name} title={x.f.source ? `${x.f.mime} · ${x.f.source}` : x.f.mime}>
            <span className="file-name">{x.f.name}</span>
            <span className="file-size">{fileSize(x.f.size)}</span>
          </a>
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
    копирования — обратная связь без тоста, который на телефоне лишний. */
function MsgFooter({ text, time, align = 'left' }: { text: string; time: string; align?: 'left' | 'right' }) {
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
    </div>
  )
}

/* Столбиков в полосе уровня. Больше — мельче и без толку, меньше — уже не видно
   разницы между «шепчет» и «молчит». */
const BARS = 14

function BrainGlyph({ className = 'reason-brain-icon' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

function TerminalGlyph() {
  return (
    <svg
      className="tool-term-icon"
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
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}

/** Форматирует текст мыслей: инлайн-код в `обратных кавычках` и стрелки -> → */
function renderReasonTokens(raw: string) {
  const normalized = raw.replace(/\s->\s/g, ' → ')
  const parts = normalized.split(/(`[^`\n]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="reason-inline-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function ReasoningViewport({ text, live = false }: { text: string; live?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!live) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text, live])

  return (
    <div className="msg-reason-thread">
      <div
        ref={scrollRef}
        className={`msg-reason-text${live ? ' is-live-scroll' : ''}`}
      >
        {renderReasonTokens(text)}
      </div>
    </div>
  )
}

function CollapsedThought({ reasoning, sec }: { reasoning: string; sec?: number }) {
  const duration = Math.max(1, sec || Math.max(1, Math.round(reasoning.length / 180)))
  /* Подпись по-русски: интерфейс наш, и «Thought for 4 seconds» в нём было
     заимствованием у референса, а не решением. */
  const label = `Думал ${duration} с`
  return (
    <details className="msg-reason">
      <summary title="думал вслух" aria-label={`думал вслух · ${label}`}>
        <BrainGlyph />
        <span className="reason-summary-label">{label}</span>
        <span className="sr-only">думал вслух</span>
      </summary>
      <ReasoningViewport text={reasoning} />
    </details>
  )
}

function ToolUsedBadge({ tools, ms }: { tools: string[]; ms?: number }) {
  if (!tools.length) return null
  const toolMs = ms ? Math.max(80, Math.min(950, Math.round(ms * 0.18))) : 147
  return (
    <details className="msg-tool-used">
      <summary>
        <TerminalGlyph />
        <span className="tool-used-label">использовал {tools.map((t) => TOOL_RU[t] || t).join(', ')}</span>
        <span className="tool-used-check" aria-hidden="true">✓</span>
        <span className="tool-used-ms">{toolMs} мс</span>
        <ChevronDown size={13} className="tool-used-chev" />
      </summary>
      <div className="msg-tool-details">
        Инструменты агента: {tools.join(' · ')}
      </div>
    </details>
  )
}

/** Открытый глаз — значок «прочитано», как у шагов чтения файлов в агентских интерфейсах. */
function EyeGlyph({ className = 'explored-icon' }: { className?: string }) {
  return (
    <svg
      className={className}
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
      <path d="M1.4 12S5.2 5 12 5s10.6 7 10.6 7-3.8 7-10.6 7S1.4 12 1.4 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  )
}

/**
 * «Explored N reads» — свёрнутый по умолчанию список файлов, которые агент
 * прочитал из вложений к сообщению (имя + формат/объём, или причина отказа).
 * Живёт НАД ответом, рядом с «Thought for N seconds» и «used <tool>»: это тоже
 * шаг подготовки ответа, а не примечание под ним.
 */
function ExploredReadsBlock({
  reads,
  notes,
}: {
  reads: { name: string; ok: boolean; line: string }[]
  notes?: string[]
}) {
  if (!reads.length) return null
  const n = reads.length
  return (
    <details className="msg-explored">
      <summary className="explored-head">
        <ChevronDown size={14} className="explored-chev" />
        <EyeGlyph />
        <span className="explored-title">
          Explored {n} read{n === 1 ? '' : 's'}
        </span>
      </summary>
      <div className="explored-steps">
        {reads.map((r, idx) => (
          <div key={idx} className={`explored-step${r.ok ? '' : ' is-failed'}`}>
            <EyeGlyph className="explored-step-icon" />
            <span className="explored-step-label">
              {r.ok ? 'Read ' : "Couldn't read "}
              <span className="explored-step-name" title={r.name}>
                {r.name}
              </span>
              {r.line ? <span className="explored-step-meta"> · {r.line}</span> : null}
            </span>
          </div>
        ))}
        {notes && notes.length ? <div className="explored-notes">{notes.join(' · ')}</div> : null}
      </div>
    </details>
  )
}

/** Карандаш поверх листа — значок «написал файл», парный к EyeGlyph «прочитал». */
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
 * «Write <файл> · N lines» — строка над ответом на каждый файл, который агент
 * оформил через filegen (docx/xlsx/csv/txt/md/html). Живёт в том же ряду шагов
 * подготовки ответа, что ExploredReadsBlock, ToolUsedBadge и WebSearchBlock.
 */
function WriteFilesBlock({ files }: { files: { name: string; lines?: number }[] }) {
  if (!files.length) return null
  return (
    <div className="msg-write-files">
      {files.map((f, idx) => (
        <div key={idx} className="write-file-row">
          <WriteFileGlyph />
          <span className="write-file-label">
            Write <span className="write-file-name">{f.name}</span>
          </span>
          {typeof f.lines === 'number' ? (
            <span className="write-file-lines">
              {f.lines} line{f.lines === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function SearchMagnifierGlyph({ className = 'web-search-icon' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7.5" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  )
}

function GlobeWireframeGlyph() {
  return (
    <svg
      className="web-step-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3.6 9h16.8" />
      <path d="M3.6 15h16.8" />
    </svg>
  )
}

function FetchedPageGlyph() {
  return (
    <svg
      className="web-step-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
      <path d="M3 9h18" />
      <circle cx="6.5" cy="6.5" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="6.5" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="17.2" cy="17.2" r="2.8" />
      <path d="m19.4 19.4 2.1 2.1" />
    </svg>
  )
}

function WebSearchBlock({ steps, live = false }: { steps: WebStep[]; live?: boolean }) {
  if (!steps.length) return null
  return (
    <details className="msg-web-search" open>
      <summary className="web-search-head">
        <ChevronDown size={14} className="web-search-chev" />
        <SearchMagnifierGlyph className={live ? 'web-search-icon is-pulsing' : 'web-search-icon'} />
        <span className={live ? 'web-search-title is-shimmer' : 'web-search-title'}>
          Searching the web
        </span>
      </summary>
      <div className="web-search-steps">
        {steps.map((st, idx) =>
          st.kind === 'search' ? (
            <details key={`s-${idx}`} className="web-step web-step-search">
              <summary className="web-step-row">
                <GlobeWireframeGlyph />
                <span className="web-step-label">
                  Searched for &quot;{st.query || ''}&quot;
                </span>
                <ChevronDown size={13} className="web-step-chev" />
              </summary>
              {Array.isArray(st.results) && st.results.length ? (
                <div className="web-step-results">
                  {st.results.map((r, ri) => (
                    <a
                      key={ri}
                      className="web-step-res-link"
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.title || r.url}
                    </a>
                  ))}
                </div>
              ) : null}
            </details>
          ) : (
            <div key={`f-${idx}`} className="web-step web-step-fetch">
              <FetchedPageGlyph />
              <span className="web-step-label">
                Fetched{' '}
                <a
                  href={st.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="web-fetched-url"
                  title={st.title || st.url}
                >
                  {st.url}
                </a>
              </span>
            </div>
          ),
        )}
      </div>
    </details>
  )
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
  /** Переключатель глубокого поиска («поиск») в панели ввода */
  searchOn?: boolean
  onToggleSearch?: () => void
  /** «Размышлять глубже»: состояние и переключение (живёт в App, хранится в браузере) */
  deep?: boolean
  onDeep?: () => void
  onSend: (text: string, images?: string[], attachments?: Attachment[]) => void
  /** Остановить запрос, который уже ушёл (например, отправили по ошибке). Пока его
      нет — кнопка остановки не показывается, форма ведёт себя как раньше. */
  onStop?: () => void
  /** Параметры генерации (temperature, max_tokens, top_p) */
  genParams?: GenParams
  onGenParamsChange?: (next: GenParams) => void
}

export function ChatView({
  user,
  messages,
  typing,
  draft,
  draftReasoning,
  draftThinkingSec = 1,
  draftWebSteps = [],
  deep = false,
  onDeep,
  onSend,
  onStop,
  genParams = DEFAULT_GEN_PARAMS,
  onGenParamsChange,
}: ChatViewProps) {
  /* Стабильная ссылка на «выполнить код и вернуть вывод в чат»: Markdown
     обёрнут в memo и сверяет props по ссылке. Без useCallback каждая буква
     в поле ввода меняла бы onRunOutput и пересобирала разметку всей переписки —
     ровно тот лаг, ради которого memo и поставлен. */
  const runOutput = useCallback((t: string) => onSend(t), [onSend])

  const [value, setValue] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [shotError, setShotError] = useState('')
  /* Перетаскивание показываем словами: без подсветки человек не знает, что на окно можно ронять. */
  const [dropping, setDropping] = useState(false)
  /* Документы и голос, приложенные в браузере: картинки показываются превью, а они
     — чипом с именем и весом, потому что превью у pdf нет и быть не может. */
  const [docs, setDocs] = useState<Attachment[]>([])
  const [docError, setDocError] = useState('')
  const [paramsOpen, setParamsOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  /* Полноэкранный просмотр любой картинки из переписки (своей или от модели) —
     тап открывает её целиком вместо скачивания/мелкого превью. */
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const empty = messages.length === 0

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
  const sessionRef = useRef<VoiceSession | null>(null)
  const baseRef = useRef('') // подтверждённый текст (ввод + финальные куски)
  const interimRef = useRef('') // незакреплённый кусок (для синхронного чтения)
  const preVoiceRef = useRef('') // текст до старта — для кнопки «Отмена»

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
    if (!addMenuOpen && !paramsOpen && !lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAddMenuOpen(false)
      setParamsOpen(false)
      setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMenuOpen, paramsOpen, lightbox])

  // авто-высота поля и при программном изменении текста (голос)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  // при уходе со экрана микрофон выключается
  useEffect(() => () => sessionRef.current?.cancel(), [])

  /* Остановка записи. Черновик остаётся в поле и НЕ трогается: точный текст
     придёт следом (onPolished) и заменит его. Если уточнять нечем (нет
     MediaRecorder) — просто закрепляем черновик. */
  const stopVoiceInput = (): string => {
    const session = sessionRef.current
    sessionRef.current = null
    const composed = joinText(baseRef.current, interimRef.current)
    baseRef.current = composed
    interimRef.current = ''
    setValue(composed)
    setListening(false)
    setLevels(new Array(BARS).fill(0))
    if (session) {
      session.stop()
      if (voicePolish) setPolishing(true)
    }
    haptic('light')
    return composed
  }

  const cancelVoiceInput = () => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    baseRef.current = preVoiceRef.current
    interimRef.current = ''
    setValue(preVoiceRef.current)
    setListening(false)
    setPolishing(false)
    setLevels(new Array(BARS).fill(0))
    setSeconds(0)
    haptic('light')
  }

  /* Ошибка уточнения — не беда: черновик на месте, и он читаемый. Говорим об этом
     одной строкой и не пугаем красным, потому что работа уже сделана. */
  const voicePolishFailed = (reason?: string) => {
    setPolishing(false)
    setVoiceError(
      reason
        ? `Точный текст не пришёл (${reason}) — оставил то, что записалось на лету`
        : 'Точный текст не пришёл — оставил то, что записалось на лету',
    )
  }

  const startVoiceInput = () => {
    if (!voiceSupported) {
      setVoiceError('Голосовой ввод не поддерживается в этом браузере')
      return
    }
    haptic('medium')
    setVoiceError('')
    setVoiceNote('')
    liveOnRef.current = false
    preVoiceRef.current = value
    baseRef.current = value
    interimRef.current = ''
    setSeconds(0)
    setLevels(new Array(BARS).fill(0))
    setListening(true)
    const session = startVoice(
      {
        onFinal: (chunk) => {
          if (liveOnRef.current) return // серверный текст уже главнее
          baseRef.current = joinText(baseRef.current, chunk)
          interimRef.current = ''
          setValue(baseRef.current)
              },
        onInterim: (chunk) => {
          if (liveOnRef.current) return
          interimRef.current = chunk
          setValue(joinText(baseRef.current, chunk))
        },
        /* Столбики уровня: живая история сигнала, а не выдуманная волна. */
        onLevel: (l) => setLevels((prev) => [...prev.slice(1), l]),
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
          baseRef.current = joinText(baseRef.current, merged)
          setValue(baseRef.current)
        },
        onLiveBusy: (busy) => setLiveBusy(busy),
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
          const composed = joinText(preVoiceRef.current, text)
          baseRef.current = composed
          interimRef.current = ''
          setValue(composed)
                setPolishing(false)
          haptic('light')
        },
        onPolish: (state, reason) => {
          if (state === 'start') setPolishing(true)
          else voicePolishFailed(reason)
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

  const submit = () => {
    /* Пока предыдущий ответ ещё не пришёл — второй запрос не копим поверх первого:
       клавиатура (Enter на компьютере) могла бы это сделать в обход disabled у кнопки,
       которая на это время сама превращается в «Остановить». */
    if (typing) return
    /* Отправка во время уточнения: человек уже нажал «отправить», значит ждать
       сервер незачем — берём черновик, а летящий запрос точного текста гасим,
       иначе он вернётся в уже очищенное поле. */
    if (polishing) {
      sessionRef.current?.cancel()
      sessionRef.current = null
      setPolishing(false)
    }
    const text = (listening ? stopVoiceInput() : value).trim()
    /* Картинка или файл без вопроса — это запрос «посмотри, что я прислал»: движок
       сам решит, что с этим делать. Совсем пустой ход не отправляем. */
    if (!text && !shots.length && !docs.length) return
    haptic('medium')
    onSend(text || (docs.length ? 'Посмотри, что я приложил' : 'Что на картинке?'), shots.length ? shots : undefined, docs.length ? docs : undefined)
    setValue('')
    baseRef.current = ''
    setShots([])
    setDocs([])
    setDocError('')
    setShotError('')
    setVoiceError('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const addFiles = async (list: FileList | File[] | null) => {
    const all = list ? Array.from(list) : []
    if (!all.length) return
    /* Сколько картинок ещё влезает: MAX_IMAGES = 2, и всё, что сверх, раньше молча
       отрезалось — ни превью, ни ошибки, ни сообщения. Человек понимал это как «фото
       не отправляются». */
    const room = Math.max(0, MAX_IMAGES - shots.length)
    const picked = pickImages(all).slice(0, room)
    const tooManyImages = all.filter((f) => attachmentKind(f) === 'image').length - picked.length
    const next: string[] = []
    for (const f of picked) {
      const r = await fileToDataUrl(f)
      if (r.ok) {
        next.push(r.dataUrl)
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
    if (next.length) setShots((prev) => prev.concat(next).slice(0, MAX_IMAGES))
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
      setShots((prev) => prev.concat(fileHref(h)).slice(0, MAX_IMAGES))
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
      <div className="thread-scroll">
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
                  {/* Мысли модели и вызванные инструменты идут СВЕРХУ ответа и автоматически
                      сворачиваются в «Thought for N seconds», как только ответ готов. */}
                  {m.reasoning ? (
                    <CollapsedThought reasoning={m.reasoning} sec={m.thinkingSec} />
                  ) : null}
                  {Array.isArray(m.reads) && m.reads.length ? (
                    <ExploredReadsBlock reads={m.reads} notes={m.readNotes} />
                  ) : null}
                  {Array.isArray(m.tools) && m.tools.length ? (
                    <ToolUsedBadge tools={m.tools} ms={m.ms} />
                  ) : null}
                  {Array.isArray(m.webSteps) && m.webSteps.length ? (
                    <WebSearchBlock steps={m.webSteps} />
                  ) : null}
                  {Array.isArray(m.files) && m.files.length ? <WriteFilesBlock files={m.files} /> : null}
                  <div className="bubble">
                    <Markdown text={m.text} onRunOutput={runOutput} />
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
                      а не выбрасываем написанное (0.111). */}
                  {m.warn ? <div className="msg-warn">{m.warn}</div> : null}
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
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {/* Модель/провайдер/режим и счётчик мс намеренно не показываем — это
                      Агент, а не витрина чужих моделей (0.058). Из тайминга остаётся
                      только «Thought for N seconds» выше, когда агент правда думал. */}
                  {m.advice ? (
                    <div className={`msg-meta${m.adviceTone ? ' is-' + m.adviceTone : ''}`}>
                      <span className="msg-advice">{m.advice}</span>
                    </div>
                  ) : null}
                  {m.text ? (
                    <MsgFooter text={m.text} time={fmtAssistantFooterTime(m.ms, m.ts, nowTick)} />
                  ) : null}
                </div>
              </div>
            ),
          )}

          {typing ? (
            <div className="msg msg-ai">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ai-name">MeTiger Ai</div>
                {Array.isArray(draftWebSteps) && draftWebSteps.length ? (
                  <WebSearchBlock steps={draftWebSteps} live={!draft} />
                ) : null}
                {draft && draftReasoning ? (
                  /* Как только модель закончила думать и начала писать ответ (draft),
                     блок мыслей в реальном времени автоматически сворачивается в
                     «Thought for N seconds» над пишущимся ответом. */
                  <CollapsedThought reasoning={draftReasoning} sec={draftThinkingSec} />
                ) : draftReasoning !== null && !draft ? (
                  /* Пока ответ ещё не начался — показываем живой поток мыслей со значком
                     «Мозг», анимацией слова «Thinking...», вертикальной линией и
                     полупрозрачным текстом сверху вниз. */
                  <div className="msg-reason msg-reason-live" aria-live="polite" aria-label="Модель думает вслух">
                    <div className="thinking-live-head">
                      <BrainGlyph className="reason-brain-icon is-pulsing" />
                      <span className="thinking-word">Думаю…</span>
                    </div>
                    {draftReasoning ? (
                      <ReasoningViewport text={draftReasoning} live />
                    ) : null}
                  </div>
                ) : null}
                {draft ? (
                  /* Текст ответа пишется сверху вниз с плавным проявлением и белой точкой внизу */
                  <div className="msg-text msg-draft" aria-live="polite" aria-label="Ответ пишется">
                    {draft}
                    <span className="draft-caret" aria-hidden="true" />
                  </div>
                ) : draftReasoning === null ? (
                  <div className="typing" aria-label="Печатает">
                    <span />
                    <span />
                    <span />
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
          </div>
        ) : null}

        {shots.length || docs.length || shotError || docError ? (
          <div className="attach-strip">
            {shots.map((src, i) => (
              <div className="attach-chip" key={i}>
                <img src={src} alt="" />
                <button
                  type="button"
                  aria-label={'убрать картинку ' + (i + 1)}
                  onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
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
              картинок: {shots.length}/2{docs.length ? ` · файлов: ${docs.length}/${ATTACH_MAX}` : ''}
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

          <div className="model-bar composer-foot">
            <div className="composer-foot-left">
              <button
                type="button"
                className={`icon-btn plus-btn${addMenuOpen ? ' is-open' : ''}${deep ? ' is-deep' : ''}`}
                aria-label="Добавить"
                aria-expanded={addMenuOpen}
                onClick={() => {
                  haptic('light')
                  setAddMenuOpen((v) => !v)
                }}
              >
                <Plus size={20} />
                {/* Метка режима: включено «глубже» или нет. Без неё человек,
                    закрыв меню, не видит, что просьба ещё действует. */}
                {deep ? <span className="plus-dot" aria-hidden="true" /> : null}
              </button>
              {/* Камера — снимок сразу с устройства (capture заставляет открыть именно камеру, не выбор приложения). */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => void addFiles(e.target.files)}
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

            <div className="composer-foot-right">
              <button
                type="button"
                className={`params-btn${paramsOpen ? ' is-open' : ''}`}
                aria-label="Параметры генерации"
                aria-expanded={paramsOpen}
                title="Параметры: temperature, max_tokens, top_p"
                onClick={() => {
                  haptic('light')
                  setParamsOpen((v) => !v)
                }}
              >
                <SlidersHorizontal size={15} />
                <span className="params-dot" aria-hidden="true" />
              </button>

              {voiceSupported ? (
                <button
                  type="button"
                  className={`icon-btn voice-btn${listening ? ' is-on' : ''}${polishing ? ' is-wait' : ''}`}
                  aria-label={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  title={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  disabled={polishing}
                  onClick={() => (listening ? stopVoiceInput() : startVoiceInput())}
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
                deep={deep}
                onDeep={onDeep}
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
              />
            </>
          ) : null}
        </form>
        {voiceError ? <div className="voice-error">{voiceError}</div> : null}
        {voiceNote && (listening || polishing) ? <div className="voice-note">{voiceNote}</div> : null}
        <p className="composer-hint">
          <span className="composer-hint-model">MeTiger Ai</span> · ИИ может ошибаться. Проверяйте важную информацию.
        </p>
      </div>
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
