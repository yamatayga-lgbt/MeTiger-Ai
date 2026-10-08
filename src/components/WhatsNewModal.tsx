/**
 * Окошко «Что нового» — всплывает само после обновления версии.
 *
 * Правило, ради которого оно существует: человек видит РОВНО то, что изменилось
 * в его новой версии, и ничего больше. Список прошлых версий тут был бы шумом:
 * после обновления важно «что поменялось у меня сейчас», а не история продукта
 * (история никуда не делась — она в README).
 *
 * Когда показывается: если на устройстве запомнена ДРУГАЯ версия, чем в сборке.
 * Первый заход на новом устройстве окошка не показывает — это не обновление,
 * и встречать человека списком изменений невежливо.
 *
 * Закрывается крестиком, кнопкой, кликом мимо и Escape. Все три пути ведут к
 * одному: версия помечается прочитанной, и окошко больше не появится.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { ReleaseNote } from '../lib/release-notes'
import { Button } from './ui'

export interface WhatsNewModalProps {
  note: ReleaseNote
  onClose: () => void
}

export function WhatsNewModal({ note, onClose }: WhatsNewModalProps) {
  /* Escape слушаем на документе, а не на самом окошке: обработчик на div'е ждал
     бы фокуса внутри него, а окошко фокус не забирает — проверено живьём,
     Escape не срабатывал вовсе. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="news-overlay"
      onMouseDown={(e) => {
        /* Клик мимо — закрыть. Именно mousedown, как у палитры команд: с click
           закрытие срабатывало бы и на «протаскивании» взгляда по фону. */
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="news-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Что нового в версии ${note.version}`}
      >
        <div className="news-modal-head">
          <div className="grow">
            <div className="news-modal-cap">Обновление установлено</div>
            <div className="news-modal-title">Что нового в {note.version}</div>
          </div>
          <button type="button" className="news-modal-x" aria-label="Закрыть" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="news-modal-sub">{note.title}</div>

        <ul className="news-list">
          {note.items.map((line) => (
            <li key={line}>
              <span className="news-bullet" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="news-modal-foot">
          <Button variant="primary" onClick={onClose}>
            Понятно
          </Button>
          <span className="news-modal-dim">Окошко больше не появится до следующего обновления</span>
        </div>
      </div>
    </div>
  )
}
