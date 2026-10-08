/**
 * Как формула выглядит на экране.
 *
 * Разбор — в src/lib/mathfmt.ts, здесь только рисование. Дроби стоят друг над
 * другом, корень рисуется знаком √ с чертой над подкоренным, степени — сверху
 * (и потому на телефоне чуть мельче: иначе строка «прыгает» по высоте).
 *
 * Никакого dangerouslySetInnerHTML: всё собирается React-элементами, как и
 * остальной ответ. Формула — это текст, и вести себя она должна как текст:
 * переноситься по строкам, увеличиваться вместе с размером шрифта в браузере,
 * попадать в выделение и копирование.
 */
import type { MathNode } from '../lib/mathfmt'
import { parseFormula } from '../lib/mathfmt'

interface Props {
  latex: string
  /** Отдельной строкой по центру (выключная формула) или в строке текста. */
  block?: boolean
}

export function Formula({ latex, block = false }: Props) {
  const nodes = parseFormula(latex)
  /* Формула без единого понятого знака — не рисунок, а текст: показываем как есть,
     чтобы человек видел именно то, что прислала модель, и ничего не потерял. */
  const unknown = nodes.length > 0 && nodes.every((n) => n.k === 'raw')
  return (
    <span
      className={`math-fx${block ? ' is-block' : ''}${unknown ? ' is-raw' : ''}`}
      /* Формула читается как формула: экранный диктор произносит её целиком,
         а не по кускам дробей и степеней. */
      role="math"
      aria-label={latex.trim()}
    >
      {nodes.map((n, i) => (
        <Node key={i} node={n} />
      ))}
    </span>
  )
}

function Node({ node }: { node: MathNode }) {
  switch (node.k) {
    case 'text':
      return <>{node.v}</>
    case 'var':
      return <i className="math-var">{node.v}</i>
    case 'op':
      return <span className="math-op">{node.v}</span>
    case 'raw':
      return <span className="math-unknown">{node.v}</span>
    case 'up':
      return (
        <span className="math-up">
          <Nodes nodes={node.v} />
        </span>
      )
    case 'b':
      return (
        <b>
          <Nodes nodes={node.v} />
        </b>
      )
    case 'i':
      return (
        <i>
          <Nodes nodes={node.v} />
        </i>
      )
    case 'sup':
      return (
        <sup className="math-sup">
          <Nodes nodes={node.v} />
        </sup>
      )
    case 'sub':
      return (
        <sub className="math-sub">
          <Nodes nodes={node.v} />
        </sub>
      )
    case 'space':
      return <span className="math-gap" style={{ width: `${node.v}em` }} />
    case 'frac':
      return (
        <span className={`math-frac${node.small ? ' is-small' : ''}`}>
          <span className="math-num">
            <Nodes nodes={node.a} />
          </span>
          <span className="math-den">
            <Nodes nodes={node.b} />
          </span>
        </span>
      )
    case 'binom':
      return (
        <span className="math-binom">
          <span className="math-binom-open">(</span>
          <span className="math-frac is-small">
            <span className="math-num">
              <Nodes nodes={node.a} />
            </span>
            <span className="math-den">
              <Nodes nodes={node.b} />
            </span>
          </span>
          <span className="math-binom-close">)</span>
        </span>
      )
    case 'sqrt':
      return (
        <span className="math-sqrt">
          {node.n ? (
            <span className="math-sqrt-n">
              <Nodes nodes={node.n} />
            </span>
          ) : null}
          <span className="math-radical" aria-hidden="true">
            √
          </span>
          <span className="math-radicand">
            <Nodes nodes={node.a} />
          </span>
        </span>
      )
    case 'over':
      return (
        <span className="math-over">
          <Nodes nodes={node.v} />
        </span>
      )
    case 'under':
      return (
        <span className="math-under">
          <Nodes nodes={node.v} />
        </span>
      )
    case 'rowbreak':
      /* Перенос строки вне окружения: формула просто переходит на новую строку.
         Так пишут длинные выкладки — «x=5±1 \\ отсюда x=3». */
      return <span className="math-br" aria-hidden="true" />
    case 'rows':
      return (
        <span className="math-rows">
          {node.open ? (
            <span className="math-brace" aria-hidden="true">
              {node.open}
            </span>
          ) : null}
          <span className="math-rows-body">
            {node.rows.map((row, i) => (
              <span className="math-row" key={i}>
                <Nodes nodes={row} />
              </span>
            ))}
          </span>
          {node.close ? (
            <span className="math-brace" aria-hidden="true">
              {node.close}
            </span>
          ) : null}
        </span>
      )
    case 'box':
      return (
        <span className="math-box">
          <Nodes nodes={node.v} />
        </span>
      )
    case 'accent':
      return (
        <span className="math-accent">
          <Nodes nodes={node.v} />
          <span className="math-accent-mark" aria-hidden="true">
            {node.mark}
          </span>
        </span>
      )
    default:
      return null
  }
}

function Nodes({ nodes }: { nodes: MathNode[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Node key={i} node={n} />
      ))}
    </>
  )
}
