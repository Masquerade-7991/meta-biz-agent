// The central Analytics page: one answer for all agents together or any subset, with the period
// before for comparison, and paginated logs behind the charts. Computed straight from the stored
// rows (messages, tickets, Meta's insights, charges, usage) at request time; a workspace's volume
// keeps this to a handful of indexed aggregations. Days are in the support hours' time zone.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, obj, serveJson } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import { currentAssets } from './context.ts'
import { accounts } from './accounts.ts'
import { getSettings } from './tickets.ts'
import { getTeams } from './supportOps.ts'
import { can } from '../src/app/lib/permissions.ts'
import { customerLabel } from '../src/app/lib/customer.ts'
import type { Actor } from './inbox.ts'
import {
  addDays,
  csatScore,
  dayList,
  daysBetween,
  FREE_SERVICE_MESSAGES,
  isoDay,
  LOG_KINDS,
  median,
  type AgentRow,
  type AnalyticsFilter,
  type DayPoint,
  type Kpi,
  type LogKind,
  type LogPage,
  type Overview,
} from '../src/app/analytics/types.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const OPEN = ['open', 'pending']
const MAX_DAYS = 366

/** The instant a local day starts in `tz`. */
export function dayStart(day: string, tz: string) {
  const utc = Date.parse(day + 'T00:00:00Z')
  // The zone's offset at that moment: local wall time read back as if it were UTC, minus UTC.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utc)).map((p) => [p.type, p.value]))
  const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
  return new Date(utc - (wall - utc))
}

export function parseFilter(u: URL, tz: string): AnalyticsFilter {
  const today = isoDay(new Date(), tz)
  const to = u.searchParams.get('to') || today
  const from = u.searchParams.get('from') || addDays(to, -29)
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw new HttpError(400, 'from and to must be dates (YYYY-MM-DD), from not after to.')
  if (daysBetween(from, to) > MAX_DAYS) throw new HttpError(400, `Pick ${MAX_DAYS} days or fewer.`)
  const list = (k: string) => (u.searchParams.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const numbers = list('numbers').filter((id) => currentAssets()?.ids.has(id))
  return { from, to, numbers, team: u.searchParams.get('team') || null, person: u.searchParams.get('person') || null }
}

/** Rows for the chosen numbers. Rows without a number predate stamping and belong to the default number. */
function byNumber(f: AnalyticsFilter, field = 'phoneNumberId'): Obj {
  if (!f.numbers.length) return {}
  const def = currentAssets()?.phoneNumberId
  return { $or: [{ [field]: { $in: f.numbers } }, ...(def && f.numbers.includes(def) ? [{ [field]: null }] : [])] }
}
const numberOf = (v: unknown) => (v ? String(v) : (currentAssets()?.phoneNumberId ?? 'default'))

/** The workspace's agents: one per connected number, named after the agent or the number. */
async function agentList() {
  const nums = (await accounts().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()).flatMap((a) => a.phoneNumbers)
  const names = new Map((await col('agents').find({ workspaceId: ws(), deletedAt: { $exists: false } }).toArray()).map((a) => [String(a._id), String(a.displayName ?? '')]))
  return nums.map((n) => ({ id: n.id, label: names.get(n.id) || n.verifiedName || n.display || 'WhatsApp number' }))
}

interface Period {
  conversations: number
  aiOnly: number
  ticketsOpened: number
  ticketsResolved: number
  resolvedOnTime: number
  firstReplies: number[]
  resolveTimes: number[]
  csat: { good: number; okay: number; bad: number }
  handoffs: number
  escalations: number
  spend: number
  agentCost: number
}

async function ticketRows(f: AnalyticsFilter, start: Date, end: Date) {
  const where: Obj = {
    workspaceId: ws(),
    createdAt: { $lt: end },
    $and: [{ $or: [{ status: { $in: OPEN } }, { resolvedAt: { $gte: start } }] }, ...(f.numbers.length ? [byNumber(f)] : [])],
  }
  if (f.team) where.teamId = f.team === 'none' ? null : f.team
  if (f.person) where.assigneeId = f.person === 'none' ? null : f.person
  return col('tickets').find(where).toArray()
}

async function period(f: AnalyticsFilter, tz: string, from: string, to: string): Promise<Period & { series?: DayPoint[]; tickets: Obj[] }> {
  const start = dayStart(from, tz)
  const end = dayStart(addDays(to, 1), tz)
  const inRange = (d: unknown) => !!d && +(d as Date) >= +start && +(d as Date) < +end
  const mins = (a: unknown, b: unknown) => (+(b as Date) - +(a as Date)) / 60_000

  // Chats: a chat counts on each day it had messages; with the team if a person wrote that day.
  const chatDays = await col('messages')
    .aggregate([
      { $match: { workspaceId: ws(), at: { $gte: start, $lt: end }, kind: { $ne: 'note' }, ...byNumber(f) } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: tz } }, phone: '$phone' }, team: { $max: { $cond: [{ $eq: ['$author', 'agent'] }, 1, 0] } } } },
    ])
    .toArray()
  const chats = new Map<string, number>()
  for (const r of chatDays) chats.set(String(r._id.phone), Math.max(chats.get(String(r._id.phone)) ?? 0, Number(r.team)))

  const tickets = await ticketRows(f, start, end)
  const opened = tickets.filter((t) => inRange(t.createdAt))
  const resolved = tickets.filter((t) => t.status === 'resolved' && inRange(t.resolvedAt))
  const responded = tickets.filter((t) => inRange(t.firstRespondedAt))
  const rated = resolved.filter((t) => t.csat)
  const score = (n: number) => rated.filter((t) => Number(obj(t.csat).score) === n).length
  const escalationsIn = tickets.flatMap((t) => ((t.escalations as Obj[] | undefined) ?? []).filter((e) => inRange(e.at)))

  const spendRows = await col('spend_daily').aggregate([{ $match: { workspaceId: ws(), day: { $gte: from, $lte: to } } }, { $group: { _id: '$day', cost: { $sum: '$cost' } } }]).toArray()
  const agentRows = await col('agent_usage')
    .aggregate([
      { $match: { workspaceId: ws(), start: { $gte: start, $lt: end }, ...(f.numbers.length && { phoneNumberId: { $in: f.numbers } }) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$start', timezone: tz } }, cost: { $sum: '$cost' } } },
    ])
    .toArray()

  const totals: Period = {
    conversations: chats.size,
    aiOnly: [...chats.values()].filter((x) => !x).length,
    ticketsOpened: opened.length,
    ticketsResolved: resolved.length,
    resolvedOnTime: resolved.filter((t) => +t.resolvedAt <= +t.resolveDueAt).length,
    firstReplies: responded.map((t) => mins(t.createdAt, t.firstRespondedAt)),
    resolveTimes: resolved.map((t) => mins(t.createdAt, t.resolvedAt)),
    csat: { good: score(3), okay: score(2), bad: score(1) },
    handoffs: opened.filter((t) => t.source === 'handoff').length,
    escalations: escalationsIn.length,
    spend: spendRows.reduce((a, r) => a + Number(r.cost), 0),
    agentCost: agentRows.reduce((a, r) => a + Number(r.cost), 0),
  }

  const days = dayList(from, to)
  const dayOf = (d: unknown) => isoDay(d as Date, tz)
  const count = <T>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
    return m
  }
  const chatsByDay = count(chatDays, (r) => String(r._id.day))
  const openedBy = count(opened, (t) => dayOf(t.createdAt))
  const resolvedBy = count(resolved, (t) => dayOf(t.resolvedAt))
  const respondedBy = count(responded, (t) => dayOf(t.firstRespondedAt))
  const escBy = count(escalationsIn, (e) => dayOf(e.at))
  const spendBy = new Map(spendRows.map((r) => [String(r._id), Number(r.cost)]))
  const agentBy = new Map(agentRows.map((r) => [String(r._id), Number(r.cost)]))
  const series = days.map((date): DayPoint => {
    const dayEnd = +dayStart(addDays(date, 1), tz)
    const c = chatsByDay.get(date) ?? []
    const team = c.filter((r) => r.team).length
    const res = resolvedBy.get(date) ?? []
    const rd = res.filter((t) => t.csat)
    const sc = (n: number) => rd.filter((t) => Number(obj(t.csat).score) === n).length
    return {
      date,
      conversations: c.length,
      aiOnly: c.length - team,
      withTeam: team,
      handoffs: (openedBy.get(date) ?? []).filter((t) => t.source === 'handoff').length,
      ticketsOpened: openedBy.get(date)?.length ?? 0,
      ticketsResolved: res.length,
      backlog: tickets.filter((t) => +t.createdAt < dayEnd && (!t.resolvedAt || +t.resolvedAt >= dayEnd)).length,
      containment: c.length ? (c.length - team) / c.length : null,
      slaMet: res.length ? res.filter((t) => +t.resolvedAt <= +t.resolveDueAt).length / res.length : null,
      medianFirstReplyMin: median((respondedBy.get(date) ?? []).map((t) => mins(t.createdAt, t.firstRespondedAt))),
      csatGood: sc(3),
      csatOkay: sc(2),
      csatBad: sc(1),
      escalations: escBy.get(date)?.length ?? 0,
      spend: spendBy.get(date) ?? 0,
      agentCost: agentBy.get(date) ?? 0,
    }
  })
  return { ...totals, series, tickets }
}

const kpi = (value: number | null, prev: number | null): Kpi => ({ value, prev })
const ratio = (a: number, b: number) => (b ? a / b : null)

export async function overview(f: AnalyticsFilter): Promise<Overview> {
  const s = await getSettings()
  const tz = s.hours.timezone
  const n = daysBetween(f.from, f.to)
  const prevTo = addDays(f.from, -1)
  const prevFrom = addDays(prevTo, -(n - 1))
  const [cur, prev, agents, teams] = await Promise.all([period(f, tz, f.from, f.to), period(f, tz, prevFrom, prevTo), agentList(), getTeams()])
  const start = dayStart(f.from, tz)
  const end = dayStart(addDays(f.to, 1), tz)
  const now = Date.now()

  const heatRows = await col('messages')
    .aggregate([
      { $match: { workspaceId: ws(), at: { $gte: start, $lt: end }, author: 'customer', ...byNumber(f) } },
      { $group: { _id: { d: { $isoDayOfWeek: { date: '$at', timezone: tz } }, h: { $hour: { date: '$at', timezone: tz } } }, n: { $sum: 1 } } },
    ])
    .toArray()
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const r of heatRows) heatmap[Number(r._id.d) - 1][Number(r._id.h)] = Number(r.n)

  // Per agent (number): chats, AI alone, handoffs, satisfaction, cost, service replies.
  const perChat = await col('messages')
    .aggregate([
      { $match: { workspaceId: ws(), at: { $gte: start, $lt: end }, kind: { $ne: 'note' } } },
      { $group: { _id: { n: '$phoneNumberId', phone: '$phone' }, team: { $max: { $cond: [{ $eq: ['$author', 'agent'] }, 1, 0] } } } },
    ])
    .toArray()
  const allTickets = await ticketRows({ ...f, numbers: [] }, start, end)
  const agentCost = await col('agent_usage').aggregate([{ $match: { workspaceId: ws(), start: { $gte: start, $lt: end } } }, { $group: { _id: '$phoneNumberId', cost: { $sum: '$cost' } } }]).toArray()
  const monthStart = dayStart(isoDay(new Date(), tz).slice(0, 8) + '01', tz)
  const service = await col('message_charges')
    .aggregate([
      { $match: { workspaceId: ws(), at: { $gte: monthStart }, category: 'service', status: { $in: ['sent', 'delivered', 'read'] } } },
      { $group: { _id: { n: '$phoneNumberId', m: '$waMessageId' } } },
      { $group: { _id: '$_id.n', used: { $sum: 1 } } },
    ])
    .toArray()
  const serviceBy = new Map(service.map((r) => [numberOf(r._id), Number(r.used)]))
  const byAgent: AgentRow[] = agents
    .filter((a) => !f.numbers.length || f.numbers.includes(a.id))
    .map((a) => {
      const chats = perChat.filter((r) => numberOf(r._id.n) === a.id)
      const team = chats.filter((r) => r.team).length
      const ts = allTickets.filter((t) => numberOf(t.phoneNumberId) === a.id)
      const rated = ts.filter((t) => t.csat && +(t.resolvedAt as Date) >= +start)
      const sc = (k: number) => rated.filter((t) => Number(obj(t.csat).score) === k).length
      return {
        id: a.id,
        label: a.label,
        conversations: chats.length,
        containment: ratio(chats.length - team, chats.length),
        handoffs: ts.filter((t) => t.source === 'handoff' && +(t.createdAt as Date) >= +start).length,
        csat: csatScore(sc(3), sc(2), sc(1)),
        agentCost: Number(agentCost.find((r) => String(r._id) === a.id)?.cost ?? 0),
        serviceMessages: serviceBy.get(a.id) ?? 0,
      }
    })

  // People and teams (ticket metrics, honouring the team/person filter).
  const tk = cur.tickets
  const users = new Map((await col('users').find({ _id: { $in: [...new Set(tk.map((t) => t.assigneeId).filter(Boolean))] } as never }).toArray()).map((u) => [String(u._id), String(u.name ?? 'Someone')]))
  const inRange = (d: unknown) => !!d && +(d as Date) >= +start && +(d as Date) < +end
  const groupBy = (key: (t: Obj) => string | null) => {
    const m = new Map<string, Obj[]>()
    for (const t of tk) {
      const k = key(t) ?? 'none'
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return m
  }
  const people = [...groupBy((t) => (t.assigneeId ? String(t.assigneeId) : null))].map(([id, ts]) => {
    const res = ts.filter((t) => t.status === 'resolved' && inRange(t.resolvedAt))
    const rated = res.filter((t) => t.csat)
    const sc = (k: number) => rated.filter((t) => Number(obj(t.csat).score) === k).length
    return {
      id,
      name: id === 'none' ? 'Unassigned' : (users.get(id) ?? 'Someone'),
      resolved: res.length,
      open: ts.filter((t) => OPEN.includes(String(t.status))).length,
      medianFirstReplyMin: median(ts.filter((t) => inRange(t.firstRespondedAt)).map((t) => (+(t.firstRespondedAt as Date) - +(t.createdAt as Date)) / 60_000)),
      csat: csatScore(sc(3), sc(2), sc(1)),
      escalated: ts.filter((t) => Number(t.escalationLevel ?? 0) > 0).length,
    }
  })
  const teamRows = [...groupBy((t) => (t.teamId ? String(t.teamId) : null))].map(([id, ts]) => {
    const res = ts.filter((t) => t.status === 'resolved' && inRange(t.resolvedAt))
    return {
      id,
      name: id === 'none' ? 'No team' : (teams.find((x) => x.id === id)?.name ?? 'Deleted team'),
      opened: ts.filter((t) => inRange(t.createdAt)).length,
      resolved: res.length,
      slaMet: ratio(res.filter((t) => +(t.resolvedAt as Date) <= +(t.resolveDueAt as Date)).length, res.length),
      escalated: ts.filter((t) => Number(t.escalationLevel ?? 0) > 0).length,
    }
  })
  const levels = new Map<number, number>()
  for (const t of tk) for (const e of (t.escalations as Obj[] | undefined) ?? []) if (inRange(e.at)) levels.set(Number(e.level), (levels.get(Number(e.level)) ?? 0) + 1)
  const SOURCE: Record<string, string> = { handoff: 'AI handed over', takeover: 'Someone took over', reply: 'Team replied', manual: 'Created by hand' }
  const sources = new Map<string, number>()
  for (const t of tk) if (inRange(t.createdAt)) sources.set(SOURCE[String(t.source)] ?? 'Other', (sources.get(SOURCE[String(t.source)] ?? 'Other') ?? 0) + 1)

  // Meta's tool insights (metrics_daily, collectors.ts), weighted by threads.
  const phones = f.numbers.length ? f.numbers : agents.map((a) => a.id)
  const toolDocs = await col('metrics_daily')
    .find({ 'meta.phoneNumberId': { $in: phones }, 'meta.metric': 'tool_calls', ts: { $gte: new Date(f.from + 'T00:00:00Z'), $lte: new Date(f.to + 'T00:00:00Z') } })
    .toArray()
    .catch(() => [])
  const toolAgg = new Map<string, { threads: number; s: number; e: number; t: number; lat: number; latN: number }>()
  for (const d of toolDocs)
    for (const r of (d.rows as Obj[] | undefined) ?? []) {
      const k = String(r.tool)
      const a = toolAgg.get(k) ?? { threads: 0, s: 0, e: 0, t: 0, lat: 0, latN: 0 }
      const w = Number(r.threads) || 0
      a.threads += w
      a.s += (Number(r.successRate) || 0) * w
      a.e += (Number(r.errorRate) || 0) * w
      a.t += (Number(r.timeoutRate) || 0) * w
      if (typeof r.avgLatencyMs === 'number') {
        a.lat += r.avgLatencyMs * w
        a.latN += w
      }
      toolAgg.set(k, a)
    }
  const tools = [...toolAgg].map(([tool, a]) => ({ tool, threads: a.threads, successRate: ratio(a.s, a.threads), errorRate: ratio(a.e, a.threads), timeoutRate: ratio(a.t, a.threads), avgLatencyMs: a.latN ? a.lat / a.latN : null })).sort((x, z) => z.threads - x.threads)

  // Consumption.
  const billing = await col('billing').findOne({ workspaceId: ws() })
  const byCategory = await col('spend_daily').aggregate([{ $match: { workspaceId: ws(), day: { $gte: f.from, $lte: f.to } } }, { $group: { _id: '$category', volume: { $sum: '$volume' }, cost: { $sum: '$cost' } } }, { $sort: { cost: -1 } }]).toArray()
  const [agentUse] = await col('agent_usage')
    .aggregate([{ $match: { workspaceId: ws(), start: { $gte: start, $lt: end }, ...(f.numbers.length && { phoneNumberId: { $in: f.numbers } }) } }, { $group: { _id: null, m: { $sum: '$billableMessages' }, tk: { $sum: '$billableTokens' }, c: { $sum: '$cost' } } }])
    .toArray()
  const state = await col('agent_usage_state').findOne({ workspaceId: ws() }, { sort: { checkedAt: -1 } })
  const [assist] = await col('ai_usage').aggregate([{ $match: { workspaceId: ws(), day: { $gte: f.from, $lte: f.to } } }, { $group: { _id: null, tk: { $sum: { $add: ['$input', '$output'] } }, calls: { $sum: '$calls' } } }]).toArray()
  const [month] = await col('spend_daily').aggregate([{ $match: { workspaceId: ws(), day: { $gte: isoDay(new Date(), 'UTC').slice(0, 8) + '01' } } }, { $group: { _id: null, c: { $sum: '$cost' } } }]).toArray()

  const [b] = await col('broadcast_recipients')
    .aggregate([
      { $match: { workspaceId: ws(), sentAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: null,
          sent: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $ifNull: ['$repliedAt', false] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
    ])
    .toArray()

  const openTickets = await col('tickets').find({ workspaceId: ws(), status: { $in: OPEN }, ...byNumber(f) }, { projection: { firstRespondedAt: 1, firstResponseDueAt: 1, resolveDueAt: 1 } }).toArray()
  const overdue = openTickets.filter((t) => +(t.firstRespondedAt ? t.resolveDueAt : t.firstResponseDueAt) < now).length
  const available = await col('memberships').countDocuments({ workspaceId: ws(), $or: [{ availability: 'online' }, { availability: { $exists: false } }] })
  const csatOf = (p: Period) => csatScore(p.csat.good, p.csat.okay, p.csat.bad)

  return {
    range: { from: f.from, to: f.to, days: n, timezone: tz, prevFrom, prevTo },
    currency: (billing?.currency as string | undefined) ?? null,
    agents,
    kpis: {
      conversations: kpi(cur.conversations, prev.conversations),
      containment: kpi(ratio(cur.aiOnly, cur.conversations), ratio(prev.aiOnly, prev.conversations)),
      resolutionRate: kpi(ratio(cur.ticketsResolved, cur.ticketsOpened), ratio(prev.ticketsResolved, prev.ticketsOpened)),
      csat: kpi(csatOf(cur), csatOf(prev)),
      handoffs: kpi(cur.handoffs, prev.handoffs),
      ticketsOpened: kpi(cur.ticketsOpened, prev.ticketsOpened),
      ticketsResolved: kpi(cur.ticketsResolved, prev.ticketsResolved),
      medianFirstReplyMin: kpi(median(cur.firstReplies), median(prev.firstReplies)),
      medianResolveMin: kpi(median(cur.resolveTimes), median(prev.resolveTimes)),
      slaMet: kpi(ratio(cur.resolvedOnTime, cur.ticketsResolved), ratio(prev.resolvedOnTime, prev.ticketsResolved)),
      escalations: kpi(cur.escalations, prev.escalations),
      spend: kpi(cur.spend + cur.agentCost, prev.spend + prev.agentCost),
      costPerResolved: kpi(ratio(cur.spend + cur.agentCost, cur.ticketsResolved + cur.aiOnly), ratio(prev.spend + prev.agentCost, prev.ticketsResolved + prev.aiOnly)),
      openNow: openTickets.length,
      overdueNow: overdue,
      peopleAvailable: available,
    },
    series: cur.series!,
    heatmap,
    byAgent,
    people: people.sort((a, z) => z.resolved - a.resolved),
    teams: teamRows.sort((a, z) => z.opened - a.opened),
    escalationsByLevel: [...levels].map(([level, count]) => ({ level, count })).sort((a, z) => a.level - z.level),
    handoffReasons: [...sources].map(([label, count]) => ({ label, count })).sort((a, z) => z.count - a.count),
    tools,
    consumption: {
      byCategory: byCategory.map((r) => ({ category: String(r._id ?? 'UNKNOWN'), volume: Number(r.volume), cost: Number(r.cost) })),
      serviceFreeTier: agents.map((a) => ({ id: a.id, label: a.label, used: serviceBy.get(a.id) ?? 0, free: FREE_SERVICE_MESSAGES })),
      agent: { billableMessages: Number(agentUse?.m ?? 0), tokens: Number(agentUse?.tk ?? 0), cost: Number(agentUse?.c ?? 0), state: (state?.state as string | undefined) ?? null },
      assist: { tokens: Number(assist?.tk ?? 0), calls: Number(assist?.calls ?? 0) },
      budget: { monthly: Number(billing?.budget) || null, spentThisMonth: Number(month?.c ?? 0) },
    },
    broadcasts: { sent: Number(b?.sent ?? 0), delivered: Number(b?.delivered ?? 0), read: Number(b?.read ?? 0), replied: Number(b?.replied ?? 0), failed: Number(b?.failed ?? 0) },
  }
}

// ---- logs: the rows behind the charts, for tables and CSV ----
const fmt = (d: unknown, tz: string) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d as Date) : null)
const minsBetween = (a: unknown, b: unknown) => (a && b ? Math.round((+(b as Date) - +(a as Date)) / 60_000) : null)

export async function logPage(kind: LogKind, f: AnalyticsFilter, skip: number, limit: number): Promise<LogPage> {
  const tz = (await getSettings()).hours.timezone
  const start = dayStart(f.from, tz)
  const end = dayStart(addDays(f.to, 1), tz)
  const names = async (ids: unknown[]) => new Map((await col('users').find({ _id: { $in: [...new Set(ids.filter(Boolean))] } as never }).toArray()).map((u) => [String(u._id), String(u.name ?? '')]))
  const contacts = async (phones: unknown[]) => new Map((await col('contacts').find({ workspaceId: ws(), phone: { $in: [...new Set(phones.map(String))] } }).toArray()).map((c) => [String(c.phone), String(c.name ?? '')]))
  const who = (m: Map<string, string>, phone: unknown) => m.get(String(phone)) || customerLabel(String(phone))

  if (kind === 'tickets' || kind === 'handovers' || kind === 'escalations') {
    const where: Obj = { workspaceId: ws(), ...byNumber(f) }
    if (f.team) where.teamId = f.team === 'none' ? null : f.team
    if (f.person) where.assigneeId = f.person === 'none' ? null : f.person
    if (kind === 'escalations') where.escalations = { $elemMatch: { at: { $gte: start, $lt: end } } }
    else where.createdAt = { $gte: start, $lt: end }
    if (kind === 'handovers') where.source = { $in: ['handoff', 'takeover'] }
    const total = await col('tickets').countDocuments(where)
    const rows = await col('tickets').find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray()
    const [people, cust, teams] = await Promise.all([names(rows.map((t) => t.assigneeId)), contacts(rows.map((t) => t.phone)), getTeams()])
    const team = (id: unknown) => teams.find((t) => t.id === id)?.name ?? null
    if (kind === 'escalations') {
      const flat = rows.flatMap((t) =>
        ((t.escalations as Obj[] | undefined) ?? [])
          .filter((e) => +(e.at as Date) >= +start && +(e.at as Date) < +end)
          .map((e) => ({ at: fmt(e.at, tz), ticket: `#${t.number}`, customer: who(cust, t.phone), priority: String(t.priority), level: Number(e.level), reason: String(e.reason), notified: ((e.notify as string[]) ?? []).length, team: team(e.teamId ?? t.teamId) })),
      )
      return {
        kind,
        total,
        columns: [
          { key: 'at', label: 'When' },
          { key: 'ticket', label: 'Ticket' },
          { key: 'customer', label: 'Customer' },
          { key: 'priority', label: 'Priority' },
          { key: 'level', label: 'Level', numeric: true },
          { key: 'reason', label: 'Why' },
          { key: 'notified', label: 'People alerted', numeric: true },
          { key: 'team', label: 'Team' },
        ],
        rows: flat,
      }
    }
    if (kind === 'handovers')
      return {
        kind,
        total,
        columns: [
          { key: 'at', label: 'Handed over' },
          { key: 'ticket', label: 'Ticket' },
          { key: 'customer', label: 'Customer' },
          { key: 'how', label: 'How' },
          { key: 'to', label: 'Picked up by' },
          { key: 'team', label: 'Team' },
          { key: 'firstReplyMin', label: 'Minutes to first reply', numeric: true },
          { key: 'status', label: 'Status' },
        ],
        rows: rows.map((t) => ({
          at: fmt(t.createdAt, tz),
          ticket: `#${t.number}`,
          customer: who(cust, t.phone),
          how: t.source === 'handoff' ? 'AI handed over' : 'Someone took over',
          to: t.assigneeId ? (people.get(String(t.assigneeId)) ?? 'Someone') : 'Nobody yet',
          team: team(t.teamId),
          firstReplyMin: minsBetween(t.createdAt, t.firstRespondedAt),
          status: String(t.status),
        })),
      }
    return {
      kind,
      total,
      columns: [
        { key: 'ticket', label: 'Ticket' },
        { key: 'subject', label: 'Subject' },
        { key: 'customer', label: 'Customer' },
        { key: 'team', label: 'Team' },
        { key: 'assignee', label: 'Assignee' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'opened', label: 'Opened' },
        { key: 'firstReplyMin', label: 'Minutes to first reply', numeric: true },
        { key: 'resolveMin', label: 'Minutes to resolve', numeric: true },
        { key: 'sla', label: 'SLA' },
        { key: 'level', label: 'Escalation level', numeric: true },
        { key: 'csat', label: 'CSAT' },
      ],
      rows: rows.map((t) => ({
        ticket: `#${t.number}`,
        subject: String(t.subject ?? ''),
        customer: who(cust, t.phone),
        team: team(t.teamId),
        assignee: t.assigneeId ? (people.get(String(t.assigneeId)) ?? 'Someone') : null,
        priority: String(t.priority),
        status: String(t.status),
        opened: fmt(t.createdAt, tz),
        firstReplyMin: minsBetween(t.createdAt, t.firstRespondedAt),
        resolveMin: minsBetween(t.createdAt, t.resolvedAt),
        sla: t.status !== 'resolved' ? (+(t.firstRespondedAt ? t.resolveDueAt : t.firstResponseDueAt) < Date.now() ? 'Overdue' : 'Running') : +t.resolvedAt <= +t.resolveDueAt ? 'Met' : 'Missed',
        level: Number(t.escalationLevel ?? 0),
        csat: t.csat ? String(obj(t.csat).label) : null,
      })),
    }
  }
  if (kind === 'charges') {
    const where: Obj = { workspaceId: ws(), at: { $gte: start, $lt: end }, ...byNumber(f) }
    const total = await col('message_charges').countDocuments(where)
    const rows = await col('message_charges').find(where).sort({ at: -1 }).skip(skip).limit(limit).toArray()
    const cust = await contacts(rows.map((r) => r.phone))
    const labels = new Map((await agentList()).map((a) => [a.id, a.label]))
    return {
      kind,
      total,
      columns: [
        { key: 'at', label: 'When' },
        { key: 'agent', label: 'Agent' },
        { key: 'customer', label: 'Customer' },
        { key: 'category', label: 'Category' },
        { key: 'type', label: 'Pricing type' },
        { key: 'billable', label: 'Billable' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((r) => ({
        at: fmt(r.at, tz),
        agent: labels.get(numberOf(r.phoneNumberId)) ?? null,
        customer: who(cust, r.phone),
        category: (r.category as string | null) ?? null,
        type: (r.type as string | null) ?? null,
        billable: r.billable ? 'Yes' : 'No',
        status: String(r.status),
      })),
    }
  }
  // agent_usage
  const where: Obj = { workspaceId: ws(), start: { $gte: start, $lt: end }, ...(f.numbers.length && { phoneNumberId: { $in: f.numbers } }) }
  const total = await col('agent_usage').countDocuments(where)
  const rows = await col('agent_usage').find(where).sort({ start: -1 }).skip(skip).limit(limit).toArray()
  const labels = new Map((await agentList()).map((a) => [a.id, a.label]))
  return {
    kind,
    total,
    columns: [
      { key: 'hour', label: 'Hour' },
      { key: 'agent', label: 'Agent' },
      { key: 'messages', label: 'Billable messages', numeric: true },
      { key: 'tokens', label: 'Billable tokens', numeric: true },
      { key: 'cost', label: 'Cost', numeric: true },
    ],
    rows: rows.map((r) => ({ hour: fmt(r.start, tz), agent: labels.get(String(r.phoneNumberId)) ?? null, messages: Number(r.billableMessages ?? 0), tokens: Number(r.billableTokens ?? 0), cost: Number(r.cost ?? 0) })),
  }
}

// ---- routes ----
async function route(u: URL, me: Actor): Promise<unknown> {
  if (!can(me.role, 'reports.view')) throw new HttpError(403, 'Analytics are for supervisors, admins and owners.')
  const f = parseFilter(u, (await getSettings()).hours.timezone)
  if (u.pathname === '/api/analytics/overview') return overview(f)
  const m = u.pathname.match(/^\/api\/analytics\/logs\/([a-z_]+)$/)
  if (m) {
    if (!LOG_KINDS.includes(m[1] as LogKind)) throw new HttpError(404, `No log called ${m[1]}.`)
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? 50)))
    const skip = Math.max(0, Number(u.searchParams.get('skip') ?? 0))
    return logPage(m[1] as LogKind, f, skip, limit)
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the filters', 403: 'Not allowed', 404: 'Not found' }
/** /api/analytics/overview and /api/analytics/logs/{kind}. The older per-agent trend routes stay in store.ts. */
export async function handleAnalytics(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (u.pathname !== '/api/analytics/overview' && !u.pathname.startsWith('/api/analytics/logs/')) return false
  if ((req.method ?? 'GET') !== 'GET') return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Analytics need the database.' } }, () => route(u, me))
}
