// MeTiger Ai — минимальный service worker.
// Задача: дать браузеру основание предложить «Добавить на главный экран» и
// сделать запуск с иконки похожим на нативное приложение (быстрый повторный
// показ оболочки, что-то на экране даже без сети). Чат остаётся живым:
// /api/* и /telegram/* никогда не трогаем — ответы Агента всегда свежие.
//
// CACHE_VERSION проставляется автоматически перед каждой сборкой
// (scripts/stamp-sw.mjs, запускается из `npm run build`) из версии в
// package.json — так у всех установленных иконок старая оболочка быстро
// сменяется новой, и об этом не нужно вспоминать руками при публикации.
const CACHE_VERSION = 'v0226'
const CACHE_NAME = `metiger-shell-${CACHE_VERSION}`
const SHELL_URLS = ['./', './index.html', './favicon.png', './favicon.svg', './manifest.webmanifest', './offline.html']

// Глобальная переменная для отслеживания новой версии
let NEW_VERSION_AVAILABLE = false

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {})
  )
  // Не пропускаем wait, чтобы можно было проверить обновление
  // self.skipWaiting() — убрали, чтобы можно было показать уведомление
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Проверяем, есть ли новая версия service worker
self.addEventListener('updatefound', () => {
  NEW_VERSION_AVAILABLE = true
  // Отправляем сообщение всем клиентам о доступном обновлении
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'NEW_VERSION_AVAILABLE',
        version: CACHE_VERSION
      })
    })
  })
})

// Обработка сообщений от клиентов
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data && event.data.type === 'CHECK_FOR_UPDATES') {
    // Проверяем, есть ли новая версия
    event.source.postMessage({
      type: 'UPDATE_STATUS',
      hasUpdate: NEW_VERSION_AVAILABLE,
      version: CACHE_VERSION
    })
  }
})

const OFFLINE_URL = './offline.html'

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // POST /api/chat и прочее — мимо кэша, не трогаем

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // чужие хосты (CDN, провайдеры) — не кэшируем
  if (url.pathname && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/telegram/'))) return // живые данные всегда с сети

  // Network-first: пока есть сеть — всегда свежая версия (проект обновляется часто),
  // кэш — только подстраховка на случай обрыва связи или холодного повторного запуска.
  // Навигацию (сам index.html) просим с проверкой свежести: страница не должна
  // залипать на прежней версии оболочки, пока на сервере уже новая (0.158).
  const isNavigate = req.mode === 'navigate'
  event.respondWith(
    fetch(req, isNavigate ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => {
        // Если API недоступен, возвращаем offline страницу
        if (url.pathname && url.pathname.startsWith('/api/')) {
          return caches.match(OFFLINE_URL)
        }
        return caches.match(req).then((cached) => cached || caches.match('./index.html'))
      })
  )
})

/* ── уведомления (0.225) ──────────────────────────────────────────────────────
 *
 * Приходят, когда ответ досчитался без человека: вкладка свёрнута, приложение
 * ушло в фон или его выгрузила система. Служба push-сервиса поднимает воркер
 * даже с закрытым приложением — в этом и смысл.
 *
 * Текст готовит сервер (engine/pushstore.js): заголовок «ответ готов», тело —
 * первая строка ответа без разметки. Здесь только показ и переход в чат.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { body: String((event.data && event.data.text && event.data.text()) || '') } }
  const title = String((data && data.title) || 'MeTiger Ai — ответ готов')
  const body = String((data && data.body) || 'Загляните в чат').slice(0, 180)
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      /* Метка одна на ответ: новое уведомление заменяет прежнее, а не копится
         стопкой в шторке — человек ждёт один ответ, а не десять. */
      tag: 'mt-answer',
      renotify: true,
      data: { url: './' + (data && data.chatId ? '?chat=' + encodeURIComponent(data.chatId) : '') },
    }).catch(() => {})
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification && event.notification.data && event.notification.data.url) || './'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      /* Уже открытое окно — в фокус, без второго экземпляра приложения. */
      for (const client of list) {
        if (client.url && client.url.indexOf(self.location.origin) === 0 && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null
    }).catch(() => null)
  )
})
