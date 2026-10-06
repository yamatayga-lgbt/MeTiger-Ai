/**
 * Проверка и форматирование JSON — единственный движок песочницы, которому не нужен
 * iframe: разбор происходит в родителе (браузере человека), а не в изолированном
 * документе. Это безопасно — JSON.parse не исполняет код, только разбирает текст.
 *
 * Зачем отдельный движок, а не «demo»: у модели часто просят «проверь/почини JSON»,
 * и названный ответ («вот где сломан синтаксис, на строке N») ценнее молчаливого
 * показа блока. Поэтому для `json` кнопка «Запустить» = валидация + красивый вывод.
 */

export interface JsonResult {
  ok: boolean
  output: string
  /** Строка, на которой упал разбор — для точной подсказки человеку и модели. */
  line?: number
  /** Колонка внутри строки. */
  col?: number
}

/** Позиция символа в строку/колонку (для «ошибка на строке N» из JSON.parse). */
function posToLineCol(text: string, pos: number): { line: number; col: number } {
  let line = 1
  let col = 1
  const n = Math.min(pos, text.length)
  for (let i = 0; i < n; i++) {
    if (text[i] === '\n') { line++; col = 1 } else col++
  }
  return { line, col }
}

export function checkJson(code: string): JsonResult {
  const src = String(code == null ? '' : code).replace(/\r\n/g, '\n')
  if (!src.trim()) return { ok: false, output: 'пустой код — проверять нечего' }
  if (src.length > 20000) {
    return { ok: false, output: 'код длиннее 20000 символов — разрежь на части и проверяй по очереди' }
  }
  try {
    const val = JSON.parse(src)
    const pretty = JSON.stringify(val, null, 2)
    return { ok: true, output: pretty }
  } catch (e) {
    const msg = String((e && (e as { message?: string }).message) || e)
    /* V8/SpiderMonkey пишут «Unexpected token ... in JSON at position N». */
    const m = /position (\d+)/.exec(msg)
    let where = ''
    if (m) {
      const { line, col } = posToLineCol(src, Number(m[1]))
      where = ` (строка ${line}, позиция ${col})`
    }
    const hint = /Unexpected (token|end)/.test(msg)
      ? 'скорее всего, лишняя или недостающая запятая/скобка, или запятая в конце объекта/массива'
      : /in JSON/.test(msg) ? 'синтаксис JSON: ключи в кавычках, значения — строка/число/объект/массив/true/false/null' : ''
    return {
      ok: false,
      output: 'JSON не разбирается' + where + ': ' + msg + (hint ? '\nподсказка: ' + hint : ''),
      line: m ? posToLineCol(src, Number(m[1])).line : undefined,
      col: m ? posToLineCol(src, Number(m[1])).col : undefined,
    }
  }
}
