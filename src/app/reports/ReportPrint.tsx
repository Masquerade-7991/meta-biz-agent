import { useEffect, useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import mark from '@/assets/helo-mark.svg'
import { Button } from '@/app/components/ui/button'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getOverview } from '@/app/api/overview'
import type { AnalyticsFilter, Overview } from '@/app/analytics/types'
import { isLogReport, reportOf, resolveReport, type ReportId } from './catalog'
import { summaryOf } from './summary'
import { SummaryTiles } from './SummaryReport'
import { SummaryCharts } from './SummaryCharts'
import { BreakdownTable } from './BreakdownTable'

/**
 * /reports/print?reports=…&from=…: a clean page for the browser's print dialog ("Save as PDF").
 * Always light, with the headline numbers, the key charts and each chosen report's table.
 */
export function ReportPrint() {
  const { me } = useAuth()
  const q = useMemo(() => new URLSearchParams(window.location.search), [])
  const ids = [...new Set((q.get('reports') ?? 'business_review').split(',').map(resolveReport))].filter((id): id is ReportId => !!id && !isLogReport(id))
  // Only when the link names no dates (it always does from Reports): the viewer's own day, not UTC's.
  const today = new Intl.DateTimeFormat('en-CA').format(new Date())
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
  const agentText = !filter.numbers.length ? 'All agents' : d.agents.filter((a) => filter.numbers.includes(a.id)).map((a) => a.label).join(', ')
  const fmt = (s: string) => new Date(s + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-background text-foreground print:min-h-0">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-border bg-background/95 px-6 py-3 print:hidden">
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
              {filter.team && ` · team ${d.teams.find((t) => t.id === filter.team)?.name ?? ''}`}
              {filter.person && ` · assigned to ${filter.person === 'none' ? 'nobody' : (d.people.find((p) => p.id === filter.person)?.name ?? 'one person')}`}
            </p>
          </div>
          <img src={mark} alt="Helo.ai" className="size-10" />
        </header>

        {ids.map((id) => {
          const sum = summaryOf(id, d)
          return (
            <section key={id} className="space-y-4 break-inside-avoid-page">
              {ids.length > 1 && <h2 className="text-section font-semibold">{reportOf(id).title}</h2>}
              <SummaryTiles tiles={sum.tiles} print />
              <SummaryCharts id={id} o={d} print />
              {sum.tables.map((t) => (
                <div key={t.id} className="space-y-2">
                  {sum.tables.length > 1 && <h3 className="text-sm font-semibold">{t.label}</h3>}
                  <BreakdownTable b={t} currency={d.currency} print />
                </div>
              ))}
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
