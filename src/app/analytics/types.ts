// What GET /api/analytics/overview and /api/analytics/logs/{kind} answer (server/analytics.ts).
// Shared by the server, the Analytics page and its Dummy-mode generator.

export interface AnalyticsFilter {
  /** YYYY-MM-DD, inclusive, in the support hours' time zone. */
  from: string
  to: string
  /** Agents by their WhatsApp number id; empty = all. */
  numbers: string[]
  /** Ticket metrics only: one team / one person. */
  team: string | null
  person: string | null
}

/** A number with its value in the period before, of the same length (null when there's nothing to compare). */
export interface Kpi {
  value: number | null
  prev: number | null
}

export interface DayPoint {
  date: string
  /** Chats with any message that day. */
  conversations: number
  aiOnly: number
  withTeam: number
  handoffs: number
  ticketsOpened: number
  ticketsResolved: number
  /** Open tickets at the end of the day. */
  backlog: number
  /** 0–1, share of the day's chats the AI handled alone. */
  containment: number | null
  /** 0–1, share of resolved tickets resolved on time. */
  slaMet: number | null
  medianFirstReplyMin: number | null
  csatGood: number
  csatOkay: number
  csatBad: number
  escalations: number
  /** WhatsApp spend that day (all numbers on the account), in `currency`. */
  spend: number
  /** Meta Business Agent cost that day. */
  agentCost: number
}

export interface AgentRow {
  id: string
  label: string
  conversations: number
  containment: number | null
  handoffs: number
  csat: number | null
  agentCost: number
  serviceMessages: number
}

export interface Overview {
  range: { from: string; to: string; days: number; timezone: string; prevFrom: string; prevTo: string }
  currency: string | null
  /** The agents/numbers this workspace has, for the filter. */
  agents: { id: string; label: string }[]
  kpis: {
    conversations: Kpi
    containment: Kpi
    resolutionRate: Kpi
    csat: Kpi
    handoffs: Kpi
    ticketsOpened: Kpi
    ticketsResolved: Kpi
    medianFirstReplyMin: Kpi
    medianResolveMin: Kpi
    slaMet: Kpi
    escalations: Kpi
    spend: Kpi
    costPerResolved: Kpi
    openNow: number
    overdueNow: number
    peopleAvailable: number
  }
  series: DayPoint[]
  /** Customer messages by weekday (Mon first) × hour. */
  heatmap: number[][]
  byAgent: AgentRow[]
  people: { id: string; name: string; resolved: number; open: number; medianFirstReplyMin: number | null; csat: number | null; escalated: number }[]
  teams: { id: string; name: string; opened: number; resolved: number; slaMet: number | null; escalated: number }[]
  escalationsByLevel: { level: number; count: number }[]
  handoffReasons: { label: string; count: number }[]
  tools: { tool: string; threads: number; successRate: number | null; errorRate: number | null; timeoutRate: number | null; avgLatencyMs: number | null }[]
  consumption: {
    byCategory: { category: string; volume: number; cost: number }[]
    /** Free-form (service) replies per number this calendar month, against Meta's 1,000 free per number. */
    serviceFreeTier: { id: string; label: string; used: number; free: number }[]
    agent: { billableMessages: number; tokens: number; cost: number; state: string | null }
    assist: { tokens: number; calls: number }
    budget: { monthly: number | null; spentThisMonth: number }
  }
  broadcasts: { sent: number; delivered: number; read: number; replied: number; failed: number }
}

export const LOG_KINDS = ['tickets', 'handovers', 'escalations', 'charges', 'agent_usage'] as const
export type LogKind = (typeof LOG_KINDS)[number]

export interface LogPage {
  kind: LogKind
  columns: { key: string; label: string; numeric?: boolean }[]
  rows: Record<string, string | number | null>[]
  total: number
}

export const LOG_LABEL: Record<LogKind, string> = {
  tickets: 'Tickets',
  handovers: 'Handovers',
  escalations: 'Escalations',
  charges: 'Message charges',
  agent_usage: 'Agent usage',
}

/** Meta's free service (non-template) replies per number each month, from 1 Oct 2026. */
export const FREE_SERVICE_MESSAGES = 1000

export const isoDay = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
export const dayList = (from: string, to: string) => Array.from({ length: daysBetween(from, to) }, (_, i) => addDays(from, i))
export const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, z) => a - z)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
/** CSAT as the share of good answers, with okay counting half (Good 3 · Okay 2 · Bad 1). */
export const csatScore = (good: number, okay: number, bad: number) => (good + okay + bad ? (good + okay * 0.5) / (good + okay + bad) : null)
