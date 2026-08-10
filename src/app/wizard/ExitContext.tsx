import { createContext, useContext, type ReactNode } from 'react'

const ExitContext = createContext<(() => void) | null>(null)

export function ExitProvider({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  return <ExitContext.Provider value={onExit}>{children}</ExitContext.Provider>
}

/** Lets a step navigate back to the agents list without threading onExit through every step's
 *  props — used by Test & publish's activation success banner. */
export function useExitWizard() {
  const ctx = useContext(ExitContext)
  if (!ctx) throw new Error('useExitWizard must be used within ExitProvider')
  return ctx
}
