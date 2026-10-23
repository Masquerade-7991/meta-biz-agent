// What a summary report shows, as data: its KPI tiles and its tables (columns typed, so the screen,
// the print view and the CSV format them the same way). Pure, so the server's CSVs use it too.
import { change, dayLabel, hm, money, num, pct, pointChange } from '../analytics/format.ts'
import { csatScore, median, type Kpi, type MetricId, type Overview } from '../analytics/types.ts'
import type { ReportId } from './catalog.ts'

export type Grain = 'day' | 'week' | 'month'
/** `period`: a YYYY-MM-DD day (or a week's Monday, a month's 1st), shown by the table's grain. */
export type ColKind = 'text' | 'period' | 'count' | 'rate' | 'minutes' | 'money'
export type Row = Record<string, string | number | null>

export interface Col {
  key: string
  label: string
  kind: ColKind
  /** A rate's numerator and denominator in the row: it rolls up and totals as their sums (weighted). */
  ratio?: [string, string]
  /** How a column rolls up into weeks/months and into the total: `sum` (counts, money), `median` (of the
   *  rows, so a week's median first reply is the median of its days), `last` (a level at the period's end). */
  agg?: 'sum' | 'median' | 'last'
}

export interface Breakdown {
  id: string
  label: string
  columns: Col[]
  rows: Row[]
  /** The table is by time: it has a Day · Week · Month switch and a Change column. */
  byTime?: boolean
  /** The column the Change column follows. */
  changeKey?: string
  /** Totals that come from the whole period rather than the rows (a true median, a KPI). */
  total?: Row
}

export interface Tile {
  metric: MetricId
  value: string
  change: number | null
  unit: '%' | 'pts'
  trend?: (number | null)[]
  /** A small tag beside the label: spend for the whole account, or a number that's about now. */
  tag?: 'Whole account' | 'now'
  sub?: string
}

// ---- reading a row ----
export function cellValue(row: Row, c: Col): number | string | null {
  if (c.ratio) {
    const n = Number(row[c.ratio[0]] ?? 0)
    const d = Number(row[c.ratio[1]] ?? 0)
    return d ? n / d : null
  }
  return row[c.key] ?? null
}

/** Sorted by one column; empty cells always last, whichever the direction. */
export function sortRows(rows: Row[], c: Col, dir: 'asc' | 'desc') {
  const k = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = cellValue(a, c)
    const y = cellValue(b, c)
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * k
  })
}

const sum = (rows: Row[], key: string) => rows.reduce((a, r) => a + Number(r[key] ?? 0), 0)

/** One row folding many: sums for counts and money, ratio parts summed, medians of the rows, the last level. */
function fold(rows: Row[], columns: Col[]): Row {
  const out: Row = {}
  for (const c of columns) {
    if (c.ratio) for (const k of c.ratio) out[k] = sum(rows, k)
    else if (c.agg === 'sum') out[c.key] = sum(rows, c.key)
    else if (c.agg === 'median') out[c.key] = median(rows.map((r) => r[c.key]).filter((v): v is number => typeof v === 'number'))
    else if (c.agg === 'last') out[c.key] = rows.at(-1)?.[c.key] ?? null
  }
  return out
}

/** The table's Total row: folded from the rows, then the whole period's own figures on top. */
export const totalRow = (b: Breakdown): Row => ({ ...fold(b.rows, b.columns), ...b.total })

/** The start of the week (Monday) or month a day falls in. */
export function periodOf(day: string, grain: Grain) {
  if (grain === 'month') return day.slice(0, 8) + '01'
  if (grain === 'week') {
    const d = new Date(day + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  }
  return day
}

/** Day rows (`period` in `date`) rolled up into weeks or months. */
export function rollUp(rows: Row[], columns: Col[], grain: Grain): Row[] {
  if (grain === 'day') return rows
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const p = periodOf(String(r.date), grain)
    groups.set(p, [...(groups.get(p) ?? []), r])
  }
  return [...groups].map(([date, rs]) => ({ date, ...fold(rs, columns) }))
}

/** Each row's change against the row before it (the previous day, week or month), as a fraction. */
export function changes(rows: Row[], c: Col): (number | null)[] {
  return rows.map((r, i) => {
    if (!i) return null
    const v = cellValue(r, c)
    const p = cellValue(rows[i - 1], c)
    return typeof v === 'number' && typeof p === 'number' ? change({ value: v, prev: p }) : null
  })
}

// ---- formatting ----
export function periodLabel(day: string, grain: Grain) {
  if (grain === 'month') return new Date(day + 'T00:00').toLocaleDateString([], { month: 'short', year: 'numeric' })
  if (grain === 'week') return `Week of ${new Date(day + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })}`
  return dayLabel(day)
}

export function formatCell(v: number | string | null, c: Col, currency: string | null, grain: Grain = 'day') {
  if (v == null) return '–'
  if (typeof v === 'string') return c.kind === 'period' ? periodLabel(v, grain) : v
  if (c.kind === 'rate') return pct(v)
  if (c.kind === 'minutes') return hm(v)
  if (c.kind === 'money') return money(v, currency)
  return num(v)
}

/** A column's header: a rolled-up median says it's the median of the days. */
export const colLabel = (c: Col, grain: Grain) => (c.agg === 'median' && grain !== 'day' ? `${c.label} (median of days)` : c.label)

/** The table as CSV cells: numbers stay numbers (Excel sums them), rates as percents, the unit in the header. */
export function csvOf(b: Breakdown, currency: string | null) {
  const unit = (c: Col) => (c.kind === 'rate' ? ' (%)' : c.kind === 'minutes' ? ' (minutes)' : c.kind === 'money' && currency ? ` (${currency})` : '')
  const r = (v: number) => Math.round(v * 100) / 100
  return {
    columns: b.columns.map((c) => c.label + unit(c)),
    rows: b.rows.map((row) =>
      b.columns.map((c) => {
        const v = cellValue(row, c)
        return typeof v !== 'number' ? v : c.kind === 'rate' ? Math.round(v * 1000) / 10 : r(v)
      }),
    ),
  }
}

// ---- the reports ----
const count = (key: string, label: string): Col => ({ key, label, kind: 'count', agg: 'sum' })
const rate = (key: string, label: string, n: string, d: string): Col => ({ key, label, kind: 'rate', ratio: [n, d] })
const cash = (key: string, label: string): Col => ({ key, label, kind: 'money', agg: 'sum' })
const mins = (key: string, label: string): Col => ({ key, label, kind: 'minutes', agg: 'median' })
const DATE: Col = { key: 'date', label: 'Date', kind: 'period' }

/** The Overview's days as rows, with the parts every rate is made of. */
export function dayRows(o: Overview): Row[] {
  return o.series.map((p) => {
    const rated = p.csatGood + p.csatOkay + p.csatBad
    return {
      date: p.date,
      conversations: p.conversations,
      aiOnly: p.aiOnly,
      withTeam: p.withTeam,
      noReply: p.noReply,
      handoffs: p.handoffs,
      ticketsOpened: p.ticketsOpened,
      ticketsResolved: p.ticketsResolved,
      onTime: p.slaMet == null ? 0 : Math.round(p.slaMet * p.ticketsResolved),
      backlog: p.backlog,
      firstReply: p.medianFirstReplyMin,
      good: p.csatGood,
      okay: p.csatOkay,
      bad: p.csatBad,
      rated,
      // csatScore: okay counts half.
      csatN: p.csatGood + p.csatOkay * 0.5,
      escalations: p.escalations,
      spend: p.spend,
      agentCost: p.agentCost,
      allSpend: p.spend + p.agentCost,
    }
  })
}

const kpiTile = (metric: MetricId, k: Kpi, kind: 'count' | 'rate' | 'minutes' | 'money', o: Overview, extra: Partial<Tile> = {}): Tile => ({
  metric,
  value: kind === 'rate' ? pct(k.value) : kind === 'minutes' ? hm(k.value) : kind === 'money' ? money(k.value, o.currency) : num(k.value),
  change: kind === 'rate' ? pointChange(k) : change(k),
  unit: kind === 'rate' ? 'pts' : '%',
  ...extra,
})
const noPrev = (value: number | null): Kpi => ({ value, prev: null })
const trendOf = (o: Overview, f: (p: Overview['series'][number]) => number | null) => o.series.map(f)
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}% of conversations` : undefined)

export interface Summary {
  tiles: Tile[]
  tables: Breakdown[]
}

/** One summary report: its tiles and tables, from the Overview. */
export function summaryOf(id: ReportId, o: Overview): Summary {
  const k = o.kpis
  const days = dayRows(o)
  const t = (key: string) => sum(days, key)
  const spendTag = o.spendWholeAccount ? ({ tag: 'Whole account' } as const) : {}
  const byTime = (columns: Col[], changeKey: string, total: Row = {}): Breakdown => ({ id: 'time', label: 'By time', columns: [DATE, ...columns], rows: days, byTime: true, changeKey, total })
  switch (id) {
    case 'business_review':
      return {
        tiles: [
          kpiTile('conversations', k.conversations, 'count', o, { trend: trendOf(o, (p) => p.conversations) }),
          kpiTile('containment', k.containment, 'rate', o, { trend: trendOf(o, (p) => p.containment) }),
          kpiTile('csat', k.csat, 'rate', o),
          kpiTile('slaMet', k.slaMet, 'rate', o, { trend: trendOf(o, (p) => p.slaMet) }),
          kpiTile('medianFirstReplyMin', k.medianFirstReplyMin, 'minutes', o, { trend: trendOf(o, (p) => p.medianFirstReplyMin) }),
          kpiTile('spend', k.spend, 'money', o, { ...spendTag, trend: trendOf(o, (p) => p.spend + p.agentCost) }),
          kpiTile('costPerResolved', k.costPerResolved, 'money', o, spendTag),
        ],
        tables: [
          byTime(
            [count('conversations', 'Conversations'), rate('containment', 'AI alone', 'aiOnly', 'conversations'), rate('csat', 'Satisfaction', 'csatN', 'rated'), rate('slaMet', 'Resolved on time', 'onTime', 'ticketsResolved'), mins('firstReply', 'Median first reply'), cash('allSpend', 'Spend')],
            'conversations',
            { firstReply: k.medianFirstReplyMin.value },
          ),
        ],
      }
    case 'ai_agent': {
      const agents = o.byAgent.map((a) => ({
        agent: a.label,
        conversations: a.conversations,
        aiOnly: a.containment == null ? 0 : Math.round(a.containment * a.conversations),
        handoffs: a.handoffs,
        csat: a.csat,
        agentCost: a.agentCost,
      }))
      return {
        tiles: [
          kpiTile('containment', k.containment, 'rate', o, { trend: trendOf(o, (p) => p.containment) }),
          kpiTile('handoffRate', k.handoffRate, 'rate', o),
          kpiTile('noReply', noPrev(t('conversations') ? t('noReply') / t('conversations') : null), 'rate', o),
          kpiTile('csat', k.csat, 'rate', o),
          kpiTile('agentCost', noPrev(t('agentCost')), 'money', o, { trend: trendOf(o, (p) => p.agentCost) }),
        ],
        tables: [
          {
            id: 'agents',
            label: 'By agent',
            columns: [{ key: 'agent', label: 'Agent', kind: 'text' }, count('conversations', 'Conversations'), rate('containment', 'AI alone', 'aiOnly', 'conversations'), count('handoffs', 'Handovers'), { key: 'csat', label: 'Satisfaction', kind: 'rate' }, cash('agentCost', 'Agent cost')],
            rows: agents,
            total: { csat: k.csat.value },
          },
        ],
      }
    }
    case 'conversations': {
      const c = t('conversations')
      return {
        tiles: [
          kpiTile('conversations', k.conversations, 'count', o, { trend: trendOf(o, (p) => p.conversations) }),
          kpiTile('aiOnly', { value: t('aiOnly'), prev: k.containment.prev == null || k.conversations.prev == null ? null : Math.round(k.containment.prev * k.conversations.prev) }, 'count', o, { sub: share(t('aiOnly'), c) }),
          kpiTile('withTeam', noPrev(t('withTeam')), 'count', o, { sub: share(t('withTeam'), c) }),
          kpiTile('noReply', noPrev(t('noReply')), 'count', o, { sub: share(t('noReply'), c) }),
        ],
        tables: [byTime([count('conversations', 'Conversations'), count('aiOnly', 'AI alone'), count('withTeam', 'With the team'), count('noReply', 'No reply'), rate('containment', 'AI alone (%)', 'aiOnly', 'conversations'), count('handoffs', 'Handovers')], 'conversations')],
      }
    }
    case 'team':
      return {
        tiles: [
          kpiTile('ticketsResolved', k.ticketsResolved, 'count', o, { trend: trendOf(o, (p) => p.ticketsResolved) }),
          kpiTile('medianFirstReplyMin', k.medianFirstReplyMin, 'minutes', o),
          kpiTile('medianResolveMin', k.medianResolveMin, 'minutes', o),
          kpiTile('csat', k.csat, 'rate', o),
          kpiTile('openNow', noPrev(k.openNow), 'count', o, { tag: 'now' }),
        ],
        tables: [
          {
            id: 'people',
            label: 'People',
            columns: [{ key: 'name', label: 'Person', kind: 'text' }, count('resolved', 'Resolved'), count('open', 'Open now'), mins('firstReply', 'Median first reply'), { key: 'csat', label: 'Satisfaction', kind: 'rate' }, count('escalated', 'Escalated')],
            rows: o.people.map((p) => ({ name: p.name, resolved: p.resolved, open: p.open, firstReply: p.medianFirstReplyMin, csat: p.csat, escalated: p.escalated })),
            total: { firstReply: k.medianFirstReplyMin.value, csat: k.csat.value },
          },
          {
            id: 'teams',
            label: 'Teams',
            columns: [{ key: 'name', label: 'Team', kind: 'text' }, count('opened', 'Opened'), count('resolved', 'Resolved'), { key: 'slaMet', label: 'Resolved on time', kind: 'rate' }, count('escalated', 'Escalated')],
            rows: o.teams.map((x) => ({ name: x.name, opened: x.opened, resolved: x.resolved, slaMet: x.slaMet, escalated: x.escalated })),
            total: { slaMet: k.slaMet.value },
          },
        ],
      }
    case 'response_sla':
      return {
        tiles: [
          kpiTile('medianFirstReplyMin', k.medianFirstReplyMin, 'minutes', o, { trend: trendOf(o, (p) => p.medianFirstReplyMin) }),
          kpiTile('medianResolveMin', k.medianResolveMin, 'minutes', o),
          kpiTile('slaMet', k.slaMet, 'rate', o, { trend: trendOf(o, (p) => p.slaMet) }),
          kpiTile('overdueNow', noPrev(k.overdueNow), 'count', o, { tag: 'now' }),
          kpiTile('escalations', k.escalations, 'count', o, { trend: trendOf(o, (p) => p.escalations) }),
        ],
        tables: [
          byTime(
            [count('ticketsOpened', 'Tickets opened'), count('ticketsResolved', 'Tickets resolved'), rate('slaMet', 'Resolved on time', 'onTime', 'ticketsResolved'), mins('firstReply', 'Median first reply'), count('escalations', 'Escalations'), { key: 'backlog', label: 'Open at the end', kind: 'count', agg: 'last' }],
            'ticketsOpened',
            { firstReply: k.medianFirstReplyMin.value },
          ),
        ],
      }
    case 'csat':
      return {
        tiles: [
          kpiTile('csat', k.csat, 'rate', o, { trend: trendOf(o, (p) => csatScore(p.csatGood, p.csatOkay, p.csatBad)) }),
          kpiTile('ratings', noPrev(t('rated')), 'count', o),
          kpiTile('good', noPrev(t('good')), 'count', o),
          kpiTile('okay', noPrev(t('okay')), 'count', o),
          kpiTile('bad', noPrev(t('bad')), 'count', o),
        ],
        tables: [
          byTime([count('rated', 'Ratings'), count('good', 'Good'), count('okay', 'Okay'), count('bad', 'Bad'), rate('csat', 'Satisfaction', 'csatN', 'rated')], 'rated'),
          {
            id: 'people',
            label: 'By person',
            columns: [{ key: 'name', label: 'Person', kind: 'text' }, count('resolved', 'Resolved'), { key: 'csat', label: 'Satisfaction', kind: 'rate' }],
            rows: o.people.map((p) => ({ name: p.name, resolved: p.resolved, csat: p.csat })),
            total: { csat: k.csat.value },
          },
        ],
      }
    case 'spend': {
      const c = o.consumption
      const budget = c.budget.monthly ? c.budget.spentThisMonth / c.budget.monthly : null
      return {
        tiles: [
          kpiTile('whatsappSpend', noPrev(t('spend')), 'money', o, { ...spendTag, trend: trendOf(o, (p) => p.spend) }),
          kpiTile('agentCost', noPrev(t('agentCost')), 'money', o, { trend: trendOf(o, (p) => p.agentCost) }),
          kpiTile('costPerResolved', k.costPerResolved, 'money', o, spendTag),
          { metric: 'budgetUsed', value: pct(budget), change: null, unit: '%', ...(budget != null && { sub: `${money(c.budget.spentThisMonth, o.currency)} of ${money(c.budget.monthly, o.currency)} this month` }) },
        ],
        tables: [
          {
            id: 'categories',
            label: 'WhatsApp messages',
            columns: [{ key: 'category', label: 'Category', kind: 'text' }, count('volume', 'Messages'), cash('cost', 'Cost')],
            rows: c.byCategory.map((x) => ({ category: x.category.charAt(0) + x.category.slice(1).toLowerCase().replace(/_/g, ' '), volume: x.volume, cost: x.cost })),
          },
          {
            id: 'ai',
            label: 'AI usage',
            columns: [{ key: 'item', label: 'Item', kind: 'text' }, count('replies', 'Replies'), count('tokens', 'Tokens'), cash('cost', 'Cost')],
            rows: [
              { item: 'Meta Business Agent', replies: c.agent.billableMessages, tokens: c.agent.tokens, cost: c.agent.cost },
              { item: 'Console writing help', replies: null, tokens: c.assist.tokens, cost: null },
            ],
          },
        ],
      }
    }
  }
  return { tiles: [], tables: [] }
}
