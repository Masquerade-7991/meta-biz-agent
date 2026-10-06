// Light, dark or follow the system. A per-viewer preference, so it lives in this browser only.
export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'helo-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
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

/** Applies the saved choice and follows the system while the choice is "system". Call once, early. */
export function initTheme() {
  apply(getTheme())
  media().addEventListener('change', () => getTheme() === 'system' && apply('system'))
}
