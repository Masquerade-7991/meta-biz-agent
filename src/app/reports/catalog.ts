// The reports anyone with reports.view can view on screen, download (CSV, opens in Excel; PDF for
// summaries) or have emailed on a schedule. Summaries are built from the Analytics overview
// (summary.ts), records from a log, the same way on the server (CSV, emails) and in the browser
// (screen, print view, Dummy mode).
import type { LogKind, LogPage, Overview } from '../analytics/types.ts'
import { csvCell } from '../contacts/csv.ts'
import { csvOf, summaryOf } from './summary.ts'

/** Filters a report can be narrowed by besides the date (which every report has). `agents` = the
 *  WhatsApp numbers; `team` and `person` narrow ticket figures, so reports without tickets don't offer them. */
export type ReportFilter = 'agents' | 'team' | 'person'
const ALL: readonly ReportFilter[] = ['agents', 'team', 'person']
const AGENTS_ONLY: readonly ReportFilter[] = ['agents']

/** `group`: summaries are KPI tiles, charts and tables (CSV and PDF); records are one row per item
 *  (CSV only), read from the log `log`. `records`: the record report a summary drills down to.
 *  `filters` must match what the server applies (server/insights/analytics.ts overview and logPage). */
export const REPORTS = [
  { id: 'business_review', group: 'summary', title: 'Business review', description: 'The headline numbers against the period before', filters: ALL, records: 'conversations_log' },
  { id: 'ai_agent', group: 'summary', title: 'AI agent performance', description: 'How much the AI handles on its own', filters: AGENTS_ONLY, records: 'handovers' },
  { id: 'conversations', group: 'summary', title: 'Conversations', description: 'Who answered, and when customers write', filters: AGENTS_ONLY, records: 'conversations_log' },
  { id: 'team', group: 'summary', title: 'Team performance', description: 'Tickets, reply times and ratings per person and team', filters: ALL, records: 'tickets' },
  { id: 'response_sla', group: 'summary', title: 'Response times & SLA', description: 'Reply and resolution times against your targets', filters: ALL, records: 'escalations' },
  { id: 'csat', group: 'summary', title: 'Customer satisfaction', description: 'How customers rated the help they got', filters: ALL, records: 'csat_responses' },
  { id: 'spend', group: 'summary', title: 'Spend & usage', description: 'What WhatsApp messages and the AI agent cost', filters: AGENTS_ONLY, records: 'charges' },
  { id: 'conversations_log', group: 'records', title: 'Conversations log', description: 'Every conversation and who answered it', filters: AGENTS_ONLY, log: 'conversations' },
  { id: 'tickets', group: 'records', title: 'Tickets', description: 'Every ticket opened, with its timings and rating', filters: ALL, log: 'tickets' },
  { id: 'handovers', group: 'records', title: 'Handovers', description: 'Every chat handed to a person or taken over', filters: ALL, log: 'handovers' },
  { id: 'escalations', group: 'records', title: 'Escalations', description: 'Every escalation level reached, and why', filters: ALL, log: 'escalations' },
  { id: 'csat_responses', group: 'records', title: 'Satisfaction responses', description: 'Every rating a customer gave', filters: ALL, log: 'csat' },
  { id: 'charges', group: 'records', title: 'Message charges', description: 'Every message Meta priced', filters: AGENTS_ONLY, log: 'charges' },
  { id: 'agent_usage', group: 'records', title: 'AI agent usage', description: 'The agent’s billed replies and tokens, hour by hour', filters: AGENTS_ONLY, log: 'agent_usage' },
] as const satisfies readonly { id: string; group: 'summary' | 'records'; title: string; description: string; filters: readonly ReportFilter[]; records?: string; log?: LogKind }[]

export const REPORT_GROUPS = [
  { id: 'summary', title: 'Summaries' },
  { id: 'records', title: 'Records' },
] as const

/** Reports that were renamed or folded into another: old links and saved schedules land on these. */
export const RENAMED: Record<string, ReportId> = { daily: 'business_review', agents: 'ai_agent', people: 'team', teams: 'team', consumption: 'spend' }

/** A record report's CSV holds at most this many rows (server/insights/reports.ts). */
export const MAX_LOG_ROWS = 50_000

export type ReportId = (typeof REPORTS)[number]['id']
type Report = (typeof REPORTS)[number]
export const isReport = (v: unknown): v is ReportId => REPORTS.some((r) => r.id === v)
/** A report id, old names included; null for anything else. */
export const resolveReport = (v: unknown): ReportId | null => (isReport(v) ? v : typeof v === 'string' && Object.hasOwn(RENAMED, v) ? RENAMED[v] : null)
export const reportOf = (id: ReportId) => REPORTS.find((r) => r.id === (resolveReport(id) ?? id))!
/** The log a record report reads; null for summaries. */
export const logKindOf = (id: ReportId): LogKind | null => {
  const r: Report = reportOf(id)
  return 'log' in r ? r.log : null
}
export const isLogReport = (id: ReportId) => logKindOf(id) != null
/** The record report that shows a log. */
export const reportOfLog = (kind: LogKind): ReportId => REPORTS.find((r) => 'log' in r && r.log === kind)!.id
/** The record report a summary drills down to. */
export const recordsOf = (id: ReportId): ReportId | null => {
  const r: Report = reportOf(id)
  return 'records' in r ? r.records : null
}

interface ReportTable {
  columns: string[]
  rows: (string | number | null)[][]
}

/** One report as a table: a log's columns and rows, or a summary's first table (by day). Numbers stay
 *  numbers (Excel can sum them); rates are percents. */
export function reportTable(id: ReportId, o: Overview | null, log: LogPage | null): ReportTable {
  if (isLogReport(id)) {
    if (!log) return { columns: [], rows: [] }
    return { columns: log.columns.map((c) => c.label), rows: log.rows.map((r) => log.columns.map((c) => r[c.key] ?? null)) }
  }
  const first = o && summaryOf(reportOf(id).id, o).tables[0]
  return first ? csvOf(first, o.currency) : { columns: [], rows: [] }
}

/** CSV that Excel opens with the right characters (UTF-8 mark first). Text cells go through csvCell, so a value can't run as a formula. */
export const tableCsv = (t: ReportTable) => '﻿' + [t.columns, ...t.rows].map((r) => r.map((v) => (typeof v === 'number' ? String(v) : csvCell(v))).join(',')).join('\r\n') + '\r\n'

export const reportFile = (id: ReportId, from: string, to: string) => `helo-${id.replace(/_/g, '-')}-${from}-to-${to}.csv`

// ---- schedules ----
export type Cadence = 'daily' | 'weekly' | 'monthly'
export interface ReportSchedule {
  id: string
  name: string
  reports: ReportId[]
  cadence: Cadence
  /** Local hour it goes out, 0–23, in the support hours' time zone. */
  hour: number
  numbers: string[]
  team: string | null
  /** Workspace members, by user id. */
  userIds: string[]
  /** Anyone else (needs settings.manage). */
  emails: string[]
  enabled: boolean
  lastSentAt?: string | null
  nextRunAt?: string | null
  /** The last send that went wrong, and why (some or every address refused, nothing built). Cleared by a clean send. */
  lastError?: string | null
  lastFailedAt?: string | null
}
/** A new schedule: the weekly business review, to the person creating it. */
export const blankSchedule = (me: string | undefined): Omit<ReportSchedule, 'id'> => ({ name: 'Weekly business review', reports: ['business_review'], cadence: 'weekly', hour: 9, numbers: [], team: null, userIds: me ? [me] : [], emails: [], enabled: true })
export const CADENCE_LABEL: Record<Cadence, string> = { daily: 'Every day (yesterday)', weekly: 'Every Monday (last 7 days)', monthly: 'On the 1st (last month)' }

/** The period a scheduled report covers when it goes out on `today` (local YYYY-MM-DD). */
export function scheduleRange(c: Cadence, today: string) {
  const d = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
  if (c === 'daily') return { from: d(-1), to: d(-1) }
  if (c === 'weekly') return { from: d(-7), to: d(-1) }
  const firstThis = today.slice(0, 8) + '01'
  const lastPrev = new Date(Date.parse(firstThis + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10)
  return { from: lastPrev.slice(0, 8) + '01', to: lastPrev }
}

/** The next local day (YYYY-MM-DD) a schedule goes out on or after `today`, given it already ran today or not. */
export function nextRunDay(c: Cadence, today: string, ranToday: boolean) {
  const add = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
  let day = ranToday ? add(today, 1) : today
  for (let i = 0; i < 40; i++, day = add(day, 1)) {
    const dow = new Date(day + 'T12:00:00Z').getUTCDay()
    if (c === 'daily' || (c === 'weekly' && dow === 1) || (c === 'monthly' && day.endsWith('-01'))) return day
  }
  return day
}
