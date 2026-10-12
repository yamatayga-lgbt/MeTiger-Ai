/**
 * Окошко «Сообщить об ошибке» (0.173) — то, что владелец показал снимком и
 * попросил повторить: «Появится окошко, где пользователь может описать проблему
 * в приложении, и отправит мне, + можно и до 4 фото отправить».
 *
 * Что здесь есть и почему именно так:
 *   · «Что произошло?» и поле до 2000 знаков со счётчиком — человек видит потолок
 *     заранее, а не узнаёт о нём из отказа;
 *   · до четырёх снимков: жмём «Приложить фото», снимок с телефона ужимается на
 *     устройстве (см. photoToDataUrl) — владельцу нужно прочитать, что на экране;
 *   · к отчёту сами уходят версия приложения и анонимный ключ устройства: без них
 *     владелец не поймёт, у кого и на чём сломалось. Ни переписки, ни файлов в
 *     отчёте нет — и об этом прямо сказано под полем, а не мелким шрифтом;
 *   · ничего лишнего: переключателя «встряхните телефон» тут нет — владелец
 *     вычеркнул его красным на приложенном снимке.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CheckCircle2, Loader2, Send, X } from 'lucide-react'
import { Button } from './ui'
import { REPORT_MAX_CHARS, REPORT_MAX_PHOTOS, photoToDataUrl, sendReport } from '../lib/report'
import { haptic } from '../lib/haptic'

interface ReportSheetProps {
  onClose: () => void
}

export function ReportSheet({ onClose }: ReportSheetProps) {
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  /* Escape закрывает окошко — как у всех окон приложения. Понадобилось после
     живой пробы: у длинной заявки крестик уезжал вверх вместе с прокруткой, и
     закрыть форму с клавиатуры было нечем (шапку поэтому тоже сделали липкой). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const room = Math.max(0, REPORT_MAX_PHOTOS - photos.length)

  const addPhotos = async (list: FileList | null) => {
    const all = list ? Array.from(list) : []
    if (!all.length) return
    setError('')
    setReading(true)
    const next: string[] = []
    for (const f of all.slice(0, room)) {
      try {
        next.push(await photoToDataUrl(f))
      } catch {
        setError('не получилось прочитать фото — приложите другое')
      }
    }
    setReading(false)
    if (next.length) {
      setPhotos((prev) => [...prev, ...next].slice(0, REPORT_MAX_PHOTOS))
      haptic('light')
    }
  }

  const send = async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    setError('')
    const r = await sendReport(text.trim(), photos)
    setBusy(false)
    if (r.ok) {
      haptic('medium')
      setDone(true)
    } else {
      setError(String(r.error || 'не отправилось'))
    }
  }

  /* Окошко живёт в портале, а не внутри экрана: родитель — анимированный список
     (.view с анимацией), и у него есть transform, который делает position: fixed
     привязанным к нему, а не к окну браузера. Поймано живой пробой: у длинного
     списка обращений шторка уезжала выше экрана, и крестик был недосягаем. */
  const sheet = (
    <div
      className="rep-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="rep-sheet" role="dialog" aria-modal="true" aria-label="Сообщить об ошибке">
        <div className="rep-head">
          <div className="rep-title">Сообщить об ошибке</div>
          <button type="button" className="news-modal-x" aria-label="Закрыть" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="rep-done">
            <CheckCircle2 size={26} color="var(--accent)" />
            <div className="rep-done-title">Отправлено — спасибо!</div>
            <div className="rep-done-sub">
              Обращение ушло владельцу приложения. Если понадобится уточнить — ответ придёт в следующих версиях,
              а пока можно вернуться к делам.
            </div>
            <Button variant="primary" onClick={onClose}>
              Понятно
            </Button>
          </div>
        ) : (
          <>
            <label className="rep-label" htmlFor="rep-text">
              Что произошло?
            </label>
            <textarea
              id="rep-text"
              className="rep-text"
              placeholder="Опишите проблему, с которой вы столкнулись"
              value={text}
              maxLength={REPORT_MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
              rows={6}
            />
            <div className="rep-count">
              {text.length} / {REPORT_MAX_CHARS}
            </div>

            <div className="rep-note">
              К отчёту уйдут версия приложения и ключ этого устройства — без них не понять, где сломалось.
              Переписка и ваши файлы не отправляются.
            </div>

            <div className="rep-photos">
              {photos.map((src, i) => (
                <div className="rep-photo" key={i}>
                  <img src={src} alt={'Снимок ' + (i + 1)} />
                  <button
                    type="button"
                    className="rep-photo-x"
                    aria-label={'Убрать снимок ' + (i + 1)}
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {room > 0 ? (
                <button
                  type="button"
                  className="rep-photo-add"
                  onClick={() => fileRef.current?.click()}
                  disabled={reading}
                >
                  {reading ? <Loader2 size={16} className="rep-spin" /> : <Camera size={16} />}
                  <span>{reading ? 'готовлю…' : 'Приложить фото'}</span>
                </button>
              ) : null}
            </div>
            <div className="rep-photos-hint">
              Снимков: {photos.length} из {REPORT_MAX_PHOTOS}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addPhotos(e.target.files)
                e.target.value = ''
              }}
            />

            {error ? <div className="rep-error">{error}</div> : null}

            <div className="rep-foot">
              <button
                type="button"
                className="rep-send"
                onClick={send}
                disabled={busy || !text.trim()}
                aria-label="Отправить"
              >
                {busy ? <Loader2 size={16} className="rep-spin" /> : <Send size={15} />}
                {busy ? 'Отправляю…' : 'Отправить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)
}
