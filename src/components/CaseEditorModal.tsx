import { useEffect, useState, type FormEvent } from 'react'
import { Briefcase, Check, X } from 'lucide-react'
import { Button, IconButton } from './ui'
import { splitCaseNotes, type CaseFile } from '../lib/cases'

interface CaseEditorModalProps {
  open: boolean
  initial: CaseFile | null
  onClose: () => void
  onSave: (next: CaseFile) => void
}

export function CaseEditorModal({ open, initial, onClose, onSave }: CaseEditorModalProps) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [decisions, setDecisions] = useState('')
  const [completed, setCompleted] = useState('')
  const [nextStep, setNextStep] = useState('')

  useEffect(() => {
    if (!open || !initial) return
    setTitle(initial.title)
    setGoal(initial.goal)
    setDecisions(initial.decisions.join('\n'))
    setCompleted(initial.completed.join('\n'))
    setNextStep(initial.nextStep)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !initial) return null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const now = Date.now()
    onSave({
      ...initial,
      title: title.trim().slice(0, 50) || 'Новое дело',
      goal: goal.trim().slice(0, 900),
      decisions: splitCaseNotes(decisions),
      completed: splitCaseNotes(completed),
      nextStep: nextStep.trim().slice(0, 420),
      updatedAt: now,
    })
  }

  return (
    <div
      className="case-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="case-editor" role="dialog" aria-modal="true" aria-labelledby="case-editor-title">
        <div className="case-editor-head">
          <div className="case-editor-icon"><Briefcase size={18} /></div>
          <div className="grow">
            <h2 id="case-editor-title">Карточка дела</h2>
            <p>Проверь и сохрани важное — это поможет продолжить с того же места.</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} size={16} />
        </div>

        <form onSubmit={submit} className="case-editor-form">
          <label className="case-field">
            <span>Название <small>{title.length}/50</small></span>
            <input
              value={title}
              maxLength={50}
              placeholder="Например: Подготовка к экзамену"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="case-field">
            <span>Цель</span>
            <textarea
              rows={3}
              maxLength={900}
              value={goal}
              placeholder="Какого результата хотим добиться?"
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>

          <div className="case-editor-grid">
            <label className="case-field">
              <span>Решения и важные факты</span>
              <textarea
                rows={3}
                maxLength={1600}
                value={decisions}
                placeholder={'По одному пункту в строке\nНапример: занимаюсь по вечерам'}
                onChange={(event) => setDecisions(event.target.value)}
              />
            </label>
            <label className="case-field">
              <span>Уже сделано</span>
              <textarea
                rows={3}
                maxLength={1600}
                value={completed}
                placeholder={'По одному пункту в строке\nНапример: составили план на неделю'}
                onChange={(event) => setCompleted(event.target.value)}
              />
            </label>
          </div>

          <label className="case-field">
            <span>Следующий шаг</span>
            <textarea
              rows={2}
              maxLength={420}
              value={nextStep}
              placeholder="Что стоит сделать дальше?"
              onChange={(event) => setNextStep(event.target.value)}
            />
          </label>

          <div className="case-editor-note">
            Карточка хранится в этом браузере. При продолжении связанного чата её контекст передаётся агенту.
          </div>

          <div className="case-editor-actions">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button variant="primary" icon={Check} type="submit">Сохранить</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
