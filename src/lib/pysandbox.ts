/**
 * Python в той же песочнице, что и JS (src/lib/sandbox.ts), но с другим устройством.
 *
 * Зачем отдельный файл, а не ветка в sandbox.ts: JS-документ строит код внутри себя и
 * выполняется мгновенно — иframe можно создавать и выбрасывать на каждый запуск. Pyodide
 * (CPython, скомпилированный в WebAssembly) грузится несколько секунд, и грузить его
 * заново на каждое нажатие «Запустить» — то же самое, что перезапускать браузер ради
 * одной строчки `print`. Поэтому здесь документ статический (без кода внутри), код
 * прилетает уже после загрузки через postMessage, а сам iframe живёт, пока его не убьют
 * по таймауту или не закроют сообщение.
 *
 * Сеть этому iframe всё равно не нужна «вообще» — а нужна она ровно на один хост: CDN,
 * откуда качается рантайм. CSP здесь поэтому не `default-src 'none'` как у JS, а точечно
 * разрешает только jsdelivr и только для script/connect; собственный код человека
 * по-прежнему не может никуда постучаться — его обращение к произвольному домену упрётся
 * в тот же CSP (а на jsdelivr ничего, кроме статики пакетов, не лежит — заберать оттуда
 * через код нечего).
 */

/** Фиксированная версия: чтобы CSP-хосты и API (setStdout/runPythonAsync) не поехали сами собой. */
const PY_VER = '0.27.8'
const PY_BASE = `https://cdn.jsdelivr.net/pyodide/v${PY_VER}/full/`

/** Первая загрузка рантайма (WASM + стандартная библиотека) — на медленной сети может быть долго. */
export const PY_LOAD_TIMEOUT_MS = 25000
/** Второй и далее запуски — рантайм уже тёплый, таймаут как у JS с запасом на то, что CPython медленнее V8. */
export const PY_RUN_TIMEOUT_MS = 8000

export const PY_MARK = '__metiger_py'

export { MAX_CODE } from './sandbox'

/** Те же рамки по длине, что у JS, но без JS-специфичных проверок (`require`, `process.`). */
export function preparePy(code: string): { ok: true; code: string } | { ok: false; error: string } {
  const src = String(code == null ? '' : code).replace(/\r\n/g, '\n')
  if (!src.trim()) return { ok: false, error: 'пустой код — запускать нечего' }
  if (src.length > 20000) {
    return { ok: false, error: 'код длиннее 20000 символов — разрежь на части и запускай по очереди' }
  }
  return { ok: true, code: src }
}

/** Подсказки под частые ошибки CPython — отдельные от JS-таблицы в sandbox.ts. */
const PY_HINTS: [RegExp, string][] = [
  [/ModuleNotFoundError|No module named/, 'в браузерной песочнице есть не весь PyPI — только то, что входит в сборку Pyodide (стандартная библиотека и часть научных пакетов, без собственной установки)'],
  [/IndentationError/, 'отступы: Python различает пробелы и табы и считает их количество — выровняй блок одинаково'],
  [/NameError: name .* is not defined/, 'переменной нет в области видимости: объяви её до использования'],
  [/ZeroDivisionError/, 'деление на ноль: проверь знаменатель перед делением'],
  [/RecursionError/, 'бесконечная или слишком глубокая рекурсия: нужен выход из неё или цикл вместо рекурсии'],
  [/TypeError: .* object is not callable/, 'вызывают то, чем не вызывают: проверь имя функции и что в переменной лежит на самом деле'],
  [/IndexError/, 'индекс за пределами списка/строки: проверь длину перед обращением по индексу'],
  [/KeyError/, 'такого ключа нет в словаре: проверь его наличие через `in` или `.get(...)`'],
]

export function pyHintFor(errText: string): string | null {
  const t = String(errText || '')
  for (let i = 0; i < PY_HINTS.length; i++) if (PY_HINTS[i][0].test(t)) return PY_HINTS[i][1]
  return null
}

/**
 * Статический документ без кода внутри. `script-src`/`connect-src` сужены до jsdelivr —
 * это единственный хост, с которым вообще разрешено говорить, и используется он только
 * для файлов рантайма, не для данных человека (их там взять неоткуда и положить некуда).
 * `wasm-unsafe-eval` — без него браузер не даёт скомпилировать сам WebAssembly-модуль.
 */
export function buildPySrcDoc(): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
      + `script-src 'unsafe-inline' 'wasm-unsafe-eval' ${PY_BASE}; connect-src ${PY_BASE}; style-src 'unsafe-inline'">`,
    '<style>html,body{margin:0;background:transparent}</style>',
    '</head><body>',
    `<script src="${PY_BASE}pyodide.js"></script>`,
    '<script type="module">',
    'const M=' + JSON.stringify(PY_MARK),
    'const MAXL=200,MAXC=500',
    'const send=(t,p)=>{try{parent.postMessage(Object.assign({[M]:1,type:t},p),"*")}catch(e){}}',
    'const fmt=(v)=>{if(v===undefined||v===null)return null;if(typeof v==="string")return v.length>MAXC?v.slice(0,MAXC)+"…":v',
    ' try{const s=String(v);return s.length>MAXC?s.slice(0,MAXC)+"…":s}catch(e){return null}}',
    'let py=null',
    'async function boot(){',
    '  try{',
    `    py=await loadPyodide({indexURL:${JSON.stringify(PY_BASE)}})`,
    '    const logs=[]',
    '    const push=(tag)=>(s)=>{if(logs.length>=MAXL){if(logs.length===MAXL)logs.push("…вывод обрезан: больше "+MAXL+" строк");return}',
    '      logs.push((tag?tag+": ":"")+(s.length>MAXC?s.slice(0,MAXC)+"…":s))}',
    '    py.setStdout({batched:push("")})',
    '    py.setStderr({batched:push("stderr")})',
    '    py._metigerLogs=logs',
    '    send("ready",{})',
    '  }catch(e){send("loaderror",{error:String(e&&e.message?e.message:e)})}',
    '}',
    'addEventListener("message",async(e)=>{',
    '  const d=e.data; if(!d||d[M]!==1||d.type!=="run"||!py)return',
    '  py._metigerLogs.length=0',
    '  const t0=performance.now()',
    '  let value=null,error=null',
    '  try{',
    '    const r=await py.runPythonAsync(String(d.code||""))',
    '    value=fmt(r)',
    '  }catch(e){ error=String(e&&e.message?e.message:e) }',
    '  send("done",{logs:py._metigerLogs.slice(),value,error,ms:Math.round(performance.now()-t0)})',
    '})',
    'boot()',
    '<\/script></body></html>',
  ].join('\n')
}

export interface PyRaw {
  logs?: string[]
  value?: string | null
  error?: string | null
  ms?: number
}

/** Тот же формат ответа, что у JS-песочницы (sandbox.ts `RunResult`), чтобы UI не ветвился. */
export function normalizePy(raw: PyRaw): { ok: boolean; output: string; hint?: string; ms?: number } {
  const logs = (raw && Array.isArray(raw.logs) ? raw.logs : []).map((s) => String(s))
  const shown = raw && raw.value != null ? String(raw.value) : ''
  let output = logs.join('\n')
  if (output && shown) output += '\n→ ' + shown
  else if (shown) output = shown
  if (!output) output = '(код выполнен, но ничего не вернул и ничего не вывел)'
  const cut = output.length > 6000 ? output.slice(0, 6000) + '\n…вывод обрезан на 6000 символах' : output
  if (raw && raw.error) {
    const hint = pyHintFor(raw.error)
    return { ok: false, output: cut + '\n' + raw.error, hint: hint || undefined, ms: raw.ms }
  }
  return { ok: true, output: cut, ms: raw && raw.ms }
}
