/* ============================================================
   Память проекта и закреплённые файлы между чатами (0.237).

   Зачем: на телефоне неудобно каждый раз заново искать и прикладывать
   одну и ту же смету, прайс, справочник или ТЗ при открытии нового чата.
   Здесь человек один раз закрепляет нужные документы (до 5 файлов) и/или
   короткую памятку проекта — и они автоматически подаются агенту в каждом
   разговоре, пока включены.

   Где живёт:
   • Памятка проекта и сводка закреплённых файлов — в localStorage под
     ключами `mt-project-mem` и `mt-pinned-summary` (автоматически попадают
     в резервную копию `pickLocal`, но НЕ стираются при очистке чатов).
   • Байты самих закреплённых файлов — в отдельной базе IndexedDB
     `metiger-pinned-docs` (чтобы не забивать квоту localStorage) и тоже
     входят в файл резервной копии (`pinned` в `backup.ts`).
   ============================================================ */

import type { Attachment } from './api'

export const PROJECT_MEM_KEY = 'mt-project-mem'
export const PINNED_SUMMARY_KEY = 'mt-pinned-summary'
export const PINNED_DB_NAME = 'metiger-pinned-docs'
const PINNED_STORE = 'docs'
const PINNED_DB_VERSION = 1

export const PINNED_MAX = 5
export const PINNED_FILE_MAX_BYTES = 4 * 1024 * 1024
/** Запас под обычные вложения текущего сообщения (потолок /api/chat — 8 МБ). */
export const PINNED_BUDGET_BYTES = 6 * 1024 * 1024
export const PROJECT_TITLE_MAX = 80
export const PROJECT_NOTE_MAX = 2000

export const PINNED_ACCEPT =
  '.pdf,.docx,.xlsx,.pptx,.csv,.tsv,.md,.txt,.json,.xml,.html'

export interface ProjectMemory {
  title: string
  note: string
  enabled: boolean
  updatedAt: number
}

export interface PinnedSummaryItem {
  id: string
  name: string
  mime: string
  size: number
  enabled: boolean
  pinnedAt: number
}

export interface PinnedDoc extends PinnedSummaryItem {
  kind: 'file'
  b64: string
}

const EMPTY_PROJECT: ProjectMemory = {
  title: '',
  note: '',
  enabled: true,
  updatedAt: 0,
}

function emitPinnedChange(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new Event('mt-pinned-change'))
    } catch {
      /* старое окружение без конструктора Event */
    }
  }
}

export function sanitizeProjectMemory(raw: unknown): ProjectMemory {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROJECT }
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title.slice(0, PROJECT_TITLE_MAX) : ''
  const note = typeof r.note === 'string' ? r.note.slice(0, PROJECT_NOTE_MAX) : ''
  const enabled = typeof r.enabled === 'boolean' ? r.enabled : true
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0
  return { title, note, enabled, updatedAt }
}

export function readProjectMemory(): ProjectMemory {
  if (typeof localStorage === 'undefined') return { ...EMPTY_PROJECT }
  try {
    const raw = localStorage.getItem(PROJECT_MEM_KEY)
    if (!raw) return { ...EMPTY_PROJECT }
    return sanitizeProjectMemory(JSON.parse(raw))
  } catch {
    return { ...EMPTY_PROJECT }
  }
}

export function saveProjectMemory(next: Partial<ProjectMemory>): ProjectMemory {
  const cur = readProjectMemory()
  const merged = sanitizeProjectMemory({
    ...cur,
    ...next,
    updatedAt: Date.now(),
  })
  if (typeof localStorage !== 'undefined') {
    try {
      if (!merged.title.trim() && !merged.note.trim()) {
        localStorage.removeItem(PROJECT_MEM_KEY)
      } else {
        localStorage.setItem(PROJECT_MEM_KEY, JSON.stringify(merged))
      }
    } catch {
      /* переполнено или приватное окно */
    }
  }
  emitPinnedChange()
  return merged
}

export function clearProjectMemory(): ProjectMemory {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(PROJECT_MEM_KEY) } catch { /* noop */ }
  }
  emitPinnedChange()
  return { ...EMPTY_PROJECT }
}

/** Текстовый блок активного проекта для контекста запроса (пусто, если выключен или не заполнен). */
export function formatProjectBlock(mem: ProjectMemory): string {
  if (!mem || !mem.enabled) return ''
  const title = String(mem.title || '').trim()
  const note = String(mem.note || '').trim()
  if (!title && !note) return ''
  if (title && note) return `Проект: ${title}\n${note}`
  return title ? `Проект: ${title}` : note
}

export function readPinnedSummary(): PinnedSummaryItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PINNED_SUMMARY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
      .map((x) => ({
        id: String(x.id),
        name: String(x.name),
        mime: typeof x.mime === 'string' ? x.mime : 'application/octet-stream',
        size: Number(x.size) || 0,
        enabled: x.enabled !== false,
        pinnedAt: Number(x.pinnedAt) || 0,
      }))
      .slice(0, PINNED_MAX)
  } catch {
    return []
  }
}

function writePinnedSummary(docs: PinnedDoc[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (!docs.length) {
      localStorage.removeItem(PINNED_SUMMARY_KEY)
      return
    }
    const summary: PinnedSummaryItem[] = docs.slice(0, PINNED_MAX).map((d) => ({
      id: d.id,
      name: d.name,
      mime: d.mime,
      size: d.size,
      enabled: d.enabled !== false,
      pinnedAt: d.pinnedAt,
    }))
    localStorage.setItem(PINNED_SUMMARY_KEY, JSON.stringify(summary))
  } catch {
    /* noop */
  }
}

function openPinnedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(PINNED_DB_NAME, PINNED_DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PINNED_STORE)) {
        db.createObjectStore(PINNED_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function readAllFromDb(db: IDBDatabase): Promise<PinnedDoc[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PINNED_STORE, 'readonly')
      const req = tx.objectStore(PINNED_STORE).getAll()
      req.onsuccess = () => {
        const list = ((req.result as PinnedDoc[]) || [])
          .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.b64 === 'string')
          .map((d) => ({ ...d, kind: 'file' as const, enabled: d.enabled !== false }))
        list.sort((a, b) => b.pinnedAt - a.pinnedAt)
        resolve(list)
      }
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

export async function listPinnedDocs(): Promise<PinnedDoc[]> {
  try {
    const db = await openPinnedDb()
    if (!db) return []
    const items = await readAllFromDb(db)
    db.close()
    writePinnedSummary(items)
    return items
  } catch {
    return []
  }
}

export async function pinDoc(
  input: { name: string; mime: string; size: number; b64: string },
): Promise<{ ok: true; doc: PinnedDoc } | { ok: false; error: string }> {
  const name = String(input?.name || '').trim()
  const b64 = String(input?.b64 || '').trim()
  const size = Number(input?.size) || Math.round(b64.length * 0.75)
  if (!name || !b64) return { ok: false, error: 'пустой файл закрепить нельзя' }
  if (size > PINNED_FILE_MAX_BYTES) {
    return { ok: false, error: `файл «${name}» больше 4 МБ — сократите объём перед закреплением` }
  }
  const db = await openPinnedDb()
  if (!db) return { ok: false, error: 'браузер не дал сохранить файл в память устройства' }
  const current = await readAllFromDb(db)
  const existing = current.find((d) => d.name === name)
  if (!existing && current.length >= PINNED_MAX) {
    db.close()
    return { ok: false, error: `в памяти уже ${PINNED_MAX} файлов — открепите лишний, чтобы добавить новый` }
  }
  const doc: PinnedDoc = {
    id: existing ? existing.id : `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    mime: String(input.mime || 'application/octet-stream'),
    size,
    kind: 'file',
    b64,
    enabled: true,
    pinnedAt: Date.now(),
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(PINNED_STORE, 'readwrite')
    tx.objectStore(PINNED_STORE).put(doc)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  const updated = await readAllFromDb(db)
  db.close()
  writePinnedSummary(updated)
  emitPinnedChange()
  return { ok: true, doc }
}

export async function setPinnedDocEnabled(id: string, enabled: boolean): Promise<PinnedDoc[]> {
  const db = await openPinnedDb()
  if (!db) return []
  const current = await readAllFromDb(db)
  const target = current.find((d) => d.id === id)
  if (target) {
    const next: PinnedDoc = { ...target, enabled }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PINNED_STORE, 'readwrite')
      tx.objectStore(PINNED_STORE).put(next)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }
  const updated = await readAllFromDb(db)
  db.close()
  writePinnedSummary(updated)
  emitPinnedChange()
  return updated
}

export async function unpinDoc(id: string): Promise<PinnedDoc[]> {
  const db = await openPinnedDb()
  if (!db) return []
  await new Promise<void>((resolve) => {
    const tx = db.transaction(PINNED_STORE, 'readwrite')
    tx.objectStore(PINNED_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  const updated = await readAllFromDb(db)
  db.close()
  writePinnedSummary(updated)
  emitPinnedChange()
  return updated
}

export async function clearPinnedDocs(): Promise<void> {
  const db = await openPinnedDb()
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PINNED_STORE, 'readwrite')
      tx.objectStore(PINNED_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  }
  writePinnedSummary([])
  emitPinnedChange()
}

/**
 * Чистая склейка вложений текущего сообщения и закреплённых файлов памяти.
 * Явно приложенные к сообщению файлы всегда идут первыми; закреплённые
 * добавляются следом без дублей и в пределах лимита количества и веса.
 */
export function mergePinnedDocs(
  explicit: Attachment[] | undefined,
  pinned: PinnedDoc[],
  maxFiles = 6,
  maxBytes = PINNED_BUDGET_BYTES,
): { attachments: Attachment[]; pinnedNames: string[] } {
  const base = Array.isArray(explicit) ? explicit.slice(0, maxFiles) : []
  const seen = new Set(base.map((a) => `${a.name}::${a.size}`))
  let bytes = base.reduce((sum, a) => sum + (Number(a.size) || 0), 0)
  const out = base.slice()
  const pinnedNames: string[] = []

  for (const doc of Array.isArray(pinned) ? pinned : []) {
    if (!doc || !doc.enabled || !doc.b64 || !doc.name) continue
    if (out.length >= maxFiles) break
    const sig = `${doc.name}::${doc.size}`
    if (seen.has(sig)) continue
    const docSize = Number(doc.size) || Math.round(doc.b64.length * 0.75)
    if (bytes + docSize > maxBytes) continue
    seen.add(sig)
    bytes += docSize
    out.push({
      name: doc.name,
      mime: doc.mime || 'application/octet-stream',
      size: docSize,
      b64: doc.b64,
      kind: 'file',
    })
    pinnedNames.push(doc.name)
  }

  return { attachments: out, pinnedNames }
}

/** Для резервной копии: выгрузить и восстановить закреплённые файлы целиком. */
export async function dumpPinnedDocs(): Promise<PinnedDoc[]> {
  return listPinnedDocs()
}

export async function restorePinnedDocs(items: unknown): Promise<number> {
  if (!Array.isArray(items)) return 0
  const clean = items
    .filter((x): x is PinnedDoc => Boolean(x && typeof x === 'object' && typeof (x as PinnedDoc).name === 'string' && typeof (x as PinnedDoc).b64 === 'string'))
    .slice(0, PINNED_MAX)
    .map((x) => ({
      id: typeof x.id === 'string' && x.id ? x.id : `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: x.name,
      mime: typeof x.mime === 'string' ? x.mime : 'application/octet-stream',
      size: Number(x.size) || Math.round(x.b64.length * 0.75),
      kind: 'file' as const,
      b64: x.b64,
      enabled: x.enabled !== false,
      pinnedAt: Number(x.pinnedAt) || Date.now(),
    }))
  const db = await openPinnedDb()
  if (!db) return 0
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PINNED_STORE, 'readwrite')
    const store = tx.objectStore(PINNED_STORE)
    store.clear()
    clean.forEach((d) => store.put(d))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('запись закреплённых файлов не удалась'))
  })
  db.close()
  writePinnedSummary(clean)
  emitPinnedChange()
  return clean.length
}
