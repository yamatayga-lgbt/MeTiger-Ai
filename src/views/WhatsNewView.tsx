/**
 * «Что нового» — раздел про ТЕКУЩУЮ версию.
 *
 * Здесь нет истории продукта: человек приходит сюда после обновления, чтобы
 * увидеть, что поменялось у него сейчас. Полный список прошлых версий — в README;
 * дублировать его в интерфейсе значит топить главное в шуме.
 *
 * Тот же стеклянный язык, что и везде: карточка прозрачная, блик общий
 * (--glass-sheen), сияние на этом экране стоит — движение под крупными
 * карточками стоило бы кадров (замер 0.088: 29,8 fps против 60).
 */
import { Check, Sparkles } from 'lucide-react'
import { APP_VERSION } from '../lib/version'
import { noteFor } from '../lib/release-notes'

export function WhatsNewView() {
  const note = noteFor(APP_VERSION)
  return (
    <div className="news-wrap">
      <div className="news-intro">
        <Sparkles size={16} className="news-intro-ic" aria-hidden="true" />
        <div>
          <div className="news-intro-title">Что нового в {APP_VERSION}</div>
          <div className="news-intro-sub">
            {note
              ? 'Всё, что изменилось в этой версии. Прошлые версии — в истории проекта, здесь только текущая.'
              : 'Для этой версии список изменений ещё не написан — он появится в следующем обновлении.'}
          </div>
        </div>
      </div>

      {note ? (
        <section className="news-card is-current" aria-label={`Версия ${note.version}`}>
          <header className="news-head">
            <span className="news-ver">{note.version}</span>
            <span className="news-title">{note.title}</span>
            {note.mark === 'jubilee' ? <span className="news-mark">юбилей</span> : null}
            {note.mark === 'fix' ? <span className="news-mark is-fix">починка</span> : null}
            <span className="news-now">сейчас</span>
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
      ) : null}

      <div className="news-foot">
        Обновления приходят сами: оболочка проверяет новую версию при возврате в приложение.
        Если что-то кажется старым — «Настройки» → «Версия» → «Обновить».
      </div>
    </div>
  )
}
