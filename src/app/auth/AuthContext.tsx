import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDummyMode } from '@/app/api/dummy'
import { UNAUTHORIZED_EVENT } from '@/app/api/meta'
import { authApi, type Me } from './api'

// Dummy mode runs with no server (e.g. the UI-only deploy), so it signs in as a local demo owner.
const DEMO: Me = { user: { id: 'demo', name: 'Demo User', email: 'demo@helo.ai' }, workspace: { id: 'demo', name: 'Helo Demo Store' }, role: 'owner', setup: 'complete', joining: null }

interface AuthValue {
  /** undefined while loading, null when signed out. */
  me: Me | null | undefined
  setMe: (me: Me | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
  /** The API server didn't answer (e.g. only the front-end is deployed): login can't work. */
  serverDown: boolean
}
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(isDummyMode() ? DEMO : undefined)
  const [serverDown, setServerDown] = useState(false)

  const refresh = useCallback(async () => {
    if (isDummyMode()) return
    // A host without the API (a front-end-only deploy) answers /api with a 404 page, not JSON.
    const up = await fetch('/api/health')
      .then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json'))
      .catch(() => false)
    setServerDown(!up)
    setMe(up ? await authApi.me().catch(() => null) : null)
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

  const value = useMemo(() => ({ me, setMe, refresh, logout, serverDown }), [me, refresh, logout, serverDown])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
