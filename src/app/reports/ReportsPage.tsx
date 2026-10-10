import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CalendarClock, Download, FileText, Loader2, Mail, Pencil, Plus, Printer, Send, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { EmptyState, PageContainer, PageHeader, SectionHeader } from '@/app/components/ui/page'
import { TagInput } from '@/app/components/wizard/TagInput'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { useMembers } from '@/app/auth/useMembers'
import { errorDetail } from '@/app/api/meta'
import { getOverview } from '@/app/api/overview'
import { createSchedule, deleteSchedule, downloadReport, listSchedules, printUrl, sendScheduleNow, updateSchedule } from '@/app/api/reports'
import { listTeams, type Team } from '@/app/api/tickets'
import { can } from '@/app/lib/permissions'
import { FilterBar } from '@/app/analytics/FilterBar'
import { useAnalyticsFilter } from '@/app/analytics/useAnalyticsFilter'
import { CADENCE_LABEL, REPORTS, reportOf, type Cadence, type ReportId, type ReportSchedule } from './catalog'

const blank = (me: string | undefined): Omit<ReportSchedule, 'id'> => ({ name: 'Weekly business review', reports: ['business_review'], cadence: 'weekly', hour: 9, numbers: [], team: null, userIds: me ? [me] : [], emails: [], enabled: true })

/** Every report as CSV (opens in Excel) or a printable PDF summary, for any period and agents; and reports emailed on a schedule. */
export function ReportsPage() {
  const { me } = useAuth()
  const { filter, range, set } = useAnalyticsFilter()
  const members = useMembers()
  const [agents, setAgents] = useState<{ id: string; label: string }[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [busy, setBusy] = useState<ReportId | null>(null)
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; s: Omit<ReportSchedule, 'id'> } | null>(null)
  const [removing, setRemoving] = useState<ReportSchedule | null>(null)
  const [q, setQ] = useSearchParams()

  const load = useCallback(() => listSchedules().then(setSchedules, (err) => toast.error('Couldn’t load schedules', { description: errorDetail(err) })), [])
  useEffect(() => {
    void load()
    listTeams().then(setTeams, () => {})
    // The agents for the filter come with the overview; a short period keeps it light.
    getOverview({ ...filter, from: filter.to }).then((o) => setAgents(o.agents), () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])
  // Analytics' "Schedule by email" lands here with ?schedule=new.
  useEffect(() => {
    if (q.get('schedule') !== 'new') return
    setEditing({ id: null, s: { ...blank(me?.user.id), numbers: filter.numbers, team: filter.team } })
    setQ((p) => {
      const n = new URLSearchParams(p)
      n.delete('schedule')
      return n
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function download(id: ReportId) {
    setBusy(id)
    try {
      await downloadReport(id, filter)
    } catch (err) {
      toast.error(`Couldn’t download ${reportOf(id).title}`, { description: errorDetail(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Reports" description="Download any report for business review, print a PDF summary, or have reports emailed on a schedule." />
      <div className="mb-6">
        <FilterBar filter={filter} range={range} agents={agents} teams={teams} people={members} onChange={set} />
      </div>

      <SectionHeader title="Download" description="CSV files open in Excel or Google Sheets. PDF opens a print-ready page: choose “Save as PDF” in the print dialog." />
      <ul className="mb-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">{r.title}</p>
                <p className="text-sm text-muted-foreground">{r.description}</p>
              </div>
            </div>
            <div className="mt-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void download(r.id)}>
                {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} CSV
              </Button>
              {r.source === 'overview' && (
                <Button size="sm" variant="ghost" onClick={() => window.open(printUrl([r.id], filter), '_blank', 'noopener')}>
                  <Printer className="size-4" /> PDF
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <SectionHeader
        title="Scheduled emails"
        description="Headline numbers in the email, the chosen reports attached as CSV. Times are in your business hours’ time zone."
        actions={
          <Button size="sm" onClick={() => setEditing({ id: null, s: blank(me?.user.id) })}>
            <Plus className="size-4" /> New schedule
          </Button>
        }
      />
      {!schedules ? null : !schedules.length ? (
        <EmptyState icon={CalendarClock} title="No scheduled reports" description="Send a weekly business review to your managers every Monday, for example." />
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" data-density-row>
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {s.name} {!s.enabled && <span className="ml-1 rounded bg-muted px-1.5 text-xs font-normal text-muted-foreground">Paused</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {CADENCE_LABEL[s.cadence]} at {String(s.hour).padStart(2, '0')}:00 · {s.reports.map((id) => reportOf(id).title).join(', ')} · to {s.userIds.length + s.emails.length}{' '}
                  {s.userIds.length + s.emails.length === 1 ? 'person' : 'people'}
                </p>
                <p className="text-meta text-muted-foreground">
                  {s.nextRunAt ? `Next: ${new Date(s.nextRunAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not scheduled'}
                  {s.lastSentAt && ` · Last sent ${new Date(s.lastSentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const r = await sendScheduleNow(s.id)
                      toast.success(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`)
                      void load()
                    } catch (err) {
                      toast.error('Couldn’t send', { description: errorDetail(err) })
                    }
                  }}
                >
                  <Send className="size-4" /> Send now
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ id: s.id, s: { ...s } })}>
                  <Pencil className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setRemoving(s)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ScheduleSheet
        editing={editing}
        agents={agents}
        teams={teams}
        members={members}
        canEmailOutside={can(me?.role, 'settings.manage')}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={`Delete “${removing?.name}”?`}
        description="Nobody gets it any more. Reports already sent stay in people’s inboxes."
        confirmLabel="Delete schedule"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const s = removing!
          setRemoving(null)
          try {
            await deleteSchedule(s.id)
            void load()
          } catch (err) {
            toast.error('Couldn’t delete', { description: errorDetail(err) })
          }
        }}
      />
    </PageContainer>
  )
}

function ScheduleSheet({
  editing,
  agents,
  teams,
  members,
  canEmailOutside,
  onClose,
  onSaved,
}: {
  editing: { id: string | null; s: Omit<ReportSchedule, 'id'> } | null
  agents: { id: string; label: string }[]
  teams: Team[]
  members: { userId: string; name: string; email: string }[]
  canEmailOutside: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [s, setS] = useState<Omit<ReportSchedule, 'id'> | null>(null)
  const [shown, setShown] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (editing !== shown) {
    setShown(editing)
    setS(editing?.s ?? null)
    setError(null)
  }
  if (!s) return <Sheet open={false} />
  const patch = (p: Partial<ReportSchedule>) => setS({ ...s, ...p })
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (editing?.id) await updateSchedule(editing.id, s!)
      else await createSchedule(s!)
      toast.success(`${s!.name} saved`)
      onSaved()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{editing?.id ? 'Edit schedule' : 'New scheduled report'}</SheetTitle>
          <SheetDescription>The email has the headline numbers; each chosen report is attached as CSV.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Name</Label>
            <Input id="sched-name" value={s.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label>How often</Label>
              <Select value={s.cadence} onValueChange={(v) => patch({ cadence: v as Cadence })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CADENCE_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>At</Label>
              <Select value={String(s.hour)} onValueChange={(v) => patch({ hour: Number(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, '0')}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Reports to attach</legend>
            {REPORTS.map((r) => (
              <label key={r.id} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={s.reports.includes(r.id)} onCheckedChange={(on) => patch({ reports: toggle(s.reports, r.id, !!on) })} />
                {r.title}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Covering</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!s.numbers.length} onCheckedChange={(on) => on && patch({ numbers: [] })} />
                All agents
              </label>
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={s.numbers.includes(a.id)} onCheckedChange={(on) => patch({ numbers: toggle(s.numbers, a.id, !!on) })} />
                  {a.label}
                </label>
              ))}
            </div>
            {teams.length > 0 && (
              <Select value={s.team ?? 'all'} onValueChange={(v) => patch({ team: v === 'all' ? null : v })}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Send to</legend>
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={s.userIds.includes(m.userId)} onCheckedChange={(on) => patch({ userIds: toggle(s.userIds, m.userId, !!on) })} />
                {m.name} <span className="text-muted-foreground">{m.email}</span>
              </label>
            ))}
            {canEmailOutside && (
              <div className="space-y-1.5 pt-2">
                <Label>Other email addresses</Label>
                <TagInput values={s.emails} onChange={(emails) => patch({ emails })} placeholder="name@company.com, then Enter" aria-label="Other email addresses" />
              </div>
            )}
          </fieldset>
          <label className="flex items-center gap-2.5 text-sm">
            <Switch checked={s.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
            {s.enabled ? 'On' : 'Paused'}
          </label>
          {error && <FormError>{error}</FormError>}
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save schedule
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
