import { useCallback, useEffect, useState } from 'react'

/**
 * useState с сохранением в localStorage.
 * Ошибки хранилища (приватный режим, переполнение) молча игнорируются.
 */
export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  validate?: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (!validate || validate(parsed)) return parsed as T
      }
    } catch {
      /* noop */
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* noop */
    }
  }, [key, value])

  const reset = useCallback(() => {
    setValue(typeof initial === 'function' ? (initial as () => T)() : initial)
  }, [initial])

  return [value, setValue, reset] as const
}
