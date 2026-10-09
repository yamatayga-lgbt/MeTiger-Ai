/**
 * Версия продукта — счётчик изменений.
 * Формат: 0.000. Каждое обновление/изменение: +0.001.
 * 0.000 → 0.001 → 0.002 → …
 */
export const APP_VERSION = '0.128'

/**
 * Ручная кнопка «Обновить» в настройках — подстраховка на случай, если
 * автопроверка в index.html (visibilitychange/focus → registration.update())
 * почему-то не сработала: сносит service worker и его кэш оболочки целиком и
 * перезагружает страницу с нуля. localStorage/IndexedDB (чаты, история
 * вложений) не трогает — только SW и его собственный Cache Storage.
 */
export async function forceAppUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* даже если снести не вышло — перезагрузка всё равно лучше, чем ничего */
  } finally {
    window.location.reload()
  }
}
