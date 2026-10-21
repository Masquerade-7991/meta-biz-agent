// The reports anyone with reports.view can view on screen, download (CSV, opens in Excel; PDF for
// summaries) or have emailed on a schedule. Each report is a table built from the Analytics overview or a log,
// the same way on the server (CSV, emails) and in the browser (print view, Dummy mode).
import { csatScore, type LogKind, type LogPage, type Overview } from '../analytics/types.ts'
import { csvCell } from '../contacts/csv.ts'

/** Filters a report can be narrowed by besides the date (which every report has). `agents` = the
 *  WhatsApp numbers; `team` and `person` narrow ticket figures, so reports without tickets ignore them. */
export type ReportFilter = 'agents' | 'team' | 'person'
const ALL: readonly ReportFilter[] = ['agents', 'team', 'person']
const AGENTS_ONLY: readonly ReportFilter[] = ['agents']

/** `group`: summaries are totals for a period (CSV and PDF); records are one row per item (CSV only).
 *  `filters` must match what the server applies (server/insights/analytics.ts overview and logPage). */
export const REPORTS = [
  { id: 'business_review', group: 'summary', title: 'Business review', description: 'The headline numbers against the period before: conversations, chats handled by AI alone, satisfaction, reply times, escalations and spend.', source: 'overview', filters: ALL },
  { id: 'daily', group: 'summary', title: 'Day by day', description: 'One row per day: conversations, AI alone, handovers, tickets, reply times, satisfaction and spend.', source: 'overview', filters: ALL },
  { id: 'agents', group: 'summary', title: 'AI agents', description: 'Each AI agent side by side: conversations, chats handled alone, handovers, satisfaction and cost.', source: 'overview', filters: AGENTS_ONLY },
  { id: 'people', group: 'summary', title: 'Team members', description: 'Per person: tickets resolved and open, first reply time, satisfaction and escalations.', source: 'overview', filters: ALL },
  { id: 'teams', group: 'summary', title: 'Teams', description: 'Per team: tickets opened and resolved, how many were resolved on time, and escalations.', source: 'overview', filters: ALL },
  { id: 'consumption', group: 'summary', title: 'Spend and usage', description: 'What WhatsApp messages and the Business Agent cost, by message type, and free replies used per number.', source: 'overview', filters: AGENTS_ONLY },
  { id: 'tickets', group: 'records', title: 'Tickets', description: 'Every ticket opened in the period, with its team, assignee, timings, whether it was on time, escalation and rating.', source: 'log', filters: ALL },
  { id: 'handovers', group: 'records', title: 'Handovers', description: 'Every chat handed to a person: how, to whom and how fast they replied.', source: 'log', filters: ALL },
  { id: 'escalations', group: 'records', title: 'Escalations', description: 'Every escalation level reached, why, and who was alerted.', source: 'log', filters: ALL },
  { id: 'charges', group: 'records', title: 'Message charges', description: 'One row per message Meta priced: type, pricing and whether it was billed.', source: 'log', filters: AGENTS_ONLY },
  { id: 'agent_usage', group: 'records', title: 'AI agent usage by hour', description: 'The Business Agent’s billed replies, tokens and cost, hour by hour.', source: 'log', filters: AGENTS_ONLY },
] as const

export const REPORT_GROUPS = [
  { id: 'summary', title: 'Summaries', description: 'Totals for a period. View them here, or download as CSV or PDF.' },
  { id: 'records', title: 'Detailed records', description: 'One row per ticket, handover or charge, for spreadsheets. Download as CSV.' },
] as const

/** Why a report ignores team and assignee, shown where those filters would be. */
export const FILTER_NOTE: Partial<Record<ReportId, string>> = {
  agents: 'Team and assignee don’t apply: this report is about the AI agents.',
  consumption: 'Team and assignee don’t apply: Meta reports spend for the whole account.',
  charges: 'Team and assignee don’t apply: Meta prices messages for the whole account.',
  agent_usage: 'Team and assignee don’t apply: this is the AI agent’s own usage.',
}

/** A record report's CSV holds at most this many rows (server/insights/reports.ts). */
export const MAX_LOG_ROWS = 50_000

export type ReportId = (typeof REPORTS)[number]['id']
export const isReport = (v: unknown): v is ReportId => REPORTS.some((r) => r.id === v)
export const reportOf = (id: ReportId) => REPORTS.find((r) => r.id === id)!
export const isLogReport = (id: ReportId): id is ReportId & LogKind => reportOf(id).source === 'log'

interface ReportTable {
  columns: string[]
  rows: (string | number | null)[][]
}

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)
const pctv = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10)

/** One report as a table. Numbers stay numbers (Excel can sum them); rates are percents. */
export function reportTable(id: ReportId, o: Overview | null, log: LogPage | null): ReportTable {
  if (isLogReport(id)) {
    if (!log) return { columns: [], rows: [] }
    return { columns: log.columns.map((c) => c.label), rows: log.rows.map((r) => log.columns.map((c) => r[c.key] ?? null)) }
  }
  if (!o) return { columns: [], rows: [] }
  const cur = o.currency ? ` (${o.currency})` : ''
  switch (id) {
    case 'business_review': {
      const k = o.kpis
      const row = (label: string, v: { value: number | null; prev: number | null }, f: (x: number | null) => number | null = (x) => x) => [label, f(v.value), f(v.prev)]
      return {
        columns: ['Measure', `${o.range.from} to ${o.range.to}`, `${o.range.prevFrom} to ${o.range.prevTo}`],
        rows: [
          row('Conversations', k.conversations),
          row('Handled by AI alone (%)', k.containment, pctv),
          row('Customer satisfaction (%)', k.csat, pctv),
          row('Handovers to people', k.handoffs),
          row('Tickets opened', k.ticketsOpened),
          row('Tickets resolved', k.ticketsResolved),
          row('Resolution rate (%)', k.resolutionRate, pctv),
          row('Median first reply (minutes)', k.medianFirstReplyMin, r2),
          row('Median time to resolve (minutes)', k.medianResolveMin, r2),
          row('Resolved on time (%)', k.slaMet, pctv),
          row('Escalations', k.escalations),
          row(`Spend${cur}`, k.spend, r2),
          row(`Cost per resolved conversation${cur}`, k.costPerResolved, r2),
        ],
      }
    }
    case 'daily':
      return {
        columns: ['Date', 'Conversations', 'AI alone', 'With the team', 'No reply', 'Handovers', 'Tickets opened', 'Tickets resolved', 'Open at end of day', 'Median first reply (minutes)', 'Resolved on time (%)', 'Satisfaction (%)', 'Escalations', `WhatsApp spend${cur}`, `Business Agent cost${cur}`],
        rows: o.series.map((p) => [p.date, p.conversations, p.aiOnly, p.withTeam, p.noReply, p.handoffs, p.ticketsOpened, p.ticketsResolved, p.backlog, r2(p.medianFirstReplyMin), pctv(p.slaMet), pctv(csatScore(p.csatGood, p.csatOkay, p.csatBad)), p.escalations, r2(p.spend), r2(p.agentCost)]),
      }
    case 'agents':
      return {
        columns: ['Agent', 'Conversations', 'Handled by AI alone (%)', 'Handovers', 'Satisfaction (%)', `Business Agent cost${cur}`, 'Service replies this month'],
        rows: o.byAgent.map((a) => [a.label, a.conversations, pctv(a.containment), a.handoffs, pctv(a.csat), r2(a.agentCost), a.serviceMessages]),
      }
    case 'people':
      return {
        columns: ['Person', 'Resolved', 'Open now', 'Median first reply (minutes)', 'Satisfaction (%)', 'Escalated'],
        rows: o.people.map((p) => [p.name, p.resolved, p.open, r2(p.medianFirstReplyMin), pctv(p.csat), p.escalated]),
      }
    case 'teams':
      return { columns: ['Team', 'Opened', 'Resolved', 'Resolved on time (%)', 'Escalated'], rows: o.teams.map((t) => [t.name, t.opened, t.resolved, pctv(t.slaMet), t.escalated]) }
    case 'consumption': {
      const c = o.consumption
      return {
        columns: ['Section', 'Item', 'Volume', `Cost${cur}`],
        rows: [
          ...c.byCategory.map((x) => ['WhatsApp messages', x.category, x.volume, r2(x.cost)]),
          ['Meta Business Agent', 'Billable replies', c.agent.billableMessages, r2(c.agent.cost)],
          ['Meta Business Agent', 'Billable tokens', c.agent.tokens, null],
          ...c.serviceFreeTier.map((s) => ['Free service replies this month', s.label, s.used, null]),
          ['Console writing help', 'AI tokens', c.assist.tokens, null],
        ],
      }
    }
  }
  return { columns: [], rows: [] }
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
