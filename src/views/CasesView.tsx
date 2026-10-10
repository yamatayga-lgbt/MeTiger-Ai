import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Briefcase,
  Check,
  CircleCheck,
  Clock3,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Badge, Button, IconButton } from '../components/ui'
import type { Chat } from '../App'
import type { CaseFile, CaseStatus } from '../lib/cases'

interface CasesViewProps {
  cases: CaseFile[]
  chats: Chat[]
  onNew: () => void
  onEdit: (item: CaseFile) => void
  onContinue: (item: CaseFile) => void
  onToggleStatus: (item: CaseFile) => void
  onDelete: (item: CaseFile) => void
}

function updatedLabel(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'ещё не обновлялось'
  return `обновлено ${new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
}

function CaseNotes({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="case-detail-field">
      <div className="case-detail-label">{label}</div>
      <ul>
        {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
      </ul>
    </div>
  )
}

export function CasesView({ cases, chats, onNew, onEdit, onContinue, onToggleStatus, onDelete }: CasesViewProps) {
  const [filter, setFilter] = useState<CaseStatus>('active')
  const activeCount = cases.filter((item) => item.status === 'active').length
  const doneCount = cases.length - activeCount
  const visible = useMemo(
    () => cases.filter((item) => item.status === filter).sort((a, b) => b.updatedAt - a.updatedAt),
    [cases, filter],
  )

  return (
    <div className="container view cases-view">
      <div className="page-head">
        <div className="grow">
          <h1>Дела</h1>
          <p className="sub">Цели, принятые решения и следующий шаг — чтобы продолжать, а не начинать заново.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={onNew}>Новое дело</Button>
      </div>

      <div className="cases-intro">
        <Briefcase size={16} />
        <span>Запиши контрольную точку в чате — MeTiger подхватит её при продолжении. Карточки хранятся только на этом устройстве.</span>
      </div>

      <div className="cases-tabs" role="tablist" aria-label="Фильтр дел">
        <button type="button" role="tab" aria-selected={filter === 'active'} className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>
          В работе <span>{activeCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={filter === 'done'} className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
          Готово <span>{doneCount}</span>
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="cases-empty">
          <div className="cases-empty-icon">{filter === 'active' ? <Briefcase size={24} /> : <CircleCheck size={24} />}</div>
          <h2>{filter === 'active' ? (cases.length ? 'Все дела завершены' : 'Пока нет дел') : 'Пока ничего не завершено'}</h2>
          <p>{filter === 'active'
            ? (cases.length ? 'Можно вернуть любое дело в работу.' : 'Открой чат, нажми на его название в верхней панели и выбери «Записать как дело». Перед сохранением можно поправить цель и следующий шаг.')
            : 'Когда закончишь дело, отметь его — оно останется здесь.'}</p>
          {filter === 'active' && cases.length === 0 ? <Button variant="secondary" icon={Plus} onClick={onNew}>Создать карточку</Button> : null}
        </div>
      ) : (
        <div className="cases-grid">
          {visible.map((item) => {
            const linkedChat = chats.find((chat) => chat.id === item.chatId)
            return (
              <article className={`case-card${item.status === 'done' ? ' is-done' : ''}`} key={item.id}>
                <div className="case-card-head">
                  <div className="case-card-icon"><Briefcase size={17} /></div>
                  <div className="case-card-title">
                    <h2>{item.title}</h2>
                    <div className="case-card-meta">
                      <Badge tone={item.status === 'done' ? 'green' : 'accent'}>
                        {item.status === 'done' ? 'Завершено' : 'В работе'}
                      </Badge>
                      <span><Clock3 size={12} />{updatedLabel(item.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="case-detail-field case-goal-field">
                  <div className="case-detail-label">Цель</div>
                  <p>{item.goal || <span className="case-muted">Добавь, к какому результату идём.</span>}</p>
                </div>

                <CaseNotes label="Решения и важные факты" items={item.decisions} />
                <CaseNotes label="Уже сделано" items={item.completed} />

                <div className="case-next-step">
                  <ArrowRight size={15} />
                  <div>
                    <div className="case-detail-label">Следующий шаг</div>
                    <p>{item.nextStep || <span className="case-muted">Запиши его после следующего разговора.</span>}</p>
                  </div>
                </div>

                <div className="case-card-foot">
                  <span className="case-linked-chat">
                    {linkedChat ? <><MessageCircle size={13} />Продолжит чат «{linkedChat.title}»</> : 'При продолжении создастся новый чат'}
                  </span>
                </div>

                <div className="case-card-actions">
                  <Button variant="primary" icon={MessageCircle} onClick={() => onContinue(item)}>Продолжить</Button>
                  <Button variant="secondary" icon={Pencil} onClick={() => onEdit(item)}>Изменить</Button>
                  <Button variant="ghost" icon={item.status === 'done' ? RotateCcw : Check} onClick={() => onToggleStatus(item)}>
                    {item.status === 'done' ? 'Вернуть в работу' : 'Завершить'}
                  </Button>
                  <IconButton
                    icon={Trash2}
                    label={`Удалить дело «${item.title}»`}
                    className="case-delete-btn"
                    onClick={() => {
                      const message = item.chatId
                        ? `Удалить дело «${item.title}» и связанную переписку${linkedChat ? ` «${linkedChat.title}»` : ''}? Переписку и вложения восстановить нельзя.`
                        : `Удалить дело «${item.title}»? Это действие нельзя отменить.`
                      if (window.confirm(message)) onDelete(item)
                    }}
                    size={15}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
