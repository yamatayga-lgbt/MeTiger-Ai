import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Play, RotateCcw } from 'lucide-react'
import { buildSrcDoc, killed, normalize, prepare, sandboxKind, TIMEOUT_MS } from '../lib/sandbox'
import { MARK } from '../lib/sandbox'
import { buildPySrcDoc, normalizePy, preparePy, PY_LOAD_TIMEOUT_MS, PY_MARK, PY_RUN_TIMEOUT_MS } from '../lib/pysandbox'

/**
 * Кнопка запуска у блока кода — два движка под одним UI.
 *
 * JS: иframe создаётся на каждый запуск и выбрасывается сразу после ответа — выполнение
 * мгновенное, греть нечего (см. src/lib/sandbox.ts).
 *
 * Python: иframe с Pyodide (CPython в WebAssembly) наоборот держим живым между запусками —
 * первая загрузка рантайма занимает секунды, грузить его заново на каждую кнопку было бы
 * издевательством. Код внутрь прилетает уже после загрузки через postMessage
 * (src/lib/pysandbox.ts). Бесконечный цикл убивает тот же приём, что у JS: прервать
 * синхронный код внутри iframe нельзя, можно только снять весь iframe — тогда тёплый
 * рантайм теряется, и следующий запуск снова грузит Python с нуля (это объявлено в
 * выводе, чтобы не выглядело багом).
 */
interface Props {
  code: string
  lang?: string
  /** Передать вывод модели, чтобы она прочитала ошибку и поправила код. */
  onSend?: (text: string) => void
}

export function CodeRunner({ code, lang, onSend }: Props) {
  const kind = sandboxKind(lang || '') || 'js'
  const [doc, setDoc] = useState<string | null>(null)
  const [res, setRes] = useState<{ ok: boolean; output: string; hint?: string; killed?: boolean } | null>(null)
  const [ms, setMs] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const win = useRef<HTMLIFrameElement | null>(null)
  const timer = useRef<number | null>(null)
  const pyReady = useRef(false)
  const pending = useRef<string | null>(null)

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  /* Снять иframe целиком — для JS это конец каждого запуска, для Python — только отказ
     по таймауту (обычная удача не трогает doc, рантайм остаётся тёплым). */
  function teardown() {
    clearTimer()
    setDoc(null)
    pyReady.current = false
    pending.current = null
  }

  useEffect(() => {
    if (!doc) return
    const onMsg = (e: MessageEvent) => {
      const fr = win.current && win.current.contentWindow
      if (!fr || e.source !== fr) return
      const d = e.data as Record<string, unknown>
      if (!d) return

      if (kind === 'js') {
        if (d[MARK] !== 1) return
        teardown()
        setBusy(false)
        const out = normalize({ logs: d.logs as string[], value: d.value as string, error: d.error as string, stack: d.stack as string, ms: d.ms as number }, code)
        setRes(out)
        setMs(typeof d.ms === 'number' ? d.ms : null)
        setNote(null)
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

  function run() {
    if (kind === 'js') {
      const p = prepare(code)
      if (!p.ok) {
        setRes({ ok: false, output: p.error })
        setMs(null)
        setNote(null)
        return
      }
      setRes(null)
      setBusy(true)
      setNote('выполняется…')
      setDoc(buildSrcDoc(p.code))
      timer.current = window.setTimeout(() => {
        teardown()
        setBusy(false)
        setRes(killed(TIMEOUT_MS))
        setMs(TIMEOUT_MS)
      }, TIMEOUT_MS + 400)
      return
    }

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
      /* Рантайм уже тёплый — просто шлём новый код, иframe не трогаем. */
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

    /* Первый запуск (или рантайм был убит по таймауту раньше) — грузим Python с нуля. */
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

  const out = res
  const label = busy ? (kind === 'py' && !pyReady.current ? 'загрузка Python' : 'выполняется') : out ? 'Ещё раз' : 'Запустить'
  return (
    <div className="code-run">
      <div className="run-bar">
        <button type="button" className="run-btn" onClick={run} disabled={busy}>
          {busy ? <RotateCcw size={13} /> : <Play size={13} />}
          {label}
        </button>
        {out && onSend ? (
          <button
            type="button"
            className="run-btn ghost"
            onClick={() => onSend('Вывод из песочницы (код ниже я запустил сам):\n' + out.output + '\n\nЕсли упало — поправь код и дай снова готовый блок.')}
          >
            <ArrowUp size={13} /> Вывод — модели
          </button>
        ) : null}
        {ms !== null ? <span className="run-ms">{out && out.killed ? 'по таймауту' : ms + ' мс'}</span> : null}
      </div>
      {doc !== null ? (
        <iframe ref={win} className="run-frame" title="песочница" srcDoc={doc} sandbox="allow-scripts" />
      ) : null}
      {note ? <div className="run-note">{note}</div> : null}
      {out ? (
        <pre className={'run-out' + (out.ok ? '' : out.killed ? ' timeout' : ' err')}>
          {out.output}
          {out.hint ? '\nподсказка: ' + out.hint : ''}
        </pre>
      ) : null}
    </div>
  )
}
