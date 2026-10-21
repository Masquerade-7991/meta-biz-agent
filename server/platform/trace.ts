// The event log: what happened in a workspace, one row per event, tied together by the trace id
// from context.ts. Every event is also pushed live to the workspace's open streams (stream.ts).
// Never throws and is never awaited by callers; a failed write is only logged.
// Keep `data` to ids, counts and statuses: no message text, customer numbers or secrets.
import { EventEmitter } from 'node:events'
import { col, db, withWorkspace, ws } from './db.ts'
import { currentUserId, INSTANCE, traceId } from './context.ts'

export interface TraceEvent {
  workspaceId: string
  traceId: string | undefined
  userId: string | undefined
  /** Dotted name: 'message.received', 'ticket.updated', 'job.failed'… */
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
const bus = new EventEmitter().setMaxListeners(0)

/** Events written by other instances, from a change stream on `events` (needs a replica set; Atlas
 *  is one). Opened once, on the first subscriber; without a replica set the stream only carries this
 *  instance's events, and that is logged once. */
let watching: 'no' | 'opening' | 'yes' | 'unsupported' = 'no'
let subscribers = 0
function watchEvents() {
  if (watching !== 'no' || !db) return
  watching = 'opening'
  try {
    const stream = col('events').watch([{ $match: { operationType: 'insert', 'fullDocument.instance': { $ne: INSTANCE } } }], { fullDocument: 'updateLookup' })
    stream.on('change', (c) => {
      const d = (c as { fullDocument?: TraceEvent & { instance?: string } }).fullDocument
      if (d) bus.emit(d.workspaceId, d)
    })
    stream.on('error', (err) => {
      // 40573: change streams need a replica set. Anything else: reopen on the next subscriber.
      watching = (err as { code?: number }).code === 40573 ? 'unsupported' : 'no'
      if (watching === 'unsupported') console.log('live events: this MongoDB is not a replica set, so other instances’ events are not streamed')
      void stream.close().catch(() => null)
    })
    watching = 'yes'
    console.log('live events: streaming other instances’ events (change stream)')
  } catch {
    watching = 'no'
  }
}

/** Live events of one workspace, from every instance. Returns the unsubscribe. */
export function subscribe(workspaceId: string, fn: (e: TraceEvent) => void): () => void {
  subscribers++
  watchEvents()
  bus.on(workspaceId, fn)
  return () => {
    subscribers--
    bus.off(workspaceId, fn)
  }
}

export function trace(kind: string, data: Record<string, unknown> = {}, ref?: { entity: string; id: string }, changes?: Changes): void {
  const e: TraceEvent = { workspaceId: ws(), traceId: traceId(), userId: currentUserId(), kind, entity: ref?.entity, entityId: ref?.id, data, changes, at: new Date() }
  bus.emit(e.workspaceId, e)
  if (!db) return
  col('events')
    .insertOne({ ...e, instance: INSTANCE }, { ignoreUndefined: true })
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
