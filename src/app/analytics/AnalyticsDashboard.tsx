import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { PageContainer, PageHeader } from '@/app/components/ui/page'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { KpiTile } from '@/app/components/ui/kpi'
import { TimeSeriesChart } from '@/app/components/charts/TimeSeriesChart'
import { Donut } from '@/app/components/charts/Donut'
import { BarList } from '@/app/components/charts/BarList'
import { Funnel } from '@/app/components/charts/Funnel'
import { Heatmap } from '@/app/components/charts/Heatmap'
import { percent } from '@/app/components/charts/chartTheme'
import { PillTabs } from '@/app/components/Filters'
import { errorDetail } from '@/app/api/meta'
import { getLog, getOverview } from '@/app/api/overview'
import { listGaps, type Gap } from '@/app/api/assist'
import { getSupportSettings, listTeams, type Team } from '@/app/api/tickets'
import { useMembers } from '@/app/auth/useMembers'
import { cn } from '@/app/lib/utils'
import { FilterBar } from './FilterBar'
import { useAnalyticsFilter } from './useAnalyticsFilter'
import { change, dur, money, moneyShort, num, pct, pointChange } from './format'
import { csatScore, LOG_KINDS, LOG_LABEL, type LogKind, type LogPage, type Overview } from './types'
import { ReportActions } from './ReportActions'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ai', label: 'AI agent' },
  { id: 'human', label: 'Human support' },
  { id: 'consumption', label: 'Consumption' },
  { id: 'broadcasts', label: 'Broadcasts' },
  { id: 'logs', label: 'Logs' },
] as const

/** One place for every number: all agents together or any of them, the team behind them, what it all cost, and the rows behind each chart. */
export function AnalyticsDashboard() {
  const [timezone, setTimezone] = useState<string | undefined>()
  const { filter, range, set, tab } = useAnalyticsFilter(timezone)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A new filter keeps the old numbers on screen until the new ones arrive; this says they're coming.
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [teams, setTeams] = useState<Team[]>([])
  const [firstReplyTarget, setFirstReplyTarget] = useState<number | null>(null)
  const members = useMembers()
  const key = JSON.stringify(filter)

  useEffect(() => {
    listTeams().then(setTeams, () => {})
    getSupportSettings().then(
      (s) => {
        setFirstReplyTarget(s.sla.normal.firstResponse)
        setTimezone(s.hours.timezone)
      },
      () => {},
    )
  }, [])
  useEffect(() => {
    let live = true
    setError(null)
    setLoading(true)
    getOverview(filter)
      .then(
        (d) => live && setData(d),
        (err) => live && setError(errorDetail(err)),
      )
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload])

  const single = filter.numbers.length === 1 ? data?.agents.find((a) => a.id === filter.numbers[0]) : null
  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description={single ? `${single.label}: conversations, team work, cost and logs.` : 'Every agent together, or pick one. Conversations, team work, cost and the logs behind them.'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setReload((n) => n + 1)} aria-label="Refresh">
              <RefreshCw className="size-4" />
            </Button>
            <ReportActions filter={filter} />
          </>
        }
      />
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <FilterBar filter={filter} range={range} agents={data?.agents ?? []} teams={teams} people={members} onChange={set} />
        {loading && data && <div role="progressbar" aria-label="Updating" className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary" />}
      </div>
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'overview' ? null : v })}>
        <TabsList className="mb-5 flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <span>Couldn&rsquo;t load the numbers. {error}</span>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <PageLoader context="analytics" className="min-h-[40vh]" />
        ) : (
          <>
            <TabsContent value="overview">
              <OverviewTab d={data} />
            </TabsContent>
            <TabsContent value="ai">
              <AiTab d={data} />
            </TabsContent>
            <TabsContent value="human">
              <HumanTab d={data} firstReplyTarget={firstReplyTarget} />
            </TabsContent>
            <TabsContent value="consumption">
              <ConsumptionTab d={data} />
            </TabsContent>
            <TabsContent value="broadcasts">
              <BroadcastsTab d={data} />
            </TabsContent>
            <TabsContent value="logs">
              <LogsTab filter={filter} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </PageContainer>
  )
}

function Panel({ title, description, children, className, actions }: { title: string; description?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-border bg-card p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-section font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

const Grid = ({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cn('grid gap-3', cols === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : cols === 3 ? 'sm:grid-cols-3' : 'lg:grid-cols-2')}>{children}</div>
)
/** A KPI's daily values; days with nothing to measure stay empty (null), not zero. */
const trend = (d: Overview, k: keyof Overview['series'][number]) => d.series.map((p) => (p[k] == null ? null : Number(p[k])))

function OverviewTab({ d }: { d: Overview }) {
  const k = d.kpis
  const daily = d.series.map((p) => ({ ...p, csat: csatScore(p.csatGood, p.csatOkay, p.csatBad) }))
  // Containment going up while satisfaction goes down: the AI may be keeping people it should hand over.
  const warn = (pointChange(k.containment) ?? 0) > 0.02 && (pointChange(k.csat) ?? 0) < -0.02
  return (
    <div className="space-y-5">
      <Grid>
        <KpiTile label="Conversations" value={num(k.conversations.value)} change={change(k.conversations)} trend={trend(d, 'conversations')} help="Chats where the customer, the AI or the team wrote in the period. System notes alone don’t count." to="/inbox" />
        <KpiTile label="Handled by AI alone" value={pct(k.containment.value)} unit="pts" change={pointChange(k.containment)} trend={trend(d, 'containment')} help="Containment: chats the AI agent answered without anyone from the team writing. Chats nobody answered don’t count as handled." />
        <KpiTile label="Customer satisfaction" value={pct(k.csat.value)} unit="pts" change={pointChange(k.csat)} help="Good answers, with Okay counting half, out of all answers to the feedback question." />
        <KpiTile label="Tickets resolved" value={pct(k.resolutionRate.value)} unit="pts" sub={`${num(k.ticketsResolved.value)} of ${num(k.ticketsOpened.value)} opened`} change={pointChange(k.resolutionRate)} help="Resolution rate: tickets resolved in the period out of tickets opened in it." to={ticketsLink({ view: 'resolved' })} />
        <KpiTile label="Typical first reply" value={dur(k.medianFirstReplyMin.value)} change={change(k.medianFirstReplyMin)} better="down" trend={trend(d, 'medianFirstReplyMin')} help="The median: half of first replies were faster than this." />
        <KpiTile label="Resolved on time" value={pct(k.slaMet.value)} unit="pts" change={pointChange(k.slaMet)} help="Tickets resolved within their resolution target." to={ticketsLink({ view: 'overdue' })} />
        <KpiTile
          label="Spend"
          value={money(k.spend.value, d.currency)}
          change={change(k.spend)}
          better="down"
          trend={d.series.map((p) => p.spend + p.agentCost)}
          sub={d.spendWholeAccount ? 'Whole WhatsApp account' : undefined}
          help="WhatsApp messages plus the Meta Business Agent. Meta reports message spend for the whole account, not per number."
        />
        <KpiTile
          label="Cost per resolved conversation"
          value={money(k.costPerResolved.value, d.currency)}
          change={change(k.costPerResolved)}
          better="down"
          sub={d.spendWholeAccount ? 'Shown for all agents together' : undefined}
          help="Spend divided by chats the AI finished plus tickets the team resolved. Spend is per account, so this needs every agent selected."
        />
      </Grid>
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
        <Link to={ticketsLink({})} className="hover:underline">
          Right now: <strong className="tabular-nums">{k.openNow}</strong> open tickets
        </Link>
        <Link to={ticketsLink({ view: 'overdue' })} className={cn('hover:underline', k.overdueNow > 0 && 'text-destructive')}>
          <strong className="tabular-nums">{k.overdueNow}</strong> overdue
        </Link>
        <span>
          <strong className="tabular-nums">{k.peopleAvailable}</strong> people available
        </span>
        <span className="text-muted-foreground">Compared with {fmtRange(d.range.prevFrom, d.range.prevTo)}</span>
      </div>
      {warn && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          The AI is handling more chats alone while satisfaction is falling. Check the handovers and unanswered questions on the AI agent tab.
        </p>
      )}
      <Grid cols={2}>
        <Panel title="Conversations" description="Answered by the AI alone, with your team, or by nobody.">
          <TimeSeriesChart
            data={d.series}
            label="Conversations per day: by the AI alone, with the team, and with no reply"
            empty="No conversations in these dates."
            series={[
              { key: 'aiOnly', label: 'AI alone', kind: 'area', stack: 'c' },
              { key: 'withTeam', label: 'With the team', kind: 'area', stack: 'c', color: 'var(--chart-4)' },
              // Only drawn when some chat went unanswered: an empty layer would still show its edge.
              ...(d.series.some((p) => p.noReply) ? [{ key: 'noReply', label: 'No reply', kind: 'area' as const, stack: 'c', color: 'var(--chart-3)' }] : []),
            ]}
          />
        </Panel>
        <Panel title="Quality" description="Read these together: containment only helps while satisfaction holds.">
          <TimeSeriesChart
            data={daily}
            label="Containment, resolved on time and satisfaction per day"
            yFormat={percent}
            domain={[0, 1]}
            series={[
              { key: 'containment', label: 'Handled by AI alone', kind: 'line', format: percent },
              { key: 'slaMet', label: 'Resolved on time', kind: 'line', format: percent },
              { key: 'csat', label: 'Satisfaction', kind: 'line', format: percent, color: 'var(--chart-4)' },
            ]}
          />
        </Panel>
      </Grid>
      <Panel title={d.byAgent.length > 1 ? 'Agents side by side' : 'This agent'} description="Each agent answers on its own WhatsApp number.">
        {d.byAgent.length > 1 && (
          <div className="mb-4">
            <TimeSeriesChart
              data={d.byAgent}
              x="label"
              xFormat={(v) => v}
              label="Conversations and handovers per agent"
              series={[
                { key: 'conversations', label: 'Conversations' },
                { key: 'handoffs', label: 'Handed over', color: 'var(--chart-4)' },
              ]}
            />
          </div>
        )}
        <AgentTable d={d} />
      </Panel>
    </div>
  )
}

function AgentTable({ d }: { d: Overview }) {
  if (!d.byAgent.length) return <p className="text-sm text-muted-foreground">No agents yet. Connect a WhatsApp number and build its agent.</p>
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Conversations</TableHead>
            <TableHead className="text-right">AI alone</TableHead>
            <TableHead className="text-right">Handed over</TableHead>
            <TableHead className="text-right">Satisfaction</TableHead>
            <TableHead className="text-right">Agent cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.byAgent.map((a) => (
            <TableRow key={a.id} data-density-row>
              <TableCell className="font-medium">{a.label}</TableCell>
              <TableCell className="text-right tabular-nums">{num(a.conversations)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(a.containment)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(a.handoffs)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(a.csat)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(a.agentCost, d.currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AiTab({ d }: { d: Overview }) {
  const k = d.kpis
  const [gaps, setGaps] = useState<Gap[] | null>(null)
  // Unanswered questions are kept for the last 7 or 30 days, not any range: the panel says which.
  const gapDays = d.range.days > 7 ? 30 : 7
  useEffect(() => {
    listGaps(gapDays).then(setGaps, () => setGaps([]))
  }, [gapDays])
  const aiAlone = d.series.reduce((a, p) => a + p.aiOnly, 0)
  return (
    <div className="space-y-5">
      <Grid>
        <KpiTile label="Finished by the AI" value={num(aiAlone)} trend={trend(d, 'aiOnly')} />
        <KpiTile label="Containment" value={pct(k.containment.value)} unit="pts" change={pointChange(k.containment)} />
        <KpiTile label="Handovers" value={num(k.handoffs.value)} change={change(k.handoffs)} better="down" trend={trend(d, 'handoffs')} to={ticketsLink({ view: 'all' })} />
        <KpiTile label="Handover rate" value={pct(k.handoffRate.value)} unit="pts" change={pointChange(k.handoffRate)} better="down" help="Handovers out of all conversations, for the chosen agents (the team and person filters don’t apply)." />
      </Grid>
      <Grid cols={2}>
        <Panel title="Handovers per day">
          <TimeSeriesChart data={d.series} label="Handovers per day" empty="No handovers in these dates." series={[{ key: 'handoffs', label: 'Handed over', kind: 'line', color: 'var(--chart-4)' }]} />
        </Panel>
        <Panel title="How tickets opened" description="The AI handing over, someone taking over, a team reply, or the customer writing again.">
          <Donut slices={d.handoffReasons.map((r) => ({ label: r.label, value: r.count }))} label="How tickets opened" totalLabel="Tickets" empty="No tickets opened in these dates." />
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel title="Questions the AI couldn’t answer" description={`The last ${gapDays} days: answered with the fallback or handed over. Teach the agent the top ones.`}>
          {gaps === null ? <PageLoader context="analytics" className="min-h-32" /> : <BarList rows={gaps.map((g) => ({ label: g.question, value: g.count, hint: g.reason === 'handoff' ? 'handed over' : 'fallback' }))} empty={`No unanswered questions in the last ${gapDays} days.`} />}
        </Panel>
        <Panel title="Tools" description="How often each tool worked, from Meta’s insights.">
          {d.tools.length ? (
            <ul className="space-y-3">
              {d.tools.map((t) => (
                <li key={t.tool} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs">{t.tool}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {num(t.threads)} chats · {t.avgLatencyMs == null ? '–' : `${(t.avgLatencyMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct(t.successRate)} worked, ${pct(t.errorRate)} errors, ${pct(t.timeoutRate)} timed out`}>
                    <span className="bg-success" style={{ width: `${(t.successRate ?? 0) * 100}%` }} />
                    <span className="bg-destructive" style={{ width: `${(t.errorRate ?? 0) * 100}%` }} />
                    <span className="bg-warning" style={{ width: `${(t.timeoutRate ?? 0) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No tool calls in this period.</p>
          )}
        </Panel>
      </Grid>
    </div>
  )
}

function HumanTab({ d, firstReplyTarget }: { d: Overview; firstReplyTarget: number | null }) {
  const k = d.kpis
  return (
    <div className="space-y-5">
      <Grid>
        <KpiTile label="Tickets opened" value={num(k.ticketsOpened.value)} change={change(k.ticketsOpened)} better="none" trend={trend(d, 'ticketsOpened')} to={ticketsLink({ view: 'all' })} />
        <KpiTile label="Typical first reply" value={dur(k.medianFirstReplyMin.value)} change={change(k.medianFirstReplyMin)} better="down" help="The median: half of first replies were faster than this." />
        <KpiTile label="Typical time to resolve" value={dur(k.medianResolveMin.value)} change={change(k.medianResolveMin)} better="down" help="The median, from opened to resolved." />
        <KpiTile label="Escalations" value={num(k.escalations.value)} change={change(k.escalations)} better="down" trend={trend(d, 'escalations')} to={ticketsLink({ view: 'escalated' })} />
      </Grid>
      <Grid cols={2}>
        <Panel title="Opened, resolved and still open">
          <TimeSeriesChart
            data={d.series}
            label="Tickets opened and resolved per day, and open tickets at the end of each day"
            empty="No tickets in these dates."
            series={[
              { key: 'ticketsOpened', label: 'Opened' },
              { key: 'ticketsResolved', label: 'Resolved' },
              { key: 'backlog', label: 'Still open', kind: 'line', color: 'var(--chart-5)' },
            ]}
          />
        </Panel>
        <Panel title="Typical first reply" description={firstReplyTarget ? `Dashed line: the normal-priority target (${dur(firstReplyTarget)}).` : undefined}>
          <TimeSeriesChart
            data={d.series}
            label="Median minutes to first reply per day"
            empty="No first replies in these dates."
            yFormat={(v) => dur(v)}
            target={firstReplyTarget ? { value: firstReplyTarget, label: 'Target' } : undefined}
            series={[{ key: 'medianFirstReplyMin', label: 'Median first reply', kind: 'line', format: (v) => dur(v) }]}
          />
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel title="When customers write" description="Customer messages by weekday and hour, in your business time zone.">
          <Heatmap cells={d.heatmap} label="Customer messages by weekday and hour" />
        </Panel>
        <Panel title="Satisfaction answers">
          <TimeSeriesChart
            data={d.series}
            label="Satisfaction answers per day"
            empty="No satisfaction answers in these dates."
            series={[
              { key: 'csatGood', label: 'Good', stack: 's', color: 'var(--chart-2)' },
              { key: 'csatOkay', label: 'Okay', stack: 's', color: 'var(--chart-4)' },
              { key: 'csatBad', label: 'Bad', stack: 's', color: 'var(--chart-3)' },
            ]}
          />
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel title="Teams">
          <SimpleTable
            head={['Team', 'Opened', 'Resolved', 'On time', 'Escalated']}
            rows={d.teams.map((t) => [t.name, num(t.opened), num(t.resolved), pct(t.slaMet), num(t.escalated)])}
            links={d.teams.map((t) => ticketsLink({ view: 'all', team: t.id }))}
            empty="No tickets in this period."
          />
        </Panel>
        <Panel
          title="Escalations by level"
          actions={
            d.escalationsByLevel.length ? (
              <Link to={ticketsLink({ view: 'escalated' })} className="text-sm text-primary hover:underline">
                See escalated tickets
              </Link>
            ) : undefined
          }
        >
          <BarList sorted={false} rows={d.escalationsByLevel.map((l) => ({ label: `Level ${l.level}`, value: l.count }))} empty="Nothing escalated in this period." />
        </Panel>
      </Grid>
      <Panel title="People">
        <SimpleTable
          head={['Person', 'Resolved', 'Open now', 'Typical first reply', 'Satisfaction', 'Escalated']}
          rows={d.people.map((p) => [p.name, num(p.resolved), num(p.open), dur(p.medianFirstReplyMin), pct(p.csat), num(p.escalated)])}
          links={d.people.map((p) => ticketsLink({ view: 'all', assignee: p.id }))}
          empty="No tickets in this period."
        />
      </Panel>
    </div>
  )
}

function ConsumptionTab({ d }: { d: Overview }) {
  const c = d.consumption
  const k = d.kpis
  const used = c.budget.monthly ? c.budget.spentThisMonth / c.budget.monthly : null
  return (
    <div className="space-y-5">
      <Grid>
        <KpiTile label="Total spend" value={money(k.spend.value, d.currency)} change={change(k.spend)} better="down" trend={d.series.map((p) => p.spend + p.agentCost)} />
        <KpiTile label="Meta Business Agent" value={money(c.agent.cost, d.currency)} sub={`${num(c.agent.billableMessages)} billable replies`} help="Billed per token by Meta. Usage shows once the agent has a payment method." />
        <KpiTile label="Agent tokens" value={num(c.agent.tokens)} sub={c.agent.state === 'no_billable_account' ? 'Meta reports usage once a payment method is added' : undefined} />
        <KpiTile
          label="This month’s budget"
          value={used == null ? 'No budget' : pct(used)}
          sub={c.budget.monthly ? `${money(c.budget.spentThisMonth, d.currency)} of ${money(c.budget.monthly, d.currency)}` : 'Set one in Settings › Billing'}
          better="none"
        />
      </Grid>
      <Grid cols={2}>
        <Panel title="Spend per day">
          <TimeSeriesChart
            data={d.series}
            label="Spend per day: WhatsApp messages and the Meta Business Agent"
            yFormat={(v) => moneyShort(v, d.currency)}
            series={[
              { key: 'spend', label: 'WhatsApp messages', kind: 'area', stack: 'm', format: (v) => money(v, d.currency) },
              { key: 'agentCost', label: 'Business Agent', kind: 'area', stack: 'm', color: 'var(--chart-4)', format: (v) => money(v, d.currency) },
            ]}
          />
          <p className="mt-2 text-meta text-muted-foreground">WhatsApp message spend is for the whole account (Meta reports it per account, not per number), by UTC day.</p>
        </Panel>
        <Panel title="By message category">
          <Donut slices={c.byCategory.map((x) => ({ label: titleCase(x.category), value: x.cost }))} label="Spend by message category" totalLabel="Spend" format={(v) => money(v, d.currency)} />
        </Panel>
      </Grid>
      <Panel title="Free service replies this month" description="Since 1 October 2026 Meta bills free-form replies inside the 24-hour window; each number gets 1,000 free a month.">
        <ul className="space-y-3">
          {c.serviceFreeTier.filter((s) => d.byAgent.some((a) => a.id === s.id)).map((s) => {
            const share = s.used / s.free
            return (
              <li key={s.id} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate">{s.label}</span>
                  <span className={cn('shrink-0 tabular-nums', share >= 1 ? 'text-destructive' : share >= 0.8 ? 'text-warning-foreground' : 'text-muted-foreground')}>
                    {num(s.used)} of {num(s.free)} {share >= 1 && '· now billed'}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', share >= 1 ? 'bg-destructive' : share >= 0.8 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, share * 100)}%` }} />
                </div>
              </li>
            )
          })}
          {!c.serviceFreeTier.length && <li className="text-sm text-muted-foreground">No numbers connected.</li>}
        </ul>
      </Panel>
      <p className="text-meta text-muted-foreground">
        Writing help in the console used {num(c.assist.tokens)} AI tokens over {num(c.assist.calls)} requests in this period.
      </p>
    </div>
  )
}

function BroadcastsTab({ d }: { d: Overview }) {
  const b = d.broadcasts
  return (
    <div className="space-y-5">
      <Grid>
        <KpiTile label="Sent" value={num(b.sent)} />
        <KpiTile label="Read" value={pct(b.sent ? b.read / b.sent : null)} />
        <KpiTile label="Replied" value={pct(b.sent ? b.replied / b.sent : null)} help="Customers who wrote back within 3 days." />
        <KpiTile label="Failed" value={num(b.failed)} better="down" />
      </Grid>
      <Panel title="From sent to replied">
        {b.sent ? (
          <Funnel
            steps={[
              { label: 'Sent', value: b.sent },
              { label: 'Delivered', value: b.delivered },
              { label: 'Read', value: b.read },
              { label: 'Replied', value: b.replied },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No broadcasts sent in this period.</p>
        )}
      </Panel>
    </div>
  )
}

/** `links`: where each row's first cell goes (the tickets behind it). */
function SimpleTable({ head, rows, empty, links }: { head: string[]; rows: (string | number)[][]; empty: string; links?: string[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={h} className={cn(i > 0 && 'text-right')}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, j) => (
            <TableRow key={j} data-density-row>
              {r.map((c, i) => (
                <TableCell key={i} className={cn(i > 0 ? 'text-right tabular-nums' : 'font-medium')}>
                  {i === 0 && links?.[j] ? (
                    <Link to={links[j]} className="hover:underline">
                      {c}
                    </Link>
                  ) : (
                    c
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

const PAGE = 50
function LogsTab({ filter }: { filter: ReturnType<typeof useAnalyticsFilter>['filter'] }) {
  const [kind, setKind] = useState<LogKind>('tickets')
  const [skip, setSkip] = useState(0)
  const [page, setPage] = useState<LogPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify(filter)
  const options = useMemo(() => LOG_KINDS.map((k) => ({ id: k, label: LOG_LABEL[k] })), [])
  useEffect(() => setSkip(0), [kind, key])
  useEffect(() => {
    let live = true
    setPage(null)
    setError(null)
    getLog(kind, filter, skip, PAGE).then(
      (p) => live && setPage(p),
      (err) => live && setError(errorDetail(err)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, skip, key, retry])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs label="Log" options={options} value={kind} onChange={setKind} />
        <ReportActions filter={filter} log={kind} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        {error ? (
          <p className="p-6 text-sm text-destructive">
            Couldn&rsquo;t load this log. {error}{' '}
            <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </p>
        ) : !page ? (
          <PageLoader context="analytics" className="min-h-[30vh]" />
        ) : !page.rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                {page.columns.map((c) => (
                  <TableHead key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right')}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((r, i) => (
                <TableRow key={i} data-density-row>
                  {page.columns.map((c) => (
                    <TableCell key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right tabular-nums')}>
                      {c.key === 'ticket' && /^#\d+$/.test(String(r[c.key])) ? (
                        <Link to={ticketsLink({ view: 'all', n: String(r[c.key]).slice(1) })} className="text-primary hover:underline">
                          {r[c.key]}
                        </Link>
                      ) : (
                        (r[c.key] ?? '–')
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {page && page.total > PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {skip + 1}–{Math.min(skip + PAGE, page.total)} of {num(page.total)}
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!skip} onClick={() => setSkip((s) => Math.max(0, s - PAGE))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={skip + PAGE >= page.total} onClick={() => setSkip((s) => s + PAGE)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

/** The Tickets list with these filters (the same names its address uses). */
const ticketsLink = (p: Record<string, string>) => {
  const q = new URLSearchParams(Object.entries(p).filter(([k, v]) => v && !(k === 'view' && v === 'open')))
  const s = q.toString()
  return `/tickets${s ? `?${s}` : ''}`
}
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
const fmtRange = (a: string, b: string) => {
  const f = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })
  return `${f(a)} – ${f(b)}`
}
