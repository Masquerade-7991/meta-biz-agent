// Dummy mode: every Meta, Graph and store call is answered in this browser (dummyMeta.ts), so the
// console can be demoed with nothing reaching Meta, Helo.ai's server or MongoDB.

const FLAG_KEY = 'meta-agent-dummy-mode'
const SUFFIX = ':dummy'

function read() {
  try {
    return localStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}
// Read once: switching reloads the page, so nothing loaded from real Meta mixes with dummy data.
const on = read()
export const isDummyMode = () => on

/** Browser-storage keys get their own copy in dummy mode, so a demo never touches real cached state. */
export const storageKey = (key: string) => (on ? key + SUFFIX : key)

export function setDummyMode(next: boolean) {
  try {
    // Each switch-on starts a fresh demo: drop what the last dummy session left behind.
    if (next) for (const k of Object.keys(localStorage)) if (k.endsWith(SUFFIX)) localStorage.removeItem(k)
    if (next) localStorage.setItem(FLAG_KEY, '1')
    else localStorage.removeItem(FLAG_KEY)
  } catch {
    // storage blocked: the flag can't persist, so there's nothing to switch
  }
  location.reload()
}
