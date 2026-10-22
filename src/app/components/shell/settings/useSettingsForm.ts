// One way to save a Settings form: load it, edit a draft, see what changed, save once (sent with
// If-Unmodified-Since so a second admin's save isn't overwritten), discard, and never leave with
// changes without being asked. The pure parts (what counts as a change, the 409) are formCore.ts.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { errorDetail } from '@/app/api/meta'
import { isConflict, NO_STAMP, same, type Stamp } from './formCore'
import { useLeaveGuard } from './leaveGuard'

export interface Loaded<T> {
  value: T
  stamp: Stamp
}
export interface SettingsFormOptions<T, X = void> {
  load: () => Promise<Loaded<T>>
  /** `since` = when the loaded value was saved (null = save regardless: "Keep mine"). */
  save: (value: T, since: string | null, extra: X | undefined) => Promise<Loaded<T>>
  /** Problems by field; a save with any is refused before it's sent. */
  validate?: (value: T) => Record<string, string | undefined>
}
export type SettingsForm<T, X = void> = ReturnType<typeof useSettingsForm<T, X>>

export function useSettingsForm<T, X = void>({ load, save, validate }: SettingsFormOptions<T, X>) {
  const id = useId()
  const [saved, setSaved] = useState<Loaded<T> | null>(null)
  const [draft, setDraft] = useState<T | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  // The latest functions, so a caller's inline closures never re-run the load.
  const fns = useRef({ load, save, validate })
  fns.current = { load, save, validate }

  const reload = useCallback(() => {
    setLoadError(null)
    setConflict(false)
    fns.current.load().then(
      (l) => {
        setSaved(l)
        setDraft(l.value)
        setSaveError(null)
        setShowErrors(false)
      },
      (err) => setLoadError(errorDetail(err)),
    )
  }, [])
  useEffect(reload, [reload])

  const dirty = !!saved && draft !== null && !same(draft, saved.value)
  useLeaveGuard(id, dirty)
  const errors = Object.fromEntries(Object.entries(draft !== null && fns.current.validate ? fns.current.validate(draft) : {}).filter((e): e is [string, string] => !!e[1]))
  const invalid = Object.keys(errors).length > 0

  const set = useCallback((next: Partial<T> | ((d: T) => T)) => {
    setDraft((d) => (d === null ? d : typeof next === 'function' ? (next as (d: T) => T)(d) : { ...d, ...next }))
  }, [])

  async function run(since: string | null, extra?: X): Promise<boolean> {
    if (draft === null) return false
    if (invalid) {
      setShowErrors(true)
      return false
    }
    setSaving(true)
    setSaveError(null)
    try {
      const l = await fns.current.save(draft, since, extra)
      setSaved(l)
      setDraft(l.value)
      setConflict(false)
      setShowErrors(false)
      return true
    } catch (err) {
      if (isConflict(err)) setConflict(true)
      else setSaveError(errorDetail(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  return {
    state: saved ? ('ready' as const) : loadError ? ('error' as const) : ('loading' as const),
    loadError,
    reload,
    saved: saved?.value ?? null,
    stamp: saved?.stamp ?? NO_STAMP,
    draft,
    set,
    dirty,
    saving,
    saveError,
    /** Field problems, shown once a save was tried (or always, for `live`). */
    errors: showErrors ? errors : {},
    liveErrors: errors,
    invalid,
    save: (extra?: X) => run(saved?.stamp.updatedAt ?? null, extra),
    /** After a 409: save anyway, over the other person's changes. */
    keepMine: (extra?: X) => run(null, extra),
    conflict,
    discard: () => {
      if (saved) setDraft(saved.value)
      setSaveError(null)
      setShowErrors(false)
    },
  }
}
