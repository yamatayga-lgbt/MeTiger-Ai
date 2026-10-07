/**
 * «Что нового» — история обновлений прямо в приложении.
 *
 * Экран отвечает на вопрос «что поменялось после обновления», не отправляя
 * человека читать переписку или README. Свежая запись открыта и подсвечена
 * юбилейной лентой, прошлые — свёрнуты в один столбец и читаются сверху вниз.
 *
 * Тот же стеклянный язык, что и везде: карточки прозрачные, блик общий
 * (--glass-sheen), а сияние на этом экране стоит — движение под крупными
 * карточками стоит кадров (замер 0.088: 29,8 fps против 60).
 */
import { Check, Sparkles } from 'lucide-react'
import { APP_VERSION } from '../lib/version'
import { RELEASE_NOTES, type ReleaseNote } from '../lib/release-notes'

function NoteCard({ note, current }: { note: ReleaseNote; current: boolean }) {
  return (
    <section className={'news-card' + (current ? ' is-current' : '')} aria-label={`Версия ${note.version}`}>
      <header className="news-head">
        <span className="news-ver">{note.version}</span>
        <span className="news-title">{note.title}</span>
        {note.mark === 'jubilee' ? <span className="news-mark">юбилей</span> : null}
        {note.mark === 'fix' ? <span className="news-mark is-fix">починка</span> : null}
        {current ? <span className="news-now">сейчас</span> : null}
      </header>
      <ul className="news-list">
        {note.items.map((line) => (
          <li key={line}>
            <Check size={14} className="news-tick" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function WhatsNewView() {
  const seen = RELEASE_NOTES.some((n) => n.version === APP_VERSION)
  return (
    <div className="news-wrap">
      <div className="news-intro">
        <Sparkles size={16} className="news-intro-ic" aria-hidden="true" />
        <div>
          <div className="news-intro-title">Что нового</div>
          <div className="news-intro-sub">
            Ваша версия — {APP_VERSION}. Ниже — всё, что менялось, свежее сверху.
            {seen ? '' : ' Запись для этой версии ещё не написана — она появится в следующем обновлении.'}
          </div>
        </div>
      </div>
      {RELEASE_NOTES.map((n, i) => (
        <NoteCard key={n.version} note={n} current={i === 0} />
      ))}
      <div className="news-foot">
        Обновления приходят сами: оболочка проверяет новую версию при возврате в приложение.
        Если что-то кажется старым — «Настройки» → «Версия» → «Обновить».
      </div>
    </div>
  )
}
