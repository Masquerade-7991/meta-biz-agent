// The activity log in words: which events count as activity, the areas they're filtered by, and
// one plain sentence per event. Shared by the server (CSV) and every screen that lists activity.
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type TicketStatus } from '../support/routing.ts'
import { roleLabel, type Role } from '../lib/permissions.ts'

export interface ActivityEvent {
  id: string
  at: string
  kind: string
  /** Who did it; null = the system (a webhook, the AI agent, a timer). */
  userId: string | null
  /** Their name when the event was read (the server looks it up). */
  actor: string | null
  entity: string | null
  entityId: string | null
  data: Record<string, unknown>
  changes?: Record<string, [unknown, unknown]>
  traceId: string | null
}

/** Areas people filter by. Each is a list of event-kind prefixes; anything else (messages, jobs,
 *  webhook deliveries) is plumbing and only shows when looking up an error reference. */
export const AREAS = {
  tickets: { label: 'Tickets', kinds: ['ticket.'] },
  chats: { label: 'Chats', kinds: ['conversation.updated', 'customer.'] },
  agent: { label: 'AI agent', kinds: ['agent.'] },
  people: { label: 'Team & members', kinds: ['member.', 'team.'] },
  contacts: { label: 'Contacts', kinds: ['contact.'] },
  broadcasts: { label: 'Broadcasts & templates', kinds: ['broadcast.created', 'broadcast.started', 'broadcast.completed', 'broadcast.cancelled', 'template.'] },
  reports: { label: 'Reports', kinds: ['report.'] },
  settings: { label: 'Settings', kinds: ['settings.'] },
  whatsapp: { label: 'WhatsApp', kinds: ['whatsapp.', 'number.quality', 'number.name_reviewed', 'number.limit_update', 'account.notice', 'alert.', 'webhook.baseline_reset'] },
} as const
export type Area = keyof typeof AREAS
export const isArea = (v: unknown): v is Area => typeof v === 'string' && Object.hasOwn(AREAS, v)
/** Chat events that are only bookkeeping (opening a chat marks it read). */
export const QUIET_ACTIONS = ['read']

const FIELD: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  teamId: 'team',
  subject: 'subject',
  tags: 'tags',
  role: 'role',
  availability: 'availability',
  skills: 'skills',
  maxOpen: 'ticket limit',
  name: 'name',
  description: 'description',
  memberIds: 'members',
  leadId: 'team lead',
  assign: 'how tickets are shared',
  hours: 'business hours',
  awayMessage: 'away message',
  sla: 'response times',
  routing: 'default routing',
  csat: 'rating question',
  restrictAgents: 'who sees which chats',
  cadence: 'how often',
  hour: 'send time',
  reports: 'reports',
  recipients: 'recipients',
  enabled: 'on/off',
  filter: 'filters',
}
const SETTINGS_AREA: Record<string, string> = {
  support: 'support settings',
  routing_rules: 'routing rules',
  escalation: 'escalation rules',
  billing: 'billing settings',
  contact_fields: 'contact fields',
}
const SOURCE: Record<string, string> = { handoff: 'the AI handed the chat over', takeover: 'someone took over the chat', reply: 'the team replied', manual: 'created by hand', customer: 'the customer wrote again' }

export type Names = Record<string, string>
const someone = (names: Names, id: unknown) => (id ? names[String(id)] || 'a former member' : 'nobody')

function value(field: string, v: unknown, names: Names): string {
  if (v === null || v === undefined || v === '') return field === 'assigneeId' ? 'nobody' : 'none'
  if (field === 'status') return STATUS_LABEL[v as TicketStatus] ?? String(v)
  if (field === 'priority') return PRIORITY_LABEL[v as Priority] ?? String(v)
  if (field === 'assigneeId' || field === 'leadId') return someone(names, v)
  if (field === 'teamId') return names[`team:${v}`] ?? 'a team'
  if (field === 'role') return roleLabel(v as Role)
  if (field === 'memberIds' && Array.isArray(v)) return v.map((id) => someone(names, id)).join(', ') || 'nobody'
  if (Array.isArray(v)) return v.join(', ') || 'none'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  return String(v)
}

/** "priority from Normal to Urgent and assignee from nobody to Priya". Nested values (hours, SLA)
 *  are named, not spelled out. */
export function changesText(changes: ActivityEvent['changes'], names: Names = {}): string {
  const parts = Object.entries(changes ?? {}).map(([k, [from, to]]) => {
    const label = FIELD[k] ?? k
    const nested = (x: unknown) => x !== null && typeof x === 'object' && !Array.isArray(x)
    return nested(from) || nested(to) ? label : `${label} from ${value(k, from, names)} to ${value(k, to, names)}`
  })
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const resourceLabel = (r: unknown) =>
  String(r ?? 'setting')
    .split('/')
    .at(-1)!
    .replace(/^agent[-_]/, '')
    .replace(/[-_]/g, ' ')

/** One event as a sentence, starting with who did it ("Priya changed…", "The system…"). */
export function activityText(e: ActivityEvent, names: Names = {}): string {
  const who = e.actor || (e.userId ? (names[e.userId] || 'A former member') : 'The system')
  const d = e.data ?? {}
  const n = d.number ?? e.entityId
  const t = `#${n}`
  const changed = changesText(e.changes, names)
  const member = e.entity === 'member' ? String(d.name || someone(names, e.entityId)) : ''
  switch (e.kind) {
    case 'ticket.created':
      return e.userId && d.source === 'manual' ? `${who} opened ticket ${t}` : `Ticket ${t} opened: ${SOURCE[String(d.source)] ?? 'new conversation'}`
    case 'ticket.updated':
      if (d.reason === 'member_left') return `${t} was unassigned because its assignee left the workspace`
      return changed ? `${who} changed ${changed} on ${t}` : `${who} updated ${t}`
    case 'ticket.resolved':
      if (d.reason === 'handed_back') return `${t} resolved: the chat went back to the AI agent`
      return `${who} resolved ${t}${d.askCsat ? ' and asked for a rating' : ''}`
    case 'ticket.reopened':
      return d.reason === 'customer' ? `${t} reopened: the customer wrote again` : `${who} reopened ${t}`
    case 'ticket.escalated':
      return `${t} escalated to level ${d.level}`
    case 'ticket.rated':
      return `The customer rated ${t} ${String(d.label ?? '').toLowerCase()}`
    case 'conversation.updated': {
      const a = String(d.action)
      const what =
        a === 'control' ? (d.to === 'take' ? 'took over a chat from the AI agent' : 'handed a chat back to the AI agent')
        : a === 'assign' ? 'assigned a chat'
        : a === 'snooze' ? 'snoozed a chat'
        : a === 'woke' ? 'woke a snoozed chat'
        : a === 'block' ? 'blocked a customer'
        : a === 'unblock' ? 'unblocked a customer'
        : a === 'remind' ? 'set a reminder on a chat'
        : `updated a chat (${a})`
      return `${d.by === 'time' ? 'The system' : who} ${what}`
    }
    case 'customer.linked':
      return `${who} linked a customer's records`
    case 'agent.create':
    case 'agent.update':
    case 'agent.delete': {
      if (d['rollout.enabled'] === true) return `${who} published the AI agent`
      if (d['rollout.enabled'] === false) return `${who} paused the AI agent`
      const verb = e.kind === 'agent.create' ? 'added' : e.kind === 'agent.delete' ? 'removed' : 'changed'
      const title = d.title ?? d.name ?? d.question
      return `${who} ${verb} the AI agent's ${resourceLabel(d.resource)}${title ? ` “${String(title)}”` : ''}`
    }
    case 'member.logged_in':
      return `${who} logged in`
    case 'member.switched_in':
      return `${who} switched to this workspace`
    case 'member.invited':
      return `${who} invited ${d.email} as ${roleLabel(d.role as Role)}`
    case 'member.invite_revoked':
      return `${who} cancelled the invite for ${d.email}`
    case 'member.invite_declined':
      return `${d.email ?? who} declined the invite`
    case 'member.joined':
      return `${who} joined as ${roleLabel(d.role as Role)}`
    case 'member.left':
      return `${who} left the workspace`
    case 'member.removed':
      return `${who} removed ${member} from the workspace`
    case 'member.role_changed':
      return `${who} changed ${member}'s ${changed || 'role'}`
    case 'member.updated':
      return `${who} changed ${member}'s ${changed}`
    case 'team.created':
      return `${who} created the team “${d.name}”`
    case 'team.updated':
      return `${who} changed the team “${d.name}”${changed ? `: ${changed}` : ''}`
    case 'team.deleted':
      return `${who} deleted the team “${d.name}”`
    case 'contact.created':
      return `${who} added the contact +${e.entityId}`
    case 'contact.updated':
      return `${who} edited the contact +${e.entityId} (${(d.fields as string[] | undefined)?.join(', ')})`
    case 'contact.deleted':
      return `${who} deleted the contact +${e.entityId} and their chat history`
    case 'contact.imported':
      return `${who} imported contacts: ${d.added} added, ${d.updated} updated, ${d.skipped} skipped`
    case 'template.created':
      return `${who} submitted the template “${d.name}” for review`
    case 'template.deleted':
      return `${who} deleted the template “${d.name}”`
    case 'broadcast.created':
      return `${who} ${d.scheduled ? 'scheduled' : 'created'} a broadcast of “${d.template}” to ${d.audience} contacts`
    case 'broadcast.started':
      return `A broadcast started sending to ${d.audience} contacts`
    case 'broadcast.completed':
      return 'A broadcast finished sending'
    case 'broadcast.cancelled':
      return `${who} cancelled a broadcast`
    case 'report.scheduled':
      return `${who} scheduled the report email “${d.name}”`
    case 'report.schedule_updated':
      return `${who} changed the report email “${d.name}”${changed ? `: ${changed}` : ''}`
    case 'report.schedule_deleted':
      return `${who} deleted the report email “${d.name}”`
    case 'report.sent':
      return `Report email sent to ${d.recipients} ${d.recipients === 1 ? 'person' : 'people'}${Number(d.failed) ? ` (${d.failed} couldn't be reached)` : ''}`
    case 'report.downloaded':
      return `${who} downloaded the ${String(d.report).replace(/_/g, ' ')} report`
    case 'settings.updated':
      return `${who} changed ${SETTINGS_AREA[String(d.area)] ?? 'settings'}${changed ? `: ${changed}` : ''}`
    case 'whatsapp.connected':
      return `${who} connected a WhatsApp account`
    case 'whatsapp.disconnected':
      return `${who} disconnected the WhatsApp account ${d.name ?? ''}`.trim()
    case 'whatsapp.retried':
      return `${who} retried setting up a WhatsApp account`
    case 'number.quality':
      return `A number's quality changed from ${d.from ?? 'unknown'} to ${d.to}`
    case 'number.name_reviewed':
      return `Meta reviewed a display name: ${String(d.decision ?? '').toLowerCase()}`
    case 'number.limit_update':
      return `A number's messaging limit changed${d.limit ? ` to ${d.limit}` : ''}`
    case 'account.notice':
      return `Meta sent an account notice${d.detail ? `: ${d.detail}` : ''}`
    case 'alert.raised':
      return `Alert raised: ${String(d.key).split(':')[0].replace(/_/g, ' ')}`
    case 'webhook.baseline_reset':
      return `${who} marked the apps receiving events as expected`
    default:
      return `${who}: ${e.kind.replace(/[._]/g, ' ')}`
  }
}
