/**
 * Картинки в чате и умная подготовка фото с камеры телефона (0.238).
 *
 * Правило одно: в сеть уходит ТО, что модель реально разглядит, а не сырой
 * кадр 4000×3000 на 6 МБ. При этом у чека, договора, платёжки или таблицы
 * мелкий шрифт нельзя мылить до 3 пикселей: для документов сторона держится
 * до DOC_MAX_SIDE (1600 px) с выравниванием теней бумаги и подъёмом резкости
 * букв, а для обычных фото — MAX_SIDE (1024 px) с адаптивным бюджетом байтов
 * под мобильную сеть.
 *
 * ВАЖНО: модуль самодостаточен (без внешних импортов), чтобы собираться
 * одиночным прогоном esbuild в проверках фронта.
 */

export const MAX_IMAGES = 4
/** Больше этой стороны на обычном фото модель различий не видит, а вес растёт квадратом. */
export const MAX_SIDE = 1024
/** Для чеков, листов А4 и мелкого текста даём больше пикселей по длинной стороне. */
export const DOC_MAX_SIDE = 1600
/** Рабочий исходник для ручного кадрирования и поворота до финального сжатия. */
export const EDIT_SOURCE_SIDE = 1800
export const JPEG_QUALITY = 0.82
/** Порог, о который спотыкается вход /api/chat (см. MAX_IMG_BYTES на сервере). */
export const MAX_DATAURL_CHARS = Math.round((4 * 1024 * 1024) / 0.74)

export const PHOTO_BUDGET_BYTES = 340 * 1024
export const DOC_BUDGET_BYTES = 460 * 1024
export const SLOW_NET_BUDGET_BYTES = 210 * 1024

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ShotMeta {
  origBytes: number
  sentBytes: number
  savedPct: number
  width: number
  height: number
  isDoc: boolean
  sourceDataUrl?: string
}

export interface PhotoPrepOptions {
  mode?: 'auto' | 'photo' | 'doc'
  keepSource?: boolean
  slowNet?: boolean
}

export type PickedFile =
  | { ok: true; dataUrl: string; meta?: ShotMeta }
  | { ok: false; error: string }

/**
 * Картинка — это то, что похоже на картинку типом ИЛИ именем. Проверка «только по
 * MIME» была причиной того, что фото вообще не отправлялись: галерея на части
 * телефонов отдаёт файл с пустым `type` (а iPhone отдаёт `image/heic`, которого нет
 * в списке «что читает браузер»), и такой файл молча отсекался.
 */
export const IMAGE_EXT = /\.(png|jpe?g|jpeg|webp|gif|bmp|avif|heic|heif|tif|tiff|jfif)$/i

export function looksLikeImage(f: { name?: string; type?: string }): boolean {
  const mime = String((f && f.type) || '').toLowerCase()
  return mime.indexOf('image/') === 0 || IMAGE_EXT.test(String((f && f.name) || ''))
}

/** Только картинки и не больше общего потолка: лишнее агент всё равно не увидит. */
export function pickImages(files: Array<File | null | undefined> | null | undefined): File[] {
  const list = (files || []).filter((f): f is File => !!f && typeof f.type === 'string' && looksLikeImage(f))
  return list.slice(0, MAX_IMAGES)
}

export function approxDataUrlBytes(dataUrl: string): number {
  const comma = String(dataUrl || '').indexOf(',')
  const b64Len = comma >= 0 ? dataUrl.length - comma - 1 : String(dataUrl || '').length
  return Math.max(0, Math.round(b64Len * 0.75))
}

export function isSlowMobileNetwork(conn?: { saveData?: boolean; effectiveType?: string } | null): boolean {
  const c =
    conn !== undefined
      ? conn
      : typeof navigator !== 'undefined'
        ? ((navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection ?? null)
        : null
  if (!c) return false
  if (c.saveData) return true
  const eff = String(c.effectiveType || '').toLowerCase()
  return eff === 'slow-2g' || eff === '2g' || eff === '3g'
}

export function normalizeCropBox(raw?: Partial<CropBox> | null): CropBox {
  if (!raw || typeof raw !== 'object') return { x: 0, y: 0, w: 1, h: 1 }
  const minSpan = 0.08
  let x = Number.isFinite(raw.x) ? Number(raw.x) : 0
  let y = Number.isFinite(raw.y) ? Number(raw.y) : 0
  let w = Number.isFinite(raw.w) ? Number(raw.w) : 1
  let h = Number.isFinite(raw.h) ? Number(raw.h) : 1
  x = Math.max(0, Math.min(1 - minSpan, x))
  y = Math.max(0, Math.min(1 - minSpan, y))
  w = Math.max(minSpan, Math.min(1 - x, w))
  h = Math.max(minSpan, Math.min(1 - y, h))
  return { x, y, w, h }
}

/**
 * Распознаёт по пикселям, похоже ли фото на документ, чек, лист бумаги или
 * снимок экрана с текстом: преобладает светлый малонасыщенный фон и заметна
 * доля тёмных штрихов (буквы/цифры/линии), либо вытянутая лента чека.
 */
export function detectDocumentLike(rgba: ArrayLike<number>, width: number, height: number): boolean {
  const totalPx = Math.floor(width * height)
  if (totalPx < 64 || !rgba || rgba.length < totalPx * 4) return false
  const step = Math.max(1, Math.floor(totalPx / 12000))
  let samples = 0
  let paperLight = 0
  let darkInk = 0
  let highSat = 0

  for (let idx = 0; idx < totalPx; idx += step) {
    const o = idx * 4
    const r = rgba[o]
    const g = rgba[o + 1]
    const b = rgba[o + 2]
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const sat = maxC - minC
    const lum = (r * 77 + g * 150 + b * 29) >> 8
    samples++
    if (sat > 58) highSat++
    if (lum >= 168 && sat <= 46) paperLight++
    else if (lum <= 96) darkInk++
  }
  if (!samples) return false
  const paperRatio = paperLight / samples
  const inkRatio = darkInk / samples
  const satRatio = highSat / samples
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height))

  // Цветная сцена/портрет — не документ, чтобы не выбеливать обычные снимки.
  if (satRatio > 0.28) return false
  // Типичный лист/скрин/таблица: много спокойного светлого фона + контрастный шрифт.
  if (paperRatio >= 0.46 && inkRatio >= 0.012 && inkRatio <= 0.42) return true
  // Длинный кассовый чек на столе: узкая лента с бумажной сердцевиной.
  if (aspect >= 1.9 && paperRatio >= 0.30 && inkRatio >= 0.01) return true
  return false
}

/**
 * Автопоиск краёв листа/чека на тёмном или однотонном столе: находит прямоугольник,
 * где сосредоточена светлая бумага/текст, и оставляет аккуратное поле 2%.
 */
export function autoFindContentBounds(rgba: ArrayLike<number>, width: number, height: number): CropBox {
  if (width < 16 || height < 16 || !rgba || rgba.length < width * height * 4) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
  const colBright = new Float32Array(width)
  const rowBright = new Float32Array(height)
  const stepX = Math.max(1, Math.floor(width / 240))
  const stepY = Math.max(1, Math.floor(height / 240))
  let countX = 0
  let countY = 0

  for (let y = 0; y < height; y += stepY) {
    countY++
    let rSum = 0
    let cCnt = 0
    for (let x = 0; x < width; x += stepX) {
      const o = (y * width + x) * 4
      const r = rgba[o]
      const g = rgba[o + 1]
      const b = rgba[o + 2]
      const lum = (r * 77 + g * 150 + b * 29) >> 8
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      const score = lum >= 150 && sat <= 55 ? 1 : 0
      rSum += score
      colBright[x] += score
      cCnt++
    }
    rowBright[y] = cCnt ? rSum / cCnt : 0
  }
  countX = Math.max(1, countY)

  const threshold = 0.22
  let minX = width
  let maxX = -1
  for (let x = 0; x < width; x += stepX) {
    if (colBright[x] / countX >= threshold) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
  }
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y += stepY) {
    if (rowBright[y] >= threshold) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX <= minX || maxY <= minY) return { x: 0, y: 0, w: 1, h: 1 }
  const padX = width * 0.02
  const padY = height * 0.02
  const x0 = Math.max(0, (minX - padX) / width)
  const y0 = Math.max(0, (minY - padY) / height)
  const x1 = Math.min(1, (maxX + stepX + padX) / width)
  const y1 = Math.min(1, (maxY + stepY + padY) / height)
  const box = normalizeCropBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  // Если лист и так занимает почти весь кадр — не дёргаем рамку на миллиметр.
  if (box.w > 0.94 && box.h > 0.94) return { x: 0, y: 0, w: 1, h: 1 }
  return box
}

/**
 * Улучшение читаемости мелкого текста на чеках и документах с камеры телефона:
 * вытягивает серую тень бумаги к чистому светлому фону по перцентилям яркости
 * и мягко подчёркивает контуры букв (unsharp), сохраняя цвет печатей и подписей.
 */
export function enhanceDocumentPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const total = width * height
  const out = new Uint8ClampedArray(src.length)
  if (total < 16) {
    out.set(src)
    return out
  }

  const hist = new Uint32Array(256)
  const lumArr = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const l = (src[o] * 77 + src[o + 1] * 150 + src[o + 2] * 29) >> 8
    lumArr[i] = l
    hist[l]++
  }

  const lowTarget = Math.floor(total * 0.02)
  const highTarget = Math.floor(total * 0.94)
  let acc = 0
  let pLow = 20
  let pHigh = 235
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= lowTarget) { pLow = v; break }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= highTarget) { pHigh = v; break }
  }
  const span = Math.max(40, pHigh - pLow)

  // 1. Нормализация уровней (высветляем тень бумаги, углубляем бледные чернила чека).
  const normLum = new Uint8Array(total)
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    let t = (v - pLow) / span
    if (t < 0) t = 0
    else if (t > 1) t = 1
    // Мягкая S-кривая для чёткого разделения серой бумаги и бледного термочека.
    const s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    lut[v] = Math.round((t * 0.55 + s * 0.45) * 255)
  }
  for (let i = 0; i < total; i++) normLum[i] = lut[lumArr[i]]

  // 2. Лёгкий подъём резкости краёв букв (3×3 крест Лапласа) + перенос в RGB.
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      const baseL = normLum[i]
      let sharpL = baseL
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const nbr =
          (normLum[i - 1] + normLum[i + 1] + normLum[i - width] + normLum[i + width]) >> 2
        const diff = baseL - nbr
        if (Math.abs(diff) >= 4) {
          sharpL = Math.max(0, Math.min(255, Math.round(baseL + diff * 0.45)))
        }
      }
      const o = i * 4
      const origL = Math.max(1, lumArr[i])
      const r = src[o]
      const g = src[o + 1]
      const b = src[o + 2]
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      if (sat <= 34 && sharpL >= 218) {
        // Почти белая бумага — убираем жёлтый/серый оттенок лампы.
        out[o] = sharpL
        out[o + 1] = sharpL
        out[o + 2] = sharpL
      } else {
        const gain = sharpL / origL
        out[o] = Math.max(0, Math.min(255, Math.round(r * gain)))
        out[o + 1] = Math.max(0, Math.min(255, Math.round(g * gain)))
        out[o + 2] = Math.max(0, Math.min(255, Math.round(b * gain)))
      }
      out[o + 3] = 255
    }
  }
  return out
}

/**
 * Чистое кадрирование + поворот (0/90/180/270) + опциональное улучшение документа
 * над буфером пикселей. Сначала поворачиваем (так пользователь видит поворот на
 * экране и обрезает уже повёрнутый кадр), затем вырезаем рамку crop.
 */
export function transformPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { rotate?: number; crop?: Partial<CropBox>; docEnhance?: boolean },
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const rot = (((opts?.rotate || 0) % 360) + 360) % 360
  let rotW = width
  let rotH = height
  let rotBuf = rgba

  if (rot === 90 || rot === 180 || rot === 270) {
    rotW = rot === 180 ? width : height
    rotH = rot === 180 ? height : width
    rotBuf = new Uint8ClampedArray(rotW * rotH * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let nx = x
        let ny = y
        if (rot === 90) { nx = height - 1 - y; ny = x }
        else if (rot === 180) { nx = width - 1 - x; ny = height - 1 - y }
        else if (rot === 270) { nx = y; ny = width - 1 - x }
        const s = (y * width + x) * 4
        const d = (ny * rotW + nx) * 4
        rotBuf[d] = rgba[s]
        rotBuf[d + 1] = rgba[s + 1]
        rotBuf[d + 2] = rgba[s + 2]
        rotBuf[d + 3] = rgba[s + 3]
      }
    }
  }

  const box = normalizeCropBox(opts?.crop)
  const cx = Math.max(0, Math.min(rotW - 1, Math.round(box.x * rotW)))
  const cy = Math.max(0, Math.min(rotH - 1, Math.round(box.y * rotH)))
  const cw = Math.max(1, Math.min(rotW - cx, Math.round(box.w * rotW)))
  const ch = Math.max(1, Math.min(rotH - cy, Math.round(box.h * rotH)))

  let cropped: Uint8ClampedArray
  if (cx === 0 && cy === 0 && cw === rotW && ch === rotH) {
    cropped = rotBuf === rgba ? new Uint8ClampedArray(rgba) : rotBuf
  } else {
    cropped = new Uint8ClampedArray(cw * ch * 4)
    for (let y = 0; y < ch; y++) {
      const srcRow = ((cy + y) * rotW + cx) * 4
      const dstRow = y * cw * 4
      cropped.set(rotBuf.subarray(srcRow, srcRow + cw * 4), dstRow)
    }
  }

  const finalBuf = opts?.docEnhance ? enhanceDocumentPixels(cropped, cw, ch) : cropped
  return { rgba: finalBuf, width: cw, height: ch }
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || !document.createElement) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext ? c.getContext('2d') : null
  return ctx ? { c, ctx } : null
}

function encodeCanvasWithBudget(c: HTMLCanvasElement, budgetBytes: number, startQuality = JPEG_QUALITY): string {
  const qualities = [startQuality, 0.72, 0.60, 0.50]
  let last = ''
  for (const q of qualities) {
    last = c.toDataURL('image/jpeg', q)
    if (!last || last.length < 64) continue
    if (approxDataUrlBytes(last) <= budgetBytes) return last
  }
  return last
}

/**
 * Файл → data URL с умным сжатием под мобильную сеть и авто-режимом чёткости
 * для чеков/документов. Ошибку возвращаем значением, а не исключением.
 */
export async function fileToDataUrl(
  file: File,
  maxSide = MAX_SIDE,
  opts?: PhotoPrepOptions,
): Promise<PickedFile> {
  if (!file || !looksLikeImage({ name: file.name, type: file.type })) {
    return { ok: false, error: 'это не картинка' }
  }
  let url = ''
  try {
    url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''
    const img = await load(url, file)
    const w0 = img.width || 0
    const h0 = img.height || 0
    if (!w0 || !h0) return { ok: false, error: 'картинка не читается' }

    // Быстрая проба 256 px на распознавание документа/чека, если режим auto.
    let isDoc = opts?.mode === 'doc'
    if (opts?.mode !== 'photo' && opts?.mode !== 'doc') {
      const probeScale = Math.min(1, 256 / Math.max(w0, h0))
      const pw = Math.max(1, Math.round(w0 * probeScale))
      const ph = Math.max(1, Math.round(h0 * probeScale))
      const probe = makeCanvas(pw, ph)
      if (probe && typeof probe.ctx.getImageData === 'function') {
        try {
          probe.ctx.drawImage(img, 0, 0, pw, ph)
          const id = probe.ctx.getImageData(0, 0, pw, ph)
          if (id && id.data) isDoc = detectDocumentLike(id.data, pw, ph)
        } catch {
          /* окружение без getImageData — идём стандартным путём */
        }
      }
    }

    const targetMaxSide = isDoc && maxSide === MAX_SIDE ? DOC_MAX_SIDE : maxSide
    const k = Math.min(1, targetMaxSide / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * k))
    const h = Math.max(1, Math.round(h0 * k))
    const made = makeCanvas(w, h)
    if (!made) {
      if (typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close()
      return { ok: false, error: 'браузер не умеет сжимать картинки' }
    }
    made.ctx.drawImage(img, 0, 0, w, h)

    // Если нужен рабочий исходник для ручного кадрирования — сохраняем до фильтра.
    let sourceDataUrl: string | undefined
    if (opts?.keepSource) {
      const sk = Math.min(1, EDIT_SOURCE_SIDE / Math.max(w0, h0))
      const sw = Math.max(1, Math.round(w0 * sk))
      const sh = Math.max(1, Math.round(h0 * sk))
      const srcCanvas = makeCanvas(sw, sh)
      if (srcCanvas) {
        srcCanvas.ctx.drawImage(img, 0, 0, sw, sh)
        sourceDataUrl = srcCanvas.c.toDataURL('image/jpeg', 0.86)
      }
    }
    if (typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close()

    if (isDoc && typeof made.ctx.getImageData === 'function' && typeof made.ctx.putImageData === 'function') {
      try {
        const frame = made.ctx.getImageData(0, 0, w, h)
        if (frame && frame.data) {
          const enhanced = enhanceDocumentPixels(frame.data, w, h)
          frame.data.set(enhanced)
          made.ctx.putImageData(frame, 0, 0)
        }
      } catch {
        /* оставляем исходную отрисовку */
      }
    }

    const slow = opts?.slowNet ?? isSlowMobileNetwork()
    const budget = isDoc
      ? DOC_BUDGET_BYTES
      : slow
        ? SLOW_NET_BUDGET_BYTES
        : PHOTO_BUDGET_BYTES
    const dataUrl = encodeCanvasWithBudget(made.c, budget, isDoc ? 0.85 : JPEG_QUALITY)
    if (!dataUrl || dataUrl.length < 64) return { ok: false, error: 'не получилось сжать' }
    if (dataUrl.length > MAX_DATAURL_CHARS) return { ok: false, error: 'слишком тяжёлая картинка' }

    const origBytes = Number(file.size) || approxDataUrlBytes(dataUrl)
    const sentBytes = approxDataUrlBytes(dataUrl)
    const savedPct = origBytes > sentBytes ? Math.round(((origBytes - sentBytes) / origBytes) * 100) : 0
    return {
      ok: true,
      dataUrl,
      meta: {
        origBytes,
        sentBytes,
        savedPct,
        width: w,
        height: h,
        isDoc,
        sourceDataUrl: sourceDataUrl || dataUrl,
      },
    }
  } catch (e) {
    const heic = /hei[cf]$/i.test(file.name || '') || /hei[cf]/.test(file.type || '')
    return {
      ok: false,
      error: heic
        ? 'HEIC (формат iPhone) браузер не открывает — включите «Совместимые форматы» в настройках камеры или пришлите JPEG'
        : (e as Error)?.message || 'картинка не прочитана',
    }
  } finally {
    if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url)
  }
}

/**
 * Применяет поворот, кадрирование и режим «Чек / документ» к уже загруженному
 * кадру в браузере (для окна подготовки перед отправкой).
 */
export async function renderPreparedShot(
  sourceDataUrl: string,
  opts: { rotate?: number; crop?: Partial<CropBox>; docEnhance?: boolean; origBytes?: number },
): Promise<{ ok: true; dataUrl: string; meta: ShotMeta } | { ok: false; error: string }> {
  try {
    if (!sourceDataUrl || typeof Image !== 'function') {
      return { ok: false, error: 'нет исходного кадра для обработки' }
    }
    const im = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image()
      el.onload = () => res(el)
      el.onerror = () => rej(new Error('исходный кадр не прочитан'))
      el.src = sourceDataUrl
    })
    const w0 = im.naturalWidth || im.width || 0
    const h0 = im.naturalHeight || im.height || 0
    if (!w0 || !h0) return { ok: false, error: 'пустой кадр' }

    const base = makeCanvas(w0, h0)
    if (!base) return { ok: false, error: 'холст недоступен' }
    base.ctx.drawImage(im, 0, 0, w0, h0)
    const raw = base.ctx.getImageData(0, 0, w0, h0)
    const transformed = transformPixels(raw.data, w0, h0, {
      rotate: opts.rotate,
      crop: opts.crop,
      docEnhance: false,
    })

    const maxSide = opts.docEnhance ? DOC_MAX_SIDE : MAX_SIDE
    const scale = Math.min(1, maxSide / Math.max(transformed.width, transformed.height))
    const fw = Math.max(1, Math.round(transformed.width * scale))
    const fh = Math.max(1, Math.round(transformed.height * scale))

    const tmp = makeCanvas(transformed.width, transformed.height)
    const out = makeCanvas(fw, fh)
    if (!tmp || !out) return { ok: false, error: 'холст недоступен' }
    const tmpData = tmp.ctx.createImageData(transformed.width, transformed.height)
    tmpData.data.set(transformed.rgba)
    tmp.ctx.putImageData(tmpData, 0, 0)
    out.ctx.drawImage(tmp.c, 0, 0, fw, fh)

    if (opts.docEnhance) {
      const fData = out.ctx.getImageData(0, 0, fw, fh)
      fData.data.set(enhanceDocumentPixels(fData.data, fw, fh))
      out.ctx.putImageData(fData, 0, 0)
    }

    const budget = opts.docEnhance ? DOC_BUDGET_BYTES : isSlowMobileNetwork() ? SLOW_NET_BUDGET_BYTES : PHOTO_BUDGET_BYTES
    const dataUrl = encodeCanvasWithBudget(out.c, budget, opts.docEnhance ? 0.85 : JPEG_QUALITY)
    const sentBytes = approxDataUrlBytes(dataUrl)
    const origBytes = opts.origBytes || approxDataUrlBytes(sourceDataUrl)
    const savedPct = origBytes > sentBytes ? Math.round(((origBytes - sentBytes) / origBytes) * 100) : 0
    return {
      ok: true,
      dataUrl,
      meta: {
        origBytes,
        sentBytes,
        savedPct,
        width: fw,
        height: fh,
        isDoc: Boolean(opts.docEnhance),
        sourceDataUrl,
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'не удалось обработать кадр' }
  }
}

/**
 * По исходнику определяет автоматические границы листа/чека (с учётом текущего поворота).
 */
export async function detectBoundsFromDataUrl(sourceDataUrl: string, rotate = 0): Promise<CropBox> {
  try {
    if (!sourceDataUrl || typeof Image !== 'function') return { x: 0, y: 0, w: 1, h: 1 }
    const im = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image()
      el.onload = () => res(el)
      el.onerror = () => rej(new Error('err'))
      el.src = sourceDataUrl
    })
    const k = Math.min(1, 320 / Math.max(im.width || 1, im.height || 1))
    const w = Math.max(16, Math.round((im.width || 1) * k))
    const h = Math.max(16, Math.round((im.height || 1) * k))
    const c = makeCanvas(w, h)
    if (!c) return { x: 0, y: 0, w: 1, h: 1 }
    c.ctx.drawImage(im, 0, 0, w, h)
    const id = c.ctx.getImageData(0, 0, w, h)
    const rot = transformPixels(id.data, w, h, { rotate })
    return autoFindContentBounds(rot.rgba, rot.width, rot.height)
  } catch {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
}

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

async function load(objectUrl: string, file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function' && file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch {
      try {
        return await createImageBitmap(file)
      } catch {
        /* переходим на <img> */
      }
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
