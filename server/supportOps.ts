// Who handles what: teams, each person's skills, limit and availability, routing rules for new
// tickets, and the escalation matrix that raises tickets running out of time. The decisions
// themselves are pure and shared with the settings screens (src/app/support/routing.ts).
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { HttpError, type Obj, obj, readJson } from './http.ts'
import { col, db, withWorkspace, ws } from './db.ts'
import { assetsFor } from './accounts.ts'
import { trace } from './trace.ts'
import { isOpen } from './businessHours.ts'
import { mail } from './mail.ts'
import { customerLabel } from '../src/app/lib/customer.ts'
import { can } from '../src/app/lib/permissions.ts'
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
  type AgentProfile,
  type Availability,
  type EscalationMatrix,
  type Facts,
  type Priority,
  type Rule,
  type Team,
  type TicketSource,
} from '../src/app/support/routing.ts'
import type { Actor } from './inbox.ts'
import { addMessage, conversations, currentNumber } from './inbox.ts'
import { getSettings } from './tickets.ts'

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
    const old = (await getSettings()).teams
    if (old.length) {
      const now = new Date()
      await teamsCol()
        .insertMany(old.map((t) => ({ _id: t.id as never, workspaceId: ws(), name: t.name, description: '', leadId: null, memberIds: t.memberIds, assign: 'round_robin', createdAt: now })))
        .catch(() => {}) // another request moved them first
      rows = await teamsCol().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()
    }
  }
  return rows.map(teamOut)
}

export async function getRules(): Promise<Rule[]> {
  return ((await rulesCol().findOne({ workspaceId: ws() }))?.rules as Rule[] | undefined) ?? []
}

export async function getMatrix(): Promise<EscalationMatrix> {
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

// ---- routing a new ticket ----
export interface Routed {
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
  const teams = await getTeams()
  const base = { priority, tags: a.tags, rule: rule?.name ?? null }
  if (a.target.kind === 'user') return { ...base, assigneeId: a.target.userId, teamId: null }
  if (a.target.kind === 'none') return { ...base, assigneeId: null, teamId: null }
  if (a.target.kind === 'team') {
    const team = teams.find((t) => t.id === (a.target as { teamId: string }).teamId)
    if (team) return { ...base, assigneeId: await pickInTeam(team, a.target.skill), teamId: team.id }
  }
  // No rule decided: the workspace default.
  if (s.routing.mode === 'fixed') return { ...base, assigneeId: s.routing.userId, teamId: null }
  if (s.routing.mode === 'unassigned') return { ...base, assigneeId: null, teamId: null }
  const team = s.routing.teamId ? teams.find((t) => t.id === s.routing.teamId) : null
  if (team) return { ...base, assigneeId: await pickInTeam(team), teamId: team.id }
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
  const open = await tickets().find({ workspaceId: ws(), status: OPEN }).toArray()
  let moved = 0
  for (const t of open) {
    const levels = matrix.levels[t.priority as Priority] ?? []
    const current = Number(t.escalationLevel ?? 0)
    const clock = {
      createdAt: +t.createdAt,
      firstResponseDueAt: +t.firstResponseDueAt,
      resolveDueAt: +t.resolveDueAt,
      firstRespondedAt: t.firstRespondedAt ? +t.firstRespondedAt : null,
      status: t.status as 'open' | 'pending',
    }
    const next = nextEscalation(clock, levels, current, now)
    if (!next) continue
    const level = levels[next - 1]
    const set: Obj = { escalationLevel: next, escalatedAt: new Date(now), updatedAt: new Date(now) }
    if (level.raisePriority) set.priority = raise(t.priority as Priority)
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
    trace('team.created', { members: t.memberIds.length })
    return { id, ...t }
  }
  if ((seg = path.match(/^\/api\/support\/teams\/([\w-]{1,64})$/))) {
    needManage(me)
    const where = { _id: seg[1] as never, workspaceId: ws() }
    if (!(await teamsCol().findOne(where))) throw new HttpError(404, 'That team no longer exists.')
    if (m === 'PUT') {
      let t: Omit<Team, 'id'>
      try {
        t = parseTeam(await readJson(req), await memberIds())
      } catch (err) {
        return bad(err)
      }
      await teamsCol().updateOne(where, { $set: { ...t, updatedAt: new Date() } })
      return { id: seg[1], ...t }
    }
    if (m === 'DELETE') {
      const used = (await getRules()).find((r) => r.then.some((a) => a.do === 'assignTeam' && a.teamId === seg![1]))
      if (used) throw new HttpError(409, `The rule “${used.name}” sends tickets to this team. Change the rule first.`)
      await teamsCol().deleteOne(where)
      await tickets().updateMany({ workspaceId: ws(), teamId: seg[1] }, { $set: { teamId: null } })
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
    const r = await memberships().updateOne({ workspaceId: ws(), userId: seg[1] }, { $set: set })
    if (!r.matchedCount) throw new HttpError(404, 'That person isn’t in this workspace.')
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
