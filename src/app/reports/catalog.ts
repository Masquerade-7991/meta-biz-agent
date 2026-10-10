// The reports anyone with reports.view can download (CSV, opens in Excel), print as a PDF summary,
// or have emailed on a schedule. Each report is a table built from the Analytics overview or a log,
// the same way on the server (CSV, emails) and in the browser (print view, Dummy mode).
import { csatScore, type LogKind, type LogPage, type Overview } from '../analytics/types.ts'

export const REPORTS = [
  { id: 'business_review', title: 'Business review', description: 'The headline numbers against the period before: conversations, containment, satisfaction, speed, escalations and spend.', source: 'overview' },
  { id: 'daily', title: 'Day by day', description: 'Every day in the period: conversations, AI alone, handovers, tickets, response times, satisfaction and spend.', source: 'overview' },
  { id: 'agents', title: 'Agent performance', description: 'Each AI agent side by side: conversations, containment, handovers, satisfaction and cost.', source: 'overview' },
  { id: 'people', title: 'Team members', description: 'Resolved and open tickets, first reply, satisfaction and escalations per person.', source: 'overview' },
  { id: 'teams', title: 'Teams', description: 'Opened, resolved, on-time share and escalations per team.', source: 'overview' },
  { id: 'consumption', title: 'Consumption and cost', description: 'Spend by message category, the Business Agent’s usage and free service replies per number.', source: 'overview' },
  { id: 'tickets', title: 'Ticket log', description: 'Every ticket opened in the period with its team, assignee, timings, SLA, escalation and CSAT.', source: 'log' },
  { id: 'handovers', title: 'Handover log', description: 'Every chat handed to a person: how, to whom and how fast they replied.', source: 'log' },
  { id: 'escalations', title: 'Escalation log', description: 'Every escalation level reached, why and who was alerted.', source: 'log' },
  { id: 'charges', title: 'Message charges', description: 'One row per message status Meta priced: category, pricing type and whether it was billable.', source: 'log' },
  { id: 'agent_usage', title: 'Agent usage by hour', description: 'The Meta Business Agent’s billable replies, tokens and cost, hour by hour.', source: 'log' },
] as const

export type ReportId = (typeof REPORTS)[number]['id']
export const isReport = (v: unknown): v is ReportId => REPORTS.some((r) => r.id === v)
export const reportOf = (id: ReportId) => REPORTS.find((r) => r.id === id)!
export const isLogReport = (id: ReportId): id is ReportId & LogKind => reportOf(id).source === 'log'

export interface ReportTable {
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
        columns: ['Date', 'Conversations', 'AI alone', 'With the team', 'Handovers', 'Tickets opened', 'Tickets resolved', 'Open at end of day', 'Median first reply (minutes)', 'Resolved on time (%)', 'Satisfaction (%)', 'Escalations', `WhatsApp spend${cur}`, `Business Agent cost${cur}`],
        rows: o.series.map((p) => [p.date, p.conversations, p.aiOnly, p.withTeam, p.handoffs, p.ticketsOpened, p.ticketsResolved, p.backlog, r2(p.medianFirstReplyMin), pctv(p.slaMet), pctv(csatScore(p.csatGood, p.csatOkay, p.csatBad)), p.escalations, r2(p.spend), r2(p.agentCost)]),
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

const esc = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s
}
/** CSV that Excel opens with the right characters (UTF-8 mark first). Cells starting = + - @ are quoted as text, so a value can't run as a formula. */
export const tableCsv = (t: ReportTable) => '﻿' + [t.columns, ...t.rows].map((r) => r.map((v) => (typeof v === 'number' ? String(v) : esc(v))).join(',')).join('\r\n') + '\r\n'

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
}
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
