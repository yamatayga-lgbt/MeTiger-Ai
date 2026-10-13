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
/* Ключ кэша отпечатка сменил имя (0.182): отпечаток стал «про телефон», а не «про
   браузер», и старый кэш нельзя переиспользовать — иначе он никогда не пересчитается,
   и склейка «тот же телефон из другого браузера» не сработает. */
const FP_KEY = 'mt-dev-fp2'

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
 * Отпечаток устройства — из того, что телефон не меняет (0.177).
 *
 * Зачем: ключ устройства (mt-uid) случайный и умирает вместе с чисткой данных
 * сайта. Тогда тот же телефон заводил ВТОРУЮ запись, и в админ-панели одно
 * устройство выглядело как несколько — владелец увидел три строки «без MT-A546B»
 * вместо своей одной. Отпечаток считается здесь, на телефоне, и уезжает только
 * на нашу же дверь: сервер по нему узнаёт уже известное устройство.
 */
function hash16(src: string): Promise<string> {
  const text = String(src || '')
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (subtle && typeof subtle.digest === 'function') {
    try {
      return subtle
        .digest('SHA-256', new TextEncoder().encode(text))
        .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16))
        .catch(() => hash16Fallback(text))
    } catch {
      /* старый браузер без digest — считаем сами */
    }
  }
  return Promise.resolve(hash16Fallback(text))
}

/** Запасной счёт: djb2 на два регистра — те же 16 знаков, без криптографии. */
function hash16Fallback(text: string): string {
  let a = 5381
  let b = 52711
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = ((a * 33) ^ c) >>> 0
    b = ((b * 31) + c) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 16)
}

/**
 * Семейство системы и её крупная версия — по строке браузера, но БЕЗ самого браузера.
 *
 * Зачем так. Владелец 12 окт объяснил вторую строку в своей админ-панели: «это я же,
 * просто оно считается с другого браузера». Причина была в отпечатке: он считался по
 * полной строке браузера, а у Chrome и Samsung Internet на одном телефоне строки
 * разные — и телефон выглядел двумя устройствами.
 *
 * Из строки браузера берём только то, что от браузера не зависит и меняется редко:
 * систему и её версию. «Android 14» одинаков и в Chrome, и в Samsung Internet, и
 * остаётся тем же после обновления браузера — а два разных телефона одной модели с
 * разными версиями системы (или Android и iPhone) остаются разными.
 */
export function osFamily(ua: string): string {
  const s = String(ua || '')
  const a = /Android[\s/](\d+)/.exec(s)
  if (a) return 'android' + a[1]
  const i = /(?:iPhone|iPad|iPod).*?OS (\d+)/.exec(s)
  if (i) return 'ios' + i[1]
  if (/Windows NT 10/.test(s)) return 'windows10'
  if (/Windows NT 6\.1/.test(s)) return 'windows7'
  if (/Mac OS X/.test(s)) return 'mac'
  if (/CrOS/.test(s)) return 'chromeos'
  if (/Linux/.test(s)) return 'linux'
  return ''
}

/** Язык без хвостов: «ru-RU» → «ru». Полный список языков у каждого браузера свой. */
export function langBase(lang: string): string {
  return String(lang || '').toLowerCase().split(/[-_]/)[0].replace(/[^a-z]/g, '').slice(0, 3)
}

export async function deviceFp(): Promise<string> {
  try {
    const cached = String(localStorage.getItem(FP_KEY) || '')
    if (/^[a-f0-9]{16}$/.test(cached)) return cached
  } catch {
    /* приватный режим — посчитаем без кэша */
  }
  const nav = navigator as unknown as {
    userAgent?: string; platform?: string; language?: string; languages?: string[]
    hardwareConcurrency?: number; deviceMemory?: number
  }
  /* Отпечаток считается «про телефон», а не «про браузер» (0.182): одно и то же
     железо из разных браузеров должно давать один отпечаток, иначе «одно устройство —
     одна запись» ломается на втором браузере. Поэтому здесь НЕТ строки браузера (она
     меняется от браузера к браузеру) и НЕТ списка языков (у каждого свой): остались
     модель, семейство системы, экран, часовой пояс, ядра и память. */
  const parts = [
    modelCached(),
    osFamily(String(nav.userAgent || '')),
    langBase(String(nav.language || '')),
    `${screen.width}x${screen.height}x${window.devicePixelRatio || 1}`,
    String(screen.colorDepth || ''),
    String(new Date().getTimezoneOffset()),
    String(nav.hardwareConcurrency || ''),
    String(nav.deviceMemory || ''),
  ]
  const fp = await hash16(parts.join('|'))
  try {
    localStorage.setItem(FP_KEY, fp)
  } catch {
    /* не запомнилось — посчитаем в следующий раз, результат тот же */
  }
  return fp
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
        fp: await deviceFp(),
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
      body: JSON.stringify({ device: deviceKey(), fp: await deviceFp(), id, model: await deviceModel(), ver: APP_VERSION }),
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
