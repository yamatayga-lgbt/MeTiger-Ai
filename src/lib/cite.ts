/* Сноски как у Perplexity (0.133): «[2]» или «[2][3]» (не часть ссылки Markdown)
   → ссылка на источник sources[n-1]. Код в обратных кавычках не трогаем. */
export function linkCitations(text: string, sources?: { url: string }[]): string {
  if (!sources || !sources.length) return text
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => i % 2 ? part
    : part.replace(/(^|[^\]!\\])((?:\[\d{1,2}\])+)(?![([:])/g, (_m, pre: string, run: string) =>
      pre + run.replace(/\[(\d{1,2})\]/g, (m, n: string) => {
        const s = sources[Number(n) - 1]
        return s && /^https?:/.test(s.url) ? `[\\[${n}\\]](${s.url})` : m
      }))).join('')
}
