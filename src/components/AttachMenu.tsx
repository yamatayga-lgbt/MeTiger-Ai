/**
 * Меню «+» в композере: Камера / Фото / Файлы / Плагины — как у референсов.
 * Работают все, кроме «Плагинов» (заготовка, помечена «скоро»).
 *
 * «Файлы» не открывают системный диалог сразу, а раскрывают второй экран того
 * же окна: что человек уже прикладывал раньше (из src/lib/attachHistory, этот
 * браузер) + кнопка «Загрузить файлы» для нового файла.
 *
 * Чего в меню больше нет и почему (по версиям):
 *   0.121 — переключатель авточтения ответов: озвучка осталась кнопкой «озвучить»
 *           у самого ответа, просить её заранее не нужно;
 *   0.122 — выбор голоса Жен/Муж: в запасном пути (речь устройства) он не
 *           работал, то есть меню обещало то, что слышно не всегда;
 *   0.123 — «Размышлять глубже»: глубину выбирает агент по самому вопросу
 *           (engine/depth.js) и пишет причину словами в подписи ответа.
 * Переключателей в меню не осталось вовсе, мёртвой обвязки (состояния, ручки,
 * стили) — тоже.
 */
import { useEffect, useState } from 'react'
import { Camera, ChevronLeft, FileText, Image as ImageIcon, Paperclip, Puzzle, Upload } from 'lucide-react'
import { fileHref, fileSize } from '../lib/api'
import { listHistory, type HistoryItem } from '../lib/attachHistory'
import { haptic } from '../lib/haptic'

interface AttachMenuProps {
  onCamera: () => void
  onPhoto: () => void
  onUploadFiles: () => void
  onPickHistory: (item: HistoryItem) => void
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

export function AttachMenu({ onCamera, onPhoto, onUploadFiles, onPickHistory, onClose }: AttachMenuProps) {
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
      {/* Ни переключателя глубины, ни выбора голоса: с 0.121–0.123 меню содержит
          только то, что добавляет к сообщению (камера, фото, файлы) и заготовку
          плагинов. Глубину размышления выбирает агент сам (engine/depth.js), а
          озвучка живёт кнопкой «озвучить» у ответа — просить об этом в меню
          больше нечего. */}
    </div>
  )
}
