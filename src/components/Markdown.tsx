import { memo } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

interface Props {
  text: string
  /** Передать вывод исполненного кода обратно в чат (кнопка в CodeRunner). */
  onRunOutput?: (text: string) => void
}

/* memo — не украшение, а лечение лага печати: без него каждая буква в поле
   ввода пересобирала разметку ВСЕЙ переписки заново (разбор Markdown дорогой).
   Замер до: печать в поле — 42 fps в светлой теме и 33 в тёмной, кадры до 83 мс.
   Сравнение идёт по тексту и функции вывода; функцию вызывающая сторона держит
   стабильной (useCallback), иначе memo бесполезен. */
export const Markdown = memo(function Markdown({ text, onRunOutput }: Props) {
  /* Формулы уходят из текста ДО разбора: на месте каждой остаётся метка, а сам LaTeX
     лежит в `hidden.items` и попадает в дерево как есть — ни разбор Markdown, ни его
     экранирование в него больше не вмешиваются (см. protectMath). */
  const hidden = protectMath(text)
  return (
    <div className="msg-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMathLite(hidden.items)]}
        components={{
          /* Блок кода: та же карточка, что была раньше — язык, бейдж
             «песочница»/«demo», и сама песочница, если язык исполняемый. */
          pre({ children }: { children?: ReactNode }) {
            const codeEl = Array.isArray(children) ? children[0] : children
            const props = (codeEl && typeof codeEl === 'object' && 'props' in codeEl
              ? (codeEl as { props?: { className?: string; children?: ReactNode } }).props
              : undefined) || {}
            const match = /language-([\w+-]+)/.exec(props.className || '')
            const lang = match ? match[1] : ''
            const raw = flattenText(props.children).replace(/\n$/, '')
            return (
              <div className="code-block">
                <div className="code-head">
                  <span>{lang || 'code'}</span>
                  <span>{runnable(lang) ? engineLabel(lang) : 'demo'}</span>
                </div>
                <pre>
                  <code>{raw}</code>
                </pre>
                {runnable(lang) ? <CodeRunner code={raw} lang={lang} onSend={onRunOutput} /> : null}
              </div>
            )
          },
          /* Инлайн-код (не внутри pre) — одно слово/вставка посреди строки. */
          code({ children }: { children?: ReactNode }) {
            return <code className="inline">{children}</code>
          },
          /* Внешние ссылки — в новой вкладке и без доступа к window.opener. */
          a({ href, children }: { href?: string; children?: ReactNode }) {
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
            return <Formula latex={String(p.latex || '')} block={String(p.block) === 'true'} />
          },
          img({ src, alt }: { src?: string; alt?: string }) {
            // eslint-disable-next-line jsx-a11y/alt-text
            return <img src={src} alt={alt || ''} loading="lazy" className="md-img" />
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
