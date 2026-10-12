/* ============================================================
   Обращения об ошибках (0.173): отправка человеком и «ведомство» владельца.
   ============================================================ */

/* Зачем. Пункт «Сообщить об ошибке» много версий стоял с пометкой «Скоро»: за ним
   ничего не было. Теперь за ним живая форма — описать проблему и приложить до
   четырёх снимков экрана, — а обращения приходят владельцу на его устройство,
   где он закрывает их двумя кнопками: «Рассмотрено» или «Отказано».

   Владелец опознаётся кодом. Код вводится один раз на его устройстве (вход —
   «Информация», пять тапов по версии, как «режим разработчика» в Android),
   хранится только тут и уходит на сервер заголовком. Сервер сверяет отпечаток —
   значит, ни в репозитории, ни в коде чужого доступа к обращениям нет. */

import { APP_VERSION } from './version'
import { ensureDeviceUserId } from './identity'
import { deviceKey, deviceModel, myId } from './devid'

const OWNER_KEY = 'mt-owner'

/** Сколько фото и знаков принимает форма — то же, что на сервере (engine/reports.js). */
export const REPORT_MAX_CHARS = 2000
export const REPORT_MAX_PHOTOS = 4

/** Потолок одного снимка для отправки: длинная сторона 1280 — читаемо и не тонна. */
const PHOTO_MAX_SIDE = 1280
const PHOTO_QUALITY = 0.72

export interface ReportSummary {
  id: string
  at: number
  uid: string
  /** 0.176: ID устройства и модель телефона — владельцу видно, кто и с чего писал. */
  did: string
  model: string
  ver: string
  text: string
  photos: number
  status: 'new' | 'done' | 'declined'
  verdictAt: number
}

export interface ReportFull extends ReportSummary {
  /** Сами снимки: приезжают только при открытии одной заявки, не в списке. */
  photoData?: string[]
}

/* ---------- код владельца: только на его устройстве ---------- */

export function ownerCode(): string {
  try {
    return String(localStorage.getItem(OWNER_KEY) || '')
  } catch {
    return ''
  }
}

export function setOwnerCode(code: string): void {
  try {
    const v = String(code || '').trim()
    if (v) localStorage.setItem(OWNER_KEY, v)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    /* приватный режим — ведомство просто не включится, это не поломка приложения */
  }
}

export function ownerEnabled(): boolean {
  return !!ownerCode()
}

/* ---------- снимок: ужать в браузере, чтобы уехало быстро ---------- */

/**
 * Фото → dataURL. Сжимаем на устройстве: снимок с телефона весит мегабайты, а
 * владельцу нужно прочитать, что на экране, а не любоваться пикселями. Если
 * canvas недоступен, отдаём файл как есть — лучше тяжёлое фото, чем никакого.
 */
export async function photoToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('файл не прочитался'))
    reader.readAsDataURL(file)
  })
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('картинка не открылась'))
      el.src = raw
    })
    const side = Math.max(img.width, img.height)
    const scale = side > PHOTO_MAX_SIDE ? PHOTO_MAX_SIDE / side : 1
    if (scale === 1 && raw.length < 700_000) return raw
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return raw
    ctx.drawImage(img, 0, 0, w, h)
    const out = canvas.toDataURL('image/jpeg', PHOTO_QUALITY)
    return out.length < raw.length || scale < 1 ? out : raw
  } catch {
    return raw
  }
}

/* ---------- сеть ---------- */

const json = async (r: Response) => {
  try {
    return await r.json()
  } catch {
    return { ok: false, error: 'сервер ответил непонятно' }
  }
}

/** Отправка обращения. Человеку уходит только «получилось или нет» с причиной. */
export async function sendReport(text: string, photos: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        photos: photos.slice(0, REPORT_MAX_PHOTOS),
        uid: ensureDeviceUserId(),
        /* 0.176: вместе с заявкой уходят ID устройства и модель телефона — владелец
           просил видеть это и в обращениях. Само обращение отправляется как было:
           без переписки и без файлов. */
        device: deviceKey(),
        did: myId(),
        model: await deviceModel(),
        ver: APP_VERSION,
      }),
    })
    const d = await json(r)
    return d.ok ? { ok: true } : { ok: false, error: String(d.error || 'не отправилось') }
  } catch {
    return { ok: false, error: 'сеть не ответила — попробуйте ещё раз' }
  }
}

/** Владелец: проверка кода. Возвращает true, если замок открылся. */
export async function checkOwnerCode(code: string): Promise<boolean> {
  try {
    const r = await fetch('/api/report?owner=1', { headers: { 'x-mt-owner': String(code || '').trim() } })
    if (r.status === 403) return false
    const d = await json(r)
    return !!d.ok
  } catch {
    return false
  }
}

/** Владелец: список обращений. */
export async function loadReports(): Promise<{ ok: boolean; reports: ReportSummary[]; fresh: number; error?: string }> {
  try {
    const r = await fetch('/api/report?owner=1', { headers: { 'x-mt-owner': ownerCode() } })
    if (r.status === 403) return { ok: false, reports: [], fresh: 0, error: 'нет доступа' }
    const d = await json(r)
    if (!d.ok) return { ok: false, reports: [], fresh: 0, error: String(d.error || 'не загрузилось') }
    return { ok: true, reports: d.reports || [], fresh: Number(d.fresh) || 0 }
  } catch {
    return { ok: false, reports: [], fresh: 0, error: 'сеть не ответила' }
  }
}

/** Владелец: одна заявка целиком, с фото. */
export async function loadReport(id: string): Promise<{ ok: boolean; report?: ReportFull; error?: string }> {
  try {
    const r = await fetch('/api/report?owner=1&id=' + encodeURIComponent(id), { headers: { 'x-mt-owner': ownerCode() } })
    const d = await json(r)
    return d.ok ? { ok: true, report: d.report } : { ok: false, error: String(d.error || 'не открылось') }
  } catch {
    return { ok: false, error: 'сеть не ответила' }
  }
}

/** Владелец: вердикт — «Рассмотрено» или «Отказано». */
export async function setReportVerdict(id: string, verdict: 'done' | 'declined'): Promise<boolean> {
  try {
    const r = await fetch('/api/report?owner=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mt-owner': ownerCode() },
      body: JSON.stringify({ id, verdict }),
    })
    const d = await json(r)
    return !!d.ok
  } catch {
    return false
  }
}

/**
 * Убрать обращение совсем (0.177). Отдельная просьба владельца после живой проверки:
 * в списке остались пробные заявки времён разработки, а вердикт их только помечает.
 * Заявка убирается вместе с фотографиями — на сервере это одно действие `delete`.
 */
export async function deleteReport(id: string): Promise<boolean> {
  try {
    const r = await fetch('/api/report?owner=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mt-owner': ownerCode() },
      body: JSON.stringify({ id, action: 'delete' }),
    })
    const d = await json(r)
    return !!d.ok
  } catch {
    return false
  }
}

/** Сколько раз подряд нажали на строку версии — вход в «ведомство». */
export function humanDate(ms: number): string {
  const d = new Date(Math.max(0, Number(ms) || 0))
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return `${day}, ${t}`
}
