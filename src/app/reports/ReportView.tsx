import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, CalendarClock, ChevronDown, Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { errorDetail } from '@/app/api/meta'
import { downloadReport, printUrl } from '@/app/api/reports'
import { FilterBar } from '@/app/analytics/FilterBar'
import type { AnalyticsFilter } from '@/app/analytics/types'
import type { Team } from '@/app/api/tickets'
import { RecordsTable } from './RecordsTable'
import { SummaryReport } from './SummaryReport'
import { logKindOf, reportOf, type ReportId } from './catalog'

/** /reports/<id>: one report on screen with the filters it uses, and Download (CSV, or PDF for summaries). */
export function ReportView({
  id,
  filter: all,
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
  const kind = logKindOf(id)
  const [busy, setBusy] = useState(false)
  // A filter this report doesn't offer doesn't narrow it either (it may still be in the address from another report).
  const uses = r.filters as readonly string[]
  const filter: AnalyticsFilter = { ...all, team: uses.includes('team') ? all.team : null, person: uses.includes('person') ? all.person : null }

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
        <h1 className="text-title font-semibold">{r.title}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void csv()}>
              <FileSpreadsheet className="size-4" /> CSV
            </DropdownMenuItem>
            {!kind && (
              <DropdownMenuItem onSelect={() => window.open(printUrl([id], filter), '_blank', 'noopener')}>
                <Printer className="size-4" /> PDF
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSchedule}>
              <CalendarClock className="size-4" /> Email on a schedule…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FilterBar filter={filter} range={range} agents={agents} teams={teams} people={members} onChange={set} applies={r.filters} timezone={timezone} />
      {kind ? <RecordsTable kind={kind} filter={filter} /> : <SummaryReport id={id} filter={filter} />}
    </div>
  )
}
