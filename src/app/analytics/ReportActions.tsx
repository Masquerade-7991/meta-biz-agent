import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { CalendarClock, ChevronDown, Download, Loader2, Printer } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { errorDetail } from '@/app/api/meta'
import { downloadReport, printUrl } from '@/app/api/reports'
import { filterQuery } from '@/app/api/overview'
import { reportOf, type ReportId } from '@/app/reports/catalog'
import type { AnalyticsFilter, LogKind } from './types'

/** Export the view being looked at: its CSV, a PDF summary, or a schedule that emails it. */
export function ReportActions({ filter, log }: { filter: AnalyticsFilter; log?: LogKind }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  async function csv(id: ReportId) {
    setBusy(true)
    try {
      await downloadReport(id, filter)
    } catch (err) {
      toast.error(`Couldn’t download ${reportOf(id).title}`, { description: errorDetail(err) })
    } finally {
      setBusy(false)
    }
  }
  if (log)
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void csv(log)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download CSV
      </Button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">CSV, opens in Excel</DropdownMenuLabel>
        {(['business_review', 'daily', 'agents', 'people'] as const).map((id) => (
          <DropdownMenuItem key={id} onSelect={() => void csv(id)}>
            {reportOf(id).title}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open(printUrl(['business_review', 'agents'], filter), '_blank', 'noopener')}>
          <Printer className="size-4" /> PDF summary
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/reports?schedule=new&${filterQuery(filter).replace('numbers=', 'agents=')}`)}>
          <CalendarClock className="size-4" /> Email on a schedule…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/reports?${filterQuery(filter).replace('numbers=', 'agents=')}`)}>All reports…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
