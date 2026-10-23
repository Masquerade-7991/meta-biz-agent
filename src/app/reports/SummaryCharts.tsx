import type { ReactNode } from 'react'
import { TimeSeriesChart } from '@/app/components/charts/TimeSeriesChart'
import { Donut } from '@/app/components/charts/Donut'
import { BarList } from '@/app/components/charts/BarList'
import { Heatmap } from '@/app/components/charts/Heatmap'
import { percent } from '@/app/components/charts/chartTheme'
import { csatScore, type Overview } from '@/app/analytics/types'
import { money, moneyShort, num, pct } from '@/app/analytics/format'
import { cn } from '@/app/lib/utils'
import type { ReportId } from './catalog'

/** A summary report's charts: the same on screen and in the print view. Recharts: lazily loaded pages only. */
export function SummaryCharts({ id, o, print }: { id: ReportId; o: Overview; print?: boolean }) {
  const h = print ? 170 : 220
  const daily = o.series.map((p) => ({ ...p, csat: csatScore(p.csatGood, p.csatOkay, p.csatBad) }))
  const cur = (v: number) => money(v, o.currency)
  const panels: { title: string; chart: ReactNode }[] = []
  const add = (title: string, chart: ReactNode) => panels.push({ title, chart })
  const who = (kind: 'area' | 'bar') => (
    <TimeSeriesChart
      data={o.series}
      height={h}
      label="Conversations per day by who answered"
      series={[
        { key: 'aiOnly', label: 'AI alone', kind, stack: 'c' },
        { key: 'withTeam', label: 'With the team', kind, stack: 'c', color: 'var(--chart-4)' },
        { key: 'noReply', label: 'No reply', kind, stack: 'c', color: 'var(--chart-5)' },
      ]}
    />
  )
  const rateLine = (key: 'containment' | 'slaMet' | 'csat', label: string) => <TimeSeriesChart data={daily} height={h} domain={[0, 1]} yFormat={percent} label={`${label} per day`} series={[{ key, label, kind: 'line', format: percent }]} />

  switch (id) {
    case 'business_review':
      add('Conversations by who answered', who('area'))
      add(
        'Quality',
        <TimeSeriesChart
          data={daily}
          height={h}
          domain={[0, 1]}
          yFormat={percent}
          label="Handled by AI alone and satisfaction per day"
          series={[
            { key: 'containment', label: 'AI alone', kind: 'line', format: percent },
            { key: 'csat', label: 'Satisfaction', kind: 'line', format: percent, color: 'var(--chart-4)' },
            { key: 'slaMet', label: 'Resolved on time', kind: 'line', format: percent, color: 'var(--chart-2)' },
          ]}
        />,
      )
      break
    case 'ai_agent':
      add('Handled by AI alone', rateLine('containment', 'Handled by AI alone'))
      add('Handover reasons', <BarList rows={o.handoffReasons.map((r) => ({ label: r.label, value: r.count }))} format={num} />)
      add('Tool success', <BarList rows={o.tools.filter((t) => t.successRate != null).map((t) => ({ label: t.tool, value: t.successRate ?? 0, hint: `${num(t.threads)} runs` }))} format={pct} empty="No tools ran in these dates." />)
      break
    case 'conversations':
      add('Conversations by who answered', who('bar'))
      add('Busiest hours', <Heatmap cells={o.heatmap} label="Customer messages by weekday and hour" />)
      break
    case 'team':
      add('Resolved by person', <BarList rows={o.people.map((p) => ({ label: p.name, value: p.resolved }))} format={num} empty="Nobody resolved a ticket in these dates." />)
      add('Resolved by team', <BarList rows={o.teams.map((t) => ({ label: t.name, value: t.resolved }))} format={num} empty="No teams yet." />)
      break
    case 'response_sla':
      add('Resolved on time', rateLine('slaMet', 'Resolved on time'))
      add('Escalations by level', <BarList rows={o.escalationsByLevel.map((l) => ({ label: `Level ${l.level}`, value: l.count }))} format={num} sorted={false} empty="No escalations in these dates." />)
      break
    case 'csat': {
      const sum = (k: 'csatGood' | 'csatOkay' | 'csatBad') => o.series.reduce((a, p) => a + p[k], 0)
      add('Satisfaction', rateLine('csat', 'Satisfaction'))
      add(
        'Ratings',
        <Donut
          label="Ratings by answer"
          size={print ? 140 : 168}
          format={num}
          totalLabel="Ratings"
          slices={[
            { label: 'Good', value: sum('csatGood'), color: 'var(--chart-2)' },
            { label: 'Okay', value: sum('csatOkay'), color: 'var(--chart-4)' },
            { label: 'Bad', value: sum('csatBad'), color: 'var(--chart-5)' },
          ]}
        />,
      )
      break
    }
    case 'spend':
      add('Spend by category', <BarList rows={o.consumption.byCategory.map((c) => ({ label: c.category.charAt(0) + c.category.slice(1).toLowerCase().replace(/_/g, ' '), value: c.cost }))} format={cur} empty="No priced messages in these dates." />)
      add(
        'Spend per day',
        <TimeSeriesChart
          data={o.series}
          height={h}
          yFormat={(v) => moneyShort(v, o.currency)}
          label="WhatsApp spend and agent cost per day"
          series={[
            { key: 'spend', label: 'WhatsApp', kind: 'bar', stack: 's', format: cur },
            { key: 'agentCost', label: 'AI agent', kind: 'bar', stack: 's', format: cur, color: 'var(--chart-4)' },
          ]}
        />,
      )
      break
  }
  if (!panels.length) return null
  return (
    <div className={cn('grid gap-4', print ? 'grid-cols-2 break-inside-avoid' : panels.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
      {panels.map(({ title, chart }) => (
        <section key={title} className={cn('min-w-0 rounded-lg border border-border bg-card', print ? 'p-3' : 'p-5')}>
          <h2 className="mb-3 text-section font-semibold">{title}</h2>
          {chart}
        </section>
      ))}
    </div>
  )
}
