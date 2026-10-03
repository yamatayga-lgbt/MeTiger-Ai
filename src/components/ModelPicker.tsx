/**
 * Окно выбора модели — витрина + живой каталог.
 *
 * Почему это отдельный компонент: список перестал быть «19 строк, вписанных
 * руками». В нём теперь то, что реально может ответить: пулы движка и бесплатные
 * модели OpenRouter/Xkiро с потолками. Разбивка по группам нужна, чтобы человек
 * видел разницу: «это я использую каждый день», «это есть у провайдера».
 *
 * Каталог грузится один раз на открытие панели; сеть молчит — остаются витрина
 * и обычная работа движка. Никаких спиннеров и ошибок человеку: выбор модели
 * не должен превращаться в отчёт о состоянии сети.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, RefreshCw } from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import {
  MODEL_AUTO,
  MODELS,
  avatarFor,
  braveLine,
  catalogCache,
  providerLabel,
  ceilingsLine,
  loadCatalog,
  refreshCatalog,
  type CatalogEntry,
  type ModelAvatar,
  type ModelCatalog,
} from '../lib/models'
import { haptic } from '../lib/haptic'

interface Row {
  id: string
  name: string
  desc: string
  vision: boolean
  avatar: ModelAvatar
  group: 'top' | 'pool' | 'cat'
  hint: string
  /** чей это id — показываем отдельным чипом: список вырос втрое и искать в нём
     «свою» модель без провайдера было бы слепо */
  prov: string
  /** чем модель хороша: инструменты, рассуждение, «без купюр», цена не проверена */
  flags: string[]
}

/** Сколько строк одной группы показываем без поиска: каталог вырос до сотен id,
    и молча рендерить 600 строк на слабом телефоне — способ подвесить панель. */
const PER_GROUP = 120

const AV_TOP: ModelAvatar = { bg: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)', mark: 'Me' }

function fromShowcase(): Row[] {
  return [MODEL_AUTO, ...MODELS].map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.desc,
    vision: !!m.vision,
    avatar: m.avatar || AV_TOP,
    group: 'top' as const,
    hint: m.vendor,
    prov: '',
    flags: [],
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
      /* опыт, а не обещание: «без купюр» из каталога — ярлык провайдера,
         а это — чем модель реально ответила на прошлой острой теме */
      braveLine(m),
      /* бесплатность у groq/mistral/gemini в списке не написана (тарифицируют
         токенами, «бесплатно» там означает «влезает в суточную квоту») — молчать
         об этом значит обещать то, чего каталог не подтверждает */
      m.priceKnown === false ? 'цена не проверена' : '',
    ].filter(Boolean) as string[]
    const row: Row = {
      id: m.id,
      name: m.name || m.id,
      desc: ceilingsLine(m) || (m.desc ? m.desc.slice(0, 70) : ''),
      vision: m.vision === true,
      avatar: avatarFor(m),
      group: m.curated ? 'pool' : 'cat',
      hint: [m.vendor, m.tier === 'smart' ? 'умная' : ''].filter(Boolean).join(' · '),
      prov: providerLabel(m.src),
      flags,
    }
    ;(m.curated ? pool : rest).push(row)
  }
  return [...top, ...pool, ...rest]
}

const hhmm = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''

export function ModelPicker({ model, onPick }: { model: string; onPick: (id: string) => void }) {
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
    // один раз на открытие: панель живёт ровно столько, сколько открыта
  }, [])

  const rows = useMemo(() => build(cat), [cat])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s) return rows.filter((r) => (r.id + ' ' + r.name + ' ' + r.hint + ' ' + r.prov).toLowerCase().includes(s))
    /* без поиска — по первых PER_GROUP в группе, «Авто» и витрина целиком */
    const take = new Map<Row['group'], number>()
    const out: Row[] = []
    for (const r of rows) {
      const n = take.get(r.group) || 0
      /* выбранный не должен пропадать из-за среза: иначе чип «Авто», а строки нет */
      if (r.group !== 'top' && n >= PER_GROUP && r.id !== model) continue
      take.set(r.group, n + 1)
      out.push(r)
    }
    return out
  }, [rows, q])
  const hidden = rows.length - shown.length

  const counts = useMemo(() => {
    const inPool = rows.filter((r) => r.group === 'pool').length
    const fromCat = rows.filter((r) => r.group === 'cat').length
    return { inPool, fromCat, total: rows.length }
  }, [rows])

  const upd = async () => {
    setBusy(true)
    const c = await refreshCatalog()
    setCat(c)
    setBusy(false)
  }

  let lastGroup: Row['group'] | null = null
  const searching = !!q.trim()

  return (
    <div className="model-panel" role="listbox" aria-label="Модель ответа">
      <div className="model-panel-head">
        <span className="model-panel-title">Модель ответа</span>
        <button
          type="button"
          className="model-refresh"
          onClick={upd}
          disabled={busy}
          title={cat ? 'Каталог обновлён ' + (hhmm(cat.updatedAt) || '—') : 'Обновить список моделей у провайдеров'}
        >
          <RefreshCw size={12} className={busy ? 'is-spin' : ''} />
          {busy ? 'обновляю' : 'обновить'}
        </button>
      </div>
      <input
        className="model-search"
        type="search"
        inputMode="search"
        placeholder={cat ? `поиск по ${counts.total} моделям` : 'поиск по витрине'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Поиск модели"
      />
      {shown.map((r) => {
        const selected = r.id === model
        const head = !searching && r.group !== lastGroup
        lastGroup = r.group
        const label =
          r.group === 'pool'
            ? `Пулы движка · ${counts.inPool}`
            : r.group === 'cat'
              ? `Каталог провайдеров · ${counts.fromCat}`
              : 'Витрина'
        return (
          <div key={r.id || 'auto'}>
            {head ? <div className="model-section-title">{label}</div> : null}
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
              <span className="m-av m-av-row" style={{ background: r.avatar.bg }}>
                {r.id === '' ? <img src={avatarUrl} alt="" className="m-av-img" /> : r.avatar.mark}
              </span>
              <span className="model-row-text">
                <span className="model-row-name">
                  {r.name}
                  {r.vision ? <Eye size={12} className="vision-ic" aria-label="видит картинки" /> : null}
                </span>
                <span className="model-row-desc">
                  {[r.prov, r.desc || r.hint].filter(Boolean).join(' · ')}
                  {r.flags.length ? <span className="model-row-flags"> {r.flags.join(' · ')}</span> : null}
                </span>
              </span>
              {selected ? <Check size={15} className="model-check" /> : null}
            </button>
          </div>
        )
      })}
      {searching && !shown.length ? <div className="model-empty">ни одна модель не подошла</div> : null}
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
