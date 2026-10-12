/* ============================================================
   ID устройства (0.176) — вместо аккаунтов: человек придумывает себе ID сам,
   устройство узнаётся по телефону, у владельца ID #Dev и доступ разработчика.
   ============================================================
   Зачем отдельный файл. Ключ устройства (mt-uid) — это адрес памяти, он случайный
   и человеку ничего не говорит. ID — это то, что человек ВИДИТ и выбирает сам
   («вместо профилей будет ID:Аккаунтов»). Держать их вместе значило бы путать
   «где лежит память» и «как меня зовут»: одно менять нельзя, другое можно раз
   в неделю.

   Правила (буквы, длина, неделя) живут в engine/devid.js и повторяются здесь
   только для быстрой подсказки в поле ввода — окончательное слово всегда за
   сервером: на клиентских часах любой повернёт неделю вспять. */

import { ensureDeviceUserId } from './identity'
import { ownerCode, ownerEnabled } from './report'
import { APP_VERSION } from './version'

const ID_KEY = 'mt-dev-id'
const MODEL_KEY = 'mt-dev-model'
const ASKED_KEY = 'mt-dev-asked'

/** Правила для подсказки в поле (сервер судит теми же числами). */
export const ID_MIN = 4
export const ID_MAX = 15
export const RENAME_DAYS = 7

export interface MyDevice {
  id: string
  model: string
  owner: boolean
  locked: boolean
  renameInDays: number
}

/** Ключ устройства — он же адрес памяти: mt-uid, как было до 0.176. */
export const deviceKey = (): string => ensureDeviceUserId()

/** Выбранный ID (без решётки); пусто — человек ещё не придумывал. */
export function myId(): string {
  try {
    return String(localStorage.getItem(ID_KEY) || '').replace(/^#+/, '')
  } catch {
    return ''
  }
}

export function saveId(id: string): void {
  try {
    const v = String(id || '').replace(/^#+/, '').trim()
    if (v) localStorage.setItem(ID_KEY, v)
    else localStorage.removeItem(ID_KEY)
  } catch {
    /* приватный режим: ID проживёт до закрытия вкладки — это не поломка */
  }
}

/** Спрашивали ли уже про ID на этом устройстве (чтобы карточка не всплывала каждый раз). */
export function idAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1'
  } catch {
    return false
  }
}

export function markIdAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    /* не запомнилось — карточка вернётся в следующий раз, беды нет */
  }
}

/**
 * Модель телефона. Сначала спрашиваем браузер по-современному (Chrome отдаёт
 * «SM-A546B» или «Pixel 8»), потом разбираем строку браузера, потом честно
 * говорим «неизвестно» — выдумывать модель хуже, чем не знать её.
 */
export async function deviceModel(): Promise<string> {
  try {
    const cached = String(localStorage.getItem(MODEL_KEY) || '')
    if (cached) return cached
  } catch {
    /* кэша нет — спросим заново */
  }

  let model = ''
  try {
    const uaData = (navigator as unknown as { userAgentData?: { getHighEntropyValues?: (k: string[]) => Promise<{ model?: string }> } }).userAgentData
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      const hi = await uaData.getHighEntropyValues(['model'])
      model = String((hi && hi.model) || '')
    }
  } catch {
    /* браузер постарше — идём разбирать строку */
  }

  if (!model || model === 'K') {
    const ua = String(navigator.userAgent || '')
    const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua)
    model = android ? android[1].trim() : ''
    if (!model || model === 'K') {
      if (/iPhone/.test(ua)) model = 'iPhone'
      else if (/iPad/.test(ua)) model = 'iPad'
      else if (/Windows/.test(ua)) model = 'Windows'
      else if (/Macintosh/.test(ua)) model = 'Mac'
      else model = 'неизвестно'
    }
  }

  model = model.replace(/\s+/g, ' ').slice(0, 40)
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {
    /* не закэшировалось — просто спросим в следующий раз */
  }
  return model
}

/** Модель из кэша — синхронно: строка в меню не может ждать ответа браузера. */
export function modelCached(): string {
  try {
    return String(localStorage.getItem(MODEL_KEY) || '')
  } catch {
    return ''
  }
}

/** Почему ID не годится — подсказка в поле, словами. Пустая строка: годится. */
export function idProblemLocal(raw: string): string {
  const id = String(raw || '').replace(/^#+/, '').trim()
  if (!id) return ''
  if (!/^[A-Za-z]+$/.test(id)) return 'только латинские буквы — без цифр, пробелов и знаков'
  if (id.length < ID_MIN) return `нужно не меньше ${ID_MIN} букв`
  if (id.length > ID_MAX) return `не больше ${ID_MAX} букв`
  return ''
}

/** Вид ID для человека: с решёткой, как он и просил — «#Dev». */
export const idShown = (id: string): string => (id ? '#' + id : '')

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = json ? { 'content-type': 'application/json' } : {}
  /* Код владельца едет тем же заголовком, что и в 0.173: он и делает ID #Dev. */
  if (ownerEnabled()) h['x-mt-owner'] = ownerCode()
  return h
}

/**
 * Отметить визит: отдать ID, модель и версию. Сервер сам решит, обновлять ли
 * запись (чаще раза в полчаса он её не трогает — так задумано, чтобы визиты не
 * съедали бесплатное хранилище).
 */
export async function pingDevice(force = false): Promise<MyDevice | null> {
  try {
    const r = await fetch('/api/device', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        device: deviceKey(),
        id: force ? myId() : undefined,
        model: await deviceModel(),
        ver: APP_VERSION,
      }),
    })
    const d = await r.json()
    if (!d || !d.ok || !d.device) return null
    /* Сервер — хозяин ID: если он поставил #Dev или отказал, клиент подчиняется. */
    if (d.device.id && d.device.id !== myId()) saveId(d.device.id)
    return {
      id: String(d.device.id || ''),
      model: String(d.device.model || ''),
      owner: !!d.device.owner,
      locked: !!d.device.locked,
      renameInDays: Number(d.renameInDays) || 0,
    }
  } catch {
    return null
  }
}

export interface ClaimResult {
  ok: boolean
  error?: string
  device?: MyDevice
  renameInDays?: number
  note?: string
}

/** Занять или сменить ID. Сервер решает: занято, служебное имя или неделя не прошла. */
export async function claimId(id: string): Promise<ClaimResult> {
  try {
    const r = await fetch('/api/device', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ device: deviceKey(), id, model: await deviceModel(), ver: APP_VERSION }),
    })
    const d = await r.json()
    if (!d || !d.ok) {
      return {
        ok: false,
        error: String((d && d.error) || 'не получилось — попробуйте ещё раз'),
        device: d && d.device ? { ...d.device, renameInDays: Number(d.renameInDays) || 0 } : undefined,
      }
    }
    if (d.device && d.device.id) saveId(d.device.id)
    return {
      ok: true,
      note: d.note ? String(d.note) : '',
      renameInDays: Number(d.renameInDays) || 0,
      device: {
        id: String(d.device.id || ''),
        model: String(d.device.model || ''),
        owner: !!d.device.owner,
        locked: !!d.device.locked,
        renameInDays: Number(d.renameInDays) || 0,
      },
    }
  } catch {
    return { ok: false, error: 'сеть не ответила — попробуйте ещё раз' }
  }
}

/**
 * «Владелец включился или выключился». Служебный вход живёт в «Информации», а ID
 * и доступ разработчика — в меню, профиле и админ-панели: без этого события после
 * ввода кода они бы обновились только при следующем запуске приложения — человек
 * решил бы, что код не сработал.
 */
export function announceOwnerChange(): void {
  try {
    window.dispatchEvent(new Event('mt-owner'))
  } catch {
    /* окно не то — не беда: обновится при следующем запуске */
  }
}

/** «через 3 дня» — словами, чтобы срок не приходилось считать в голове. */
export function waitText(days: number): string {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (!d) return ''
  return d === 1 ? 'через сутки' : `через ${d} ${d < 5 ? 'дня' : 'дней'}`
}
