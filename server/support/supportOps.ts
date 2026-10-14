// Who handles what: teams, each person's skills, limit and availability, routing rules for new
// tickets, and the escalation matrix that raises tickets running out of time. The decisions
// themselves are pure and shared with the settings screens (src/app/support/routing.ts).
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { HttpError, type Obj, obj, readJson } from '../platform/http.ts'
import { col, db, withWorkspace, ws } from '../platform/db.ts'
import { assetsFor } from '../whatsapp/index.ts'
import { diff, trace } from '../platform/trace.ts'
import { raiseAlert } from '../platform/alerts.ts'
import { isOpen } from './businessHours.ts'
import { mail } from '../platform/mail.ts'
import { customerLabel } from '../../src/app/lib/customer.ts'
import { can } from '../../src/app/lib/permissions.ts'
import {
  applyRule,
  DEFAULT_MATRIX,
  describeLevel,
  firstMatch,
  nextEscalation,
  parseMatrix,
  parseRules,
  parseTeam,
  pickFromPool,
  raise,
  routePlan,
  type AgentProfile,
  type Availability,
  type EscalationMatrix,
  type Facts,
  type Priority,
  type Rule,
  type Team,
  type TicketSource,
} from '../../src/app/support/routing.ts'
import type { Actor } from '../messaging/index.ts'
import { addMessage, conversations, currentNumber } from '../messaging/index.ts'
import { duesFrom, getSettings } from './tickets.ts'

const teamsCol = () => col('teams')
const rulesCol = () => col('routing_rules')
const matrixCol = () => col('escalation_policies')
const memberships = () => col('memberships')
const tickets = () => col('tickets')
const OPEN = { $in: ['open', 'pending'] }

// ---- storage ----
const teamOut = (t: Obj): Team => ({
  id: String(t._id),
  name: String(t.name),
  description: String(t.description ?? ''),
  leadId: (t.leadId as string | null) ?? null,
  memberIds: (t.memberIds as string[]) ?? [],
  assign: (t.assign as Team['assign']) ?? 'round_robin',
})

/** The workspace's teams. Teams made before they had their own collection (in support settings) move over once, keeping their ids. */
export async function getTeams(): Promise<Team[]> {
  let rows = await teamsCol().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()
  if (!rows.length) {
    // Moved once: after that the old list is cleared and flagged, so deleting every team doesn't bring them back.
    const flagged = await col('support_settings').findOne({ workspaceId: ws(), teamsMigrated: true }, { projection: { _id: 1 } })
    const old = flagged ? [] : (await getSettings()).teams
    if (old.length) {
      const now = new Date()
      await teamsCol()
        .insertMany(old.map((t) => ({ _id: t.id as never, workspaceId: ws(), name: t.name, description: '', leadId: null, memberIds: t.memberIds, assign: 'round_robin', createdAt: now })))
        .catch(() => {}) // another request moved them first
      await col('support_settings').updateOne({ workspaceId: ws() }, { $set: { teamsMigrated: true, 'settings.teams': [] } })
      rows = await teamsCol().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()
    }
  }
  return rows.map(teamOut)
}

async function getRules(): Promise<Rule[]> {
  return ((await rulesCol().findOne({ workspaceId: ws() }))?.rules as Rule[] | undefined) ?? []
}

async function getMatrix(): Promise<EscalationMatrix> {
  const m = (await matrixCol().findOne({ workspaceId: ws() }))?.matrix as EscalationMatrix | undefined
  return m ?? DEFAULT_MATRIX
}

const memberIds = async () => new Set((await memberships().find({ workspaceId: ws() }).toArray()).map((m) => String(m.userId)))

async function profiles(): Promise<AgentProfile[]> {
  const ms = await memberships().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()
  const names = new Map((await col('users').find({ _id: { $in: ms.map((m) => m.userId) } as never }).toArray()).map((u) => [String(u._id), String(u.name ?? '')]))
  return ms.map((m) => ({
    userId: String(m.userId),
    name: names.get(String(m.userId)) ?? '',
    skills: (m.skills as string[]) ?? [],
    maxOpen: (m.maxOpen as number | null) ?? null,
    availability: (m.availability as Availability) ?? 'online',
  }))
}

async function openCounts(): Promise<Map<string, number>> {
  const rows = await tickets().aggregate([{ $match: { workspaceId: ws(), status: OPEN, assigneeId: { $ne: null } } }, { $group: { _id: '$assigneeId', n: { $sum: 1 } } }]).toArray()
  return new Map(rows.map((r) => [String(r._id), Number(r.n)]))
}

async function turn(key: string) {
  const r = await col('counters').findOneAndUpdate({ _id: `${key}:${ws()}` as never }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  return Number(r?.seq ?? 1) - 1
}

/** Picks someone in a team for a new or moved ticket; null leaves it in the team's queue. */
async function pickInTeam(team: Team, skill?: string) {
  const ps = new Map((await profiles()).map((p) => [p.userId, p]))
  return pickFromPool(team.memberIds, team.assign, ps, await openCounts(), await turn(`rr:team:${team.id}`), skill)
}

// ---- people and teams leaving ----
/** Settings that named a deleted team stop naming it: the default routing falls back to everyone,
 *  escalation levels stop moving tickets there. */
async function forgetTeam(teamId: string) {
  await col('support_settings').updateOne({ workspaceId: ws(), 'settings.routing.teamId': teamId }, { $set: { 'settings.routing.teamId': null } })
  const m = await getMatrix()
  let changed = false
  for (const levels of Object.values(m.levels))
    for (const l of levels)
      if (l.reassignTeamId === teamId) {
        l.reassignTeamId = null
        changed = true
      }
  if (changed) await matrixCol().updateOne({ workspaceId: ws() }, { $set: { matrix: m, updatedAt: new Date() } })
}

/**
 * Someone left or was removed: nothing keeps waiting on them. Their open tickets and chats become
 * unassigned (each ticket's history says why), they leave every team, rules that assigned to them
 * stop doing so, and "always assign to" them falls back to round robin. Owners get one notice.
 */
export async function cleanUpMember(userId: string, name: string) {
  const open = await tickets().find({ workspaceId: ws(), status: OPEN, assigneeId: userId }, { projection: { number: 1 } }).toArray()
  await tickets().updateMany({ workspaceId: ws(), status: OPEN, assigneeId: userId }, { $set: { assigneeId: null, updatedAt: new Date() } })
  for (const t of open) trace('ticket.updated', { number: t.number, reason: 'member_left' }, { entity: 'ticket', id: String(t.number) }, { assigneeId: [userId, null] })
  await conversations().updateMany({ workspaceId: ws(), assigneeId: userId }, { $set: { assigneeId: null } })
  await teamsCol().updateMany({ workspaceId: ws(), memberIds: userId }, { $pull: { memberIds: userId } as never })
  await teamsCol().updateMany({ workspaceId: ws(), leadId: userId }, { $set: { leadId: null } })
  const rules = await getRules()
  let rulesChanged = 0
  const kept = rules.map((r) => {
    const then = r.then.filter((a) => !(a.do === 'assignUser' && a.userId === userId))
    if (then.length === r.then.length) return r
    rulesChanged++
    return { ...r, then, enabled: r.enabled && then.length > 0 }
  })
  if (rulesChanged) await rulesCol().updateOne({ workspaceId: ws() }, { $set: { rules: kept, updatedAt: new Date() } })
  const fixed = await col('support_settings').updateOne(
    { workspaceId: ws(), 'settings.routing.mode': 'fixed', 'settings.routing.userId': userId },
    { $set: { 'settings.routing.mode': 'round_robin', 'settings.routing.userId': null } },
  )
  if (open.length || rulesChanged || fixed.modifiedCount)
    await raiseAlert({
      key: `member_left:${userId}`,
      severity: 'warning',
      title: `${name || 'A teammate'} left the workspace`,
      detail: [
        open.length && `${open.length} open ticket${open.length === 1 ? ' is' : 's are'} now unassigned.`,
        rulesChanged && `${rulesChanged} routing rule${rulesChanged === 1 ? '' : 's'} no longer assign${rulesChanged === 1 ? 's' : ''} to them.`,
        fixed.modifiedCount && 'New tickets now go round robin instead of to them.',
      ].filter(Boolean).join(' '),
      target: 'members',
    })
}

// ---- routing a new ticket ----
interface Routed {
  assigneeId: string | null
  teamId: string | null
  priority: Priority
  tags: string[]
  rule: string | null
}

/**
 * Decides where a new ticket goes: the first matching rule, else the workspace's default routing
 * (support settings). `explicitPriority`: someone chose it (a manual ticket), so rules don't change it.
 */
export async function routeTicket(input: { phone: string; source: TicketSource; priority: Priority; explicitPriority: boolean; text: string }): Promise<Routed> {
  const s = await getSettings()
  const contact = await col('contacts').findOne({ workspaceId: ws(), phone: input.phone }, { projection: { tags: 1 } })
  const facts: Facts = {
    source: input.source,
    priority: input.priority,
    text: input.text,
    contactTags: (contact?.tags as string[]) ?? [],
    open: isOpen(new Date(), s.hours),
    phoneNumberId: currentNumber(),
  }
  const rule = firstMatch(await getRules(), facts)
  const a = applyRule(rule, facts)
  const priority = input.explicitPriority ? input.priority : a.priority
  const base = { priority, tags: a.tags, rule: rule?.name ?? null }
  const plan = routePlan(a.target, s.routing, await getTeams())
  if (plan.to === 'user') return { ...base, assigneeId: plan.userId, teamId: null }
  if (plan.to === 'nobody') return { ...base, assigneeId: null, teamId: null }
  if (plan.to === 'team') return { ...base, assigneeId: await pickInTeam(plan.team, plan.skill), teamId: plan.team.id }
  // Everyone in the workspace takes turns (people set to away or offline are skipped).
  const ps = await profiles()
  const everyone = ps.map((p) => p.userId)
  return { ...base, assigneeId: pickFromPool(everyone, 'round_robin', new Map(ps.map((p) => [p.userId, p])), await openCounts(), await turn('rr')), teamId: null }
}

// ---- escalation ----
async function recipients(t: Obj, notify: string[], teams: Team[]) {
  const ids = new Set<string>()
  if (notify.includes('assignee') && t.assigneeId) ids.add(String(t.assigneeId))
  if (notify.includes('team_lead')) {
    const lead = teams.find((x) => x.id === t.teamId)?.leadId
    if (lead) ids.add(lead)
  }
  const roles = [...(notify.includes('supervisors') ? ['supervisor'] : []), ...(notify.includes('admins') ? ['owner', 'admin'] : [])]
  if (roles.length) for (const m of await memberships().find({ workspaceId: ws(), role: { $in: roles } }).toArray()) ids.add(String(m.userId))
  return [...ids]
}

/** Moves every open ticket in this workspace that ran out of time to its next level. Returns how many moved. */
export async function escalateDue(now = Date.now()): Promise<number> {
  const matrix = await getMatrix()
  if (!matrix.enabled) return 0
  const teams = await getTeams()
  // Waiting on the customer stops the clocks, so it never escalates.
  const open = await tickets().find({ workspaceId: ws(), status: 'open' }).toArray()
  let moved = 0
  for (const t of open) {
    const levels = matrix.levels[t.priority as Priority] ?? []
    const current = Number(t.escalationLevel ?? 0)
    const clock = {
      // A reopened ticket's clocks start at the reopen.
      createdAt: +(t.clockStartAt ?? t.createdAt),
      firstResponseDueAt: +t.firstResponseDueAt,
      resolveDueAt: +t.resolveDueAt,
      firstRespondedAt: t.firstRespondedAt ? +t.firstRespondedAt : null,
      status: t.status as 'open' | 'pending',
    }
    const next = nextEscalation(clock, levels, current, now)
    if (!next) continue
    const level = levels[next - 1]
    const set: Obj = { escalationLevel: next, escalatedAt: new Date(now), updatedAt: new Date(now) }
    if (level.raisePriority) {
      const raised = raise(t.priority as Priority)
      if (raised !== t.priority) {
        // New targets count from when the clock started, the same as changing the priority by hand.
        Object.assign(set, { priority: raised, ...duesFrom((t.clockStartAt ?? t.createdAt) as Date, raised, await getSettings(), Number(t.pausedMs ?? 0)) })
      }
    }
    let movedTo: Team | null = null
    if (level.reassignTeamId) {
      movedTo = teams.find((x) => x.id === level.reassignTeamId) ?? null
      if (movedTo) Object.assign(set, { teamId: movedTo.id, assigneeId: await pickInTeam(movedTo) })
    }
    const notifyIds = await recipients({ ...t, ...set }, level.notify, teams)
    // Only one sweep wins a level, so nobody hears about it twice.
    const r = await tickets().updateOne(
      { _id: t._id, ...(current ? { escalationLevel: current } : { $or: [{ escalationLevel: { $exists: false } }, { escalationLevel: 0 }] }) },
      { $set: set, $push: { escalations: { level: next, at: new Date(now), reason: describeLevel(level), notify: notifyIds, ...(movedTo && { teamId: movedTo.id }) } } as never },
    )
    if (!r.modifiedCount) continue
    moved++
    if (movedTo) await conversations().updateOne({ workspaceId: ws(), phone: t.phone }, { $set: { assigneeId: set.assigneeId ?? null } })
    const what = [describeLevel(level).toLowerCase(), level.raisePriority && `priority raised to ${String(set.priority)}`, movedTo && `moved to ${movedTo.name}`].filter(Boolean).join(', ')
    await addMessage({ phone: String(t.phone), direction: 'out', author: 'system', kind: 'event', body: `Ticket #${t.number} escalated to level ${next}: ${what}.`, at: new Date(now) })
    trace('ticket.escalated', { number: t.number, level: next, notified: notifyIds.length }, { entity: 'ticket', id: String(t.number) })
    if (level.email && !t.sample) {
      const people = await col('users').find({ _id: { $in: notifyIds } as never }).toArray()
      const who = customerLabel(String(t.phone))
      for (const p of people) await mail.escalated(String(p.email), { number: Number(t.number), level: next, reason: describeLevel(level), customer: who, subject: String(t.subject) }).catch(() => {})
    }
  }
  return moved
}

let lastSweep = 0
/** Runs the escalation sweep in every workspace that turned it on. Throttled to once a minute per process. */
export async function escalateAll(force = false) {
  if (!db || (!force && Date.now() - lastSweep < 55_000)) return 0
  lastSweep = Date.now()
  let n = 0
  for (const m of await matrixCol().find({ 'matrix.enabled': true }).toArray()) {
    const id = String(m.workspaceId)
    n += await withWorkspace(id, () => escalateDue(), await assetsFor(id)).catch((err) => {
      console.log(`escalation sweep (${id}):`, err instanceof Error ? err.message : err)
      return 0
    })
  }
  return n
}

// ---- routes (under /api/support/, from tickets.ts) ----
const needManage = (me: Actor) => {
  if (!can(me.role, 'settings.manage')) throw new HttpError(403, 'Only owners and admins can change how work is routed.')
}
const bad = (err: unknown): never => {
  throw new HttpError(400, err instanceof Error ? err.message : String(err))
}

/** Answers the routes this module owns; undefined for anything else. */
export async function supportOpsRoute(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null

  if (path === '/api/support/teams' && m === 'GET') return getTeams()
  if (path === '/api/support/teams' && m === 'POST') {
    needManage(me)
    let t: Omit<Team, 'id'>
    try {
      t = parseTeam(await readJson(req), await memberIds())
    } catch (err) {
      return bad(err)
    }
    const id = randomUUID()
    await teamsCol().insertOne({ _id: id as never, workspaceId: ws(), ...t, createdAt: new Date() })
    trace('team.created', { name: t.name, members: t.memberIds.length }, { entity: 'team', id })
    return { id, ...t }
  }
  if ((seg = path.match(/^\/api\/support\/teams\/([\w-]{1,64})$/))) {
    needManage(me)
    const where = { _id: seg[1] as never, workspaceId: ws() }
    const before = await teamsCol().findOne(where)
    if (!before) throw new HttpError(404, 'That team no longer exists.')
    const ref = { entity: 'team', id: seg[1] }
    if (m === 'PUT') {
      let t: Omit<Team, 'id'>
      try {
        t = parseTeam(await readJson(req), await memberIds())
      } catch (err) {
        return bad(err)
      }
      await teamsCol().updateOne(where, { $set: { ...t, updatedAt: new Date() } })
      trace('team.updated', { name: t.name }, ref, diff(before, t))
      return { id: seg[1], ...t }
    }
    if (m === 'DELETE') {
      const used = (await getRules()).find((r) => r.then.some((a) => a.do === 'assignTeam' && a.teamId === seg![1]))
      if (used) throw new HttpError(409, `The rule “${used.name}” sends tickets to this team. Change the rule first.`)
      await teamsCol().deleteOne(where)
      await tickets().updateMany({ workspaceId: ws(), teamId: seg[1] }, { $set: { teamId: null } })
      await forgetTeam(seg[1])
      trace('team.deleted', { name: String(before.name) }, ref)
      return { ok: true }
    }
  }

  if (path === '/api/support/agents' && m === 'GET') {
    const [ps, counts, teams] = await Promise.all([profiles(), openCounts(), getTeams()])
    return ps.map((p) => ({ ...p, open: counts.get(p.userId) ?? 0, teamIds: teams.filter((t) => t.memberIds.includes(p.userId)).map((t) => t.id) }))
  }
  if ((seg = path.match(/^\/api\/support\/agents\/([0-9a-f-]{36})$/)) && m === 'PUT') {
    const b = obj(await readJson(req))
    const self = seg[1] === me._id
    const set: Obj = {}
    if (b.availability !== undefined) {
      if (!self && !can(me.role, 'tickets.reassign')) throw new HttpError(403, 'Only supervisors and up set someone else’s availability.')
      if (!['online', 'away', 'offline'].includes(String(b.availability))) throw new HttpError(400, 'Availability must be online, away or offline.')
      set.availability = b.availability
    }
    if (b.skills !== undefined || b.maxOpen !== undefined) {
      needManage(me)
      if (b.skills !== undefined) set.skills = (Array.isArray(b.skills) ? b.skills : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      if (b.maxOpen !== undefined) {
        const n = b.maxOpen === null || b.maxOpen === '' ? null : Math.round(Number(b.maxOpen))
        if (n !== null && !(n >= 1 && n <= 500)) throw new HttpError(400, 'The limit must be between 1 and 500 open tickets, or empty for no limit.')
        set.maxOpen = n
      }
    }
    const before = await memberships().findOne({ workspaceId: ws(), userId: seg[1] })
    if (!before) throw new HttpError(404, 'That person isn’t in this workspace.')
    await memberships().updateOne({ workspaceId: ws(), userId: seg[1] }, { $set: set })
    const changes = diff(before, set)
    if (changes) trace('member.updated', {}, { entity: 'member', id: seg[1] }, changes)
    return { ok: true }
  }

  if (path === '/api/support/rules' && m === 'GET') return getRules()
  if (path === '/api/support/rules' && m === 'PUT') {
    needManage(me)
    let rules: Rule[]
    try {
      rules = parseRules(await readJson(req), { teams: new Set((await getTeams()).map((t) => t.id)), members: await memberIds() })
    } catch (err) {
      return bad(err)
    }
    await rulesCol().updateOne({ workspaceId: ws() }, { $set: { rules, updatedAt: new Date(), updatedBy: me._id } }, { upsert: true })
    trace('settings.updated', { area: 'routing_rules', count: rules.length })
    return rules
  }

  if (path === '/api/support/escalation' && m === 'GET') return getMatrix()
  if (path === '/api/support/escalation' && m === 'PUT') {
    needManage(me)
    let matrix: EscalationMatrix
    try {
      matrix = parseMatrix(await readJson(req), new Set((await getTeams()).map((t) => t.id)))
    } catch (err) {
      return bad(err)
    }
    await matrixCol().updateOne({ workspaceId: ws() }, { $set: { matrix, updatedAt: new Date(), updatedBy: me._id } }, { upsert: true })
    trace('settings.updated', { area: 'escalation', enabled: matrix.enabled })
    return matrix
  }
  return undefined
}
