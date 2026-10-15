/**
 * Сторож версии: приложение само замечает, что вышла новая выкладка (0.158).
 *
 * Зачем. Вкладка или установленное приложение живут долго: человек свернул, потом
 * развернул — страница НЕ перезагружается, а значит в ней остаётся старый интерфейс
 * и старые имена файлов экранов. Именно так владелец и увидел вчерашнюю картину:
 * на экране ещё жила версия 0.155 с кнопками внизу, а «Что нового» пыталось
 * открыть файл прежней версии — и падало («Failed to fetch dynamically imported
 * module»). Обновление service worker'а тут не спасает: пока страницу не
 * перезагрузят, в ней работает старый код.
 *
 * Что делает сторож: изредка (при возврате в приложение и раз в минуту) забирает
 * свой же index.html строго из сети, вытаскивает оттуда имя главного файла
 * приложения и сравнивает с тем, что уже загружен. Имена содержат хеш сборки, так
 * что разница означает ровно одно: вышла новая выкладка. Тогда — перезагрузка.
 *
 * Чего сторож НЕ делает: не крутит перезагрузки по кругу (та же защёлка с
 * кулдауном, что у протухших файлов, — lib/chunkReload), не трогает офлайн
 * (без сети index.html придёт из кэша и сравнение бессмысленно) и не мешает
 * локальной разработке (файл на дев-сервере — не «assets/index-<хеш>.js»).
 */
import { reloadForFreshChunks } from './chunkReload'

/** Имя главного файла приложения в собранной оболочке: assets/index-AbC123.js */
const MAIN_ASSET_RE = /assets\/[A-Za-z0-9._-]*-?[A-Za-z0-9_-]{8}\.js/

/** Как часто проверять, пока приложение открыто на экране, мс. */
const CHECK_EVERY_MS = 60_000

/** Имя главного файла, который сейчас исполняется в этой странице. */
function runningAsset(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
  for (const s of scripts) {
    const m = s.src.match(MAIN_ASSET_RE)
    if (m) return m[0]
  }
  return null
}

/** Имя главного файла в свежем index.html с сервера (null — не разобрали). */
function servedAsset(html: string): string | null {
  const m = html.match(/src="[^"]*?(assets\/[^"]+\.js)"/)
  return m && m[1] ? m[1] : null
}

/**
 * Человек прямо сейчас печатает? С 0.189 черновик поля ввода сохраняется и
 * перезагрузка его не теряет, но перечитывать недописанное посреди набора всё
 * равно обидно — в такой момент проверку откладываем до следующего раза.
 */
function userIsTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const editable =
    el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable === true
  if (!editable) return false
  const value = (el as HTMLInputElement).value
  return typeof value === 'string' && value.trim().length > 0
}

let started = false

/**
 * Запустить сторож. Возвращает функцию остановки — нужна тестам и тем экранам,
 * которые хотят приостановить проверки.
 */
export function startVersionWatch(): () => void {
  if (started) return () => {}
  started = true

  let stopped = false

  const check = async () => {
    if (stopped || !navigator.onLine) return
    /* index.html — строго мимо кэша: и HTTP-кэша, и кэша service worker'а.
       no-store говорит браузеру «не сохраняй и не подставляй», а обход SW —
       параметр в адресе: для SW это другой запрос, он идёт в сеть. */
    let html = ''
    try {
      const res = await fetch(`./index.html?mt-v=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) return
      html = await res.text()
    } catch {
      return /* сеть мигнула — не повод что-то менять */
    }
    const fresh = servedAsset(html)
    const mine = runningAsset()
    if (!fresh || !mine || fresh === mine) return
    if (userIsTyping()) return /* допишет — обновимся на следующей проверке */
    /* Имена разные — значит на сервере другая сборка. Перезагружаемся; защёлка
       не даст устроить карусель, если что-то пойдёт не так (например, CDN отдаёт
       разные версии на соседние запросы). */
    reloadForFreshChunks()
  }

  const onVisible = () => {
    /* Вернулись в приложение — самый вероятный момент «а не вышло ли новое». */
    if (document.visibilityState === 'visible') void check()
  }

  window.addEventListener('focus', onVisible)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
  /* Первая проверка — не сразу, чтобы не спорить с загрузкой и «что нового». */
  const first = window.setTimeout(() => void check(), 15_000)

  return () => {
    stopped = true
    window.removeEventListener('focus', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    window.clearTimeout(first)
  }
}
