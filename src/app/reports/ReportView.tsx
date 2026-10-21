import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { errorDetail } from '@/app/api/meta'
import { getOverview } from '@/app/api/overview'
import { downloadReport, printUrl } from '@/app/api/reports'
import { FilterBar } from '@/app/analytics/FilterBar'
import type { AnalyticsFilter, Overview } from '@/app/analytics/types'
import { num } from '@/app/analytics/format'
import type { Team } from '@/app/api/tickets'
import { cn } from '@/app/lib/utils'
import { RecordsTable } from './RecordsTable'
import { FILTER_NOTE, isLogReport, MAX_LOG_ROWS, reportOf, reportTable, type ReportId } from './catalog'

/** /reports/<id>: one report on screen with the filters it uses, and Download (CSV, or PDF for summaries). */
export function ReportView({
  id,
  filter,
  range,
  set,
  agents,
  teams,
  members,
  timezone,
  onBack,
  onSchedule,
}: {
  id: ReportId
  filter: AnalyticsFilter
  range: string
  set: (patch: Record<string, string | null>) => void
  agents: { id: string; label: string }[]
  teams: Team[]
  members: { userId: string; name: string }[]
  timezone?: string
  onBack: () => void
  /** Email this report on a schedule, with these filters. */
  onSchedule: () => void
}) {
  const r = reportOf(id)
  const [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const capped = total != null && total > MAX_LOG_ROWS

  async function csv() {
    setBusy(true)
    try {
      await downloadReport(id, filter)
    } catch (err) {
      toast.error(`Couldn’t download ${r.title}`, { description: errorDetail(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="size-4" /> Reports
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-title font-semibold">{r.title}</h1>
          <p className="mt-1 text-muted-foreground">{r.description}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">With the filters shown</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void csv()}>
              <FileSpreadsheet className="size-4" />
              <span>
                CSV
                <span className="block text-meta text-muted-foreground">Opens in Excel or Google Sheets</span>
              </span>
            </DropdownMenuItem>
            {!isLogReport(id) && (
              <DropdownMenuItem onSelect={() => window.open(printUrl([id], filter), '_blank', 'noopener')}>
                <Printer className="size-4" />
                <span>
                  PDF
                  <span className="block text-meta text-muted-foreground">Opens the print dialog: choose Save as PDF</span>
                </span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSchedule}>
              <CalendarClock className="size-4" /> Email on a schedule…
            </DropdownMenuItem>
            {capped && (
              <p className="flex gap-2 px-2 py-1.5 text-meta text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                The CSV has the first {num(MAX_LOG_ROWS)} of {num(total)} rows. Narrow the dates to get the rest.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FilterBar filter={filter} range={range} agents={agents} teams={teams} people={members} onChange={set} applies={r.filters} note={FILTER_NOTE[id]} timezone={timezone} />
      {isLogReport(id) ? <RecordsTable kind={id} filter={filter} onLoad={(p) => setTotal(p.total)} /> : <SummaryTable id={id} filter={filter} />}
    </div>
  )
}

/** A summary report as the same table its CSV holds. */
function SummaryTable({ id, filter }: { id: ReportId; filter: AnalyticsFilter }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
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
  if (error) return <InlineError message={`Couldn’t load this report. ${error}`} onRetry={() => setRetry((n) => n + 1)} />
  if (!data) return <PageLoader context="analytics" className="min-h-[30vh]" />
  const t = reportTable(id, data, null)
  // A column of numbers lines up on the right, its empty cells too.
  const numeric = t.columns.map((_, j) => t.rows.some((row) => typeof row[j] === 'number'))
  if (!t.rows.length) return <p className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">Nothing in this period. Try a longer date range.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {t.columns.map((c, i) => (
              <TableHead key={c} className={cn('whitespace-nowrap', numeric[i] && 'text-right')}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {t.rows.map((row, i) => (
            <TableRow key={i} data-density-row>
              {row.map((v, j) => (
                <TableCell key={j} className={cn('whitespace-nowrap', numeric[j] && 'text-right tabular-nums', j === 0 && 'font-medium')}>
                  {v == null ? '–' : typeof v === 'number' ? v.toLocaleString() : v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
