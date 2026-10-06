// Comfortable or compact lists (tables, the Inbox's chat list). A per-viewer preference, kept in
// this browser; tailwind.css reads it from <html data-density>.
export type Density = 'comfortable' | 'compact'
const KEY = 'helo-density'

export function getDensity(): Density {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

export function setDensity(d: Density) {
  try {
    if (d === 'compact') localStorage.setItem(KEY, d)
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: lasts for this page only
  }
  document.documentElement.dataset.density = d
}

export const initDensity = () => void (document.documentElement.dataset.density = getDensity())
