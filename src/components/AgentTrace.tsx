/**
 * Ход работы агента — одна лента шагов над ответом (0.229).
 *
 * ЗАЧЕМ. До этой версии подготовка ответа была разложена на пять независимых
 * блоков: «Думал N с», «Прочитал N файлов», «использовал веб-поиск», «Searching
 * the web», «Drawing the image». Каждый сворачивался сам по себе, жил в своём
 * месте и говорил на своём языке (половина — по-английски). Человек видел не
 * «как агент работал», а пять разных отчётов, между которыми надо было
 * догадываться о связи.
 *
 * ТЕПЕРЬ. Одна панель и один вертикальный след, как в агентских интерфейсах:
 *
 *   ▸ Думал 4 с · 3 шага                         ⌄
 *   │  ◌ Ищу в интернете «…»
 *   │  ✓ Прочитал report.docx · 12 000 знаков
 *   │  ✓ Открыл сайт example.com
 *   └  «сами мысли» — строкой ниже, с затуханием по краям
 *
 * Правила, по которым это живёт:
 *   1. Пока агент работает — панель раскрыта и шаги дописываются на глазах.
 *   2. Как только пошёл текст ответа — панель САМА сворачивается в одну строку
 *      с итогом. Ответ — главное; ход работы нужен, только пока его нет.
 *   3. Свернул/развернул человек сам — машина больше не лезет: его решение
 *      старше нашего.
 *   4. Всё по-русски: «Ищу», «Открыл», «Нарисовал», «Подумал». Английские
 *      «Searching the web» и «Channel 2 of 3» были заимствованием, а не решением.
 *   5. Мысли прокручиваются сами, но только пока человек не тронул колесо.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  Brush,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Loader2,
  Search,
  Wrench,
} from 'lucide-react'
import { TOOL_RU, pluralRu, type ImageStep, type WebStep } from '../lib/api'

export interface TraceRead {
  name: string
  ok: boolean
  line: string
}

export interface AgentTraceProps {
  /** Идёт работа: шаги дописываются, таймер тикает, панель раскрыта. */
  live?: boolean
  /** Сказанное моделью вслух (канал reasoning) — оно же «мысли». */
  reasoning?: string
  /** Сколько секунд модель думала (готовое сообщение). В живом режиме считаем сами. */
  thinkingSec?: number
  webSteps?: WebStep[]
  imgSteps?: ImageStep[]
  reads?: TraceRead[]
  readNotes?: string[]
  tools?: string[]
  /** Общее время ответа — из него берём «Работал N с», когда мыслей не было. */
  ms?: number
}

type Kind = 'think' | 'search' | 'open' | 'read' | 'draw' | 'tool'
type Status = 'running' | 'done' | 'failed'

interface Step {
  id: string
  kind: Kind
  label: string
  note?: string
  status: Status
  /** Пункты раскрытия: что именно нашлось. Пусто — строка не раскрывается. */
  items?: { text: string; href?: string }[]
}

/** Хост без www — в шаге «Открыл сайт» длинный адрес только мешает. */
function hostOf(url?: string): string {
  const raw = String(url || '')
  if (!raw) return 'страницу'
  try {
    return new URL(raw).host.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || raw
  }
}

export function AgentTrace({
  live = false,
  reasoning = '',
  thinkingSec,
  webSteps = [],
  imgSteps = [],
  reads = [],
  readNotes = [],
  tools = [],
  ms,
}: AgentTraceProps) {
  const steps = buildSteps({ webSteps, imgSteps, reads, tools, live })

  /* Секунды: у готового сообщения их дал движок, у живого — считаем сами.
     Таймер тикает только пока идёт работа: после ответа он замирает. */
  const [tickSec, setTickSec] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setTickSec((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [live])
  const measured = live ? Math.max(tickSec, 1) : Math.max(0, Math.round(thinkingSec || 0))
  const fallbackSec = Math.max(1, Math.round((reasoning || '').length / 180))
  const secs = measured || fallbackSec
  const totalMs = Math.max(0, Number(ms) || 0)
  const workedSec = Math.max(1, Math.round(totalMs / 1000))

  const hasThink = Boolean(reasoning.trim())
  const hasAny = hasThink || steps.length > 0
  /* Пустую ленту у готового ответа не показываем вовсе. А живую — показываем
     даже пустой: это скелетон «Думает…», он честно занимает место с первой
     секунды и не даёт ленте дёргаться, когда придёт первый шаг. */
  if (!hasAny && !live) return null

  /* Заголовок говорит о том, что человек ждёт:
     — пока идёт работа: «Думает…» (мысли) или «Работает…» (шаги без мыслей);
     — после: «Думал 4 с» или «Работал 4 с», плюс число шагов. */
  const head = live
    ? hasThink || !steps.length
      ? 'Думает…'
      : 'Работает…'
    : hasThink
      ? `Думал ${secs} с`
      : `Работал ${workedSec} с`
  const count = steps.length

  return (
    <TraceShell
      live={live}
      head={head}
      meta={count ? pluralRu(count, 'шаг', 'шага', 'шагов') : ''}
    >
      {(open) => (
        <>
          {steps.length ? (
            <div className="trace-steps">
              {steps.map((s) => (
                <TraceRow key={s.id} step={s} />
              ))}
            </div>
          ) : null}
          {/* Заметки о чтении — сразу под шагами, до мыслей: они объясняют
              шаги, а не продолжают рассуждение. */}
          {readNotes.length && open ? (
            <div className="trace-notes">{readNotes.join(' · ')}</div>
          ) : null}
          {hasThink && open ? (
            <TraceThought text={reasoning} live={live} />
          ) : null}
        </>
      )}
    </TraceShell>
  )
}

/**
 * Оболочка: заголовок-кнопка, анимированная линия «идёт работа» и тело,
 * которое раскрывается плавно (grid-template-rows 0fr → 1fr — единственный
 * способ анимировать высоту без замера пикселей в JS).
 */
function TraceShell({
  live,
  head,
  meta,
  children,
}: {
  live: boolean
  head: string
  meta: string
  children: (open: boolean) => React.ReactNode
}) {
  const [open, setOpen] = useState(live)
  const touched = useRef(false)
  const wasLive = useRef(live)

  useEffect(() => {
    if (wasLive.current === live) return
    wasLive.current = live
    /* Работа кончилась — сворачиваемся сами, но только если человек не решил
       иначе. Работа началась — раскрываемся. */
    if (touched.current) return
    setOpen(live ? true : false)
  }, [live])

  const toggle = () => {
    touched.current = true
    setOpen((v) => !v)
  }

  return (
    <section
      className={`trace${live ? ' is-live' : ''}${open ? ' is-open' : ''}`}
      /* aria-live только у живой ленты: у готового ответа объявлять нечего. */
      aria-live={live ? 'polite' : undefined}
    >
      <button
        type="button"
        className="trace-head"
        onClick={toggle}
        aria-expanded={open}
        aria-label={live ? 'Агент работает — показать ход' : `${head} — показать ход работы`}
      >
        <span className={`trace-orb${live ? ' is-live' : ''}`} aria-hidden="true">
          {live ? <Loader2 size={13} className="trace-spin" /> : <BrainCircuit size={14} />}
        </span>
        <span className={`trace-head-label${live ? ' is-shimmer' : ''}`}>{head}</span>
        {meta ? <span className="trace-head-meta">{meta}</span> : null}
        <ChevronDown size={14} className="trace-chev" aria-hidden="true" />
        {live ? <span className="trace-bar" aria-hidden="true" /> : null}
      </button>

      <div className="trace-body">
        <div className="trace-body-inner">{children(open)}</div>
      </div>
    </section>
  )
}

function TraceRow({ step }: { step: Step }) {
  const Icon = GLYPH[step.kind]
  /* mark + значок — одной связкой, название с примечанием — второй. Так на
     320 px название переносится внутри своей колонки, а не уезжает под иконки
     (первый заход это и показал: галочка с лупой стояли строкой отдельно,
     а запрос висел под ними). */
  const body = (
    <>
      <span className="trace-step-lead">
        <span className={`trace-mark is-${step.status}`} aria-hidden="true">
          {step.status === 'running' ? (
            <Loader2 size={12} className="trace-spin" />
          ) : step.status === 'failed' ? (
            <AlertTriangle size={12} />
          ) : (
            <Check size={12} />
          )}
        </span>
        <span className="trace-step-icon" aria-hidden="true">
          <Icon size={14} />
        </span>
      </span>
      <span className="trace-step-body">
        <span className="trace-step-label">{step.label}</span>
        {step.note ? <span className="trace-step-note">{step.note}</span> : null}
      </span>
      {step.items && step.items.length ? <ChevronDown size={12} className="trace-step-chev" /> : null}
    </>
  )

  if (!step.items || !step.items.length) {
    return <div className={`trace-step is-${step.status}`}>{body}</div>
  }
  return (
    <details className={`trace-step is-${step.status} is-expandable`}>
      <summary className="trace-step-summary">{body}</summary>
      <div className="trace-step-items">
        {step.items.map((it, i) =>
          it.href ? (
            <a key={i} href={it.href} target="_blank" rel="noopener noreferrer" className="trace-step-link">
              {it.text}
            </a>
          ) : (
            <span key={i} className="trace-step-item">
              {it.text}
            </span>
          ),
        )}
      </div>
    </details>
  )
}

/**
 * Сами мысли. Прокручиваются за хвостом, но только пока человек не тронул
 * список: иначе, отматывая назад почитать, он каждый кадр возвращался бы вниз.
 */
function TraceThought({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el || !live || !stuck.current) return
    el.scrollTop = el.scrollHeight
  }, [text, live])

  return (
    <div
      ref={ref}
      className={`trace-think${live ? ' is-live' : ''}`}
      onScroll={(e) => {
        const el = e.currentTarget
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      <span className="trace-think-text">{renderInline(text)}</span>
      {live ? <span className="trace-caret" aria-hidden="true" /> : null}
    </div>
  )
}

/** `код` — моноширинным чипом, «->» — стрелкой: мысли читаются, а не листаются. */
function renderInline(raw: string) {
  const normalized = raw.replace(/\s->\s/g, ' → ')
  const parts = normalized.split(/(`[^`\n]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="trace-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

const GLYPH: Record<Kind, typeof Search> = {
  think: BrainCircuit,
  search: Search,
  open: Globe,
  read: FileText,
  draw: Brush,
  tool: Wrench,
}

/**
 * Сборка шагов из того, что присылает движок. Порядок — как работал агент:
 * сначала «что прочитал из вложений», потом поиск и открытие сайтов, потом
 * нарисованное, потом инструменты.
 */
function buildSteps({
  webSteps,
  imgSteps,
  reads,
  tools,
  live,
}: {
  webSteps: WebStep[]
  imgSteps: ImageStep[]
  reads: TraceRead[]
  tools: string[]
  live: boolean
}): Step[] {
  const out: Step[] = []

  for (const [i, r] of reads.entries()) {
    out.push({
      id: `r${i}`,
      kind: 'read',
      label: `${r.ok ? 'Прочитал' : 'Не прочитал'} ${r.name}`,
      note: r.line || undefined,
      status: r.ok ? 'done' : 'failed',
    })
  }

  for (const [i, w] of webSteps.entries()) {
    const last = live && i === webSteps.length - 1
    if (w.kind === 'search') {
      out.push({
        id: `s${i}`,
        kind: 'search',
        label: last ? `Ищу в интернете «${w.query || ''}»` : `Искал в интернете «${w.query || ''}»`,
        status: last ? 'running' : 'done',
        items: Array.isArray(w.results)
          ? w.results.slice(0, 6).map((r) => ({ text: r.title || r.url || '', href: r.url }))
          : undefined,
      })
    } else {
      out.push({
        id: `f${i}`,
        kind: 'open',
        label: last ? `Открываю ${hostOf(w.url)}` : `Открыл ${hostOf(w.url)}`,
        note: w.title && w.title !== w.url ? w.title : undefined,
        status: last ? 'running' : 'done',
      })
    }
  }

  /* Картинка: строки каналов человеку не нужны — ему нужно «рисую» и честное
     «канал не ответил, пробую следующий». Имя канала наружу не идёт (0.177). */
  if (imgSteps.length) {
    let name = ''
    for (let i = imgSteps.length - 1; i >= 0; i--) {
      if (imgSteps[i].name) {
        name = imgSteps[i].name || ''
        break
      }
    }
    const edit = imgSteps.some((x) => x.state === 'start' && x.edit)
    const failed = imgSteps.filter((x) => x.state === 'failed').length
    const trying = imgSteps.some((x) => x.state === 'trying')
    const verb = edit ? 'Правлю' : 'Рисую'
    out.push({
      id: 'img',
      kind: 'draw',
      label: `${trying && live ? verb : edit ? 'Поправил' : 'Нарисовал'}${name ? ` «${name}»` : ''}`,
      note: failed ? `канал не ответил — пробую другой (${failed})` : undefined,
      status: trying && live ? 'running' : failed && !name ? 'failed' : 'done',
    })
  }

  /* Инструменты — по одному шагу на каждый: «Инструмент: погода» читается,
     а «использовал веб-поиск, калькулятор, погода» — нет. */
  const seen = new Set<string>()
  for (const t of tools) {
    if (seen.has(t)) continue
    seen.add(t)
    const ru = TOOL_RU[t] || t
    out.push({ id: `t${t}`, kind: 'tool', label: `Инструмент: ${ru}`, status: 'done' })
  }

  return out
}
