import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Play, RotateCcw } from 'lucide-react'
import { buildSrcDoc, killed, normalize, prepare, TIMEOUT_MS } from '../lib/sandbox'
import { MARK } from '../lib/sandbox'

/**
 * Кнопка запуска у блока кода.
 *
 * Исполнение — в iframe с `sandbox="allow-scripts"` и БЕЗ allow-same-origin: страница
 * получает чужой opaque-origin, то есть код не видит ни наши cookie, ни localStorage,
 * ни запросы на наш адрес; сеть ему дополнительно отрезана CSP внутри документа
 * (см. src/lib/sandbox.ts). После ответа iframe снимается: бесконечный цикл извне
 * не остановить, можно только убить вкладку вместе с ним — этим и занят watchdog.
 */
interface Props {
  code: string
  /** Передать вывод модели, чтобы она прочитала ошибку и поправила код. */
  onSend?: (text: string) => void
}

export function CodeRunner({ code, onSend }: Props) {
  const [doc, setDoc] = useState<string | null>(null)
  const [res, setRes] = useState<{ ok: boolean; output: string; hint?: string; killed?: boolean } | null>(null)
  const [ms, setMs] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const win = useRef<HTMLIFrameElement | null>(null)
  const timer = useRef<number | null>(null)

  /* Слушатель вешается на окно, а не на iframe: событие приходит от дочернего окна,
     и единственный способ не принять чужое сообщение — сверить и источник, и метку. */
  useEffect(() => {
    if (!doc) return
    const onMsg = (e: MessageEvent) => {
      const fr = win.current && win.current.contentWindow
      if (!fr || e.source !== fr) return
      const d = e.data as Record<string, unknown>
      if (!d || d[MARK] !== 1) return
      stop()
      const out = normalize({ logs: d.logs as string[], value: d.value as string, error: d.error as string, stack: d.stack as string, ms: d.ms as number }, code)
      setRes(out)
      setMs(typeof d.ms === 'number' ? d.ms : null)
      setNote(null)
    }
    window.addEventListener('message', onMsg)
    timer.current = window.setTimeout(() => {
      stop()
      const k = killed(TIMEOUT_MS)
      setRes(k)
      setMs(TIMEOUT_MS)
    }, TIMEOUT_MS + 400) /* сам iframe ещё ~400 мс на доставку сообщения: не резать живой код */
    return () => {
      window.removeEventListener('message', onMsg)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [doc, code])

  function stop() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setDoc(null) /* сняли iframe — убит и цикл, если он там был */
  }

  function run() {
    const p = prepare(code)
    if (!p.ok) {
      setRes({ ok: false, output: p.error })
      setMs(null)
      setNote(null)
      return
    }
    setRes(null)
    setNote('выполняется…')
    setDoc(buildSrcDoc(p.code))
  }

  const out = res
  return (
    <div className="code-run">
      <div className="run-bar">
        <button type="button" className="run-btn" onClick={run} disabled={doc !== null}>
          {doc !== null ? <RotateCcw size={13} /> : <Play size={13} />}
          {doc !== null ? 'выполняется' : out ? 'Ещё раз' : 'Запустить'}
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
