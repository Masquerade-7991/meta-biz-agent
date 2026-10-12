// The event log: what happened in a workspace, one row per event, tied together by the trace id
// from context.ts. Every event is also pushed live to the workspace's open streams (stream.ts).
// Never throws and is never awaited by callers; a failed write is only logged.
// Keep `data` to ids, counts and statuses: no message text, customer numbers or secrets.
import { EventEmitter } from 'node:events'
import { col, db, withWorkspace, ws } from './db.ts'
import { currentUserId, traceId } from './context.ts'

export interface TraceEvent {
  workspaceId: string
  traceId: string | undefined
  userId: string | undefined
  /** Dotted name: 'broadcast.sent', 'message.received', 'job.failed'… */
  kind: string
  entity?: string
  entityId?: string
  data: Record<string, unknown>
  /** What an edit changed, field by field: before → after (the activity log shows these). */
  changes?: Changes
  at: Date
}
export type Changes = Record<string, [unknown, unknown]>

/** The fields of `after` whose value differs from `before`, as before → after pairs; undefined when nothing changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Changes | undefined {
  const out: Changes = {}
  for (const [k, v] of Object.entries(after)) if (v !== undefined && JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = [before[k] ?? null, v ?? null]
  return Object.keys(out).length ? out : undefined
}

/** Live events per workspace; listeners are the open /api/stream connections. */
export const bus = new EventEmitter().setMaxListeners(0)

export function trace(kind: string, data: Record<string, unknown> = {}, ref?: { entity: string; id: string }, changes?: Changes): void {
  const e: TraceEvent = { workspaceId: ws(), traceId: traceId(), userId: currentUserId(), kind, entity: ref?.entity, entityId: ref?.id, data, changes, at: new Date() }
  bus.emit(e.workspaceId, e)
  if (!db) return
  col('events')
    .insertOne({ ...e }, { ignoreUndefined: true })
    .catch((err) => console.log(`events write failed (${kind}): ${err instanceof Error ? err.message : err}`))
}

/** For routes that run before a workspace is chosen (accounts, members): records the event in the
 *  workspace it's about, as `userId`. */
export const traceIn = (workspaceId: string, userId: string, kind: string, data: Record<string, unknown> = {}, ref?: { entity: string; id: string }, changes?: Changes) =>
  withWorkspace(workspaceId, () => trace(kind, data, ref, changes), null, { userId })

/** Everything one trace touched, oldest first: events, Meta calls and config changes.
 *  `id` may be the 8-character reference shown with errors (a prefix match). */
export async function readTrace(id: string) {
  const q = { workspaceId: ws(), traceId: id.length === 36 ? id : { $regex: `^${id.replace(/[^0-9a-f-]/g, '')}` } }
  const [events, calls, audit] = await Promise.all([
    col('events').find(q, { projection: { _id: 0, workspaceId: 0 } }).sort({ at: 1 }).limit(500).toArray(),
    col('api_calls').find(q, { projection: { _id: 0, workspaceId: 0 } }).sort({ at: 1 }).limit(500).toArray(),
    col('audit_log').find(q, { projection: { _id: 0, workspaceId: 0, data: 0 } }).sort({ at: 1 }).limit(500).toArray(),
  ])
  return { traceId: id, events, calls, audit }
}
