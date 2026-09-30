import { useRef, useState } from 'react'
import {
  ArrowUp,
  CalendarDays,
  Code2,
  ImagePlus,
  Paperclip,
  PenLine,
  Sparkles,
} from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import { haptic, type TgUser } from '../lib/telegram'
import { SUGGESTIONS, timeGreeting, type ChatMessage } from '../lib/mock'
import type { IconType } from '../components/ui'

const SUGGESTION_ICONS: Record<string, IconType> = {
  pen: PenLine,
  code: Code2,
  image: ImagePlus,
  calendar: CalendarDays,
}

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
  onSend: (text: string) => void
}

export function ChatView({ user, messages, typing, onSend }: ChatViewProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const empty = messages.length === 0

  const submit = () => {
    const text = value.trim()
    if (!text) return
    haptic('medium')
    onSend(text)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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

          <div className="suggestions">
            {SUGGESTIONS.map((s) => {
              const Icon = SUGGESTION_ICONS[s.icon] ?? Sparkles
              return (
                <button
                  key={s.text}
                  type="button"
                  className="suggestion"
                  onClick={() => {
                    haptic('light')
                    onSend(s.text)
                  }}
                >
                  <Icon size={16} />
                  {s.text}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="thread">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                <div className="bubble">{m.text}</div>
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
            aria-label="Прикрепить файл"
            onClick={() => haptic('light')}
          >
            <Paperclip size={17} />
          </button>
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
            disabled={!value.trim()}
            aria-label="Отправить"
          >
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="composer-hint">
          MeTiger Ai может ошибаться — проверяйте важную информацию. Дизайн-превью v0.1.0
        </p>
      </div>
    </div>
  )
}
