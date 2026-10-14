// Tickets: one issue inside a customer's chat. A chat gets an open ticket the moment it moves to
// people (AI handoff, someone takes over, or a person replies). SLA clocks run on business hours;
// routing picks the assignee; resolving can ask for feedback (CSAT) and hand the chat back to the AI.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, obj, readJson, serveJson } from '../platform/http.ts'
import { col, db, dbOffReason, ws } from '../platform/db.ts'
import { env } from '../whatsapp/index.ts'
import { currentAssets } from '../platform/context.ts'
import { isProtected } from '../platform/protect.ts'
import { diff, trace } from '../platform/trace.ts'
import { customerLabel, isBsuid, parseCustomerKey } from '../../src/app/lib/customer.ts'
import { dismissAlert, openAlerts } from '../platform/alerts.ts'
import { dismissReminder, dueReminders } from '../messaging/index.ts'
import { addBusinessMinutes, DAYS, DEFAULT_HOURS, isOpen, type Hours } from './businessHours.ts'
import { contactNames } from './contacts.ts'
import { addMessage, conversations, currentNumber, sendInteractive, sendText, setControl, type Actor } from '../messaging/index.ts'
import { can, mayAssign } from '../../src/app/lib/permissions.ts'
import { getTeams, routeTicket, supportOpsRoute } from './supportOps.ts'
import { customerWrites, pausedFor, shiftDues } from '../../src/app/support/ticketRules.ts'
import type { TicketSource } from '../../src/app/support/routing.ts'

const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
type Priority = (typeof PRIORITIES)[number]
const STATUSES = ['open', 'pending', 'resolved'] as const
const CSAT = [
  { id: 'csat_3', title: 'Good', score: 3 },
  { id: 'csat_2', title: 'Okay', score: 2 },
  { id: 'csat_1', title: 'Bad', score: 1 },
]

interface SupportSettings {
  hours: Hours
  /** Sent when a customer writes to the team outside business hours; '' = off. */
  awayMessage: string
  /** Minutes of business time per priority. */
  sla: Record<Priority, { firstResponse: number; resolve: number }>
  /** The default when no routing rule matches (supportOps.ts). */
  routing: { mode: 'unassigned' | 'round_robin' | 'fixed'; teamId: string | null; userId: string | null }
  /** Before teams had their own collection; read once by getTeams to move them over. */
  teams: { id: string; name: string; memberIds: string[] }[]
  csat: { enabled: boolean; question: string }
  /** Agents see only chats and tickets assigned to them, plus unassigned ones (supervisors and up see all). */
  restrictAgents: boolean
}
const DEFAULT_SETTINGS: SupportSettings = {
  hours: DEFAULT_HOURS,
  awayMessage: 'Thanks for your message. Our team is offline right now and will reply when we’re back. You can keep chatting with our AI assistant meanwhile.',
  sla: { urgent: { firstResponse: 15, resolve: 240 }, high: { firstResponse: 30, resolve: 480 }, normal: { firstResponse: 60, resolve: 1440 }, low: { firstResponse: 240, resolve: 2880 } },
  routing: { mode: 'round_robin', teamId: null, userId: null },
  teams: [],
  csat: { enabled: true, question: 'How did we do today?' },
  restrictAgents: false,
}

const tickets = () => col('tickets')
const settingsCol = () => col('support_settings')

export async function getSettings(): Promise<SupportSettings> {
  const s = await settingsCol().findOne({ workspaceId: ws() })
  return { ...DEFAULT_SETTINGS, ...(s?.settings as Partial<SupportSettings> | undefined) }
}

/** For a restricted agent: only their own work and work nobody has yet. null = everything. */
export async function scopeFor(me: Actor): Promise<Obj | null> {
  if (can(me.role, 'chats.all') || !(await getSettings()).restrictAgents) return null
  return { assigneeId: { $in: [me._id, null] } }
}
/** Refuses a chat or ticket that belongs to someone else, for a restricted agent. */
export async function needInScope(me: Actor, assigneeId: unknown) {
  if (assigneeId && assigneeId !== me._id && (await scopeFor(me))) throw new HttpError(403, 'This chat is assigned to someone else.')
}
/** Refuses moving work the person's role doesn't allow (src/app/lib/permissions.ts mayAssign). */
export function needCanAssign(me: Actor, to: string | null, from: unknown) {
  if (!mayAssign(me.role, me._id, to, from ? String(from) : null)) throw new HttpError(403, 'Only supervisors, admins and owners move work that belongs to someone else.')
}

// ---- validation of the settings form ----
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
function parseSettings(b: Obj, members: Set<string>, teamIds: Set<string>, legacyTeams: SupportSettings['teams']): SupportSettings {
  const h = obj(b.hours)
  const tz = String(h.timezone ?? '')
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
  } catch {
    throw new HttpError(400, `${tz || 'That'} isn’t a time zone we recognise.`)
  }
  const week = Object.fromEntries(
    DAYS.map((d) => {
      const w = obj(obj(h.week)[d])
      if (!w.open && !w.close) return [d, null]
      if (!HHMM.test(String(w.open)) || !HHMM.test(String(w.close)) || String(w.close) <= String(w.open)) throw new HttpError(400, `Check the hours for ${d}: closing must be after opening (HH:MM).`)
      return [d, { open: String(w.open), close: String(w.close) }]
    }),
  ) as Hours['week']
  const holidays = (Array.isArray(h.holidays) ? h.holidays : []).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const sla = Object.fromEntries(
    PRIORITIES.map((p) => {
      const v = obj(obj(b.sla)[p])
      const first = Number(v.firstResponse)
      const resolve = Number(v.resolve)
      if (!(first > 0 && resolve >= first && resolve <= 60 * 24 * 60)) throw new HttpError(400, `Check the ${p} targets: both above zero, and resolution at least as long as first response.`)
      return [p, { firstResponse: Math.round(first), resolve: Math.round(resolve) }]
    }),
  ) as SupportSettings['sla']
  const r = obj(b.routing)
  const mode = r.mode === 'fixed' || r.mode === 'unassigned' ? r.mode : 'round_robin'
  const routing = { mode, teamId: teamIds.has(String(r.teamId)) ? String(r.teamId) : null, userId: members.has(String(r.userId)) ? String(r.userId) : null } as SupportSettings['routing']
  if (mode === 'fixed' && !routing.userId) throw new HttpError(400, 'Pick who gets every new ticket.')
  const c = obj(b.csat)
  return {
    hours: { timezone: tz, week, holidays },
    awayMessage: String(b.awayMessage ?? '').trim().slice(0, 1000),
    sla,
    routing,
    teams: legacyTeams,
    csat: { enabled: c.enabled !== false, question: String(c.question ?? '').trim().slice(0, 200) || DEFAULT_SETTINGS.csat.question },
    restrictAgents: b.restrictAgents === true,
  }
}

// ---- lifecycle hooks (called by inbox.ts) ----
const OPEN = { $in: ['open', 'pending'] }
const ref = (number: unknown) => ({ entity: 'ticket', id: String(number) })
/** The last moment Date can hold: what addBusinessMinutes answers when no business hours are ever open. */
const NEVER = 8.64e15

/** Response deadlines for a priority: business time counted from when the clock started (the ticket
 *  opened or reopened), plus any time spent waiting on the customer. */
export function duesFrom(start: Date, priority: Priority, s: SupportSettings, pausedMs = 0) {
  const at = (minutes: number) => new Date(Math.min(NEVER, +addBusinessMinutes(start, minutes, s.hours) + pausedMs))
  return { firstResponseDueAt: at(s.sla[priority].firstResponse), resolveDueAt: at(s.sla[priority].resolve) }
}
const clockStart = (t: Obj) => (t.clockStartAt ?? t.createdAt) as Date

/** Gives the chat an open ticket if it has none. `source` says why it moved to people. */
export async function ensureTicket(phone: string, source: TicketSource, opts: { subject?: string; priority?: Priority; sample?: boolean } = {}) {
  const existing = await tickets().findOne({ workspaceId: ws(), phone, status: OPEN })
  if (existing) return existing
  const s = await getSettings()
  const now = new Date()
  const priority = opts.priority ?? 'normal'
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  const lastWords = await col('messages').findOne({ workspaceId: ws(), phone, author: 'customer', body: { $type: 'string' } }, { sort: { at: -1 } })
  // Someone already looking after the chat keeps it; otherwise the routing rules decide.
  const routed = await routeTicket({ phone, source, priority, explicitPriority: !!opts.priority, text: String(lastWords?.body ?? '') })
  const assigneeId = conv?.assigneeId ?? routed.assigneeId
  const n = await col('counters').findOneAndUpdate({ _id: `ticket:${ws()}` as never }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  const doc = {
    workspaceId: ws(),
    number: 1000 + Number(n?.seq ?? 1),
    phone,
    subject: (opts.subject || String(lastWords?.body ?? '') || `Chat with +${phone}`).slice(0, 120),
    status: 'open',
    priority: routed.priority,
    assigneeId,
    teamId: routed.teamId,
    tags: routed.tags,
    source,
    createdAt: now,
    updatedAt: now,
    clockStartAt: now,
    pausedAt: null,
    pausedMs: 0,
    ...duesFrom(now, routed.priority, s),
    escalationLevel: 0,
    phoneNumberId: (conv?.phoneNumberId as string | undefined) ?? currentNumber(),
    firstRespondedAt: null,
    resolvedAt: null,
    resolution: null,
    csat: null,
    ...((opts.sample ?? conv?.sample) && { sample: true }),
  }
  try {
    await tickets().insertOne(doc)
  } catch (err) {
    // Two events for one chat at the same moment (e.g. a handoff and a reply): the database keeps
    // one open ticket per chat, and the second caller gets the first one's ticket.
    if ((err as { code?: number }).code === 11000) {
      const other = await tickets().findOne({ workspaceId: ws(), phone, status: OPEN })
      if (other) return other
    }
    throw err
  }
  trace('ticket.created', { number: doc.number, source, priority: doc.priority, assigned: !!assigneeId, rule: routed.rule }, ref(doc.number))
  if (routed.rule) await addMessage({ phone, direction: 'out', author: 'system', kind: 'event', body: `Ticket #${doc.number} routed by the rule “${routed.rule}”.`, at: now })
  if (assigneeId && !conv?.assigneeId) await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { assigneeId } })
  return doc
}

export async function onAgentReply(phone: string) {
  await tickets().updateOne({ workspaceId: ws(), phone, status: OPEN, firstRespondedAt: null }, { $set: { firstRespondedAt: new Date(), updatedAt: new Date() } })
}

/** The business's own number (protect.ts): the console never messages its customers on its own,
 *  so no away message and no satisfaction question. People still reply when they choose to. */
const listenOnly = () => isProtected(currentAssets()?.wabaId)

/** Back from waiting on the customer: the clocks run again, later by the time they were paused. */
function resumeSet(t: Obj, now: Date): Obj {
  const waited = pausedFor(t.pausedAt as Date | null, +now)
  return { status: 'open', pausedAt: null, pausedMs: Number(t.pausedMs ?? 0) + waited, ...shiftDues(t as { firstResponseDueAt: Date; resolveDueAt: Date }, waited), updatedAt: now }
}

/** A resolved ticket open again: fresh deadlines from now, escalations start over, and it waits for a
 *  first reply again. The earlier rating stays in its history (the activity log). */
async function reopenSet(t: Obj, status: 'open' | 'pending', now: Date): Promise<Obj> {
  const other = await tickets().findOne({ workspaceId: ws(), phone: t.phone, status: OPEN, _id: { $ne: t._id as never } })
  // One open ticket per chat: a newer one (e.g. a later handoff) already carries the conversation.
  if (other) throw new HttpError(409, `This chat already has an open ticket (#${other.number}). Continue there.`)
  const s = await getSettings()
  return {
    status,
    resolvedAt: null,
    resolution: null,
    clockStartAt: now,
    pausedAt: status === 'pending' ? now : null,
    pausedMs: 0,
    ...duesFrom(now, t.priority as Priority, s),
    firstRespondedAt: null,
    escalationLevel: 0,
    csatRequestedAt: null,
    updatedAt: now,
  }
}

/** A customer wrote: take a rating answer, move their ticket (ticketRules.ts customerWrites), and send
 *  the away message if the team is off. */
export async function onCustomerMessage(phone: string, body: string, owner: 'ai' | 'human', sample: boolean) {
  const now = new Date()
  const choice = CSAT.find((c) => c.title.toLowerCase() === body.trim().toLowerCase() || c.id === body)
  if (choice) {
    const asked = await tickets().findOne({ workspaceId: ws(), phone, status: 'resolved', csat: null, csatRequestedAt: { $gte: new Date(now.getTime() - 3 * 86_400_000) } }, { sort: { resolvedAt: -1 } })
    if (asked) {
      await tickets().updateOne({ _id: asked._id }, { $set: { csat: { score: choice.score, label: choice.title, at: now } } })
      trace('ticket.rated', { number: asked.number, score: choice.score, label: choice.title }, ref(asked.number))
      return
    }
  }
  const latest = await tickets().findOne({ workspaceId: ws(), phone }, { sort: { createdAt: -1 } })
  const next = customerWrites(latest as { status: string; resolvedAt?: Date } | null, owner, +now)
  if (next === 'resume' && latest) {
    await tickets().updateOne({ _id: latest._id, status: 'pending' }, { $set: resumeSet(latest, now) })
    trace('ticket.updated', { number: latest.number, reason: 'customer' }, ref(latest.number), { status: ['pending', 'open'] })
  }
  if (next === 'reopen' && latest) {
    const set = await reopenSet(latest, 'open', now).catch(() => null)
    if (set && (await tickets().updateOne({ _id: latest._id, status: 'resolved' }, { $set: set }).catch(() => null))?.modifiedCount) {
      trace('ticket.reopened', { number: latest.number, reason: 'customer' }, ref(latest.number))
      await addMessage({ phone, direction: 'out', author: 'system', kind: 'event', body: `Ticket #${latest.number} reopened: the customer wrote again.`, at: now })
    }
  }
  if (next === 'new') await ensureTicket(phone, 'customer', { sample })
  if (owner !== 'human' || listenOnly()) return
  const s = await getSettings()
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!s.awayMessage || isOpen(now, s.hours) || (conv?.awaySentAt && now.getTime() - +conv.awaySentAt < 12 * 3_600_000)) return
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { awaySentAt: now } })
  await sendText(phone, s.awayMessage, { author: 'system', sample })
}

/** The chat went back to the AI agent: its open ticket is done (no rating question; the AI is talking now). */
export async function closeOnRelease(phone: string) {
  const now = new Date()
  const t = await tickets().findOneAndUpdate(
    { workspaceId: ws(), phone, status: OPEN },
    { $set: { status: 'resolved', resolvedAt: now, updatedAt: now, pausedAt: null, resolution: 'Handed back to the AI agent.' } },
  )
  if (t) trace('ticket.resolved', { number: t.number, reason: 'handed_back' }, ref(t.number))
}

// ---- views ----
function slaState(t: Obj, now = Date.now()) {
  if (t.status === 'resolved') return { kind: 'done' as const, at: null, breached: !!t.resolvedAt && +(t.resolvedAt as Date) > +(t.resolveDueAt as Date) }
  // Waiting on the customer: the clocks stop until they write back.
  if (t.status === 'pending') return { kind: 'paused' as const, at: null, breached: false }
  const target = t.firstRespondedAt ? 'resolve' : 'firstResponse'
  const due = (target === 'resolve' ? t.resolveDueAt : t.firstResponseDueAt) as Date
  return { kind: target, at: due, breached: +due < now }
}
const out = (t: Obj, names: Map<string, string>) => {
  const { _id, workspaceId: _w, ...rest } = t
  return { id: String(_id), ...rest, name: names.get(String(t.phone)) ?? null, sla: slaState(t) }
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PAGE = 100
const MAX_ROWS = 1000

/** The list: filters in the query, searched in the database (number, subject, phone, contact name),
 *  sorted by what's due soonest or newest, `limit` rows (Load more asks for more). */
async function list(u: URL, me: Actor) {
  const p = (k: string) => u.searchParams.get(k) ?? ''
  const where: Obj = { workspaceId: ws() }
  if (STATUSES.includes(p('status') as never)) where.status = p('status')
  else if (p('status') !== 'all') where.status = OPEN
  if (p('assignee') === 'me') where.assigneeId = me._id
  else if (p('assignee') === 'none') where.assigneeId = null
  else if (/^[0-9a-f-]{36}$/.test(p('assignee'))) where.assigneeId = p('assignee')
  if (PRIORITIES.includes(p('priority') as never)) where.priority = p('priority')
  if (p('team') === 'none') where.teamId = null
  else if (p('team')) where.teamId = p('team')
  if (p('escalated') === '1') where.escalationLevel = { $gt: 0 }
  if (p('tag')) where.tags = p('tag').toLowerCase()
  if (p('phone')) where.phone = parseCustomerKey(p('phone'))
  const q = p('q').trim()
  if (q) {
    const re = { $regex: escRe(q), $options: 'i' }
    const byName = await col('contacts').find({ workspaceId: ws(), name: re }, { projection: { phone: 1 } }).limit(200).toArray()
    where.$or = [{ subject: re }, { phone: { $regex: escRe(q.replace(/\D/g, '') || q) } }, { phone: { $in: byName.map((c) => c.phone) } }, ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : [])]
  }
  const scope = await scopeFor(me)
  if (scope) where.$and = [scope]
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(p('limit')) || PAGE))
  const now = new Date()
  const rows = await tickets()
    .aggregate([
      { $match: where },
      // The deadline that matters now: the first reply until there is one, then resolving.
      { $addFields: { dueAt: { $cond: [{ $eq: ['$status', 'open'] }, { $cond: [{ $gt: ['$firstRespondedAt', null] }, '$resolveDueAt', '$firstResponseDueAt'] }, null] } } },
      ...(p('breached') === '1' ? [{ $match: { dueAt: { $lt: now } } }] : []),
      // Due soonest: overdue first, tickets with no running clock (waiting, resolved) last; ties newest first.
      { $addFields: { noClock: { $eq: ['$dueAt', null] } } },
      { $sort: p('sort') === 'due' ? { noClock: 1, dueAt: 1, createdAt: -1 } : { createdAt: -1 } },
      { $limit: limit },
      { $project: { dueAt: 0, noClock: 0 } },
    ])
    .toArray()
  const names = await contactNames(rows.map((r) => String(r.phone)))
  return rows.map((r) => out(r, names))
}

/** The fields people see change, for the activity log. */
const SHOWN = ['status', 'priority', 'assigneeId', 'teamId', 'subject', 'tags'] as const
const shown = (o: Obj) => Object.fromEntries(SHOWN.filter((k) => k in o).map((k) => [k, o[k]]))

async function update(number: number, b: Obj, me: Actor) {
  const t = await tickets().findOne({ workspaceId: ws(), number })
  if (!t) throw new HttpError(404, `Ticket #${number} doesn’t exist.`)
  await needInScope(me, t.assigneeId)
  const now = new Date()
  const set: Obj = { updatedAt: now }
  let reopened = false
  if (b.status !== undefined && b.status !== t.status) {
    if (!['open', 'pending'].includes(String(b.status))) throw new HttpError(400, 'Use Resolve to close a ticket.')
    if (t.status === 'resolved') {
      Object.assign(set, await reopenSet(t, b.status as 'open' | 'pending', now))
      reopened = true
    } else if (b.status === 'pending') Object.assign(set, { status: 'pending', pausedAt: now })
    else Object.assign(set, resumeSet(t, now))
  }
  if (b.priority !== undefined && b.priority !== t.priority) {
    if (!PRIORITIES.includes(b.priority as Priority)) throw new HttpError(400, 'Priority must be urgent, high, normal or low.')
    // New targets count from when the clock started, plus any time spent waiting on the customer.
    if (!reopened) Object.assign(set, duesFrom(clockStart(t), b.priority as Priority, await getSettings(), Number(t.pausedMs ?? 0)))
    else Object.assign(set, duesFrom(now, b.priority as Priority, await getSettings()))
    set.priority = b.priority
  }
  if (b.assigneeId !== undefined) {
    const id = b.assigneeId === null ? null : String(b.assigneeId)
    needCanAssign(me, id, t.assigneeId)
    if (id && !(await col('memberships').findOne({ workspaceId: ws(), userId: id }))) throw new HttpError(400, 'That person isn’t in this workspace.')
    set.assigneeId = id
    await conversations().updateOne({ workspaceId: ws(), phone: t.phone }, { $set: { assigneeId: id } })
  }
  if (b.teamId !== undefined) {
    if (!can(me.role, 'tickets.reassign')) throw new HttpError(403, 'Only supervisors, admins and owners move tickets between teams.')
    const id = b.teamId === null ? null : String(b.teamId)
    if (id && !(await getTeams()).some((x) => x.id === id)) throw new HttpError(400, 'That team no longer exists.')
    set.teamId = id
  }
  if (b.subject !== undefined) {
    const subject = String(b.subject ?? '').trim().slice(0, 120)
    if (!subject) throw new HttpError(400, 'Give the ticket a subject.')
    set.subject = subject
  }
  if (Array.isArray(b.tags)) set.tags = [...new Set(b.tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
  await tickets().updateOne({ _id: t._id }, { $set: set })
  const changes = diff(shown(t), shown(set))
  if (reopened) trace('ticket.reopened', { number }, ref(number))
  else if (changes) trace('ticket.updated', { number }, ref(number), changes)
  return one(number)
}

async function resolve(number: number, b: Obj, me: Actor) {
  const t = await tickets().findOne({ workspaceId: ws(), number })
  if (!t) throw new HttpError(404, `Ticket #${number} doesn’t exist.`)
  if (t.status === 'resolved') throw new HttpError(409, `Ticket #${number} is already resolved.`)
  await needInScope(me, t.assigneeId)
  const now = new Date()
  const s = await getSettings()
  const conv = await conversations().findOne({ workspaceId: ws(), phone: t.phone })
  const windowOpen = !!conv?.lastInboundAt && now.getTime() - +conv.lastInboundAt < 86_400_000
  const askCsat = b.askFeedback !== false && s.csat.enabled && windowOpen && !listenOnly()
  const r = await tickets().updateOne(
    { _id: t._id, status: OPEN },
    { $set: { status: 'resolved', resolvedAt: now, updatedAt: now, pausedAt: null, resolution: String(b.resolution ?? '').trim().slice(0, 2000) || null, ...(askCsat && { csatRequestedAt: now }) } },
  )
  // Someone else resolved it a moment ago (two people, or a hand-back): nothing more to do.
  if (!r.modifiedCount) throw new HttpError(409, `Ticket #${number} is already resolved.`)
  await addMessage({ phone: String(t.phone), direction: 'out', author: 'system', kind: 'event', body: `${me.name} resolved ticket #${number}.`, at: now })
  trace('ticket.resolved', { number, askCsat, handBack: b.handBack !== false }, ref(number))
  if (askCsat) await sendInteractive(String(t.phone), s.csat.question, CSAT, { sample: !!conv?.sample })
  // A number-hidden customer can't be handed back yet (thread control needs a phone number).
  if (b.handBack !== false && conv?.owner === 'human' && !isBsuid(String(t.phone))) await setControl(me, String(t.phone), 'release')
  return one(number)
}

async function one(number: number) {
  const t = await tickets().findOne({ workspaceId: ws(), number })
  if (!t) throw new HttpError(404, `Ticket #${number} doesn’t exist.`)
  return out(t, await contactNames([String(t.phone)]))
}

/** The bell: what needs this person now, newest first. */
async function notifications(me: Actor) {
  const now = Date.now()
  // Yours, and nobody's: an unassigned ticket in a team concerns only that team's people.
  const myTeams = (await getTeams()).filter((t) => t.memberIds.includes(me._id)).map((t) => t.id)
  const open = await tickets()
    .find({ workspaceId: ws(), status: OPEN, $or: [{ assigneeId: me._id }, { assigneeId: null, teamId: { $in: [null, ...myTeams] } }] })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray()
  const names = await contactNames(open.map((t) => String(t.phone)))
  const items = open.flatMap((t) => {
    const who = names.get(String(t.phone)) || customerLabel(String(t.phone))
    const sla = slaState(t, now)
    const list: { id: string; kind: string; text: string; at: Date; number: number; phone: string }[] = []
    if (sla.at && (sla.breached || +sla.at - now < 15 * 60_000))
      list.push({ id: `sla:${t.number}:${sla.kind}`, kind: sla.breached ? 'breached' : 'due', text: `#${t.number} ${who}: ${sla.kind === 'firstResponse' ? 'first reply' : 'resolution'} ${sla.breached ? 'is overdue' : 'is due soon'}`, at: sla.at, number: Number(t.number), phone: String(t.phone) })
    list.push({ id: `new:${t.number}`, kind: t.assigneeId ? 'assigned' : 'unassigned', text: t.assigneeId ? `#${t.number} ${who} is assigned to you` : `#${t.number} ${who} needs someone`, at: t.createdAt as Date, number: Number(t.number), phone: String(t.phone) })
    return list
  })
  // Escalations name the people they notify (assignee, team lead, supervisors, admins).
  const escalated = await tickets().find({ workspaceId: ws(), status: OPEN, 'escalations.notify': me._id }).sort({ escalatedAt: -1 }).limit(30).toArray()
  const escNames = await contactNames(escalated.map((t) => String(t.phone)))
  for (const t of escalated) {
    const last = ((t.escalations as Obj[]) ?? []).filter((e) => (e.notify as string[]).includes(me._id)).at(-1)
    if (last)
      items.push({ id: `esc:${t.number}:${last.level}`, kind: 'escalated', text: `#${t.number} ${escNames.get(String(t.phone)) || customerLabel(String(t.phone))} escalated to level ${last.level}: ${String(last.reason).toLowerCase()}`, at: last.at as Date, number: Number(t.number), phone: String(t.phone) })
  }
  // Account alerts (budget, number quality, templates) are for owners, and stay on top until dismissed.
  const alerts =
    can(me.role, 'alerts.receive')
      ? (await openAlerts(me._id)).map((a) => ({ id: `alert:${String(a.key)}`, kind: a.severity === 'critical' ? 'alert_critical' : 'alert', text: `${String(a.title)}. ${String(a.detail)}`, at: a.createdAt as Date, target: String(a.target) }))
      : []
  return [...alerts, ...(await dueReminders(me._id)), ...items.sort((a, z) => +z.at - +a.at)].slice(0, 30)
}

// ---- routes ----
async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/tickets' && m === 'GET') return list(u, me)
  if (path === '/api/tickets' && m === 'POST') {
    const b = obj(await readJson(req))
    const phone = parseCustomerKey(String(b.phone ?? ''))
    if (!(await conversations().findOne({ workspaceId: ws(), phone }))) throw new HttpError(404, 'No chat with this number yet.')
    const priority = PRIORITIES.includes(b.priority as Priority) ? (b.priority as Priority) : 'normal'
    if (await tickets().findOne({ workspaceId: ws(), phone, status: OPEN })) throw new HttpError(409, 'This chat already has an open ticket.')
    const t = await ensureTicket(phone, 'manual', { subject: String(b.subject ?? '').trim(), priority })
    return one(Number(t.number))
  }
  if (path === '/api/tickets/bulk' && m === 'POST') {
    const b = obj(await readJson(req))
    const numbers = [...new Set((Array.isArray(b.numbers) ? b.numbers : []).map(Number).filter(Number.isInteger))].slice(0, 200)
    // Each ticket on its own: one that can't change (already resolved, someone else's) is reported, the rest still go.
    const failed: { number: number; reason: string }[] = []
    for (const n of numbers) {
      try {
        if (b.action === 'resolve') await resolve(n, { askFeedback: b.askFeedback, handBack: b.handBack, resolution: b.resolution }, me)
        else await update(n, obj(b.patch), me)
      } catch (err) {
        if (!(err instanceof HttpError)) throw err
        failed.push({ number: n, reason: err.message })
      }
    }
    return { done: numbers.length - failed.length, failed }
  }
  if ((seg = path.match(/^\/api\/tickets\/(\d+)(\/resolve)?$/))) {
    const n = Number(seg[1])
    if (seg[2] && m === 'POST') return resolve(n, obj(await readJson(req)), me)
    if (m === 'GET') {
      const t = await one(n)
      // A restricted agent can't walk the numbers into other people's tickets.
      await needInScope(me, (t as { assigneeId?: unknown }).assigneeId)
      return t
    }
    if (m === 'PATCH') return update(n, obj(await readJson(req)), me)
  }
  if (path === '/api/support/settings' && m === 'GET')
    return { ...(await getSettings()), aiSummary: !!env('ANTHROPIC_API_KEY'), listenOnly: listenOnly(), saved: !!(await settingsCol().findOne({ workspaceId: ws() }, { projection: { _id: 1 } })) }
  if (path === '/api/support/settings' && m === 'PUT') {
    if (!can(me.role, 'settings.manage')) throw new HttpError(403, 'Only owners and admins can change support settings.')
    const members = new Set((await col('memberships').find({ workspaceId: ws() }).toArray()).map((x) => String(x.userId)))
    const teamIds = new Set((await getTeams()).map((t) => t.id))
    const before = await getSettings()
    const settings = parseSettings(obj(await readJson(req)), members, teamIds, before.teams)
    await settingsCol().updateOne({ workspaceId: ws() }, { $set: { settings, updatedAt: new Date(), updatedBy: me._id } }, { upsert: true })
    trace('settings.updated', { area: 'support' }, undefined, diff(before as unknown as Obj, settings as unknown as Obj))
    return { ...settings, aiSummary: !!env('ANTHROPIC_API_KEY'), listenOnly: listenOnly() }
  }
  if (path === '/api/support/notifications' && m === 'GET') return notifications(me)
  if ((seg = path.match(/^\/api\/support\/notifications\/reminder:([a-f0-9]{24})\/dismiss$/)) && m === 'POST') {
    await dismissReminder(seg[1], me._id)
    return { ok: true }
  }
  if ((seg = path.match(/^\/api\/support\/notifications\/alert:(.+)\/dismiss$/)) && m === 'POST') {
    await dismissAlert(decodeURIComponent(seg[1]), me._id)
    return { ok: true }
  }
  const ops = await supportOpsRoute(req, u, me)
  if (ops !== undefined) return ops
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 409: 'Already exists' }
export async function handleTickets(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/tickets') && !u.pathname.startsWith('/api/support/')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Tickets need the database.' } }, () => route(req, u, me))
}
