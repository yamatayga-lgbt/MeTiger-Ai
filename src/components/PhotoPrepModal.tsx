import { useEffect, useRef, useState } from 'react'
import { Check, Maximize2, RotateCcw, RotateCw, ScanText, X } from 'lucide-react'
import { fileSize } from '../lib/api'
import { haptic } from '../lib/haptic'
import {
  approxDataUrlBytes,
  detectBoundsFromDataUrl,
  normalizeCropBox,
  renderPreparedShot,
  type CropBox,
  type ShotMeta,
} from '../lib/images'

interface PhotoPrepModalProps {
  sourceDataUrl: string
  initialDoc: boolean
  origBytes: number
  onApply: (dataUrl: string, meta: ShotMeta) => void
  onClose: () => void
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null

export function PhotoPrepModal({
  sourceDataUrl,
  initialDoc,
  origBytes,
  onApply,
  onClose,
}: PhotoPrepModalProps) {
  const [rotate, setRotate] = useState(0)
  const [docMode, setDocMode] = useState(initialDoc)
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, w: 1, h: 1 })
  const [previewUrl, setPreviewUrl] = useState(sourceDataUrl)
  const [estBytes, setEstBytes] = useState(() => approxDataUrlBytes(sourceDataUrl))
  const [busy, setBusy] = useState(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    handle: DragHandle
    startX: number
    startY: number
    startCrop: CropBox
  } | null>(null)

  // Перерисовка превью после поворота (рамка кадрирования живёт поверх уже повёрнутого кадра).
  useEffect(() => {
    let alive = true
    void renderPreparedShot(sourceDataUrl, {
      rotate,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      docEnhance: docMode,
      origBytes,
    }).then((res) => {
      if (!alive || !res.ok) return
      setPreviewUrl(res.dataUrl)
      const areaRatio = Math.max(0.12, crop.w * crop.h)
      setEstBytes(Math.max(8 * 1024, Math.round(res.meta.sentBytes * Math.pow(areaRatio, 0.78))))
    })
    return () => { alive = false }
  }, [sourceDataUrl, rotate, docMode, origBytes])

  useEffect(() => {
    const areaRatio = Math.max(0.12, crop.w * crop.h)
    const base = approxDataUrlBytes(previewUrl)
    setEstBytes(Math.max(8 * 1024, Math.round(base * Math.pow(areaRatio, 0.78))))
  }, [crop.w, crop.h, previewUrl])

  const startDrag = (handle: DragHandle, e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    const el = stageRef.current
    if (!d || !d.handle || !el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dx = (e.clientX - d.startX) / rect.width
    const dy = (e.clientY - d.startY) / rect.height
    const s = d.startCrop

    if (d.handle === 'move') {
      const nx = Math.max(0, Math.min(1 - s.w, s.x + dx))
      const ny = Math.max(0, Math.min(1 - s.h, s.y + dy))
      setCrop({ x: nx, y: ny, w: s.w, h: s.h })
      return
    }

    let x0 = s.x
    let y0 = s.y
    let x1 = s.x + s.w
    let y1 = s.y + s.h
    if (d.handle === 'nw' || d.handle === 'sw') x0 = Math.max(0, Math.min(x1 - 0.12, s.x + dx))
    if (d.handle === 'ne' || d.handle === 'se') x1 = Math.min(1, Math.max(x0 + 0.12, s.x + s.w + dx))
    if (d.handle === 'nw' || d.handle === 'ne') y0 = Math.max(0, Math.min(y1 - 0.12, s.y + dy))
    if (d.handle === 'sw' || d.handle === 'se') y1 = Math.min(1, Math.max(y0 + 0.12, s.y + s.h + dy))
    setCrop(normalizeCropBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }))
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const handleAutoCrop = async () => {
    haptic('light')
    const box = await detectBoundsFromDataUrl(sourceDataUrl, rotate)
    setCrop(box)
  }

  const handleApply = async () => {
    if (busy) return
    setBusy(true)
    haptic('medium')
    const res = await renderPreparedShot(sourceDataUrl, {
      rotate,
      crop,
      docEnhance: docMode,
      origBytes,
    })
    setBusy(false)
    if (res.ok) onApply(res.dataUrl, res.meta)
    else onClose()
  }

  const savedPct = origBytes > estBytes ? Math.round(((origBytes - estBytes) / origBytes) * 100) : 0

  return (
    <div className="photo-prep-backdrop" role="dialog" aria-modal="true" aria-label="Подготовка фото перед отправкой">
      <div className="photo-prep-sheet">
        <div className="photo-prep-head">
          <div className="photo-prep-info">
            <span className="photo-prep-title">Подготовка снимка</span>
            <span className="photo-prep-stats">
              {origBytes ? `${fileSize(origBytes)} → ` : ''}
              ~{fileSize(estBytes)}
              {savedPct > 5 ? ` (−${savedPct}%)` : ''}
              {docMode ? ' · Чек / мелкий текст' : ' · Обычное фото'}
            </span>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="photo-prep-stage-wrap">
          <div
            ref={stageRef}
            className="photo-prep-stage"
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img src={previewUrl} alt="Превью кадра" draggable={false} className="photo-prep-img" />
            <div
              className="photo-prep-crop"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
              onPointerDown={(e) => startDrag('move', e)}
            >
              <span className="crop-handle is-nw" onPointerDown={(e) => startDrag('nw', e)} />
              <span className="crop-handle is-ne" onPointerDown={(e) => startDrag('ne', e)} />
              <span className="crop-handle is-sw" onPointerDown={(e) => startDrag('sw', e)} />
              <span className="crop-handle is-se" onPointerDown={(e) => startDrag('se', e)} />
            </div>
          </div>
        </div>

        <div className="photo-prep-tools">
          <button
            type="button"
            className="photo-prep-pill"
            onClick={() => {
              haptic('light')
              setRotate((r) => (r + 90) % 360)
              setCrop({ x: 0, y: 0, w: 1, h: 1 })
            }}
          >
            <RotateCw size={15} />
            <span>90°</span>
          </button>

          <button type="button" className="photo-prep-pill" onClick={() => void handleAutoCrop()}>
            <Maximize2 size={15} />
            <span>Автокрая</span>
          </button>

          <button
            type="button"
            className={`photo-prep-pill${docMode ? ' is-active' : ''}`}
            onClick={() => {
              haptic('light')
              setDocMode((v) => !v)
            }}
          >
            <ScanText size={15} />
            <span>Чек / текст</span>
          </button>

          <button
            type="button"
            className="photo-prep-pill"
            onClick={() => {
              haptic('light')
              setRotate(0)
              setCrop({ x: 0, y: 0, w: 1, h: 1 })
              setDocMode(initialDoc)
            }}
          >
            <RotateCcw size={15} />
            <span>Сброс</span>
          </button>
        </div>

        <div className="photo-prep-foot">
          <button type="button" className="photo-prep-cancel" onClick={onClose}>
            Оставить как есть
          </button>
          <button type="button" className="photo-prep-apply" disabled={busy} onClick={() => void handleApply()}>
            <Check size={16} />
            <span>Готово</span>
          </button>
        </div>
      </div>
    </div>
  )
}
