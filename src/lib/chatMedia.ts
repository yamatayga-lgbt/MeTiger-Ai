/* ============================================================
   Байты картинок и сгенерированных файлов из чата — отдельно от текста.

   localStorage не годится для них: квота в несколько МБ и падает молча
   (см. src/lib/images.ts) — поэтому раньше `persist.ts` картинки и файлы
   с base64 в сохранение вообще не пускал, и они пропадали при каждом
   перезапуске приложения. Текст и структура переписки остаются в
   localStorage как раньше (быстро, синхронно, грузится мгновенно), а сами
   байты — здесь, в IndexedDB (квота там на порядки больше и ничего не
   роняет молча): подгружаются отдельным быстрым шагом сразу после
   открытия чата и дорисовываются в уже показанный текст.

   Идентификатор куска не хранится отдельно — он всегда выводится из
   id сообщения, вида медиа и порядкового номера (imgMediaId/fileMediaId),
   поэтому после загрузки текста достаточно знать СКОЛЬКО картинок/файлов
   было у сообщения (это как раз и остаётся в localStorage), чтобы
   пересчитать те же ключи и забрать байты.
   ============================================================ */

const DB_NAME = 'metiger-chat-media'
const STORE = 'media'
const DB_VERSION = 1

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

/** id картинки пользователя/ответа: m.images[i] — храним ровно то, что лежит в
    поле (полный data:...;base64, URL — так меньше кода, рендерится как есть). */
export function imgMediaId(msgId: string, i: number): string {
  return `${msgId}:img:${i}`
}

/** id сгенерированного файла: m.files[i].b64 — тут без префикса data:, как и
    в самом поле Attachment.b64/FileChip — рендер сам собирает data:-ссылку. */
export function fileMediaId(msgId: string, i: number): string {
  return `${msgId}:file:${i}`
}

/** Уже пробовали сохранить этот id в этом сеансе — незачем писать его снова
    при каждом последующем изменении переписки (saveChats зовут часто). */
const tried = new Set<string>()

/** Кладёт один кусок (data URL или base64) под своим id. Сбой не должен мешать
    показу или отправке — это подстраховка, а не обязательная часть пути. */
export function saveMedia(id: string, value: string): void {
  if (!value || tried.has(id)) return
  tried.add(id)
  void (async () => {
    try {
      const db = await openDb()
      if (!db) return
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put({ id, value, savedAt: Date.now() })
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
    } catch {
      /* noop — картинка просто не переживёт перезапуск, не хуже, чем раньше */
    }
  })()
}

/** Пачкой читает несколько id разом — один проход по базе на подгрузку всего чата. */
export async function loadMediaMap(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!ids.length) return out
  try {
    const db = await openDb()
    if (!db) return out
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      let left = ids.length
      ids.forEach((id) => {
        const req = store.get(id)
        req.onsuccess = () => {
          const rec = req.result as { id: string; value: string } | undefined
          if (rec && rec.value) out[id] = rec.value
          if (--left === 0) resolve()
        }
        req.onerror = () => { if (--left === 0) resolve() }
      })
    })
    db.close()
  } catch {
    /* noop */
  }
  return out
}

/** Чистка за удалённым чатом/сообщением — чтобы IndexedDB не пухла бесконечно
    за годы переписок. Сбой — не повод мешать самому удалению чата. */
export function deleteMedia(ids: string[]): void {
  if (!ids.length) return
  void (async () => {
    try {
      const db = await openDb()
      if (!db) return
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        ids.forEach((id) => { store.delete(id); tried.delete(id) })
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
    } catch {
      /* noop */
    }
  })()
}

/** Все id картинок/файлов, которые есть у сообщения сейчас (сколько элементов —
    столько и id, без разницы, placeholder там '' или уже настоящие байты). */
export function mediaIdsOfMessage(m: { id: string; images?: string[]; files?: { b64?: string }[] }): string[] {
  const ids: string[] = []
  if (Array.isArray(m.images)) m.images.forEach((_, i) => ids.push(imgMediaId(m.id, i)))
  if (Array.isArray(m.files)) m.files.forEach((_, i) => ids.push(fileMediaId(m.id, i)))
  return ids
}
