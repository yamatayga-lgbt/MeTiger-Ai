/**
 * Картинки в чате (Этап 2: без них совет зрячих голов недостижим из интерфейса).
 *
 * Правило одно: в сеть уходит ТО, что модель реально разглядит, а не то, что
 * выгружено из галереи. Телефонное фото 4000×3000 весит несколько мегабайт,
 * лимит тела у бесплатных провайдеров кончается раньше, чем начинается толк,
 * а в localStorage такая ссылка выбивает квоту на десятки чатов. Поэтому:
 * сторона ограничена, JPEG с разумным качеством, и вес проверяется ДО отправки.
 */

export const MAX_IMAGES = 2
/** Больше этой стороны модель различий не видит, а вес растёт квадратом. */
export const MAX_SIDE = 1024
export const JPEG_QUALITY = 0.82
/** Порог, о который спотыкается вход /api/chat (см. MAX_IMG_BYTES на сервере). */
export const MAX_DATAURL_CHARS = Math.round((4 * 1024 * 1024) / 0.74)

export type PickedFile = { ok: true; dataUrl: string } | { ok: false; error: string }

/**
 * Картинка — это то, что похоже на картинку типом ИЛИ именем. Проверка «только по
 * MIME» была причиной того, что фото вообще не отправлялись: галерея на части
 * телефонов отдаёт файл с пустым `type` (а iPhone отдаёт `image/heic`, которого нет
 * в списке «что читает браузер»), и такой файл молча отсекался — человек нажимал
 * «прикрепить» и не происходило ничего.
 */
export const IMAGE_EXT = /\.(png|jpe?g|jpeg|webp|gif|bmp|avif|heic|heif|tif|tiff|jfif)$/i

export function looksLikeImage(f: { name?: string; type?: string }): boolean {
  const mime = String(f && f.type || '').toLowerCase()
  return mime.indexOf('image/') === 0 || IMAGE_EXT.test(String(f && f.name || ''))
}

/** Только картинки и не больше двух: всё остальное агент всё равно не увидит. */
export function pickImages(files: Array<File | null | undefined> | null | undefined): File[] {
  const list = (files || []).filter((f): f is File => !!f && typeof f.type === 'string' && looksLikeImage(f))
  return list.slice(0, MAX_IMAGES)
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || !document.createElement) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext ? c.getContext('2d') : null
  return ctx ? { c, ctx } : null
}

/**
 * Файл → data URL, ужатый до MAX_SIDE по длинной стороне.
 * Ошибку возвращаем значением, а не исключением: вызывающий обязан показать
 * человеку «не прочитал», а не получить пустой пузырь.
 */
export async function fileToDataUrl(file: File, maxSide = MAX_SIDE): Promise<PickedFile> {
  if (!file || !looksLikeImage({ name: file.name, type: file.type })) {
    return { ok: false, error: 'это не картинка' }
  }
  /* createObjectURL бросает на всём, что не Blob (а вызывающий может принести
     что угодно), — поэтому внутри try: обязанность функции вернуть ошибку
     значением, а не устроить пустой пузырь в чате. */
  let url = ''
  try {
    url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''
    const img = await load(url, file)
    const w0 = img.width || 0
    const h0 = img.height || 0
    if (!w0 || !h0) return { ok: false, error: 'картинка не читается' }
    const k = Math.min(1, maxSide / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * k))
    const h = Math.max(1, Math.round(h0 * k))
    const made = makeCanvas(w, h)
    if (!made) return { ok: false, error: 'браузер не умеет сжимать картинки' }
    made.ctx.drawImage(img, 0, 0, w, h)
    if (typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close()
    const dataUrl = made.c.toDataURL('image/jpeg', JPEG_QUALITY)
    if (!dataUrl || dataUrl.length < 64) return { ok: false, error: 'не получилось сжать' }
    if (dataUrl.length > MAX_DATAURL_CHARS) return { ok: false, error: 'слишком тяжёлая картинка' }
    return { ok: true, dataUrl }
  } catch (e) {
    /* HEIC — не «битая картинка», а формат, которого нет в браузере: без этой
       подсказки человек будет перебирать снимки и решит, что сломан чат. */
    const heic = /hei[cf]$/i.test(file.name || '') || /hei[cf]/.test(file.type || '')
    return { ok: false, error: heic
      ? 'HEIC (формат iPhone) браузер не открывает — включите «Совместимые форматы» в настройках камеры или пришлите JPEG'
      : (e as Error)?.message || 'картинка не прочитана' }
  } finally {
    if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url)
  }
}

/**
 * Файлы из вставки (Ctrl+V) и перетаскивания. Возвращаем [] — и вызывающий НЕ трогает
 * событие: текст в поле должен вставляться как вставлялся.
 *
 * `items` читаем вторым шагом не от жадности: в старых WebKit при вставке скриншота
 * `files` пустой, а картинка лежит именно в items.
 */
export function filesFromTransfer(dt: {
  files?: ArrayLike<File> | null
  items?: ArrayLike<{ kind?: string; type?: string; getAsFile?: () => File | null }> | null
} | null | undefined): File[] {
  const out: File[] = []
  const fl = dt && dt.files
  if (fl && fl.length) for (let i = 0; i < fl.length; i++) { const f = fl[i]; if (f) out.push(f) }
  if (out.length) return out
  const items = dt && dt.items ? dt.items : null
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it || it.kind !== 'file') continue
      const f = it.getAsFile ? it.getAsFile() : null
      if (f) out.push(f)
    }
  }
  return out
}

/**
 * Возвращает САМ рисуемый источник (ImageBitmap/<img>), а не копию его width/height —
 * до этой правки здесь терялся настоящий объект: наружу уходил голый `{width, height}`,
 * выданный за картинку через `as`. TypeScript верил касту и пропускал, а
 * `ctx.drawImage()` в рантайме честно падал на любом объекте, который не является
 * ImageBitmap/HTMLImageElement/и т.д. — ровно с ошибкой "provided value is not of
 * type (...)". createImageBitmap есть почти во всех современных телефонных браузерах,
 * так что ветка с потерей объекта срабатывала почти всегда — поэтому картинки не
 * отправлялись почти ни у кого.
 */
async function load(objectUrl: string, file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function' && file) {
    try {
      return await createImageBitmap(file)
    } catch (e) {
      /*(createImageBitmap отказал — пробуем через <img>, он переваривает больше) */
    }
  }
  if (!objectUrl || typeof Image !== 'function') throw new Error('нет способа прочитать картинку')
  return await new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('не открылось'))
    im.src = objectUrl
  })
}
