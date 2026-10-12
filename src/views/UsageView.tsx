/**
 * «Использование и Лимиты» — расход провайдеров и потолки, живьём.
 *
 * Экран отвечает на вопрос, который до него приходилось выяснять curl'ом: почему
 * агент сегодня отвечает хуже и у кого кончилась квота. Рядом стоят две правды —
 * серверная (все запросы ко всем провайдерам за сутки UTC) и своя, с этого
 * устройства (мгновенная и точная, но только про этого человека), — и они не
 * смешиваются в одно число, потому что означают разное.
 */
import { Activity, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { LimitsRingGlyph } from '../components/LimitsRing'
import { Toast } from '../components/Toast'
import { Badge, Button, cx } from '../components/ui'
import { fmtPct, poolLine, ringHue } from '../lib/limits'
import { clearSpeed, fmtSec, speedSummary, telemetrySummary, type SpeedSummary } from '../lib/models'
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

/** Русское число с существительным: «1 имя», «2 имени», «5 имён». */
function plural(n: number, one: string, few: string, many: string): string {
  const t = n % 100
  if (t >= 11 && t <= 14) return many
  const d = n % 10
  if (d === 1) return one
  if (d >= 2 && d <= 4) return few
  return many
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

  const [speed, setSpeed] = useState<SpeedSummary>(() => speedSummary())
  const [toast, setToast] = useState<string | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  /* Экран открыт — числа обновляем вместе с опросом счётчика (раз в 5 с). */
  useEffect(() => {
    setSpeed(speedSummary())
  }, [at])

  const device = telemetrySummary()
  const rows = data?.providers || []
  const minuteSum = rows.reduce((a, r) => a + (r.minute || 0), 0)
  const totals = data?.totals || { attempt: 0, ok: 0, refused: 0, dead: 0 }
  const workRows = rows.filter((r) => r.live)
  /* «С ключом» — буквально: у LLM7 и Kilo ключа нет вовсе, и звать их ключевыми
     значило бы написать в панели неправду. Считаем отдельно. */
  const keyed = workRows.filter((r) => (r.keys || 0) > 0).length
  const keyless = workRows.length - keyed

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

      {/* Общий запас агента (0.179) — та же цифра, что на кольце в шапке: человек
          нажал «посмотреть лимиты» и первым делом видит, откуда взялся процент. */}
      {data && data.pool && data.pool.pct != null ? (
        <div className="usage-pool">
          <span className="usage-pool-ring" style={{ '--ring-h': String(Math.round(ringHue(data.pool.pct!) * 10) / 10) } as CSSProperties}>
            <LimitsRingGlyph pct={data.pool.pct} size={36} stroke={3.4} />
          </span>
          <div className="grow">
            <div className="usage-pool-n">Общий запас агента: {fmtPct(data.pool.pct)}</div>
            <div className="usage-pool-d">
              {poolLine(data.pool)} · источников за цифрой: {data.pool.live}
            </div>
          </div>
        </div>
      ) : null}

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

      {/* Живость и скорость (0.164). Стоит выше серверных чисел нарочно: это
          единственное, что остаётся правдой, даже если /api/usage молчит, —
          замеры лежат на устройстве. Токены в секунду тут не показываем: человеку
          важно, когда агент заговорил и отвечает ли он вообще. */}
      <div className="settings-group">
        <div className="settings-label">Живость и скорость · по этому устройству</div>
        <div className="settings-card">
          <div className="speed-grid">
            <div className="usage-card">
              <div className="usage-cap">Первый ответ</div>
              <div className="usage-num">{speed.firstSample ? fmtSec(speed.firstP50) : '—'}</div>
              <div className="usage-sub">
                {speed.firstSample
                  ? `половина ответов начиналась быстрее · по ${speed.firstSample} ${plural(speed.firstSample, 'ответу', 'ответам', 'ответам')}`
                  : 'пока нет замеров — задайте пару вопросов'}
              </div>
            </div>
            <div className="usage-card">
              <div className="usage-cap">Худший случай</div>
              <div className="usage-num">{speed.firstSample ? fmtSec(speed.firstP95) : '—'}</div>
              <div className="usage-sub">
                {speed.firstSample ? '19 из 20 ответов начинались быстрее' : 'появится со вторым-третьим ответом'}
              </div>
            </div>
            <div className="usage-card">
              <div className="usage-cap">Что живо</div>
              <div className="usage-num">{data ? `${workRows.length}/${rows.length}` : '…'}</div>
              <div className="usage-sub">
                {data
                  ? `провайдеров с ключом · отвечали сегодня ${totals.ok}`
                  : 'спрашиваю счётчик'}
              </div>
            </div>
          </div>
          {speed.emptySample > 0 ? (
            <div className="settings-row">
              <div className="grow">
                <div className="n">
                  {speed.emptyCount === 0
                    ? 'Пустых ответов не было'
                    : `Пустых ответов ${speed.emptyCount} из ${speed.emptySample}`}
                </div>
                <div className="d">
                  {speed.emptyCount === 0
                    ? `за ${speed.emptySample} ${plural(speed.emptySample, 'ответ', 'ответа', 'ответов')} ни одного пустого — агент отвечал каждый раз`
                    : `${Math.round((speed.emptyCount / speed.emptySample) * 100)} % · это ответы без текста (одна мысль не в счёт)`}
                </div>
              </div>
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  clearSpeed()
                  setSpeed(speedSummary())
                  setToast('Замеры сброшены')
                }}
              >
                Сбросить
              </Button>
            </div>
          ) : null}
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
          <div className="settings-label">
            Провайдеры · {keyed} с ключом{keyless > 0 ? ` и ${keyless} без ключа` : ''}
          </div>
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

      {/* Подхват (0.100, сокращён в 0.103): одна строка со счётчиком.
          Перечисление имён моделей убрано по просьбе владельца — здесь важен сам
          факт «ответ не пропадёт», а имена уместны в списке моделей, не тут.
          Число по-прежнему приходит из /api/usage (failover.count). */}
      {data?.failover && data.failover.count > 0 ? (
        <div className="settings-group">
          <div className="settings-label">
            Подхват · {data.failover.count} {plural(data.failover.count, 'имя', 'имени', 'имён')} у двух
            провайдеров
          </div>
        </div>
      ) : null}

      <Toast message={toast} onDone={closeToast} />

      <div className="app-foot">
        Сутки — по UTC, как у провайдеров: сброс в 00:00 UTC (03:00 по Минску).
        <br />
        Числа без прикрас: «в день» — сложение изолятов, «в минуту» — нижняя оценка.
      </div>
    </div>
  )
}
