import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'mt-theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* noop */
  }
  return 'system'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}


export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(systemTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme =
    pref === 'system' ? system : pref

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    /* Системная полоса телефона (адресная строка/статус-бар) — в цвет темы.
       Со стеклом это заметнее, чем раньше: полупрозрачная шапка не должна
       упираться в чужой по цвету кусок системного интерфейса. */
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0a0c' : '#f7f6f2')
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* noop */
    }
  }, [pref, resolved])

  const toggle = useCallback(() => {
    setPref((p) => {
      const cur = p === 'system' ? systemTheme() : p
      return cur === 'dark' ? 'light' : 'dark'
    })
  }, [])

  return { pref, resolved, setPref, toggle }
}
