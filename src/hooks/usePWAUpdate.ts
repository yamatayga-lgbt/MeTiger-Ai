/**
 * Хук для автоматического обновления PWA (Progressive Web App)
 * 
 * Проверяет наличие новой версии service worker и уведомляет пользователя.
 * Принимает колбэк для отображения уведомления.
 */
import { useEffect, useState } from 'react'

export interface PWAUpdateEvent {
  type: 'NEW_VERSION_AVAILABLE' | 'UPDATE_STATUS'
  version?: string
  hasUpdate?: boolean
}

interface UsePWAUpdateOptions {
  onUpdateAvailable?: (version: string) => void
  checkInterval?: number // В миллисекундах, по умолчанию 3600000 (1 час)
}

export function usePWAUpdate(options: UsePWAUpdateOptions = {}): {
  hasUpdate: boolean
  version: string | null
  checkForUpdates: () => Promise<void>
  skipWaiting: () => Promise<void>
} {
  const { onUpdateAvailable, checkInterval = 3600000 } = options
  const [hasUpdate, setHasUpdate] = useState(false)
  const [version, setVersion] = useState<string | null>(null)

  // Проверяем, есть ли новая версия service worker
  const checkForUpdates = async () => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      return
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) return

      // Проверяем, есть ли новая версия
      const response = await fetch('/sw.js', { cache: 'no-cache' })
      if (!response.ok) return

      const swContent = await response.text()
      const versionMatch = swContent.match(/CACHE_VERSION\s*=\s*'([^']+)'/)
      const currentVersion = versionMatch ? versionMatch[1] : null

      if (currentVersion) {
        // Сравниваем с текущей версией в service worker
        const sw = registration.waiting || registration.active
        if (sw) {
          // Отправляем сообщение service worker для проверки
          sw.postMessage({ type: 'CHECK_FOR_UPDATES' })
        }
      }
    } catch (error) {
      console.warn('Не удалось проверить обновления PWA:', error)
    }
  }

  // Пропускаем ожидание и активируем новую версию
  const skipWaiting = async () => {
    if (!('serviceWorker' in navigator)) return

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration && registration.waiting) {
        // Отправляем сообщение о том, чтобы пропустить ожидание
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        
        // Ждём активации новой версии
        await new Promise((resolve) => {
          const checkActive = () => {
            if (registration.active?.state === 'activated') {
              resolve(null)
            } else {
              setTimeout(checkActive, 100)
            }
          }
          checkActive()
        })
        
        // Перезагружаем страницу
        window.location.reload()
      }
    } catch (error) {
      console.warn('Не удалось активировать новую версию:', error)
    }
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Слушаем сообщения от service worker
    const handleMessage = (event: MessageEvent) => {
      const data: PWAUpdateEvent = event.data
      
      if (data.type === 'NEW_VERSION_AVAILABLE') {
        setHasUpdate(true)
        setVersion(data.version || null)
        onUpdateAvailable?.(data.version || '')
      }
      
      if (data.type === 'UPDATE_STATUS') {
        setHasUpdate(data.hasUpdate || false)
        setVersion(data.version || null)
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)

    // Проверяем обновления при монтировании
    checkForUpdates()

    // Периодическая проверка
    const intervalId = setInterval(checkForUpdates, checkInterval)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage)
      clearInterval(intervalId)
    }
  }, [onUpdateAvailable, checkInterval])

  return {
    hasUpdate,
    version,
    checkForUpdates,
    skipWaiting,
  }
}
