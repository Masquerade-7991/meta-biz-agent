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
  // Members' own comings and goings; sign-ins have their own, quieter area below.
  people: { label: 'Team & members', kinds: ['member.invite', 'member.joined', 'member.left', 'member.removed', 'member.role_changed', 'member.updated', 'member.signup_cancelled', 'team.', 'api_token.', 'workspace.'] },
  signins: { label: 'Sign-ins & security', kinds: ['member.logged_in', 'member.switched_in', 'session.', 'profile.'] },
  contacts: { label: 'Contacts', kinds: ['contact.', 'segment.'] },
  templates: { label: 'Message templates', kinds: ['template.'] },
  reports: { label: 'Reports', kinds: ['report.'] },
  settings: { label: 'Settings', kinds: ['settings.', 'support.', 'canned.'] },
  whatsapp: { label: 'WhatsApp', kinds: ['whatsapp.', 'number.', 'account.notice', 'alert.', 'webhook.baseline_reset'] },
  operations: { label: 'Operations', kinds: ['job.dead', 'job.retried', 'request.failed'] },
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
  twentyFourSeven: '24/7',
  budget: 'budget',
  ownerId: 'owner',
  shared: 'sharing',
  title: 'name',
  shortcut: 'shortcut',
  body: 'message',
  actions: 'what happens after sending',
  timezone: 'time zone',
  holidays: 'holidays',
}
const DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
/** "hours.week.mon" → "Monday's hours", "sla.urgent" → "urgent response times", "levels.high" → "high escalation levels". */
function fieldLabel(k: string): string {
  if (Object.hasOwn(FIELD, k)) return FIELD[k]
  const [head, ...rest] = k.split('.')
  if (head === 'hours' && rest[0] === 'week' && rest[1]) return `${DAY[rest[1]] ?? rest[1]}'s hours`
  if (head === 'hours' && rest[0]) return fieldLabel(rest.join('.'))
  if (head === 'sla' && rest[0]) return `${rest[0]} response times`
  if (head === 'levels' && rest[0]) return `${rest[0]} escalation levels`
  if ((head === 'routing' || head === 'csat') && rest[0]) return `${FIELD[head]} (${rest.join(' ')})`
  return k
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
  if (field === 'ownerId') return someone(names, v)
  if (field === 'memberIds' && Array.isArray(v)) return v.map((id) => someone(names, id)).join(', ') || 'nobody'
  if (Array.isArray(v)) return v.join(', ') || 'none'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  return String(v)
}

/** "priority from Normal to Urgent and assignee from nobody to Priya". Nested values (hours, SLA)
 *  are named, not spelled out. */
export function changesText(changes: ActivityEvent['changes'], names: Names = {}): string {
  const parts = Object.entries(changes ?? {}).map(([k, [from, to]]) => {
    const label = fieldLabel(k)
    // Objects, and lists of objects (levels, rules), are named, not spelled out.
    const nested = (x: unknown): boolean => x !== null && typeof x === 'object' && (!Array.isArray(x) || x.some((y) => y !== null && typeof y === 'object'))
    return nested(from) || nested(to) ? label : `${label} from ${value(k, from, names)} to ${value(k, to, names)}`
  })
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const quoted = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '').map((x) => `“${String(x)}”`).join(', ') : '')
/** "added “Refunds”, removed “VIP” and reordered them" from a settings save's summary. */
function settingsSummary(d: Record<string, unknown>): string {
  const parts = [
    quoted(d.added) && `added ${quoted(d.added)}`,
    quoted(d.removed) && `removed ${quoted(d.removed)}`,
    quoted(d.changed) && `changed ${quoted(d.changed)}`,
    d.reordered === true && 'changed the order',
    Number(d.valuesCleared) > 0 && `cleared ${d.valuesCleared} contact value${Number(d.valuesCleared) === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
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
    case 'member.invite_resent':
      return `${who} resent the invite to ${d.email}`
    case 'member.signup_cancelled':
      return `${who} cancelled ${d.email ? `${d.email}'s` : 'a'} sign-up`
    case 'workspace.renamed':
      return `${who} renamed the workspace${d.name ? ` to “${d.name}”` : ''}`
    case 'workspace.transferred':
      return `${who} made ${d.name || member || 'someone'} an owner${d.stepDown ? ' and stepped down to admin' : ''}`
    case 'profile.name_changed':
      return `${who} changed their name`
    case 'profile.email_changed':
      return `${who} changed their login email and was logged out elsewhere`
    case 'profile.password_changed': {
      const n = Number(d.tokensRevoked) || 0
      return `${who} ${d.reset ? 'reset' : 'changed'} their password${n ? ` (${n} API token${n === 1 ? '' : 's'} revoked)` : ''}`
    }
    case 'session.revoked': {
      const n = Number(d.count) || 1
      return d.others ? `${who} signed out ${n} other device${n === 1 ? '' : 's'}` : d.current ? `${who} signed out this device` : `${who} signed out a device`
    }
    case 'canned.created':
      return `${who} created the ${d.shared ? 'shared' : 'private'} canned response ${d.shortcut ?? `“${d.title}”`}`
    case 'canned.updated':
      return `${who} changed the canned response ${d.shortcut ?? `“${d.title}”`}${changed ? `: ${changed}` : d.bodyChanged ? ': the message' : ''}`
    case 'canned.deleted':
      if (d.reason === 'member_left') return `${Number(d.count) || 0} private canned response${Number(d.count) === 1 ? '' : 's'} removed: their owner left`
      return `${who} deleted the canned response ${d.shortcut ?? `“${d.title}”`}`
    case 'segment.created':
      return `${who} saved the segment “${d.name}”`
    case 'segment.deleted':
      if (d.reason === 'field_removed') return `The segment “${d.name}” was deleted: its only filter was a contact field that was removed`
      return `${who} deleted the segment “${d.name}”`
    case 'support.recomputed':
      return `${who} applied new hours and targets to ${Number(d.updated) || 0} open ticket${Number(d.updated) === 1 ? '' : 's'}`
    case 'member.switched_in':
      return `${who} switched to this workspace`
    case 'member.invited':
      return `${who} invited ${d.email} as ${roleLabel(d.role as Role)}`
    case 'api_token.created':
      return `${who} created the API token “${d.name}”`
    case 'api_token.revoked':
      return `${who} revoked the API token “${d.name}”`
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
    case 'settings.updated': {
      const what = settingsSummary(d) || changed
      return `${who} changed ${SETTINGS_AREA[String(d.area)] ?? 'settings'}${what ? `: ${what}` : ''}`
    }
    case 'whatsapp.connected':
      return `${who} connected a WhatsApp account`
    case 'whatsapp.disconnected':
      return `${who} disconnected the WhatsApp account ${d.name ?? ''}`.trim()
    case 'whatsapp.retried':
      return `${who} retried setting up a WhatsApp account`
    case 'number.blocked':
      return `${who} blocked a customer on a number`
    case 'number.unblocked':
      return `${who} unblocked a customer on a number`
    case 'number.pin_viewed':
      return `${who} viewed a number's two-step PIN`
    case 'number.pin_changed':
      return `${who} changed a number's two-step PIN`
    case 'number.registered':
      return `${who} registered a number with WhatsApp`
    case 'number.deregistered':
      return `${who} deregistered a number from WhatsApp`
    case 'number.code_requested':
      return `${who} asked WhatsApp for a verification code`
    case 'number.verified':
      return `${who} verified a number`
    case 'number.name_requested':
      return `${who} asked Meta to change a display name${d.name ? ` to “${d.name}”` : ''}`
    case 'number.profile_updated':
      return `${who} changed a number's business profile`
    case 'number.photo_updated':
      return `${who} changed a number's profile photo`
    case 'number.automation_updated':
      return `${who} changed a number's welcome message and ice breakers`
    case 'template.status':
      return `Meta ${String(d.event ?? 'updated').toLowerCase()} the template “${d.name}”${d.reason ? `: ${String(d.reason).toLowerCase().replace(/_/g, ' ')}` : ''}`
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
    case 'job.dead':
      return `A background task gave up after ${e.data.attempts ?? '?'} tries: ${e.data.type}${e.data.error ? ` (${String(e.data.error).slice(0, 120)})` : ''}`
    case 'job.retried':
      return `${who} retried a background task: ${e.data.type}`
    case 'request.failed':
      return `A request failed on the server: ${e.data.method} ${e.data.path} (${e.data.status})`
    default:
      return `${who}: ${e.kind.replace(/[._]/g, ' ')}`
  }
}
