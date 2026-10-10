/**
 * Локальные «дела» пользователя (0.136).
 *
 * В отличие от истории переписки, дело — короткая, проверяемая человеком
 * контрольная точка: цель, решения, сделанное и следующий шаг. Данные хранятся
 * только в браузере и по запросу пользователя добавляются к контексту связанного
 * чата — поэтому не зависят от выбранной модели.
 */

export type CaseStatus = 'active' | 'done'

export interface CaseFile {
  id: string
  title: string
  goal: string
  decisions: string[]
  completed: string[]
  nextStep: string
  status: CaseStatus
  chatId?: string
  createdAt: number
  updatedAt: number
}

const CASES_KEY = 'mt-cases'
const MAX_CASES = 100
const MAX_TITLE = 50
const MAX_GOAL = 900
const MAX_STEP = 420
const MAX_LIST_ITEMS = 8
const MAX_LIST_ITEM = 200

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, MAX_LIST_ITEM))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)
}

function sanitizeCase(value: unknown): CaseFile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const now = Date.now()
  return {
    id: raw.id.slice(0, 100),
    title: text(raw.title, MAX_TITLE) || 'Новое дело',
    goal: text(raw.goal, MAX_GOAL),
    decisions: list(raw.decisions),
    completed: list(raw.completed),
    nextStep: text(raw.nextStep, MAX_STEP),
    status: raw.status === 'done' ? 'done' : 'active',
    ...(typeof raw.chatId === 'string' && raw.chatId ? { chatId: raw.chatId.slice(0, 120) } : {}),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  }
}

export function loadCases(): CaseFile[] {
  try {
    const raw = localStorage.getItem(CASES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeCase)
      .filter((item): item is CaseFile => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CASES)
  } catch {
    return []
  }
}

export function saveCases(cases: CaseFile[]): void {
  try {
    const safe = cases
      .map(sanitizeCase)
      .filter((item): item is CaseFile => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CASES)
    localStorage.setItem(CASES_KEY, JSON.stringify(safe))
  } catch {
    /* приватный режим или квота: переписка важнее локальной контрольной точки */
  }
}

export function newCaseDraft(now = Date.now()): CaseFile {
  return {
    id: `case-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Новое дело',
    goal: '',
    decisions: [],
    completed: [],
    nextStep: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

type ChatForCase = {
  id: string
  title: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  updatedAt: number
}

/** Начальная карточка из чата. Пользователь видит и подтверждает поля перед записью. */
export function draftCaseFromChat(chat: ChatForCase, existing?: CaseFile | null, now = Date.now()): CaseFile {
  const firstUser = chat.messages.find((message) => message.role === 'user')?.text || ''
  const base = existing || newCaseDraft(now)
  return {
    ...base,
    title: (existing?.title || chat.title || firstUser || 'Новое дело').trim().slice(0, MAX_TITLE) || 'Новое дело',
    goal: existing?.goal || firstUser.trim().slice(0, MAX_GOAL),
    chatId: chat.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
}

/** Текстовая область формы превращается в список коротких, отдельных пунктов. */
export function splitCaseNotes(value: string): string[] {
  return String(value || '')
    .split(/\n+/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().slice(0, MAX_LIST_ITEM))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)
}

/** Короткая контрольная точка, которую клиент передаёт в запросе связанного дела. */
export function caseContext(project: CaseFile): string {
  const lines = [
    `Контекст дела «${text(project.title, MAX_TITLE)}», сохранённый и подтверждённый пользователем.`,
    project.goal ? `Цель: ${text(project.goal, MAX_GOAL)}` : '',
    project.decisions.length ? `Согласованные решения и факты:\n${project.decisions.map((v) => `- ${text(v, MAX_LIST_ITEM)}`).join('\n')}` : '',
    project.completed.length ? `Уже сделано:\n${project.completed.map((v) => `- ${text(v, MAX_LIST_ITEM)}`).join('\n')}` : '',
    project.nextStep ? `Следующий шаг: ${text(project.nextStep, MAX_STEP)}` : '',
    'Используй карточку как контекст продолжения; если она противоречит новым словам пользователя, уточни и следуй новым словам.',
  ].filter(Boolean)
  return lines.join('\n\n').slice(0, 3600)
}
