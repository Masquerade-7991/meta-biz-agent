// Short-lived locks and throttles shared by every instance, in MongoDB (`locks`: _id = key, until).
// Replaces the per-process Maps that assumed one server: sync throttles, collector in-flight
// locks. A lock is taken with one upsert, so two instances racing for it get exactly one winner.
import { col, db } from './db.ts'

const locks = () => col<{ _id: string; until: Date }>('locks')

/** Takes `key` for `ms` unless someone holds it (then false). Without a database every call wins. */
export async function tryLock(key: string, ms: number): Promise<boolean> {
  if (!db) return true
  const now = new Date()
  try {
    await locks().updateOne({ _id: key, until: { $lt: now } }, { $set: { until: new Date(now.getTime() + ms) } }, { upsert: true })
    return true
  } catch (err) {
    // The upsert's insert collided with a live lock: someone else holds it.
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
}

export async function isLocked(key: string): Promise<boolean> {
  if (!db) return false
  return !!(await locks().findOne({ _id: key, until: { $gt: new Date() } }, { projection: { _id: 1 } }))
}

export async function unlock(key: string): Promise<void> {
  if (db) await locks().deleteOne({ _id: key }).catch(() => null)
}
