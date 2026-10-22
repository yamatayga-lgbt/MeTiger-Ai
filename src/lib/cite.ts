/**
 * Сноски ответа: «[2]» и «[2][3]» в тексте становятся ссылками на источники
 * (sources[n-1]) — как в Perplexity, 0.133.
 *
 * ПОЧЕМУ ПЛАГИН, А НЕ ПРАВКА СТРОКИ (0.230).
 * До этого сноски подставлялись прямо в текст ответа строкой: `[1]` превращался
 * в `[\[1\]](url)` — скобки экранировались, чтобы Markdown не принял их за
 * ссылку-ссылку. Экранирование делало ровно одну вещь и делало её плохо: пара
 * `\[ … \]` — это ещё и выключная формула LaTeX. Наш разбор формул видел в ней
 * математику и рисовал цифру сноски отдельной строкой по центру. На проде ответ
 * с четырьмя источниками выглядел так:
 *
 *     … оценивать пространство
 *
 *                       1
 *
 *                       2
 *
 *     .
 *
 * Человек читал не сноску, а пустые полосы между абзацами.
 *
 * Теперь сноски расставляются на уровне дерева Markdown: обычный узел текста
 * режется на куски, и номер становится настоящей ссылкой. В текст ничего не
 * дописывается и ничего не экранируется — формуле нечего принимать за себя.
 *
 * Код (`code`/`inlineCode`) и готовые ссылки не трогаем: `[1]` внутри примера
 * кода — это код, а `[2]` внутри чужой ссылки — часть её подписи.
 */

/** Источник ответа: адрес обязателен, подпись — по желанию. */
export interface CiteSource {
  url: string
  title?: string
}

/** Минимальный узел дерева: нам нужно ровно это, и ничего от чужих типов. */
interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string
  children?: MdNode[]
}

/* В эти узлы не заходим: в коде сноска — код, в ссылке — часть её подписи. */
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'html'])

/**
 * Плагин для unified. Две ступени вложенности обязательны: `use` вызывает
 * функцию как «аттачер» и ждёт от неё трансформер (тот же грабли, что у
 * remarkMathLite).
 */
export function remarkCitations(sources?: CiteSource[]) {
  return () => (tree: MdNode) => {
    if (!sources || !sources.length) return
    walk(tree, sources)
  }
}

function walk(node: MdNode, sources: CiteSource[]) {
  if (!node || !Array.isArray(node.children)) return
  const out: MdNode[] = []
  for (const child of node.children) {
    if (child && child.type === 'text' && typeof child.value === 'string') {
      out.push(...splitText(child.value, sources))
      continue
    }
    if (child && !SKIP.has(child.type)) walk(child, sources)
    out.push(child)
  }
  node.children = out
}

/** «текст [1][2] ещё» → текст, ссылка, ссылка, « ещё». */
function splitText(value: string, sources: CiteSource[]): MdNode[] {
  const parts = value.split(/(\[\d{1,2}\])/g)
  if (parts.length === 1) return [{ type: 'text', value }]
  const out: MdNode[] = []
  for (const part of parts) {
    if (!part) continue
    const m = /^\[(\d{1,2})\]$/.exec(part)
    const src = m ? sources[Number(m[1]) - 1] : undefined
    /* Источника с таким номером нет (модель сослалась на несуществующий) —
       оставляем как написан текст: «[5]» честнее выдуманной ссылки. */
    if (!m || !src || !/^https?:\/\//i.test(String(src.url || ''))) {
      out.push({ type: 'text', value: part })
      continue
    }
    out.push({
      type: 'link',
      url: String(src.url),
      title: src.title || undefined,
      children: [{ type: 'text', value: part }],
    })
  }
  return out
}
