import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDummyMode } from '@/app/api/dummy'
import { UNAUTHORIZED_EVENT } from '@/app/api/meta'
import { authApi, demoMe, type Me } from './api'

// Dummy mode runs with no server (e.g. the UI-only deploy), so it signs in as a local demo owner.

interface AuthValue {
  /** undefined while loading, null when signed out. */
  me: Me | null | undefined
  setMe: (me: Me | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
  /** The API server didn't answer (e.g. only the front-end is deployed): login can't work. */
  serverDown: boolean
  /** The server answered but its database didn't (e.g. MongoDB doesn't allow this host yet). */
  databaseDown: boolean
}
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(isDummyMode() ? demoMe : undefined)
  const [serverDown, setServerDown] = useState(false)
  const [databaseDown, setDatabaseDown] = useState(false)

  const refresh = useCallback(async () => {
    if (isDummyMode()) return
    // A host without the API (a front-end-only deploy) answers /api with a 404 page, not JSON.
    const health = await fetch('/api/health')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<{ database?: string }>) : null))
      .catch(() => null)
    const dbDown = !!health && !!health.database && health.database !== 'ok'
    setServerDown(!health || dbDown)
    setDatabaseDown(dbDown)
    setMe(health && !dbDown ? await authApi.me().catch(() => null) : null)
  }, [])

  useEffect(() => {
    void refresh()
    const onUnauthorized = () => !isDummyMode() && setMe(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refresh])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setMe(null)
  }, [])

  const value = useMemo(() => ({ me, setMe, refresh, logout, serverDown, databaseDown }), [me, refresh, logout, serverDown, databaseDown])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
