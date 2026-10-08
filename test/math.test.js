/**
 * Формулы в ответе: разбор LaTeX, поиск формул в тексте, защита от разбора Markdown.
 *
 * Почему это отдельный файл: разбор LaTeX — чистая функция, и её ошибки видно
 * только на живых ответах (на проде `\(\sqrt{2}=\frac{p}{q}\)` показывался
 * человеку КАК ЕСТЬ — со слэшами). Здесь проверяется то, что глазами не поймать:
 * скобки, вложенные дроби, «не формула» у цен, сохранение разделителей до
 * разбора Markdown.
 *
 * Запуск: node test/math.test.js
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name) }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')) }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.log('✖ формулы: esbuild не найден (' + bin + ') — проверки НЕ выполнены. Нужно `npm install`.')
  process.exit(1)
}

/* TypeScript грузится настоящим esbuild: пересказ функции в тесте проверял бы
   сам тест, а не то, что работает в приложении. */
const dir = mkdtempSync(join(tmpdir(), 'mt-math-'))
const bundle = async (file, out) => {
  const target = join(dir, out)
  execFileSync(bin, [file, '--bundle', '--platform=node', '--format=esm', '--outfile=' + target, '--log-level=error'], { stdio: 'inherit' })
  return import(target)
}

const m = await bundle('src/lib/mathfmt.ts', 'mathfmt.mjs')
const { parseFormula, toPlain, findMath, protectMath, looksLikeMath, splitText } = m
const r = await bundle('src/lib/remarkMath.ts', 'remarkMath.mjs')
const { splitTextNode, remarkMathLite } = r

console.log('M — разбор LaTeX: как формула превращается в дерево')
{
  ok('M1: дробь — числитель и знаменатель отдельными частями',
    (() => {
      const n = parseFormula('\\frac{p}{q}')
      return n.length === 1 && n[0].k === 'frac' && toPlain(n[0].a) === 'p' && toPlain(n[0].b) === 'q'
    })()
    || 'дробь разобрана не так, как ожидалось', '')

  ok('M1b: \\dfrac и \\tfrac — та же дробь, у \\tfrac помечен мелкий кегль',
    (() => {
      const big = parseFormula('\\dfrac{a}{b}')[0]
      const small = parseFormula('\\tfrac{a}{b}')[0]
      return big.k === 'frac' && !big.small && small.k === 'frac' && !!small.small
    })())

  ok('M2: корень — знак √ и подкоренное выражение; у \\sqrt[3]{} ещё и степень',
    (() => {
      const n = parseFormula('\\sqrt{x+1}')[0]
      const withN = parseFormula('\\sqrt[3]{x}')[0]
      return n.k === 'sqrt' && toPlain(n.a) === 'x+1' && !n.n
        && withN.k === 'sqrt' && toPlain(withN.n) === '3'
    })())

  ok('M3: степень и индекс — отдельные узлы, в том числе с фигурными скобками',
    (() => {
      const n = parseFormula('x^{2}+y_{i}')
      const sup = n.find((x) => x.k === 'sup')
      const sub = n.find((x) => x.k === 'sub')
      return !!sup && toPlain(sup.v) === '2' && !!sub && toPlain(sub.v) === 'i'
    })())

  ok('M4: греческие буквы и знаки сравнения',
    toPlain(parseFormula('\\alpha\\cdot\\beta \\le \\gamma')) === 'α·β≤γ',
    JSON.stringify(toPlain(parseFormula('\\alpha\\cdot\\beta \\le \\gamma'))))

  ok('M5: \\in\\mathbb Z и \\mathbb{R} — знаки множеств, и без фигурных скобок тоже',
    toPlain(parseFormula('p,q\\in\\mathbb Z')) === 'p,q∈ℤ' && toPlain(parseFormula('x\\in\\mathbb{R}')) === 'x∈ℝ',
    JSON.stringify([toPlain(parseFormula('p,q\\in\\mathbb Z')), toPlain(parseFormula('x\\in\\mathbb{R}'))]))

  ok('M6: \\text{…} — прямым шрифтом, курсив к словам не применяется',
    (() => {
      const n = parseFormula('\\text{при } x>0')
      return n[0].k === 'up' && toPlain(n[0].v).indexOf('при') === 0
    })())

  ok('M7: \\overline и \\vec — надчёркивание и значок над буквой',
    (() => {
      const over = parseFormula('\\overline{AB}')[0]
      const vec = parseFormula('\\vec{v}')[0]
      return over.k === 'over' && toPlain(over.v) === 'AB' && vec.k === 'accent' && !!vec.mark
    })())

  ok('M8: \\binom{n}{k} — биномиальный коэффициент, не дробь',
    parseFormula('\\binom{n}{k}')[0].k === 'binom')

  ok('M9: \\sum с пределами — крупный оператор со степенью и индексом',
    (() => {
      const n = parseFormula('\\sum_{i=1}^{n} i')
      return n[0].k === 'op' && n[0].v === '∑' && n.some((x) => x.k === 'sub') && n.some((x) => x.k === 'sup')
    })())

  ok('M10: \\left( \\right) — скобки остаются скобками, команды не печатаются',
    toPlain(parseFormula('\\left(\\frac{a}{b}\\right)^2')) === '(a/b)2',
    JSON.stringify(toPlain(parseFormula('\\left(\\frac{a}{b}\\right)^2'))))

  ok('M11: непонятая команда показывается как есть, а не выбрасывается молча',
    (() => {
      const n = parseFormula('\\foo{bar}')
      return n.some((x) => x.k === 'raw' && x.v === '\\foo') && toPlain(n).indexOf('bar') >= 0
    })(), JSON.stringify(parseFormula('\\foo{bar}')))

  ok('M12: битый ввод не бросает исключение и не теряет текст',
    (() => {
      const n = parseFormula('\\frac{a}{')
      return toPlain(n).indexOf('a') >= 0 && toPlain(parseFormula('{{{{')).length >= 0
    })())

  ok('M14: \\begin{cases} — система строками, а не текстом «\\begincases»',
    (() => {
      const n = parseFormula('\\begin{cases} x_1=3 \\\\ x_2=2 \\end{cases}')
      return n.length === 1 && n[0].k === 'rows' && n[0].rows.length === 2 && n[0].open === '{'
        && toPlain(n).indexOf('begincases') < 0
    })(), JSON.stringify(parseFormula('\\begin{cases} x_1=3 \\\\ x_2=2 \\end{cases}')))

  ok('M15: матрица — строки со скобкой нужного вида, «&» выравнивания не показывается',
    (() => {
      const n = parseFormula('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
      return n[0].k === 'rows' && n[0].open === '(' && n[0].rows.length === 2
        && toPlain(n).indexOf('&') < 0 && toPlain(n).indexOf('a') >= 0
    })(), JSON.stringify(toPlain(parseFormula('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'))))

  ok('M16: перенос строки вне окружения — отдельный узел, а не потерянный текст',
    (() => {
      const n = parseFormula('x=3 \\\\ y=4')
      return n.some((x) => x.k === 'rowbreak') && toPlain(n).indexOf('y=4') > 0
    })())

  ok('M17: \\boxed{…} — рамка вокруг итога',
    parseFormula('\\boxed{x=3}')[0].k === 'box')

  ok('M18: многострочная выключная формула (\\[ на своей строке) разбирается целиком',
    (() => {
      const n = parseFormula('\\Delta = b^{2}-4ac = 25-24 = 1.')
      return toPlain(n).indexOf('25-24') > 0
    })())

  ok('M19: неизвестное окружение показывается как есть, а не выбрасывается',
    (() => {
      const n = parseFormula('\\begin{tikzpicture} x \\end{tikzpicture}')
      return n.some((x) => x.k === 'raw' && /begin/.test(x.v)) && toPlain(n).indexOf('x') > 0
    })())

  ok('M20: вложенное окружение того же имени закрывается своим \\end, внешнее не рвётся',
    (() => {
      const n = parseFormula('\\begin{cases} \\begin{cases} a \\\\ b \\end{cases} \\\\ c \\end{cases}')
      return n.length === 1 && n[0].k === 'rows' && n[0].rows.length === 2
    })(), JSON.stringify(toPlain(parseFormula('\\begin{cases} \\begin{cases} a \\\\ b \\end{cases} \\\\ c \\end{cases}'))))

  ok('M21: выравнивание по знаку (& вне окружения) не показывается мусором',
    (() => {
      const n = parseFormula('\\Delta &= b^{2}-4ac')
      return toPlain(n).indexOf('&') < 0 && toPlain(n).indexOf('Δ') >= 0
        && n.some((x) => x.k === 'space')
    })(), JSON.stringify(toPlain(parseFormula('\\Delta &= b^{2}-4ac'))))

  ok('M22: перенос с отступом \\\\[4pt] — перенос, а не текст «[4pt]»',
    (() => {
      const n = parseFormula('x=1 \\\\[4pt] y=2')
      return n.some((x) => x.k === 'rowbreak') && toPlain(n).indexOf('4pt') < 0 && toPlain(n).indexOf('y=2') > 0
    })(), JSON.stringify(toPlain(parseFormula('x=1 \\\\[4pt] y=2'))))

  ok('M23: \\begin{align} — знакомое окружение, строки выравнивания',
    (() => {
      const n = parseFormula('\\begin{align} a &= 1 \\\\ b &= 2 \\end{align}')
      return n.length === 1 && n[0].k === 'rows' && n[0].rows.length === 2 && toPlain(n).indexOf('&') < 0
    })(), JSON.stringify(toPlain(parseFormula('\\begin{align} a &= 1 \\\\ b &= 2 \\end{align}'))))

  ok('M24: экранированный \\& остаётся знаком «&» — это не выравнивание',
    toPlain(parseFormula('A \\& B')).indexOf('&') > 0, JSON.stringify(toPlain(parseFormula('A \\& B'))))

  ok('M13: латинская буква — переменная (курсив), кириллица — обычный текст',
    (() => {
      const n = splitText('пусть x равен')
      return n.some((x) => x.k === 'var' && x.v === 'x')
        && n.some((x) => x.k === 'text' && x.v.indexOf('пусть') >= 0)
    })())
}

console.log('N — что считается формулой в тексте ответа, а что нет')
{
  ok('N1: \\(…\\) — формула в строке',
    (() => { const f = findMath('Пусть \\(x=1\\) и всё.'); return f && f.body === 'x=1' && f.block === false })())

  ok('N2: \\[…\\] и $$…$$ — выключная формула (отдельной строкой)',
    (() => {
      const a = findMath('Смотри \\[ \\frac{a}{b} \\] тут.')
      const b = findMath('Итого $$E=mc^2$$ далее.')
      return a && a.block === true && b && b.block === true && b.body === 'E=mc^2'
    })())

  ok('N3: цены не превращаются в формулы — «$5 и ещё $10» остаётся текстом',
    findMath('Стоит $5 и ещё $10 — обычная цена.') === null,
    JSON.stringify(findMath('Стоит $5 и ещё $10 — обычная цена.')))

  ok('N4: $x^2$ со степенью — формула (признак математики внутри)',
    (() => { const f = findMath('Цена $x^2$ долларов?'); return f && f.body === 'x^2' })())

  ok('N5: «[1]» и «(см. выше)» — не формулы: внутри нет ни одной команды LaTeX',
    findMath('Отметка [1] и (см. выше) — не формулы.') === null)

  ok('N6: модель пишет [ \\sqrt{2}=\\frac{p}{q}, ] — это выключная формула',
    (() => { const f = findMath('Разложение [ \\sqrt{2}=\\frac{p}{q}, ] верно.'); return f && f.block === true && /\\sqrt/.test(f.body) })())

  ok('N7: (p,q\\in\\mathbb Z) в круглых скобках — формула в строке',
    (() => { const f = findMath('Множество (p,q\\in\\mathbb Z) таково.'); return f && f.block === false && /\\in/.test(f.body) })())

  ok('N8: непрерывный «$» без пары — не формула и не бесконечный цикл',
    findMath('Цена 5$ и всё') === null && findMath('$') === null)

  ok('N9: смещения найденной формулы позволяют продолжить поиск после неё',
    (() => {
      const s = 'Первая \\(a=1\\), вторая \\(b=2\\).'
      const first = findMath(s)
      const rest = s.slice(first.end)
      const second = findMath(rest)
      return first.body === 'a=1' && second && second.body === 'b=2'
    })())

  ok('N10: looksLikeMath не считает формулой пустое и «просто слово»',
    !looksLikeMath('') && !looksLikeMath('  ') && !looksLikeMath('скоро'))
}

console.log('P — формулы уходят из текста до разбора Markdown (метки вместо LaTeX)')
{
  const один = (t) => protectMath(t)

  ok('P1: формула убрана из текста целиком, на её месте метка — Markdown её больше не видит',
    (() => {
      const r = один('Пусть \\(x=1\\).')
      return r.items.length === 1 && r.items[0].latex === 'x=1' && r.items[0].block === false
        && r.text.indexOf('x=1') < 0 && r.text.indexOf('Пусть ') === 0 && r.text.trim().endsWith('.')
    })(), JSON.stringify(один('Пусть \\(x=1\\).')))

  ok('P2: выключная формула помечена как выключная, а LaTeX в ней цел',
    (() => {
      const r = один('\\[ \\frac{a}{b} \\]')
      return r.items.length === 1 && r.items[0].block === true && r.items[0].latex === ' \\frac{a}{b} '
    })())

  ok('P3: звёздочки и подчёркивания внутри формулы не становятся курсивом — они не в тексте',
    (() => {
      const r = один('\\(a*b*c\\) и \\(x_1+x_2\\)')
      return r.items[0].latex === 'a*b*c' && r.items[1].latex === 'x_1+x_2'
        && r.text.indexOf('*') < 0 && r.text.indexOf('_') < 0
    })(), JSON.stringify(один('\\(a*b*c\\) и \\(x_1+x_2\\)')))

  ok('P4: одиночный \\\\ (перенос строки в системе) сохраняется — раньше разбор съедал один слэш',
    (() => {
      const r = один('\\[ \\begin{cases} x=1 \\\\ y=2 \\end{cases} \\]')
      return r.items.length === 1 && r.items[0].latex.indexOf('x=1 \\\\ y=2') > 0
    })(), JSON.stringify(один('\\[ \\begin{cases} x=1 \\\\ y=2 \\end{cases} \\]')))

  ok('P5: блок кода не трогается — в примере кода LaTeX должен остаться кодом',
    (() => {
      const src = 'Код:\n```python\nprint("\\(x\\)")\n```\nИ текст \\(y\\).'
      const r = один(src)
      return r.text.indexOf('print("\\(x\\)")') >= 0 && r.items.length === 1 && r.items[0].latex === 'y'
    })(), JSON.stringify(один('Код:\n```python\nprint("\\(x\\)")\n```\nИ текст \\(y\\).')))

  ok('P6: инлайновый код тоже не трогается', (() => {
    const r = один('Вот `\\(x\\)` и \\(y\\)')
    return r.text.indexOf('`\\(x\\)`') >= 0 && r.items.length === 1 && r.items[0].latex === 'y'
  })())

  ok('P7: незакрытый разделитель остаётся текстом (одна скобка не делает формулу)',
    (() => {
      const r = один('Смотри \\(x=1 — не закрыто.')
      return r.items.length === 0 && r.text === 'Смотри \\(x=1 — не закрыто.'
    })())

  ok('P8: LaTeX-экранирование (\\{ \\_ \\%) внутри формулы не портится',
    (() => {
      const r = один('\\(\\{x\\_1\\} = \\%\\)')
      return r.items[0].latex === '\\{x\\_1\\} = \\%'
    })(), JSON.stringify(один('\\(\\{x\\_1\\} = \\%\\)')))

  ok('P9: текст без формул возвращается знак в знак', (() => {
    const src = 'Просто текст, [без формул] и (скобки).'
    const r = один(src)
    return r.text === src && r.items.length === 0
  })(), JSON.stringify(один('Просто текст, [без формул] и (скобки).')))

  ok('P10: две формулы в одном абзаце — две отдельные метки со своими номерами',
    (() => {
      const r = один('\\(a\\) между \\(b\\)')
      return r.items.length === 2 && r.text.indexOf('между') > 0 && r.text.indexOf('a') < 0 && r.text.indexOf('b') < 0
    })())
}

console.log('Q — плагин: формулы становятся отдельными узлами, код остаётся кодом')
{
  /* splitTextNode работает и без меток (запасной путь) — проверяем оба входа. */
  const nodes = splitTextNode('Тут \\(x^2\\) и [ \\frac{a}{b} ] всё.')
  const byMark = splitTextNode('Тут ' + '\uE0000\uE001' + ' всё.', [{ latex: '\\frac{a}{b}', block: true }])
  ok('Q1: текстовый узел разрезан на текст и формулы',
    nodes.some((n) => n.type === 'text' && /Тут/.test(n.value || ''))
      && nodes.filter((n) => n.type === 'mathlite').length === 2,
    JSON.stringify(nodes.map((n) => n.type)))

  ok('Q2: у формулы есть и источник, и запасной текст (если компонент не подхватится)',
    (() => {
      const f = nodes.find((n) => n.type === 'mathlite')
      return f.data.hProperties.latex === 'x^2' && f.data.hProperties.block === 'false'
        && f.data.hChildren[0].value === 'x^2'
    })())

  ok('Q3: повторного нахождения той же формулы нет — иначе вторая копия висела бы рядом',
    splitTextNode('\\(a\\)').length === 1)

  const tree = { type: 'root', children: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Формула \\(x\\) тут.' }] },
    { type: 'code', value: '\\frac{a}{b}' },
    { type: 'inlineCode', value: '\\sqrt{2}' },
  ] }
  remarkMathLite()()(tree)
  ok('Q4: блок кода и инлайновый код плагин не трогает — там LaTeX должен остаться кодом',
    tree.children[1].type === 'code' && tree.children[2].type === 'inlineCode'
      && tree.children[0].children.some((n) => n.type === 'mathlite'))

  ok('Q5: патологический текст (одни скобки) не зацикливает разбор',
    (() => {
      const t0 = Date.now()
      const out = splitTextNode('[(((('.repeat(50))
      return Date.now() - t0 < 2000 && Array.isArray(out)
    })())

  ok('Q6: пустой текст не даёт ни одного узла',
    splitTextNode('').length === 0)

  ok('Q7: метка из protectMath превращается в формулу с источником ровно как был',
    (() => {
      const f = byMark.find((n) => n.type === 'mathlite')
      return byMark.filter((n) => n.type === 'mathlite').length === 1
        && f.data.hProperties.latex === '\\frac{a}{b}' && f.data.hProperties.block === 'true'
        && byMark.some((n) => n.type === 'text' && /Тут/.test(n.value || ''))
    })(), JSON.stringify(byMark.map((n) => n.type)))

  ok('Q8: метка без своей формулы не пропадает молча — остаётся текстом',
    splitTextNode('\uE0009\uE001', []).length === 1)
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено')
if (fail) process.exit(1)
