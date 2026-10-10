// Dummy mode's Analytics: three sample agents with believable, repeatable numbers for any period,
// so every chart, filter and log on the page can be tried without a server or a Meta token.
import { MetaError } from '../api/meta'
import {
  addDays,
  csatScore,
  dayList,
  daysBetween,
  FREE_SERVICE_MESSAGES,
  LOG_KINDS,
  median,
  type AgentRow,
  type AnalyticsFilter,
  type DayPoint,
  type LogKind,
  type LogPage,
  type Overview,
} from './types'

const AGENTS = [
  { id: 'demo-agent-store', label: 'Helo Store assistant', scale: 1 },
  { id: 'demo-agent-pharmacy', label: 'Pharmacy helpdesk', scale: 0.55 },
  { id: 'demo-agent-travel', label: 'Travel desk', scale: 0.32 },
]
const TEAMS = [
  { id: 'team-billing', name: 'Billing', share: 0.4 },
  { id: 'team-care', name: 'Customer care', share: 0.6 },
]
const PEOPLE = [
  { id: 'demo', name: 'Demo User', share: 0.42 },
  { id: 'demo-2', name: 'Riya Mehta', share: 0.36 },
  { id: 'demo-3', name: 'Arjun Das', share: 0.22 },
]
const CUSTOMERS = ['Priya Sharma', 'Rahul Verma', 'Ananya Iyer', 'Vikram Singh', 'Meera Nair', 'Karan Patel', 'Sneha Rao', 'Arjun Kapoor', 'Divya Menon', 'Rohan Gupta']

/** 0–1, the same every time for the same key. */
function rand(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10_000) / 10_000
}

interface Cell {
  conversations: number
  aiOnly: number
  handoffs: number
  opened: number
  resolved: number
  onTime: number
  firstReply: number
  good: number
  okay: number
  bad: number
  escalations: number
  spend: number
  agentCost: number
  tokens: number
  billable: number
  service: number
}

function cell(agent: (typeof AGENTS)[number], day: string): Cell {
  const r = (k: string) => rand(`${agent.id}|${day}|${k}`)
  const dow = new Date(day + 'T12:00:00Z').getUTCDay()
  const weekday = dow === 0 ? 0.55 : dow === 6 ? 0.75 : 1
  const trend = 1 + (Date.parse(day) - Date.parse('2026-07-01')) / (86_400_000 * 400) // slow growth
  const conversations = Math.round((60 + r('c') * 40) * weekday * agent.scale * trend)
  const aiOnly = Math.round(conversations * (0.76 + r('a') * 0.14))
  const team = conversations - aiOnly
  const opened = Math.round(team * (0.85 + r('o') * 0.15))
  const resolved = Math.round(opened * (0.82 + r('r') * 0.2))
  const rated = Math.round(resolved * (0.3 + r('q') * 0.2))
  const good = Math.round(rated * (0.6 + r('g') * 0.2))
  const bad = Math.round((rated - good) * (0.2 + r('b') * 0.3))
  return {
    conversations,
    aiOnly,
    handoffs: Math.round(opened * 0.72),
    opened,
    resolved,
    onTime: Math.round(resolved * (0.78 + r('s') * 0.18)),
    firstReply: 6 + r('f') * 28,
    good,
    okay: rated - good - bad,
    bad,
    escalations: Math.round(opened * r('e') * 0.18),
    spend: Math.round(conversations * (0.75 + r('p') * 0.4) * 100) / 100,
    agentCost: Math.round(aiOnly * 3.9 * (0.9 + r('k') * 0.2)) / 100,
    tokens: Math.round(aiOnly * (20_000 + r('t') * 5_000)),
    billable: aiOnly,
    service: Math.round(team * 2.4),
  }
}

const scaleFor = (f: AnalyticsFilter) => (f.team ? (TEAMS.find((t) => t.id === f.team)?.share ?? 0.1) : 1) * (f.person ? (PEOPLE.find((p) => p.id === f.person)?.share ?? 0.1) : 1)
const pick = (f: AnalyticsFilter) => AGENTS.filter((a) => !f.numbers.length || f.numbers.includes(a.id))

function sumDay(f: AnalyticsFilter, day: string): Cell {
  const out = cell({ id: 'none', label: '', scale: 0 }, day)
  for (const k of Object.keys(out) as (keyof Cell)[]) out[k] = 0
  const share = scaleFor(f)
  for (const a of pick(f)) {
    const c = cell(a, day)
    for (const k of Object.keys(c) as (keyof Cell)[]) out[k] += c[k]
  }
  // Team and person filters narrow the ticket numbers only.
  for (const k of ['opened', 'resolved', 'onTime', 'good', 'okay', 'bad', 'escalations', 'handoffs'] as const) out[k] = Math.round(out[k] * share)
  out.firstReply = out.firstReply / Math.max(1, pick(f).length)
  return out
}

function totals(f: AnalyticsFilter, from: string, to: string) {
  const days = dayList(from, to).map((d) => sumDay(f, d))
  const t = (k: keyof Cell) => days.reduce((a, c) => a + c[k], 0)
  return { days, t, firstReply: median(days.filter((d) => d.opened).map((d) => d.firstReply)) }
}

export function dummyOverview(f: AnalyticsFilter): Overview {
  const n = daysBetween(f.from, f.to)
  const prevTo = addDays(f.from, -1)
  const prevFrom = addDays(prevTo, -(n - 1))
  const cur = totals(f, f.from, f.to)
  const prev = totals(f, prevFrom, prevTo)
  const ratio = (a: number, b: number) => (b ? a / b : null)
  const k = (c: (x: typeof cur) => number | null) => ({ value: c(cur), prev: c(prev) })
  let backlog = 14
  const series: DayPoint[] = dayList(f.from, f.to).map((date, i) => {
    const c = cur.days[i]
    backlog = Math.max(0, backlog + c.opened - c.resolved)
    return {
      date,
      conversations: c.conversations,
      aiOnly: c.aiOnly,
      withTeam: c.conversations - c.aiOnly,
      handoffs: c.handoffs,
      ticketsOpened: c.opened,
      ticketsResolved: c.resolved,
      backlog,
      containment: ratio(c.aiOnly, c.conversations),
      slaMet: ratio(c.onTime, c.resolved),
      medianFirstReplyMin: c.opened ? c.firstReply : null,
      csatGood: c.good,
      csatOkay: c.okay,
      csatBad: c.bad,
      escalations: c.escalations,
      spend: c.spend,
      agentCost: c.agentCost,
    }
  })
  const heatmap = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const busy = h >= 9 && h <= 21 ? 1 - Math.abs(h - 14) / 9 : 0.04
      return Math.round(cur.t('conversations') * 0.012 * busy * (d >= 5 ? 0.6 : 1) * (0.7 + rand(`h${d}${h}`) * 0.6))
    }),
  )
  const byAgent: AgentRow[] = pick(f).map((a) => {
    const t = totals({ ...f, numbers: [a.id] }, f.from, f.to).t
    return {
      id: a.id,
      label: a.label,
      conversations: t('conversations'),
      containment: ratio(t('aiOnly'), t('conversations')),
      handoffs: t('handoffs'),
      csat: csatScore(t('good'), t('okay'), t('bad')),
      agentCost: Math.round(t('agentCost') * 100) / 100,
      serviceMessages: Math.round(t('service') * 0.33),
    }
  })
  const opened = cur.t('opened')
  const resolved = cur.t('resolved')
  const spend = cur.t('spend') + cur.t('agentCost')
  return {
    range: { from: f.from, to: f.to, days: n, timezone: 'Asia/Kolkata', prevFrom, prevTo },
    currency: 'INR',
    agents: AGENTS.map(({ id, label }) => ({ id, label })),
    kpis: {
      conversations: k((x) => x.t('conversations')),
      containment: k((x) => ratio(x.t('aiOnly'), x.t('conversations'))),
      resolutionRate: k((x) => ratio(x.t('resolved'), x.t('opened'))),
      csat: k((x) => csatScore(x.t('good'), x.t('okay'), x.t('bad'))),
      handoffs: k((x) => x.t('handoffs')),
      ticketsOpened: k((x) => x.t('opened')),
      ticketsResolved: k((x) => x.t('resolved')),
      medianFirstReplyMin: k((x) => x.firstReply),
      medianResolveMin: k((x) => (x.firstReply ?? 0) * 11),
      slaMet: k((x) => ratio(x.t('onTime'), x.t('resolved'))),
      escalations: k((x) => x.t('escalations')),
      spend: k((x) => x.t('spend') + x.t('agentCost')),
      costPerResolved: k((x) => ratio(x.t('spend') + x.t('agentCost'), x.t('resolved') + x.t('aiOnly'))),
      openNow: series.at(-1)?.backlog ?? 0,
      overdueNow: Math.round((series.at(-1)?.backlog ?? 0) * 0.2),
      peopleAvailable: 2,
    },
    series,
    heatmap,
    byAgent,
    people: PEOPLE.filter((p) => !f.person || p.id === f.person).map((p) => ({
      id: p.id,
      name: p.name,
      resolved: Math.round(resolved * p.share),
      open: Math.round(5 * p.share * 3),
      medianFirstReplyMin: (cur.firstReply ?? 15) * (0.7 + p.share),
      csat: 0.72 + rand(p.id) * 0.2,
      escalated: Math.round(cur.t('escalations') * p.share),
    })),
    teams: TEAMS.filter((t) => !f.team || t.id === f.team).map((t) => ({ id: t.id, name: t.name, opened: Math.round(opened * t.share), resolved: Math.round(resolved * t.share), slaMet: 0.8 + rand(t.id) * 0.15, escalated: Math.round(cur.t('escalations') * t.share) })),
    escalationsByLevel: [
      { level: 1, count: Math.round(cur.t('escalations') * 0.7) },
      { level: 2, count: Math.round(cur.t('escalations') * 0.22) },
      { level: 3, count: Math.round(cur.t('escalations') * 0.08) },
    ],
    handoffReasons: [
      { label: 'AI handed over', count: cur.t('handoffs') },
      { label: 'Someone took over', count: Math.round(opened * 0.18) },
      { label: 'Team replied', count: Math.round(opened * 0.08) },
      { label: 'Created by hand', count: Math.round(opened * 0.02) },
    ],
    tools: [
      { tool: 'order_status', threads: Math.round(cur.t('aiOnly') * 0.34), successRate: 0.96, errorRate: 0.03, timeoutRate: 0.01, avgLatencyMs: 820 },
      { tool: 'track_shipment', threads: Math.round(cur.t('aiOnly') * 0.21), successRate: 0.91, errorRate: 0.05, timeoutRate: 0.04, avgLatencyMs: 1460 },
      { tool: 'book_appointment', threads: Math.round(cur.t('aiOnly') * 0.08), successRate: 0.87, errorRate: 0.11, timeoutRate: 0.02, avgLatencyMs: 1120 },
      { tool: 'refund_request', threads: Math.round(cur.t('aiOnly') * 0.05), successRate: 0.78, errorRate: 0.18, timeoutRate: 0.04, avgLatencyMs: 2040 },
    ],
    consumption: {
      byCategory: [
        { category: 'MARKETING', volume: Math.round(cur.t('conversations') * 0.9), cost: Math.round(cur.t('spend') * 0.62) },
        { category: 'UTILITY', volume: Math.round(cur.t('conversations') * 0.7), cost: Math.round(cur.t('spend') * 0.2) },
        { category: 'SERVICE', volume: cur.t('service'), cost: Math.round(cur.t('spend') * 0.13) },
        { category: 'AUTHENTICATION', volume: Math.round(cur.t('conversations') * 0.1), cost: Math.round(cur.t('spend') * 0.05) },
      ],
      serviceFreeTier: AGENTS.map((a) => ({ id: a.id, label: a.label, used: Math.round(totals({ ...f, numbers: [a.id] }, addDays(f.to, -9), f.to).t('service')), free: FREE_SERVICE_MESSAGES })),
      agent: { billableMessages: cur.t('billable'), tokens: cur.t('tokens'), cost: Math.round(cur.t('agentCost') * 100) / 100, state: 'ok' },
      assist: { tokens: Math.round(cur.t('opened') * 1800), calls: Math.round(cur.t('opened') * 0.6) },
      budget: { monthly: 50_000, spentThisMonth: Math.round(spend * (10 / n)) },
    },
    broadcasts: (() => {
      const sent = Math.round(cur.t('conversations') * 0.8)
      return { sent, delivered: Math.round(sent * 0.95), read: Math.round(sent * 0.68), replied: Math.round(sent * 0.11), failed: Math.round(sent * 0.03) }
    })(),
  }
}

function dummyLogs(kind: LogKind, f: AnalyticsFilter, skip: number, limit: number): LogPage {
  const o = dummyOverview(f)
  const days = o.series
  const total =
    kind === 'tickets' ? o.kpis.ticketsOpened.value ?? 0 : kind === 'handovers' ? o.kpis.handoffs.value ?? 0 : kind === 'escalations' ? o.kpis.escalations.value ?? 0 : kind === 'charges' ? Math.min(5000, (o.kpis.conversations.value ?? 0) * 2) : days.length * 24
  const at = (i: number) => {
    const d = days[days.length - 1 - (i % days.length)]?.date ?? f.to
    const h = 9 + (i * 7) % 12
    return new Date(`${d}T${String(h).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:00`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  }
  const who = (i: number) => CUSTOMERS[i % CUSTOMERS.length]
  const person = (i: number) => PEOPLE[i % PEOPLE.length].name
  const team = (i: number) => TEAMS[i % TEAMS.length].name
  const agent = (i: number) => pick(f)[i % Math.max(1, pick(f).length)]?.label ?? AGENTS[0].label
  const rows = Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, j): LogPage['rows'][number] => {
    const i = skip + j
    const r = (k: string) => rand(`${kind}${i}${k}`)
    switch (kind) {
      case 'tickets':
        return {
          ticket: `#${4800 - i}`,
          subject: ['Where is my order?', 'Refund not received', 'Change delivery address', 'Payment failed twice', 'Need invoice copy'][i % 5],
          customer: who(i),
          team: team(i),
          assignee: person(i),
          priority: ['normal', 'high', 'normal', 'urgent', 'low'][i % 5],
          status: r('s') < 0.8 ? 'resolved' : 'open',
          opened: at(i),
          firstReplyMin: Math.round(4 + r('f') * 40),
          resolveMin: Math.round(60 + r('r') * 600),
          sla: r('m') < 0.85 ? 'Met' : 'Missed',
          level: r('l') < 0.12 ? 1 : 0,
          csat: r('c') < 0.4 ? (r('g') < 0.75 ? 'Good' : r('g') < 0.92 ? 'Okay' : 'Bad') : null,
        }
      case 'handovers':
        return { at: at(i), ticket: `#${4800 - i}`, customer: who(i), how: r('h') < 0.8 ? 'AI handed over' : 'Someone took over', to: person(i), team: team(i), firstReplyMin: Math.round(3 + r('f') * 30), status: r('s') < 0.8 ? 'resolved' : 'open' }
      case 'escalations':
        return { at: at(i), ticket: `#${4800 - i * 3}`, customer: who(i), priority: ['urgent', 'high', 'normal'][i % 3], level: r('l') < 0.7 ? 1 : r('l') < 0.92 ? 2 : 3, reason: ['First reply 75% in', 'First reply at breach', 'Resolution at breach'][i % 3], notified: 1 + (i % 3), team: team(i) }
      case 'charges':
        return { at: at(i), agent: agent(i), customer: who(i), category: ['service', 'marketing', 'utility', 'service', 'authentication'][i % 5], type: r('t') < 0.9 ? 'regular' : 'free_customer_service', billable: r('b') < 0.85 ? 'Yes' : 'No', status: ['delivered', 'read', 'sent'][i % 3] }
      default:
        return { hour: at(i), agent: agent(i), messages: Math.round(4 + r('m') * 30), tokens: Math.round((4 + r('m') * 30) * 21_000), cost: Math.round((4 + r('m') * 30) * 4.2) / 100 }
    }
  })
  const columns: Record<LogKind, LogPage['columns']> = {
    tickets: ['ticket:Ticket', 'subject:Subject', 'customer:Customer', 'team:Team', 'assignee:Assignee', 'priority:Priority', 'status:Status', 'opened:Opened', 'firstReplyMin:Minutes to first reply:n', 'resolveMin:Minutes to resolve:n', 'sla:SLA', 'level:Escalation level:n', 'csat:CSAT'].map(col),
    handovers: ['at:Handed over', 'ticket:Ticket', 'customer:Customer', 'how:How', 'to:Picked up by', 'team:Team', 'firstReplyMin:Minutes to first reply:n', 'status:Status'].map(col),
    escalations: ['at:When', 'ticket:Ticket', 'customer:Customer', 'priority:Priority', 'level:Level:n', 'reason:Why', 'notified:People alerted:n', 'team:Team'].map(col),
    charges: ['at:When', 'agent:Agent', 'customer:Customer', 'category:Category', 'type:Pricing type', 'billable:Billable', 'status:Status'].map(col),
    agent_usage: ['hour:Hour', 'agent:Agent', 'messages:Billable messages:n', 'tokens:Billable tokens:n', 'cost:Cost:n'].map(col),
  }
  return { kind, columns: columns[kind], rows, total }
}
function col(spec: string) {
  const [key, label, n] = spec.split(':')
  return { key, label, ...(n && { numeric: true }) }
}

/** Answers /api/analytics/overview and /api/analytics/logs/{kind} in dummy mode. */
export async function dummyAnalytics<T>(_method: string, path: string): Promise<T> {
  const u = new URL(path, 'http://x')
  const list = (k: string) => (u.searchParams.get(k) ?? '').split(',').filter(Boolean)
  const today = new Date().toISOString().slice(0, 10)
  const to = u.searchParams.get('to') || today
  const f: AnalyticsFilter = { from: u.searchParams.get('from') || addDays(to, -29), to, numbers: list('numbers'), team: u.searchParams.get('team'), person: u.searchParams.get('person') }
  if (u.pathname === '/api/analytics/overview') return dummyOverview(f) as T
  const m = u.pathname.match(/^\/api\/analytics\/logs\/([a-z_]+)$/)
  if (m && LOG_KINDS.includes(m[1] as LogKind)) return dummyLogs(m[1] as LogKind, f, Number(u.searchParams.get('skip') ?? 0), Number(u.searchParams.get('limit') ?? 50)) as T
  throw new MetaError(404, 'Not found', path)
}
