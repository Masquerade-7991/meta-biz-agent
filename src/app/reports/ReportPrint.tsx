import { useEffect, useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import mark from '@/assets/helo-mark.svg'
import { Button } from '@/app/components/ui/button'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { TimeSeriesChart } from '@/app/components/charts/TimeSeriesChart'
import { percent } from '@/app/components/charts/chartTheme'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getOverview } from '@/app/api/overview'
import { csatScore, type AnalyticsFilter, type Overview } from '@/app/analytics/types'
import { change, dur, money, num, pct, pointChange } from '@/app/analytics/format'
import { cn } from '@/app/lib/utils'
import { isReport, reportOf, reportTable, type ReportId } from './catalog'

/**
 * /reports/print?reports=…&from=…: a clean page for the browser's print dialog ("Save as PDF").
 * Always light, with the headline numbers, the key charts and each chosen report's table.
 */
export function ReportPrint() {
  const { me } = useAuth()
  const q = useMemo(() => new URLSearchParams(window.location.search), [])
  const ids = (q.get('reports') ?? 'business_review').split(',').filter(isReport).filter((id) => reportOf(id).source === 'overview') as ReportId[]
  const today = new Date().toISOString().slice(0, 10)
  const filter: AnalyticsFilter = {
    from: q.get('from') ?? today,
    to: q.get('to') ?? today,
    numbers: (q.get('numbers') ?? '').split(',').filter(Boolean),
    team: q.get('team'),
    person: q.get('person'),
  }
  const [d, setD] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Paper is white: print in the light theme, whatever the screen uses.
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => {
      if (wasDark) root.classList.add('dark')
    }
  }, [])
  useEffect(() => {
    getOverview(filter).then(setD, (err) => setError(errorDetail(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!d) return
    // Charts draw after layout; then the print dialog opens by itself.
    const t = setTimeout(() => window.print(), 900)
    return () => clearTimeout(t)
  }, [d])

  if (error) return <p className="p-10 text-destructive">{error}</p>
  if (!d) return <PageLoader fullscreen context="analytics" />
  const k = d.kpis
  const agentText = !filter.numbers.length ? 'All agents' : d.agents.filter((a) => filter.numbers.includes(a.id)).map((a) => a.label).join(', ')
  const fmt = (s: string) => new Date(s + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
  const daily = d.series.map((p) => ({ ...p, csat: csatScore(p.csatGood, p.csatOkay, p.csatBad) }))

  return (
    <div className="min-h-screen bg-background text-foreground print:min-h-0">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-border bg-background/95 px-6 py-3 print:hidden">
        <span className="mr-auto text-sm text-muted-foreground">Choose “Save as PDF” as the printer to keep a PDF.</span>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" /> Print or save as PDF
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.close()}>
          <X className="size-4" /> Close
        </Button>
      </div>
      <main className="mx-auto max-w-4xl space-y-8 px-8 py-10 print:max-w-none print:px-0 print:py-0">
        <header className="flex items-start justify-between gap-6 border-b-4 border-brand pb-5">
          <div>
            <p className="text-meta tracking-wide text-muted-foreground uppercase">{me?.workspace?.name}</p>
            <h1 className="text-title font-semibold">{ids.map((id) => reportOf(id).title).join(' · ')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmt(d.range.from)} – {fmt(d.range.to)} · compared with {fmt(d.range.prevFrom)} – {fmt(d.range.prevTo)}
            </p>
            <p className="text-sm text-muted-foreground">
              {agentText}
              {filter.team && ' · one team'}
              {filter.person && ' · one person'}
            </p>
          </div>
          <img src={mark} alt="Helo.ai" className="size-10" />
        </header>

        {ids.includes('business_review') && (
          <>
            <section className="grid grid-cols-4 gap-3">
              <Tile label="Conversations" value={num(k.conversations.value)} delta={change(k.conversations)} />
              <Tile label="Handled by AI alone" value={pct(k.containment.value)} delta={pointChange(k.containment)} points />
              <Tile label="Satisfaction" value={pct(k.csat.value)} delta={pointChange(k.csat)} points />
              <Tile label="Tickets resolved" value={pct(k.resolutionRate.value)} delta={pointChange(k.resolutionRate)} points />
              <Tile label="Typical first reply" value={dur(k.medianFirstReplyMin.value)} delta={change(k.medianFirstReplyMin)} lowerIsBetter />
              <Tile label="Resolved on time" value={pct(k.slaMet.value)} delta={pointChange(k.slaMet)} points />
              <Tile label="Escalations" value={num(k.escalations.value)} delta={change(k.escalations)} lowerIsBetter />
              <Tile label="Spend" value={money(k.spend.value, d.currency)} delta={change(k.spend)} lowerIsBetter />
            </section>
            <section className="grid grid-cols-2 gap-6 break-inside-avoid">
              <div>
                <h2 className="mb-2 text-section font-semibold">Conversations</h2>
                <TimeSeriesChart
                  data={d.series}
                  height={180}
                  label="Conversations per day"
                  series={[
                    { key: 'aiOnly', label: 'AI alone', kind: 'area', stack: 'c' },
                    { key: 'withTeam', label: 'With the team', kind: 'area', stack: 'c', color: 'var(--chart-4)' },
                  ]}
                />
              </div>
              <div>
                <h2 className="mb-2 text-section font-semibold">Quality</h2>
                <TimeSeriesChart
                  data={daily}
                  height={180}
                  domain={[0, 1]}
                  yFormat={percent}
                  label="Containment and satisfaction per day"
                  series={[
                    { key: 'containment', label: 'AI alone', kind: 'line', format: percent },
                    { key: 'csat', label: 'Satisfaction', kind: 'line', format: percent, color: 'var(--chart-4)' },
                  ]}
                />
              </div>
            </section>
          </>
        )}

        {ids.map((id) => {
          const t = reportTable(id, d, null)
          return (
            <section key={id} className="break-inside-avoid-page">
              <h2 className="mb-2 text-section font-semibold">{reportOf(id).title}</h2>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {t.columns.map((c, i) => (
                      <th key={c} className={cn('border-b border-border-strong py-1.5 pr-2 font-medium text-muted-foreground', i ? 'text-right' : 'text-left')}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, j) => (
                    <tr key={j} className="break-inside-avoid">
                      {r.map((v, i) => (
                        <td key={i} className={cn('border-b border-border py-1 pr-2', i ? 'text-right tabular-nums' : '')}>
                          {v ?? '–'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}
        <footer className="border-t border-border pt-3 text-meta text-muted-foreground">
          Made with Helo.ai on {new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Times in {d.range.timezone}.
        </footer>
      </main>
    </div>
  )
}

function Tile({ label, value, delta, points, lowerIsBetter }: { label: string; value: string; delta: number | null; points?: boolean; lowerIsBetter?: boolean }) {
  const shown = delta == null ? null : Math.round(delta * 100)
  const good = !shown ? null : shown > 0 !== !!lowerIsBetter
  return (
    <div className="rounded-lg border border-border p-3 break-inside-avoid">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="text-section font-semibold tabular-nums">{value}</p>
      {shown != null && (
        <p className={cn('text-meta tabular-nums', good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive')}>
          {shown > 0 ? '+' : shown < 0 ? '−' : ''}
          {Math.abs(shown)}
          {points ? ' pts' : '%'} vs before
        </p>
      )}
    </div>
  )
}
