// Background jobs stored in MongoDB, so they survive restarts: broadcasts now, and later reminders,
// snoozes, webhook deliveries, syncs and digests. A job runs in its workspace, under the trace of
// the request that queued it. Failures retry with backoff, then the job is parked as 'dead'.
// ponytail: one process polls every second and claims jobs with a lease (lockedUntil), so a crashed
// run is picked up again after the lease. Enough for several instances too, at low job volume.
import { ObjectId } from 'mongodb'
import { col, db, withWorkspace, ws } from './db.ts'
import { traceId } from './context.ts'
import { assetsFor } from './accounts.ts'
import { trace } from './trace.ts'

/** What a handler may return: `again` re-queues the same job (e.g. the next batch of a broadcast). */
export type JobResult = void | { again: Date }
type Handler = (payload: Record<string, unknown>) => Promise<JobResult>

const handlers = new Map<string, { run: Handler; maxAttempts: number; onDead?: Handler }>()
const jobs = () => col('jobs')
const LEASE_MS = 5 * 60_000

/** `onDead` runs once when the job gives up, so whatever waits on it can show the failure. */
export function defineJob(type: string, run: Handler, opts: { maxAttempts?: number; onDead?: Handler } = {}) {
  handlers.set(type, { run, maxAttempts: opts.maxAttempts ?? 5, onDead: opts.onDead })
}

/** Queues a job in the current workspace. With `key`, a job still queued under that key is reused (earliest time wins). */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: { runAt?: Date; key?: string } = {}) {
  const now = new Date()
  const doc = { type, payload, runAt: opts.runAt ?? now, traceId: traceId(), updatedAt: now }
  if (opts.key) {
    // A job already queued under the key runs at whichever time is earlier.
    const { runAt, ...rest } = doc
    await jobs().updateOne(
      { workspaceId: ws(), key: opts.key, status: 'queued' },
      { $set: rest, $min: { runAt }, $setOnInsert: { workspaceId: ws(), key: opts.key, status: 'queued', attempts: 0, createdAt: now } },
      { upsert: true, ignoreUndefined: true },
    )
  } else await jobs().insertOne({ ...doc, workspaceId: ws(), status: 'queued', attempts: 0, createdAt: now }, { ignoreUndefined: true })
  trace('job.queued', { type, runAt: doc.runAt })
}

/** Exponential backoff: 30 s, 1 min, 2 min, 4 min… capped at 1 hour. */
export const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000)

async function claim() {
  const now = new Date()
  return jobs().findOneAndUpdate(
    { $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }] },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + LEASE_MS), startedAt: now }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  )
}

async function runJob(j: Record<string, unknown> & { _id: ObjectId }) {
  const h = handlers.get(String(j.type))
  const attempts = Number(j.attempts)
  await withWorkspace(
    String(j.workspaceId),
    async () => {
      const started = Date.now()
      try {
        if (!h) throw new Error(`No handler for job type ${String(j.type)}`)
        const r = await h.run((j.payload ?? {}) as Record<string, unknown>)
        if (r?.again) {
          // Another queued job with the same key (queued meanwhile) already carries the work on.
          await jobs()
            .updateOne({ _id: j._id }, { $set: { status: 'queued', runAt: r.again, attempts: 0, updatedAt: new Date() }, $unset: { lockedUntil: '' } })
            .catch(async (err: { code?: number }) => {
              if (err.code !== 11000) throw err
              await jobs().updateOne({ _id: j._id }, { $set: { status: 'done', finishedAt: new Date(), updatedAt: new Date() }, $unset: { lockedUntil: '' } })
            })
        } else await jobs().updateOne({ _id: j._id }, { $set: { status: 'done', finishedAt: new Date(), updatedAt: new Date() }, $unset: { lockedUntil: '' } })
        if (!r?.again) trace('job.done', { type: j.type, ms: Date.now() - started })
      } catch (err) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
        const dead = attempts >= (h?.maxAttempts ?? 1)
        await jobs().updateOne(
          { _id: j._id },
          { $set: dead ? { status: 'dead', finishedAt: new Date(), lastError: error, updatedAt: new Date() } : { status: 'queued', runAt: new Date(Date.now() + backoffMs(attempts)), lastError: error, updatedAt: new Date() }, $unset: { lockedUntil: '' } },
        )
        trace(dead ? 'job.dead' : 'job.failed', { type: j.type, attempts, error })
        if (dead) await h?.onDead?.((j.payload ?? {}) as Record<string, unknown>).catch(() => {})
        console.log(`job ${String(j.type)} ${dead ? 'gave up' : 'will retry'} (attempt ${attempts}): ${error}`)
      }
    },
    await assetsFor(String(j.workspaceId)),
    { traceId: typeof j.traceId === 'string' ? j.traceId : undefined },
  )
}

let busy = false
/** Runs due jobs one at a time: at most 50 per tick, and none started after `budgetMs` (serverless
 *  runs stop well before the platform's time limit). Returns how many ran. */
export async function jobsTick(budgetMs = Infinity) {
  if (!db || busy) return 0
  busy = true
  const until = Date.now() + budgetMs
  let ran = 0
  try {
    for (let i = 0; i < 50 && Date.now() < until; i++) {
      const j = await claim()
      if (!j) break
      await runJob(j as Record<string, unknown> & { _id: ObjectId })
      ran++
    }
  } catch (err) {
    console.log('job runner:', err instanceof Error ? err.message : err)
  } finally {
    busy = false
  }
  return ran
}
export const startJobs = () => setInterval(() => void jobsTick(), 1000).unref()
