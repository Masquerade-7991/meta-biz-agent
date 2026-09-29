// Analytics page data. All Meta calls still go through meta.ts (metaFetch and the insights helpers);
// this file only shapes ranges and aggregates the rows.
import {
  agent,
  connectorLogs,
  conversationInsights,
  conversationTurns,
  errorText,
  getActivePhoneNumberId,
  metaFetch,
  q,
  toMs,
  toolCallInsights,
  type DateRange,
} from './meta'

export type AnalyticsRange = 7 | 14 | 30

// ---- Pure helpers (exported so they can be checked in isolation) ----

/** Today in `timeZone` (default: browser local) as YYYY-MM-DD; en-CA formats dates that way. */
const today = (timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
/** Calendar arithmetic on YYYY-MM-DD strings, done in UTC so DST never shifts the day. */
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

/** Inclusive range of `days` days ending today in `timeZone`. */
export function rangeDates(days: number, timeZone?: string): DateRange {
  const end_date = today(timeZone)
  return { start_date: addDays(end_date, -(days - 1)), end_date }
}

/** Rates should be 0–1, but tolerate a 0–100 percentage. */
export const normRate = (r: number | null | undefined): number | null =>
  r == null || !Number.isFinite(r) ? null : r > 1 ? r / 100 : r

/** Σ(w·v)/Σw over rows whose value is known; null when none are. */
export function weightedAvg(rows: { w: number; v: number | null | undefined }[]): number | null {
  let num = 0
  let den = 0
  for (const { w, v } of rows) {
    if (v == null || !Number.isFinite(v)) continue
    num += w * v
    den += w
  }
  return den > 0 ? num / den : null
}

/** Meta counts timeouts inside error_rate; split them out so success + error + timeout ≈ 1. */
export function splitErrorRate(error: number | null, timeout: number | null): number | null {
  if (error == null) return null
  return Math.max(0, error - (timeout ?? 0))
}

const value = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)

// ---- Meta calls ----

interface MetaEventRow {
  event_type: string
  received: number
  successfully_processed: number
  avg_e2e_latency_ms?: number | null
}
/** Agent events are bucketed in Pacific time, not the business time zone. Max 30 days. */
const eventInsights = (range: AnalyticsRange) =>
  metaFetch<{ data: MetaEventRow[]; avg_e2e_latency_ms?: number | null }>(
    `${agent()}/insights/agent_events` + q({ ...rangeDates(range, 'America/Los_Angeles') }),
  )

export interface Kpis {
  aiThreads: number | null
  openHandoffs: number | null
  toolCalls: number | null
  toolSuccessRate: number | null
  avgToolLatencyMs: number | null
  eventsReceived: number | null
  eventsProcessed: number | null
  avgEventLatencyMs: number | null
}

/** Each source fails independently to null; throws only when all three fail. */
export async function getKpis(range: AnalyticsRange): Promise<Kpis> {
  const settled = await Promise.allSettled([
    conversationInsights(rangeDates(range)),
    toolCallInsights(rangeDates(range)),
    eventInsights(range),
  ] as const)
  if (settled.every((r) => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason
  const [conv, tools, events] = [value(settled[0]), value(settled[1]), value(settled[2])]
  const toolRows = tools?.data ?? []
  const eventRows = events?.data ?? []
  return {
    aiThreads: conv?.aiThreads ?? null,
    openHandoffs: conv?.aiHandoffs ?? null,
    toolCalls: tools ? toolRows.reduce((n, t) => n + (t.thread_count ?? 0), 0) : null,
    toolSuccessRate: weightedAvg(toolRows.map((t) => ({ w: t.thread_count ?? 0, v: normRate(t.success_rate) }))),
    avgToolLatencyMs: weightedAvg(toolRows.map((t) => ({ w: t.thread_count ?? 0, v: t.avg_latency_ms }))),
    eventsReceived: events ? eventRows.reduce((n, e) => n + (e.received ?? 0), 0) : null,
    eventsProcessed: events ? eventRows.reduce((n, e) => n + (e.successfully_processed ?? 0), 0) : null,
    avgEventLatencyMs: events
      ? (events.avg_e2e_latency_ms ?? weightedAvg(eventRows.map((e) => ({ w: e.received ?? 0, v: e.avg_e2e_latency_ms }))))
      : null,
  }
}

export interface TrendPoint {
  date: string
  aiThreads: number | null
  partial: boolean
}

// Closed days never change, so cache them per number. Today is always re-fetched.
const trendCache = new Map<string, number>()

/** One call per day (Meta has no daily breakdown), 5 at a time. Failed days come back as null. */
export async function getConversationTrend(range: AnalyticsRange): Promise<TrendPoint[]> {
  const { start_date, end_date } = rangeDates(range)
  const phone = getActivePhoneNumberId() ?? 'PHONE_NUMBER_ID'
  const days = Array.from({ length: range }, (_, i) => addDays(start_date, i))
  const out: TrendPoint[] = days.map((date) => ({ date, aiThreads: null, partial: date === end_date }))
  let failures = 0
  let firstError: unknown
  let next = 0
  const worker = async () => {
    while (next < out.length) {
      const point = out[next++]
      const key = `${phone}|${point.date}`
      const cached = point.partial ? undefined : trendCache.get(key)
      if (cached !== undefined) {
        point.aiThreads = cached
        continue
      }
      try {
        point.aiThreads = (await conversationInsights({ start_date: point.date, end_date: point.date }, 'ai_threads')).aiThreads
        if (!point.partial) trendCache.set(key, point.aiThreads)
      } catch (err) {
        failures++
        firstError ??= err
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
  if (failures === out.length) throw firstError
  return out
}

export interface ToolRow {
  tool: string
  threads: number
  successRate: number | null
  errorRate: number | null
  timeoutRate: number | null
  avgLatencyMs: number | null
}

export async function getToolBreakdown(range: AnalyticsRange): Promise<ToolRow[]> {
  const r = await toolCallInsights(rangeDates(range))
  return (r.data ?? [])
    .map((t) => {
      const timeoutRate = normRate(t.timeout_rate)
      return {
        tool: t.tool_name,
        threads: t.thread_count ?? 0,
        successRate: normRate(t.success_rate),
        errorRate: splitErrorRate(normRate(t.error_rate), timeoutRate),
        timeoutRate,
        avgLatencyMs: t.avg_latency_ms ?? null,
      }
    })
    .sort((a, b) => b.threads - a.threads)
}

export interface EventRow {
  type: string
  received: number
  processed: number
  avgLatencyMs: number | null
}

export async function getEventBreakdown(range: AnalyticsRange): Promise<{ rows: EventRow[]; avgLatencyMs: number | null }> {
  const r = await eventInsights(range)
  return {
    rows: (r.data ?? []).map((e) => ({
      type: e.event_type,
      received: e.received ?? 0,
      processed: e.successfully_processed ?? 0,
      avgLatencyMs: e.avg_e2e_latency_ms ?? null,
    })),
    avgLatencyMs: r.avg_e2e_latency_ms ?? null,
  }
}

export interface ConnectorHealth {
  id: string
  name: string
  stats: { executions: number; successes: number; successRate: number | null; avgLatencyS: number | null; p95LatencyS: number | null } | null
  topFailures: { code: string; message: string; count: number }[]
  error?: string
}

/** Last 7 days (the logs' retention). Connectors without a metaId aren't on Meta yet, so they're skipped. */
export function getConnectorHealth(connections: { id: string; name: string; metaId?: string }[]): Promise<ConnectorHealth[]> {
  return Promise.all(
    connections
      .filter((c): c is typeof c & { metaId: string } => !!c.metaId)
      .map(async ({ id, name, metaId }): Promise<ConnectorHealth> => {
        const [full, summary] = await Promise.allSettled([
          connectorLogs(metaId),
          connectorLogs(metaId, { summary_only: true, top_n: 3 }),
        ])
        const s = full.status === 'fulfilled' ? full.value.stats : undefined
        const failures = summary.status === 'fulfilled' ? summary.value.data ?? [] : []
        const failed = [full, summary].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        return {
          id,
          name,
          stats: s
            ? {
                executions: s.start_count ?? 0,
                successes: s.success_count ?? 0,
                successRate: normRate(s.success_rate),
                avgLatencyS: s.avg_latency_s ?? null,
                p95LatencyS: s.p95_latency_s ?? null,
              }
            : null,
          topFailures: failures.map((f) => ({
            code: f.failure_code_name ?? 'UNKNOWN',
            message: f.error_message ?? '',
            count: f.occurrences ?? 1,
          })),
          ...(failed ? { error: errorText(failed.reason) } : {}),
        }
      }),
  )
}

export interface TimelineStep {
  kind: 'llm' | 'tool'
  tool?: string
  status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT'
  latencyMs?: number
}
export interface TimelineTurn {
  at: number | null
  latencyMs: number | null
  steps: TimelineStep[]
}

/** Turns of the number's most recent conversation with `phone`. */
export async function getConversationTimeline(phone: string): Promise<TimelineTurn[]> {
  return (await conversationTurns(phone)).map((t) => ({
    at: toMs(t.timestamp) ?? null,
    latencyMs: t.e2e_latency_ms ?? null,
    steps: (t.steps ?? []).map((s) => ({
      kind: s.type === 'TOOL_CALL' ? 'tool' : 'llm',
      tool: s.tool_name,
      status: s.status,
      latencyMs: s.latency_ms,
    })),
  }))
}
