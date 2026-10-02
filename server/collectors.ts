// Background collectors (in-process setInterval). Each job has an in-flight lock, and a run stops
// quietly when the upstream is unreachable (it's VPN-only and often down).
import { col, db, withWorkspace, ws } from './db.ts'
import { hash, saveTurns } from './record.ts'
import { metaGet } from './upstream.ts'

type Obj = Record<string, unknown>
export type Job = 'metrics' | 'handoffs' | 'connectorLogs' | 'traces'

/** YYYY-MM-DD in `timeZone` (default: server local); en-CA formats dates that way. */
export const dayIn = (d: Date, timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d)
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
/** Days are stored as UTC midnight of the date label. */
export const dayTs = (day: string) => new Date(day + 'T00:00:00Z')
const normRate = (r: unknown) => (typeof r !== 'number' || !Number.isFinite(r) ? null : r > 1 ? r / 100 : r)
const q = (p: Record<string, string | number | boolean>) => '?' + new URLSearchParams(Object.entries(p).map(([k, v]): [string, string] => [k, String(v)])).toString()

/** An HTTP error skips one item; anything else (upstream down, DB error) aborts the whole run. */
const isHttp = (err: unknown) => typeof (err as { status?: unknown })?.status === 'number'
const orSkip = <T>(fallback: T) => (err: unknown): T | Promise<never> => (isHttp(err) ? fallback : Promise.reject(err))

export const agentPhones = async () =>
  (await col('agents').find({ workspaceId: ws(), deletedAt: { $exists: false } }, { projection: { _id: 1 } }).toArray()).map((a) => String(a._id))

// ---- metrics_daily: one doc per (phone, metric, closed day); each day fetched once ----
const METRICS = {
  ai_threads: { tz: undefined as string | undefined },
  tool_calls: { tz: undefined as string | undefined },
  agent_events: { tz: 'America/Los_Angeles' }, // Meta buckets agent events in Pacific time
}
export type Metric = keyof typeof METRICS
const inFlight = new Set<string>()

async function fetchMetric(phone: string, metric: Metric, day: string): Promise<Obj> {
  const range = { start_date: day, end_date: day }
  if (metric === 'ai_threads') {
    const r = await metaGet<{ data?: { ai_threads?: { count?: number } }[] }>(`/${phone}/insights/conversations` + q({ ...range, metrics: 'ai_threads' }))
    return { value: r.data?.[0]?.ai_threads?.count ?? 0 }
  }
  if (metric === 'tool_calls') {
    const r = await metaGet<{ data?: Obj[] }>(`/${phone}/insights/tool_calls` + q(range))
    return {
      rows: (r.data ?? []).map((t) => {
        const timeout = normRate(t.timeout_rate)
        const error = normRate(t.error_rate)
        return {
          tool: String(t.tool_name),
          threads: Number(t.thread_count ?? 0),
          successRate: normRate(t.success_rate),
          errorRate: error == null ? null : Math.max(0, error - (timeout ?? 0)),
          timeoutRate: timeout,
          avgLatencyMs: typeof t.avg_latency_ms === 'number' ? t.avg_latency_ms : null,
        }
      }),
    }
  }
  const r = await metaGet<{ data?: Obj[] }>(`/${phone}/insights/agent_events` + q(range))
  return {
    rows: (r.data ?? []).map((e) => ({
      type: String(e.event_type),
      received: Number(e.received ?? 0),
      processed: Number(e.successfully_processed ?? 0),
      avgLatencyMs: typeof e.avg_e2e_latency_ms === 'number' ? e.avg_e2e_latency_ms : null,
    })),
  }
}

/** Stored docs for these days; fetches and stores the missing closed ones. Returns day → doc. */
export async function ensureDays(phone: string, metric: Metric, days: string[]): Promise<Map<string, Obj>> {
  const today = dayIn(new Date(), METRICS[metric].tz)
  const closed = days.filter((d) => d < today)
  const stored = await col('metrics_daily')
    .find({ 'meta.phoneNumberId': phone, 'meta.metric': metric, ts: { $in: closed.map(dayTs) } })
    .toArray()
  const out = new Map<string, Obj>(stored.map((d) => [(d.ts as Date).toISOString().slice(0, 10), d]))
  const missing = closed.filter((d) => !out.has(d) && !inFlight.has(`${phone}|${metric}|${d}`))
  let next = 0
  const worker = async () => {
    while (next < missing.length) {
      const day = missing[next++]
      const key = `${phone}|${metric}|${day}`
      inFlight.add(key)
      try {
        const doc = { ts: dayTs(day), meta: { workspaceId: ws(), phoneNumberId: phone, metric }, ...(await fetchMetric(phone, metric, day)) }
        await col('metrics_daily').insertOne(doc)
        out.set(day, doc)
      } catch (err) {
        if (!isHttp(err)) throw err
      } finally {
        inFlight.delete(key)
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
  return out
}

async function metrics() {
  for (const phone of await agentPhones()) {
    for (const metric of Object.keys(METRICS) as Metric[]) {
      const today = dayIn(new Date(), METRICS[metric].tz)
      await ensureDays(phone, metric, Array.from({ length: 30 }, (_, i) => addDays(today, -30 + i)))
    }
  }
}

// ---- handoff_snapshots: the live ai_handoffs count ----
async function handoffs() {
  for (const phone of await agentPhones()) {
    const today = dayIn(new Date())
    const r = await metaGet<{ data?: { ai_handoffs?: { count?: number } }[] }>(
      `/${phone}/insights/conversations` + q({ start_date: addDays(today, -1), end_date: today, metrics: 'ai_handoffs' }),
    ).catch(orSkip(null))
    if (r) await col('handoff_snapshots').insertOne({ ts: new Date(), meta: { workspaceId: ws(), phoneNumberId: phone }, count: r.data?.[0]?.ai_handoffs?.count ?? 0 })
  }
}

// ---- connector_logs (last 2 h, deduped) + connector_stats (today) ----
async function connectorLogs() {
  const now = Math.floor(Date.now() / 1000)
  const today = dayIn(new Date())
  const startOfToday = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000)
  for (const phone of await agentPhones()) {
    const connectors = await metaGet<Obj[]>(`/${phone}/agent_connectors`).catch(orSkip([]))
    for (const c of Array.isArray(connectors) ? connectors : []) {
      const connectorId = String(c.id)
      const base = `/${phone}/agent_connectors/${connectorId}/logs`
      const logs = await metaGet<{ data?: Obj[] }>(base + q({ start_time: now - 7200, limit: 1000 })).catch(orSkip(null))
      const ops = (logs?.data ?? []).map((l) => ({
        updateOne: {
          filter: { dedupeKey: hash(connectorId, l.event_time, l.failure_code_name, l.tool_name, l.error_message) },
          update: {
            $setOnInsert: {
              workspaceId: ws(),
              phoneNumberId: phone,
              connectorId,
              at: l.event_time ? new Date(String(l.event_time)) : new Date(),
              failureCode: l.failure_code_name ?? null,
              message: l.error_message ?? null,
              toolName: l.tool_name ?? null,
              occurrences: l.occurrences ?? 1,
            },
          },
          upsert: true,
        },
      }))
      if (ops.length) await col('connector_logs').bulkWrite(ops, { ordered: false })
      const s = await metaGet<{ stats?: Obj }>(base + q({ start_time: startOfToday, include_stats: true, limit: 1 })).catch(orSkip(null))
      if (s?.stats)
        await col('connector_stats').updateOne(
          { connectorId, day: today },
          { $set: { workspaceId: ws(), phoneNumberId: phone, date: dayTs(today), ...s.stats, updatedAt: new Date() } },
          { upsert: true },
        )
    }
  }
}

// ---- conversation_traces for every customer we know of ----
async function traces() {
  for (const phone of await agentPhones()) {
    const allow = await metaGet<Obj[]>(`/${phone}/agent_config/allowlist`).catch(orSkip([]))
    const consumers = new Set<string>([
      ...(Array.isArray(allow) ? allow : []).map((a) => String(a.consumer_phone_number ?? '')),
      ...(await col('agent_events').distinct('to', { phoneNumberId: phone })).map(String),
      ...(await col('conversation_traces').distinct('consumer', { phoneNumberId: phone })).map(String),
    ].map((n) => n.replace(/\D/g, '')).filter(Boolean))
    for (const consumer of consumers) {
      let after = ''
      for (let page = 0; page < 50; page++) {
        const r = await metaGet<{ data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } }>(
          `/${phone}/insights/conversations/turns` + q({ user_phone_number: consumer, limit: 100, ...(after ? { after } : {}) }),
        ).catch(orSkip(null))
        if (!r) break
        await saveTurns(phone, consumer, r.data)
        after = r.paging?.cursors?.after ?? ''
        if (!r.paging?.next || !after) break
      }
    }
  }
}

const JOBS: Record<Job, () => Promise<void>> = { metrics, handoffs, connectorLogs, traces }
const running = new Set<Job>()

/** Runs one job now (skips if it's already running or there is no database). */
export async function runOnce(job: Job): Promise<void> {
  if (!db || running.has(job)) return
  running.add(job)
  try {
    // Each workspace's agents are collected inside that workspace.
    for (const w of (await col('agents').distinct('workspaceId')) as string[]) await withWorkspace(w, JOBS[job])
  } catch (err) {
    console.log(`collector ${job} skipped: ${(err as { down?: boolean }).down ? 'upstream unreachable' : err instanceof Error ? err.message : err}`)
  } finally {
    running.delete(job)
  }
}

const HOUR = 3_600_000
export function startCollectors() {
  const every = (job: Job, ms: number) => setInterval(() => void runOnce(job), ms).unref()
  every('metrics', 6 * HOUR)
  every('handoffs', 15 * 60_000)
  every('connectorLogs', HOUR)
  every('traces', HOUR)
  void runOnce('metrics')
  void runOnce('handoffs')
}
