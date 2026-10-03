import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Mic, Paperclip, Square, X } from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import { haptic } from '../lib/haptic'
import { type Person } from '../lib/user'
import { timeGreeting, type ChatMessage } from '../lib/mock'
import { fileToDataUrl, filesFromTransfer, MAX_IMAGES, pickImages } from '../lib/images'
import { isVoiceSupported, startVoice, voiceLang, type VoiceSession } from '../lib/voice'
import { modelOption } from '../lib/models'
import { ModelPicker } from '../components/ModelPicker'
import { CodeRunner } from '../components/CodeRunner'
import { runnable } from '../lib/sandbox'
import { ATTACH_ACCEPT, ATTACH_MAX, attachmentKind, fileHref, fileToAttachment, fileSize, pickAttachments, type Attachment } from '../lib/api'

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
  onSend: (text: string, images?: string[], attachments?: Attachment[]) => void
  /** Выбранная модель ('' = Авто) и смена — живут в App и сохраняются. */
  model?: string
  onModelChange?: (id: string) => void
}

export function ChatView({ user, messages, typing, draft, onSend, model = '', onModelChange }: ChatViewProps) {
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
                      файл» не превращалось в спор: список прочитанного под ответом. */}
                  {m.attach ? <div className="msg-read">{m.attach}</div> : null}
                  {/* Чем оплатили окно и чужой «system»: история урезана, подсказки
                      обрезаны. Это не предупреждение, это условия ответа. */}
                  {m.notes ? <div className="msg-note">{m.notes}</div> : null}
                  {Array.isArray(m.skills) && m.skills.length ? (
                    <div className="msg-skills">по навыкам: {m.skills.join(' · ')}</div>
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
              <div>
                <div className="ai-name">MeTiger Ai</div>
                {draft ? (
                  /* текст летит с сервера кусками: показываем его живьём вместо «печатаю»,
                     иначе человек смотрит на три точки там, где ответ уже пишется */
                  <div className="msg-text msg-draft" aria-live="polite" aria-label="Ответ пишется">
                    {draft}
                    <span className="draft-caret" aria-hidden="true" />
                  </div>
                ) : (
                  <div className="typing" aria-label="Печатает">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
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
          <div className="model-bar">
            <button
              type="button"
              className={`model-chip${pickerOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              title="Выбрать модель"
              onClick={() => {
                haptic('light')
                setPickerOpen((v) => !v)
              }}
            >
              <span className="m-av" style={{ background: modelOpt.avatar.bg }}>
                {modelOpt.avatar.mark}
              </span>
              <span className="model-chip-name">{modelOpt.name}</span>
              <ChevronDown size={13} className="model-chip-caret" />
            </button>
          </div>
          <div className="composer-main">
          <button
            type="button"
            className="icon-btn"
            aria-label="Прикрепить файл, документ или запись"
            onClick={() => {
              haptic('light')
              /* Спрятанный input сам диалог не открывает — только по клику. */
              fileRef.current?.click()
            }}
          >
            <Paperclip size={17} />
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
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder="Спросите что угодно…"
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
          {pickerOpen ? (
            <>
              <div className="model-backdrop" onClick={() => setPickerOpen(false)} />
              <ModelPicker
                model={model}
                onPick={(id) => {
                  onModelChange?.(id)
                  setPickerOpen(false)
                }}
              />
            </>
          ) : null}
        </form>
        {voiceError ? <div className="voice-error">{voiceError}</div> : null}
        <p className="composer-hint">Может ошибаться — проверяйте важную информацию.</p>
      </div>
    </div>
  )
}
