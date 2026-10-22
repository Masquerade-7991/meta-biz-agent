// Unsaved settings never vanish silently: forms with changes register here, and every in-app way of
// leaving (Settings tabs and links, the sidebar, ⌘K) asks first. Closing or reloading the tab gets
// the browser's own prompt.
import { useEffect } from 'react'

const dirty = new Set<string>()
type Ask = (answer: (leave: boolean) => void) => void
let ask: Ask | null = null

export const hasUnsaved = () => dirty.size > 0
/** The dialog that asks (LeaveGuardHost) registers itself; without it the browser's confirm asks. */
export const setLeaveAsker = (fn: Ask | null) => void (ask = fn)

/** Resolves true when it's fine to leave: nothing unsaved, or the person chose to discard. */
export function confirmLeave(): Promise<boolean> {
  if (!hasUnsaved()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const answer = (leave: boolean) => {
      if (leave) dirty.clear()
      resolve(leave)
    }
    if (ask) ask(answer)
    else answer(window.confirm('Discard your changes? You have unsaved changes on this page.'))
  })
}

// One listener for every form, added once: a form cleaning up must not take the prompt from the others.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!hasUnsaved()) return
    e.preventDefault()
    e.returnValue = ''
  })
}

/** Marks one form as having unsaved changes while `on` is true. */
export function useLeaveGuard(id: string, on: boolean) {
  useEffect(() => {
    if (!on) return
    dirty.add(id)
    return () => {
      dirty.delete(id)
    }
  }, [id, on])
}
