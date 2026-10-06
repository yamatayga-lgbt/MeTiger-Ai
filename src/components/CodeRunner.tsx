import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Play, RotateCcw } from 'lucide-react'
import { buildSrcDoc, buildHtmlDoc, killed, normalize, prepare, sandboxKind, TIMEOUT_MS, MARK } from '../lib/sandbox'
import { buildPySrcDoc, normalizePy, preparePy, PY_LOAD_TIMEOUT_MS, PY_MARK, PY_RUN_TIMEOUT_MS } from '../lib/pysandbox'
import { buildSqlSrcDoc, normalizeSql, prepareSql, SQL_LOAD_TIMEOUT_MS, SQL_MARK, SQL_RUN_TIMEOUT_MS } from '../lib/sqlsandbox'
import { checkJson } from '../lib/jsoncheck'

/**
 * Кнопка запуска у блока кода — несколько движков под одним UI.
 *
 * JS/TS: иframe создаётся на каждый запуск и выбрасывается сразу после ответа —
 *   выполнение мгновенное, греть нечего (src/lib/sandbox.ts). TS предварительно
 *   транспилируется в JS в родителе (sucrase), затем идёт в ту же JS-песочницу.
 * Python: иframe с Pyodide (CPython в WebAssembly) держим живым между запусками —
 *   первая загрузка рантайма занимает секунды, грузить его заново на каждую кнопку
 *   было бы издевательством (src/lib/pysandbox.ts).
 * SQL: иframe с SQLite (sql.js, тоже WASM) — тёплый рантайм между запусками, код
 *   прилетает через postMessage (src/lib/sqlsandbox.ts).
 * HTML/CSS: не исполняется как программа, а рендерится в изолированном iframe —
 *   это «превью», а не консольный вывод (src/lib/sandbox.ts: buildHtmlDoc).
 * JSON: проверяется и форматируется в родителе без iframe (src/lib/jsoncheck.ts).
 *
 * Бесконечный цикл убивает тот же приём, что у JS: прервать синхронный код внутри
 * iframe нельзя, можно только снять весь iframe — тогда тёплый рантайм теряется, и
 * следующий запуск грузит его с нуля (это объявлено в выводе, чтобы не выглядело багом).
 */
interface Props {
  code: string
  lang?: string
  /** Передать вывод модели, чтобы она прочитала ошибку и поправила код. */
  onSend?: (text: string) => void
}

type RunOut = { ok: boolean; output: string; hint?: string; killed?: boolean } | null

export function CodeRunner({ code, lang, onSend }: Props) {
  const kind = sandboxKind(lang || '') ?? 'js'
  const [doc, setDoc] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [res, setRes] = useState<RunOut>(null)
  const [ms, setMs] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const win = useRef<HTMLIFrameElement | null>(null)
  const timer = useRef<number | null>(null)
  const pyReady = useRef(false)
  const pending = useRef<string | null>(null)
  const sqlReady = useRef(false)
  const sqlPending = useRef<string | null>(null)

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  /* Снять иframe целиком — для JS/TS это конец каждого запуска; для Python/SQL —
     только отказ по таймауту (обычная удача не трогает doc, рантайм остаётся тёплым). */
  function teardown() {
    clearTimer()
    setDoc(null)
    setHtml(null)
    pyReady.current = false
    sqlReady.current = false
    pending.current = null
    sqlPending.current = null
  }

  useEffect(() => {
    if (!doc) return
    const onMsg = (e: MessageEvent) => {
      const fr = win.current && win.current.contentWindow
      if (!fr || e.source !== fr) return
      const d = e.data as Record<string, unknown>
      if (!d) return

      if (kind === 'js' || kind === 'ts') {
        if (d[MARK] !== 1) return
        teardown()
        setBusy(false)
        const out = normalize({ logs: d.logs as string[], value: d.value as string, error: d.error as string, stack: d.stack as string, ms: d.ms as number }, code)
        setRes(out)
        setMs(typeof d.ms === 'number' ? d.ms : null)
        setNote(null)
        return
      }

      if (kind === 'sql') {
        if (d[SQL_MARK] !== 1) return
        if (d.type === 'loaderror') {
          teardown()
          setBusy(false)
          setRes({ ok: false, output: 'не удалось загрузить SQLite: ' + String(d.error || 'нет сети или заблокирован CDN') })
          setNote(null)
          return
        }
        if (d.type === 'ready') {
          sqlReady.current = true
          clearTimer()
          if (sqlPending.current !== null) {
            const toRun = sqlPending.current
            sqlPending.current = null
            fr.postMessage(Object.assign({ [SQL_MARK]: 1, type: 'run', code: toRun }, {}), '*')
            timer.current = window.setTimeout(() => {
              teardown()
              setBusy(false)
              setRes(killed(SQL_RUN_TIMEOUT_MS))
              setMs(SQL_RUN_TIMEOUT_MS)
            }, SQL_RUN_TIMEOUT_MS + 400)
          }
          return
        }
        if (d.type === 'done') {
          clearTimer()
          setBusy(false)
          const out = normalizeSql({ value: d.value as string | null, error: d.error as string | null, ms: d.ms as number })
          setRes(out)
          setMs(typeof d.ms === 'number' ? d.ms : null)
          setNote(null)
        }
        return
      }

      if (d[PY_MARK] !== 1) return
      if (d.type === 'loaderror') {
        teardown()
        setBusy(false)
        setRes({ ok: false, output: 'не удалось загрузить Python-окружение: ' + String(d.error || 'нет сети или заблокирован CDN') })
        setNote(null)
        return
      }
      if (d.type === 'ready') {
        pyReady.current = true
        clearTimer()
        if (pending.current !== null) {
          const toRun = pending.current
          pending.current = null
          fr.postMessage(Object.assign({ [PY_MARK]: 1, type: 'run', code: toRun }, {}), '*')
          timer.current = window.setTimeout(() => {
            teardown()
            setBusy(false)
            setRes(killed(PY_RUN_TIMEOUT_MS))
            setMs(PY_RUN_TIMEOUT_MS)
          }, PY_RUN_TIMEOUT_MS + 400)
        }
        return
      }
      if (d.type === 'done') {
        clearTimer()
        setBusy(false)
        const out = normalizePy({ logs: d.logs as string[], value: d.value as string | null, error: d.error as string | null, ms: d.ms as number })
        setRes(out)
        setMs(typeof d.ms === 'number' ? d.ms : null)
        setNote(null)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [doc, code, kind])

  useEffect(() => () => clearTimer(), [])

  /* JS и TS идут через один путь: TS сначала транспилируется в родителе. */
  function runJsCode(jsCode: string) {
    setRes(null)
    setBusy(true)
    setNote('выполняется…')
    setDoc(buildSrcDoc(jsCode))
    timer.current = window.setTimeout(() => {
      teardown()
      setBusy(false)
      setRes(killed(TIMEOUT_MS))
      setMs(TIMEOUT_MS)
    }, TIMEOUT_MS + 400)
  }

  function run() {
    if (kind === 'json') return runJson()
    if (kind === 'html') return runHtml()
    if (kind === 'py') return runPy()
    if (kind === 'sql') return runSql()
    if (kind === 'ts') return runTs()
    return runJs()
  }

  function runJs() {
    const p = prepare(code)
    if (!p.ok) {
      setRes({ ok: false, output: p.error })
      setMs(null)
      setNote(null)
      return
    }
    runJsCode(p.code)
  }

  async function runTs() {
    const p = prepare(code)
    if (!p.ok) {
      setRes({ ok: false, output: p.error })
      setMs(null)
      setNote(null)
      return
    }
    setBusy(true)
    setNote('транспиляция TypeScript…')
    setRes(null)
    try {
      const mod = await import('sucrase')
      const isTsx = /(tsx|jsx)/i.test(lang || '')
      const out = mod.transform(p.code, {
        transforms: isTsx ? ['typescript', 'jsx'] : ['typescript'],
        production: true,
      })
      setBusy(false)
      setNote(null)
      runJsCode(out.code)
    } catch (e) {
      setBusy(false)
      setNote(null)
      setRes({ ok: false, output: 'не удалось транспилировать TypeScript: ' + String((e as { message?: string }).message || e) })
    }
  }

  function runPy() {
    const p = preparePy(code)
    if (!p.ok) {
      setRes({ ok: false, output: p.error })
      setMs(null)
      setNote(null)
      return
    }
    setRes(null)
    setBusy(true)
    if (doc && pyReady.current && win.current && win.current.contentWindow) {
      setNote('выполняется…')
      win.current.contentWindow.postMessage({ [PY_MARK]: 1, type: 'run', code: p.code }, '*')
      timer.current = window.setTimeout(() => {
        teardown()
        setBusy(false)
        setRes(killed(PY_RUN_TIMEOUT_MS))
        setMs(PY_RUN_TIMEOUT_MS)
      }, PY_RUN_TIMEOUT_MS + 400)
      return
    }
    setNote('загрузка Python-окружения…')
    pending.current = p.code
    setDoc(buildPySrcDoc())
    timer.current = window.setTimeout(() => {
      teardown()
      setBusy(false)
      setRes({ ok: false, output: 'Python-окружение не загрузилось за ' + Math.round(PY_LOAD_TIMEOUT_MS / 1000) + ' с — проверь интернет или попробуй ещё раз' })
      setMs(null)
    }, PY_LOAD_TIMEOUT_MS)
  }

  function runSql() {
    const p = prepareSql(code)
    if (!p.ok) {
      setRes({ ok: false, output: p.error })
      setMs(null)
      setNote(null)
      return
    }
    setRes(null)
    setBusy(true)
    if (doc && sqlReady.current && win.current && win.current.contentWindow) {
      setNote('выполняется…')
      win.current.contentWindow.postMessage({ [SQL_MARK]: 1, type: 'run', code: p.code }, '*')
      timer.current = window.setTimeout(() => {
        teardown()
        setBusy(false)
        setRes(killed(SQL_RUN_TIMEOUT_MS))
        setMs(SQL_RUN_TIMEOUT_MS)
      }, SQL_RUN_TIMEOUT_MS + 400)
      return
    }
    setNote('загрузка SQLite…')
    sqlPending.current = p.code
    setDoc(buildSqlSrcDoc())
    timer.current = window.setTimeout(() => {
      teardown()
      setBusy(false)
      setRes({ ok: false, output: 'SQLite не загрузилась за ' + Math.round(SQL_LOAD_TIMEOUT_MS / 1000) + ' с — проверь интернет или попробуй ещё раз' })
      setMs(null)
    }, SQL_LOAD_TIMEOUT_MS)
  }

  function runHtml() {
    setBusy(false)
    setNote(null)
    setHtml(buildHtmlDoc(code, lang || ''))
  }

  function runJson() {
    setBusy(false)
    setNote(null)
    const r = checkJson(code)
    if (!r.ok) {
      setRes({ ok: false, output: r.output })
      setMs(null)
      return
    }
    setRes({ ok: true, output: r.output })
    setMs(null)
  }

  const out = res
  const loadingLabel = kind === 'py'
    ? (pyReady.current ? 'выполняется' : 'загрузка Python')
    : kind === 'sql'
      ? (sqlReady.current ? 'выполняется' : 'загрузка SQLite')
      : kind === 'html' ? 'превью…'
        : kind === 'json' ? 'проверка…'
          : 'выполняется'
  const idleLabel = kind === 'html' ? 'Превью' : kind === 'json' ? 'Проверить' : 'Запустить'
  const doneLabel = kind === 'html' ? 'Обновить' : 'Ещё раз'
  const label = busy ? loadingLabel : (out ? doneLabel : idleLabel)
  const canSend = !!(out && onSend && (kind === 'js' || kind === 'py' || kind === 'sql' || kind === 'ts'))

  return (
    <div className="code-run">
      <div className="run-bar">
        <button type="button" className="run-btn" onClick={run} disabled={busy}>
          {busy ? <RotateCcw size={13} /> : <Play size={13} />}
          {label}
        </button>
        {canSend ? (
          <button
            type="button"
            className="run-btn ghost"
            onClick={() => onSend!('Вывод из песочницы (код ниже я запустил сам):\n' + out!.output + '\n\nЕсли упало — поправь код и дай снова готовый блок.')}
          >
            <ArrowUp size={13} /> Вывод — модели
          </button>
        ) : null}
        {ms !== null ? <span className="run-ms">{out && out.killed ? 'по таймауту' : ms + ' мс'}</span> : null}
      </div>
      {doc !== null ? (
        <iframe ref={win} className="run-frame" title="песочница" srcDoc={doc} sandbox="allow-scripts" />
      ) : null}
      {html !== null ? (
        <iframe className="run-preview" title="превью" srcDoc={html} sandbox="allow-scripts" />
      ) : null}
      {note ? <div className="run-note">{note}</div> : null}
      {out && kind !== 'html' ? (
        <pre className={'run-out' + (out.ok ? '' : out.killed ? ' timeout' : ' err')}>
          {out.output}
          {out.hint ? '\nподсказка: ' + out.hint : ''}
        </pre>
      ) : null}
    </div>
  )
}
