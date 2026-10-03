/**
 * Двухколоночное окно выбора модели — витрина по семействам ИИ + живой каталог,
 * карточка модели справа (контекст, ток/с, счётчик запросов) и опции «Думает» + «Усилие».
 */
import { useEffect, useMemo, useState } from 'react'
import { Activity, Check, Eye, RefreshCw, Sparkles, Zap } from 'lucide-react'
import { ModelIcon } from './ModelIcon'
import {
  EFFORT_LABELS,
  MODEL_AUTO,
  MODELS,
  avatarFor,
  braveLine,
  canModelEffort,
  canModelThink,
  catalogCache,
  ceilingsLine,
  formatContextBadge,
  getModelTelemetry,
  loadCatalog,
  providerLabel,
  refreshCatalog,
  vendorCategory,
  type CatalogEntry,
  type ModelAvatar,
  type ModelCatalog,
  type ReasoningEffort,
} from '../lib/models'
import { haptic } from '../lib/haptic'

interface Row {
  id: string
  name: string
  vendor: string
  category: string
  desc: string
  fullDesc: string
  vision: boolean
  avatar: ModelAvatar
  group: 'top' | 'pool' | 'cat'
  hint: string
  prov: string
  flags: string[]
  ctx: number
  tokPerSec: number
  canThink: boolean
  supportsEffort: boolean
}

const PER_GROUP = 120

const AV_TOP: ModelAvatar = { bg: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)', mark: 'Me' }

function fromShowcase(): Row[] {
  return [MODEL_AUTO, ...MODELS].map((m) => ({
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    category: m.category || vendorCategory(m.id, m.vendor, m.name),
    desc: m.desc,
    fullDesc: m.desc,
    vision: !!m.vision,
    avatar: m.avatar || AV_TOP,
    group: 'top' as const,
    hint: m.vendor,
    prov: '',
    flags: [],
    ctx: m.ctx || 131072,
    tokPerSec: m.tokPerSec || (m.tier === 'smart' ? 110 : 165),
    canThink: canModelThink(m.id, m),
    supportsEffort: canModelEffort(m.id, m),
  }))
}

function build(cat: ModelCatalog | null): Row[] {
  const top = fromShowcase()
  if (!cat) return top
  const known = new Set(top.map((r) => r.id))
  const pool: Row[] = []
  const rest: Row[] = []
  for (const m of cat.models as CatalogEntry[]) {
    if (known.has(m.id)) continue
    const flags = [
      m.tools ? 'инструменты' : '',
      m.reasoning ? 'рассуждает' : '',
      m.uncensored ? 'без купюр' : '',
      braveLine(m),
      m.priceKnown === false ? 'цена не проверена' : '',
    ].filter(Boolean) as string[]
    const ceil = ceilingsLine(m)
    const think = canModelThink(m.id, m)
    const row: Row = {
      id: m.id,
      name: m.name || m.id,
      vendor: m.vendor || '',
      category: vendorCategory(m.id, m.vendor, m.name),
      desc: ceil || (m.desc ? m.desc.slice(0, 70) : ''),
      fullDesc: m.desc || ceil || 'Доступная модель из каталога провайдера',
      vision: m.vision === true,
      avatar: avatarFor(m),
      group: m.curated ? 'pool' : 'cat',
      hint: [m.vendor, m.tier === 'smart' ? 'умная' : ''].filter(Boolean).join(' · '),
      prov: providerLabel(m.src),
      flags,
      ctx: m.ctx || 131072,
      tokPerSec: m.src === 'groq' || m.src === 'cerebras' ? 240 : m.tier === 'smart' ? 105 : 150,
      canThink: think,
      supportsEffort: canModelEffort(m.id, m),
    }
    ;(m.curated ? pool : rest).push(row)
  }
  return [...top, ...pool, ...rest]
}

const hhmm = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''

export interface ModelPickerProps {
  model: string
  onPick: (id: string) => void
  reasoningOn?: boolean
  onToggleReasoning?: () => void
  effort?: ReasoningEffort
  onEffortChange?: (effort: ReasoningEffort) => void
}

const EFFORT_ITEMS: { id: ReasoningEffort; label: string }[] = [
  { id: 'low', label: 'Низкое' },
  { id: 'medium', label: 'Среднее' },
  { id: 'high', label: 'Высокое' },
]

export function ModelPicker({
  model,
  onPick,
  reasoningOn = true,
  onToggleReasoning,
  effort = 'medium',
  onEffortChange,
}: ModelPickerProps) {
  const [cat, setCat] = useState<ModelCatalog | null>(catalogCache())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (cat) return
    let live = true
    loadCatalog().then((c) => {
      if (live) setCat(c)
    })
    return () => {
      live = false
    }
  }, [])

  const rows = useMemo(() => build(cat), [cat])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s) {
      return rows.filter((r) =>
        (r.id + ' ' + r.name + ' ' + r.category + ' ' + r.hint + ' ' + r.prov).toLowerCase().includes(s),
      )
    }
    const take = new Map<Row['group'], number>()
    const out: Row[] = []
    for (const r of rows) {
      const n = take.get(r.group) || 0
      if (r.group !== 'top' && n >= PER_GROUP && r.id !== model) continue
      take.set(r.group, n + 1)
      out.push(r)
    }
    return out
  }, [rows, q, model])
  const hidden = rows.length - shown.length

  const counts = useMemo(() => {
    const inPool = rows.filter((r) => r.group === 'pool').length
    const fromCat = rows.filter((r) => r.group === 'cat').length
    return { inPool, fromCat, total: rows.length }
  }, [rows])

  const activeRow = useMemo(() => {
    return rows.find((r) => r.id === model) || rows[0]
  }, [rows, model])

  const telemetry = useMemo(
    () => getModelTelemetry(activeRow.id, activeRow.tokPerSec),
    [activeRow.id, activeRow.tokPerSec],
  )

  const upd = async () => {
    setBusy(true)
    const c = await refreshCatalog()
    setCat(c)
    setBusy(false)
  }

  let lastGroup: Row['group'] | null = null
  let lastCategory = ''
  const searching = !!q.trim()

  const rowThinkingBadge = (r: Row): string => {
    if (!r.canThink) return ''
    if (!reasoningOn) return 'Выкл.'
    return r.supportsEffort ? EFFORT_LABELS[effort] : 'Думает'
  }

  return (
    <div className="model-panel model-panel-split" role="listbox" aria-label="Модель ответа">
      <div className="model-split-body">
        {/* Левая колонка: поиск + список моделей по категориям ИИ */}
        <div className="model-col-list">
          <div className="model-search-wrap">
            <input
              className="model-search"
              type="search"
              inputMode="search"
              placeholder={cat ? `Поиск моделей... (поиск по ${counts.total} моделям)` : 'Поиск моделей... (поиск по витрине)'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Поиск модели"
            />
            <button
              type="button"
              className="model-refresh"
              onClick={upd}
              disabled={busy}
              title={cat ? 'Каталог обновлён ' + (hhmm(cat.updatedAt) || '—') : 'Обновить список моделей у провайдеров'}
            >
              <RefreshCw size={12} className={busy ? 'is-spin' : ''} />
              <span className="model-refresh-txt">{busy ? 'обновляю' : 'обновить'}</span>
            </button>
          </div>

          <div className="model-list-scroll">
            {shown.map((r) => {
              const selected = r.id === model
              const groupChanged = !searching && r.group !== lastGroup
              if (groupChanged) {
                lastGroup = r.group
                lastCategory = ''
              }
              const catChanged = !searching && r.category !== lastCategory
              lastCategory = r.category
              const groupLabel =
                r.group === 'pool'
                  ? `Пулы движка · ${counts.inPool}`
                  : r.group === 'cat'
                    ? `Каталог провайдеров · ${counts.fromCat}`
                    : 'Витрина'
              const stateText = rowThinkingBadge(r)

              return (
                <div key={r.id || 'auto'}>
                  {groupChanged ? <div className="model-section-title">{groupLabel}</div> : null}
                  {catChanged ? <div className="model-vendor-title">{r.category}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`model-row${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      haptic('light')
                      onPick(r.id)
                    }}
                  >
                    <ModelIcon id={r.id} vendor={r.vendor} name={r.name} avatar={r.avatar} className="m-av-row" />
                    <span className="model-row-text">
                      <span className="model-row-name">
                        <span className="model-row-title">{r.name}</span>
                        {r.vision ? <Eye size={12} className="vision-ic" aria-label="видит картинки" /> : null}
                      </span>
                      <span className="model-row-desc">
                        {[r.prov, r.desc || r.hint].filter(Boolean).join(' · ')}
                        {r.flags.length ? <span className="model-row-flags"> {r.flags.join(' · ')}</span> : null}
                      </span>
                    </span>
                    {stateText ? <span className="model-row-state">{stateText}</span> : null}
                    {selected ? <Check size={15} className="model-check" /> : null}
                  </button>
                </div>
              )
            })}
            {searching && !shown.length ? <div className="model-empty">ни одна модель не подошла</div> : null}
          </div>
        </div>

        {/* Правая колонка: сведения о модели, контекст, ток/с, счётчик запросов и опции «Думает» / «Усилие» */}
        <div className="model-col-detail">
          <div className="model-detail-head">
            <div className="model-detail-title-row">
              <ModelIcon
                id={activeRow.id}
                vendor={activeRow.vendor}
                name={activeRow.name}
                avatar={activeRow.avatar}
                className="m-av-detail"
              />
              <span className="model-detail-name">{activeRow.name}</span>
            </div>
            <p className="model-detail-desc">{activeRow.fullDesc}</p>
            <div className="model-detail-stats" aria-label="Характеристики модели">
              <span className="model-stat-context">{formatContextBadge(activeRow.ctx)}</span>
              <span className="model-stat-chip" title="Средняя скорость генерации токенов">
                <Zap size={11} /> ~{telemetry.tokPerSec} ток/с
              </span>
              <span className="model-stat-chip" title="Счётчик выполненных запросов">
                <Activity size={11} /> Запросов: {telemetry.requests}
              </span>
            </div>
          </div>

          {activeRow.canThink ? (
            <div className="model-detail-opts">
              <div className="model-opts-label">ОПЦИИ</div>
              <div className="model-think-row">
                <span className="model-think-title">
                  <Sparkles size={15} className="model-think-ic" />
                  Думает
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!reasoningOn}
                  aria-label="Режим Думает"
                  className={`ios-switch${reasoningOn ? ' is-on' : ''}`}
                  onClick={() => {
                    haptic('light')
                    onToggleReasoning?.()
                  }}
                >
                  <span className="ios-switch-thumb" />
                </button>
              </div>

              {activeRow.supportsEffort && reasoningOn ? (
                <div className="model-effort-block">
                  <div className="model-opts-label">УСИЛИЕ</div>
                  <div className="model-effort-list">
                    {EFFORT_ITEMS.map((item) => {
                      const isCur = effort === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`model-effort-btn${isCur ? ' is-active' : ''}`}
                          onClick={() => {
                            haptic('select')
                            onEffortChange?.(item.id)
                          }}
                        >
                          <span>{item.label}</span>
                          {isCur ? <Check size={15} className="model-effort-check" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="model-detail-opts is-non-thinking">
              <div className="model-opts-label">РЕЖИМ ОТВЕТА</div>
              <div className="model-direct-note">
                Прямой ответ без задержки на внутренние рассуждения
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="model-panel-foot">
        {cat
          ? `${counts.total} моделей · обновлено ${hhmm(cat.updatedAt) || 'только что'}${cat.stale ? ' · устарело' : ''}`
          : 'витрина: 19 · каталог недоступен'}
        {cat && cat.catalogCount ? ` · живых у провайдеров: ${cat.catalogCount}` : ''}
        {hidden > 0 ? ` · показаны не все (ещё ${hidden}) — наберите имя` : ''}
      </div>
    </div>
  )
}
