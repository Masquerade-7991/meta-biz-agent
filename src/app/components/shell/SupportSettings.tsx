import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Textarea } from '@/app/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getSupportSettings, listTeams, PRIORITIES, PRIORITY_LABEL, saveSupportSettings, type Day, type SupportSettings, type Team } from '@/app/api/tickets'
import { useMembers } from '@/app/auth/useMembers'
import { SettingsSection } from './SettingsSection'
import { can } from '@/app/lib/permissions'
import { PageLoader } from '@/app/components/ui/wavy-loader'

const DAYS: { id: Day; label: string }[] = [
  { id: 'mon', label: 'Monday' },
  { id: 'tue', label: 'Tuesday' },
  { id: 'wed', label: 'Wednesday' },
  { id: 'thu', label: 'Thursday' },
  { id: 'fri', label: 'Friday' },
  { id: 'sat', label: 'Saturday' },
  { id: 'sun', label: 'Sunday' },
]
const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']
const hours = (min: number) => (min % 60 === 0 ? `${min / 60}h` : `${min}m`)


/** Settings → Support: when the team works, how fast it answers, who gets new tickets, and feedback. */
export function SupportSettingsTab() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const [s, setS] = useState<SupportSettings | null>(null)
  const members = useMembers()
  const [holiday, setHoliday] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  useEffect(() => {
    getSupportSettings().then(setS, (err) => setError(errorDetail(err)))
    listTeams().then(setTeams, () => {})
  }, [])
  if (!s)
    return error ? (
      <FormError>{error}</FormError>
    ) : (
      <PageLoader context="settings" className="min-h-[30vh] py-10" />
    )

  const set = (patch: Partial<SupportSettings>) => setS({ ...s, ...patch })
  const setDay = (d: Day, v: { open: string; close: string } | null) => set({ hours: { ...s.hours, week: { ...s.hours.week, [d]: v } } })
  const setSla = (p: (typeof PRIORITIES)[number], k: 'firstResponse' | 'resolve', v: number) => set({ sla: { ...s.sla, [p]: { ...s.sla[p], [k]: v } } })

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { aiSummary: _a, ...body } = s!
      setS(await saveSupportSettings(body))
      toast.success('Support settings saved.')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset disabled={!canEdit} className="min-w-0">
      {!canEdit && (
        <p className="mb-2 rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
          Only owners and admins can change these settings.
        </p>
      )}
      <SettingsSection wide title="Business hours" description="Response-time targets only count while your team is working. Outside these hours, customers can get an away message.">
        <div className="max-w-xs space-y-1.5">
          <Label>Time zone</Label>
          <Select value={s.hours.timezone} onValueChange={(v) => set({ hours: { ...s.hours, timezone: v } })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([s.hours.timezone, ...ZONES])].map((z) => (
                <SelectItem key={z} value={z}>
                  {z.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {DAYS.map(({ id, label }) => {
            const w = s.hours.week[id]
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Switch checked={!!w} onCheckedChange={(on) => setDay(id, on ? { open: '09:30', close: '18:30' } : null)} aria-label={`Open on ${label}`} />
                <span className="w-24 text-sm">
                  {label}
                </span>
                {w ? (
                  <span className="flex items-center gap-2 text-sm">
                    <Input type="time" className="h-8 w-34" value={w.open} onChange={(e) => setDay(id, { ...w, open: e.target.value })} aria-label={`${label} opens`} />
                    to
                    <Input type="time" className="h-8 w-34" value={w.close} onChange={(e) => setDay(id, { ...w, close: e.target.value })} aria-label={`${label} closes`} />
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    Closed
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <div className="space-y-2">
          <Label htmlFor="holiday">Holidays</Label>
          <div className="flex gap-2">
            <Input id="holiday" type="date" className="h-9 w-44" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!holiday}
              onClick={() => {
                set({ hours: { ...s.hours, holidays: [...new Set([...s.hours.holidays, holiday])].sort() } })
                setHoliday('')
              }}
            >
              Add
            </Button>
          </div>
          {s.hours.holidays.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {s.hours.holidays.map((d) => (
                <li key={d} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-3 text-xs">
                  {new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                  <button type="button" aria-label={`Remove ${d}`} onClick={() => set({ hours: { ...s.hours, holidays: s.hours.holidays.filter((x) => x !== d) } })} className="rounded-full p-0.5 hover:bg-background">
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
          <p className="text-muted-foreground text-xs">
            Sent at most once every 12 hours when a customer writes to your team outside business hours. The AI agent keeps answering chats it holds.
          </p>
          {s.listenOnly && <p className="text-xs text-warning-foreground">Not sent on Helo.ai’s own number: this console never messages its customers on its own.</p>}
        </div>
      </SettingsSection>

      <SettingsSection wide title="Response targets" description="How quickly a ticket gets its first reply and gets resolved, in business-time minutes. Tickets show a countdown and the bell warns before they run out.">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 font-normal">Priority</th>
                <th className="px-3 py-2 font-normal">First reply within</th>
                <th className="px-3 py-2 font-normal">Resolve within</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PRIORITIES.map((p) => (
                <tr key={p}>
                  <td className="px-3 py-2">{PRIORITY_LABEL[p]}</td>
                  {(['firstResponse', 'resolve'] as const).map((k) => (
                    <td key={k} className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Input type="number" min={1} className="h-8 w-24" value={s.sla[p][k]} onChange={(e) => setSla(p, k, Number(e.target.value))} aria-label={`${PRIORITY_LABEL[p]} ${k === 'resolve' ? 'resolve' : 'first reply'} minutes`} />
                        <span className="text-muted-foreground text-xs">
                          min ({hours(s.sla[p][k] || 0)})
                        </span>
                      </span>
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
              <span className="block text-muted-foreground text-xs">
                New tickets go to each person in turn.
              </span>
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
                  <SelectTrigger className="h-8 w-56">
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
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <RadioGroupItem value="unassigned" className="mt-0.5" />
            <span>
              Leave unassigned
              <span className="block text-muted-foreground text-xs">
                Anyone can pick them up from Tickets.
              </span>
            </span>
          </label>
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          Routing rules run first; this is what happens when none matches. Manage teams in Teams &amp; people and rules in Routing rules.
        </p>
      </SettingsSection>

      <SettingsSection wide title="Customer feedback" description="After a ticket is resolved, ask the customer how it went with three WhatsApp buttons. Answers show on the ticket.">
        <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
          Ask for feedback when resolving
          <Switch checked={s.csat.enabled} onCheckedChange={(v) => set({ csat: { ...s.csat, enabled: v } })} />
        </label>
        {s.listenOnly && <p className="text-xs text-warning-foreground">Not asked on Helo.ai’s own number: this console never messages its customers on its own.</p>}
        <div className="space-y-1.5">
          <Label htmlFor="csatq">Question</Label>
          <Input id="csatq" value={s.csat.question} onChange={(e) => set({ csat: { ...s.csat, question: e.target.value } })} maxLength={200} />
          <p className="text-muted-foreground text-xs">
            Buttons: Good · Okay · Bad
          </p>
        </div>
      </SettingsSection>

      <SettingsSection wide title="Who sees which chats" description="Supervisors, admins and owners always see every chat. Agents see everything too, unless you limit them here.">
        <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
          <span>
            Agents see only chats and tickets assigned to them, plus unassigned ones
            <span className="block text-muted-foreground text-xs">
              Useful when agents shouldn&rsquo;t read each other&rsquo;s customers. They can still pick up unassigned work.
            </span>
          </span>
          <Switch checked={!!s.restrictAgents} onCheckedChange={(v) => set({ restrictAgents: v })} />
        </label>
      </SettingsSection>

      {canEdit && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background py-4">
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save support settings
          </Button>
          {error && <FormError>{error}</FormError>}
        </div>
      )}
    </fieldset>
  )
}
