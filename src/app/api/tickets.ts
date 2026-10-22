// Tickets, support settings (hours, SLA, routing, teams, CSAT), notifications and AI assist.
// Dummy mode answers in this browser (see supportDummy.ts).
import { guard, jsonClient, stampedClient, supportDummy } from './client'
import { stampOf, type Stamp } from '@/app/components/shell/settings/formCore'
import type { AgentProfile, EscalationMatrix, Rule, Team, TicketSource, TicketStatus } from '@/app/support/routing'
export type { AgentProfile, EscalationMatrix, Rule, Team, TicketStatus }
export { PRIORITY_LABEL, STATUS_LABEL } from '@/app/support/routing'

export type Priority = 'urgent' | 'high' | 'normal' | 'low'
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
  source: TicketSource
  createdAt: string
  updatedAt: string
  firstRespondedAt: string | null
  resolvedAt: string | null
  resolution: string | null
  csat: { score: 1 | 2 | 3; label: string; at: string } | null
  /** paused = waiting on the customer: no clock runs until they write back. */
  sla: { kind: 'firstResponse' | 'resolve' | 'done' | 'paused'; at: string | null; breached: boolean }
  /** The team whose queue it's in (routing rules, escalation). */
  teamId?: string | null
  /** 0 = not escalated; 1–3 = the escalation matrix level reached. */
  escalationLevel?: number
  escalations?: { level: number; at: string; reason: string; notify: string[]; teamId?: string }[]
  /** When the response clocks started: opened, or reopened. */
  clockStartAt?: string
  /** Since when it's been waiting on the customer (clocks paused). */
  pausedAt?: string | null
  /** Time already spent waiting on the customer; the deadlines are this much later. */
  pausedMs?: number
  sample?: boolean
}
export type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
/** A day off: old ones are a bare date; named ones can repeat every year (same day and month). */
export type Holiday = string | { date: string; name?: string; yearly?: boolean }
export interface SupportSettings {
  /** A day open '00:00'–'24:00' is open all day. */
  hours: { timezone: string; week: Record<Day, { open: string; close: string } | null>; holidays: Holiday[] }
  /** Open around the clock: the week and holidays don't apply. */
  twentyFourSeven?: boolean
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
  /** When they were last saved, and by whom (for the 409 guard and "Last changed by"). */
  updatedAt?: string | null
  updatedBy?: string | null
  /** Open tickets right now: they keep their deadlines unless recomputed. */
  openTickets?: number
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
  target: 'billing' | 'whatsapp' | 'members'
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

const call = jsonClient(supportDummy('dummyTickets'))
const stamped = stampedClient(supportDummy('dummyTickets'))
const qs = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString()

interface TicketFilter {
  status?: string
  /** me, none, or a member's id. */
  assignee?: string
  priority?: string
  q?: string
  phone?: string
  team?: string
  escalated?: string
  /** 1 = past their response deadline. */
  breached?: string
  tag?: string
  /** due = what's due soonest first; default newest first. */
  sort?: string
  /** How many rows (100 by default, up to 1,000): Load more asks for more. */
  limit?: string
}
export const listTickets = (f: TicketFilter = {}) => call<Ticket[]>(`/api/tickets?${qs(f as Record<string, string | undefined>)}`)
export const getTicket = (n: number) => call<Ticket>(`/api/tickets/${n}`)
export const createTicket = (phone: string, subject: string, priority: Priority) => call<Ticket>('/api/tickets', 'POST', { phone, subject, priority })
export const updateTicket = (n: number, patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId' | 'subject' | 'tags' | 'teamId'>>) => call<Ticket>(`/api/tickets/${n}`, 'PATCH', patch)
export const resolveTicket = (n: number, o: { resolution: string; askFeedback: boolean; handBack: boolean }) => call<Ticket>(`/api/tickets/${n}/resolve`, 'POST', o)
interface BulkResult {
  done: number
  /** Tickets that couldn't change, and why (e.g. already resolved). */
  failed: { number: number; reason: string }[]
}
export const bulkTickets = (
  numbers: number[],
  o: { action: 'resolve'; askFeedback: boolean; handBack: boolean; resolution?: string } | { patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId' | 'teamId'>> },
) => call<BulkResult>('/api/tickets/bulk', 'POST', { numbers, ...o })

export const getSupportSettings = () => call<SupportSettings>('/api/support/settings')
/** Partial: keys left out keep their saved values. `updatedAt` = what this form loaded (409 if someone saved since). */
export const saveSupportSettings = (s: Partial<Omit<SupportSettings, 'aiSummary' | 'updatedAt' | 'updatedBy' | 'openTickets' | 'listenOnly' | 'saved'>> & { confirmNoHours?: boolean }, updatedAt?: string | null) =>
  call<SupportSettings>('/api/support/settings', 'PUT', s, guard(updatedAt))
/** Recomputes open tickets' deadlines with the current hours and targets. */
export const recomputeDeadlines = () => call<{ updated: number }>('/api/support/settings/recompute', 'POST', {})
// Teams, people, routing rules and the escalation matrix (server/supportOps.ts).
export const listTeams = () => call<Team[]>('/api/support/teams')
export const createTeam = (t: Omit<Team, 'id'>) => call<Team>('/api/support/teams', 'POST', t)
export const updateTeam = (id: string, t: Omit<Team, 'id'>) => call<Team>(`/api/support/teams/${id}`, 'PUT', t)
export const deleteTeam = (id: string) => call<{ ok: true }>(`/api/support/teams/${id}`, 'DELETE')
export const listAgents = () => call<AgentRow[]>('/api/support/agents')
export const updateAgent = (userId: string, patch: Partial<Pick<AgentProfile, 'skills' | 'maxOpen' | 'availability'>>) => call<{ ok: true }>(`/api/support/agents/${userId}`, 'PUT', patch)
/** A rule as listed: one pointing at a removed member or team stays, marked inactive (it never matches). */
export type ListedRule = Rule & { inactive?: boolean; inactiveReason?: string }
/** The rules come as a list; when they were saved comes in headers (Dummy mode: wrapped in the body). */
const rulesOf = ({ data, stamp }: { data: ListedRule[] | { rules: ListedRule[] }; stamp: Stamp }) => ({ rules: Array.isArray(data) ? data : data.rules, stamp })
export const getRules = () => stamped<ListedRule[] | { rules: ListedRule[] }>('/api/support/rules').then(rulesOf)
export const saveRules = (rules: ListedRule[], updatedAt?: string | null) => stamped<ListedRule[] | { rules: ListedRule[] }>('/api/support/rules', 'PUT', rules, guard(updatedAt)).then(rulesOf)
/** Each level carries a stable id (tickets remember the last level they reached by it). */
export type Level = EscalationMatrix['levels'][Priority][number] & { id?: string }
export type Matrix = Omit<EscalationMatrix, 'levels'> & { levels: Record<Priority, Level[]> }
const matrixOf = ({ updatedAt, updatedBy, ...m }: Matrix & { updatedAt?: string; updatedBy?: string }) => ({ matrix: m as Matrix, stamp: stampOf({ updatedAt, updatedBy }) as Stamp })
export const getEscalation = () => call<Matrix>('/api/support/escalation').then(matrixOf)
export const saveEscalation = (m: Matrix, updatedAt?: string | null) => call<Matrix>('/api/support/escalation', 'PUT', m, guard(updatedAt)).then(matrixOf)
/** Dummy mode only (Demo controls): the oldest open ticket reaches its next escalation level. */
export const escalateDemoTicket = () => call<{ number: number; level: number }>('/api/support/demo/escalate', 'POST', {})
export type AgentRow = AgentProfile & { open: number; teamIds: string[] }

export const listNotices = () => call<Notice[]>('/api/support/notifications')
/** Alerts and reminders stay until dismissed; ids look like alert:<key> or reminder:<id>. */
export const dismissNotice = (id: string) => call<{ ok: true }>(`/api/support/notifications/${encodeURIComponent(id).replace(/^(alert|reminder)%3A/, '$1:')}/dismiss`, 'POST', {})


export const PRIORITY_CLASS: Record<Priority, string> = {
  urgent: 'bg-destructive text-destructive-foreground',
  high: 'bg-warning/15 text-warning-foreground',
  normal: 'bg-muted text-foreground',
  low: 'bg-muted text-muted-foreground',
}

/** "Due in 25m", "Overdue by 2h", "Met" — the SLA in words. */
export function slaText(t: Pick<Ticket, 'sla' | 'status'>, now = Date.now()) {
  if (t.sla.kind === 'done') return t.sla.breached ? 'Resolved late' : 'Met'
  if (t.sla.kind === 'paused') return 'Paused: waiting on customer'
  if (!t.sla.at) return ''
  const diff = Date.parse(t.sla.at) - now
  const span = (ms: number) => {
    const m = Math.round(Math.abs(ms) / 60_000)
    return m < 60 ? `${m}m` : m < 60 * 48 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
  }
  const what = t.sla.kind === 'firstResponse' ? 'First reply' : 'Resolve'
  return diff < 0 ? `${what} overdue by ${span(diff)}` : `${what} due in ${span(diff)}`
}
