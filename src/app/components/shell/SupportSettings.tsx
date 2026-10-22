import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Textarea } from '@/app/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/app/components/ui/command'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getSupportSettings, listTeams, PRIORITIES, PRIORITY_LABEL, recomputeDeadlines, saveSupportSettings, type Day, type SupportSettings, type Team } from '@/app/api/tickets'
import { useMembers } from '@/app/auth/useMembers'
import { ALL_DAY, DAY_LABEL, DAY_ORDER, holidayOf, hoursErrors, isAllDay, noHours, pastHoliday, timeZones, validDate } from '@/app/support/hoursRules'
import { SettingsSection } from './SettingsSection'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { FormFooter, LoadGate, ReadOnlyNote, SettingsLink } from './settings/SettingsUi'
import { same, stampOf } from './settings/formCore'
import { useSettingsForm } from './settings/useSettingsForm'

const hours = (min: number) => (!Number.isFinite(min) || min <= 0 ? '' : min % 60 === 0 ? `${min / 60}h` : `${min}m`)
const KEYS = ['hours', 'twentyFourSeven', 'awayMessage', 'sla', 'routing', 'csat'] as const
type Form = Pick<SupportSettings, (typeof KEYS)[number]>
const formOf = (s: SupportSettings): Form => ({ hours: s.hours, twentyFourSeven: !!s.twentyFourSeven, awayMessage: s.awayMessage, sla: s.sla, routing: s.routing, csat: s.csat })
const shortDate = (d: string, yearly: boolean) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short', ...(!yearly && { year: 'numeric' }) })

/** A searchable list of every time zone. */
function TimeZonePicker({ value, onChange, invalid }: { value: string; onChange: (z: string) => void; invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const zones = useMemo(timeZones, [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Time zone" aria-invalid={invalid} className="w-full max-w-xs justify-between font-normal">
          <span className="truncate">{value.replace(/_/g, ' ')}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search a city or zone…" />
          <CommandList>
            <CommandEmpty>No time zone matches.</CommandEmpty>
            {zones.map((z) => (
              <CommandItem
                key={z}
                value={z}
                onSelect={() => {
                  onChange(z)
                  setOpen(false)
                }}
              >
                <Check className={cn('size-4', z === value ? 'opacity-100' : 'opacity-0')} />
                {z.replace(/_/g, ' ')}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const FieldError = ({ children }: { children?: string }) => (children ? <p className="text-xs text-destructive">{children}</p> : null)

/** Settings › Hours & targets: when the team works, how fast it answers, who gets new tickets, and feedback. */
export function SupportSettingsTab() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const members = useMembers()
  const [teams, setTeams] = useState<Team[]>([])
  const [extra, setExtra] = useState<{ listenOnly: boolean; openTickets: number | null }>({ listenOnly: false, openTickets: null })
  const [holiday, setHoliday] = useState({ date: '', name: '', yearly: false })
  const [askNoHours, setAskNoHours] = useState(false)
  // Saved new hours or targets: open tickets keep their deadlines unless recomputed.
  const [recompute, setRecompute] = useState<number | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const form = useSettingsForm<Form, { confirmNoHours: boolean }>({
    load: () =>
      getSupportSettings().then((s) => {
        setExtra({ listenOnly: !!s.listenOnly, openTickets: s.openTickets ?? null })
        return { value: formOf(s), stamp: stampOf(s) }
      }),
    save: async (v, since, x) => {
      const before = form.saved
      const s = await saveSupportSettings({ ...v, ...(x?.confirmNoHours && { confirmNoHours: true }) }, since)
      setExtra({ listenOnly: !!s.listenOnly, openTickets: s.openTickets ?? null })
      const clocks = !before || !same(before.hours, v.hours) || !same(before.sla, v.sla) || before.twentyFourSeven !== v.twentyFourSeven
      setRecompute(clocks && (s.openTickets ?? 0) > 0 ? (s.openTickets ?? 0) : null)
      return { value: formOf(s), stamp: stampOf(s) }
    },
    validate: hoursErrors,
  })
  useEffect(() => {
    listTeams().then(setTeams, () => {})
  }, [])
  if (form.state !== 'ready' || !form.draft) return <LoadGate error={form.loadError} onRetry={form.reload} what="hours and targets" />

  const s = form.draft
  const err = form.errors
  const set = form.set
  const setDay = (d: Day, v: { open: string; close: string } | null) => set({ hours: { ...s.hours, week: { ...s.hours.week, [d]: v } } })
  const setSla = (p: (typeof PRIORITIES)[number], k: 'firstResponse' | 'resolve', v: number) => set({ sla: { ...s.sla, [p]: { ...s.sla[p], [k]: v } } })
  const holidays = s.hours.holidays.map(holidayOf)
  const holidayProblem = !holiday.date ? null : !validDate(holiday.date) ? 'That isn’t a real date.' : pastHoliday(holiday.date, holiday.yearly) ? 'That day has passed. Tick Every year for one that repeats.' : holidays.some((h) => h.date === holiday.date) ? 'That day is already a holiday.' : null
  const save = () => (noHours(s) ? (setAskNoHours(true), Promise.resolve(false)) : form.save())

  return (
    <div className="min-w-0">
      {!canEdit && <ReadOnlyNote />}
      <fieldset disabled={!canEdit} className="min-w-0">
        <SettingsSection wide title="Business hours" description="Response targets only count while your team is working. Outside these hours, customers can get an away message.">
          <div className="space-y-1.5">
            <Label>Time zone</Label>
            <TimeZonePicker value={s.hours.timezone} onChange={(timezone) => set({ hours: { ...s.hours, timezone } })} invalid={!!err.timezone} />
            <FieldError>{err.timezone}</FieldError>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Open 24/7
              <span className="block text-xs text-muted-foreground">Deadlines run around the clock; the week and holidays below don’t apply.</span>
            </span>
            <Switch checked={!!s.twentyFourSeven} onCheckedChange={(twentyFourSeven) => set({ twentyFourSeven })} />
          </label>
          <ul className={cn('divide-y divide-border rounded-lg border border-border', s.twentyFourSeven && 'opacity-60')}>
            {DAY_ORDER.map((id) => {
              const label = DAY_LABEL[id]
              const w = s.hours.week[id]
              const allDay = isAllDay(w)
              return (
                <li key={id} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch checked={!!w} disabled={s.twentyFourSeven} onCheckedChange={(on) => setDay(id, on ? { open: '09:30', close: '18:30' } : null)} aria-label={`Open on ${label}`} />
                    <span className="w-24 text-sm">{label}</span>
                    {w ? (
                      <>
                        {!allDay && (
                          <span className="flex items-center gap-2 text-sm">
                            <Input type="time" className="h-8 w-34" value={w.open} disabled={s.twentyFourSeven} onChange={(e) => setDay(id, { ...w, open: e.target.value })} aria-label={`${label} opens`} aria-invalid={!!err[`day.${id}`]} />
                            to
                            <Input type="time" className="h-8 w-34" value={w.close === '24:00' ? '23:59' : w.close} disabled={s.twentyFourSeven} onChange={(e) => setDay(id, { ...w, close: e.target.value })} aria-label={`${label} closes`} aria-invalid={!!err[`day.${id}`]} />
                          </span>
                        )}
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox checked={allDay} disabled={s.twentyFourSeven} onCheckedChange={(on) => setDay(id, on ? ALL_DAY : { open: '09:30', close: '18:30' })} />
                          24 hours
                        </label>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </div>
                  <FieldError>{err[`day.${id}`]}</FieldError>
                </li>
              )
            })}
          </ul>
          {noHours(s) && <p className="text-sm text-warning-foreground">Every day is closed, so response deadlines won’t run. Open a day or turn on 24/7.</p>}
          <div className="space-y-2">
            <Label htmlFor="holiday">Holidays</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="holiday" type="date" className="h-9 w-44" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} aria-invalid={!!holidayProblem} />
              <Input className="h-9 w-48" placeholder="Name (optional)" maxLength={60} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} aria-label="Holiday name" />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={holiday.yearly} onCheckedChange={(on) => setHoliday({ ...holiday, yearly: on === true })} />
                Every year
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!holiday.date || !!holidayProblem}
                onClick={() => {
                  const next = [...holidays, { date: holiday.date, name: holiday.name.trim(), yearly: holiday.yearly }].sort((a, z) => a.date.localeCompare(z.date))
                  set({ hours: { ...s.hours, holidays: next.map((h) => ({ date: h.date, ...(h.name && { name: h.name }), ...(h.yearly && { yearly: true }) })) } })
                  setHoliday({ date: '', name: '', yearly: false })
                }}
              >
                Add
              </Button>
            </div>
            <FieldError>{holidayProblem ?? err.holiday}</FieldError>
            {holidays.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {holidays.map((h) => (
                  <li key={h.date} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-3 text-xs">
                    {h.name ? `${h.name} · ` : ''}
                    {validDate(h.date) ? shortDate(h.date, h.yearly) : h.date}
                    {h.yearly && ' (every year)'}
                    <button
                      type="button"
                      aria-label={`Remove ${h.name || h.date}`}
                      onClick={() => set({ hours: { ...s.hours, holidays: s.hours.holidays.filter((x) => holidayOf(x).date !== h.date) } })}
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="away">Away message</Label>
            <Textarea id="away" rows={3} value={s.awayMessage} onChange={(e) => set({ awayMessage: e.target.value })} placeholder="Leave empty to send nothing" />
            <p className="text-xs text-muted-foreground">Sent at most once every 12 hours when a customer writes to your team outside business hours. The AI agent keeps answering chats it holds.</p>
            {extra.listenOnly && <p className="text-xs text-warning-foreground">Not sent on Helo.ai’s own number: this console never messages its customers on its own.</p>}
          </div>
        </SettingsSection>

        <SettingsSection wide title="Response targets" description="How quickly a ticket gets its first reply and gets resolved, in business-time minutes. Tickets show a countdown and the bell warns before they run out.">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Priority</th>
                  <th className="px-3 py-2 font-normal">First reply within</th>
                  <th className="px-3 py-2 font-normal">Resolve within</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PRIORITIES.map((p) => (
                  <tr key={p} className="align-top">
                    <td className="px-3 py-2">{PRIORITY_LABEL[p]}</td>
                    {(['firstResponse', 'resolve'] as const).map((k) => (
                      <td key={k} className="space-y-1 px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Input
                            inputMode="numeric"
                            className="h-8 w-24"
                            value={Number.isFinite(s.sla[p][k]) ? s.sla[p][k] : ''}
                            onChange={(e) => setSla(p, k, e.target.value.trim() === '' ? Number.NaN : Number(e.target.value.replace(/[^\d]/g, '')))}
                            aria-label={`${PRIORITY_LABEL[p]} ${k === 'resolve' ? 'resolve' : 'first reply'} minutes`}
                            aria-invalid={!!err[`sla.${p}.${k}`]}
                          />
                          <span className="text-xs text-muted-foreground">min {hours(s.sla[p][k]) && `(${hours(s.sla[p][k])})`}</span>
                        </span>
                        <FieldError>{err[`sla.${p}.${k}`]}</FieldError>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsSection>

        <SettingsSection wide title="Default routing" description="Who gets a new ticket when no routing rule decides. People set to away or offline are skipped.">
          <RadioGroup value={s.routing.mode} onValueChange={(v) => set({ routing: { ...s.routing, mode: v as SupportSettings['routing']['mode'] } })} className="space-y-2">
            <label className="flex items-start gap-2.5 text-sm">
              <RadioGroupItem value="round_robin" className="mt-0.5" />
              <span className="space-y-2">
                Take turns
                <span className="block text-xs text-muted-foreground">New tickets go to each person in turn.</span>
                {s.routing.mode === 'round_robin' && (
                  <Select value={s.routing.teamId ?? 'everyone'} onValueChange={(v) => set({ routing: { ...s.routing, teamId: v === 'everyone' ? null : v } })}>
                    <SelectTrigger className="h-8 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="everyone">Everyone in the workspace</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name || 'Unnamed team'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <RadioGroupItem value="fixed" className="mt-0.5" />
              <span className="space-y-2">
                Always the same person
                {s.routing.mode === 'fixed' && (
                  <Select value={s.routing.userId ?? undefined} onValueChange={(v) => set({ routing: { ...s.routing, userId: v } })}>
                    <SelectTrigger className="h-8 w-56" aria-invalid={!!err.routing}>
                      <SelectValue placeholder="Pick a person" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FieldError>{err.routing}</FieldError>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <RadioGroupItem value="unassigned" className="mt-0.5" />
              <span>
                Leave unassigned
                <span className="block text-xs text-muted-foreground">Anyone can pick them up from Tickets.</span>
              </span>
            </label>
          </RadioGroup>
          <p className="text-sm text-muted-foreground">
            Routing rules run first; this is what happens when none matches. Manage teams in <SettingsLink tab="teams">Teams &amp; people</SettingsLink> and rules in <SettingsLink tab="routing">Routing rules</SettingsLink>.
          </p>
        </SettingsSection>

        <SettingsSection wide title="Customer feedback" description="After a ticket is resolved, ask the customer how it went with three WhatsApp buttons. Answers show on the ticket.">
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            Ask for feedback when resolving
            <Switch checked={s.csat.enabled} onCheckedChange={(v) => set({ csat: { ...s.csat, enabled: v } })} />
          </label>
          {extra.listenOnly && <p className="text-xs text-warning-foreground">Not asked on Helo.ai’s own number: this console never messages its customers on its own.</p>}
          <div className="space-y-1.5">
            <Label htmlFor="csatq">Question</Label>
            <Input id="csatq" value={s.csat.question} onChange={(e) => set({ csat: { ...s.csat, question: e.target.value } })} maxLength={200} />
            <p className="text-xs text-muted-foreground">Buttons: Good · Okay · Bad</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Who sees which chats is now in <SettingsLink tab="teams">Teams &amp; people</SettingsLink>.
          </p>
        </SettingsSection>
      </fieldset>

      {recompute !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
          <p className="text-sm">
            Applies to new tickets. {recompute} open ticket{recompute === 1 ? '' : 's'} keep{recompute === 1 ? 's' : ''} {recompute === 1 ? 'its' : 'their'} current deadlines.
          </p>
          <span className="flex gap-2">
            <Button
              size="sm"
              disabled={recomputing}
              onClick={() => {
                setRecomputing(true)
                recomputeDeadlines()
                  .then(
                    (r) => {
                      toast.success(`Deadlines updated on ${r.updated} open ticket${r.updated === 1 ? '' : 's'}.`)
                      setRecompute(null)
                    },
                    (e) => toast.error('Couldn’t update the open tickets', { description: errorDetail(e) }),
                  )
                  .finally(() => setRecomputing(false))
              }}
            >
              {recomputing && <Loader2 className="size-3.5 animate-spin" />}
              Apply to open tickets too
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRecompute(null)}>
              Keep them
            </Button>
          </span>
        </div>
      )}
      {canEdit && <FormFooter form={form} onSave={save} />}
      <ConfirmDialog
        open={askNoHours}
        title="Save with every day closed?"
        description="Deadlines won’t run and nothing escalates until a day opens. Customers still get the away message."
        confirmLabel="Save anyway"
        onCancel={() => setAskNoHours(false)}
        onConfirm={() => {
          setAskNoHours(false)
          void form.save({ confirmNoHours: true })
        }}
      />
    </div>
  )
}
