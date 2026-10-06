/**
 * Песочница для кода, который пишет агент.
 *
 * Зачем: без запуска цикл «написал → увидел ошибку → поправил» невозможен — модель
 * иначе угадывает, работает её код или нет. У нас на платформе исполнять код негде,
 * и это измерено на настоящем рантайме (workerd через `wrangler pages dev`):
 *   · `new Function` и `eval` → «Code generation from strings disallowed for this context»;
 *   · `node:vm` под `nodejs_compat` → «[unenv] vm.runInNewContext is not implemented yet»;
 *   · `node:child_process` импортируется, но `spawn` → «[unenv] child_process.spawn is
 *     not implemented yet». То есть донорский sandbox.js (vm + спавн node/python) сюда
 *     переносимым не является вообще, ни в каком виде.
 * Поэтому код исполняется в браузере человека — в изолированном iframe. Отказ называем
 * прямо: вне браузера (curl, бот, headless) запуска нет, и модель обязана сказать
 * «не проверено запуском», а не выдумывать вывод.
 *
 * Что здесь чистая логика (тексты → строка документа → нормализованный результат), а
 * сама iframe-обвязка живёт в src/components/CodeRunner.tsx: так эти три функции
 * проверяются обычным `node test/front.test.js`, без браузера.
 */

/** Потолок исходника: больше — модель пишет не решение, а простыню, и её не читать. */
export const MAX_CODE = 20000
/** Потолок вывода: спам в цикле не должен съесть память вкладки. */
export const MAX_OUT = 6000
/** Сколько строк console мы вообще принимаем. */
export const MAX_LOGS = 200
/** Смотрит watchdog, а не песочница: бесконечный цикл внутри iframe прервать нельзя. */
export const TIMEOUT_MS = 4000
/** Метка сообщений от ребёнка — по ней отсекаем чужие postMessage. */
export const MARK = '__metiger'

export interface RawRun {
  logs?: string[]
  value?: string | null
  error?: string | null
  stack?: string | null
  ms?: number
}

export interface RunResult {
  ok: boolean
  output: string
  /** Подсказка по типу ошибки: «что с этим делать», а не только сам текст. */
  hint?: string
  /** Убит по таймауту — отдельный случай: код не упал, он не завершился. */
  killed?: boolean
  ms?: number
}

/**
 * Запускать/проверять разрешаем только то, у чего есть движок: явный JS, Python,
 * SQL, HTML/CSS-превью, JSON или TypeScript (после транспиляции). Блок без языка
 * или с чем-то неисполнимым показываем как `demo`, а врать «готово, работает» —
 * худшее, что может сделать интерфейс с кодом.
 */

/** Движок, который исполняет/проверяет код данного языка (см. CodeRunner.tsx). */
export type EngineId = 'js' | 'py' | 'sql' | 'html' | 'json' | 'ts'

/** Язык (алиас из ```-блока) → движок. Чем больше языков здесь, тем шире песочница. */
const ENGINE_OF: Record<string, EngineId> = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  py: 'py', python: 'py', python3: 'py', py3: 'py',
  sql: 'sql', sqlite: 'sql',
  html: 'html', html5: 'html', xml: 'html', svg: 'html',
  css: 'html', /* CSS-превью — это HTML-документ со стилем внутри */
  json: 'json',
}

/** Какой движок обслуживает язык, или null — тогда блок только для показа (demo). */
export function sandboxKind(lang: string): EngineId | null {
  return ENGINE_OF[String(lang || '').trim().toLowerCase()] ?? null
}

/** Запускать/проверять разрешаем только то, у чего есть движок. */
export function runnable(lang: string): boolean {
  return sandboxKind(lang) !== null
}

/** Подпись на карточке блока кода: что именно делает кнопка запуска. */
export function engineLabel(lang: string): string {
  switch (sandboxKind(lang)) {
    case 'js': return 'песочница'
    case 'ts': return 'песочница · TS'
    case 'py': return 'песочница · Python'
    case 'sql': return 'песочница · SQL'
    case 'html': return 'превью'
    case 'json': return 'проверка · JSON'
    default: return 'demo'
  }
}

/**
 * Документ-превью для HTML/CSS: код рендерится в изолированном iframe
 * (`allow-scripts`, без same-origin), скрипты внутри работают, но до родителя не
 * достают. Полный документ отдаём как есть, фрагмент заворачиваем в <body>; чистый
 * CSS — в <style> поверх демо-странички, чтобы было на что смотреть.
 */
export function buildHtmlDoc(code: string, lang: string): string {
  const src = String(code || '')
  if (String(lang || '').trim().toLowerCase() === 'css') {
    return '<!doctype html><html><head><meta charset="utf-8"><style>' + src + '</style></head>'
      + '<body><h3>Превью CSS</h3><p class="mt">Демо-текст в стиле.</p>'
      + '<button class="mt">Кнопка</button><ul><li>пункт</li><li>другой пункт</li></ul></body></html>'
  }
  const full = /^\s*<!?doctype|<html[\s>]/i.test(src)
  return full ? src
    : '<!doctype html><html><head><meta charset="utf-8"></head><body>' + src + '</body></html>'
}

/** Проверки до запуска. Каждая с причиной — модель читает этот текст и правит код. */
export function prepare(code: string): { ok: true; code: string } | { ok: false; error: string } {
  const src = String(code == null ? '' : code).replace(/\r\n/g, '\n')
  if (!src.trim()) return { ok: false, error: 'пустой код — запускать нечего' }
  if (src.length > MAX_CODE) {
    return { ok: false, error: `код длиннее ${MAX_CODE} символов — разрежь на части и запускай по очереди` }
  }
  /* require и node: в браузере физически нет. Сказать ДО запуска, иначе модель читает
     «require is not defined» как собственную ошибку и переписывает код наугад. */
  const nodeish = /\brequire\s*\(|\bfrom\s+['"]node:|\bprocess\.[a-z]/.exec(src)
  if (nodeish) {
    return {
      ok: false,
      error: 'в браузерной песочнице нет модулей Node (найдено «' + nodeish[0].trim()
        + '»): перепиши на чистый JS, вывод — console.log',
    }
  }
  return { ok: true, code: src }
}

/* ---------- таблица подсказок: текст ошибки → что с ним делать ----------
   Перенесена из донора (yama-ai/sandbox.js) и дополнена браузерными случаями:
   тут код падает не только по синтаксису, но и по границам песочницы. */
const HINTS: [RegExp, string][] = [
  [/is not defined/, 'переменной нет в области видимости: объявь её до использования или верни из функции'],
  [/Cannot read propert(y|ies) of (undefined|null)/, 'у значения undefined/null спрашивают поле: проверь, что функция реально возвращает объект'],
  [/is not a function/, 'вызывают то, чем не вызывают: проверь имя метода и что пришло с этой переменной'],
  [/Maximum call stack/i, 'бесконечная рекурсия: нужен выход из неё или итерация вместо рекурсии'],
  [/Unexpected token|Unexpected end|SyntaxError/, 'синтаксис: обычно скобка, запятая или перенос; смотри строку из текста ошибки'],
  [/concurrent|SharedArrayBuffer|Worker/i, 'многопоточность в песочнице недоступна: перепиши на один проход'],
  [/Failed to construct 'Worker'|importScripts/, 'внешних скриптов и воркеров здесь нет: всё нужное — внутри одного блока'],
]

export function hintFor(errText: string): string | null {
  const t = String(errText || '')
  for (let i = 0; i < HINTS.length; i++) if (HINTS[i][0].test(t)) return HINTS[i][1]
  return null
}

/**
 * Контракт «тесты обязательны» — тоже из донора: прогон «просто запустилось» ничего не
 * стоит, поэтому счёт проверок сообщается прямо в вывод, и модель видит правило там,
 * где она его читает, а не в отдельном наставлении.
 */
export function countAsserts(code: string): number {
  const src = String(code || '')
  const js = src.match(/assertEqual\s*\(|assert\s*\(|console\.assert\s*\(|if\s*\(\s*[a-zA-Z_$][\w$]*\s*!==/g)
  return js ? js.length : 0
}

export function withTestCount(code: string, output: string): string {
  const n = countAsserts(code)
  return output + '\n(проверок в коде: ' + n + (n < 2 ? ' — финал без двух проверок считается недоказанным' : '') + ')'
}

/**
 * Документ для srcdoc. Жёсткие рамки собраны здесь, а не в компоненте, чтобы их
 * можно было проверить текстом: `sandbox="allow-scripts"` без allow-same-origin
 * означает чужой opaque-origin (наши cookie, localStorage и KV для кода недоступны),
 * CSP `default-src 'none'` отрезает сеть, картинки и импорт, `</script>` внутри кода
 * обезврежен — иначе любой блок с этим текстом закрыл бы наш тег и выполнил остаток.
 */
export function buildSrcDoc(code: string): string {
  const safe = String(code).replace(/<\/(script)/gi, '<\\/$1')
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    /* Ни сети, ни файлов, ни картинок: только инлайн-скрипт, который мы сами вписали. */
    /* style-src тоже 'unsafe-inline': без него собственный <style> ниже (сброс
       отступов/фона) сам попадал под запрет default-src 'none' и был просто
       холостым — ничего не давал наружу/внутрь, но и не применялся. */
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">',
    '<style>html,body{margin:0;background:transparent}</style>',
    '</head><body><script type="module">',
    'const M=' + JSON.stringify(MARK),
    'const MAXL=' + MAX_LOGS + ',MAXC=500',
    'const send=(t,p)=>{try{parent.postMessage(Object.assign({[M]:1,type:t},p),"*")}catch(e){}}',
    'const logs=[]',
    'const fmt=(v)=>{if(typeof v=="string")return v.length>MAXC?v.slice(0,MAXC)+"…":v;if(v instanceof Error)return v.name+": "+v.message',
    ' if(typeof v==="bigint")return String(v)+"n";if(typeof v==="function")return "[функция]"',
    ' try{const s=JSON.stringify(v);if(s!==undefined)return s.length>MAXC?s.slice(0,MAXC)+"…":s}catch(e){}',
    ' return String(v)}',
    'const push=(tag,a)=>{if(logs.length>=MAXL){if(logs.length===MAXL)logs.push("…вывод обрезан: больше " + MAXL + " строк");return}',
    ' logs.push((tag==="log"?"":tag+": ")+a.map(fmt).join(" "))}',
    'for(const k of ["log","info","warn","error","debug","table"])console[k]=(...a)=>push(k,a)',
    'console.assert=(c,...a)=>{if(!c)push("error","проверка не прошла:",...a)}',
    'addEventListener("error",e=>send("error",{error:(e.message||"ошибка"),stack:e.filename?e.filename+":"+e.lineno:""}))',
    'addEventListener("unhandledrejection",e=>send("error",{error:"отклонённый Promise: "+fmt(e.reason)}))',
    'let value=null,error=null,stack=null,t0=performance.now()',
    'try{value=await (async()=>{' + safe + '\n})()}',
    'catch(e){error=e&&e.name?e.name+": "+e.message:String(e);stack=e&&e.stack?String(e.stack).split("\\n").slice(1,3).join(" | "):null}',
    'send("done",{logs,value:error?null:fmt(value),error,stack,ms:Math.round(performance.now()-t0)})',
    '<\/script></body></html>',
  ].join('\n')
}

/** Ответ ребёнка → то, что читает человек и модель. */
export function normalize(raw: RawRun, code: string): RunResult {
  const logs = (raw && Array.isArray(raw.logs) ? raw.logs : []).map((s) => String(s))
  /* «undefined» от ребёнка — это не значение: printing `→ undefined` только плодит
     вопрос «а что он вообще сделал». Нет вывода и нет значения — отдельный вердикт. */
  const shown = raw && raw.value && raw.value !== 'undefined' ? String(raw.value) : ''
  let output = logs.join('\n')
  if (output && shown) output += '\n→ ' + shown
  else if (shown) output = shown
  if (!output) output = '(код выполнен, но ничего не вернул и ничего не вывел)'
  const cut = output.length > MAX_OUT ? output.slice(0, MAX_OUT) + '\n…вывод обрезан на ' + MAX_OUT + ' символах' : output
  if (raw && raw.error) {
    const where = raw.stack ? ' ← ' + String(raw.stack).replace(/<anonymous>/g, 'код') : ''
    const hint = hintFor(raw.error)
    return { ok: false, output: withTestCount(code, cut + where), hint: hint || undefined, ms: raw.ms }
  }
  return { ok: true, output: withTestCount(code, cut), ms: raw && raw.ms }
}

/** Убийство по таймауту: отдельный вердикт, а не «ошибки нет». */
export function killed(ms: number): RunResult {
  return {
    ok: false,
    killed: true,
    ms,
    output: 'код не завершился за ' + Math.round(ms / 1000) + ' с — вкладка с песочницей закрыта',
    hint: 'бесконечный цикл или ожидание того, чего здесь нет: добавь условие выхода',
  }
}

/** Отказ, который обязан быть назван: запуск есть только в браузере. */
export const NO_SANDBOX = 'песочница живёт в браузере: вне его код не запущен, и вывод не проверен'
