import { useRef, useState } from 'react'
import { ArrowUp, Paperclip, X } from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import { haptic, type TgUser } from '../lib/telegram'
import { timeGreeting, type ChatMessage } from '../lib/mock'
import { fileToDataUrl, pickImages } from '../lib/images'

function RichText({ text }: { text: string }) {
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
                <span>demo</span>
              </div>
              <pre>
                <code>{code.replace(/\n$/, '')}</code>
              </pre>
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
  user: TgUser
  messages: ChatMessage[]
  typing: boolean
  onSend: (text: string, images?: string[]) => void
}

export function ChatView({ user, messages, typing, onSend }: ChatViewProps) {
  const [value, setValue] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [shotError, setShotError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const empty = messages.length === 0

  const submit = () => {
    const text = value.trim()
    /* Картинка без вопроса — это не запрос: движок не знает, что с ней делать. */
    if (!text && !shots.length) return
    haptic('medium')
    onSend(text || 'Что на картинке?', shots.length ? shots : undefined)
    setValue('')
    setShots([])
    setShotError('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const addFiles = async (list: FileList | null) => {
    const picked = pickImages(list ? Array.from(list) : [])
    if (!picked.length) return
    const next: string[] = []
    for (const f of picked) {
      const r = await fileToDataUrl(f)
      if (r.ok) next.push(r.dataUrl)
      else setShotError(r.error)
    }
    if (next.length) setShots((prev) => prev.concat(next).slice(0, 2))
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="chat-root">
      {empty ? (
        <div className="chat-hero">
          <img className="hero-mark" src={avatarUrl} alt="MeTiger Ai" />
          <h1 className="hero-title">
            {timeGreeting()}, {user.first_name}.
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
                    <RichText text={m.text} />
                  </div>
                  {/* Кто ответил и что сказал совет. Это не украшение: по ней видно,
                      что ответ проверяли, а не угадали, и где его исправили. */}
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
                <div className="typing" aria-label="Печатает">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="composer-wrap">
        {shots.length || shotError ? (
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
            {shotError ? <span className="attach-error">{shotError}</span> : null}
            <span className="attach-hint">картинок: {shots.length}/2</span>
          </div>
        ) : null}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Прикрепить картинку"
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
            accept="image/*"
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
              setValue(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!value.trim() && shots.length === 0}
            aria-label="Отправить"
          >
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="composer-hint">Может ошибаться — проверяйте важную информацию.</p>
      </div>
    </div>
  )
}
