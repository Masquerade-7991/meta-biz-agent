// Tickets, support settings (hours, SLA, routing, teams, CSAT), notifications and AI assist.
// Dummy mode answers in this browser (see supportDummy.ts).
import { jsonClient } from './client'
import { dummyTickets } from './supportDummy'

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
  /** Whether the server can write AI summaries (ANTHROPIC_API_KEY set). */
  aiSummary: boolean
}
/** Something about one ticket: an SLA due or overdue, or a ticket that's yours or nobody's. */
export interface TicketNotice {
  id: string
  kind: 'breached' | 'due' | 'assigned' | 'unassigned'
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
export type Notice = TicketNotice | AlertNotice
export const isAlert = (n: Notice): n is AlertNotice => n.kind === 'alert' || n.kind === 'alert_critical'

const call = jsonClient(dummyTickets)
const qs = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString()

export const listTickets = (f: { status?: string; assignee?: string; priority?: string; q?: string; phone?: string } = {}) => call<Ticket[]>(`/api/tickets?${qs(f)}`)
export const getTicket = (n: number) => call<Ticket>(`/api/tickets/${n}`)
export const createTicket = (phone: string, subject: string, priority: Priority) => call<Ticket>('/api/tickets', 'POST', { phone, subject, priority })
export const updateTicket = (n: number, patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId' | 'subject' | 'tags'>>) => call<Ticket>(`/api/tickets/${n}`, 'PATCH', patch)
export const resolveTicket = (n: number, o: { resolution: string; askFeedback: boolean; handBack: boolean }) => call<Ticket>(`/api/tickets/${n}/resolve`, 'POST', o)
export const bulkTickets = (numbers: number[], o: { action: 'resolve' } | { patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId'>> }) =>
  call<{ ok: true; count: number }>('/api/tickets/bulk', 'POST', { numbers, ...o })

export const getSupportSettings = () => call<SupportSettings>('/api/support/settings')
export const saveSupportSettings = (s: Omit<SupportSettings, 'aiSummary'>) => call<SupportSettings>('/api/support/settings', 'PUT', s)
export const listNotices = () => call<Notice[]>('/api/support/notifications')
export const dismissNotice = (id: string) => call<{ ok: true }>(`/api/support/notifications/${encodeURIComponent(id).replace('alert%3A', 'alert:')}/dismiss`, 'POST', {})
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
  high: 'bg-warning text-warning-foreground',
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
