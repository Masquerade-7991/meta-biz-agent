// The pure parts of Settings forms, shared by useSettingsForm and the chained-save lists (routing
// rules, escalation): what counts as a change, who changed it last, and the order saves go in.
// No React here, so it's tested under Node.

/** Two values hold the same settings (key order doesn't matter; undefined keys are ignored). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const y = b as unknown[]
    return a.length === y.length && a.every((v, i) => same(v, y[i]))
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)].filter((k) => x[k] !== undefined || y[k] !== undefined))
  for (const k of keys) if (!same(x[k], y[k])) return false
  return true
}

/** When it was last saved and by whom, as the server reports it (null when it never was, or the
 *  server doesn't say). */
export interface Stamp {
  updatedAt: string | null
  updatedBy: string | null
}
export const NO_STAMP: Stamp = { updatedAt: null, updatedBy: null }
export const stampOf = (v: unknown): Stamp => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null, updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : null }
}
/** A save the server refused because someone else saved first (If-Unmodified-Since → 409). */
export const isConflict = (err: unknown) => !!err && typeof err === 'object' && (err as { status?: unknown }).status === 409

/** "Last changed by Riya, 2 hours ago" (or nothing when it's never been saved). */
export function lastChanged(s: Stamp, now = Date.now()): string | null {
  if (!s.updatedAt || Number.isNaN(Date.parse(s.updatedAt))) return null
  const m = Math.round((now - Date.parse(s.updatedAt)) / 60_000)
  const when = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
  return `Last changed${s.updatedBy ? ` by ${s.updatedBy}` : ''}, ${when}`
}

// ---- chained saves ----
// Lists that change at once (toggle, reorder, delete) send one request at a time, in order. The
// screen shows the server's last answer with every waiting change applied on top; a change that
// fails is dropped on its own, so it never undoes a newer one.

export interface Change<T> {
  id: number
  apply: (current: T) => T
  /** Toast when it lands. */
  done?: string
}
export interface Chain<T> {
  /** What the server last accepted. */
  confirmed: T
  stamp: Stamp
  /** Waiting to be sent, oldest first; the first one is on its way. */
  pending: Change<T>[]
}
export const shown = <T>(c: Chain<T>): T => c.pending.reduce((v, ch) => ch.apply(v), c.confirmed)
export const enqueue = <T>(c: Chain<T>, ch: Change<T>): Chain<T> => ({ ...c, pending: [...c.pending, ch] })
/** The server accepted the first waiting change and answered with this. */
export const landed = <T>(c: Chain<T>, value: T, stamp: Stamp): Chain<T> => ({ confirmed: value, stamp, pending: c.pending.slice(1) })
/** The first waiting change failed: drop it alone; the ones after it still go. */
export const dropped = <T>(c: Chain<T>): Chain<T> => ({ ...c, pending: c.pending.slice(1) })
