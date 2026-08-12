import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** 'save' = the user is trying to proceed (Next / Save and close): guard should save first.
 *  'discard' = the user is trying to leave without saving (Back / Exit): guard should just warn. */
export type NavIntent = 'save' | 'discard'
export type NavGuard = (intent: NavIntent) => Promise<boolean>

interface NavigationGuardContextValue {
  registerGuard: (guard: NavGuard | null) => void
  runGuard: (intent: NavIntent) => Promise<boolean>
  pending: boolean
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null)

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<NavGuard | null>(null)
  const [pending, setPending] = useState(false)

  const registerGuard = useCallback((guard: NavGuard | null) => {
    guardRef.current = guard
  }, [])

  const runGuard = useCallback(async (intent: NavIntent) => {
    const guard = guardRef.current
    if (!guard) return true
    setPending(true)
    try {
      return await guard(intent)
    } finally {
      setPending(false)
    }
  }, [])

  const value = useMemo<NavigationGuardContextValue>(
    () => ({ registerGuard, runGuard, pending }),
    [registerGuard, runGuard, pending],
  )

  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
}

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext)
  if (!ctx) throw new Error('useNavigationGuard must be used within NavigationGuardProvider')
  return ctx
}

/** A section registers a guard for as long as it's mounted. AgentStudioShell consults it before a
 *  sidebar switch or Exit actually navigates away from that section. */
export function useRegisterNavGuard(guard: NavGuard | null) {
  const { registerGuard } = useNavigationGuard()
  useEffect(() => {
    registerGuard(guard)
    return () => registerGuard(null)
  }, [registerGuard, guard])
}
