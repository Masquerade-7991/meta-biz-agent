import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { KpiTile } from '@/app/components/ui/kpi'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { PillTabs } from '@/app/components/Filters'
import { errorDetail } from '@/app/api/meta'
import { getOverview } from '@/app/api/overview'
import { METRICS, type AnalyticsFilter, type Overview } from '@/app/analytics/types'
import { BreakdownTable } from './BreakdownTable'
import { SummaryCharts } from './SummaryCharts'
import { summaryOf, type Grain, type Tile } from './summary'
import { recordsOf, type ReportId } from './catalog'

const GRAINS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
] as const

/** A summary report on screen: KPI tiles (change against the period before), charts, a sortable table
 *  with totals, and a link to the matching records with the same filters. */
export function SummaryReport({ id, filter }: { id: ReportId; filter: AnalyticsFilter }) {
  const { search } = useLocation()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [grain, setGrain] = useState<Grain>('day')
  const [tab, setTab] = useState(0)
  const key = JSON.stringify(filter)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    getOverview(filter).then(
      (o) => live && setData(o),
      (err) => live && setError(errorDetail(err)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry])
  useEffect(() => setTab(0), [id])
  if (error) return <InlineError message={`Couldn’t load this report. ${error}`} onRetry={() => setRetry((n) => n + 1)} />
  if (!data) return <PageLoader context="analytics" className="min-h-[30vh]" />
  const s = summaryOf(id, data)
  const table = s.tables[tab] ?? s.tables[0]
  const records = recordsOf(id)
  return (
    <div className="space-y-6">
      <SummaryTiles tiles={s.tiles} />
      <SummaryCharts id={id} o={data} />
      {table && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {s.tables.length > 1 ? <PillTabs label="Table" options={s.tables.map((t, i) => ({ id: i, label: t.label }))} value={tab} onChange={setTab} /> : <h2 className="text-section font-semibold">{table.byTime ? 'Over time' : table.label}</h2>}
            {table.byTime && <PillTabs label="Group by" options={GRAINS} value={grain} onChange={setGrain} />}
          </div>
          <BreakdownTable key={`${id}-${table.id}`} b={table} currency={data.currency} grain={grain} />
        </section>
      )}
      {records && (
        <Link to={`/reports/${records}${search}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          View records <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  )
}

/** The tiles, shared with the print view. */
export function SummaryTiles({ tiles, print }: { tiles: Tile[]; print?: boolean }) {
  return (
    <div className={print ? 'grid grid-cols-4 gap-3' : 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4'}>
      {tiles.map((t) => {
        const m = METRICS[t.metric]
        return (
          <KpiTile
            key={t.metric}
            label={
              t.tag ? (
                <>
                  {m.label} <span className="rounded bg-muted px-1.5 text-micro font-medium whitespace-nowrap text-muted-foreground">{t.tag}</span>
                </>
              ) : (
                m.label
              )
            }
            value={t.value}
            change={t.change}
            unit={t.unit}
            better={m.better}
            trend={print ? undefined : t.trend}
            help={print ? undefined : m.help}
            sub={t.sub}
          />
        )
      })}
    </div>
  )
}
