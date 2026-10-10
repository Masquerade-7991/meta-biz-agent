// Tickets, support settings (hours, SLA, routing, teams, CSAT), notifications and AI assist.
// Dummy mode answers in this browser (see supportDummy.ts).
import { jsonClient } from './client'
import { dummyTickets } from './supportDummy'
import type { AgentProfile, EscalationMatrix, Rule, Team } from '@/app/support/routing'
export type { AgentProfile, EscalationMatrix, Rule, Team }

export type Priority = 'urgent' | 'high' | 'normal' | 'low'
export type TicketStatus = 'open' | 'pending' | 'resolved'
export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']
export interface Ticket {
  id: string
  number: number
  phone: string
  name: string | null
  subject: string
  status: TicketStatus
  priority: Priority
  assigneeId: string | null
  tags: string[]
  source: 'handoff' | 'takeover' | 'reply' | 'manual'
  createdAt: string
  updatedAt: string
  firstRespondedAt: string | null
  resolvedAt: string | null
  resolution: string | null
  csat: { score: 1 | 2 | 3; label: string; at: string } | null
  sla: { kind: 'firstResponse' | 'resolve' | 'done'; at: string | null; breached: boolean }
  /** The team whose queue it's in (routing rules, escalation). */
  teamId?: string | null
  /** 0 = not escalated; 1–3 = the escalation matrix level reached. */
  escalationLevel?: number
  escalations?: { level: number; at: string; reason: string; notify: string[]; teamId?: string }[]
  sample?: boolean
}
export type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export interface SupportSettings {
  hours: { timezone: string; week: Record<Day, { open: string; close: string } | null>; holidays: string[] }
  awayMessage: string
  sla: Record<Priority, { firstResponse: number; resolve: number }>
  routing: { mode: 'unassigned' | 'round_robin' | 'fixed'; teamId: string | null; userId: string | null }
  teams: { id: string; name: string; memberIds: string[] }[]
  csat: { enabled: boolean; question: string }
  /** Agents see only their own chats and tickets, plus unassigned ones. */
  restrictAgents: boolean
  /** Whether the server can write AI summaries (ANTHROPIC_API_KEY set). */
  aiSummary: boolean
  /** The business's own number: the console sends nothing on its own (no away message, no feedback question). */
  listenOnly?: boolean
  /** False until the workspace saves these settings (the hours above are then Helo.ai's defaults). */
  saved?: boolean
}
/** Something about one ticket: an SLA due or overdue, or a ticket that's yours or nobody's. */
export interface TicketNotice {
  id: string
  kind: 'breached' | 'due' | 'assigned' | 'unassigned' | 'escalated'
  text: string
  at: string
  number: number
  phone: string
}
/** Something about the account, for owners: budget, number quality, a paused template. */
export interface AlertNotice {
  id: string
  kind: 'alert' | 'alert_critical'
  text: string
  at: string
  target: 'billing' | 'whatsapp' | 'broadcasts'
}
/** One of your reminders that is due (or a chat back from snooze). */
export interface ReminderNotice {
  id: string
  kind: 'reminder'
  text: string
  at: string
  phone: string
}
export type Notice = TicketNotice | AlertNotice | ReminderNotice
export const isAlert = (n: Notice): n is AlertNotice => n.kind === 'alert' || n.kind === 'alert_critical'

const call = jsonClient(dummyTickets)
const qs = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString()

export const listTickets = (f: { status?: string; assignee?: string; priority?: string; q?: string; phone?: string; team?: string; escalated?: string } = {}) => call<Ticket[]>(`/api/tickets?${qs(f)}`)
export const getTicket = (n: number) => call<Ticket>(`/api/tickets/${n}`)
export const createTicket = (phone: string, subject: string, priority: Priority) => call<Ticket>('/api/tickets', 'POST', { phone, subject, priority })
export const updateTicket = (n: number, patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId' | 'subject' | 'tags' | 'teamId'>>) => call<Ticket>(`/api/tickets/${n}`, 'PATCH', patch)
export const resolveTicket = (n: number, o: { resolution: string; askFeedback: boolean; handBack: boolean }) => call<Ticket>(`/api/tickets/${n}/resolve`, 'POST', o)
export const bulkTickets = (numbers: number[], o: { action: 'resolve' } | { patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId' | 'teamId'>> }) =>
  call<{ ok: true; count: number }>('/api/tickets/bulk', 'POST', { numbers, ...o })

export const getSupportSettings = () => call<SupportSettings>('/api/support/settings')
export const saveSupportSettings = (s: Omit<SupportSettings, 'aiSummary'>) => call<SupportSettings>('/api/support/settings', 'PUT', s)
// Teams, people, routing rules and the escalation matrix (server/supportOps.ts).
export const listTeams = () => call<Team[]>('/api/support/teams')
export const createTeam = (t: Omit<Team, 'id'>) => call<Team>('/api/support/teams', 'POST', t)
export const updateTeam = (id: string, t: Omit<Team, 'id'>) => call<Team>(`/api/support/teams/${id}`, 'PUT', t)
export const deleteTeam = (id: string) => call<{ ok: true }>(`/api/support/teams/${id}`, 'DELETE')
export const listAgents = () => call<AgentRow[]>('/api/support/agents')
export const updateAgent = (userId: string, patch: Partial<Pick<AgentProfile, 'skills' | 'maxOpen' | 'availability'>>) => call<{ ok: true }>(`/api/support/agents/${userId}`, 'PUT', patch)
export const getRules = () => call<Rule[]>('/api/support/rules')
export const saveRules = (rules: Rule[]) => call<Rule[]>('/api/support/rules', 'PUT', rules)
export const getEscalation = () => call<EscalationMatrix>('/api/support/escalation')
export const saveEscalation = (m: EscalationMatrix) => call<EscalationMatrix>('/api/support/escalation', 'PUT', m)
/** Dummy mode only (Demo controls): the oldest open ticket reaches its next escalation level. */
export const escalateDemoTicket = () => call<{ number: number; level: number }>('/api/support/demo/escalate', 'POST', {})
export type AgentRow = AgentProfile & { open: number; teamIds: string[] }

export const listNotices = () => call<Notice[]>('/api/support/notifications')
/** Alerts and reminders stay until dismissed; ids look like alert:<key> or reminder:<id>. */
export const dismissNotice = (id: string) => call<{ ok: true }>(`/api/support/notifications/${encodeURIComponent(id).replace(/^(alert|reminder)%3A/, '$1:')}/dismiss`, 'POST', {})
export interface SupportAnalytics {
  days: number
  timezone: string
  series: { date: string; created: number; resolved: number }[]
  created: number
  resolved: number
  open: number
  medianFirstReplyMin: number | null
  medianResolveMin: number | null
  slaFirstReplyMet: number | null
  slaResolveMet: number | null
  csat: { responses: number; average: number | null; good: number; okay: number; bad: number }
  chats: { total: number; aiOnly: number; withTeam: number }
  people: { name: string; resolved: number; open: number; medianFirstReplyMin: number | null }[]
  broadcasts: { sent: number; read: number; replied: number }
}
export const getSupportAnalytics = (days: 7 | 30 | 90) => call<SupportAnalytics>(`/api/support/analytics?days=${days}`)


export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }
export const PRIORITY_CLASS: Record<Priority, string> = {
  urgent: 'bg-destructive text-destructive-foreground',
  high: 'bg-warning/15 text-warning-foreground',
  normal: 'bg-muted text-foreground',
  low: 'bg-muted text-muted-foreground',
}
export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved' }

/** "Due in 25m", "Overdue by 2h", "Met" — the SLA in words. */
export function slaText(t: Pick<Ticket, 'sla' | 'status'>, now = Date.now()) {
  if (t.sla.kind === 'done') return t.sla.breached ? 'Resolved late' : 'Met'
  if (!t.sla.at) return ''
  const diff = Date.parse(t.sla.at) - now
  const span = (ms: number) => {
    const m = Math.round(Math.abs(ms) / 60_000)
    return m < 60 ? `${m}m` : m < 60 * 48 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
  }
  const what = t.sla.kind === 'firstResponse' ? 'First reply' : 'Resolve'
  return diff < 0 ? `${what} overdue by ${span(diff)}` : `${what} due in ${span(diff)}`
}
