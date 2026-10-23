// Dummy mode for the support platform: the server's /api/inbox, /api/tickets, /api/support, /api/contacts
// and /api/templates routes, answered in this browser from the sample chats.
// Changes live in memory for the session only. Replies go into the chat; nothing is sent.
import { SAMPLE_CHATS, sampleName } from '../inbox/sampleData'
import { MetaError } from './meta'
import { isBsuid, NO_CONTROL_HIDDEN } from '../lib/customer'
import { checkMedia, mediaLabel, type MediaKind } from '../inbox/media'
import { interactiveError, interactiveText, type InteractiveReply } from '../inbox/interactive'
import type { NumberDetail, WaNumber } from './numbers'
import { automationErrors, displayNameError, profileErrors, type Automation, type Profile } from '../whatsapp/profileRules'
import type { CannedResponse, ChatDetail, ChatFilter, ChatMessage, ChatSummary, SavedView } from './inbox'
import type { AgentRow, Priority, SupportSettings, Ticket } from './tickets'
import { demoMemberList } from '../auth/api'
import { demoRoleNow } from './dummy'
import { can, type Role } from '../lib/permissions'
import {
  applyRule,
  DEFAULT_MATRIX,
  describeLevel,
  firstMatch,
  parseMatrix,
  parseRules,
  parseTeam,
  pickFromPool,
  raise,
  routePlan,
  type AgentProfile,
  type EscalationMatrix,
  type Rule,
  type Team,
} from '../support/routing'
import type { Contact, FieldDef, Segment } from './contacts'
import type { WaTemplate } from './templates'
import type { WaAccount } from './whatsapp'
import { renderTemplate } from '../templates/templates'
import { parseActions } from '../inbox/macros'
import { customerWrites, pausedFor } from '../support/ticketRules'
import { supportSettingsError } from '../support/hoursRules'

// Saved settings carry when and by whom, and a save sent with If-Unmodified-Since older than that is
// refused with a 409, as on the server.
const stampNow = () => ({ updatedAt: new Date().toISOString(), updatedBy: 'Demo User' })
function checkUnmodified(headers: Record<string, string> | undefined, stamp: { updatedAt: string | null }) {
  const since = headers?.['if-unmodified-since']
  if (since && stamp.updatedAt && Date.parse(stamp.updatedAt) > Date.parse(since)) throw new MetaError(409, 'Changed by someone else', 'Someone else saved these settings after you opened them. Reload to see their changes, or keep yours.')
}
const needManage = () => {
  if (!can(demoRoleNow() as Role, 'settings.manage')) throw new MetaError(403, 'Not allowed', 'Only owners and admins can change these settings.')
}

interface Chat {
  phone: string
  name: string
  tags: string[]
  owner: 'ai' | 'human'
  assigneeId: string | null
  unread: number
  messages: ChatMessage[]
  snoozedUntil?: string
  blocked?: boolean
}
// Reminders and saved views live in this tab only, like the rest of dummy mode.
let demoReminders: { id: string; phone: string; note: string; dueAt: string; dismissed: boolean }[] = []
let demoViews: SavedView[] = []
const ME = { id: 'demo', name: 'You' }
const DAY = 86_400_000
let seq = 0
let chats: Chat[] | null = null
let canned: CannedResponse[] = [
  { id: 'c1', title: 'Refund timeline', shortcut: '/refund', body: 'Hi {{name}}, refunds reach your account in 3 to 5 working days.', shared: true },
  { id: 'c2', title: 'Book a demo', shortcut: '/demo', body: 'Happy to show you around, {{name}}. Pick a time that suits you: https://helo.ai/contact-us', shared: true },
  { id: 'c3', title: 'Refund done (macro)', shortcut: '/refunded', body: 'Hi {{name}}, your refund is on its way. Anything else I can help with?', shared: true, actions: { status: 'resolved', tags: ['refund'] } },
]

function load(): Chat[] {
  if (chats) return chats
  const now = Date.now()
  chats = SAMPLE_CHATS.map((c) => ({
    phone: c.phone,
    name: sampleName(c),
    tags: c.tags,
    owner: c.owner,
    assigneeId: c.owner === 'human' && c.phone.endsWith('103') ? ME.id : null,
    unread: c.messages.at(-1)?.author === 'customer' ? 1 : 0,
    messages: c.messages.map((m) => ({
      id: `m${++seq}`,
      phone: c.phone,
      direction: m.author === 'customer' ? 'in' : 'out',
      author: m.author === 'note' ? 'agent' : m.author,
      ...(m.author === 'agent' || m.author === 'note' ? { authorId: ME.id, authorName: ME.name } : {}),
      kind: m.author === 'note' ? 'note' : 'text',
      body: m.body,
      at: new Date(now - m.ago * 60_000).toISOString(),
    })),
  }))
  return chats
}
const lastInbound = (c: Chat) => c.messages.filter((m) => m.direction === 'in').at(-1)?.at ?? null
const windowOpen = (c: Chat) => {
  const t = lastInbound(c)
  return !!t && Date.now() - Date.parse(t) < DAY
}
const summary = (c: Chat): ChatSummary => {
  const last = c.messages.filter((m) => m.kind !== 'note').at(-1)
  return {
    phone: c.phone,
    name: c.name,
    tags: c.tags,
    owner: c.owner,
    assigneeId: c.assigneeId,
    unread: c.unread,
    lastMessageAt: c.messages.at(-1)?.at ?? null,
    windowOpen: windowOpen(c),
    sample: true,
    snoozedUntil: c.snoozedUntil ?? null,
    preview: last ? { author: last.author, body: last.body } : null,
  }
}
const detail = (c: Chat): ChatDetail => ({
  conversation: { phone: c.phone, owner: c.owner, assigneeId: c.assigneeId, lastInboundAt: lastInbound(c), windowOpen: windowOpen(c), sample: true, snoozedUntil: c.snoozedUntil ?? null },
  reminders: demoReminders.filter((r) => r.phone === c.phone && Date.parse(r.dueAt) > Date.now()).map(({ id, note, dueAt }) => ({ id, note, dueAt })),
  contact: { phone: c.phone, name: c.name, tags: c.tags, fields: {}, blocked: !!c.blocked },
  messages: c.messages,
})
const push = (c: Chat, m: Omit<ChatMessage, 'id' | 'phone' | 'at'>) => c.messages.push({ id: `m${++seq}`, phone: c.phone, at: new Date().toISOString(), ...m })

export async function dummyInbox<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, string | null>
  const u = new URL(path, 'http://x')
  const list = load()
  const m = u.pathname.match(/^\/api\/inbox\/conversations\/([^/]+)(?:\/([a-z]+))?$/)
  if (u.pathname === '/api/inbox/conversations') {
    const f = u.searchParams.get('filter')
    const q = (u.searchParams.get('q') ?? '').toLowerCase()
    const asleep = (c: Chat) => !!c.snoozedUntil && Date.parse(c.snoozedUntil) > Date.now()
    return list
      .filter((c) => (f === 'snoozed' ? asleep(c) : !asleep(c)))
      .filter((c) => (f === 'mine' ? c.assigneeId === ME.id : f === 'unassigned' ? c.owner === 'human' && !c.assigneeId : f === 'ai' ? c.owner === 'ai' : true))
      .filter((c) => {
        if (f === 'closing') {
          const last = lastInbound(c)
          const left = last ? Date.parse(last) + 86_400_000 - Date.now() : -1
          return left > 0 && left <= 3_600_000
        }
        // The demo person is in both sample teams, so "my team" is any chat with an open team ticket.
        if (f === 'team') return ticketsNow().some((t) => t.phone === c.phone && t.status !== 'resolved' && !!t.teamId)
        return true
      })
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .map(summary)
      .sort((a, z) => Date.parse(z.lastMessageAt ?? '0') - Date.parse(a.lastMessageAt ?? '0')) as T
  }
  if (u.pathname === '/api/inbox/search') {
    const q = (u.searchParams.get('q') ?? '').trim().toLowerCase()
    if (q.length < 2) return [] as T
    return list
      .flatMap((c) => c.messages.filter((x) => x.body?.toLowerCase().includes(q)).map((x) => ({ id: x.id, phone: c.phone, name: c.name || null, body: x.body!, at: x.at, kind: x.kind, author: x.author })))
      .slice(0, 30) as T
  }
  if (u.pathname === '/api/inbox/views') {
    if (method === 'POST') demoViews = [...demoViews.filter((v) => v.name !== b.name), { id: `v${++seq}`, name: String(b.name), filter: (b.filter ?? 'all') as ChatFilter, q: String(b.q ?? '') }]
    return demoViews as T
  }
  if (u.pathname.startsWith('/api/inbox/views/')) {
    demoViews = demoViews.filter((v) => !u.pathname.endsWith(`/${v.id}`))
    return demoViews as T
  }
  if (m) {
    const c = list.find((x) => x.phone === decodeURIComponent(m[1]))
    if (!c) throw new MetaError(404, 'Not found', 'No chat with this number yet.')
    if (m[2] === 'suggest') return { text: 'Thanks for your patience! I’ve checked this for you and our team is on it. You’ll hear back within the day.' } as T
    if (m[2] === 'summary') throw new MetaError(400, 'Check the details', 'Summaries need an Anthropic API key in the server settings (ANTHROPIC_API_KEY).')
    if (m[2] === 'presence') return { ok: true } as T
    if (m[2] === 'messages') {
      if (!windowOpen(c)) throw new MetaError(400, 'Check the details', 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
      push(c, { direction: 'out', author: 'agent', authorId: ME.id, authorName: ME.name, kind: 'text', body: String(b.text), status: 'sent' })
      c.owner = 'human'
      c.unread = 0
      c.assigneeId ??= ME.id
      ensureTicket(c, 'reply').firstRespondedAt ??= new Date().toISOString()
    }
    if (m[2] === 'interactive') {
      const r = body as InteractiveReply
      const problem = interactiveError(r)
      if (problem) throw new MetaError(400, 'Check the details', problem)
      if (!windowOpen(c)) throw new MetaError(400, 'Check the details', 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
      push(c, { direction: 'out', author: 'agent', authorId: ME.id, authorName: ME.name, kind: 'interactive', body: interactiveText(r), status: 'sent' })
      c.owner = 'human'
      c.assigneeId ??= ME.id
    }
    if (m[2] === 'media') {
      // The file stays in this tab as a blob URL; the rest works like the real thing.
      const f = (body as { file: File; caption: string; kind: MediaKind }).file
      const check = checkMedia(f.type, f.size)
      if ('error' in check) throw new MetaError(400, 'Check the details', check.error)
      if (!windowOpen(c)) throw new MetaError(400, 'Check the details', 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
      const caption = check.kind === 'audio' ? '' : String((body as { caption?: string }).caption ?? '').trim()
      push(c, {
        direction: 'out',
        author: 'agent',
        authorId: ME.id,
        authorName: ME.name,
        kind: 'media',
        body: caption || mediaLabel(check.kind, f.name),
        status: 'sent',
        media: { kind: check.kind, mime: f.type, id: URL.createObjectURL(f), filename: f.name, size: f.size, ...(caption && { caption }), state: 'ready' },
      })
      c.owner = 'human'
      c.assigneeId ??= ME.id
    }
    if (m[2] === 'notes') push(c, { direction: 'out', author: 'agent', authorId: ME.id, authorName: ME.name, kind: 'note', body: String(b.text) })
    if (m[2] === 'assign') {
      c.assigneeId = b.userId ?? null
      for (const t of ticketsNow()) if (t.phone === c.phone && t.status !== 'resolved') t.assigneeId = c.assigneeId
    }
    if (m[2] === 'read') c.unread = 0
    if (m[2] === 'block') {
      if (!windowOpen(c)) throw new MetaError(400, 'Check the details', 'WhatsApp only lets you block someone who messaged this number in the last 24 hours.')
      c.blocked = true
    }
    if (m[2] === 'unblock') c.blocked = false
    if (m[2] === 'snooze') {
      if (b.until && Date.parse(String(b.until)) < Date.now() + 30_000) throw new MetaError(400, 'Check the details', 'Pick a time in the future.')
      c.snoozedUntil = b.until ? String(b.until) : undefined
    }
    if (m[2] === 'remind') {
      if (!b.at || Date.parse(String(b.at)) < Date.now() + 30_000) throw new MetaError(400, 'Check the details', 'Pick a time in the future.')
      demoReminders.push({ id: `r${++seq}`, phone: c.phone, note: String(b.note || 'Follow up'), dueAt: String(b.at), dismissed: false })
    }
    if (m[2] === 'control') {
      if (isBsuid(c.phone)) throw new MetaError(400, 'Check the details', NO_CONTROL_HIDDEN)
      c.owner = b.action === 'take' ? 'human' : 'ai'
      if (b.action === 'take') {
        c.assigneeId ??= ME.id
        ensureTicket(c, 'takeover')
      } else closeOnRelease(c.phone)
      push(c, { direction: 'out', author: 'system', kind: 'event', body: b.action === 'take' ? 'You took over from the AI agent.' : 'You handed the chat back to the AI agent.' })
    }
    return detail(c) as T
  }
  if (u.pathname === '/api/inbox/canned' && method === 'GET') return canned as T
  if (u.pathname.startsWith('/api/inbox/canned')) {
    const id = u.pathname.split('/')[4]
    const admin = can(demoRoleNow() as Role, 'settings.manage')
    const before = id ? canned.find((x) => x.id === id) : undefined
    if (id && !before) throw new MetaError(404, 'Not found', 'That canned response was deleted.')
    // Delete follows the same rule as edit: the team's shared responses are the admins'.
    if (before?.shared && !admin) throw new MetaError(403, 'Not allowed', 'Only owners and admins can change the team’s shared responses.')
    if (method === 'DELETE') {
      canned = canned.filter((x) => x.id !== id)
      return { ok: true } as T
    }
    const shortcut = '/' + String(b.shortcut ?? '').replace(/^\//, '').toLowerCase()
    if (!/^\/[a-z0-9-_]+$/.test(shortcut)) throw new MetaError(400, 'Check the details', 'Shortcuts use letters, numbers, - and _ only, like /refund.')
    if (canned.some((x) => x.shortcut === shortcut && x.id !== id)) throw new MetaError(409, 'Already exists', `${shortcut} is already used.`)
    // Left out, `shared` keeps its value; new ones are private unless sent shared.
    const sentShared = (body as { shared?: boolean }).shared
    if (sentShared === true && !admin) throw new MetaError(403, 'Not allowed', 'Only owners and admins share responses with the team.')
    const shared = admin && (sentShared ?? before?.shared ?? false)
    const row = { id: id ?? `c${++seq}`, title: String(b.title), shortcut, body: String(b.body), shared, createdBy: before?.createdBy ?? 'demo', actions: parseActions((body as { actions?: unknown }).actions) ?? null }
    canned = id ? canned.map((x) => (x.id === id ? row : x)) : [...canned, row]
    return row as T
  }
  if (u.pathname === '/api/inbox/demo/simulate') {
    const c = list.find((x) => x.phone === b.phone) ?? list[0]
    push(c, { direction: 'in', author: 'customer', kind: 'text', body: String(b.text) })
    c.unread++
    onCustomerWrites(c)
    return { ok: true } as T
  }
  if (u.pathname === '/api/inbox/demo') {
    if (method === 'DELETE') chats = []
    else chats = null
    return { ok: true } as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- tickets, support settings, assist (dummy) ----
const MIN = 60_000
let tickets: Ticket[] | null = null
let nextNumber = 1001
let settings: SupportSettings = {
  saved: true,
  hours: {
    timezone: 'Asia/Kolkata',
    week: { sun: null, mon: { open: '09:30', close: '18:30' }, tue: { open: '09:30', close: '18:30' }, wed: { open: '09:30', close: '18:30' }, thu: { open: '09:30', close: '18:30' }, fri: { open: '09:30', close: '18:30' }, sat: { open: '10:00', close: '14:00' } },
    holidays: [],
  },
  awayMessage: 'Thanks for your message. Our team is offline right now and will reply when we’re back.',
  sla: { urgent: { firstResponse: 15, resolve: 240 }, high: { firstResponse: 30, resolve: 480 }, normal: { firstResponse: 60, resolve: 1440 }, low: { firstResponse: 240, resolve: 2880 } },
  routing: { mode: 'round_robin', teamId: null, userId: null },
  teams: [],
  csat: { enabled: true, question: 'How did we do today?' },
  restrictAgents: false,
  aiSummary: false,
}
let settingsStamp: { updatedAt: string | null; updatedBy: string | null } = { updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), updatedBy: 'Demo User' }

/** Demo SLAs count plain minutes (the server counts business hours), from when the clock started,
 *  later by the time spent waiting on the customer. */
const dueOf = (t: Ticket, target: 'firstResponse' | 'resolve') => Date.parse(t.clockStartAt ?? t.createdAt) + settings.sla[t.priority][target] * MIN + (t.pausedMs ?? 0)
function withSla(t: Ticket): Ticket {
  if (t.status === 'pending') return { ...t, sla: { kind: 'paused', at: null, breached: false } }
  const target = t.status === 'resolved' ? null : t.firstRespondedAt ? 'resolve' : 'firstResponse'
  if (!target) return { ...t, sla: { kind: 'done', at: null, breached: false } }
  const at = dueOf(t, target)
  return { ...t, sla: { kind: target, at: new Date(at).toISOString(), breached: at < Date.now() } }
}
const nowIso = () => new Date().toISOString()
/** Resolved again: fresh clocks from now, a first reply is due again, escalations start over. */
const reopen = (t: Ticket, status: 'open' | 'pending') =>
  Object.assign(t, { status, resolvedAt: null, resolution: null, clockStartAt: nowIso(), pausedAt: status === 'pending' ? nowIso() : null, pausedMs: 0, firstRespondedAt: null, escalationLevel: 0, updatedAt: nowIso() })
const resume = (t: Ticket) => Object.assign(t, { status: 'open', pausedMs: (t.pausedMs ?? 0) + pausedFor(t.pausedAt, Date.now()), pausedAt: null, updatedAt: nowIso() })
/** Same as the server's closeOnRelease: back with the AI agent, its ticket is done. */
function closeOnRelease(phone: string) {
  const t = ticketsNow().find((x) => x.phone === phone && x.status !== 'resolved')
  if (t) Object.assign(t, { status: 'resolved', resolvedAt: nowIso(), pausedAt: null, resolution: 'Handed back to the AI agent.' })
}
/** Same as the server's onCustomerMessage (ticketRules.ts customerWrites). */
function onCustomerWrites(c: Chat) {
  const latest = ticketsNow().filter((t) => t.phone === c.phone).sort((a, z) => z.number - a.number)[0] ?? null
  const next = customerWrites(latest, c.owner === 'human' ? 'human' : 'ai', Date.now())
  if (next === 'resume' && latest) resume(latest)
  if (next === 'reopen' && latest) {
    reopen(latest, 'open')
    push(c, { direction: 'out', author: 'system', kind: 'event', body: `Ticket #${latest.number} reopened: the customer wrote again.` })
  }
  if (next === 'new') ensureTicket(c, 'customer')
}
function ticketsNow(): Ticket[] {
  if (!tickets) {
    tickets = []
    for (const c of load().filter((x) => x.owner === 'human')) ensureTicket(c, 'handoff', c.tags.includes('priority') ? 'high' : 'normal')
  }
  return tickets
}
// ---- teams, people, rules, escalation (dummy) ----
let demoTeams: Team[] = [
  { id: 'team-billing', name: 'Billing', description: 'Refunds, invoices and payments', leadId: 'demo-2', memberIds: ['demo-2', 'demo-3'], assign: 'least_busy' },
  { id: 'team-care', name: 'Customer care', description: 'Orders, delivery and everything else', leadId: 'demo', memberIds: ['demo', 'demo-3'], assign: 'round_robin' },
]
const demoProfiles = new Map<string, Pick<AgentProfile, 'skills' | 'maxOpen' | 'availability'>>([
  ['demo', { skills: ['english'], maxOpen: null, availability: 'online' }],
  ['demo-2', { skills: ['english', 'hindi'], maxOpen: 8, availability: 'online' }],
  ['demo-3', { skills: ['hindi'], maxOpen: 5, availability: 'away' }],
])
let demoRules: Rule[] = [
  {
    id: 'r-billing',
    name: 'Refunds and payments go to Billing',
    enabled: true,
    match: 'any',
    when: [{ field: 'keyword', any: ['refund', 'payment', 'invoice', 'charged'] }],
    then: [{ do: 'assignTeam', teamId: 'team-billing' }, { do: 'addTags', tags: ['billing'] }],
  },
  { id: 'r-vip', name: 'VIP customers jump the queue', enabled: true, match: 'all', when: [{ field: 'contactTag', any: ['vip'] }], then: [{ do: 'setPriority', priority: 'high' }] },
]
let demoMatrix: EscalationMatrix = { ...DEFAULT_MATRIX, enabled: true }
let rulesStamp: { updatedAt: string | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null }
let matrixStamp: { updatedAt: string | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null }
/** Why a rule can't run any more (it names a removed team or person), or null. */
function staleReason(r: Rule, teams: Set<string>, members: Set<string>): string | null {
  for (const a of Array.isArray(r?.then) ? r.then : []) {
    if (a.do === 'assignTeam' && !teams.has(a.teamId)) return 'Sends tickets to a team that was deleted.'
    if (a.do === 'assignUser' && !members.has(a.userId)) return 'Assigns to someone who left the workspace.'
  }
  return null
}
const withInactive = (r: Rule, teams: Set<string>, members: Set<string>) => {
  const why = staleReason(r, teams, members)
  return why ? { ...r, inactive: true, inactiveReason: why } : r
}
/** Levels keep the id they came with (by position in what was sent); new ones get one. */
function withLevelIds(m: EscalationMatrix, sent: unknown): EscalationMatrix {
  const lv = ((sent as { levels?: Record<string, { id?: string }[]> })?.levels ?? {}) as Record<string, { id?: string }[]>
  let n = 0
  return {
    ...m,
    levels: Object.fromEntries(Object.entries(m.levels).map(([p, list]) => [p, list.map((l, i) => ({ ...l, id: lv[p]?.[i]?.id || `lv-${p}-${Date.now().toString(36)}-${n++}` }))])) as unknown as EscalationMatrix['levels'],
  }
}
const profileOf = (id: string) => demoProfiles.get(id) ?? { skills: [], maxOpen: null, availability: 'online' as const }
let demoTurn = 0

/** The server's routeTicket on the demo's people and minutes: the same rule and default decision
 *  (routing.ts routePlan); only the pool of people differs. */
function demoRoute(c: Chat, source: Ticket['source'], priority: Priority, text: string) {
  const facts = { source, priority, text, contactTags: c.tags, open: true, phoneNumberId: null }
  const rule = firstMatch(demoRules, facts)
  const a = applyRule(rule, facts)
  const open = new Map<string, number>()
  for (const t of tickets ?? []) if (t.status !== 'resolved' && t.assigneeId) open.set(t.assigneeId, (open.get(t.assigneeId) ?? 0) + 1)
  const profiles = new Map(demoMemberList().map((m) => [m.userId, profileOf(m.userId)]))
  const plan = routePlan(a.target, settings.routing, demoTeams)
  // Someone already looking after the chat keeps it, as on the server.
  const picked =
    plan.to === 'user' ? plan.userId
    : plan.to === 'team' ? pickFromPool(plan.team.memberIds, plan.team.assign, profiles, open, demoTurn++, plan.skill)
    : plan.to === 'everyone' ? pickFromPool([...profiles.keys()], 'round_robin', profiles, open, demoTurn++)
    : null
  return { priority: a.priority, tags: a.tags, teamId: plan.to === 'team' ? plan.team.id : null, assigneeId: c.assigneeId ?? picked, rule: rule?.name ?? null }
}

function ensureTicket(c: Chat, source: Ticket['source'], priority: Priority = 'normal'): Ticket {
  const list = tickets ?? ticketsNow()
  const open = list.find((t) => t.phone === c.phone && t.status !== 'resolved')
  if (open) return open
  const words = c.messages.filter((m) => m.author === 'customer' && m.body).at(-1)?.body ?? `Chat with +${c.phone}`
  const at = c.messages.find((m) => m.author === 'customer')?.at ?? new Date().toISOString()
  const r = demoRoute(c, source, priority, words)
  const t: Ticket = { id: `t${nextNumber}`, number: nextNumber++, phone: c.phone, name: c.name, subject: words.slice(0, 120), status: 'open', priority: r.priority, assigneeId: r.assigneeId, teamId: r.teamId, escalationLevel: 0, escalations: [], tags: r.tags, source, createdAt: at, updatedAt: at, firstRespondedAt: null, resolvedAt: null, resolution: null, csat: null, sla: { kind: 'firstResponse', at: null, breached: false }, sample: true }
  list.unshift(t)
  if (r.assigneeId && !c.assigneeId) c.assigneeId = r.assigneeId
  if (r.rule && tickets) push(c, { direction: 'out', author: 'system', kind: 'event', body: `Ticket #${t.number} routed by the rule “${r.rule}”.` })
  return t
}

export async function dummyTickets<T>(method: string, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  const list = ticketsNow()
  const p = (k: string) => u.searchParams.get(k) ?? ''
  if (u.pathname === '/api/tickets' && method === 'GET') {
    const q = p('q').toLowerCase()
    const due = (t: Ticket) => (t.sla.at ? Date.parse(t.sla.at) : Infinity)
    return list
      .filter((t) => (p('status') === 'all' ? true : p('status') ? t.status === p('status') : t.status !== 'resolved'))
      .filter((t) => (p('assignee') === 'me' ? t.assigneeId === ME.id : p('assignee') === 'none' ? !t.assigneeId : !p('assignee') || t.assigneeId === p('assignee')))
      .filter((t) => !p('tag') || t.tags.includes(p('tag')))
      .filter((t) => !p('priority') || t.priority === p('priority'))
      .filter((t) => (p('team') === 'none' ? !t.teamId : !p('team') || t.teamId === p('team')))
      .filter((t) => p('escalated') !== '1' || (t.escalationLevel ?? 0) > 0)
      .filter((t) => !p('phone') || t.phone === p('phone'))
      .filter((t) => !q || `${t.number} ${t.subject} ${t.name ?? ''} ${t.phone}`.toLowerCase().includes(q))
      .map(withSla)
      .filter((t) => p('breached') !== '1' || t.sla.breached)
      .sort((a, z) => (p('sort') === 'due' ? due(a) - due(z) || z.number - a.number : z.number - a.number))
      .slice(0, Number(p('limit')) || 100) as T
  }
  if (u.pathname === '/api/tickets' && method === 'POST') {
    const c = load().find((x) => x.phone === b.phone)
    if (!c) throw new MetaError(404, 'Not found', 'No chat with this number yet.')
    if (list.some((t) => t.phone === c.phone && t.status !== 'resolved')) throw new MetaError(409, 'Already exists', 'This chat already has an open ticket.')
    const t = ensureTicket(c, 'manual', (b.priority as Priority) ?? 'normal')
    if (b.subject) t.subject = String(b.subject)
    return withSla(t) as T
  }
  if (u.pathname === '/api/tickets/bulk') {
    const failed: { number: number; reason: string }[] = []
    const numbers = (b.numbers as number[]) ?? []
    for (const n of numbers) {
      const t = list.find((x) => x.number === n)
      if (!t) failed.push({ number: n, reason: `Ticket #${n} doesn’t exist.` })
      else if (b.action === 'resolve' && t.status === 'resolved') failed.push({ number: n, reason: `Ticket #${n} is already resolved.` })
      else if (b.action === 'resolve') Object.assign(t, { status: 'resolved', resolvedAt: nowIso(), pausedAt: null, resolution: String(b.resolution ?? '') || null })
      else Object.assign(t, b.patch, { updatedAt: nowIso() })
    }
    return { done: numbers.length - failed.length, failed } as T
  }
  const tm = u.pathname.match(/^\/api\/tickets\/(\d+)(\/resolve)?$/)
  if (tm) {
    const t = list.find((x) => x.number === Number(tm[1]))
    if (!t) throw new MetaError(404, 'Not found', `Ticket #${tm[1]} doesn’t exist.`)
    if (tm[2]) {
      if (t.status === 'resolved') throw new MetaError(409, 'Already exists', `Ticket #${t.number} is already resolved.`)
      Object.assign(t, { status: 'resolved', resolvedAt: nowIso(), pausedAt: null, resolution: String(b.resolution ?? '') || null })
      const c = load().find((x) => x.phone === t.phone)
      if (c) {
        push(c, { direction: 'out', author: 'system', kind: 'event', body: `You resolved ticket #${t.number}.` })
        if (b.askFeedback !== false && settings.csat.enabled && windowOpen(c)) push(c, { direction: 'out', author: 'system', kind: 'interactive', body: `${settings.csat.question} [Good · Okay · Bad]` })
        if (b.handBack !== false && !isBsuid(c.phone)) c.owner = 'ai'
      }
    } else if (method === 'PATCH') {
      const { status, ...rest } = b
      if (status && status !== t.status) {
        if (t.status === 'resolved') {
          const other = list.find((x) => x.phone === t.phone && x.status !== 'resolved')
          if (other) throw new MetaError(409, 'Already exists', `This chat already has an open ticket (#${other.number}). Continue there.`)
          reopen(t, status as 'open' | 'pending')
        } else if (status === 'pending') Object.assign(t, { status: 'pending', pausedAt: nowIso() })
        else resume(t)
      }
      if (typeof rest.subject === 'string' && !rest.subject.trim()) throw new MetaError(400, 'Check the details', 'Give the ticket a subject.')
      Object.assign(t, rest, { updatedAt: nowIso() })
      const c = load().find((x) => x.phone === t.phone)
      if (c && 'assigneeId' in b) c.assigneeId = (b.assigneeId as string | null) ?? null
    }
    return withSla(t) as T
  }
  if (u.pathname === '/api/support/settings/recompute') {
    needManage()
    const open = list.filter((t) => t.status !== 'resolved')
    // Demo deadlines are always worked out from the current targets; nothing to move.
    return { updated: open.length } as T
  }
  if (u.pathname === '/api/support/settings') {
    if (method === 'PUT') {
      needManage()
      checkUnmodified(headers, settingsStamp)
      const { confirmNoHours, ...patch } = b as Partial<SupportSettings> & { confirmNoHours?: boolean }
      // Partial, as on the server: keys left out keep their saved values.
      const KEYS = ['hours', 'twentyFourSeven', 'awayMessage', 'sla', 'routing', 'csat', 'restrictAgents']
      const next = { ...settings, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && KEYS.includes(k))) } as SupportSettings
      const problem = supportSettingsError(next, !!confirmNoHours)
      if (problem) throw new MetaError(400, 'Check the details', problem)
      settings = { ...next, aiSummary: false, saved: true }
      settingsStamp = stampNow()
    }
    return { ...settings, ...settingsStamp, openTickets: list.filter((t) => t.status !== 'resolved').length } as T
  }
  if (u.pathname.startsWith('/api/support/notifications/')) {
    demoReminders = demoReminders.map((r) => (u.pathname.includes(`reminder:${r.id}/`) ? { ...r, dismissed: true } : r))
    return { ok: true } as T
  }
  const ops = dummySupportOps(method, u.pathname, b, list, headers)
  if (ops !== undefined) return ops as T
  if (u.pathname === '/api/support/notifications')
    return [
      ...list
        .filter((t) => t.status !== 'resolved' && t.escalations?.some((e) => e.notify.includes(ME.id)))
        .map((t) => {
          const e = t.escalations!.filter((x) => x.notify.includes(ME.id)).at(-1)!
          return { id: `esc:${t.number}:${e.level}`, kind: 'escalated', text: `#${t.number} ${t.name ?? t.phone} escalated to level ${e.level}: ${e.reason.toLowerCase()}`, at: e.at, number: t.number, phone: t.phone }
        }),
      ...demoReminders
      .filter((r) => !r.dismissed && Date.parse(r.dueAt) <= Date.now())
      .map((r) => ({ id: `reminder:${r.id}`, kind: 'reminder', text: `${r.note} · ${load().find((c) => c.phone === r.phone)?.name || r.phone}`, at: r.dueAt, phone: r.phone })),
    ] as T
  throw new MetaError(404, 'Not found', path)
}

function dummySupportOps(method: string, path: string, b: Record<string, unknown>, list: Ticket[], headers?: Record<string, string>): unknown {
  const bad = (err: unknown): never => {
    throw new MetaError(400, 'Check the details', err instanceof Error ? err.message : String(err))
  }
  const members = new Set(demoMemberList().map((m) => m.userId))
  if (path === '/api/support/teams' && method === 'GET') return demoTeams
  if (path === '/api/support/teams' && method === 'POST') {
    let t: Omit<Team, 'id'>
    try {
      t = parseTeam(b, members)
    } catch (err) {
      return bad(err)
    }
    const team = { id: `team-${Date.now()}`, ...t }
    demoTeams = [...demoTeams, team]
    return team
  }
  const tm = path.match(/^\/api\/support\/teams\/([^/]+)$/)
  if (tm) {
    if (method === 'DELETE') {
      const used = demoRules.find((r) => r.then.some((a) => a.do === 'assignTeam' && a.teamId === tm[1]))
      if (used) throw new MetaError(409, 'Already exists', `The rule “${used.name}” sends tickets to this team. Change the rule first.`)
      demoTeams = demoTeams.filter((t) => t.id !== tm[1])
      return { ok: true }
    }
    let t: Omit<Team, 'id'>
    try {
      t = parseTeam(b, members)
    } catch (err) {
      return bad(err)
    }
    demoTeams = demoTeams.map((x) => (x.id === tm[1] ? { id: x.id, ...t } : x))
    return { id: tm[1], ...t }
  }
  if (path === '/api/support/agents' && method === 'GET')
    return demoMemberList().map(
      (m): AgentRow => ({
        userId: m.userId,
        name: m.name,
        ...profileOf(m.userId),
        open: list.filter((t) => t.status !== 'resolved' && t.assigneeId === m.userId).length,
        teamIds: demoTeams.filter((t) => t.memberIds.includes(m.userId)).map((t) => t.id),
      }),
    )
  const am = path.match(/^\/api\/support\/agents\/([^/]+)$/)
  if (am) {
    const cur = profileOf(am[1])
    demoProfiles.set(am[1], {
      skills: Array.isArray(b.skills) ? b.skills.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : cur.skills,
      maxOpen: b.maxOpen === undefined ? cur.maxOpen : b.maxOpen === null || b.maxOpen === '' ? null : Number(b.maxOpen),
      availability: (b.availability as AgentProfile['availability']) ?? cur.availability,
    })
    return { ok: true }
  }
  if (path === '/api/support/rules') {
    const teams = new Set(demoTeams.map((t) => t.id))
    if (method === 'PUT') {
      needManage()
      checkUnmodified(headers, rulesStamp)
      const raw = Array.isArray(b) ? (b as Rule[]) : []
      try {
        if (raw.length > 50) throw new Error('Keep it to 50 rules or fewer.')
        // A rule pointing at a removed member or team is kept as it was, marked inactive (it never matches).
        demoRules = raw.map((r) => (staleReason(r, teams, members) ? r : parseRules([r], { teams, members })[0]))
      } catch (err) {
        return bad(err)
      }
      rulesStamp = stampNow()
    }
    return { rules: demoRules.map((r) => withInactive(r, teams, members)), ...rulesStamp }
  }
  if (path === '/api/support/escalation') {
    if (method === 'PUT') {
      needManage()
      checkUnmodified(headers, matrixStamp)
      try {
        demoMatrix = withLevelIds(parseMatrix(b, new Set(demoTeams.map((t) => t.id))), b)
      } catch (err) {
        return bad(err)
      }
      matrixStamp = stampNow()
    }
    demoMatrix = withLevelIds(demoMatrix, demoMatrix)
    return { ...demoMatrix, ...matrixStamp }
  }
  // Demo controls: the oldest open ticket moves up one level, as if its clock ran out.
  if (path === '/api/support/demo/escalate') {
    const t = [...list].reverse().find((x) => x.status !== 'resolved' && (demoMatrix.levels[x.priority][(x.escalationLevel ?? 0)] ?? null))
    if (!t) throw new MetaError(404, 'Not found', 'No open ticket has a further escalation level. Add levels in Settings › Escalation, or open a ticket from the Inbox.')
    const next = (t.escalationLevel ?? 0) + 1
    const level = demoMatrix.levels[t.priority][next - 1]
    if (level.raisePriority) t.priority = raise(t.priority)
    if (level.reassignTeamId) t.teamId = level.reassignTeamId
    const notify = [ME.id] // the demo person sees every escalation
    t.escalationLevel = next
    t.escalations = [...(t.escalations ?? []), { level: next, at: new Date().toISOString(), reason: describeLevel(level), notify }]
    const c = load().find((x) => x.phone === t.phone)
    if (c) push(c, { direction: 'out', author: 'system', kind: 'event', body: `Ticket #${t.number} escalated to level ${next}: ${describeLevel(level).toLowerCase()}.` })
    return { number: t.number, level: next }
  }
  return undefined
}

// ---- contacts (dummy) ----
let extraContacts: Contact[] = []
let removed = new Set<string>()
let fieldDefsDemo: FieldDef[] = [{ key: 'city', label: 'City', type: 'text' }]
let segmentsDemo: Segment[] = []
const edits = new Map<string, Partial<Contact>>()
let fieldsStamp: { updatedAt: string | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null }
/** The server's rules for field definitions (server/support/contacts.ts): 30 at most, 60-character names, unique keys. */
function parseFieldDefs(raw: unknown): FieldDef[] {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > 30) throw new MetaError(400, 'Check the details', 'Keep it to 30 fields or fewer.')
  const seen = new Set<string>()
  return list.map((x: Partial<FieldDef> & { options?: unknown }) => {
    const label = String(x.label ?? '').trim()
    if (!label) throw new MetaError(400, 'Check the details', 'Every field needs a name.')
    if (label.length > 60) throw new MetaError(400, 'Check the details', `Keep “${label.slice(0, 20)}…” to 60 characters.`)
    const key = String(x.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `field_${seen.size + 1}`
    if (seen.has(key)) throw new MetaError(400, 'Check the details', `Two fields would both be called “${label}”.`)
    seen.add(key)
    const type = (['number', 'date', 'select'] as const).find((t) => t === x.type) ?? 'text'
    const options = type === 'select' ? (Array.isArray(x.options) ? x.options : String(x.options ?? '').split(',')).map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : undefined
    if (type === 'select' && !options?.length) throw new MetaError(400, 'Check the details', `Add the choices for ${label}, separated by commas.`)
    return { key, label, type, ...(options && { options }) }
  })
}
/** Whether a stored value still fits its field's type. */
const fits = (f: FieldDef, v: string) =>
  f.type === 'number' ? v.trim() !== '' && !Number.isNaN(Number(v)) : f.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(v) : f.type === 'select' ? (f.options ?? []).includes(v) : true
function contactsNow(): Contact[] {
  const fromChats = load().map((c): Contact => ({ phone: c.phone, name: c.name, email: null, tags: c.tags, fields: {}, source: 'sample', createdAt: c.messages[0]?.at ?? new Date().toISOString(), lastSeenAt: lastInbound(c) ?? undefined }))
  return [...extraContacts, ...fromChats].filter((c) => !removed.has(c.phone)).map((c) => ({ ...c, ...edits.get(c.phone) }))
}
const matches = (c: Contact, f: { tags?: string[] }) => (f.tags ?? []).every((t) => c.tags.includes(t))

export async function dummyContacts<T>(method: string, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  const p = (k: string) => u.searchParams.get(k) ?? ''
  if (u.pathname === '/api/contacts' && method === 'GET') {
    const seg = segmentsDemo.find((x) => x.id === p('segment'))
    const q = p('q').toLowerCase()
    return contactsNow()
      .filter((c) => matches(c, { tags: [...(seg?.filter.tags ?? []), ...(p('tag') ? [p('tag')] : [])] }))
      .filter((c) => !q || `${c.name ?? ''} ${c.phone} ${c.email ?? ''}`.toLowerCase().includes(q)) as T
  }
  if (u.pathname === '/api/contacts' && method === 'POST') {
    const phone = String(b.phone ?? '').replace(/\D/g, '')
    if (!/^\d{8,15}$/.test(phone)) throw new MetaError(400, 'Check the details', 'That isn’t a phone number with a country code (8 to 15 digits).')
    if (contactsNow().some((c) => c.phone === phone)) throw new MetaError(409, 'Already exists', `+${phone} is already a contact.`)
    const c: Contact = { phone, name: (b.name as string) || null, email: (b.email as string) || null, tags: (b.tags as string[]) ?? [], fields: (b.fields as Record<string, string>) ?? {}, source: 'manual', createdAt: new Date().toISOString() }
    extraContacts = [c, ...extraContacts]
    removed.delete(phone)
    return c as T
  }
  if (u.pathname === '/api/contacts/import') {
    let added = 0
    for (const r of (b.rows as { phone: string; name?: string }[]) ?? []) {
      const phone = String(r.phone).replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(phone) || contactsNow().some((c) => c.phone === phone)) continue
      extraContacts.push({ phone, name: r.name ?? null, email: null, tags: [], fields: {}, source: 'import', createdAt: new Date().toISOString() })
      added++
    }
    return { added, updated: 0, skipped: [], skippedCount: 0 } as T
  }
  if (u.pathname === '/api/contacts/tags') {
    const counts = new Map<string, number>()
    for (const c of contactsNow()) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })) as T
  }
  if (u.pathname === '/api/contacts/fields/usage') {
    const key = p('key')
    return { contacts: contactsNow().filter((c) => (c.fields[key] ?? '') !== '').length, segments: segmentsDemo.filter((x) => x.filter.field?.key === key).map((x) => ({ id: x.id, name: x.name })) } as T
  }
  if (u.pathname === '/api/contacts/fields') {
    if (method === 'PUT') {
      needManage()
      checkUnmodified(headers, fieldsStamp)
      const next = parseFieldDefs(b.fields)
      // Removed fields leave every contact and every segment filter; a new type clears values that don't fit.
      const kept = new Map(next.map((f) => [f.key, f]))
      for (const c of contactsNow()) {
        const fields = Object.fromEntries(Object.entries(c.fields).filter(([k, v]) => kept.has(k) && fits(kept.get(k)!, v)))
        if (Object.keys(fields).length !== Object.keys(c.fields).length) edits.set(c.phone, { ...edits.get(c.phone), fields })
      }
      // A segment left with no other filter is deleted rather than widened to every contact (as the server does).
      const lost = (x: Segment) => !!x.filter.field && !kept.has(x.filter.field.key)
      segmentsDemo = segmentsDemo.filter((x) => !lost(x) || x.filter.tags?.length || x.filter.activeDays).map((x) => (lost(x) ? { ...x, filter: { ...x.filter, field: null } } : x))
      fieldDefsDemo = next
      fieldsStamp = stampNow()
    }
    return { fields: fieldDefsDemo, ...fieldsStamp } as T
  }
  if (u.pathname === '/api/contacts/segments') {
    const withCount = (x: Segment) => ({ ...x, count: contactsNow().filter((c) => matches(c, x.filter)).length })
    if (method !== 'POST') return segmentsDemo.map(withCount) as T
    const created: Segment = { id: `s${++seq}`, name: String(b.name), filter: b.filter as Segment['filter'], count: 0 }
    segmentsDemo = [...segmentsDemo, created]
    return withCount(created) as T
  }
  const sm = u.pathname.match(/^\/api\/contacts\/segments\/(.+)$/)
  if (sm) {
    segmentsDemo = segmentsDemo.filter((s) => s.id !== sm[1])
    return { ok: true } as T
  }
  const cm = u.pathname.match(/^\/api\/contacts\/(\d+)$/)
  if (cm) {
    if (method === 'DELETE') {
      removed = new Set([...removed, cm[1]])
      return { ok: true } as T
    }
    edits.set(cm[1], { ...edits.get(cm[1]), ...(b as Partial<Contact>) })
    return contactsNow().find((c) => c.phone === cm[1]) as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- templates (dummy) ----
const demoTemplates: WaTemplate[] = [
  { id: 't1', name: 'diwali_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'TEXT', text: 'Festive offer' }, { type: 'BODY', text: 'Hi {{1}}, get 20% off Helo Messaging this Diwali. Offer ends {{2}}.' }, { type: 'FOOTER', text: 'Reply STOP to opt out' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Tell me more' }] }] },
  { id: 't2', name: 'order_update', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}, your order is confirmed and goes live tomorrow.' }] },
  { id: 't3', name: 'webinar_invite', language: 'en', status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Join our WhatsApp AI webinar this Friday.' }] },
]

export async function dummyTemplates<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  if (u.pathname === '/api/templates') {
    if (method === 'POST') {
      demoTemplates.push({ id: `t${++seq}`, name: String(b.name), language: String(b.language || 'en'), status: 'PENDING', category: String(b.category), components: [{ type: 'BODY', text: String(b.body) }] })
      return { id: `t${seq}`, status: 'PENDING' } as T
    }
    return demoTemplates as T
  }
  if (u.pathname === '/api/templates/send-one') {
    const c = load().find((x) => x.phone === b.phone)
    if (c) {
      push(c, { direction: 'out', author: 'agent', authorName: ME.name, kind: 'template', body: renderTemplate(b.template as WaTemplate, b.values as Record<string, string>), status: 'sent' })
      c.owner = 'human'
    }
    return { ok: true } as T
  }
  const del = u.pathname.match(/^\/api\/templates\/([a-z0-9_]+)$/)
  if (del && method === 'DELETE') {
    const i = demoTemplates.findIndex((t) => t.name === del[1])
    if (i >= 0) demoTemplates.splice(i, 1)
    return { ok: true } as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- WhatsApp accounts (dummy) ----
const dummyAccountNow = (): WaAccount => ({
  wabaId: '990000000000001',
  wabaName: 'Helo Demo Store',
  businessId: '990000000000003',
  phoneNumbers: [{ id: '990000000000002', display: '+91 98765 43210', verifiedName: 'Helo Demo Store' }],
  source: 'env',
  billing: { mode: 'partner_credit', state: 'shared' },
  steps: {},
  hasPin: false,
  canDisconnect: false,
  needsAttention: false,
  createdAt: new Date().toISOString(),
})
let waAccounts: WaAccount[] | null = null
/** Demo control: show Home as a brand-new workspace (no WhatsApp yet, no chats), or back to the sample one. */
export function resetDummyWhatsApp(connected: boolean) {
  waAccounts = connected ? [dummyAccountNow()] : []
  chats = connected ? null : []
}

export async function dummyWhatsApp<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, string>
  waAccounts ??= [dummyAccountNow()]
  const u = new URL(path, 'http://x')
  if (u.pathname === '/api/whatsapp/webhook-status' || u.pathname === '/api/whatsapp/webhook-status/baseline') {
    const apps = [
      { id: '1143680903703001', name: 'Business Agent' },
      { id: '1175759883130788', name: 'onCloud' },
      { id: '696810982412286', name: 'onCloudWABA' },
      { id: '1828077015051809', name: 'ai-business-agent' },
    ]
    return {
      lastAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      lastTestAt: null,
      callbackUrl: `${location.origin}/api/webhooks/whatsapp`,
      verifyTokenSet: true,
      signatureChecked: true,
      appsAccepted: 1,
      listenerAppId: '1828077015051809',
      last24h: [
        { field: 'messages', count: 42 },
        { field: 'message_echoes', count: 9 },
        { field: 'phone_number_quality_update', count: 1 },
      ],
      pending: 0,
      failed: 0,
      unknownNumbers: 0,
      subscribedApps: apps,
      baseline: { apps: apps.slice(0, 3), at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    } as T
  }
  if (u.pathname === '/api/whatsapp/health')
    return waAccounts.flatMap((a) =>
      a.phoneNumbers.map((n) => ({ phoneNumberId: n.id, display: n.display, name: n.verifiedName, quality: 'GREEN', nameStatus: 'APPROVED', status: 'CONNECTED', limit: 'TIER_2K', limitLabel: '2,000', checkedAt: new Date().toISOString() })),
    ) as T
  const owner = can(demoRoleNow() as Role, 'whatsapp.manage')
  if (u.pathname === '/api/whatsapp/config') return { mode: 'sdk', partnerCredit: true, connected: waAccounts.length > 0, ...(owner && { appId: 'demo', configId: 'demo', sdkVersion: 'v23.0' }) } as T
  // Owners only, as on the server: others read numbers from /api/whatsapp/numbers.
  if (u.pathname.startsWith('/api/whatsapp/accounts') && !owner) throw new MetaError(403, 'Not allowed', 'Only workspace owners can see WhatsApp accounts.')
  if (u.pathname === '/api/whatsapp/accounts' && method === 'GET') return waAccounts as T
  if (u.pathname === '/api/whatsapp/connect') {
    const now = new Date().toISOString()
    const done = { state: 'done' as const, at: now }
    const coexist = b.flow === 'coexistence'
    const own = b.billing === 'own'
    // A brand-new demo workspace gets the demo number itself, so the agent studio, Assets and Home agree.
    const first = waAccounts.length === 0 ? dummyAccountNow() : null
    const account: WaAccount = {
      wabaId: first?.wabaId ?? b.wabaId,
      wabaName: first?.wabaName ?? 'Asha Foods',
      businessId: first?.businessId ?? b.businessId,
      phoneNumbers: first?.phoneNumbers ?? [{ id: b.phoneNumberId, display: coexist ? '+91 99887 76655' : '+91 90000 12345', verifiedName: 'Asha Foods' }],
      source: coexist ? 'coexistence' : 'signup',
      billing: { mode: own ? 'own' : 'partner_credit', state: own ? 'pending' : 'shared' },
      steps: {
        exchange: done,
        subscribe: done,
        register: coexist ? { state: 'skipped', at: now } : done,
        sync: coexist ? done : { state: 'skipped', at: now },
        details: done,
        billing: own ? { state: 'waiting', at: now, error: 'Add a payment method in WhatsApp Manager, then confirm here.' } : done,
      },
      primaryNumberId: first?.phoneNumbers[0].id ?? b.phoneNumberId,
      hasPin: !coexist,
      canDisconnect: true,
      needsAttention: false,
      createdAt: now,
    }
    waAccounts = [...waAccounts.filter((a) => a.wabaId !== account.wabaId), account]
    return { account, ...(!coexist && { pin: '482913' }) } as T
  }
  const m = u.pathname.match(/^\/api\/whatsapp\/accounts\/(\d+)(?:\/([a-z]+))?$/)
  const acc = m && waAccounts.find((a) => a.wabaId === m[1])
  if (!m || !acc) throw new MetaError(404, 'Not found', 'That WhatsApp account isn’t connected to this workspace.')
  if (!m[2] && method === 'DELETE') {
    waAccounts = waAccounts.filter((a) => a !== acc)
    return { ok: true } as T
  }
  if (m[2] === 'billing') {
    const confirmed = (body as { confirmed?: boolean }).confirmed === true || b.mode === 'partner_credit'
    Object.assign(acc, { billing: { mode: b.mode, state: b.mode === 'partner_credit' ? 'shared' : confirmed ? 'confirmed' : 'pending' }, needsAttention: false })
    acc.steps.billing = confirmed ? { state: 'done', at: new Date().toISOString() } : acc.steps.billing
    return acc as T
  }
  if (m[2] === 'pin') return { pin: '482913' } as T
  return acc as T
}

// ---- billing (dummy): a month of made-up spend in rupees ----
let demoBudget: number | null = 5000
let budgetStamp: { updatedAt: string | null; updatedBy: string | null } = { updatedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(), updatedBy: 'Demo User' }
export async function dummyBilling<T>(method: string, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const role = demoRoleNow() as Role
  if (!can(role, 'billing.view')) throw new MetaError(403, 'Not allowed', 'Only owners and admins see billing.')
  if (method !== 'GET' && !can(role, 'billing.manage')) throw new MetaError(403, 'Not allowed', 'Only owners can change the budget or update the figures.')
  if (method === 'PUT') {
    checkUnmodified(headers, budgetStamp)
    const v = ((body ?? {}) as { budget?: unknown }).budget
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9)) throw new MetaError(400, 'Check the details', 'Enter the budget as a number up to 1,000,000,000, or leave it empty for none.')
    demoBudget = v === 0 ? null : (v as number | null)
    budgetStamp = stampNow()
  }
  const today = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getTime() - (29 - i) * 86_400_000)
    const volume = 40 + ((i * 37) % 90)
    return { day: d.toISOString().slice(0, 10), volume, cost: Math.round(volume * 0.62 * 100) / 100 }
  })
  const thisMonth = days.filter((d) => d.day.startsWith(today.toISOString().slice(0, 7)))
  const total = thisMonth.reduce((n, d) => n + d.cost, 0)
  void path
  return {
    currency: 'INR',
    budget: demoBudget,
    ...budgetStamp,
    timezone: settings.hours.timezone,
    lastSyncAt: new Date(today.getTime() - 2 * 3_600_000).toISOString(),
    lastSyncError: null,
    month: { total, byCategory: [{ category: 'MARKETING', cost: total * 0.78, volume: 0 }, { category: 'UTILITY', cost: total * 0.17, volume: 0 }, { category: 'AUTHENTICATION', cost: total * 0.05, volume: 0 }] },
    days,
    ai: { console: [{ feature: 'chat_summary', model: 'claude-haiku-4-5-20251001', input: 48210, output: 6920, calls: 61 }], agentConversations: 1180 },
  } as T
}

// ---- WhatsApp numbers (dummy): one live number and one waiting for its ownership check ----
interface DemoNumber {
  n: WaNumber
  detail: Omit<NumberDetail, 'number' | 'activity'>
  activity: NumberDetail['activity']
  pin: string | null
  blocked: string[]
  nameAsked?: number
}
let demoNumbers: DemoNumber[] | null = null
const demoNumberList = (): DemoNumber[] =>
  (demoNumbers ??= [
    {
      n: { id: '990000000000002', wabaId: '990000000000001', wabaName: 'Helo Demo Store', display: '+91 98765 43210', verifiedName: 'Helo Demo Store', status: 'CONNECTED', codeVerification: 'VERIFIED', quality: 'GREEN', nameStatus: 'APPROVED', newName: null, newNameStatus: 'NONE', platform: 'CLOUD_API', throughput: 'STANDARD', photo: null, limit: 'TIER_2K', pinKnown: true, syncedAt: new Date().toISOString() },
      detail: {
        profile: { about: 'Fresh groceries delivered in 30 minutes', address: '12 MG Road, Bengaluru', description: 'Order groceries on WhatsApp. Our AI assistant answers 24/7.', email: 'hello@helodemo.store', websites: ['https://helodemo.store'], vertical: 'GROCERY', photo: null },
        automation: { prompts: ['Track my order', 'Today’s offers'], commands: [{ name: 'orders', description: 'See your recent orders' }] },
        official: false,
        pinStorage: true,
      },
      activity: [],
      pin: '482913',
      blocked: [],
    },
    {
      n: { id: '990000000000004', wabaId: '990000000000001', wabaName: 'Helo Demo Store', display: '+91 98765 43211', verifiedName: 'Helo Demo Support', status: 'PENDING', codeVerification: 'NOT_VERIFIED', quality: 'UNKNOWN', nameStatus: 'PENDING_REVIEW', newName: null, newNameStatus: 'NONE', platform: 'NOT_APPLICABLE', throughput: null, photo: null, limit: null, pinKnown: false, syncedAt: new Date().toISOString() },
      detail: {
        profile: { about: '', address: '', description: '', email: '', websites: [], vertical: 'OTHER', photo: null },
        automation: { prompts: [], commands: [] },
        official: false,
        pinStorage: true,
      },
      activity: [],
      pin: null,
      blocked: [],
    },
  ])

export async function dummyNumbers<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const list = demoNumberList()
  // A display name in review is approved 30 seconds after it was asked for.
  for (const x of list)
    if (x.nameAsked && Date.now() - x.nameAsked > 30_000) {
      Object.assign(x.n, { verifiedName: x.n.newName, nameStatus: 'APPROVED', newName: null, newNameStatus: 'APPROVED' })
      x.nameAsked = undefined
      x.activity.unshift({ kind: 'name_reviewed', data: { decision: 'APPROVED' }, at: new Date().toISOString(), by: 'WhatsApp' })
    }
  const u = new URL(path, 'http://x')
  // As on the server: only the numbers of the workspace's connected accounts.
  if (u.pathname === '/api/whatsapp/numbers') return list.filter((x) => (waAccounts ?? [dummyAccountNow()]).some((a) => a.wabaId === x.n.wabaId)).map((x) => x.n) as T
  const m = u.pathname.match(/^\/api\/whatsapp\/numbers\/(\d+)(?:\/([a-z-]+))?(?:\/([^/]+))?$/)
  const x = m && list.find((y) => y.n.id === m[1])
  if (!m || !x) throw new MetaError(404, 'Not found', 'That number isn’t connected to this workspace.')
  const [, , action = '', arg] = m
  const out = () => ({ number: { ...x.n, pinKnown: !!x.pin }, ...x.detail, activity: x.activity }) as T
  const log = (kind: string, data: Record<string, unknown> = {}) => x.activity.unshift({ kind, data, at: new Date().toISOString(), by: 'Demo User' })
  const bad = (detail: string) => new MetaError(400, 'Check the details', detail)
  if (!action) return out()
  if (action === 'pin' && method === 'GET') {
    if (!x.pin) throw new MetaError(404, 'Not found', 'We don’t have this number’s PIN. Set a new one below.')
    return { pin: x.pin } as T
  }
  if (action === 'blocked' && method === 'GET') return x.blocked.map((user) => ({ user })) as T
  if (action === 'blocked' && method === 'DELETE') {
    x.blocked = x.blocked.filter((p) => p !== decodeURIComponent(arg ?? ''))
    log('unblocked')
    return { ok: true } as T
  }
  if (action === 'blocked' && method === 'POST') {
    const user = String(b.user ?? '').replace(/\D/g, '')
    const chat = load().find((c) => c.phone === user)
    if (!chat || !windowOpen(chat)) throw bad('WhatsApp only lets you block someone who messaged this number in the last 24 hours.')
    if (!x.blocked.includes(user)) x.blocked.push(user)
    log('blocked')
    return { ok: true } as T
  }
  if (action === 'profile') {
    const p = b as unknown as Profile
    const errors = profileErrors(p)
    if (Object.keys(errors).length) throw bad(Object.values(errors)[0]!)
    x.detail.profile = { ...p, photo: x.detail.profile.photo }
    log('profile_updated')
  }
  if (action === 'photo') {
    const f = b.file as File
    if (!['image/jpeg', 'image/png'].includes(f.type)) throw bad('Use a JPG or PNG image.')
    if (f.size > 5 * 1024 * 1024) throw new MetaError(413, 'Too big', 'Profile photos can be 5 MB at most.')
    x.detail.profile.photo = x.n.photo = URL.createObjectURL(f)
    log('photo_updated')
  }
  if (action === 'display-name') {
    const problem = displayNameError(String(b.name ?? ''))
    if (problem) throw bad(problem)
    Object.assign(x.n, { newName: String(b.name).trim(), newNameStatus: 'PENDING_REVIEW' })
    x.nameAsked = Date.now()
    log('name_requested', { name: x.n.newName })
  }
  if (action === 'automation') {
    const a = b as unknown as Automation
    const problem = automationErrors(a)
    if (problem) throw bad(problem)
    x.detail.automation = { prompts: a.prompts.filter((p) => p.trim()), commands: a.commands.filter((c) => c.name.trim()) }
    log('automation_updated')
  }
  if (action === 'pin') {
    if (!/^\d{6}$/.test(String(b.pin ?? ''))) throw bad('The PIN is 6 digits.')
    x.pin = String(b.pin)
    log('pin_changed')
  }
  if (action === 'register') {
    const pin = b.pin ? String(b.pin) : x.pin
    if (!pin) throw bad('Enter the number’s 6-digit PIN to register it.')
    if (x.n.status === 'PENDING') throw bad('Verify you own this number first.')
    x.pin = pin
    Object.assign(x.n, { status: 'CONNECTED', newNameStatus: 'NONE' })
    log('registered')
  }
  if (action === 'deregister') {
    if (String(b.confirm ?? '').replace(/\D/g, '') !== x.n.display.replace(/\D/g, '')) throw bad('Type the number exactly to confirm.')
    x.n.status = 'DISCONNECTED'
    log('deregistered')
  }
  if (action === 'request-code') {
    log('code_requested', { method: b.method })
    return { ok: true } as T
  }
  if (action === 'verify-code') {
    if (String(b.code ?? '') !== '123456') throw bad('That code isn’t right. In the demo, the code is 123456.')
    Object.assign(x.n, { codeVerification: 'VERIFIED', status: 'DISCONNECTED' })
    log('verified')
  }
  return out()
}
