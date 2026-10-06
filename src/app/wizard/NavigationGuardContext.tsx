import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** 'save' = the user is trying to proceed (Next / Save and close): guard should save first.
 *  'discard' = the user is trying to leave without saving (Back / Exit): guard should just warn. */
export type NavIntent = 'save' | 'discard'
export type NavGuard = (intent: NavIntent) => Promise<boolean>

/** What the open section reports, so the studio header can say it truthfully. */
export interface SaveStatus {
  dirty: boolean
  saving: boolean
  /** When the open section last finished a save (ms), or null. */
  savedAt: number | null
}

interface NavigationGuardContextValue {
  registerGuard: (guard: NavGuard | null) => void
  runGuard: (intent: NavIntent) => Promise<boolean>
  pending: boolean
  status: SaveStatus
  reportStatus: (s: { dirty: boolean; saving: boolean }) => void
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null)

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<NavGuard | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<SaveStatus>({ dirty: false, saving: false, savedAt: null })
  const reportStatus = useCallback((next: { dirty: boolean; saving: boolean }) => {
    setStatus((prev) => {
      const savedAt = prev.saving && !next.saving && !next.dirty ? Date.now() : prev.savedAt
      return prev.dirty === next.dirty && prev.saving === next.saving && prev.savedAt === savedAt ? prev : { ...next, savedAt }
    })
  }, [])

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
    () => ({ registerGuard, runGuard, pending, status, reportStatus }),
    [registerGuard, runGuard, pending, status, reportStatus],
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

/** A section tells the studio header whether it has unsaved changes or is saving. */
export function useReportSaveStatus(dirty: boolean, saving: boolean) {
  const { reportStatus } = useNavigationGuard()
  useEffect(() => reportStatus({ dirty, saving }), [reportStatus, dirty, saving])
  useEffect(() => () => reportStatus({ dirty: false, saving: false }), [reportStatus])
}
