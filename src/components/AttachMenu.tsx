/**
 * Меню «+» в композере: Камера / Фото / Файлы / Плагины / Размышлять глубже —
 * как у референсов. Работают все, кроме «Плагинов» (заготовка, помечена «скоро»).
 *
 * «Размышлять глубже» с 0.109 — переключатель, а не надпись «скоро»: он поднимает
 * очередь до smart, ставит думающие модели в голову пула и даёт ответу больше
 * времени. Состояние видно переключателем, а не словами: включено — ползунок справа.
 *
 * «Файлы» не открывает системный диалог сразу, а раскрывает второй экран того
 * же окна: что человек уже прикладывал раньше (из src/lib/attachHistory, этот
 * браузер) + кнопка «Загрузить файлы» для нового файла.
 *
 * С 0.121 в меню нет переключателя авточтения ответов: озвучка осталась
 * кнопкой «озвучить» у самого ответа, а здесь — только выбор голоса Жен/Муж,
 * которым эта кнопка читает. Переключателей в меню ровно один («Размышлять
 * глубже»), и мёртвой обвязки (состояние, ожидание конца потока) не осталось.
 */
import { useEffect, useState } from 'react'
import { Camera, ChevronLeft, FileText, Gauge, Image as ImageIcon, Paperclip, Puzzle, Upload } from 'lucide-react'
import { fileHref, fileSize } from '../lib/api'
import { listHistory, type HistoryItem } from '../lib/attachHistory'
import { haptic } from '../lib/haptic'

interface AttachMenuProps {
  onCamera: () => void
  onPhoto: () => void
  onUploadFiles: () => void
  onPickHistory: (item: HistoryItem) => void
  /** «Размышлять глубже»: включено ли и как переключить (состояние живёт в App). */
  deep?: boolean
  /** Выбор голоса: женский или мужской (состояние живёт в App). */
  voice?: 'female' | 'male'
  onVoice?: (v: 'female' | 'male') => void
  onDeep?: () => void
  onClose: () => void
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'только что'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.round(h / 24)
  return `${d} дн назад`
}

export function AttachMenu({ onCamera, onPhoto, onUploadFiles, onPickHistory, deep = false, onDeep, voice = 'female', onVoice, onClose }: AttachMenuProps) {
  const [view, setView] = useState<'menu' | 'files'>('menu')
  const [history, setHistory] = useState<HistoryItem[] | null>(null)

  useEffect(() => {
    if (view !== 'files') return
    let alive = true
    void listHistory().then((items) => { if (alive) setHistory(items) })
    return () => { alive = false }
  }, [view])

  if (view === 'files') {
    return (
      <div className="attach-menu attach-files" role="dialog" aria-label="Файлы">
        <div className="attach-files-head">
          <button
            type="button"
            className="attach-back"
            aria-label="Назад"
            onClick={() => { haptic('light'); setView('menu') }}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="attach-files-title">Файлы</span>
        </div>

        <button
          type="button"
          className="attach-menu-item"
          onClick={() => { haptic('light'); onUploadFiles(); onClose() }}
        >
          <span className="attach-menu-icon"><Upload size={18} /></span>
          Загрузить файлы
        </button>

        <div className="attach-files-label">Недавние</div>
        <div className="attach-files-list">
          {history === null ? (
            <div className="attach-files-hint">загружаю…</div>
          ) : history.length === 0 ? (
            <div className="attach-files-hint">Пока пусто — то, что вы приложите, появится здесь</div>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                type="button"
                className="attach-files-row"
                onClick={() => { haptic('light'); onPickHistory(h); onClose() }}
              >
                {h.kind === 'image' ? (
                  <img className="attach-files-thumb" src={fileHref(h)} alt="" />
                ) : (
                  <span className="attach-files-thumb attach-files-thumb-file"><FileText size={16} /></span>
                )}
                <span className="attach-files-meta">
                  <span className="attach-files-name">{h.name}</span>
                  <span className="attach-files-sub">{fileSize(h.size)} · {timeAgo(h.addedAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="attach-menu" role="menu" aria-label="Добавить">
      <button type="button" className="attach-menu-item" role="menuitem" onClick={() => { haptic('light'); onCamera(); onClose() }}>
        <span className="attach-menu-icon"><Camera size={18} /></span>
        Камера
      </button>
      <button type="button" className="attach-menu-item" role="menuitem" onClick={() => { haptic('light'); onPhoto(); onClose() }}>
        <span className="attach-menu-icon"><ImageIcon size={18} /></span>
        Фото
      </button>
      <button type="button" className="attach-menu-item" role="menuitem" onClick={() => { haptic('light'); setView('files') }}>
        <span className="attach-menu-icon"><Paperclip size={18} /></span>
        Файлы
      </button>
      <button type="button" className="attach-menu-item is-soon" role="menuitem" disabled aria-disabled="true" title="Скоро">
        <span className="attach-menu-icon"><Puzzle size={18} /></span>
        Плагины
        <span className="attach-menu-soon">скоро</span>
      </button>
      {/* Окно не закрывается: переключатель без своего состояния на глазах —
          это кнопка «нажал и не понял, включилось ли». Человек видит ползунок
          и сам решает, когда закрыть меню. */}
      <button
        type="button"
        className={`attach-menu-item attach-deep${deep ? ' is-on' : ''}`}
        role="menuitemcheckbox"
        aria-checked={deep}
        aria-label="Размышлять глубже"
        title={deep ? 'Размышлять глубже: включено' : 'Размышлять глубже'}
        onClick={() => { haptic('light'); onDeep?.() }}
      >
        <span className="attach-menu-icon"><Gauge size={18} /></span>
        Размышлять глубже
        <span className="attach-switch" aria-hidden="true" />
      </button>
      {/* Выбор голоса Жен/Муж в меню остался: он задаёт, каким голосом кнопка
          «озвучить» у ответа читает текст. Авточтение каждого ответа убрано
          в 0.121 — вместе с ним ушёл и его переключатель из этого меню. */}
      <div className="attach-menu-voice" role="group" aria-label="Голос">
        <span className="attach-menu-voice-label">Голос</span>
        <button
          type="button"
          className={'attach-voice-btn' + (voice === 'female' ? ' is-on' : '')}
          role="menuitemradio"
          aria-checked={voice === 'female'}
          aria-label="Женский голос"
          onClick={() => { haptic('light'); onVoice?.('female') }}
        >
          Жен
        </button>
        <button
          type="button"
          className={'attach-voice-btn' + (voice === 'male' ? ' is-on' : '')}
          role="menuitemradio"
          aria-checked={voice === 'male'}
          aria-label="Мужской голос"
          onClick={() => { haptic('light'); onVoice?.('male') }}
        >
          Муж
        </button>
      </div>
    </div>
  )
}
