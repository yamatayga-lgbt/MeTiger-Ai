/* ============================================================
   Сохранение пользовательских данных в localStorage.
   Правила:
   — сохраняются только реальные переписки (с сообщениями);
   — пустые черновики не сохраняются;
   — удалённый чат удаляется и из хранилища (без «возврата»).
   ============================================================ */

import type { Chat } from '../App'
import type { ViewId } from '../App'

const CHATS_KEY = 'mt-chats'
const ACTIVE_KEY = 'mt-active-chat'
const VIEW_KEY = 'mt-view'

const MAX_MESSAGES_PER_CHAT = 300

type RawMessage = {
  id?: unknown
  role?: unknown
  text?: unknown
  ts?: unknown
  src?: unknown
  advice?: unknown
  adviceTone?: unknown
  ms?: unknown
}

function sanitizeMessage(m: RawMessage): Chat['messages'][number] | null {
  if (!m || typeof m !== 'object') return null
  if (typeof m.id !== 'string') return null
  if (m.role !== 'user' && m.role !== 'assistant') return null
  if (typeof m.text !== 'string') return null
  const tone = m.adviceTone === 'ok' || m.adviceTone === 'warn' || m.adviceTone === 'quiet' ? m.adviceTone : undefined
  /* Картинки в хранилище НЕ пишутся намеренно: одна фотография в base64 весит
     больше, чем все тексты переписки вместе, а квота localStorage кончается
     молча и ломает сохранение всего чата. В сохранении — только текст. */
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
    title: typeof c.title === 'string' && c.title.trim() ? c.title : 'Новый чат',
    messages,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
  }
}

/** Загружает сохранённые чаты; если их нет — один пустой черновик. */
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
    if (v === 'chat' || v === 'settings') return v
  } catch {
    /* noop */
  }
  return fallback
}

/** Сохраняет только реальные чаты — удалённые и пустые исчезают из хранилища. */
export function saveChats(chats: Chat[], activeChatId: string, view: ViewId): void {
  try {
    const real = chats
      .filter((c) => c.messages.length > 0)
      .map((c) => ({ ...c, messages: c.messages.slice(-MAX_MESSAGES_PER_CHAT) }))
    localStorage.setItem(CHATS_KEY, JSON.stringify(real))
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeChatId))
    localStorage.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    /* noop */
  }
}
