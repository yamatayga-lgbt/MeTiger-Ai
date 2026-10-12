/**
 * Кольцо общего запаса агента (0.179) — кнопка «Просмотреть лимиты» в шапке,
 * рядом с Workspace.
 *
 * Просьба владельца дословно: «удобная кнопка как „Просмотреть лимиты“ рядом с
 * иконкой Воркспейса, будет иконка похожая на лимиты… с 100 % зелёный, потом
 * немного прижелтевшее, на 50 % жёлтое, потом немного до красного, и 0 % красный
 * мигает… только проценты до сотых: 100.0 %, 91,2 %».
 *
 * Почему кольцо, а не третья иконка в меню: состояние видно, не открывая ничего, а
 * нажатие ведёт туда, где цифра разложена по источникам. Второй вариант владельца
 * — полоска под полем ввода — он сам отклонил, поэтому в поле ввода ничего не
 * добавлено (за этим следит test/ui179.test.js).
 *
 * Число берётся из того же /api/usage, что и панель: сервер отдаёт готовый `pool`
 * (движок, poolOf), фронт не считает свой процент — иначе в шапке и на экране
 * стояли бы разные цифры об одном и том же.
 *
 * Опрос редкий, раз в минуту: в отличие от панели, кольцо висит в шапке всё время,
 * и частить ему незачем — числа меняются только вместе с запросами человека, а
 * каждое обращение к /api/usage стоит чтения из KV. Скрытая вкладка не опрашивается
 * вовсе (это уже внутри useUsageLive).
 */
import type { CSSProperties } from 'react'
import { haptic } from '../lib/haptic'
import { fmtPct, isExhausted, poolLine, ringHue, type LimitsPool } from '../lib/limits'
import { useUsageLive } from '../lib/usage'

/** Раз в минуту: чаще незачем — цифра меняется от запросов, а не от времени. */
export const RING_EVERY_MS = 60000

/** Кольцо как картинка: без нажатия, без опроса — для панели и для подписи. */
export function LimitsRingGlyph({ pct, size = 22, stroke = 2.6 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <svg
      className="limits-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* Дорожка кольца — тем же цветом, но почти прозрачным: на свету и в темноте
          она остаётся видимой, а «пустая» часть понятна без второй палитры. */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/**
 * Кнопка в шапке. Пока чисел нет (первый заход, нет сети) — ничего не рисуем:
 * «пустое» кольцо на 0 % сообщало бы о кончившемся запасе, которого никто не
 * измерял. Появились числа — кольцо и процент встают на место.
 */
export function LimitsRing({ onOpen }: { onOpen: () => void }) {
  const { data } = useUsageLive(true, RING_EVERY_MS)
  const pool: LimitsPool | null = (data && data.pool) || null
  const pct = pool && pool.pct != null ? pool.pct : null
  if (pct == null) return null

  const empty = isExhausted(pct)
  return (
    <button
      type="button"
      className={'limits-btn' + (empty ? ' is-empty' : '')}
      /* Тон уезжает в CSS переменной, а светлота — в правилах тем: одна и та же
         дорога «зелёное → красное» работает и на светлом, и на тёмном фоне. */
      style={{ '--ring-h': String(Math.round(ringHue(pct) * 10) / 10) } as CSSProperties}
      aria-label={`Просмотреть лимиты: общий запас агента ${fmtPct(pct)} (${poolLine(pool)})`}
      title={`Общий запас агента: ${fmtPct(pct)} · ${poolLine(pool)}`}
      onClick={() => {
        haptic('light')
        onOpen()
      }}
    >
      <LimitsRingGlyph pct={pct} />
      <span className="limits-pct">{fmtPct(pct)}</span>
    </button>
  )
}
