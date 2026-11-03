import { useSyncExternalStore } from 'react'

// Thème clair/sombre sans script en ligne (compatible avec la politique de sécurité du contenu)
export type Theme = 'light' | 'dark' | 'system'
const KEY = 'budget:theme'
const mq = matchMedia('(prefers-color-scheme: dark)')
let theme: Theme = (localStorage.getItem(KEY) as Theme | null) ?? 'system'
const listeners = new Set<() => void>()

function apply() {
  const dark = theme === 'dark' || (theme === 'system' && mq.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  listeners.forEach((l) => l())
}
apply()
mq.addEventListener('change', apply)

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export function useTheme() {
  const t = useSyncExternalStore(subscribe, () => theme)
  return {
    theme: t,
    resolvedTheme: (t === 'dark' || (t === 'system' && mq.matches) ? 'dark' : 'light') as 'dark' | 'light',
    setTheme: (v: Theme) => { theme = v; localStorage.setItem(KEY, v); apply() },
  }
}
