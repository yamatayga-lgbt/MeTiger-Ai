/**
 * «Обращения» (0.173) — служебный экран владельца: сюда приходят сообщения об
 * ошибках от людей, и здесь же они закрываются двумя кнопками.
 *
 * Экран открывается только с устройства, где введён код владельца (вход —
 * «Информация», пять тапов по версии). Других пользователей он не касается: у
 * них пункт «Сообщить об ошибке» отправляет форму, а списка обращений нет вовсе.
 *
 * Порядок чтения выбран под телефон: сверху свежие, у каждого обращения видно
 * время, версию приложения и снимки — то, по чему владелец решает, «Рассмотрено»
 * или «Отказано». Решение сразу уезжает на сервер; никаких «отправить ещё раз».
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bug, Check, Image as ImageIcon, Inbox, Loader2, RefreshCw, X } from 'lucide-react'
import { Badge, Button, Segmented } from '../components/ui'
import {
  humanDate, loadReport, loadReports, ownerCode, setReportVerdict,
  type ReportFull, type ReportSummary,
} from '../lib/report'
import { haptic } from '../lib/haptic'

interface ReportsViewProps {
  notify: (msg: string) => void
  /** Внутри админ-панели (0.176) экран идёт без своего заголовка: он уже есть. */
  embedded?: boolean
}

const статусСловом = (s: ReportSummary['status']) =>
  s === 'done' ? 'Рассмотрено' : s === 'declined' ? 'Отказано' : 'Новое'

export function ReportsView({ notify, embedded = false }: ReportsViewProps) {
  const [list, setList] = useState<ReportSummary[] | null>(null)
  const [fresh, setFresh] = useState(0)
  const [filter, setFilter] = useState<'new' | 'all'>('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<ReportFull | null>(null)
  const [opening, setOpening] = useState('')

  const load = async () => {
    setError('')
    const r = await loadReports()
    if (!r.ok) {
      setError(String(r.error || 'не загрузилось'))
      setList([])
      return
    }
    setList(r.reports)
    setFresh(r.fresh)
    /* Открыли экран, а там есть свежие — показываем именно их: владелец пришёл
       читать новое, а не листать закрытое. */
    setFilter(r.fresh > 0 ? 'new' : 'all')
  }

  useEffect(() => {
    void load()
  }, [])

  const openOne = async (id: string) => {
    setOpening(id)
    const r = await loadReport(id)
    setOpening('')
    if (!r.ok || !r.report) {
      notify(String(r.error || 'обращение не открылось'))
      return
    }
    setOpen(r.report)
  }

  const verdict = async (id: string, v: 'done' | 'declined') => {
    setBusy(id)
    const ok = await setReportVerdict(id, v)
    setBusy('')
    if (!ok) {
      notify('не сохранилось — попробуйте ещё раз')
      return
    }
    haptic('medium')
    /* Свежих стало на одно меньше — только если это обращение и правда было новым:
       передумать по уже закрытому можно, счётчик от этого не растёт. */
    const wasFresh = (list || []).some((r) => r.id === id && r.status === 'new')
    setList((prev) => (prev || []).map((r) => (r.id === id ? { ...r, status: v, verdictAt: Date.now() } : r)))
    if (wasFresh) setFresh((n) => Math.max(0, n - 1))
    setOpen((prev) => (prev && prev.id === id ? { ...prev, status: v, verdictAt: Date.now() } : prev))
    notify(v === 'done' ? 'Помечено «Рассмотрено»' : 'Помечено «Отказано»')
  }

  const shown = (list || []).filter((r) => (filter === 'new' ? r.status === 'new' : true))

  return (
    <div className={embedded ? 'rep-view is-embedded' : 'container view rep-view'}>
      {embedded ? null : (
        <div className="page-head">
          <div className="grow">
            <h1>Обращения</h1>
            <p className="sub">
              Сообщения об ошибках от людей. Видно только владельцу: вход по коду{' '}
              {ownerCode() ? 'выполнен' : 'не выполнен'}.
            </p>
          </div>
          <Inbox size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
        </div>
      )}

      <div className="rep-toolbar">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v)}
          options={[
            { value: 'new', label: `Новые${fresh ? ' · ' + fresh : ''}` },
            { value: 'all', label: 'Все' },
          ]}
        />
        <button type="button" className="rep-refresh" aria-label="Обновить" onClick={() => { haptic('light'); void load() }}>
          <RefreshCw size={15} />
        </button>
      </div>

      {error ? <div className="rep-error">{error}</div> : null}

      {list === null ? (
        <div className="rep-empty"><Loader2 size={16} className="rep-spin" /> загружаю…</div>
      ) : shown.length === 0 ? (
        <div className="rep-empty">
          <Bug size={18} />
          {filter === 'new' && list.length > 0
            ? 'Свежих обращений нет — все разобраны.'
            : 'Пока никто не сообщал об ошибках. Как только человек отправит форму из профиля, обращение появится здесь.'}
        </div>
      ) : (
        <div className="rep-list">
          {shown.map((r) => (
            <div className={`rep-card${r.status === 'new' ? ' is-fresh' : ''}`} key={r.id}>
              <div className="rep-card-head">
                <span className={`rep-status is-${r.status}`}>{статусСловом(r.status)}</span>
                <span className="rep-when">{humanDate(r.at)}</span>
              </div>
              <div className="rep-card-text">{r.text}</div>
              <div className="rep-card-meta">
                {/* 0.176: видно, кто это и с какого телефона — владелец просил
                    «данные для устройства … и в обращениях тоже». */}
                <span className="rep-who">{r.did ? '#' + r.did : 'без ID'}</span>
                {r.model ? <span>{r.model}</span> : null}
                <span>версия {r.ver || '—'}</span>
                <span>ключ {r.uid ? r.uid.slice(0, 4) + '…' + r.uid.slice(-2) : '—'}</span>
                {r.photos > 0 ? (
                  <button type="button" className="rep-photo-link" onClick={() => { haptic('light'); void openOne(r.id) }}>
                    {opening === r.id ? <Loader2 size={13} className="rep-spin" /> : <ImageIcon size={13} />}
                    снимков: {r.photos}
                  </button>
                ) : null}
              </div>
              <div className="rep-card-foot">
                <Button
                  variant={r.status === 'done' ? 'primary' : 'ghost'}
                  onClick={() => void verdict(r.id, 'done')}
                  disabled={busy === r.id}
                >
                  {busy === r.id ? <Loader2 size={14} className="rep-spin" /> : <Check size={14} />}
                  Рассмотрено
                </Button>
                <Button
                  variant={r.status === 'declined' ? 'primary' : 'ghost'}
                  onClick={() => void verdict(r.id, 'declined')}
                  disabled={busy === r.id}
                >
                  <X size={14} />
                  Отказано
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Окно заявки — порталом по той же причине, что и форма: у экрана есть
          transform от анимации, и обычный position: fixed привязался бы к списку,
          а не к окну браузера (см. ReportSheet). */}
      {open ? createPortal(
        <div
          className="rep-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(null)
          }}
        >
          <div className="rep-sheet rep-open" role="dialog" aria-modal="true" aria-label="Обращение">
            <div className="rep-head">
              <div className="grow">
                <div className="rep-title">Обращение</div>
                <div className="rep-open-sub">
                  {humanDate(open.at)} · версия {open.ver || '—'} · устройство {open.uid || '—'}
                </div>
              </div>
              <button type="button" className="news-modal-x" aria-label="Закрыть" onClick={() => setOpen(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="rep-open-text">{open.text}</div>
            {(open.photoData && open.photoData.length ? open.photoData : []).map((src, i) => (
              <img className="rep-open-photo" src={src} alt={'Снимок ' + (i + 1)} key={i} />
            ))}
            <div className="rep-card-foot">
              <Button variant={open.status === 'done' ? 'primary' : 'ghost'} onClick={() => void verdict(open.id, 'done')}>
                <Check size={14} /> Рассмотрено
              </Button>
              <Button variant={open.status === 'declined' ? 'primary' : 'ghost'} onClick={() => void verdict(open.id, 'declined')}>
                <X size={14} /> Отказано
              </Button>
              <Badge tone={open.status === 'new' ? 'gray' : 'accent'}>{статусСловом(open.status)}</Badge>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
