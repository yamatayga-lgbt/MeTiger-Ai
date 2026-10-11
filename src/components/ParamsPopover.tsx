import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_GEN_PARAMS, type GenParams } from '../lib/models'
import { haptic } from '../lib/haptic'

interface ParamsPopoverProps {
  params: GenParams
  onChange: (next: GenParams) => void
  /** Закрыть панель. Нужна для жеста: потянул полоску вниз — панель сложилась. */
  onClose?: () => void
}

/** Сколько пальцем надо потянуть полоску вниз, чтобы панель сложилась. */
const CLOSE_AFTER_PX = 64

const MAX_TOKENS_SLIDER_TOP = 8192
const MAX_TOKENS_SLIDER_MIN = 256

export function ParamsPopover({ params, onChange, onClose }: ParamsPopoverProps) {
  /* Жест «потянуть полоску вниз = закрыть» (0.159). Владелец показал на серую
     линию сверху панели: она выглядела ручкой, но ничем не управляла — теперь
     пальцем за неё панель складывается, как шторка. Тянем только за полоску и
     за строку с надписью (там, где нет кнопки «Сброс»), чтобы не мешать
     прокрутке содержимого и нажатиям на ползунки. */
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startY = useRef<number | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    startY.current = e.clientY
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return
    /* Вверх тянется с сопротивлением: панель уезжает к верхнему краю только чуть-чуть,
       намекая, что это не то направление. */
    const dy = e.clientY - startY.current
    setDragY(dy >= 0 ? dy : dy * 0.25)
  }

  const finishDrag = () => {
    if (startY.current === null) return
    const dy = dragY
    startY.current = null
    setDragging(false)
    setDragY(0)
    if (dy > CLOSE_AFTER_PX && onClose) {
      haptic('light')
      onClose()
    }
  }

  const tempPct = Math.round(((params.temperature - 0) / 2) * 100)
  const sliderTokVal = params.maxTokens <= 0 ? MAX_TOKENS_SLIDER_TOP : Math.min(MAX_TOKENS_SLIDER_TOP, Math.max(MAX_TOKENS_SLIDER_MIN, params.maxTokens))
  const tokPct = Math.round(((sliderTokVal - MAX_TOKENS_SLIDER_MIN) / (MAX_TOKENS_SLIDER_TOP - MAX_TOKENS_SLIDER_MIN)) * 100)
  const topPPct = Math.round(((params.topP - 0.05) / (1 - 0.05)) * 100)
  const presPct = Math.round(((params.presencePenalty - -2) / 4) * 100)
  const freqPct = Math.round(((params.frequencyPenalty - -2) / 4) * 100)

  return (
    <div
      className={`params-popover${dragging ? ' is-dragging' : ''}`}
      role="dialog"
      aria-label="Параметры генерации"
      style={dragY ? ({ transform: `translateY(${dragY}px)` } as CSSProperties) : undefined}
    >
      {/* Полоска-ручка: за неё панель складывается пальцем вниз. Область захвата
          выше самой полоски (палец в 4px не попадает) — отсюда .params-grab. */}
      <div
        className="params-grab"
        role="button"
        aria-label="Потянуть вниз, чтобы закрыть"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span className="params-handle" aria-hidden="true" />
      </div>
      <div
        className="params-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span className="params-title">ПАРАМЕТРЫ</span>
        <button
          type="button"
          className="params-reset"
          onClick={() => {
            haptic('light')
            onChange({ ...DEFAULT_GEN_PARAMS })
          }}
        >
          <RotateCcw size={13} />
          Сброс
        </button>
      </div>

      {/* 1. temperature */}
      <div className="params-group">
        <div className="params-row-head">
          <span className="params-key">temperature</span>
          <span className="params-val">{params.temperature.toFixed(1)}</span>
        </div>
        <input
          type="range"
          className="params-slider"
          min={0}
          max={2}
          step={0.1}
          value={params.temperature}
          style={{ '--pct': `${tempPct}%` } as CSSProperties}
          aria-label="temperature"
          onChange={(e) => {
            onChange({ ...params, temperature: Number(e.target.value) })
          }}
        />
        <div className="params-hint">Случайность ответа</div>
      </div>

      {/* 2. max_tokens */}
      <div className="params-group">
        <div className="params-row-head">
          <span className="params-key">max_tokens</span>
          <span className="params-val">{params.maxTokens <= 0 ? 'Макс.' : String(params.maxTokens)}</span>
        </div>
        <input
          type="range"
          className="params-slider"
          min={MAX_TOKENS_SLIDER_MIN}
          max={MAX_TOKENS_SLIDER_TOP}
          step={256}
          value={sliderTokVal}
          style={{ '--pct': `${tokPct}%` } as CSSProperties}
          aria-label="max_tokens"
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange({ ...params, maxTokens: v >= MAX_TOKENS_SLIDER_TOP ? 0 : v })
          }}
        />
        <div className="params-hint">Максимальная длина ответа</div>
      </div>

      {/* 3. top_p */}
      <div className="params-group">
        <div className="params-row-head">
          <span className="params-key">top_p</span>
          <span className="params-val">{params.topP.toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="params-slider"
          min={0.05}
          max={1}
          step={0.05}
          value={params.topP}
          style={{ '--pct': `${topPPct}%` } as CSSProperties}
          aria-label="top_p"
          onChange={(e) => {
            onChange({ ...params, topP: Number(e.target.value) })
          }}
        />
        <div className="params-hint">Сужает круг слов-кандидатов</div>
      </div>

      {/* 4. presence_penalty */}
      <div className="params-group">
        <div className="params-row-head">
          <span className="params-key">presence_penalty</span>
          <span className="params-val">{params.presencePenalty.toFixed(1)}</span>
        </div>
        <input
          type="range"
          className="params-slider"
          min={-2}
          max={2}
          step={0.1}
          value={params.presencePenalty}
          style={{ '--pct': `${presPct}%` } as CSSProperties}
          aria-label="presence_penalty"
          onChange={(e) => {
            onChange({ ...params, presencePenalty: Number(e.target.value) })
          }}
        />
        <div className="params-hint">Выше нуля — реже вернётся к уже раскрытой теме целиком</div>
      </div>

      {/* 5. frequency_penalty */}
      <div className="params-group">
        <div className="params-row-head">
          <span className="params-key">frequency_penalty</span>
          <span className="params-val">{params.frequencyPenalty.toFixed(1)}</span>
        </div>
        <input
          type="range"
          className="params-slider"
          min={-2}
          max={2}
          step={0.1}
          value={params.frequencyPenalty}
          style={{ '--pct': `${freqPct}%` } as CSSProperties}
          aria-label="frequency_penalty"
          onChange={(e) => {
            onChange({ ...params, frequencyPenalty: Number(e.target.value) })
          }}
        />
        <div className="params-hint">Выше нуля — реже повторяет одни и те же слова и фразы</div>
      </div>
    </div>
  )
}
