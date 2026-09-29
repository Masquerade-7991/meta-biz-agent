import { useEffect, useRef, useState } from 'react'
import { useWizard } from './WizardContext'
import { useRegisterNavGuard, type NavIntent } from './NavigationGuardContext'
import type { SliceKey, WizardState } from './types'
import { toast } from 'sonner'
import { pushSlice } from '../api/meta'

export interface SaveOnNextOptions<T> {
  /** Custom dirty comparison. Defaults to a plain deep-equality check. Use this to exclude
   *  sub-fields that save independently (e.g. a list that saves immediately, like custom skills). */
  isDirty?: (saved: T, current: T) => boolean
  /** Runs when Next/Save and close is pressed and something changed, after the unsaved-changes
   *  check but before the save simulation starts. Return false to cancel (e.g. the user backed
   *  out of a "this will clear N fields" confirm). Defaults to always proceeding. */
  confirmSave?: (saved: T, current: T) => Promise<boolean>
  /** Runs synchronously right before the save simulation starts, e.g. to normalise a field. */
  beforeSave?: (current: T) => void
}

/** One data slice's "nothing saves until Next or Save and close" lifecycle: simulated initial
 *  load (with a failure path), simulated save (with a forceable failure path for the demo
 *  controls), and the unsaved-changes navigation guard. Shared by every step section that follows
 *  the Business Profile save model, so each one doesn't hand-roll the same ~60 lines. */
export function useSaveOnNextSection<K extends SliceKey>(slice: K, options: SaveOnNextOptions<WizardState[K]> = {}) {
  const { state } = useWizard()
  const data = state[slice]
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [savedSnapshot, setSavedSnapshot] = useState<WizardState[K] | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadStatus('loaded')
      setSavedSnapshot(dataRef.current)
    }, 600)
    return () => clearTimeout(timer)
    // Mount-only: simulates the fetch that happens when this section first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function retryLoad() {
    setLoadStatus('loading')
    setTimeout(() => {
      setLoadStatus('loaded')
      setSavedSnapshot(dataRef.current)
    }, 900)
  }

  function simulateLoadFailure() {
    setLoadStatus('loading')
    setTimeout(() => setLoadStatus('failed'), 900)
  }

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [forceSaveFailure, setForceSaveFailure] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state

  async function performSave(): Promise<boolean> {
    options.beforeSave?.(dataRef.current)
    setSaveStatus('saving')
    try {
      if (forceSaveFailure) throw new Error('Forced failure (Demo controls)')
      // beforeSave may have patched the slice; let that render land before reading state.
      await new Promise((r) => setTimeout(r, 0))
      await pushSlice(slice, stateRef.current)
    } catch (err) {
      setSaveStatus('failed')
      toast.error("Couldn't save to Meta", { description: err instanceof Error ? err.message : String(err) })
      return false
    }
    setSaveStatus('idle')
    setSavedSnapshot(dataRef.current)
    return true
  }

  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  function askUnsaved(): Promise<boolean> {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setUnsavedDialogOpen(true)
    })
  }

  function resolveUnsaved(result: boolean) {
    setUnsavedDialogOpen(false)
    resolverRef.current?.(result)
    resolverRef.current = null
  }

  async function guard(intent: NavIntent): Promise<boolean> {
    const saved = savedSnapshot
    const current = dataRef.current
    if (!saved) return true
    const dirty = options.isDirty ? options.isDirty(saved, current) : JSON.stringify(saved) !== JSON.stringify(current)
    if (!dirty) return true
    if (intent === 'discard') return askUnsaved()
    if (options.confirmSave) {
      const proceed = await options.confirmSave(saved, current)
      if (!proceed) return false
    }
    return performSave()
  }

  useRegisterNavGuard(guard)

  // Same comparison the nav guard uses, exposed so a page can show its own Save button —
  // disabled until something differs from the last saved snapshot, re-enabled the moment it does.
  const dirty =
    savedSnapshot !== null &&
    (options.isDirty ? options.isDirty(savedSnapshot, data) : JSON.stringify(savedSnapshot) !== JSON.stringify(data))

  return {
    data,
    dataRef,
    loading: loadStatus === 'loading',
    loadStatus,
    saveStatus,
    dirty,
    forceSaveFailure,
    setForceSaveFailure,
    simulateLoadFailure,
    retryLoad,
    performSave,
    unsavedDialogOpen,
    resolveUnsaved,
    // Escape hatches for a step that needs bespoke load behaviour (e.g. "load saved profile"
    // demo data) — most callers only need the fields above.
    setLoadStatus,
    setSavedSnapshot,
  }
}
