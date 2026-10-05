import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeRunner } from './CodeRunner'
import { runnable } from '../lib/sandbox'

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
   ============================================================ */

interface Props {
  text: string
  /** Передать вывод исполненного кода обратно в чат (кнопка в CodeRunner). */
  onRunOutput?: (text: string) => void
}

export function Markdown({ text, onRunOutput }: Props) {
  return (
    <div className="msg-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          /* Блок кода: та же карточка, что была раньше — язык, бейдж
             «песочница»/«demo», и сама песочница, если язык исполняемый. */
          pre({ children }) {
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
                  <span>{runnable(lang) ? 'песочница' : 'demo'}</span>
                </div>
                <pre>
                  <code>{raw}</code>
                </pre>
                {runnable(lang) ? <CodeRunner code={raw} onSend={onRunOutput} /> : null}
              </div>
            )
          },
          /* Инлайн-код (не внутри pre) — одно слово/вставка посреди строки. */
          code({ children }) {
            return <code className="inline">{children}</code>
          },
          /* Внешние ссылки — в новой вкладке и без доступа к window.opener. */
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          img({ src, alt }) {
            // eslint-disable-next-line jsx-a11y/alt-text
            return <img src={src} alt={alt || ''} loading="lazy" className="md-img" />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

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
