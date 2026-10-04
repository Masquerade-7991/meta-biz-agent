import { useEffect, useRef, type DependencyList } from 'react'
import { matchesKind, onLiveEvent } from './liveEvents'

/** Runs `fn` now and then every `ms` while the tab is visible; starts over when `deps` change.
 *  `enabled: false` pauses it. Always calls the latest `fn`, so callers needn't memoise it.
 *  `live` lists event kinds (prefixes) that also run `fn` straight away, so changes show without
 *  waiting for the timer; bursts are folded into one call. */
export function usePolling(fn: () => void, ms: number, deps: DependencyList, enabled = true, live: readonly string[] = []) {
  const latest = useRef(fn)
  latest.current = fn
  const liveKey = live.join('|')
  useEffect(() => {
    if (!enabled) return
    latest.current()
    const t = setInterval(() => document.visibilityState === 'visible' && latest.current(), ms)
    let soon: ReturnType<typeof setTimeout> | undefined
    const off = liveKey
      ? onLiveEvent((e) => {
          if (!matchesKind(e.kind, liveKey.split('|'))) return
          clearTimeout(soon)
          soon = setTimeout(() => latest.current(), 300)
        })
      : undefined
    return () => {
      clearInterval(t)
      clearTimeout(soon)
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, liveKey, ...deps])
}
