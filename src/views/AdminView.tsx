/**
 * Админ-панель (0.176) — то, что видит только владелец.
 *
 * Просьба владельца: «У меня сразу будет стоять айди, и в разделах будет пункт меню
 * админа», а в панели — «устройства + обращения»: список телефонов с ID, моделью,
 * версией и когда заходили, плюс обращения с этими же данными.
 *
 * Зачем список устройств отдельным экраном, а не «побольше данных в обращениях»:
 * так видно и тех, кто ни одной ошибки не присылал, — сколько людей вообще заходит,
 * с каких телефонов, на какой версии. Обращения — вкладка рядом, чтобы не бегать
 * по двум меню за одной мыслью.
 *
 * Замок здесь один и тот же, что у обращений: сервер пускает по отпечатку кода
 * владельца. Показывать «нет доступа» вместо панели — правильный ответ, а не поломка.
 */
import { Inbox, RefreshCw, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, IconButton, Segmented } from '../components/ui'
import { humanDate, ownerCode } from '../lib/report'
import { ReportsView } from './ReportsView'

/** Строка устройства — ровно то, что просил владелец, без лишних столбцов. */
interface DeviceRow {
  id: string
  model: string
  ver: string
  owner: boolean
  firstAt: number
  lastAt: number
  visits: number
  reports: number
}

export function AdminView({ notify }: { notify: (msg: string) => void }) {
  const [tab, setTab] = useState<'devices' | 'reports'>('devices')
  const [list, setList] = useState<DeviceRow[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/device?owner=1', { headers: { 'x-mt-owner': ownerCode() } })
      if (r.status === 403) {
        setErr('нет доступа — админ-панель открывается только владельцу')
        setList([])
        return
      }
      const d = await r.json()
      if (!d || !d.ok) {
        setErr(String((d && d.error) || 'не загрузилось'))
        setList([])
        return
      }
      setList((d.devices || []) as DeviceRow[])
    } catch {
      setErr('сеть не ответила — попробуйте ещё раз')
      setList([])
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="container view admin-view">
      <div className="page-head">
        <div className="grow">
          <h1>Админ</h1>
          <p className="sub">Устройства и обращения. Экран виден только владельцу.</p>
        </div>
        <IconButton icon={Inbox} label="Обновить" onClick={() => void load()} />
      </div>

      <div className="rep-toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'devices', label: 'Устройства' },
            { value: 'reports', label: 'Обращения' },
          ]}
        />
        <Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={busy}>
          {busy ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>

      {tab === 'reports' ? (
        /* Обращения — тот же экран, что и раньше, только без своего заголовка:
           он теперь внутри панели, и два заголовка подряд смотрелись бы ошибкой. */
        <ReportsView notify={notify} embedded />
      ) : (
        <>
          {err ? <div className="auth-error">{err}</div> : null}
          {list && list.length === 0 && !err ? (
            <div className="rows-row is-plain">
              <div className="rows-hint">
                Пока никого: как только кто-то зайдёт в приложение, здесь появится его телефон,
                ID и время захода.
              </div>
            </div>
          ) : null}

          {(list || []).map((d) => (
            <div className="rows-row is-plain dev-row" key={d.id + d.model + d.firstAt}>
              <span className="rows-ic" aria-hidden="true">
                <Smartphone size={20} />
              </span>
              <span className="rows-name">
                {d.id ? '#' + d.id : 'без ID'}
                {d.owner ? <Badge tone="blue">Разработчик</Badge> : null}
              </span>
              <span className="dev-meta">
                {d.model || 'модель неизвестна'}
                {d.ver ? ' · v' + d.ver : ''}
                {d.reports ? ' · обращений: ' + d.reports : ' · обращений нет'}
              </span>
              <span className="dev-when">
                заходил: {d.lastAt ? humanDate(d.lastAt) : '—'}
                {d.visits > 1 ? ' · заходов: ' + d.visits : ''}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
