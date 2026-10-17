/**
 * Сетевые «нитки» движка (0.211).
 *
 * В JavaScript/Workers настоящих потоков здесь нет — есть независимые сетевые
 * ожидания, которые глупо выстраивать в очередь друг за другом. До этого слоя
 * каталог моделей читал источники по одному, большой документ читался по
 * одной части, а дверь по очереди ждала KV-профили и карантин. Итоговая
 * задержка была суммой всех ожиданий.
 *
 * Пул намеренно ограниченный. «Все 24 вызова разом» на бесплатных тарифах —
 * не ускорение, а способ одновременно получить 24 раза 429 и сжечь квоту.
 * Поэтому параллелятся только независимые работы и с потолком: каталог — 4,
 * части документа — 3, служебные чтения двери — 3. Главная очередь моделей
 * остаётся приоритетной и последовательной: там порядок — часть качества и
 * экономии квоты, а не случайная гонка всех голов.
 */

const clampInt = (v, min, max, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Сколько независимых сетевых работ можно держать одновременно. */
export function netCfg(env) {
  const e = env || {};
  return {
    catalog: clampInt(e.NET_CATALOG_THREADS, 1, 8, 4),
    docs: clampInt(e.NET_DOC_THREADS, 1, 6, 3),
    prefetch: clampInt(e.NET_PREFETCH_THREADS, 1, 6, 3),
  };
}

/**
 * Promise.all с потолком одновременно летящих работ и сохранением порядка.
 * Ошибка worker'а пробрасывается вызывающему: этот слой не решает за него,
 * является ли отказ одного источника фатальным. Наши сетевые worker'ы сами
 * превращают отказ в результат с причиной.
 */
export async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  if (!list.length) return out;
  const width = Math.max(1, Math.min(list.length, clampInt(limit, 1, 32, 3)));
  let next = 0;

  async function lane() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await worker(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: width }, () => lane()));
  return out;
}

/** Та же работа для готовых job-функций; порядок результатов — исходный. */
export function allLimit(jobs, limit) {
  return mapLimit(jobs, limit, (job) => job());
}

/** Диагностика одним объектом — для GET /api/chat и тестов. */
export function netStats(env) {
  const cfg = netCfg(env);
  return {
    ...cfg,
    line: 'каталог ×' + cfg.catalog + ' · документы ×' + cfg.docs + ' · предчтения ×' + cfg.prefetch,
  };
}

export function lineOf(env) {
  return netStats(env).line;
}
