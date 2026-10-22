import { memo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Download } from 'lucide-react'
import { CodeRunner } from './CodeRunner'
import { Formula } from './Formula'
import { remarkMathLite } from '../lib/remarkMath'
import { protectMath } from '../lib/mathfmt'
import { runnable, engineLabel } from '../lib/sandbox'

/* ============================================================
   Рендер ответа модели как настоящего Markdown, а не сырого текста.

   До этого компонента в чате распознавались только тройные ```кавычки``` —
   весь остальной Markdown (**жирный**, *курсив*, заголовки, списки, ссылки,
   таблицы, цитаты), который почти все бесплатные модели пишут по умолчанию,
   показывался человеку буквально, звёздочками и решётками. Разбирает текст
   remark (тот же движок, что у GitHub) — руками переизобретать разбор
   выделений рискованно: "2 * 2 = 4" легко случайно стать курсивом у
   самодельного регулярного выражения, а на проверенном парсере это не так.

   Дерево рендерится React-элементами напрямую (никакого dangerouslySetInnerHTML
   нигде) — безопасно по умолчанию, ссылки — обычные <a>, ни один тег вида
   <img onerror=...> не может исполнить код.

   Формулы (0.112): до этого ответ с `\\(\\sqrt{2}=\\frac{p}{q}\\)` показывался человеку
   ровно так — со слэшами и фигурными скобками. Теперь их находит и рисует свой
   плагин (src/lib/remarkMath.ts) с разбором на чистой функции (src/lib/mathfmt.ts):
   дроби стоят друг над другом, корень — со знаком √ и чертой. Блоки кода плагин
   не трогает по устройству дерева — `\\frac{a}{b}` в примере кода остаётся кодом.
   ============================================================ */

import { remarkCitations } from '../lib/cite'
interface Props {
  text: string
  /** Передать вывод исполненного кода обратно в чат (кнопка в CodeRunner). */
  onRunOutput?: (text: string) => void
  /** Источники ответа: сноски [n] в тексте становятся ссылками на sources[n-1] (0.133). */
  sources?: { url: string; title?: string }[]
}



/* memo — не украшение, а лечение лага печати: без него каждая буква в поле
   ввода пересобирала разметку ВСЕЙ переписки заново (разбор Markdown дорогой).
   Замер до: печать в поле — 42 fps в светлой теме и 33 в тёмной, кадры до 83 мс.
   Сравнение идёт по тексту и функции вывода; функцию вызывающая сторона держит
   стабильной (useCallback), иначе memo бесполезен. */
function CodeCard({ lang, raw, onRunOutput }: { lang: string; raw: string; onRunOutput?: (text: string) => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try {
      navigator.clipboard?.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard недоступен */ }
  }
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'code'}</span>
        <span className="code-head-right">
          <span>{runnable(lang) ? engineLabel(lang) : 'demo'}</span>
          <button type="button" className="code-copy-btn" onClick={copy} title="Скопировать код">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? 'Скопировано' : 'Копировать'}</span>
          </button>
        </span>
      </div>
      <pre>
        <code>{raw}</code>
      </pre>
      {runnable(lang) ? <CodeRunner code={raw} lang={lang} onSend={onRunOutput} /> : null}
    </div>
  )
}

function TableCard({ children }: { children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const exportCsv = () => {
    const tbl = wrapRef.current?.querySelector('table')
    if (!tbl) return
    const rows = Array.from(tbl.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((cell) => {
        let s = (cell.textContent || '').replace(/\s+/g, ' ').trim()
        if (/^[=+\-@]/.test(s)) s = "'" + s
        if (/[";\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
        return s
      }).join(';'),
    ).filter(Boolean)
    if (!rows.length) return
    const blob = new Blob(['\uFEFF' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'таблица.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return (
    <div className="md-table-wrap" ref={wrapRef}>
      <div className="md-table">
        <table>{children}</table>
      </div>
      <div className="md-table-actions">
        <button type="button" className="md-table-csv" onClick={exportCsv} title="Скачать таблицу для Excel">
          <Download size={12} /> Скачать CSV
        </button>
      </div>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text: rawText, onRunOutput, sources }: Props) {
  /* Формулы уходят из текста ДО разбора: на месте каждой остаётся метка, а сам LaTeX
     лежит в `hidden.items` и попадает в дерево как есть — ни разбор Markdown, ни его
     экранирование в него больше не вмешиваются (см. protectMath).
     Сноски же, наоборот, расставляются ПОСЛЕ разбора — плагином дерева: правка
     строки экранировала скобки `\[1\]`, а разбор формул принимал их за выключную
     формулу и рисовал цифру отдельной строкой по центру (0.230). */
  const hidden = protectMath(rawText)
  return (
    <div className="msg-text">
      <ReactMarkdown
        remarkPlugins={[remarkCitations(sources), remarkGfm, remarkMathLite(hidden.items)]}
        components={{
          /* Блок кода: та же карточка, что была раньше — язык, бейдж
             «песочница»/«demo», кнопка копирования и сама песочница, если язык исполняемый. */
          pre({ children }: { children?: ReactNode }) {
            const codeEl = Array.isArray(children) ? children[0] : children
            const props = (codeEl && typeof codeEl === 'object' && 'props' in codeEl
              ? (codeEl as { props?: { className?: string; children?: ReactNode } }).props
              : undefined) || {}
            const match = /language-([\w+-]+)/.exec(props.className || '')
            const lang = match ? match[1] : ''
            const raw = flattenText(props.children).replace(/\n$/, '')
            return <CodeCard lang={lang} raw={raw} onRunOutput={onRunOutput} />
          },
          /* Инлайн-код (не внутри pre) — одно слово/вставка посреди строки. */
          code({ children }: { children?: ReactNode }) {
            return <code className="inline">{children}</code>
          },
          /* Внешние ссылки — в новой вкладке и без доступа к window.opener. */
          a({ href, children }: { href?: string; children?: ReactNode }) {
            const t = flattenText(children)
            const cite = /^\[(\d{1,2})\]$/.exec(t)
            if (cite) {
              const src = (sources || [])[Number(cite[1]) - 1]
              return <a className="cite" href={href} target="_blank" rel="noopener noreferrer" title={(src && src.title) || href}>{cite[1]}</a>
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          /* Формула: узел своего типа из remarkMathLite. Источник — в свойствах,
             потому что дети этого элемента нужны лишь как запасной текст. */
          mathlite(props: { node?: { properties?: Record<string, unknown> } }) {
            const p = (props.node && props.node.properties) || {}
            /* 0.224: длинная строчная формула становится выключной. Иначе она
               рвётся посреди выражения (перенос внутри `inline-flex` разрешён), и
               «= 234 000 + 175 500» уезжает на отдельную строку. Выключная же
               стоит одной строкой и прокручивается (см. .math-fx.is-block). */
            const tex = String(p.latex || '')
            return <Formula latex={tex} block={String(p.block) === 'true' || tex.length > 64} />
          },
          img({ src, alt }: { src?: string; alt?: string }) {
            // eslint-disable-next-line jsx-a11y/alt-text
            return <img src={src} alt={alt || ''} loading="lazy" className="md-img" />
          },
          /* Таблица GFM: обёртка даёт горизонтальный скролл на телефоне + кнопку выгрузки CSV.
             Сам <table> с display:block ломает колонки — скроллим снаружи. */
          table({ children }: { children?: ReactNode }) {
            return <TableCard>{children}</TableCard>
          },
        } as Components}
      >
        {hidden.text}
      </ReactMarkdown>
    </div>
  )
})

/** Текст из детей <code> — строка, массив строк или вложенные элементы. */
function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && 'props' in (node as { props?: { children?: ReactNode } })) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}
