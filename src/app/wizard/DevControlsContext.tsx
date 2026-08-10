import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type NodeGetter = () => ReactNode

interface DevControlsContextValue {
  register: (id: string, getNode: NodeGetter | null) => void
  entries: { id: string; getNode: NodeGetter }[]
}

const DevControlsContext = createContext<DevControlsContextValue | null>(null)

export function DevControlsProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Record<string, NodeGetter>>({})

  const register = useCallback((id: string, getNode: NodeGetter | null) => {
    setRegistry((prev) => {
      if (getNode === null) {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: getNode }
    })
  }, [])

  const entries = useMemo(() => Object.entries(registry).map(([id, getNode]) => ({ id, getNode })), [registry])

  const value = useMemo<DevControlsContextValue>(() => ({ register, entries }), [register, entries])

  return <DevControlsContext.Provider value={value}>{children}</DevControlsContext.Provider>
}

function useDevControls() {
  const ctx = useContext(DevControlsContext)
  if (!ctx) throw new Error('useDevControls must be used within DevControlsProvider')
  return ctx
}

/** Any screen (or a piece of one) calls this to contribute its demo/prototype controls to the
 *  single floating panel, instead of rendering its own inline dashed-border row. Multiple callers
 *  can register at once — e.g. a step made of several mounted sub-screens each add their own
 *  entry, and the panel shows all of them together while that step is open.
 *
 *  `node` is a fresh JSX object every render, so registering it directly would make the effect's
 *  dependency array change every render and loop forever. Instead we register a stable getter
 *  (backed by a ref) once per mount, and read the ref's latest value only when the panel opens.
 *
 *  The effect also re-fires when `node`'s presence (null vs not) flips, not just on `id` change.
 *  A component that's always mounted (e.g. a dialog that toggles its controls between `open ?
 *  <Group/> : null`) never re-registers otherwise, so the panel — which only re-renders when the
 *  registry itself changes — would keep showing stale (often empty) content after the toggle.
 *  Keying on the boolean, not `node` itself, keeps this from re-firing on every render. */
export function useRegisterDevControls(id: string, node: ReactNode | null) {
  const { register } = useDevControls()
  const nodeRef = useRef(node)
  nodeRef.current = node
  const hasNode = node !== null

  useEffect(() => {
    register(id, hasNode ? () => nodeRef.current : null)
    return () => register(id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, id, hasNode])
}

export function useDevControlsEntries() {
  return useDevControls().entries
}
