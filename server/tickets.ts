// Tickets: one issue inside a customer's chat. A chat gets an open ticket the moment it moves to
// people (AI handoff, someone takes over, or a person replies). SLA clocks run on business hours;
// routing picks the assignee; resolving can ask for feedback (CSAT) and hand the chat back to the AI.
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { HttpError, type Obj, type Titles, obj, readJson, serveJson } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import { env } from './upstream.ts'
import { trace } from './trace.ts'
import { customerLabel, isBsuid, parseCustomerKey } from '../src/app/lib/customer.ts'
import { dismissAlert, openAlerts } from './alerts.ts'
import { addBusinessMinutes, DAYS, DEFAULT_HOURS, isOpen, type Hours } from './businessHours.ts'
import { contactNames } from './contacts.ts'
import { addMessage, conversations, sendInteractive, sendText, setControl, type Actor } from './inbox.ts'

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
const STATUSES = ['open', 'pending', 'resolved'] as const
const CSAT = [
  { id: 'csat_3', title: 'Good', score: 3 },
  { id: 'csat_2', title: 'Okay', score: 2 },
  { id: 'csat_1', title: 'Bad', score: 1 },
]

export interface SupportSettings {
  hours: Hours
  /** Sent when a customer writes to the team outside business hours; '' = off. */
  awayMessage: string
  /** Minutes of business time per priority. */
  sla: Record<Priority, { firstResponse: number; resolve: number }>
  routing: { mode: 'unassigned' | 'round_robin' | 'fixed'; teamId: string | null; userId: string | null }
  teams: { id: string; name: string; memberIds: string[] }[]
  csat: { enabled: boolean; question: string }
}
export const DEFAULT_SETTINGS: SupportSettings = {
  hours: DEFAULT_HOURS,
  awayMessage: 'Thanks for your message. Our team is offline right now and will reply when we’re back. You can keep chatting with our AI assistant meanwhile.',
  sla: { urgent: { firstResponse: 15, resolve: 240 }, high: { firstResponse: 30, resolve: 480 }, normal: { firstResponse: 60, resolve: 1440 }, low: { firstResponse: 240, resolve: 2880 } },
  routing: { mode: 'round_robin', teamId: null, userId: null },
  teams: [],
  csat: { enabled: true, question: 'How did we do today?' },
}

const tickets = () => col('tickets')
const settingsCol = () => col('support_settings')

export async function getSettings(): Promise<SupportSettings> {
  const s = await settingsCol().findOne({ workspaceId: ws() })
  return { ...DEFAULT_SETTINGS, ...(s?.settings as Partial<SupportSettings> | undefined) }
}

// ---- validation of the settings form ----
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
function parseSettings(b: Obj, members: Set<string>): SupportSettings {
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
  const teams = (Array.isArray(b.teams) ? b.teams : []).map((t) => {
    const x = obj(t)
    const name = String(x.name ?? '').trim()
    if (!name) throw new HttpError(400, 'Every team needs a name.')
    return { id: String(x.id || randomUUID()), name: name.slice(0, 60), memberIds: (Array.isArray(x.memberIds) ? x.memberIds : []).map(String).filter((id) => members.has(id)) }
  })
  const r = obj(b.routing)
  const mode = r.mode === 'fixed' || r.mode === 'unassigned' ? r.mode : 'round_robin'
  const routing = { mode, teamId: teams.some((t) => t.id === r.teamId) ? String(r.teamId) : null, userId: members.has(String(r.userId)) ? String(r.userId) : null } as SupportSettings['routing']
  if (mode === 'fixed' && !routing.userId) throw new HttpError(400, 'Pick who gets every new ticket.')
  const c = obj(b.csat)
  return {
    hours: { timezone: tz, week, holidays },
    awayMessage: String(b.awayMessage ?? '').trim().slice(0, 1000),
    sla,
    routing,
    teams,
    csat: { enabled: c.enabled !== false, question: String(c.question ?? '').trim().slice(0, 200) || DEFAULT_SETTINGS.csat.question },
  }
}

// ---- routing ----
async function pickAssignee(s: SupportSettings): Promise<string | null> {
  if (s.routing.mode === 'fixed') return s.routing.userId
  if (s.routing.mode === 'unassigned') return null
  const pool = s.routing.teamId
    ? (s.teams.find((t) => t.id === s.routing.teamId)?.memberIds ?? [])
    : ((await col('memberships').find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()).map((m) => String(m.userId)))
  if (!pool.length) return null
  // Round robin: an atomic counter per workspace, so two tickets at once never get the same turn.
  const r = await col('counters').findOneAndUpdate({ _id: `rr:${ws()}` as never }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  return pool[(Number(r?.seq ?? 1) - 1) % pool.length]
}

// ---- lifecycle hooks (called by inbox.ts) ----
const OPEN = { $in: ['open', 'pending'] }

/** Gives the chat an open ticket if it has none. `source` says why it moved to people. */
export async function ensureTicket(phone: string, source: 'handoff' | 'takeover' | 'reply' | 'manual', opts: { subject?: string; priority?: Priority; sample?: boolean } = {}) {
  const existing = await tickets().findOne({ workspaceId: ws(), phone, status: OPEN })
  if (existing) return existing
  const s = await getSettings()
  const now = new Date()
  const priority = opts.priority ?? 'normal'
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  const lastWords = await col('messages').findOne({ workspaceId: ws(), phone, author: 'customer', body: { $type: 'string' } }, { sort: { at: -1 } })
  const assigneeId = conv?.assigneeId ?? (await pickAssignee(s))
  const n = await col('counters').findOneAndUpdate({ _id: `ticket:${ws()}` as never }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  const doc = {
    workspaceId: ws(),
    number: 1000 + Number(n?.seq ?? 1),
    phone,
    subject: (opts.subject || String(lastWords?.body ?? '') || `Chat with +${phone}`).slice(0, 120),
    status: 'open',
    priority,
    assigneeId,
    tags: [] as string[],
    source,
    createdAt: now,
    updatedAt: now,
    firstResponseDueAt: addBusinessMinutes(now, s.sla[priority].firstResponse, s.hours),
    resolveDueAt: addBusinessMinutes(now, s.sla[priority].resolve, s.hours),
    firstRespondedAt: null,
    resolvedAt: null,
    resolution: null,
    csat: null,
    ...((opts.sample ?? conv?.sample) && { sample: true }),
  }
  await tickets().insertOne(doc)
  trace('ticket.created', { number: doc.number, source, priority, assigned: !!assigneeId }, { entity: 'ticket', id: String(doc.number) })
  if (assigneeId && !conv?.assigneeId) await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { assigneeId } })
  return doc
}

export async function onAgentReply(phone: string) {
  await tickets().updateOne({ workspaceId: ws(), phone, status: OPEN, firstRespondedAt: null }, { $set: { firstRespondedAt: new Date(), updatedAt: new Date() } })
}

/** A customer wrote: reopen a pending ticket, take a CSAT answer, and send the away message if the team is off. */
export async function onCustomerMessage(phone: string, body: string, owner: 'ai' | 'human', sample: boolean) {
  const now = new Date()
  await tickets().updateOne({ workspaceId: ws(), phone, status: 'pending' }, { $set: { status: 'open', updatedAt: now } })
  const choice = CSAT.find((c) => c.title.toLowerCase() === body.trim().toLowerCase() || c.id === body)
  if (choice) {
    const asked = await tickets().findOne({ workspaceId: ws(), phone, status: 'resolved', csat: null, csatRequestedAt: { $gte: new Date(now.getTime() - 3 * 86_400_000) } }, { sort: { resolvedAt: -1 } })
    if (asked) {
      await tickets().updateOne({ _id: asked._id }, { $set: { csat: { score: choice.score, label: choice.title, at: now } } })
      return
    }
  }
  if (owner !== 'human') return
  const s = await getSettings()
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!s.awayMessage || isOpen(now, s.hours) || (conv?.awaySentAt && now.getTime() - +conv.awaySentAt < 12 * 3_600_000)) return
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { awaySentAt: now } })
  await sendText(phone, s.awayMessage, { author: 'system', sample })
}

// ---- views ----
function slaState(t: Obj, now = Date.now()) {
  if (t.status === 'resolved') return { kind: 'done' as const, at: null, breached: !!t.resolvedAt && +(t.resolvedAt as Date) > +(t.resolveDueAt as Date) }
  const target = t.firstRespondedAt ? 'resolve' : 'firstResponse'
  const due = (target === 'resolve' ? t.resolveDueAt : t.firstResponseDueAt) as Date
  return { kind: target, at: due, breached: +due < now }
}
const out = (t: Obj, names: Map<string, string>) => {
  const { _id, workspaceId: _w, ...rest } = t
  return { id: String(_id), ...rest, name: names.get(String(t.phone)) ?? null, sla: slaState(t) }
}

async function list(u: URL, me: Actor) {
  const p = (k: string) => u.searchParams.get(k) ?? ''
  const where: Obj = { workspaceId: ws() }
  if (STATUSES.includes(p('status') as never)) where.status = p('status')
  else if (p('status') !== 'all') where.status = OPEN
  if (p('assignee') === 'me') where.assigneeId = me._id
  if (p('assignee') === 'none') where.assigneeId = null
  if (PRIORITIES.includes(p('priority') as never)) where.priority = p('priority')
  if (p('phone')) where.phone = p('phone').replace(/\D/g, '')
  const rows = await tickets().find(where).sort({ createdAt: -1 }).limit(500).toArray()
  const names = await contactNames(rows.map((r) => String(r.phone)))
  const q = p('q').toLowerCase()
  return rows
    .filter((r) => !q || String(r.number).includes(q) || String(r.subject).toLowerCase().includes(q) || (names.get(String(r.phone)) ?? '').toLowerCase().includes(q) || String(r.phone).includes(q))
    .map((r) => out(r, names))
}

async function update(number: number, b: Obj, me: Actor) {
  const t = await tickets().findOne({ workspaceId: ws(), number })
  if (!t) throw new HttpError(404, `Ticket #${number} doesn’t exist.`)
  const set: Obj = { updatedAt: new Date() }
  if (b.status !== undefined) {
    if (!['open', 'pending'].includes(String(b.status))) throw new HttpError(400, 'Use Resolve to close a ticket.')
    set.status = b.status
    if (t.status === 'resolved') Object.assign(set, { resolvedAt: null, resolution: null })
  }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority as Priority)) throw new HttpError(400, 'Priority must be urgent, high, normal or low.')
    const s = await getSettings()
    // New targets count from when the ticket was opened.
    Object.assign(set, {
      priority: b.priority,
      firstResponseDueAt: addBusinessMinutes(t.createdAt as Date, s.sla[b.priority as Priority].firstResponse, s.hours),
      resolveDueAt: addBusinessMinutes(t.createdAt as Date, s.sla[b.priority as Priority].resolve, s.hours),
    })
  }
  if (b.assigneeId !== undefined) {
    const id = b.assigneeId === null ? null : String(b.assigneeId)
    if (id && !(await col('memberships').findOne({ workspaceId: ws(), userId: id }))) throw new HttpError(400, 'That person isn’t in this workspace.')
    set.assigneeId = id
    await conversations().updateOne({ workspaceId: ws(), phone: t.phone }, { $set: { assigneeId: id } })
  }
  if (typeof b.subject === 'string' && b.subject.trim()) set.subject = b.subject.trim().slice(0, 120)
  if (Array.isArray(b.tags)) set.tags = b.tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20)
  await tickets().updateOne({ _id: t._id }, { $set: set })
  trace('ticket.updated', { number, fields: Object.keys(set).filter((k) => k !== 'updatedAt') }, { entity: 'ticket', id: String(number) })
  void me
  return one(number)
}

async function resolve(number: number, b: Obj, me: Actor) {
  const t = await tickets().findOne({ workspaceId: ws(), number })
  if (!t) throw new HttpError(404, `Ticket #${number} doesn’t exist.`)
  if (t.status === 'resolved') throw new HttpError(400, `Ticket #${number} is already resolved.`)
  const now = new Date()
  const s = await getSettings()
  const conv = await conversations().findOne({ workspaceId: ws(), phone: t.phone })
  const windowOpen = !!conv?.lastInboundAt && now.getTime() - +conv.lastInboundAt < 86_400_000
  const askCsat = b.askFeedback !== false && s.csat.enabled && windowOpen
  await tickets().updateOne({ _id: t._id }, { $set: { status: 'resolved', resolvedAt: now, updatedAt: now, resolution: String(b.resolution ?? '').trim().slice(0, 2000) || null, ...(askCsat && { csatRequestedAt: now }) } })
  await addMessage({ phone: String(t.phone), direction: 'out', author: 'system', kind: 'event', body: `${me.name} resolved ticket #${number}.`, at: now })
  trace('ticket.resolved', { number, askCsat, handBack: b.handBack !== false }, { entity: 'ticket', id: String(number) })
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
  const open = await tickets().find({ workspaceId: ws(), status: OPEN, $or: [{ assigneeId: me._id }, { assigneeId: null }] }).sort({ createdAt: -1 }).limit(100).toArray()
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
  // Account alerts (budget, number quality, templates) are for owners, and stay on top until dismissed.
  const alerts =
    me.role === 'owner'
      ? (await openAlerts(me._id)).map((a) => ({ id: `alert:${String(a.key)}`, kind: a.severity === 'critical' ? 'alert_critical' : 'alert', text: `${String(a.title)}. ${String(a.detail)}`, at: a.createdAt as Date, target: String(a.target) }))
      : []
  return [...alerts, ...items.sort((a, z) => +z.at - +a.at)].slice(0, 30)
}

// ---- support analytics ----
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, z) => a - z)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
/** The team's numbers for the last `days` days, by day in the workspace's time zone. */
async function analytics(days: number) {
  const s = await getSettings()
  const since = new Date(Date.now() - days * 86_400_000)
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: s.hours.timezone }).format(d)
  const all = await tickets().find({ workspaceId: ws(), $or: [{ createdAt: { $gte: since } }, { resolvedAt: { $gte: since } }] }).toArray()
  const created = all.filter((t) => +t.createdAt >= +since)
  const resolved = all.filter((t) => t.resolvedAt && +t.resolvedAt >= +since)
  const responded = all.filter((t) => t.firstRespondedAt && +t.firstRespondedAt >= +since)
  const dates = Array.from({ length: days }, (_, i) => day(new Date(Date.now() - (days - 1 - i) * 86_400_000)))
  const count = (rows: Obj[], k: string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(day(r[k] as Date), (m.get(day(r[k] as Date)) ?? 0) + 1)
    return m
  }
  const c = count(created, 'createdAt')
  const r = count(resolved, 'resolvedAt')
  const mins = (a: unknown, b: unknown) => (+(b as Date) - +(a as Date)) / 60_000
  const csat = resolved.filter((t) => t.csat).map((t) => Number(obj(t.csat).score))
  const people = new Map((await col('users').find({ _id: { $in: [...new Set(all.map((t) => t.assigneeId).filter(Boolean))] } as never }).toArray()).map((u) => [String(u._id), String(u.name ?? 'Someone')]))
  const byPerson = new Map<string, { name: string; resolved: number; open: number; firstReply: number[] }>()
  for (const t of all) {
    const id = String(t.assigneeId ?? 'none')
    const row = byPerson.get(id) ?? { name: t.assigneeId ? (people.get(id) ?? 'Someone') : 'Unassigned', resolved: 0, open: 0, firstReply: [] }
    if (t.status === 'resolved' && t.resolvedAt && +t.resolvedAt >= +since) row.resolved++
    if (t.status !== 'resolved') row.open++
    if (t.firstRespondedAt && +t.firstRespondedAt >= +since) row.firstReply.push(mins(t.createdAt, t.firstRespondedAt))
    byPerson.set(id, row)
  }
  // Chats in range: answered by the AI alone, or with someone from the team.
  const touched = await col('messages').aggregate([{ $match: { workspaceId: ws(), at: { $gte: since }, kind: { $ne: 'note' } } }, { $group: { _id: '$phone', team: { $max: { $cond: [{ $eq: ['$author', 'agent'] }, 1, 0] } } } }]).toArray()
  const sent = await col('broadcast_recipients').aggregate([{ $match: { workspaceId: ws(), sentAt: { $gte: since } } }, { $group: { _id: null, sent: { $sum: 1 }, read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } }, replied: { $sum: { $cond: [{ $ifNull: ['$repliedAt', false] }, 1, 0] } } } }]).toArray()
  return {
    days,
    timezone: s.hours.timezone,
    series: dates.map((d) => ({ date: d, created: c.get(d) ?? 0, resolved: r.get(d) ?? 0 })),
    created: created.length,
    resolved: resolved.length,
    open: await tickets().countDocuments({ workspaceId: ws(), status: OPEN }),
    medianFirstReplyMin: median(responded.map((t) => mins(t.createdAt, t.firstRespondedAt))),
    medianResolveMin: median(resolved.map((t) => mins(t.createdAt, t.resolvedAt))),
    slaFirstReplyMet: responded.length ? responded.filter((t) => +t.firstRespondedAt <= +t.firstResponseDueAt).length / responded.length : null,
    slaResolveMet: resolved.length ? resolved.filter((t) => +t.resolvedAt <= +t.resolveDueAt).length / resolved.length : null,
    csat: { responses: csat.length, average: csat.length ? csat.reduce((a, z) => a + z, 0) / csat.length : null, good: csat.filter((x) => x === 3).length, okay: csat.filter((x) => x === 2).length, bad: csat.filter((x) => x === 1).length },
    chats: { total: touched.length, aiOnly: touched.filter((x) => !x.team).length, withTeam: touched.filter((x) => x.team).length },
    people: [...byPerson.values()].map((p) => ({ name: p.name, resolved: p.resolved, open: p.open, medianFirstReplyMin: median(p.firstReply) })).sort((a, z) => z.resolved - a.resolved),
    broadcasts: { sent: Number(sent[0]?.sent ?? 0), read: Number(sent[0]?.read ?? 0), replied: Number(sent[0]?.replied ?? 0) },
  }
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
    const numbers = (Array.isArray(b.numbers) ? b.numbers : []).map(Number).filter(Number.isInteger).slice(0, 200)
    for (const n of numbers) {
      if (b.action === 'resolve') await resolve(n, { askFeedback: b.askFeedback, handBack: b.handBack }, me).catch(() => null)
      else await update(n, obj(b.patch), me)
    }
    return { ok: true, count: numbers.length }
  }
  if ((seg = path.match(/^\/api\/tickets\/(\d+)(\/resolve)?$/))) {
    const n = Number(seg[1])
    if (seg[2] && m === 'POST') return resolve(n, obj(await readJson(req)), me)
    if (m === 'GET') return one(n)
    if (m === 'PATCH') return update(n, obj(await readJson(req)), me)
  }
  if (path === '/api/support/settings' && m === 'GET') return { ...(await getSettings()), aiSummary: !!env('ANTHROPIC_API_KEY') }
  if (path === '/api/support/settings' && m === 'PUT') {
    if (me.role !== 'owner') throw new HttpError(403, 'Only owners can change support settings.')
    const members = new Set((await col('memberships').find({ workspaceId: ws() }).toArray()).map((x) => String(x.userId)))
    const settings = parseSettings(obj(await readJson(req)), members)
    await settingsCol().updateOne({ workspaceId: ws() }, { $set: { settings, updatedAt: new Date(), updatedBy: me._id } }, { upsert: true })
    trace('settings.updated', { area: 'support' })
    return { ...settings, aiSummary: !!env('ANTHROPIC_API_KEY') }
  }
  if (path === '/api/support/notifications' && m === 'GET') return notifications(me)
  if ((seg = path.match(/^\/api\/support\/notifications\/alert:(.+)\/dismiss$/)) && m === 'POST') {
    await dismissAlert(decodeURIComponent(seg[1]), me._id)
    return { ok: true }
  }
  if (path === '/api/support/analytics' && m === 'GET') {
    const days = Number(u.searchParams.get('days') ?? 7)
    if (![7, 30, 90].includes(days)) throw new HttpError(400, 'days must be 7, 30 or 90.')
    return analytics(days)
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 409: 'Already exists' }
export async function handleTickets(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/tickets') && !u.pathname.startsWith('/api/support/')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Tickets need the database.' } }, () => route(req, u, me))
}
