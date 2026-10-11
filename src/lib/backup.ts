/* ============================================================
   Резервная копия данных — один файл (0.162, волна «обогнать DeepSeek», пункт 2).

   Зачем: у DeepSeek переписка живёт на аккаунте и сама переезжает на новый
   телефон. У нас всё хранится в браузере, и смена телефона означала потерю всех
   чатов — это самое частое место, где на нас будут жаловаться. Полноценный
   аккаунт с синхронизацией — отдельная работа (код-связка), а честная копия
   файлом нужна прямо сейчас: «Сохранить копию» → файл в любом мессенджере →
   «Загрузить из файла» на новом устройстве.

   Что кладём: всё, что делает приложение «моим» — переписка и настройки из
   localStorage (ключи `mt-*`, список ключей не зашит: новые настройки попадают
   в копию сами), байты картинок и файлов из IndexedDB чата и история вложений.
   Чего НЕ кладём: ничего с сервера — память и профиль живут под ключом
   устройства на сервере, и их переносит отдельная задача.

   Формат — обычный JSON с полем `app`: чужой файл (или обрезанный) не должен
   молча затереть переписку, поэтому проверка обязательна и с человеческой
   причиной отказа.
   ============================================================ */

export const BACKUP_APP = 'metiger-ai'
export const BACKUP_VERSION = 1
/** Ключи приложения в localStorage — по этому префиксу и собираем копию. */
export const LOCAL_PREFIX = 'mt-'

export interface BackupMedia {
  id: string
  value: string
}

export interface BackupShape {
  app: string
  version: number
  exportedAt: number
  /** Настройки и переписка: ключ localStorage → строка как есть. */
  local: Record<string, string>
  /** Картинки и файлы сообщений (IndexedDB чата). */
  media: BackupMedia[]
  /** История вложений («Файлы → Недавние»). */
  history: unknown[]
}

/** Достаточно от хранилища: и настоящий localStorage, и подделка в тесте. */
export interface StorageLike {
  length: number
  key(i: number): string | null
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

/** Ключи приложения из localStorage — как есть, без пересказа. */
export function pickLocal(storage: StorageLike): Record<string, string> {
  const out: Record<string, string> = {}
  if (!storage || typeof storage.key !== 'function') return out
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k || k.indexOf(LOCAL_PREFIX) !== 0) continue
    const v = storage.getItem(k)
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** Собрать копию. Части передаются снаружи: так функция проверяется без браузера. */
export function buildBackup(parts: {
  local: Record<string, string>
  media?: BackupMedia[]
  history?: unknown[]
  now?: number
}): BackupShape {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Number(parts.now) || Date.now(),
    local: parts.local && typeof parts.local === 'object' ? parts.local : {},
    media: Array.isArray(parts.media) ? parts.media : [],
    history: Array.isArray(parts.history) ? parts.history : [],
  }
}

/**
 * Разобрать файл копии. Ошибки — словами для человека: «не тот файл» и «файл
 * испорчен» требуют разных действий, а молчаливая замена переписки пустотой —
 * худший исход из возможных.
 */
export function parseBackup(text: string): BackupShape {
  let raw: unknown
  try {
    raw = JSON.parse(String(text || ''))
  } catch {
    throw new Error('это не файл копии: внутри не читается ни строчки')
  }
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!d || d.app !== BACKUP_APP) throw new Error('это копия другого приложения')
  const local = d.local && typeof d.local === 'object' ? (d.local as Record<string, string>) : {}
  const keys = Object.keys(local)
  if (!keys.length) throw new Error('в копии нет данных: файл пустой или обрезан')
  if (keys.some((k) => k.indexOf(LOCAL_PREFIX) !== 0)) throw new Error('в копии чужие данные — не буду их подставлять')
  return {
    app: BACKUP_APP,
    version: Number(d.version) || 1,
    exportedAt: Number(d.exportedAt) || 0,
    local,
    media: Array.isArray(d.media) ? (d.media as BackupMedia[]).filter((m) => m && typeof m.id === 'string' && typeof m.value === 'string') : [],
    history: Array.isArray(d.history) ? d.history : [],
  }
}

/** Имя файла: дата внутри — по ней человек понимает, какая копия свежее. */
export function backupFileName(now?: number): string {
  const d = new Date(Number(now) || Date.now())
  const p = (n: number) => String(n).padStart(2, '0')
  return 'metiger-копия-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json'
}

/** Что внутри копии — словами, чтобы человек понимал, что заменит. */
export function describeBackup(b: BackupShape): { chats: number; messages: number; media: number; reads: number; when: string; bytes: number } {
  let chats = 0
  let messages = 0
  try {
    const list = JSON.parse(String(b.local['mt-chats'] || '[]'))
    if (Array.isArray(list)) {
      chats = list.filter((c) => c && Array.isArray(c.messages) && c.messages.length).length
      messages = list.reduce((a, c) => a + ((c && Array.isArray(c.messages)) ? c.messages.length : 0), 0)
    }
  } catch {
    /* битая переписка внутри копии — считаем, что чатов нет: описание не должно падать */
  }
  const d = b.exportedAt ? new Date(b.exportedAt) : null
  const when = d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'дата неизвестна'
  return { chats, messages, media: b.media.length, reads: b.history.length, when, bytes: JSON.stringify(b).length }
}

/** Заменить всё содержимое хранилищ содержимым копии. Возвращает число записей. */
export function applyLocal(storage: StorageLike, local: Record<string, string>): number {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.indexOf(LOCAL_PREFIX) === 0) keys.push(k)
  }
  keys.forEach((k) => storage.removeItem(k))
  let n = 0
  Object.keys(local).forEach((k) => {
    if (k.indexOf(LOCAL_PREFIX) !== 0) return
    storage.setItem(k, String(local[k]))
    n++
  })
  return n
}

/* ── Браузерная часть: собрать копию, отдать файлом, принять файл обратно ────── */

import { dumpMedia, restoreMedia } from './chatMedia'
import { dumpHistory, restoreHistory } from './attachHistory'
import type { HistoryItem } from './attachHistory'

/** Собрать копию со всего устройства. */
export async function collectBackup(): Promise<BackupShape> {
  const local = typeof localStorage !== 'undefined' ? pickLocal(localStorage as unknown as StorageLike) : {}
  const media = await dumpMedia()
  const history = await dumpHistory()
  return buildBackup({ local, media, history })
}

/** Отдать копию файлом. Возвращает имя файла — его показываем человеку. */
export function downloadBackup(b: BackupShape): string {
  const name = backupFileName(b.exportedAt)
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return name
}

/**
 * Заменить данные устройства копией.
 *
 * Порядок важен: сначала настройки и переписка, потом байты. Если оборвётся на
 * байтах, текст чатов уже на месте, а картинки просто не покажутся — это лучше,
 * чем обратный порядок, где байты есть, а переписки, которая на них ссылается, нет.
 */
export async function restoreBackup(b: BackupShape): Promise<{ local: number; media: number; reads: number }> {
  const local = applyLocal(localStorage as unknown as StorageLike, b.local)
  let media = 0
  let reads = 0
  try {
    media = await restoreMedia(b.media)
  } catch {
    /* без байтов копия всё ещё полезна: текст на месте */
  }
  try {
    reads = b.history.length ? await restoreHistory(b.history as HistoryItem[]) : 0
  } catch {
    /* история вложений — мелочь по сравнению с перепиской */
  }
  return { local, media, reads }
}
