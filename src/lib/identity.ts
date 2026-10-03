/* ============================================================
   Кто говорит с агентом. По этому ключу живут память и профиль.
   ============================================================ */

/* Зачем. Продукт открытый, и у всех, кто зашёл браузером, была ОДНА память:
   агент помнил чужие факты про тебя. Ключ привязывает разговор к человеку.
   Аккаунтов здесь нет сознательно, и источник id один:
     • ключ, заведённый один раз и лежащий в localStorage. Не sessionStorage
       (умирает со вкладкой) и не cookie (их читают чужие скрипты на том же домене).
   Чистка данных сайта или другое устройство = новый человек. Это цена отсутствия
   аккаунтов, и она честнее, чем тихая общая память на незнакомцев. */

const UID_KEY = 'mt-uid'

/** Новый ключ: 16 hex. crypto есть и в браузере, и в Node — без него fallback на Math.random. */
export function newUserId(): string {
  const bytes = new Uint8Array(8)
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** Строка для подписи в настройках — человек должен видеть, где живёт его память. */
export function identityLine(userId: string): string {
  if (!userId) return 'память не привязана — всё уйдёт в общий котёл'
  if (userId.indexOf('tg_') === 0) return 'старый ключ бота · id ' + userId.slice(3)   /* такие записи лежат в KV */
  return 'это устройство · ' + userId.slice(0, 4) + '…' + userId.slice(-4)
}

/**
 * Ключ, под которым бэкенд кладёт память. Повторяет `memoryKey()` из
 * `engine/profile.js` — и обязан с ним совпадать: фронт показывает эту строку
 * человеку как «адрес его памяти», а не как догадку.
 */
export function memoryAddress(userId: string): string {
  const uid = /^[A-Za-z0-9_-]{4,80}$/.test(String(userId || '').trim()) ? String(userId).trim() : ''
  return uid ? 'u-' + uid : 'web'
}

/** Устойчивый ключ браузера: читаем, при отсутствии заводим и сохраняем. */
export function ensureDeviceUserId(): string {
  let stored = ''
  try {
    stored = String((globalThis as { localStorage?: Storage }).localStorage?.getItem(UID_KEY) || '')
  } catch {
    /* приватный режим и заблокированный localStorage — не повод ронять приложение */
  }
  if (/^[A-Za-z0-9_-]{4,80}$/.test(stored)) return stored
  const fresh = newUserId()
  try {
    ;(globalThis as { localStorage?: Storage }).localStorage?.setItem(UID_KEY, fresh)
  } catch {
    /* не сохранилось — проживём этим запросом; лучше молчаливой потери, чем падения */
  }
  return fresh
}

/* Единая точка «кто говорит». Вызов, а не константа: ключ устройства заводится при
   первом обращении и обязан пережить чистку вкладки так же, как её переживает память. */
export function currentUserId(): string {
  return ensureDeviceUserId()
}
