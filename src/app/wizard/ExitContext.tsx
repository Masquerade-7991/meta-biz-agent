import { createContext, useContext, type ReactNode } from 'react'
import type { NavId } from '@/app/nav'

/** Leaves the agent studio, optionally straight to a console page (e.g. Overview → Inbox). */
type Exit = (page?: NavId) => void
const ExitContext = createContext<Exit | null>(null)

export function ExitProvider({ onExit, children }: { onExit: Exit; children: ReactNode }) {
  return <ExitContext.Provider value={onExit}>{children}</ExitContext.Provider>
}

/** Lets a step navigate back to the agents list without threading onExit through every step's
 *  props — used by Test & publish's activation success banner. */
export function useExitWizard() {
  const ctx = useContext(ExitContext)
  if (!ctx) throw new Error('useExitWizard must be used within ExitProvider')
  return ctx
}
