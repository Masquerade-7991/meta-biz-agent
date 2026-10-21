import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { EmptyState, SectionHeader } from '@/app/components/ui/page'
import { TagInput } from '@/app/components/wizard/TagInput'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { createSchedule, deleteSchedule, listSchedules, sendScheduleNow, updateSchedule } from '@/app/api/reports'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { AgentsFilter, TeamFilter } from '@/app/analytics/FilterBar'
import type { Team } from '@/app/api/tickets'
import { blankSchedule, CADENCE_LABEL, REPORT_GROUPS, REPORTS, reportOf, type Cadence, type ReportSchedule } from './catalog'

type Draft = Omit<ReportSchedule, 'id'>
/** The period each email covers, in words (scheduleRange computes it). */
const COVERS: Record<Cadence, string> = { daily: 'yesterday', weekly: 'the last full week, Monday to Sunday', monthly: 'last month' }
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** Reports emailed on a schedule: the headline numbers in the email, each chosen report attached as CSV. */
export function Schedules({
  meId,
  agents,
  teams,
  members,
  canEmailOutside,
  start,
  onStarted,
}: {
  meId: string | undefined
  agents: { id: string; label: string }[]
  teams: Team[]
  members: { userId: string; name: string; email: string }[]
  canEmailOutside: boolean
  /** Open the sheet for a new schedule with these values (e.g. from Analytics). */
  start: Draft | null
  onStarted: () => void
}) {
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; s: Draft } | null>(null)
  const [removing, setRemoving] = useState<ReportSchedule | null>(null)
  const load = useCallback(
    () =>
      listSchedules().then(
        (x) => {
          setSchedules(x)
          setError(null)
        },
        (err) => setError(errorDetail(err)),
      ),
    [],
  )
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (!start) return
    setEditing({ id: null, s: start })
    onStarted()
  }, [start, onStarted])

  return (
    <div>
      <SectionHeader
        title="Your schedules"
        description="The headline numbers in the email, each chosen report attached as CSV. Times are in your business hours’ time zone."
        actions={
          <Button size="sm" onClick={() => setEditing({ id: null, s: blankSchedule(meId) })}>
            <Plus className="size-4" /> New schedule
          </Button>
        }
      />
      {error && !schedules ? (
        <InlineError message={`Couldn’t load the schedules. ${error}`} onRetry={() => void load()} />
      ) : !schedules ? (
        <PageLoader context="analytics" className="min-h-32" />
      ) : !schedules.length ? (
        <EmptyState icon={CalendarClock} title="No scheduled emails" description="Send a weekly business review to your managers every Monday, for example." />
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => {
            const to = s.userIds.length + s.emails.length
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" data-density-row>
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name} {!s.enabled && <span className="ml-1 rounded bg-muted px-1.5 text-xs font-normal text-muted-foreground">Paused</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {CADENCE_LABEL[s.cadence]} at {String(s.hour).padStart(2, '0')}:00 · {s.reports.map((id) => reportOf(id).title).join(', ')} · to {people(to)}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {s.nextRunAt ? `Next: ${when(s.nextRunAt)}` : 'Not scheduled'}
                    {s.lastSentAt && ` · Last sent ${when(s.lastSentAt)}`}
                  </p>
                  {s.lastError && (
                    <p className="text-meta text-destructive">
                      {s.lastFailedAt && `${when(s.lastFailedAt)}: `}
                      {s.lastError}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const r = await sendScheduleNow(s.id)
                        toast.success(`Sent to ${people(r.sent)}`)
                      } catch (err) {
                        toast.error('Couldn’t send', { description: errorDetail(err) })
                      }
                      void load()
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
            )
          })}
        </ul>
      )}

      <ScheduleSheet
        editing={editing}
        agents={agents}
        teams={teams}
        members={members}
        canEmailOutside={canEmailOutside}
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
    </div>
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
  editing: { id: string | null; s: Draft } | null
  agents: { id: string; label: string }[]
  teams: Team[]
  members: { userId: string; name: string; email: string }[]
  canEmailOutside: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [s, setS] = useState<Draft | null>(null)
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
          <SheetTitle>{editing?.id ? 'Edit schedule' : 'New scheduled email'}</SheetTitle>
          <SheetDescription>The email has the headline numbers; each chosen report is attached as CSV.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Name</Label>
            <Input id="sched-name" value={s.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
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
            <p className="text-meta text-muted-foreground">Each email covers {COVERS[s.cadence]}.</p>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">Reports to attach</legend>
            {REPORT_GROUPS.map((g) => (
              <div key={g.id} className="space-y-2">
                <p className="text-meta text-muted-foreground">{g.title}</p>
                {REPORTS.filter((r) => r.group === g.id).map((r) => (
                  <label key={r.id} className="flex items-center gap-2.5 text-sm">
                    <Checkbox checked={s.reports.includes(r.id)} onCheckedChange={(on) => patch({ reports: toggle(s.reports, r.id, !!on) })} />
                    {r.title}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Covering</legend>
            <div className="flex flex-wrap gap-2">
              <AgentsFilter agents={agents} value={s.numbers} onChange={(numbers) => patch({ numbers })} />
              <TeamFilter teams={teams} value={s.team} onChange={(team) => patch({ team })} />
            </div>
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
