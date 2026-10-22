// Lists that save the moment they change (routing rules, the escalation matrix): one request at a
// time, in order, each built on the server's last answer; a failure drops only its own change, and a
// 409 (someone else saved first) pauses the queue until the person reloads or keeps theirs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorDetail } from '@/app/api/meta'
import { dropped, enqueue, isConflict, landed, shown, type Chain, type Stamp } from './formCore'
import type { Loaded } from './useSettingsForm'

export function useChainedList<T>({ load, save, failTitle }: { load: () => Promise<Loaded<T>>; save: (value: T, since: string | null) => Promise<Loaded<T>>; failTitle: string }) {
  const chain = useRef<Chain<T> | null>(null)
  const waiters = useRef(new Map<number, (ok: boolean) => void>())
  const running = useRef(false)
  const force = useRef(false)
  const nextId = useRef(1)
  const fns = useRef({ load, save, failTitle })
  fns.current = { load, save, failTitle }
  const [, render] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const tick = () => render((n) => n + 1)

  const reload = useCallback(() => {
    setLoadError(null)
    setConflict(false)
    for (const w of waiters.current.values()) w(false)
    waiters.current.clear()
    fns.current.load().then(
      (l) => {
        chain.current = { confirmed: l.value, stamp: l.stamp, pending: [] }
        tick()
      },
      (err) => setLoadError(errorDetail(err)),
    )
  }, [])
  useEffect(reload, [reload])

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (chain.current?.pending.length) {
        const c = chain.current
        const ch = c.pending[0]
        try {
          const since = force.current ? null : c.stamp.updatedAt
          force.current = false
          const l = await fns.current.save(ch.apply(c.confirmed), since)
          chain.current = landed(chain.current, l.value, l.stamp)
          if (ch.done) toast.success(ch.done)
          waiters.current.get(ch.id)?.(true)
        } catch (err) {
          if (isConflict(err)) {
            // Keep what's waiting on screen; the person decides (ConflictBanner).
            setConflict(true)
            tick()
            return
          }
          chain.current = dropped(chain.current!)
          toast.error(fns.current.failTitle, { description: errorDetail(err) })
          waiters.current.get(ch.id)?.(false)
        }
        waiters.current.delete(ch.id)
        tick()
      }
    } finally {
      running.current = false
    }
  }, [])

  /** Applies a change now and queues it; resolves once the server took it (or didn't). */
  const change = useCallback(
    (apply: (current: T) => T, done?: string) => {
      if (!chain.current) return Promise.resolve(false)
      const id = nextId.current++
      chain.current = enqueue(chain.current, { id, apply, done })
      tick()
      const p = new Promise<boolean>((resolve) => waiters.current.set(id, resolve))
      if (!conflict) void pump()
      return p
    },
    [pump, conflict],
  )

  const c = chain.current
  return {
    value: c ? shown(c) : null,
    stamp: (c?.stamp ?? { updatedAt: null, updatedBy: null }) as Stamp,
    saving: !!c?.pending.length && !conflict,
    loadError,
    reload,
    change,
    conflict,
    /** After a 409: send what's waiting over the other person's changes. */
    keepMine: () => {
      setConflict(false)
      force.current = true
      void pump()
    },
  }
}
