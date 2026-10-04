/* ============================================================
   Локальная история вложений — «Файлы → Недавние».
   Храним в IndexedDB (не localStorage: там квота на десятки КБ и падает
   молча — ровно та причина, по которой base64 картинок и файлов нигде
   больше в проекте в localStorage не кладут, см. src/lib/images.ts).
   Живёт только в этом браузере: своего облачного хранилища у проекта нет.
   ============================================================ */

export interface HistoryItem {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'file' | 'voice'
  /** base64 без префикса data:...;base64, — как в Attachment.b64. */
  b64: string
  addedAt: number
}

const DB_NAME = 'metiger-attach-history'
const STORE = 'items'
const DB_VERSION = 1
/** Сколько вложений держим: больше — не история, а второе хранилище файлов. */
export const HISTORY_CAP = 20

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function listFrom(db: IDBDatabase): Promise<HistoryItem[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => {
        const items = (req.result as HistoryItem[]) || []
        items.sort((a, b) => b.addedAt - a.addedAt)
        resolve(items)
      }
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** Сохраняет вложение в историю — молча, сбой не должен мешать отправке сообщения. */
export async function addToHistory(item: { name: string; mime: string; size: number; kind: HistoryItem['kind']; b64: string }): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    const full: HistoryItem = { ...item, id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: Date.now() }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(full)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    const items = await listFrom(db)
    if (items.length > HISTORY_CAP) {
      const drop = items.slice(HISTORY_CAP)
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        drop.forEach((it) => store.delete(it.id))
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    }
    db.close()
  } catch {
    /* история — приятная мелочь, не повод ронять отправку */
  }
}

export async function listHistory(): Promise<HistoryItem[]> {
  try {
    const db = await openDb()
    if (!db) return []
    const items = await listFrom(db)
    db.close()
    return items
  } catch {
    return []
  }
}

export async function removeFromHistory(id: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  } catch {
    /* noop */
  }
}

/** data:mime;base64,XXXX → XXXX — чтобы класть то же, что лежит в Attachment.b64. */
export function dataUrlToB64(dataUrl: string): string {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
}
