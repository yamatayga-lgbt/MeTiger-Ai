/**
 * Формулы в ответе модели: превращает `\(\sqrt{2}\)` в формулу, а не в текст.
 *
 * Это remark-плагин, а не поиск по готовой разметке. Причина: текст ответа
 * разбирает remark, и попытка «подправить» уже собранный HTML строкой опасна —
 * формулы живут и внутри абзацев, и в списках, и в таблицах, а `<` и `>` внутри
 * LaTeX ломают разметку. Плагин же встраивается в тот же проход и работает на
 * уровне дерева: текст ответа остаётся текстом, формулы становятся элементами.
 *
 * Второе, что даёт плагин: блоки кода он не трогает по устройству (там узлы
 * `code`/`inlineCode`, а не `text`) — `\frac{a}{b}` в примере кода человек должен
 * увидеть как код, а не как дробь. И `<` в примере HTML не превращается в тег.
 *
 * Разбор самого LaTeX — src/lib/mathfmt.ts (чистые функции, проверены в node),
 * рисование — src/components/Formula.tsx, стили — .math-fx в src/styles/index.css.
 */
import { findMath, MATH_CLOSE, MATH_OPEN, type MathItem } from './mathfmt'

/** Минимальный узел дерева: нам нужно ровно это, и ничего от чужих типов. */
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
    hChildren?: { type: string; value: string }[]
  }
}

/** Узел формулы в дереве: свой тип + подсказка, каким тегом его считать. */
const MATH_TYPE = 'mathlite'

/**
 * Плагин для unified. Две ступени вложенности обязательны: unified вызывает функцию,
 * переданную в `use`, как «аттачер» и ждёт от неё трансформер. Если вернуть трансформер
 * сразу (одна ступень), unified всё равно вызовет его как аттачер — с пустыми настройками
 * вместо дерева, — и формулы молча останутся текстом. На этом уже спотыкались: вручную
 * вызванный плагин работал, а в конвейере разбора — нет.
 */
export function remarkMathLite(items: MathItem[] = []) {
  return () => (tree: MdNode) => {
    walk(tree, items)
  }
}

function walk(node: MdNode, items: MathItem[]) {
  if (!node || !Array.isArray(node.children)) return
  const out: MdNode[] = []
  for (const child of node.children) {
    /* Код не трогаем: `value` у code/inlineCode — тоже текст, но это код. */
    if (child && child.type === 'text' && typeof child.value === 'string') {
      out.push(...splitTextNode(child.value, items))
      continue
    }
    if (child && child.type !== 'code' && child.type !== 'inlineCode') walk(child, items)
    out.push(child)
  }
  node.children = out
}

/** Узел формулы в дереве: источник и запасной текст. */
function mathNode(latex: string, block: boolean): MdNode {
  return {
    type: MATH_TYPE,
    value: latex,
    data: {
      hName: 'mathlite',
      /* `latex` — источник формулы, `block` — рисовать строкой или отдельной строкой.
         hChildren оставлен нарочно: если компонент почему-то не подхватится, человек
         увидит формулу текстом, а не пустое место. */
      hProperties: { latex, block: block ? 'true' : 'false' },
      hChildren: [{ type: 'text', value: latex }],
    },
  }
}

/**
 * Режет текстовый узел на текст и формулы.
 *
 * Сначала — метки, оставленные protectMath: у них формула берётся из списка как есть,
 * без разбора markdown. Остаток текста проходит обычный поиск (`splitRaw`) — он нужен
 * для формул, которые разбор не тронул (например, `$$…$$` внутри текста без меток).
 */
export function splitTextNode(value: string, items: MathItem[] = []): MdNode[] {
  if (!items.length) return splitRaw(value)
  const re = new RegExp(MATH_OPEN + '(\\d+)' + MATH_CLOSE, 'g')
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    const before = value.slice(last, m.index)
    if (before) out.push(...splitRaw(before))
    const item = items[Number(m[1])]
    if (item) out.push(mathNode(item.latex, item.block))
    else out.push({ type: 'text', value: m[0] })
    last = m.index + m[0].length
  }
  const tail = value.slice(last)
  if (tail) out.push(...splitRaw(tail))
  return out
}

/** Поиск формул прямо в тексте: запасной путь для текста без меток. */
function splitRaw(value: string): MdNode[] {
  const out: MdNode[] = []
  let rest = value
  /* Ограничение на число формул в одном узле: битый или враждебный текст не
     должен заставлять разбор крутиться вечно — остаток просто остаётся текстом. */
  for (let guard = 0; guard < 40; guard++) {
    const found = findMath(rest)
    if (!found) break
    if (!found.body) break
    if (found.before) out.push({ type: 'text', value: found.before })
    out.push(mathNode(found.body, found.block))
    /* Продолжаем ПОСЛЕ формулы: смещения считает разбор, а не этот файл — иначе
       одна и та же формула находилась бы второй раз (на этом уже спотыкались). */
    rest = rest.slice(Math.max(found.end, found.start + 1))
  }
  if (rest) out.push({ type: 'text', value: rest })
  return out
}

