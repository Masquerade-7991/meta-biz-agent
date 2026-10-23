import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { activeScope, setScope, type OmnibarScope, type ScopeEntries } from './scope'

type Register = (id: string, scope: OmnibarScope | null) => void
const RegisterContext = createContext<Register>(() => {})
const ScopeContext = createContext<OmnibarScope | null>(null)

/** Holds the scopes pages register; the omnibar reads the innermost (scope.ts activeScope). Two
 *  contexts, so registering never re-renders the pages, only the omnibar. */
export function OmnibarProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ScopeEntries>({})
  const seq = useRef(0)
  const register = useCallback<Register>((id, scope) => setEntries((prev) => setScope(prev, id, scope, ++seq.current)), [])
  const active = useMemo(() => activeScope(entries), [entries])
  return (
    <RegisterContext.Provider value={register}>
      <ScopeContext.Provider value={active}>{children}</ScopeContext.Provider>
    </RegisterContext.Provider>
  )
}

/** A page (or a tab inside one) says what the omnibar searches while it's on screen. Memoise the
 *  scope: the omnibar follows every change, and the page's scope is removed when it unmounts. */
export function useOmnibarScope(scope: OmnibarScope | null) {
  const register = useContext(RegisterContext)
  const id = scope?.id
  useEffect(() => {
    if (scope) register(scope.id, scope)
  }, [register, scope])
  useEffect(() => {
    if (!id) return
    return () => register(id, null)
  }, [register, id])
}

/** The scope the omnibar shows now (the innermost mounted). */
export const useOmnibarActiveScope = () => useContext(ScopeContext)
