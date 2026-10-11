/**
 * Управление данными (0.155) — что лежит на устройстве и на сервере и как это стереть.
 *
 * Раньше эти рычаги были разбросаны: «Забыть» стояло под формой профиля, ключ
 * памяти подписывался строкой в настройках, а полный сброс существовал только на
 * экране аварийного восстановления (RootGuard) — то есть человек видел его, лишь
 * когда приложение уже упало. Здесь всё это в одном месте и с честными числами:
 * сколько чатов и сообщений действительно лежит в браузере.
 *
 * Стирание необратимо, поэтому кнопка просит второе нажатие — палец на телефоне
 * нажимает быстрее, чем человек успевает передумать.
 */
import { Fingerprint, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, Button } from '../components/ui'
import { clearProfile } from '../lib/api'
import { currentUserId, identityLine } from '../lib/identity'
import type { Chat } from '../App'

interface DataViewProps {
  chats: Chat[]
  notify: (msg: string) => void
  onWipeLocal: () => void
}

export function DataView({ chats, notify, onWipeLocal }: DataViewProps) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)
  const messages = chats.reduce((a, c) => a + (c.messages ? c.messages.length : 0), 0)

  const arm = () => {
    if (armed) {
      setArmed(false)
      onWipeLocal()
      return
    }
    setArmed(true)
    if (timer.current) window.clearTimeout(timer.current)
    /* Передумал — кнопка возвращается к обычной подписи сама. */
    timer.current = window.setTimeout(() => setArmed(false), 4000)
  }

  return (
    <div className="container view data-view">
      <div className="page-head">
        <div className="grow">
          <h1>Управление данными</h1>
          <p className="sub">Что хранится, где именно и как это стереть.</p>
        </div>
        <Fingerprint size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="settings-group">
        <div className="settings-label">На этом устройстве</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Fingerprint size={16} />
            </div>
            <div className="grow">
              <div className="n">Переписка</div>
              <div className="d">
                {chats.length} {plural(chats.length, 'чат', 'чата', 'чатов')} ·{' '}
                {messages} {plural(messages, 'сообщение', 'сообщения', 'сообщений')} — лежат
                в браузере, вложения — в его же базе
              </div>
            </div>
            <Badge tone="gray">Браузер</Badge>
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <Fingerprint size={16} />
            </div>
            <div className="grow">
              <div className="n">Ключ памяти</div>
              <div className="d">
                {identityLine(currentUserId())} — под ним на сервере хранится память
                и профиль этого человека
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Стереть</div>
        <div className="settings-card">
          <div className="settings-form">
            <div className="actions">
              <Button
                variant={armed ? 'primary' : 'secondary'}
                icon={Trash2}
                onClick={arm}
              >
                {armed ? 'Точно стереть? Нажмите ещё раз' : 'Очистить все чаты на устройстве'}
              </Button>
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={async () => {
                  const r = await clearProfile()
                  notify(r.ok ? 'Профиль забыт' : 'Не вышло: ' + (r.error || 'неизвестно'))
                }}
              >
                Забыть профиль на сервере
              </Button>
            </div>
            <div className="hint">
              Чаты и вложения живут только в этом браузере: очистка стирает их
              безвозвратно. Профиль и память лежат на сервере под ключом устройства.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Русское склонение: 1 чат, 2 чата, 5 чатов. */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
