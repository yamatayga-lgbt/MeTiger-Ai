import { useEffect, useState } from 'react';

interface ContextUsageIndicatorProps {
  /** Текущее количество использованных токенов */
  usedTokens: number;
  /** Максимальное количество токенов в контексте */
  maxTokens: number;
  /** Показывать предупреждение при превышении порога */
  showWarning?: boolean;
  /** Порог для предупреждения (по умолчанию 80%) */
  warningThreshold?: number;
}

/**
 * Индикатор использования контекста
 * Показывает пользователю, сколько процентов контекстного окна занято
 */
export function ContextUsageIndicator({
  usedTokens,
  maxTokens,
  showWarning = true,
  warningThreshold = 0.8,
}: ContextUsageIndicatorProps) {
  const [percentage, setPercentage] = useState(0);
  const [isWarning, setIsWarning] = useState(false);

  useEffect(() => {
    if (maxTokens <= 0) {
      setPercentage(0);
      setIsWarning(false);
      return;
    }

    const calcPercentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100));
    setPercentage(calcPercentage);
    setIsWarning(showWarning && calcPercentage >= warningThreshold * 100);
  }, [usedTokens, maxTokens, showWarning, warningThreshold]);

  if (maxTokens <= 0) return null;

  // Определяем цвет индикатора
  const getColor = () => {
    if (percentage >= 90) return '#ef4444'; // Красный
    if (percentage >= 80) return '#f97316'; // Оранжевый
    if (percentage >= 70) return '#eab308'; // Жёлтый
    return '#22c55e'; // Зелёный
  };

  return (
    <div className="context-usage-indicator">
      <div className="context-usage-bar-container">
        <div
          className="context-usage-bar"
          style={{
            width: `${percentage}%`,
            backgroundColor: getColor(),
          }}
        />
      </div>
      <span className={`context-usage-text ${isWarning ? 'context-usage-warning' : ''}`}>
        {percentage}% ({usedTokens.toLocaleString()} / {maxTokens.toLocaleString()})
      </span>
      {isWarning && (
        <span className="context-usage-alert">⚠️ Контекст почти заполнен</span>
      )}
    </div>
  );
}
