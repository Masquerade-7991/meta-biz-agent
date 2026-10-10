import { useSyncExternalStore } from 'react'

// Light, dark or follow the system. A per-viewer preference, so it lives in this browser only.
export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'helo-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** The theme on screen right now: the saved choice, or the system's when it follows the system. */
export const isDark = () => document.documentElement.classList.contains('dark')

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
  notify()
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  apply(choice)
}

/** Flips between light and dark from whatever is on screen, and saves that as the choice. */
export const toggleTheme = () => setTheme(isDark() ? 'light' : 'dark')

/** Applies the saved choice and follows the system while the choice is "system". Call once, early. */
export function initTheme() {
  apply(getTheme())
  media().addEventListener('change', () => getTheme() === 'system' && apply('system'))
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** True while the dark theme is on screen; re-renders when the theme changes from anywhere. */
export const useIsDark = () => useSyncExternalStore(subscribe, isDark)
