import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Label } from '@/app/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { errorDetail } from '@/app/api/meta'
import { downloadReport, printUrl } from '@/app/api/reports'
import { FilterBar } from '@/app/analytics/FilterBar'
import type { AnalyticsFilter } from '@/app/analytics/types'
import { isLogReport, REPORT_GROUPS, REPORTS, reportOf, type ReportId } from './catalog'

const dayText = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

/** Several reports at once: CSV files (one per report) or one PDF of the chosen summaries. Date and
 *  agents apply to every report; team and assignee are left to a single report's own page. */
export function ExportDialog({
  open,
  onClose,
  filter,
  range,
  set,
  agents,
  timezone,
}: {
  open: boolean
  onClose: () => void
  filter: AnalyticsFilter
  range: string
  set: (patch: Record<string, string | null>) => void
  agents: { id: string; label: string }[]
  timezone?: string
}) {
  const [chosen, setChosen] = useState<ReportId[]>(['business_review'])
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv')
  const [busy, setBusy] = useState(false)
  // Team and assignee don't travel into a multi-report export: say what's in the files, nothing hidden.
  const f: AnalyticsFilter = { ...filter, team: null, person: null }
  const picked = format === 'pdf' ? chosen.filter((id) => !isLogReport(id)) : chosen
  const agentText = !f.numbers.length ? 'all agents' : f.numbers.length === 1 ? (agents.find((a) => a.id === f.numbers[0])?.label ?? '1 agent') : `${f.numbers.length} agents`
  const period = f.from === f.to ? dayText(f.from) : `${dayText(f.from)} – ${dayText(f.to)}`

  async function go() {
    if (format === 'pdf') {
      window.open(printUrl(picked, f), '_blank', 'noopener')
      onClose()
      return
    }
    setBusy(true)
    for (const id of picked) {
      try {
        await downloadReport(id, f)
      } catch (err) {
        toast.error(`Couldn’t download ${reportOf(id).title}`, { description: errorDetail(err) })
      }
    }
    setBusy(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export reports</DialogTitle>
          <DialogDescription>Download several reports at once. To narrow by team or assignee, open a report and download it from there.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <FilterBar filter={filter} range={range} agents={agents} teams={[]} people={[]} onChange={set} applies={['agents']} timezone={timezone} />
          <div className="grid gap-4 sm:grid-cols-2">
            {REPORT_GROUPS.map((g) => (
              <fieldset key={g.id} className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{g.title}</legend>
                {REPORTS.filter((r) => r.group === g.id).map((r) => {
                  const off = format === 'pdf' && r.group === 'records'
                  return (
                    <label key={r.id} className="flex items-center gap-2.5 text-sm" title={off ? 'Detailed records come as CSV only' : undefined}>
                      <Checkbox
                        checked={chosen.includes(r.id) && !off}
                        disabled={off}
                        onCheckedChange={(on) => setChosen((c) => (on ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                      />
                      <span className={off ? 'text-muted-foreground' : undefined}>{r.title}</span>
                    </label>
                  )
                })}
              </fieldset>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as 'csv' | 'pdf')} className="gap-2">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="csv" /> CSV: one file per report, opens in Excel or Google Sheets
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="pdf" /> PDF: one document with the chosen summaries
              </label>
            </RadioGroup>
            {format === 'csv' && picked.length > 1 && <p className="text-meta text-muted-foreground">Your browser may ask once to allow several downloads.</p>}
          </div>
        </div>
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {picked.length} {picked.length === 1 ? 'report' : 'reports'} · {period} · {agentText} · {format.toUpperCase()}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void go()} disabled={busy || !picked.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
