import { useEffect, useRef, type DependencyList } from 'react'

/** Runs `fn` now and then every `ms` while the tab is visible; starts over when `deps` change.
 *  `enabled: false` pauses it. Always calls the latest `fn`, so callers needn't memoise it. */
export function usePolling(fn: () => void, ms: number, deps: DependencyList, enabled = true) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (!enabled) return
    latest.current()
    const t = setInterval(() => document.visibilityState === 'visible' && latest.current(), ms)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, ...deps])
}
