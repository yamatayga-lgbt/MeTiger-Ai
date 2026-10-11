/* ============================================================
   Предохранители от белого экрана (0.151).

   До этого в приложении не было НИ ОДНОГО предохранителя: любая ошибка
   рендера в React размонтирует всё дерево — человек видит пустой белый
   экран без единого слова. Хуже того: переписка сохранена, при следующей
   загрузке то же «ядовитое» сообщение рендерится снова — и приложение
   умирает при каждом запуске. Владелец поймал ровно это на телефоне,
   где консоли нет и причину не увидеть никак.

   Два уровня защиты:

   • Guard — маленький предохранитель вокруг ОДНОГО сообщения: упал рендер
     этого сообщения (Markdown/формула/таблица) — вместо него серая плашка
     с текстом ошибки, остальная переписка и весь интерфейс живут дальше.

   • RootGuard — последний рубеж вокруг всего приложения: если упало что-то
     вне сообщений, человек видит не пустоту, а экран с текстом ошибки и
     двумя кнопками — «Перезагрузить» и «Сбросить данные» (на случай, когда
     ломает именно сохранённое состояние и перезагрузка не помогает).
     Текст ошибки на экране — единственный способ узнать причину с телефона.
   ============================================================ */
import { Component, type ReactNode } from 'react'
import { isChunkLoadError } from '../lib/chunkReload'
import { forceAppUpdate } from '../lib/version'

interface GuardProps {
  children: ReactNode
  /** Что показать вместо упавшего куска. Получает текст ошибки. */
  fallback: (message: string) => ReactNode
}

interface GuardState {
  error: string | null
}

/** Предохранитель вокруг одного куска интерфейса (сообщения). */
export class Guard extends Component<GuardProps, GuardState> {
  state: GuardState = { error: null }

  static getDerivedStateFromError(err: unknown): GuardState {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  render() {
    if (this.state.error !== null) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

/** Стереть всё сохранённое приложением: переписку, настройки, картинки.
 *  Нужна, когда ломает именно сохранённое состояние — без неё человек
 *  заперт в цикле «белый экран → перезагрузка → белый экран». */
const resetStoredData = async () => {
  try { localStorage.clear() } catch { /* приватный режим — нечего чистить */ }
  try {
    await Promise.allSettled(
      ['metiger-chat-media', 'metiger-attach-history'].map(
        (name) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = req.onerror = req.onblocked = () => resolve(null)
          }),
      ),
    )
  } catch { /* indexedDB недоступна — и не надо */ }
  location.reload()
}

interface RootState {
  error: string | null
  stack: string
}

/** Последний рубеж: вместо белого экрана — причина и выход. */
export class RootGuard extends Component<{ children: ReactNode }, RootState> {
  state: RootState = { error: null, stack: '' }

  static getDerivedStateFromError(err: unknown): Partial<RootState> {
    if (err instanceof Error) return { error: err.message || String(err), stack: err.stack || '' }
    return { error: String(err), stack: '' }
  }

  render() {
    if (this.state.error === null) return this.props.children
    /* 0.157: «файл старой версии не найден» — это не поломка приложения, а
       отставшая на одну выкладку вкладка. Человеку не нужно читать про ошибку:
       ему нужна кнопка, которая берёт свежую версию. Автоперезагрузка уже
       пробовала (lib/chunkReload) — сюда попадаем, когда она не помогла. */
    const stale = isChunkLoadError(this.state.error)
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h1>{stale ? 'Есть свежая версия' : 'Приложение споткнулось'}</h1>
          <p>
            {stale
              ? 'Приложение обновилось, пока это окно было открыто: файлы прежней версии больше не нужны. Это не ошибка — нажмите «Обновить и перезагрузить», и всё откроется.'
              : 'Это ошибка MeTiger, не ваша. Текст ниже поможет её исправить — покажите его в чате поддержки.'}
          </p>
          <pre className="crash-error">{this.state.error}</pre>
          {this.state.stack ? (
            <details className="crash-stack">
              <summary>Подробности для разработчика</summary>
              <pre>{this.state.stack}</pre>
            </details>
          ) : null}
          <div className="crash-actions">
            <button
              type="button"
              className="crash-btn primary"
              onClick={() => {
                /* На отставшей версии обычной перезагрузки может не хватить
                   (кэш мог отдать ту же оболочку) — тогда сносим service worker
                   и его кэш: это и есть «Обновить и перезагрузить». */
                if (stale) void forceAppUpdate()
                else location.reload()
              }}
            >
              {stale ? 'Обновить и перезагрузить' : 'Перезагрузить'}
            </button>
            {stale ? null : (
              <button
                type="button"
                className="crash-btn"
                onClick={() => { void resetStoredData() }}
              >
                Сбросить данные и перезагрузить
              </button>
            )}
          </div>
          {stale ? null : (
            <p className="crash-note">«Сбросить данные» удалит сохранённую переписку на этом устройстве — применяйте, только если перезагрузка не помогает.</p>
          )}
        </div>
      </div>
    )
  }
}
