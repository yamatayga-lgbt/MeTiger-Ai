/**
 * Меню «+» в композере: Камера / Фото / Файлы. Только то, что работает.
 * 0.228: «Плагины — скоро» убраны. Заготовка висела с первых версий; обещание,
 * которого никто не собирается выполнять, — это не план, а шум. Найдётся дело —
 * вернём пункт вместе с делом.
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
import { Camera, ChevronLeft, FileText, Image as ImageIcon, Paperclip, Pin, PinOff, Upload } from 'lucide-react'
import { fileHref, fileSize } from '../lib/api'
import { listHistory, type HistoryItem } from '../lib/attachHistory'
import { haptic } from '../lib/haptic'
import { listPinnedDocs, pinDoc, setPinnedDocEnabled, unpinDoc, type PinnedDoc } from '../lib/pinnedMemory'

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
  const [pinned, setPinned] = useState<PinnedDoc[]>([])
  const [pinNote, setPinNote] = useState('')

  useEffect(() => {
    if (view !== 'files') return
    let alive = true
    void listHistory().then((items) => { if (alive) setHistory(items) })
    void listPinnedDocs().then((docs) => { if (alive) setPinned(docs) })
    return () => { alive = false }
  }, [view])

  const pinnedNames = new Set(pinned.map((d) => d.name))

  const togglePinFromHistory = async (h: HistoryItem) => {
    haptic('light')
    const found = pinned.find((d) => d.name === h.name)
    if (found) {
      const next = await unpinDoc(found.id)
      setPinned(next)
      setPinNote(`Убран из памяти: ${h.name}`)
      return
    }
    const res = await pinDoc({ name: h.name, mime: h.mime, size: h.size, b64: h.b64 })
    if (res.ok) {
      setPinned(await listPinnedDocs())
      setPinNote(`Закреплён для всех чатов: ${h.name}`)
    } else {
      setPinNote(res.error)
    }
  }

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

        {pinNote ? <div className="attach-files-note">{pinNote}</div> : null}

        {pinned.length > 0 ? (
          <>
            <div className="attach-files-label">В памяти между чатами</div>
            <div className="attach-files-pinned">
              {pinned.map((p) => (
                <div key={p.id} className="attach-pinned-item">
                  <span className="attach-files-thumb attach-files-thumb-file"><Pin size={14} /></span>
                  <span className="attach-files-meta">
                    <span className="attach-files-name">{p.name}</span>
                    <span className="attach-files-sub">{fileSize(p.size)} · {p.enabled ? 'включён' : 'пауза'}</span>
                  </span>
                  <button
                    type="button"
                    className="attach-pin-btn"
                    onClick={() => {
                      haptic('light')
                      void setPinnedDocEnabled(p.id, !p.enabled).then(setPinned)
                    }}
                  >
                    {p.enabled ? 'Пауза' : 'Вкл'}
                  </button>
                  <button
                    type="button"
                    className="attach-pin-icon"
                    aria-label={`Открепить ${p.name}`}
                    onClick={() => {
                      haptic('light')
                      void unpinDoc(p.id).then(setPinned)
                    }}
                  >
                    <PinOff size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="attach-files-label">Недавние</div>
        <div className="attach-files-list">
          {history === null ? (
            <div className="attach-files-hint">загружаю…</div>
          ) : history.length === 0 ? (
            <div className="attach-files-hint">Пока пусто — то, что вы приложите, появится здесь</div>
          ) : (
            history.map((h) => {
              const isPinned = pinnedNames.has(h.name)
              return (
                <div key={h.id} className="attach-files-entry">
                  <button
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
                  {h.kind === 'file' ? (
                    <button
                      type="button"
                      className={`attach-pin-icon${isPinned ? ' is-pinned' : ''}`}
                      aria-label={isPinned ? `Открепить ${h.name} из памяти` : `Закрепить ${h.name} в память`}
                      title={isPinned ? 'Убрать из памяти чатов' : 'Закрепить в память для всех чатов'}
                      onClick={() => void togglePinFromHistory(h)}
                    >
                      <Pin size={14} />
                    </button>
                  ) : null}
                </div>
              )
            })
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

      {/* Ни выбора голоса, ни переключателей: глубину решает engine/depth.js,
          голос ввода и озвучки убраны из меню совсем (0.188 — по решению владельца).
          Меню — только действия: камера, фото, файлы. */}
    </div>
  )
}
