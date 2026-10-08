/**
 * Формулы в ответе — своим разбором, без внешних библиотек.
 *
 * Почему не KaTeX/MathJax: они весят сотни килобайт, тянут за собой шрифты и
 * требуют сети — а человек читает ответ на телефоне, часто в метро. Своя
 * поддержка нужного подмножества LaTeX занимает пару килобайт, работает офлайн
 * и полностью нам видна. Плата за это названа честно: чего мы не понимаем —
 * то и показываем как есть (`\foo` остаётся `\foo`), а не выдумываем похожее.
 *
 * Живой повод: на проде модель отвечала на «докажи, что √2 иррационально»
 * текстом `\(\sqrt{2}=\frac{p}{q}\)`, и человек читал это КАК ЕСТЬ — со
 * слэшами и фигурными скобками. Снимок экрана показал это лучше любого теста.
 *
 * Здесь только разбор (чистые функции, проверяются в node). Рисует —
 * src/components/Formula.tsx, находит формулы в тексте ответа —
 * src/lib/remarkMath.ts.
 */

export type MathNode =
  /** Обычный текст: цифры, знаки, «=». */
  | { k: 'text'; v: string }
  /** Переменная — курсивом, как принято в математике. */
  | { k: 'var'; v: string }
  /** Прямой шрифт: \text{…}, \mathrm{…}, \operatorname{…}. */
  | { k: 'up'; v: MathNode[] }
  | { k: 'b'; v: MathNode[] }
  | { k: 'i'; v: MathNode[] }
  | { k: 'sup'; v: MathNode[] }
  | { k: 'sub'; v: MathNode[] }
  /** Дробь: числитель над знаменателем, черта между ними. */
  | { k: 'frac'; a: MathNode[]; b: MathNode[]; small?: boolean }
  /** Корень: \sqrt{x} и \sqrt[3]{x}. */
  | { k: 'sqrt'; a: MathNode[]; n?: MathNode[] }
  /** Биномиальный коэффициент \binom{n}{k}. */
  | { k: 'binom'; a: MathNode[]; b: MathNode[] }
  /** Крупный оператор: ∑, ∏, ∫ — рисуется крупнее прочего текста. */
  | { k: 'op'; v: string }
  /** Надчёркивание и подчёркивание: \overline{x}, \underline{x}. */
  | { k: 'over'; v: MathNode[] }
  | { k: 'under'; v: MathNode[] }
  /** Значок над буквой: \hat{x} → x̂, \vec{x} → x⃗. */
  | { k: 'accent'; v: MathNode[]; mark: string }
  /** Рамка вокруг итога: \boxed{x=3}. */
  | { k: 'box'; v: MathNode[] }
  /** Окружение из нескольких строк: \begin{cases} … \end{cases} (системы, матрицы). */
  | { k: 'rows'; rows: MathNode[][]; open?: string; close?: string }
  /** Перенос строки внутри окружения — по `\\`. */
  | { k: 'rowbreak' }
  /** Пробел: \, \; \quad \qquad — ширина в em. */
  | { k: 'space'; v: number }
  /** Кусок, который переносится целиком: выражение вместе со своей пунктуацией.
      Ставится не разбором, а рисованием (Formula.tsx) — разбору это не нужно. */
  | { k: 'glue'; v: MathNode[] }
  /** Непонятая команда. Показываем как есть — врать про неё нельзя. */
  | { k: 'raw'; v: string }

/* ── Символы: команда → знак. Список не про полноту, а про то, что реально
      приходит в ответах: буквы греческого алфавита, сравнения, множества. ── */
const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼',
  simeq: '≃', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', doteq: '≐',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧',
  lor: '∨', vee: '∨', oplus: '⊕', otimes: '⊗',
  to: '→', rightarrow: '→', implies: '⟹', Rightarrow: '⇒', Longrightarrow: '⟹',
  leftarrow: '←', leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⟺', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', nearrow: '↗', searrow: '↘',
  infty: '∞', partial: '∂', nabla: '∇', degree: '°', angle: '∠', perp: '⊥',
  parallel: '∥', therefore: '∴', because: '∵', prime: '′',
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  quad: '\u2003', qquad: '\u2003\u2003', ' ': ' ', ',': '\u2009', ';': '\u2009\u2005', ':': '\u2009', '!': '',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', oint: '∮',
  lim: 'lim', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan', min: 'min', max: 'max',
  gcd: 'gcd', lcm: 'lcm', mod: 'mod', bmod: 'mod',
}

/** Символы-операторы: им нужен крупный кегль, а не обычный текст. */
const BIG_OPS = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'oint'])

/** Греческие буквы: \pi → π. Заглавные — прямые, строчные — как переменные. */
const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

/** Числовые множества и «доски»: \mathbb{Z} → ℤ. */
const BLACKBOARD: Record<string, string> = {
  Z: 'ℤ', R: 'ℝ', N: 'ℕ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ', E: '𝔼', F: '𝔽', K: '𝕂',
}

/** Значки над буквой: \hat{x} → x̂ (комбинирующий символ). */
const ACCENTS: Record<string, string> = {
  hat: '\u0302', tilde: '\u0303', vec: '\u20d7', dot: '\u0307', ddot: '\u0308',
  check: '\u030c', breve: '\u0306', acute: '\u0301', grave: '\u0300',
}

const MAX_DEPTH = 12

interface Cursor {
  s: string
  i: number
}

/** Разбирает формулу в дерево. Битый ввод не бросает — остаток показывается как есть. */
export function parseFormula(latex: string): MathNode[] {
  const cur: Cursor = { s: String(latex == null ? '' : latex), i: 0 }
  const nodes = parseUntil(cur, '', 0)
  /* Открытые скобки без пары — это не повод молчать: непонятое показываем. */
  return nodes.length ? nodes : [{ k: 'text', v: cur.s }]
}

function parseUntil(cur: Cursor, stop: string, depth: number, stopEnv = ''): MathNode[] {
  const out: MathNode[] = []
  let text = ''
  const flush = () => {
    if (text) { out.push(...splitText(text)); text = '' }
  }
  /* Граница окружения: `\end{имя}` того самого, которое разбираем. Вложенное
     окружение с тем же именем съедается своим вызовом — здесь мы видим только
     парный `\end`, и потому просто заканчиваем. */
  const closerRe = stopEnv
    ? new RegExp('^\\\\end\\s*\\{\\s*' + stopEnv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}')
    : null
  while (cur.i < cur.s.length) {
    if (closerRe) {
      const m = closerRe.exec(cur.s.slice(cur.i))
      if (m) { cur.i += m[0].length; break }
    }
    const ch = cur.s[cur.i]
    if (stop && ch === stop) break
    if (depth > MAX_DEPTH) { text += ch; cur.i++; continue }
    if (ch === '\\') {
      const cmd = readCommand(cur)
      flush()
      out.push(...applyCommand(cmd, cur, depth))
      continue
    }
    if (ch === '{') {
      cur.i++
      const inner = parseUntil(cur, '}', depth + 1)
      if (cur.s[cur.i] === '}') cur.i++
      flush()
      out.push(...inner)
      continue
    }
    if (ch === '}') { cur.i++; continue }
    if (ch === '&') {
      /* `&` — выравнивание по знаку. Модели пишут его и без окружения
         (`\[ \Delta &= b^{2}-4ac \\[4pt] \sqrt{\Delta} &= 1 \]`) — на снимке это
         выходило мусором «Δ&=b²-4ac». Если рядом стоит знак отношения, `&` — это
         выравнивание и показывать его нечего; в остальных случаях (матрица) — пробел
         между колонками. */
      const head = text.trimEnd()
      const tail = cur.s.slice(cur.i + 1).trimStart()
      const было = /(?<![\\])(=|\+|-|\*|\/<|\/=|<|>)$/.test(head) || /\\(le|ge|neq|ne|approx|to|equiv|sim|implies|Rightarrow|Leftrightarrow)$/.test(head)
      const будет = /^(=|<|>|\\le|\\ge|\\neq|\\approx|\\to|\\equiv|\\sim|\\implies|\\Rightarrow)/.test(tail)
      cur.i++
      flush()
      out.push({ k: 'space', v: было || будет ? 0.14 : 0.7 })
      continue
    }
    if (ch === '^' || ch === '_') {
      cur.i++
      const arg = readArg(cur, depth)
      flush()
      out.push({ k: ch === '^' ? 'sup' : 'sub', v: arg })
      continue
    }
    text += ch
    cur.i++
  }
  flush()
  return out
}

/** Читает имя команды после «\». */
function readCommand(cur: Cursor): { name: string; space: boolean } {
  cur.i++ // сам слэш
  const start = cur.i
  while (cur.i < cur.s.length && /[a-zA-Z]/.test(cur.s[cur.i])) cur.i++
  if (cur.i === start) {
    /* Одиночный знак после слэша: \{ \} \% \, \; \: \! и пробел. */
    const ch = cur.s[cur.i] || ''
    cur.i++
    return { name: ch, space: ch === ' ' }
  }
  let space = false
  /* Пробел после имени команды LaTeX съедает: `\pi x` — это πx. */
  if (cur.s[cur.i] === ' ') { space = true; cur.i++ }
  return { name: cur.s.slice(start, cur.i - (space ? 1 : 0)), space }
}

/** Читает аргумент: {...} или один знак (для `x^2`, `\frac12`). */
function readArg(cur: Cursor, depth: number): MathNode[] {
  while (cur.s[cur.i] === ' ') cur.i++
  if (cur.s[cur.i] === '{') {
    cur.i++
    const inner = parseUntil(cur, '}', depth + 1)
    if (cur.s[cur.i] === '}') cur.i++
    return inner
  }
  const ch = cur.s[cur.i]
  if (ch == null) return []
  if (ch === '\\') {
    const cmd = readCommand(cur)
    return applyCommand(cmd, cur, depth + 1)
  }
  cur.i++
  return splitText(ch)
}

function readOptional(cur: Cursor, depth: number): MathNode[] | null {
  if (cur.s[cur.i] !== '[') return null
  cur.i++
  const inner = parseUntil(cur, ']', depth + 1)
  if (cur.s[cur.i] === ']') cur.i++
  return inner
}

function applyCommand(cmd: { name: string; space: boolean }, cur: Cursor, depth: number): MathNode[] {
  const { name } = cmd
  /* Служебные команды, которые сами по себе ничего не значат. */
  if (name === 'left' || name === 'right' || name === 'displaystyle' || name === 'textstyle'
    || name === 'limits' || name === 'nolimits' || name === 'mathstrut' || name === 'thinspace') {
    if (name === 'left' || name === 'right') {
      /* \left( ... \right) — берём сам разделитель, скобки рисуем обычным текстом. */
      const d = cur.s[cur.i]
      if (d && d !== '.' && !/[a-zA-Z]/.test(d)) { cur.i++; while (cur.s[cur.i] === ' ') cur.i++; return splitText(d) }
    }
    return []
  }
  if (name === 'begin') {
    /* Окружения: \begin{cases} (система), \begin{aligned}, матрицы. Живой повод —
       ответ с решением системы показывал человеку `\begincases` текстом. */
    const env = (readRawGroup(cur) || '').trim()
    const known = /^(cases|aligned|gathered|array|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|smallmatrix|split|align|align\*|alignat|alignat\*|gather|gather\*|equation|equation\*|multline|multline\*|flalign|flalign\*|dcases|subarray)$/
    if (!known.test(env)) return [{ k: 'raw', v: '\\begin{' + env + '}' }]
    const inner = parseUntilEnv(cur, env, depth + 1)
    const rows: MathNode[][] = [[]]
    for (const n of inner) {
      if (n.k === 'rowbreak') { rows.push([]); continue }
      rows[rows.length - 1].push(n)
    }
    /* `&` — разделитель выравнивания: он управляет колонками в LaTeX, а на экране
       его показывать нечего. Убираем только одиночный `&` (в тексте «A&B» он
       осмысленный, но в окружении это всегда выравнивание). */
    /* `&` — разделитель колонок: в LaTeX он выравнивает, на экране его показывать
       нечего, но и выбрасывать нельзя — «a & b» иначе слипается в «ab». Ставим пробел
       шириной с колонку (живой снимок матрицы: колонки слиплись). */
    const clean = rows.map((r) => r.map((n) => (n.k === 'text' && n.v.trim() === '&'
      ? { k: 'space' as const, v: 0.9 }
      : n)))
    const trimmed = clean.map((r) => r).filter((r) => r.length)
    const frame = env === 'cases' ? { open: '{', close: '' }
      : env === 'pmatrix' ? { open: '(', close: ')' }
        : env === 'bmatrix' ? { open: '[', close: ']' }
          : env === 'vmatrix' ? { open: '|', close: '|' }
            : env === 'Bmatrix' ? { open: '{', close: '}' }
              : { open: '', close: '' }
    return [{ k: 'rows', rows: trimmed.length ? trimmed : rows, open: frame.open, close: frame.close }]
  }
  if (name === 'end') {
    /* Парный \end без \begin (битый ввод): имя показываем как есть, но не падаем. */
    const env = (readRawGroup(cur) || '').trim()
    return [{ k: 'raw', v: '\\end{' + env + '}' }]
  }
  if (name === '\\' || name === 'cr' || name === 'newline') {
    /* `\\[4pt]` — перенос строки с добавочным отступом. Число и единицу измерения
       съедаем: человеку нужно место под строкой, а не «[4pt]» посреди выкладки
       (живой снимок ответа про квадратное уравнение). */
    const m = /^\s*\[\s*\d+(?:\.\d+)?\s*(?:pt|ex|em|mm|cm|in|mu|%)\s*\]/.exec(cur.s.slice(cur.i))
    if (m) cur.i += m[0].length
    return [{ k: 'rowbreak' }]
  }
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
    const a = readArg(cur, depth)
    const b = readArg(cur, depth)
    return [{ k: 'frac', a, b, small: name === 'tfrac' }]
  }
  if (name === 'sqrt') {
    const n = readOptional(cur, depth)
    const a = readArg(cur, depth)
    return [{ k: 'sqrt', a, n: n || undefined }]
  }
  if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
    const a = readArg(cur, depth)
    const b = readArg(cur, depth)
    return [{ k: 'binom', a, b }]
  }
  if (name === 'text' || name === 'textrm' || name === 'mathrm' || name === 'operatorname' || name === 'mbox') {
    /* В \text{…} кириллица и слова — прямым шрифтом, без курсива переменных. */
    const raw = readRawGroup(cur)
    return raw == null ? [] : [{ k: 'up', v: splitText(raw) }]
  }
  if (name === 'mathbf' || name === 'boldsymbol' || name === 'bm' || name === 'textbf') {
    return [{ k: 'b', v: readArg(cur, depth) }]
  }
  if (name === 'mathbb' || name === 'mathcal' || name === 'mathfrak' || name === 'mathsf' || name === 'mathtt') {
    /* `\mathbb Z` пишут и без фигурных скобок — это самая частая форма на живых
       ответах, и без неё «множество целых» оставалось буквой Z. */
    const raw = readRawGroup(cur)
    const a = raw != null ? splitText(raw) : readArg(cur, depth)
    if (name === 'mathbb') {
      const plain = a.map((n) => (n.k === 'text' || n.k === 'var' ? n.v : '')).join('')
      if (/^[A-Za-z]{1,4}$/.test(plain)) {
        return plain.split('').map((c) => (BLACKBOARD[c] ? { k: 'text', v: BLACKBOARD[c] } : { k: 'up', v: splitText(c) }))
      }
    }
    return [{ k: 'up', v: a }]
  }
  if (name === 'boxed' || name === 'fbox') {
    /* Рамка вокруг ответа: модели обводят ею итог. Рисуем настоящей рамкой. */
    return [{ k: 'box', v: readArg(cur, depth) }]
  }
  if (name === 'overline' || name === 'bar') {
    const a = name === 'bar' ? readArg(cur, depth) : readArg(cur, depth)
    return [{ k: 'over', v: a }]
  }
  if (name === 'underline') return [{ k: 'under', v: readArg(cur, depth) }]
  if (ACCENTS[name]) return [{ k: 'accent', v: readArg(cur, depth), mark: ACCENTS[name] }]
  if (name === 'not' && cur.s[cur.i] === '\\') {
    const next = readCommand(cur)
    const ch = SYMBOLS[next.name]
    if (ch) return [{ k: 'text', v: ch + '\u0338' }]
    return [{ k: 'raw', v: '\\not' }]
  }
  if (SYMBOLS[name] != null && name !== '') {
    const ch = SYMBOLS[name]
    if (BIG_OPS.has(name)) return [{ k: 'op', v: ch }]
    if (name === 'quad' || name === 'qquad' || ch === '\u2003' || ch === '\u2009\u2005' || ch === '\u2009') return [{ k: 'space', v: name === 'qquad' ? 2 : name === 'quad' ? 1 : 0.17 }]
    return ch ? [{ k: 'text', v: ch }] : []
  }
  if (GREEK[name]) {
    const upper = /^[A-Z]/.test(name)
    return upper ? [{ k: 'up', v: [{ k: 'text', v: GREEK[name] }] }] : [{ k: 'var', v: GREEK[name] }]
  }
  /* Пунктуация после слэша: \{ \} \% \$ \& \# \_ и знаки, которые экранирует
     Markdown, чтобы не принять их за разметку: формулы уходят из текста до разбора,
     см. protectMath. */
  if ('{}%$&#_*`|~<>'.includes(name) && name.length === 1) return [{ k: 'text', v: name }]
  if (name === '\\') return [{ k: 'text', v: '\n' }]
  /* Непонятая команда: показываем как есть. Придумать ей вид — значит соврать. */
  return [{ k: 'raw', v: '\\' + name }]
}

/**
 * Разбирает содержимое окружения до его `\end{имя}`.
 * Вложенное окружение с тем же именем съедает свой вызов: `\begin{cases}` внутри
 * системы закроется своим `\end{cases}`, и внешний разбор продолжится с того же
 * места — на этом и держится простота (проверено тестом M20).
 */
function parseUntilEnv(cur: Cursor, env: string, depth: number): MathNode[] {
  return parseUntil(cur, '', depth, env)
}

/** Содержимое {...} как есть, без разбора (для \text{…} и \mathbb{…}). */
function readRawGroup(cur: Cursor): string | null {
  while (cur.s[cur.i] === ' ') cur.i++
  if (cur.s[cur.i] !== '{') return null
  cur.i++
  let depth = 1
  let out = ''
  while (cur.i < cur.s.length && depth > 0) {
    const ch = cur.s[cur.i]
    if (ch === '{') depth++
    if (ch === '}') { depth--; if (!depth) { cur.i++; break } }
    out += ch
    cur.i++
  }
  return out
}

/**
 * Разбивает обычный текст формулы на «переменные» и «прочее».
 * Латинская буква — переменная (курсив), всё остальное — как есть. Так `2x` и
 * `x^2` читаются как в учебнике, а не как моноширинный набор.
 */
export function splitText(s: string): MathNode[] {
  const out: MathNode[] = []
  let buf = ''
  let bufVar = false
  const flush = () => {
    if (!buf) return
    out.push(bufVar ? { k: 'var', v: buf } : { k: 'text', v: buf })
    buf = ''
  }
  for (const ch of String(s || '')) {
    /* Кириллица и цифры — обычный текст: «пусть x» не должно курсивить слова. */
    const isVar = /[a-zA-Z]/.test(ch)
    if (isVar !== bufVar) { flush(); bufVar = isVar }
    buf += ch
  }
  flush()
  return out
}

/* ─────────────────────── сохранение формул до разбора Markdown ─────────────── */

/**
 * Приводит разделители формул к виду, который переживает разбор Markdown.
 *
 * Это не украшение, а необходимость, и вот почему. Ответ модели разбирает remark,
 * а он трактует `\(` как экранированную скобку: на входе было `\(\sqrt{2}\)`, на
 * выходе — `(\sqrt{2})`, и от признака «здесь формула» осталась половина. Плюс
 * `*` и `_` внутри формулы уходили в разметку: `\(a*b*c\)` человек видел как
 * «(abc)» курсивом — модель этого не писала.
 *
 * Поэтому до разбора: `\(` `\)` удваиваются (в разборе это литеральные `\(`),
 * а знаки, которые Markdown считает разметкой, экранируются внутри формулы.
 * Блоки кода и инлайновый код пропускаются как есть: `\frac{a}{b}` в примере кода
 * должен остаться кодом, а не превратиться в дробь.
 */
/** Формула, спрятанная от разбора Markdown: сам LaTeX и вид (строка или выключная). */
export interface MathItem {
  latex: string
  block: boolean
}

/** Текст с метками вместо формул: метка → формула. */
export interface ProtectedMath {
  text: string
  items: MathItem[]
}

/** Границы метки. Символы из области для личного пользования: их не бывает в ответах. */
export const MATH_OPEN = '\uE000'
export const MATH_CLOSE = '\uE001'

/**
 * Прячет формулы от разбора Markdown.
 *
 * Живой повод (0.112): LaTeX ломался именно на разборе. `\(` в исходнике — это
 * экранированная скобка, и Markdown отдавал человеку `(x=1)`; `*` и `_` внутри
 * формулы Markdown считал разметкой и делал курсив; одиночный `\\` (перенос строки
 * в системе уравнений) схлопывался в один слэш, и система превращалась в кашу.
 * Экранирование это лечило наполовину: чтобы спрятать `*`, надо дописать слэш, а
 * любой дописанный слэш тут же ломает LaTeX.
 *
 * Поэтому формулы не экранируются, а убираются из текста ДО разбора — на их место
 * встаёт метка, а сами формулы лежат рядом нетронутыми. Плагин (src/lib/remarkMath.ts)
 * находит метки в уже разобранном дереве и ставит на их место настоящие элементы.
 * Внутри формулы при этом сохраняется ровно то, что написал автор.
 *
 * Блоки кода и инлайновый код пропускаются: там LaTeX должен остаться кодом.
 */
export function protectMath(src: string): ProtectedMath {
  const s = String(src == null ? '' : src)
  const items: MathItem[] = []
  let out = ''
  let plain = ''
  let i = 0
  let fence: string | null = null
  let inlineCode = false
  const flush = () => {
    if (plain) { out += protectPlain(plain, items); plain = '' }
  }
  while (i < s.length) {
    const lineStart = i === 0 || s[i - 1] === '\n'
    if (fence) {
      if (lineStart && s.startsWith(fence, i)) { flush(); out += fence; i += fence.length; fence = null; continue }
      flush(); out += s[i]; i++
      continue
    }
    if (!inlineCode && lineStart && /^[`~]{3,}/.test(s.slice(i, i + 4))) {
      flush()
      const f = /^([`~]{3,})/.exec(s.slice(i)) as RegExpExecArray
      out += f[1]; i += f[1].length; fence = f[1]
      continue
    }
    if (s[i] === '`') { inlineCode = !inlineCode; flush(); out += '`'; i++; continue }
    /* Внутри инлайнового кода — как и в блоке кода — текст идёт в вывод как есть:
       `\(x\)` в примере кода человек должен увидеть кодом, а не формулой. */
    if (inlineCode) { flush(); out += s[i]; i++; continue }
    plain += s[i]
    i++
  }
  flush()
  return { text: out, items }
}

/** Заменяет формулы в куске обычного текста (вне кода) на метки. */
function protectPlain(text: string, items: MathItem[]): string {
  let out = ''
  let rest = text
  /* Потолок на число формул в куске: битый текст не должен крутить разбор вечно. */
  for (let guard = 0; guard < 200; guard++) {
    const found = findMath(rest)
    if (!found || !found.body) break
    out += rest.slice(0, found.start)
    items.push({ latex: found.body, block: found.block })
    out += MATH_OPEN + (items.length - 1) + MATH_CLOSE
    rest = rest.slice(found.end)
  }
  return out + rest
}
/* ─────────────────────────── поиск формул в тексте ─────────────────────────── */

export interface MathSpan {
  /** Текст до формулы. */
  before: string
  /** Начало формулы вместе с разделителями — чтобы продолжить поиск ПОСЛЕ неё. */
  start: number
  /** Конец формулы вместе с закрывающим разделителем. */
  end: number
  /** Сама формула без разделителей. */
  body: string
  /** Отдельной строкой по центру ($$…$$, \[…\]) или в строке текста (\(…\), $…$). */
  block: boolean
}

/**
 * Находит ПЕРВУЮ формулу в тексте. Возвращает null, если формулы нет.
 *
 * Приметы, по которым отличаем формулу от обычного текста, — не красота, а
 * необходимость: модели пишут и `$`, и `[`, и круглые скобки, и всё это бывает
 * не математикой. Поэтому `$…$` берём только когда внутри есть признак формул
 * (команда, степень, индекс, знак равенства), а `[…]`/`(…)` — только когда
 * внутри есть настоящая команда LaTeX (`\frac`, `\sqrt`, `\in`): «[1]» и
 * «(см. выше)» остаются обычным текстом.
 */
export function findMath(text: string): MathSpan | null {
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2)
      if (end > i + 2) return { before: s.slice(0, i), start: i, end: end + 2, body: s.slice(i + 2, end), block: true }
      continue
    }
    if (ch === '\\' && (s[i + 1] === '[' || s[i + 1] === '(')) {
      const close = s[i + 1] === '[' ? '\\]' : '\\)'
      const end = s.indexOf(close, i + 2)
      if (end > i + 2) return { before: s.slice(0, i), start: i, end: end + 2, body: s.slice(i + 2, end), block: s[i + 1] === '[' }
      continue
    }
    if (ch === '$') {
      const m = matchDollar(s, i)
      if (m) return { before: s.slice(0, i), start: i, end: m.end + 1, body: m.body, block: false }
      continue
    }
    if (ch === '[' || ch === '(') {
      const m = matchBare(s, i)
      if (m) return { before: s.slice(0, i), start: i, end: m.end + 1, body: m.body, block: ch === '[' }
      continue
    }
  }
  return null
}

/** `$…$`: без пробела сразу после открывающего и перед закрывающим, и не «$5». */
function matchDollar(s: string, i: number): { body: string; end: number } | null {
  if (s[i + 1] === ' ' || s[i + 1] === undefined) return null
  const end = s.indexOf('$', i + 1)
  if (end < 0 || end === i + 1) return null
  if (s[end - 1] === ' ') return null
  if (/\d/.test(s[end + 1] || '')) return null
  const body = s.slice(i + 1, end)
  if (body.indexOf('\n') >= 0) return null
  return looksLikeMath(body) ? { body, end } : null
}

/** `[…]` и `(…)` с командой LaTeX внутри: так модели оформляют «выключные» формулы. */
function matchBare(s: string, i: number): { body: string; end: number } | null {
  const open = s[i]
  const close = open === '[' ? ']' : ')'
  const end = s.indexOf(close, i + 1)
  if (end < 0 || end - i > 400) return null
  const body = s.slice(i + 1, end)
  if (body.indexOf('\n') >= 0 || body.indexOf(open) >= 0) return null
  return /\\[a-zA-Z]{1,20}/.test(body) ? { body, end } : null
}

/** Признак того, что внутри `$…$` действительно формула, а не «$5 за штуку». */
export function looksLikeMath(body: string): boolean {
  const s = String(body || '')
  if (!s.trim()) return false
  return /\\[a-zA-Z]{1,20}/.test(s)      // \frac, \sqrt, \in…
    || /[\^_]\s*\{?[0-9a-zA-Z]/.test(s)  // x^2, x_i
    || /[=<>≤≥≠≈+\-*/·×]/.test(s)        // знаки
    || /^[a-zA-Zα-ωΑ-Ω]\s*\(/.test(s)    // f(x)
}

/** Текст формулы без разметки — для тестов и для подписи-фолбэка. */
export function toPlain(nodes: MathNode[]): string {
  return nodes.map((n) => {
    switch (n.k) {
      case 'text': case 'var': case 'op': case 'raw': return n.v
      case 'up': case 'b': case 'i': case 'sup': case 'sub': case 'over': case 'under':
        return toPlain(n.v)
      case 'accent': return toPlain(n.v) + n.mark
      case 'box': return toPlain(n.v)
      case 'glue': return n.v.map((x) => toPlain([x])).join('')
      case 'rows': return n.rows.map((row) => toPlain(row)).join('; ')
      case 'rowbreak': return ' '
      case 'frac': return toPlain(n.a) + '/' + toPlain(n.b)
      case 'binom': return 'C(' + toPlain(n.a) + ',' + toPlain(n.b) + ')'
      case 'sqrt': return (n.n ? '(' + toPlain(n.n) + ')√(' : '√(') + toPlain(n.a) + ')'
      case 'space': return ' '
      default: return ''
    }
  }).join('')
}
