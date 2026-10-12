/* ============================================================
   Аккаунт (0.174): вход, регистрация, восстановление, чужие входы.
   ============================================================ */

/* Зачем. До 0.174 память жила на устройстве, а о проблемах человек писал анонимно.
   Владелец попросил иначе: «добавим вход в аккаунты, основа будет через Google,
   но можно и другие способы: TikTok, Instagram, VK, Discord, Facebook — не только
   вход, но и регистрация. Если забыл пароль — на почту поступает пароль… максимум
   5 разных аккаунтов. На этих аккаунтах и будет память пользователя».

   Правила здесь: сессия — печенька на стороне сервера (токен в localStorage НЕ
   держим: чужие скрипты на том же домене его не прочитают). Последний известный
   аккаунт кэшируется на устройстве только чтобы показать приложение без сети —
   доступ он не даёт: без живой сессии сервер не примет ни одного запроса. */

import { ensureDeviceUserId } from './identity'

const CACHE_KEY = 'mt-account'

export interface Account {
  id: string
  email: string
  name: string
  createdAt: number
  providers: string[]
  mayRecover: boolean
  /** Владелец: у него в профиле появляется «Обращения». */
  owner: boolean
}

export interface ProviderInfo {
  title: string
  on: boolean
}

const json = async (r: Response) => {
  try {
    return await r.json()
  } catch {
    return { ok: false, error: 'сервер ответил непонятно' }
  }
}

/** Последний вход — только для показа без сети. Не документ доступа. */
export function cachedAccount(): Account | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const acc = JSON.parse(raw) as Account
    return acc && acc.id ? acc : null
  } catch {
    return null
  }
}

export function setCachedAccount(acc: Account | null): void {
  try {
    if (acc) localStorage.setItem(CACHE_KEY, JSON.stringify(acc))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    /* приватный режим — просто не запомним вход между запусками */
  }
}

/** Список аккаунтов, которыми уже входили с этого устройства (до пяти — потолок сервера). */
const SEEN_KEY = 'mt-accounts-seen'

export function seenAccounts(): { id: string; email: string; name: string }[] {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => x && x.id) : []
  } catch {
    return []
  }
}

export function rememberAccount(acc: Account): void {
  try {
    const list = seenAccounts().filter((x) => x.id !== acc.id)
    list.unshift({ id: acc.id, email: acc.email, name: acc.name })
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(0, 5)))
  } catch {
    /* не запомнили — не беда: в следующий раз человек введёт адрес сам */
  }
}

export function forgetSeenAccount(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenAccounts().filter((x) => x.id !== id)))
  } catch {
    /* список уже пуст — и хорошо */
  }
}

/** Кто я сейчас. null — никто (нужен вход). Сеть не ответила — отдаём кэш. */
export async function me(): Promise<{ ok: boolean; user: Account | null; offline: boolean; mail?: boolean }> {
  try {
    const r = await fetch('/api/auth?me=1')
    const d = await json(r)
    if (!d.ok) return { ok: false, user: null, offline: false }
    const user = (d.user as Account) || null
    setCachedAccount(user)
    if (user) rememberAccount(user)
    return { ok: true, user, offline: false, mail: !!d.mail }
  } catch {
    return { ok: false, user: cachedAccount(), offline: true }
  }
}

export interface AuthResult {
  ok: boolean
  error?: string
  user?: Account
}

async function post(action: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const r = await fetch('/api/auth?action=' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, device: ensureDeviceUserId() }),
    })
    const d = await json(r)
    if (!d.ok) return { ok: false, error: String(d.error || 'не получилось') }
    if (d.user) {
      setCachedAccount(d.user as Account)
      rememberAccount(d.user as Account)
    }
    return { ok: true, user: d.user, error: d.message ? String(d.message) : undefined }
  } catch {
    return { ok: false, error: 'сеть не ответила — попробуйте ещё раз' }
  }
}

export const registerAccount = (email: string, password: string, name = '') =>
  post('register', { email, password, name })

export const loginAccount = (email: string, password: string) => post('login', { email, password })

export const changePassword = (oldPassword: string, password: string) =>
  post('change', { old: oldPassword, password })

/** Восстановление: на почту уходит новый пароль (так просил владелец). */
export const recoverPassword = (email: string) => post('recover', { email })

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth?action=logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  } catch {
    /* сети нет — всё равно уходим: печенька живёт до ответа сервера */
  }
  setCachedAccount(null)
}

/** Какие входы включены (по ключам в env на сервере) и подключена ли почта. */
export async function authOptions(): Promise<{ providers: Record<string, ProviderInfo>; mail: boolean }> {
  try {
    const d = await json(await fetch('/api/auth?providers=1'))
    return { providers: (d.providers as Record<string, ProviderInfo>) || {}, mail: !!d.mail }
  } catch {
    return { providers: {}, mail: false }
  }
}

/** Уйти к провайдеру: сервер сам соберёт адрес и вернёт человека с сессией. */
export function startProvider(id: string): void {
  location.href = '/api/auth?start=' + encodeURIComponent(id) + '&device=' + encodeURIComponent(ensureDeviceUserId())
}

export function accountName(acc: Account | null): string {
  if (!acc) return 'Гость'
  return String(acc.name || '').trim() || String(acc.email || '').split('@')[0] || 'Аккаунт'
}
