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
const CACHE_VERSION = 'v0177'
const CACHE_NAME = `metiger-shell-${CACHE_VERSION}`
const SHELL_URLS = ['./', './index.html', './favicon.png', './favicon.svg', './manifest.webmanifest', './offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
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
