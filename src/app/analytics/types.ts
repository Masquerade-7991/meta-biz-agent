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
  /** Chats with a message from the customer, the AI or the team that day (system notes alone don't count). */
  conversations: number
  /** The AI answered and nobody from the team wrote. */
  aiOnly: number
  withTeam: number
  /** Nobody answered: neither the AI (as far as Meta reports) nor the team. */
  noReply: number
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
  /** Free-form (service) replies delivered in the chosen range. */
  serviceMessages: number
}

export interface Overview {
  range: { from: string; to: string; days: number; timezone: string; prevFrom: string; prevTo: string }
  currency: string | null
  /** Spend is reported per WhatsApp account, not per number: true when some agents are filtered out,
   *  so the WhatsApp spend (kpis.spend, series[].spend, consumption.byCategory) still covers every agent
   *  and there's no honest cost per resolved conversation. Agent cost (agentCost) is per agent. */
  spendWholeAccount: boolean
  /** The agents/numbers this workspace has, for the filter. */
  agents: { id: string; label: string }[]
  kpis: {
    conversations: Kpi
    containment: Kpi
    resolutionRate: Kpi
    csat: Kpi
    /** Chats handed to people: the AI handed over or someone took over (the Handovers log's rows). */
    handoffs: Kpi
    ticketsOpened: Kpi
    ticketsResolved: Kpi
    medianFirstReplyMin: Kpi
    medianResolveMin: Kpi
    slaMet: Kpi
    escalations: Kpi
    spend: Kpi
    costPerResolved: Kpi
    /** Handovers (handed over or taken over) out of conversations, both counted for the chosen agents (team and person filters don't apply). */
    handoffRate: Kpi
    /** Now-values: right now, whatever the range. */
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
}

export const LOG_KINDS = ['conversations', 'tickets', 'handovers', 'escalations', 'csat', 'charges', 'agent_usage'] as const
export type LogKind = (typeof LOG_KINDS)[number]
export type SortDir = 'asc' | 'desc'

export interface LogPage {
  kind: LogKind
  /** `sortable`: the log can be ordered by it (`sort=<key>`). */
  columns: { key: string; label: string; numeric?: boolean; sortable?: boolean }[]
  rows: Record<string, string | number | null>[]
  total: number
  /** The order the rows are in (the default is newest first). */
  sort?: { key: string; dir: SortDir }
}

export const LOG_LABEL: Record<LogKind, string> = {
  conversations: 'Conversations',
  tickets: 'Tickets',
  handovers: 'Handovers',
  escalations: 'Escalations',
  csat: 'Satisfaction responses',
  charges: 'Message charges',
  agent_usage: 'Agent usage',
}

/** What each headline number means: the label and the ⓘ text on KPI tiles in Reports (and Analytics),
 *  and which way is good. Times are medians; rates are weighted by volume. */
export const METRICS = {
  conversations: { label: 'Conversations', better: 'up', help: 'Chats with a message from the customer, the AI or the team in these dates.' },
  containment: { label: 'Handled by AI alone', better: 'up', help: 'Conversations the AI answered with nobody from the team writing, out of all conversations.' },
  aiOnly: { label: 'AI alone', better: 'up', help: 'Conversations the AI answered with nobody from the team writing.' },
  withTeam: { label: 'With the team', better: 'none', help: 'Conversations someone from the team wrote in.' },
  noReply: { label: 'No reply', better: 'down', help: 'Conversations nobody answered: neither the AI nor the team.' },
  handoffs: { label: 'Handovers', better: 'down', help: 'The AI handing a chat to a person, or someone taking it over.' },
  handoffRate: { label: 'Handover rate', better: 'down', help: 'Handovers (the AI handing over or someone taking over) out of conversations.' },
  csat: { label: 'Satisfaction', better: 'up', help: 'Good ratings count fully and okay ones half, out of all ratings received.' },
  ratings: { label: 'Ratings received', better: 'up', help: 'How many customers answered the rating question.' },
  good: { label: 'Good', better: 'up', help: 'Ratings of good.' },
  okay: { label: 'Okay', better: 'none', help: 'Ratings of okay.' },
  bad: { label: 'Bad', better: 'down', help: 'Ratings of bad.' },
  ticketsOpened: { label: 'Tickets opened', better: 'none', help: 'Tickets opened in these dates.' },
  ticketsResolved: { label: 'Tickets resolved', better: 'up', help: 'Tickets resolved in these dates.' },
  slaMet: { label: 'Resolved on time', better: 'up', help: 'Resolved tickets that met their resolution target, out of all resolved tickets.' },
  medianFirstReplyMin: { label: 'Median first reply', better: 'down', help: 'Half of tickets got their first reply from the team faster than this.' },
  medianResolveMin: { label: 'Median time to resolve', better: 'down', help: 'Half of tickets were resolved faster than this, from opened to resolved.' },
  escalations: { label: 'Escalations', better: 'down', help: 'Escalation levels reached; each level counts once per ticket.' },
  openNow: { label: 'Open now', better: 'none', help: 'Tickets open right now, whatever the dates.' },
  overdueNow: { label: 'Overdue now', better: 'down', help: 'Open tickets past a target right now, whatever the dates.' },
  spend: { label: 'Spend', better: 'down', help: 'WhatsApp messages plus the Meta Business Agent, in these dates.' },
  whatsappSpend: { label: 'WhatsApp spend', better: 'down', help: 'What Meta charged for messages. Meta reports it for the whole WhatsApp account, not per agent.' },
  agentCost: { label: 'Agent cost', better: 'down', help: 'What the Meta Business Agent’s billed replies cost.' },
  costPerResolved: { label: 'Cost per resolved conversation', better: 'down', help: 'WhatsApp and agent spend, divided by tickets resolved plus conversations the AI handled alone.' },
  budgetUsed: { label: 'Budget used', better: 'down', help: 'This calendar month’s spend against the monthly budget.' },
} as const satisfies Record<string, { label: string; better: 'up' | 'down' | 'none'; help: string }>
export type MetricId = keyof typeof METRICS

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
