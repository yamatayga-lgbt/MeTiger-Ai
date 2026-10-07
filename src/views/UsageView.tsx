/**
 * «Использование и Лимиты» — расход провайдеров и потолки, живьём.
 *
 * Экран отвечает на вопрос, который до него приходилось выяснять curl'ом: почему
 * агент сегодня отвечает хуже и у кого кончилась квота. Рядом стоят две правды —
 * серверная (все запросы ко всем провайдерам за сутки UTC) и своя, с этого
 * устройства (мгновенная и точная, но только про этого человека), — и они не
 * смешиваются в одно число, потому что означают разное.
 */
import { Activity, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, cx } from '../components/ui'
import { telemetrySummary } from '../lib/models'
import { fmtAgo, fmtDuration } from '../lib/time'
import { useUsageLive, type UsageRow } from '../lib/usage'

const EVERY_MS = 5000

/** «Обновлено N с назад» — секунды нужны, потому что экран обещает живые числа. */
function sinceLabel(at: number, now: number): string {
  if (!at) return 'ещё не спрашивали'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 3) return 'обновлено только что'
  return `обновлено ${s} с назад`
}

function ProviderBadge({ row, now }: { row: UsageRow; now: number }) {
  if (row.pause && row.pause.until > now) return <Badge tone="amber">пауза</Badge>
  if (!row.live) return <Badge tone="gray">нет ключа</Badge>
  if (row.attempt > 0) return <Badge tone="green">работает</Badge>
  return <Badge tone="blue">готов</Badge>
}

function ProviderBlock({ row, now }: { row: UsageRow; now: number }) {
  const paused = !!(row.pause && row.pause.until > now)
  const pct = row.pct == null ? (row.attempt > 0 ? 100 : 0) : row.pct
  return (
    <div className={cx('usage-prov', paused && 'is-paused')}>
      <div className="usage-prov-head">
        <div className="grow">
          <div className="n">{row.label}</div>
          <div className="d">
            {row.model
              ? `последняя: ${row.model}`
              : row.live
                ? 'ключ есть, сегодня запросов не было'
                : 'ключа нет — провайдер выпал из очереди'}
          </div>
        </div>
        <ProviderBadge row={row} now={now} />
      </div>

      <div className="usage-bar" role="presentation">
        <div
          className={cx('usage-bar-fill', pct >= 90 && 'is-full')}
          style={{ width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%` }}
        />
      </div>

      <div className="usage-meta">
        <span className="usage-k">
          <b>{row.attempt}</b>
          {row.dayLimit ? ` / ${row.dayLimit} в день` : ' запросов сегодня'}
        </span>
        {row.rpm ? (
          <span className="usage-k">
            <b>{row.minute}</b> в мин · потолок ~{row.rpm}
          </span>
        ) : null}
        {row.keys > 1 ? <span className="usage-k">{row.keys} ключей</span> : null}
        {row.lastAt ? <span className="usage-k">{fmtAgo(row.lastAt, now)}</span> : null}
        {row.refused || row.dead ? (
          <span className="usage-k">
            {row.refused ? `${row.refused} отказ` : ''}
            {row.refused && row.dead ? ' · ' : ''}
            {row.dead ? `${row.dead} сбой` : ''}
          </span>
        ) : null}
        {row.dayLimit && row.remaining != null && row.remaining <= Math.max(5, row.dayLimit * 0.1) ? (
          <span className="usage-k usage-k-warn">осталось {row.remaining}</span>
        ) : null}
      </div>

      {paused && row.pause ? (
        <div className="usage-pause">
          на паузе ещё {fmtDuration(row.pause.until - now)} · {row.pause.why}
        </div>
      ) : null}
    </div>
  )
}

export function UsageView() {
  const { data, error, at, loading, refresh } = useUsageLive(true, EVERY_MS)
  /* Секундная стрелка нужна только подписям «обновлено N с назад» и «пауза ещё N»:
     числа приходят с сервера раз в пять секунд, а не по таймеру. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const device = telemetrySummary()
  const rows = data?.providers || []
  const minuteSum = rows.reduce((a, r) => a + (r.minute || 0), 0)
  const totals = data?.totals || { attempt: 0, ok: 0, refused: 0, dead: 0 }
  const workRows = rows.filter((r) => r.live)

  return (
    <div className="container view">
      <div className="page-head">
        <div className="grow">
          <h1>Использование и Лимиты</h1>
          <p className="sub">
            Расход провайдеров за сутки по UTC
            {data ? ` · сброс квот через ${fmtDuration(data.resetInMs)}` : ''}.
          </p>
        </div>
        <Activity size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="usage-live">
        <span className={cx('usage-dot', !error && data && 'on')} />
        <span className="grow">
          {error
            ? `не обновилось: ${error}`
            : sinceLabel(at, now)}
          {' · '}
          <span className="usage-dim">само обновляется каждые {EVERY_MS / 1000} с, пока экран открыт</span>
        </span>
        <Button variant="ghost" icon={RefreshCw} onClick={() => refresh(false)} disabled={loading}>
          Обновить
        </Button>
      </div>

      <div className="usage-cards">
        <div className="usage-card">
          <div className="usage-cap">Запросов сегодня</div>
          <div className="usage-num">{totals.attempt}</div>
          <div className="usage-sub">
            {totals.ok} с ответом · {totals.refused} отказ · {totals.dead} сбой
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-cap">На этом устройстве</div>
          <div className="usage-num">{device.today}</div>
          <div className="usage-sub">
            всего {device.total} за всё время
            {device.tokPerSec ? ` · ~${device.tokPerSec} ток/с` : ''}
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-cap">В минуту</div>
          <div className="usage-num">{minuteSum}</div>
          <div className="usage-sub">нижняя оценка · по минутным маркам</div>
        </div>
        <div className="usage-card">
          <div className="usage-cap">Хранилище</div>
          <div className="usage-num">{data?.kv ? 'KV' : '—'}</div>
          <div className="usage-sub">
            {data?.kv
              ? `запись раз в ${Math.round((data.precision.writeMs || 0) / 1000)} с`
              : 'без KV — счёт живёт в памяти изолята'}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="settings-group">
          <div className="settings-card">
            <div className="settings-row">
              <div className="grow">
                <div className="n">{error ? 'Счётчик не отвечает' : 'Спрашиваю счётчик…'}</div>
                <div className="d">
                  {error
                    ? 'Числа появятся, как только ответит GET /api/usage — прежних не подставляю, чтобы не выдать их за свежие.'
                    : 'Это займёт меньше секунды.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-group">
          <div className="settings-label">Провайдеры · {workRows.length} с ключом</div>
          <div className="settings-card">
            {rows.length === 0 ? (
              <div className="settings-row">
                <div className="grow">
                  <div className="n">Провайдеров нет</div>
                  <div className="d">Ни одного ключа в окружении — движку некому отвечать.</div>
                </div>
              </div>
            ) : (
              rows.map((row) => <ProviderBlock key={row.id} row={row} now={now} />)
            )}
          </div>
        </div>
      )}

      {/* Подхват (0.100): числа, по которым видно, что отказ одного провайдера
          не оставляет человека без ответа — то же имя спросят у второго. */}
      {data?.failover && data.failover.count > 0 ? (
        <div className="settings-group">
          <div className="settings-label">Подхват · {data.failover.count} имён у двух провайдеров</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="grow">
                <div className="n">Отказ провайдера не оставляет без ответа</div>
                <div className="d">
                  {data.failover.count} имён моделей живут сразу у двух и более провайдеров: если один
                  не ответит, очередь спросит то же имя у второго, а не уйдёт на чужую слабую модель.
                </div>
              </div>
              <Badge tone="green">{data.failover.count}</Badge>
            </div>
            {data.failover.sample.map((x) => (
              <div className="settings-row" key={x.model}>
                <div className="grow">
                  <div className="n mono-line">{x.model}</div>
                  <div className="d">{x.providers.join(' · ')}</div>
                </div>
                <Badge tone="blue">×{x.providers.length}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="settings-group">
        <div className="settings-label">Как это считается</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="grow">
              <div className="n">Точность</div>
              <div className="d">
                {data?.precision.note || 'изоляты складывают числа в общее хранилище'}
                {data?.precision.writeCap
                  ? ` · не больше ${data.precision.writeCap} записей в KV на изолят за сутки, чтобы счётчик не съел чужую квоту`
                  : ''}
              </div>
            </div>
            <Badge tone="gray">≈</Badge>
          </div>
          <div className="settings-row">
            <div className="grow">
              <div className="n">Потолок на человека</div>
              <div className="d">
                {data
                  ? `${data.rate.max} запросов за ${Math.round(data.rate.windowMs / 1000)} с с одного адреса — дальше движок просит подождать`
                  : 'считается ограничителем частоты'}
              </div>
            </div>
            <Badge tone={data?.rate.on ? 'green' : 'gray'}>{data?.rate.on ? 'включён' : 'память'}</Badge>
          </div>
          <div className="settings-row">
            <div className="grow">
              <div className="n">Свои запросы</div>
              <div className="d">
                «На этом устройстве» — счёт этого браузера, он мгновенный; серверный счёт общий для
                всех и доезжает до хранилища раз в {Math.round((data?.precision.writeMs || 60000) / 1000)} с.
              </div>
            </div>
            <Badge tone="blue">{device.minutes} в мин</Badge>
          </div>
        </div>
      </div>

      <div className="app-foot">
        Сутки — по UTC, как у провайдеров: сброс в 00:00 UTC (03:00 по Минску).
        <br />
        Числа без прикрас: «в день» — сложение изолятов, «в минуту» — нижняя оценка.
      </div>
    </div>
  )
}
