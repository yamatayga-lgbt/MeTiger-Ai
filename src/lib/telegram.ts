/* ============================================================
   Telegram WebApp SDK — загрузка с мягким fallback.
   Внутри Telegram приложение получает данные юзера и тему.
   Вне Telegram (превью, браузер) — демо-режим.
   ============================================================ */

export interface TgUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
}

export interface WebAppLike {
  ready(): void
  expand(): void
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  initDataUnsafe?: { user?: TgUser; start_param?: string }
  platform?: string
  version?: string
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
  openLink?(url: string, options?: { try_instant_view?: boolean }): void
  openTelegramLink?(url: string): void
}

export const DEMO_USER: TgUser = {
  id: 0,
  first_name: 'Гость',
  username: 'demo',
}

let cached: WebAppLike | null = null
let loading: Promise<WebAppLike | null> | null = null

export function loadTelegramSdk(timeout = 2000): Promise<WebAppLike | null> {
  if (cached) return Promise.resolve(cached)
  if (loading) return loading

  loading = new Promise<WebAppLike | null>((resolve) => {
    if (typeof window === 'undefined') return resolve(null)

    const finish = (value: WebAppLike | null) => {
      cached = value
      if (value) {
        try {
          value.ready()
          value.expand()
        } catch {
          /* noop */
        }
      }
      resolve(value)
    }

    const existing = (window as unknown as { Telegram?: { WebApp?: WebAppLike } }).Telegram?.WebApp
    if (existing) return finish(existing)

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-web-app.js'
    script.async = true
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      finish((window as unknown as { Telegram?: { WebApp?: WebAppLike } }).Telegram?.WebApp ?? null)
    }
    script.onload = settle
    script.onerror = () => settle()
    document.head.appendChild(script)
    window.setTimeout(settle, timeout)
  })

  return loading
}

export function getUser(): TgUser {
  return cached?.initDataUnsafe?.user ?? DEMO_USER
}

export function isTelegram(): boolean {
  return cached != null
}

export function initials(user: TgUser): string {
  const parts = [user.first_name, user.last_name].filter(Boolean) as string[]
  return parts
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function displayName(user: TgUser): string {
  return user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name
}

export type Haptic = 'light' | 'medium' | 'select' | 'success' | 'error'

export function haptic(kind: Haptic = 'light'): void {
  const h = cached?.HapticFeedback
  if (!h) return
  try {
    if (kind === 'select') h.selectionChanged()
    else if (kind === 'success') h.notificationOccurred('success')
    else if (kind === 'error') h.notificationOccurred('error')
    else h.impactOccurred(kind)
  } catch {
    /* noop */
  }
}
