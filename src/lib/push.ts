/**
 * Уведомления на устройстве (0.225).
 *
 * Задача: человек отправил вопрос, свернул приложение и занялся делами — когда
 * ответ готов, приходит системное уведомление. Работает и с закрытым приложением:
 * сервер досчитывает ответ и шлёт push через службу браузера, а не через страницу.
 *
 * Что важно и не видно снаружи:
 *
 *   · разрешение спрашиваем только по нажатию. Браузер (и человек) справедливо
 *     ненавидят запрос при первом заходе: если отказать один раз, второго шанса
 *     Chrome уже не даст — только через настройки сайта;
 *   · подписка живёт своей жизнью: браузер может её пересоздать. Поэтому при
 *     каждом запуске проверяем `getSubscription()` и, если её нет, а разрешение
 *     уже дано, подписываемся молча — без второго вопроса;
 *   · на iOS push работает только у приложения, добавленного на домашний экран
 *     (16.4+). В обычной вкладке Safari `PushManager` есть, а подписка падает —
 *     поэтому ошибку показываем словами, а не «что-то пошло не так».
 */
import { currentUserId } from './identity'

const API = (path: string) => `${(import.meta.env?.VITE_API_BASE || '') + path}`
const FLAG = 'mt-push-on'
/** Публичный ключ приходит с сервера: он один на проект и может меняться. */
let cachedKey = ''

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on' | 'unconfigured'

export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushLocalOn(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

function setLocalOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, '1')
    else localStorage.removeItem(FLAG)
  } catch {
    /* приватный режим — переживём без флага */
  }
}

/** Состояние для строки в профиле: одно слово, без технических подробностей. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  const perm = Notification.permission
  if (perm === 'denied') return 'blocked'
  if (!pushLocalOn()) return perm === 'granted' ? 'off' : 'off'
  if (!cachedKey) {
    const info = await pushInfo()
    if (!info.key) return 'unconfigured'
  }
  return 'on'
}

export interface PushInfo {
  key: string
  on: boolean
  why: string
}

const b64uToBytes = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function pushInfo(): Promise<PushInfo> {
  try {
    const res = await fetch(API('/api/push?id=' + encodeURIComponent(currentUserId())), { cache: 'no-store' })
    const data = (await res.json()) as { ok?: boolean; key?: string; on?: boolean; why?: string }
    if (data && data.key) cachedKey = data.key
    return { key: String((data && data.key) || ''), on: !!(data && data.on), why: String((data && data.why) || '') }
  } catch {
    return { key: '', on: false, why: 'сервер не ответил' }
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    /* Готовый воркер уже стоит: ждать установки заново не нужно. */
    return (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.ready)
  } catch {
    return null
  }
}

/**
 * Включить уведомления. Вызывать только из обработчика нажатия — иначе браузер
 * не покажет запрос разрешения (Safari просто проигнорирует).
 */
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'этот браузер не умеет уведомления' }
  if (Notification.permission === 'denied') {
    return { ok: false, error: 'уведомления запрещены для сайта — включите их в настройках браузера' }
  }
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, error: 'разрешение не дали' }
  }
  const info = await pushInfo()
  if (!info.key) return { ok: false, error: info.why || 'уведомления на сервере не настроены' }
  const reg = await registration()
  if (!reg) return { ok: false, error: 'служба приложения не запустилась — обновите страницу' }
  let sub: PushSubscription | null = null
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToBytes(info.key) as BufferSource,
    })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    /* iOS без установки на домашний экран отвечает именно так. */
    return {
      ok: false,
      error: /home screen|not allowed|denied/i.test(msg)
        ? 'на iPhone уведомления работают только у приложения с домашнего экрана'
        : 'браузер не дал подписку: ' + msg.slice(0, 90),
    }
  }
  try {
    const res = await fetch(API('/api/push'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: currentUserId(), action: 'subscribe', subscription: sub.toJSON() }),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (!data || !data.ok) {
      await sub.unsubscribe().catch(() => {})
      return { ok: false, error: data?.error || 'сервер не сохранил подписку' }
    }
  } catch {
    return { ok: false, error: 'сервер не ответил' }
  }
  setLocalOn(true)
  return { ok: true }
}

export async function disablePush(): Promise<void> {
  setLocalOn(false)
  const reg = await registration()
  try {
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) await sub.unsubscribe()
  } catch {
    /* подписки нет — и ладно */
  }
  try {
    await fetch(API('/api/push'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: currentUserId(), action: 'unsubscribe' }),
    })
  } catch {
    /* сервер узнает о мёртвой подписке при первой отправке (404/410) */
  }
}

/** Проверочное уведомление: человек сам убеждается, что шторка работает. */
export async function testPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(API('/api/push'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: currentUserId(), action: 'test' }),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    return data && data.ok ? { ok: true } : { ok: false, error: data?.error || 'push-сервис отказал' }
  } catch {
    return { ok: false, error: 'сервер не ответил' }
  }
}

/**
 * «Ответ готов, а вкладку не видно» — решает клиент, потому что сервер в этот
 * момент ещё видит живое соединение и не знает, смотрит ли человек на экран.
 */
export function notifyIfHidden(chatId: string, text: string): void {
  if (!pushLocalOn()) return
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return
  try {
    void fetch(API('/api/push'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ id: currentUserId(), action: 'notify', chatId, text: String(text || '').slice(0, 400) }),
    })
  } catch {
    /* уведомление — удобство, ответ уже на экране */
  }
}

/** Новая подписка браузера после обновления страницы: молча, без вопросов. */
export async function syncPush(): Promise<void> {
  if (!pushLocalOn() || !pushSupported() || Notification.permission !== 'granted') return
  const info = await pushInfo()
  if (!info.key) return
  const reg = await registration()
  if (!reg) return
  try {
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      if (!info.on) {
        await fetch(API('/api/push'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: currentUserId(), action: 'subscribe', subscription: sub.toJSON() }),
        })
      }
      return
    }
  } catch {
    /* ниже попробуем подписаться заново */
  }
  await enablePush().catch(() => null)
}
