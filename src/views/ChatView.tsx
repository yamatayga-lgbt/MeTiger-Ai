import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Mic, Paperclip, SlidersHorizontal, Square, X } from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import { haptic } from '../lib/haptic'
import { type Person } from '../lib/user'
import { timeGreeting, type ChatMessage } from '../lib/mock'
import { fileToDataUrl, filesFromTransfer, MAX_IMAGES, pickImages } from '../lib/images'
import { isVoiceSupported, startVoice, voiceLang, type VoiceSession } from '../lib/voice'
import {
  DEFAULT_GEN_PARAMS,
  EFFORT_LABELS,
  modelOption,
  type GenParams,
  type ReasoningEffort,
} from '../lib/models'
import { ModelIcon } from '../components/ModelIcon'
import { ModelPicker } from '../components/ModelPicker'
import { ParamsPopover } from '../components/ParamsPopover'
import { CodeRunner } from '../components/CodeRunner'
import { runnable } from '../lib/sandbox'
import { ATTACH_ACCEPT, ATTACH_MAX, attachmentKind, fileHref, fileToAttachment, fileSize, pickAttachments, type Attachment, type WebStep } from '../lib/api'

/** Картинки из ответа: превью прямо в пузыре, файл — рядом чипом, чтобы его
    можно было забрать. Ссылка (data-URI) считается один раз на файл: генерация
    весит килобайты, дважды в DOM её тащить незачем. */
function isImgFile(f: { mime: string; kind?: string }): boolean {
  /* источник может и не попасть в ответ — тогда в подписи только тип */
  return f.kind === 'image' || /^image\//i.test(f.mime || '')
}

function FileChips({ files }: { files: NonNullable<ChatMessage['files']> }) {
  const items = files.map((f) => ({ f, href: fileHref(f), img: isImgFile(f) }))
  const imgs = items.filter((x) => x.img)
  return (
    <div className="msg-files">
      {imgs.length ? (
        <div className="msg-imgs">
          {imgs.map((x, i) => (
            <a key={`i${i}`} className="msg-img" href={x.href} download={x.f.name} title={x.f.source ? `${x.f.name} · ${x.f.mime} · ${x.f.source}` : `${x.f.name} · ${x.f.mime}`}>
              <img src={x.href} alt={x.f.name} loading="lazy" />
            </a>
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

const WAVE_WEIGHTS = [0.55, 0.95, 0.7, 1, 0.55, 0.85, 0.65]

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
  const label = `Thought for ${duration} second${duration === 1 ? '' : 's'}`
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
        <span className="tool-used-label">used {tools.join(', ')}</span>
        <span className="tool-used-check" aria-hidden="true">✓</span>
        <span className="tool-used-ms">{toolMs}ms</span>
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

function RichText({ text, onRunOutput }: { text: string; onRunOutput?: (t: string) => void }) {
  const segments = text.split(/```/)
  return (
    <div className="msg-text">
      {segments.map((seg, i) => {
        if (i % 2 === 1) {
          const firstBreak = seg.indexOf('\n')
          const lang = firstBreak > -1 ? seg.slice(0, firstBreak).trim() : ''
          const code = firstBreak > -1 ? seg.slice(firstBreak + 1) : seg
          return (
            <div className="code-block" key={i}>
              <div className="code-head">
                <span>{lang || 'code'}</span>
                {/* Не «demo» для JS: его можно запустить, и человек должен видеть,
                    что блок проверялся, а не просто красиво подсвечен. */}
                <span>{runnable(lang) ? 'песочница' : 'demo'}</span>
              </div>
              <pre>
                <code>{code.replace(/\n$/, '')}</code>
              </pre>
              {runnable(lang) ? <CodeRunner code={code.replace(/\n$/, '')} onSend={onRunOutput} /> : null}
            </div>
          )
        }
        return (
          <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {seg}
          </p>
        )
      })}
    </div>
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
  /** Переключатель «думать вслух» в панели ввода */
  reasoningOn?: boolean
  onToggleReasoning?: () => void
  /** Переключатель глубокого поиска («поиск») в панели ввода */
  searchOn?: boolean
  onToggleSearch?: () => void
  onSend: (text: string, images?: string[], attachments?: Attachment[]) => void
  /** Выбранная модель ('' = Авто) и смена — живут в App и сохраняются. */
  model?: string
  onModelChange?: (id: string) => void
  /** Усилие рассуждения: Низкое / Среднее / Высокое */
  effort?: ReasoningEffort
  onEffortChange?: (effort: ReasoningEffort) => void
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
  reasoningOn = true,
  onToggleReasoning,
  onSend,
  model = '',
  onModelChange,
  effort = 'medium',
  onEffortChange,
  genParams = DEFAULT_GEN_PARAMS,
  onGenParamsChange,
}: ChatViewProps) {
  const [value, setValue] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [shotError, setShotError] = useState('')
  /* Перетаскивание показываем словами: без подсветки человек не знает, что на окно можно ронять. */
  const [dropping, setDropping] = useState(false)
  /* Документы и голос, приложенные в браузере: картинки показываются превью, а они
     — чипом с именем и весом, потому что превью у pdf нет и быть не может. */
  const [docs, setDocs] = useState<Attachment[]>([])
  const [docError, setDocError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [paramsOpen, setParamsOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const empty = messages.length === 0
  const modelOpt = modelOption(model)

  // --- голосовой ввод ---
  const voiceSupported = isVoiceSupported()
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [voiceError, setVoiceError] = useState('')
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

  // авто-высота поля и при программном изменении текста (голос)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  // при уходе со экрана микрофон выключается
  useEffect(() => () => sessionRef.current?.cancel(), [])

  const stopVoiceInput = (): string => {
    const session = sessionRef.current
    sessionRef.current = null
    session?.stop()
    const composed = joinText(baseRef.current, interimRef.current)
    baseRef.current = composed
    interimRef.current = ''
    setValue(composed)
    setInterim('')
    setListening(false)
    setLevel(0)
    haptic('light')
    return composed
  }

  const cancelVoiceInput = () => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    baseRef.current = preVoiceRef.current
    interimRef.current = ''
    setValue(preVoiceRef.current)
    setInterim('')
    setListening(false)
    setLevel(0)
    setSeconds(0)
    haptic('light')
  }

  const startVoiceInput = () => {
    if (!voiceSupported) {
      setVoiceError('Голосовой ввод не поддерживается в этом браузере')
      return
    }
    haptic('medium')
    setVoiceError('')
    preVoiceRef.current = value
    baseRef.current = value
    interimRef.current = ''
    setInterim('')
    setSeconds(0)
    setLevel(0)
    setListening(true)
    const session = startVoice(
      {
        onFinal: (chunk) => {
          baseRef.current = joinText(baseRef.current, chunk)
          interimRef.current = ''
          setValue(baseRef.current)
          setInterim('')
        },
        onInterim: (chunk) => {
          interimRef.current = chunk
          setValue(joinText(baseRef.current, chunk))
          setInterim(chunk)
        },
        onLevel: (l) => setLevel(l),
        onError: (message) => {
          setVoiceError(message)
          cancelVoiceInput()
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
      if (r.ok) next.push(r.dataUrl)
      else setShotError(r.error)
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
        if (r.ok) made.push(r.att)
        else errs.push(r.error)
      }
      if (extra > 0) errs.push(`лишних файлов ${extra} — читаю не больше ${ATTACH_MAX}`)
      setDocs((prev) => prev.concat(made).slice(0, ATTACH_MAX))
      setDocError(errs.join(' · '))
    }
    if (fileRef.current) fileRef.current.value = ''
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
      {empty ? (
        <div className="chat-hero">
          <img className="hero-mark" src={avatarUrl} alt="MeTiger Ai" />
          <h1 className="hero-title">
            {timeGreeting()}, {user.name}.
            <br />
            Чем <span className="accent">помочь</span>?
          </h1>
          <p className="hero-sub">
            Универсальный ИИ-агент для любых задач: тексты, код, изображения, анализ и
            автоматизация.
          </p>
        </div>
      ) : (
        <div className="thread">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                <div className="bubble">
                  {m.images && m.images.length ? (
                    <div className="shot-row">
                      {m.images.map((src, i) => (
                        <img key={i} className="shot" src={src} alt="" />
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
              </div>
            ) : (
              <div key={m.id} className="msg msg-ai">
                <div className="msg-avatar">
                  <img src={avatarUrl} alt="" />
                </div>
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
                  <div className="bubble">
                    <RichText text={m.text} onRunOutput={(t) => onSend(t)} />
                  </div>
                  {/* Кто ответил и что сказал совет. Это не украшение: по ней видно,
                      что ответ проверяли, а не угадали, и где его исправили. */}
                  {/* Файлы, которые модель оформила блоком. Ссылка — data-URI:
                      своего хранилища под раздачу нет, файл живёт, пока открыта
                      вкладка. После перезагрузки его нужно попросить заново. */}
                  {Array.isArray(m.files) && m.files.length ? <FileChips files={m.files} /> : null}
                  {/* Причина, по которой вложения нет. Прячем её под ответ, а не в
                      конец текста: человек должен увидеть отказ до того, как
                      станет искать картинку. */}
                  {m.fileError ? <div className="msg-warn">{m.fileError}</div> : null}
                  {/* Что агент прочитал из приложенного — чтобы «он же не видел мой
                      файл» не превращалось в спор. Новые ответы показывают это выше,
                      блоком «Explored N reads»; эта строка — обратная совместимость
                      для ответов без структурного m.reads. */}
                  {!m.reads?.length && m.attach ? <div className="msg-read">{m.attach}</div> : null}
                  {/* Чем оплатили окно и чужой «system»: история урезана, подсказки
                      обрезаны. Это не предупреждение, это условия ответа. */}
                  {m.notes ? <div className="msg-note">{m.notes}</div> : null}
                  {Array.isArray(m.skills) && m.skills.length ? (
                    <div className="msg-skills">по навыкам: {m.skills.join(' · ')}</div>
                  ) : null}
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
                  {m.advice || m.src ? (
                    <div className={`msg-meta${m.adviceTone ? ' is-' + m.adviceTone : ''}`}>
                      {m.advice ? <span className="msg-advice">{m.advice}</span> : null}
                      {m.src ? <span className="msg-src">{m.src}</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ),
          )}

          {typing ? (
            <div className="msg msg-ai">
              <div className="msg-avatar">
                <img src={avatarUrl} alt="" />
              </div>
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
                      <span className="thinking-word">Thinking...</span>
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

      <div className="composer-wrap">
        {listening ? (
          <div className="voice-panel">
            <div className="voice-head">
              <span className="voice-live">
                <span className="voice-dot" />
                Слушаю · {fmtTime(seconds)}
              </span>
              <button type="button" className="voice-cancel" onClick={cancelVoiceInput}>
                Отмена
              </button>
            </div>
            <div className="voice-wave" aria-hidden="true">
              {WAVE_WEIGHTS.map((w, i) => (
                <span key={i} style={{ height: `${3 + level * 21 * w}px` }} />
              ))}
            </div>
            <div className="voice-interim">{interim || 'Говорите…'}</div>
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
          className="composer"
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
              placeholder="Сообщение (Shift+Enter — новая строка)…"
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
                if (e.key === 'Enter' && !e.shiftKey) {
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
                className="icon-btn"
                aria-label="Прикрепить файл, документ или запись"
                onClick={() => {
                  haptic('light')
                  fileRef.current?.click()
                }}
              >
                <Paperclip size={18} />
              </button>
              <input
                ref={fileRef}
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
                className={`model-chip${pickerOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                title="Выбрать модель и режим мышления"
                onClick={() => {
                  haptic('light')
                  setParamsOpen(false)
                  setPickerOpen((v) => !v)
                }}
              >
                <ModelIcon
                  id={modelOpt.id}
                  vendor={modelOpt.vendor}
                  name={modelOpt.name}
                  avatar={modelOpt.avatar}
                />
                <span className="model-chip-name">{modelOpt.name}</span>
                {modelOpt.canThink !== false ? (
                  <span className="model-chip-mode">
                    {!reasoningOn ? 'Выкл.' : modelOpt.supportsEffort ? EFFORT_LABELS[effort] : 'Думает'}
                  </span>
                ) : null}
                <ChevronDown size={13} className="model-chip-caret" />
              </button>

              <button
                type="button"
                className={`params-btn${paramsOpen ? ' is-open' : ''}`}
                aria-label="Параметры генерации"
                aria-expanded={paramsOpen}
                title="Параметры: temperature, max_tokens, top_p"
                onClick={() => {
                  haptic('light')
                  setPickerOpen(false)
                  setParamsOpen((v) => !v)
                }}
              >
                <SlidersHorizontal size={15} />
                <span className="params-dot" aria-hidden="true" />
              </button>

              {voiceSupported ? (
                <button
                  type="button"
                  className={`icon-btn voice-btn${listening ? ' is-on' : ''}`}
                  aria-label={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  title={listening ? 'Выключить микрофон' : 'Голосовой ввод'}
                  onClick={() => (listening ? stopVoiceInput() : startVoiceInput())}
                >
                  {listening ? <Square size={13} /> : <Mic size={17} />}
                </button>
              ) : null}

              <button
                type="submit"
                className="send-btn"
                disabled={!value.trim() && shots.length === 0 && docs.length === 0}
                aria-label="Отправить"
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </div>

          {pickerOpen ? (
            <>
              <div className="model-backdrop" onClick={() => setPickerOpen(false)} />
              <ModelPicker
                model={model}
                reasoningOn={reasoningOn}
                onToggleReasoning={onToggleReasoning}
                effort={effort}
                onEffortChange={onEffortChange}
                onPick={(id) => {
                  onModelChange?.(id)
                  if (id === model) setPickerOpen(false)
                }}
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
        <p className="composer-hint">
          <span className="composer-hint-model">{modelOpt.name}</span> · ИИ может ошибаться. Проверяйте важную информацию.
        </p>
      </div>
    </div>
  )
}
