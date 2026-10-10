/* ============================================================
   Сохранение пользовательских данных в localStorage.
   Правила:
   — сохраняются только реальные переписки (с сообщениями);
   — пустые черновики не сохраняются;
   — удалённый чат удаляется и из хранилища (без «возврата»).

   Картинки и сгенерированные файлы (base64) в САМ JSON localStorage не
   попадают — одна фотография весит больше, чем вся остальная переписка,
   а квота там в единицы МБ и падает молча. Их байты — в IndexedDB (см.
   src/lib/chatMedia.ts), здесь остаётся только «сколько их было» (массив
   нужной длины с одним содержимым placeholder — настоящие байты
   подгружаются отдельно, см. hydrateChatMedia).
   ============================================================ */

import type { Chat } from '../App'
import type { ViewId } from '../App'
import { fileMediaId, imgMediaId, loadMediaMap, mediaIdsOfMessage, saveMedia } from './chatMedia'

const CHATS_KEY = 'mt-chats'
const ACTIVE_KEY = 'mt-active-chat'
const VIEW_KEY = 'mt-view'

const MAX_MESSAGES_PER_CHAT = 300
const MAX_CHAT_TITLE = 30

function safeChatTitle(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, MAX_CHAT_TITLE)
    : 'Новый чат'
}

type RawFile = {
  name?: unknown
  mime?: unknown
  size?: unknown
  b64?: unknown
  kind?: unknown
  source?: unknown
  lines?: unknown
}

type RawMessage = {
  id?: unknown
  role?: unknown
  text?: unknown
  ts?: unknown
  src?: unknown
  advice?: unknown
  adviceTone?: unknown
  ms?: unknown
  images?: unknown
  files?: unknown
}

type FileMeta = NonNullable<Chat['messages'][number]['files']>[number]

function sanitizeFile(f: unknown): FileMeta | null {
  if (!f || typeof f !== 'object') return null
  const r = f as RawFile
  if (typeof r.name !== 'string' || typeof r.mime !== 'string' || typeof r.size !== 'number') return null
  return {
    name: r.name,
    mime: r.mime,
    size: r.size,
    /* placeholder '' допустим — реальные байты (если были) живут в IndexedDB
       и дорисовываются после hydrateChatMedia */
    b64: typeof r.b64 === 'string' ? r.b64 : '',
    ...(typeof r.kind === 'string' ? { kind: r.kind } : {}),
    ...(typeof r.source === 'string' ? { source: r.source } : {}),
    ...(typeof r.lines === 'number' ? { lines: r.lines } : {}),
  }
}

function sanitizeMessage(m: RawMessage): Chat['messages'][number] | null {
  if (!m || typeof m !== 'object') return null
  if (typeof m.id !== 'string') return null
  if (m.role !== 'user' && m.role !== 'assistant') return null
  if (typeof m.text !== 'string') return null
  const tone = m.adviceTone === 'ok' || m.adviceTone === 'warn' || m.adviceTone === 'quiet' ? m.adviceTone : undefined
  const images = Array.isArray(m.images) ? m.images.filter((v): v is string => typeof v === 'string') : undefined
  const files = Array.isArray(m.files)
    ? (m.files.map(sanitizeFile).filter((f): f is NonNullable<typeof f> => f !== null))
    : undefined
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    /* когда пришло сообщение — чтобы «N минут назад» под ним не сбрасывалось
       в «только что» после перезагрузки страницы */
    ...(typeof m.ts === 'number' && isFinite(m.ts) ? { ts: m.ts } : {}),
    /* подпись движка — строки, и только строки: из хранилища может прилететь что угодно */
    ...(typeof m.src === 'string' ? { src: m.src } : {}),
    ...(typeof m.advice === 'string' ? { advice: m.advice } : {}),
    ...(tone ? { adviceTone: tone } : {}),
    /* сколько шёл ответ — для той же строки рядом с «N минут назад» */
    ...(typeof m.ms === 'number' && isFinite(m.ms) ? { ms: m.ms } : {}),
    /* длина массивов сохраняется всегда — настоящие байты (если есть) лежат
       в IndexedDB и приедут через hydrateChatMedia, без разницы, placeholder
       здесь '' или уже настоящая картинка (на случай кэша до этой правки) */
    ...(images && images.length ? { images } : {}),
    ...(files && files.length ? { files } : {}),
  }
}

function sanitizeChat(raw: unknown): Chat | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as { id?: unknown; title?: unknown; updatedAt?: unknown; messages?: unknown }
  if (typeof c.id !== 'string' || !c.id) return null
  if (!Array.isArray(c.messages)) return null
  const messages = c.messages
    .map((m) => sanitizeMessage(m as RawMessage))
    .filter((m): m is Chat['messages'][number] => m !== null)
    .slice(-MAX_MESSAGES_PER_CHAT)
  if (messages.length === 0) return null
  return {
    id: c.id,
    title: safeChatTitle(c.title),
    messages,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
  }
}

/** Загружает сохранённые чаты; если их нет — один пустой черновик.
    Картинки/файлы на этом шаге ещё placeholder — зовите hydrateChatMedia
    сразу после, чтобы дорисовать настоящие байты из IndexedDB. */
export function loadChats(makeDraft: () => Chat): Chat[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const chats = parsed
          .map(sanitizeChat)
          .filter((c): c is Chat => c !== null)
        if (chats.length > 0) return chats
      }
    }
  } catch {
    /* noop */
  }
  return [makeDraft()]
}

/** Донаполняет чаты настоящими байтами картинок/файлов из IndexedDB — вызывать
    один раз после loadChats. Возвращает тот же массив, если дополнять нечего
    (ничего лишнего не перерисовывается). */
export async function hydrateChatMedia(chats: Chat[]): Promise<Chat[]> {
  const ids: string[] = []
  for (const c of chats) for (const m of c.messages) ids.push(...mediaIdsOfMessage(m))
  if (!ids.length) return chats
  const map = await loadMediaMap(ids)
  if (!Object.keys(map).length) return chats
  return chats.map((c) => ({
    ...c,
    messages: c.messages.map((m) => {
      let changed = false
      let images = m.images
      if (Array.isArray(images)) {
        const next = images.map((v, i) => map[imgMediaId(m.id, i)] || v)
        if (next.some((v, i) => v !== images![i])) { images = next; changed = true }
      }
      let files = m.files
      if (Array.isArray(files)) {
        const next = files.map((f, i) => {
          const v = map[fileMediaId(m.id, i)]
          return v ? { ...f, b64: v } : f
        })
        if (next.some((f, i) => f !== files![i])) { files = next; changed = true }
      }
      return changed ? { ...m, ...(images ? { images } : {}), ...(files ? { files } : {}) } : m
    }),
  }))
}

export function loadActiveChatId(fallback: string): string {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (raw) {
      const id: unknown = JSON.parse(raw)
      if (typeof id === 'string' && id) return id
    }
  } catch {
    /* noop */
  }
  return fallback
}

export function loadView(fallback: ViewId): ViewId {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    const v: unknown = JSON.parse(raw ?? '')
    if (v === 'chat' || v === 'cases' || v === 'settings' || v === 'usage' || v === 'whatsnew') return v
  } catch {
    /* noop */
  }
  return fallback
}

/** Тяжёлые поля — в IndexedDB (см. saveMedia, дедуп по id внутри него сам),
    а в localStorage остаётся placeholder той же длины, чтобы на следующей
    загрузке было понятно, сколько байт-кусков пересчитывать и забирать. */
function stripMediaForStorage(m: Chat['messages'][number]): Chat['messages'][number] {
  let images = m.images
  if (Array.isArray(images) && images.length) {
    images.forEach((v, i) => saveMedia(imgMediaId(m.id, i), v))
    images = images.map(() => '')
  }
  let files = m.files
  if (Array.isArray(files) && files.length) {
    files.forEach((f, i) => saveMedia(fileMediaId(m.id, i), f.b64))
    files = files.map((f) => ({ ...f, b64: '' }))
  }
  if (images === m.images && files === m.files) return m
  return { ...m, ...(images ? { images } : {}), ...(files ? { files } : {}) }
}

/** Сохраняет только реальные чаты — удалённые и пустые исчезают из хранилища. */
export function saveChats(chats: Chat[], activeChatId: string, view: ViewId): void {
  try {
    const real = chats
      .filter((c) => c.messages.length > 0)
      .map((c) => ({
        ...c,
        title: safeChatTitle(c.title),
        messages: c.messages.slice(-MAX_MESSAGES_PER_CHAT).map(stripMediaForStorage),
      }))
    localStorage.setItem(CHATS_KEY, JSON.stringify(real))
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeChatId))
    localStorage.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    /* noop */
  }
}
