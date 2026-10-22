// Saving settings that someone else changed since you opened them: a PUT may send
// `If-Unmodified-Since: <updatedAt it read>`; when the stored copy is newer the save is refused with
// 409 "Changed by someone else". No header = no check (the UI's "Keep mine").
import type http from 'node:http'
import { HttpError, needUnmodified, type Titles } from '../platform/http.ts'
import type { Collection, Document } from 'mongodb'
import { col, ws } from '../platform/db.ts'

export class StaleError extends HttpError {
  constructor(message: string) {
    super(409, message)
  }
}
export const STALE_TITLE = 'Changed by someone else'

/** Throws StaleError when the request read an older copy than the one stored (platform's needUnmodified). */
export function needFresh(req: http.IncomingMessage, storedAt: unknown) {
  try {
    needUnmodified(req, storedAt)
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) throw new StaleError(err.message)
    throw err
  }
}

const STALE_DETAIL = 'Someone else saved changes here after you opened it. Reload to see their changes, or save again to keep yours.'

/** Writes `set` only over the copy that was checked (`stored`, read before needFresh), so of two saves at
 *  the same moment only one passes; the other gets 409 when it sent If-Unmodified-Since, else it still wins. */
export async function saveChecked(c: Collection<Document>, req: http.IncomingMessage, stored: Document | null, set: Document) {
  const r = await c.updateOne({ workspaceId: ws(), ...(stored ? { updatedAt: stored.updatedAt ?? null } : {}) }, { $set: set }, { upsert: !stored })
  if (!stored || r.matchedCount) return
  if (req.headers['if-unmodified-since']) throw new StaleError(STALE_DETAIL)
  await c.updateOne({ workspaceId: ws() }, { $set: set })
}

/** `updatedAt` (ISO) and `updatedBy` (the person's name) for a stored settings document. */
export async function changedBy(doc: Record<string, unknown> | null | undefined) {
  const id = doc?.updatedBy ? String(doc.updatedBy) : null
  const user = id ? await col('users').findOne({ _id: id as never }, { projection: { name: 1 } }) : null
  return { updatedAt: doc?.updatedAt ? new Date(doc.updatedAt as Date).toISOString() : null, updatedBy: user ? String(user.name ?? '') || null : null }
}

/** For settings answered as a list: the same two facts in response headers. */
export function setChangedHeaders(res: http.ServerResponse, c: { updatedAt: string | null; updatedBy: string | null }) {
  if (c.updatedAt) res.setHeader('x-updated-at', c.updatedAt)
  if (c.updatedBy) res.setHeader('x-updated-by', encodeURIComponent(c.updatedBy))
}

/** Per-request titles: a stale save is titled "Changed by someone else", other 409s keep theirs. */
export function staleAware(titles: Titles, run: () => Promise<unknown>): [Titles, () => Promise<unknown>] {
  const t = { ...titles }
  return [
    t,
    async () => {
      try {
        return await run()
      } catch (err) {
        if (err instanceof StaleError) t[409] = STALE_TITLE
        throw err
      }
    },
  ]
}
