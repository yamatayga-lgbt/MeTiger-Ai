/**
 * Протухшая выкладка: окно открыто, а файлов той версии уже нет (0.157).
 *
 * Проект обновляется часто, каждая выкладка даёт файлам экранов новые имена с
 * хешем. Если вкладка или установленное приложение было открыто ДО выкладки, то
 * при первом заходе на ленивый экран («Что нового», «Настройки», «Профиль»…)
 * браузер просит старый файл — а его на сервере больше нет. Раньше это падало
 * экраном «Приложение споткнулось», и человек видел страшный текст вместо
 * причины: на самом деле приложение не сломано, оно просто отстало на одну
 * версию, и лечится это ПЕРЕЗАГРУЗКОЙ, а не сбросом данных.
 *
 * Что делаем вместо падения: ловим именно эту ошибку и один раз перезагружаем
 * страницу — после перезагрузки в дело идёт свежий index.html со свежими именами
 * файлов, и экран открывается. Повторные падения подряд не перезагружают по
 * кругу: стоит защёлка (sessionStorage + кулдаун), и если за это время ошибка
 * повторилась — значит дело не в протухшей версии (например, нет сети), и
 * человеку честно показывается экран ошибки с кнопкой, а не бесконечная карусель.
 */
import { lazy, type ComponentType } from 'react'

/** Защёлка от карусели перезагрузок: время последней попытки, мс. */
const GUARD_KEY = 'mt-chunk-reload-at'
/** Меньше этого промежутка повторную ошибку «протуханием» не считаем. */
const COOLDOWN_MS = 20000

/** Это ошибка «файл старой версии не найден», а не логика приложения? */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk \d+ failed/i.test(
    msg,
  )
}

/**
 * Перезагрузить страницу ради свежих файлов. Возвращает false, если недавно уже
 * пробовали (тогда карусель не разводим и ошибку показывает Guard).
 */
export function reloadForFreshChunks(): boolean {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(GUARD_KEY) || 0)
  } catch {
    /* приватный режим: защёлки нет — считаем, что попыток не было */
  }
  if (Number.isFinite(last) && last > 0 && Date.now() - last < COOLDOWN_MS) return false
  try {
    sessionStorage.setItem(GUARD_KEY, String(Date.now()))
  } catch {
    /* noop */
  }
  /* Обычная перезагрузка, а не forceAppUpdate: index.html и так берётся из сети
     (sw.js — network-first), а снос service worker здесь был бы лишним и
     оставил бы человека без офлайн-оболочки. */
  window.location.reload()
  return true
}

/**
 * lazy() для экранов, который понимает протухшую выкладку.
 *
 * Если файл экрана не нашёлся — начинаем перезагрузку и отдаём React «вечный»
 * промис: страница уходит на свежую версию, и мигать экраном ошибки по дороге
 * не нужно. Во всех остальных случаях ошибка идёт наверх как обычно, к Guard.
 */
/* Тип как у самого React.lazy (ComponentType<any>): с более узким TS выводит
   never и теряет пропсы экранов. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      if (isChunkLoadError(err) && reloadForFreshChunks()) {
        return new Promise<{ default: T }>(() => {})
      }
      throw err
    }),
  )
}
