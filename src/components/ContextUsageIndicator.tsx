/**
 * Заполнение контекста (0.170).
 *
 * Показывает, сколько окна модели занял последний запрос: полоска, процент и — когда
 * места почти не осталось — предупреждение словами. Цифры приходят готовыми из ответа
 * движка (props.ctxUsage): фронт не знает ни системных подсказок, ни окна выбранной
 * модели, поэтому любая его собственная оценка была бы выдумкой. Нет данных — нет
 * индикатора: полоска «0 %» врала бы про пустой контекст.
 *
 * Процент считается прямо в разметке, без состояния и useEffect: раньше компонент
 * сначала рисовал 0 %, потом перерисовывался на настоящем числе — человек видел
 * мигание на каждом ответе.
 */

interface ContextUsageIndicatorProps {
  /** Сколько токенов занял запрос (числа движка, не оценка фронта). */
  usedTokens: number;
  /** Окно модели в токенах. Ноль или меньше — показывать нечего. */
  maxTokens: number;
  /** Показывать ли предупреждение, когда места почти не осталось. */
  showWarning?: boolean;
  /** Порог предупреждения, доля от окна (по умолчанию 0.8). */
  warningThreshold?: number;
}

/** Цвет полоски по заполнению: зелёный → жёлтый → оранжевый → красный. */
function barColor(percent: number): string {
  if (percent >= 90) return '#ef4444';
  if (percent >= 80) return '#f97316';
  if (percent >= 70) return '#eab308';
  return '#22c55e';
}

export function ContextUsageIndicator({
  usedTokens,
  maxTokens,
  showWarning = true,
  warningThreshold = 0.8,
}: ContextUsageIndicatorProps) {
  if (!(maxTokens > 0)) return null;
  const used = Math.max(0, Math.round(usedTokens || 0));
  const percent = Math.min(100, Math.round((used / maxTokens) * 100));
  const warn = showWarning && percent >= warningThreshold * 100;
  return (
    <div className="context-usage-indicator" aria-label="Заполнение контекста">
      <div className="context-usage-bar-container" role="presentation">
        <div
          className="context-usage-bar"
          style={{ width: `${percent}%`, backgroundColor: barColor(percent) }}
        />
      </div>
      <span className={`context-usage-text${warn ? ' context-usage-warning' : ''}`}>
        {percent}% ({used.toLocaleString('ru-RU')} / {maxTokens.toLocaleString('ru-RU')} токенов)
      </span>
      {warn ? <span className="context-usage-alert">Контекст почти заполнен</span> : null}
    </div>
  );
}
