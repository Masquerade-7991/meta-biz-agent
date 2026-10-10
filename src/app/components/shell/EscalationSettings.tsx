import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Bell, ChevronsUp, Mail, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getEscalation, getSupportSettings, listTeams, PRIORITIES, PRIORITY_CLASS, PRIORITY_LABEL, saveEscalation, type EscalationMatrix, type Priority, type SupportSettings, type Team } from '@/app/api/tickets'
import { describeLevel, MAX_LEVELS, notifyLabel, type EscalationLevel, type Notify } from '@/app/support/routing'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { SettingsSection } from './SettingsSection'

const dur = (min: number) => (min < 60 ? `${Math.round(min)} min` : min < 60 * 48 ? `${Math.round((min / 60) * 10) / 10} h` : `${Math.round(min / 1440)} d`)
const blankLevel = (): EscalationLevel => ({ clock: 'resolution', percent: 100, notify: ['assignee', 'team_lead'], email: false, reassignTeamId: null, raisePriority: false })

/** Settings › Escalation: what happens as a ticket uses up its response targets, per priority, in up to three levels. */
export function EscalationSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const [m, setM] = useState<EscalationMatrix | null>(null)
  const [sla, setSla] = useState<SupportSettings['sla'] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ priority: Priority; index: number; level: EscalationLevel; existing: boolean } | null>(null)

  useEffect(() => {
    Promise.all([getEscalation(), getSupportSettings(), listTeams()]).then(
      ([x, s, t]) => {
        setM(x)
        setSla(s.sla)
        setTeams(t)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [])
  if (!m || !sla) return error ? <FormError>{error}</FormError> : <PageLoader context="settings" className="min-h-[30vh] py-10" />

  async function persist(next: EscalationMatrix, done?: string) {
    const before = m
    setM(next)
    try {
      setM(await saveEscalation(next))
      if (done) toast.success(done)
      return true
    } catch (err) {
      setM(before)
      toast.error('Couldn’t save escalation', { description: errorDetail(err) })
      return false
    }
  }
  const at = (p: Priority, l: EscalationLevel) => dur((sla[p][l.clock === 'first_response' ? 'firstResponse' : 'resolve'] * l.percent) / 100)

  return (
    <div className="min-w-0">
      <SettingsSection
        stacked
        title="Escalation matrix"
        description="As a ticket uses up its response targets, it moves up one level at a time. Each level can alert people, move the ticket to another team or raise its priority. Times count business hours."
      >
        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <Switch checked={m.enabled} disabled={!canEdit} onCheckedChange={(on) => void persist({ ...m, enabled: on }, on ? 'Escalation is on' : 'Escalation is off')} />
          <span>
            <span className="block font-medium">{m.enabled ? 'Escalation is on' : 'Escalation is off'}</span>
            <span className="block text-muted-foreground">{m.enabled ? 'Open tickets are checked every minute.' : 'Tickets still show as overdue, but nobody is alerted and nothing moves.'}</span>
          </span>
        </label>

        <div className={cn('overflow-x-auto', !m.enabled && 'opacity-70')}>
          <table className="w-full min-w-xl border-separate border-spacing-2 text-sm">
            <thead>
              <tr className="text-left text-meta text-muted-foreground">
                <th className="w-32 font-normal">Priority</th>
                {Array.from({ length: MAX_LEVELS }, (_, i) => (
                  <th key={i} className="font-normal">
                    Level {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRIORITIES.map((p) => {
                const levels = m.levels[p]
                return (
                  <tr key={p} className="align-top">
                    <th className="pt-2 text-left font-normal">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_CLASS[p])}>{PRIORITY_LABEL[p]}</span>
                      <span className="mt-1.5 block text-meta text-muted-foreground">
                        <span className="block whitespace-nowrap">Reply {dur(sla[p].firstResponse)}</span>
                        <span className="block whitespace-nowrap">Resolve {dur(sla[p].resolve)}</span>
                      </span>
                    </th>
                    {Array.from({ length: MAX_LEVELS }, (_, i) => {
                      const l = levels[i]
                      if (l)
                        return (
                          <td key={i}>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setEditing({ priority: p, index: i, level: { ...l }, existing: true })}
                              className="w-full space-y-1.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-border-strong disabled:cursor-default"
                            >
                              <span className="block font-medium">{describeLevel(l)}</span>
                              <span className="block text-meta text-muted-foreground">≈ {at(p, l)} after opening</span>
                              <span className="flex flex-wrap gap-1">
                                {l.notify.map((n) => (
                                  <Chip key={n} icon={Bell}>
                                    {notifyLabel[n]}
                                  </Chip>
                                ))}
                                {l.email && <Chip icon={Mail}>Email</Chip>}
                                {l.reassignTeamId && <Chip icon={Users}>To {teams.find((t) => t.id === l.reassignTeamId)?.name ?? 'team'}</Chip>}
                                {l.raisePriority && <Chip icon={ChevronsUp}>Raise priority</Chip>}
                              </span>
                            </button>
                          </td>
                        )
                      if (i === levels.length && canEdit)
                        return (
                          <td key={i}>
                            <button
                              type="button"
                              onClick={() => setEditing({ priority: p, index: i, level: { ...blankLevel(), percent: levels.at(-1) ? Math.min(500, levels.at(-1)!.percent + 25) : 100 }, existing: false })}
                              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong p-3 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <Plus className="size-4" /> Add level
                            </button>
                          </td>
                        )
                      return <td key={i} />
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <LevelSheet
        editing={editing}
        teams={teams}
        sla={sla}
        onClose={() => setEditing(null)}
        onSave={async (lv) => {
          const e = editing!
          const list = [...m.levels[e.priority]]
          list[e.index] = lv
          if (await persist({ ...m, levels: { ...m.levels, [e.priority]: list } }, 'Escalation saved')) setEditing(null)
        }}
        onRemove={async () => {
          const e = editing!
          // Later levels move up one, so levels stay in order without gaps.
          if (await persist({ ...m, levels: { ...m.levels, [e.priority]: m.levels[e.priority].filter((_, j) => j !== e.index) } }, 'Level removed')) setEditing(null)
        }}
      />
    </div>
  )
}

function Chip({ icon: Icon, children }: { icon: typeof Bell; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
      <Icon className="size-3" />
      {children}
    </span>
  )
}

function LevelSheet({
  editing,
  teams,
  sla,
  onClose,
  onSave,
  onRemove,
}: {
  editing: { priority: Priority; index: number; level: EscalationLevel; existing: boolean } | null
  teams: Team[]
  sla: SupportSettings['sla']
  onClose: () => void
  onSave: (l: EscalationLevel) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [l, setL] = useState<EscalationLevel>(blankLevel)
  const [shown, setShown] = useState(editing)
  const [busy, setBusy] = useState(false)
  if (editing !== shown) {
    setShown(editing)
    if (editing) setL(editing.level)
  }
  const set = (patch: Partial<EscalationLevel>) => setL((x) => ({ ...x, ...patch }))
  const target = editing ? sla[editing.priority][l.clock === 'first_response' ? 'firstResponse' : 'resolve'] : 0
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? `${PRIORITY_LABEL[editing.priority]} · level ${editing.index + 1}` : 'Level'}</SheetTitle>
          <SheetDescription>Fires once per ticket, after the level before it.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">When</legend>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Select value={l.clock} onValueChange={(v) => set({ clock: v as EscalationLevel['clock'] })}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first_response">First reply target</SelectItem>
                  <SelectItem value="resolution">Resolution target</SelectItem>
                </SelectContent>
              </Select>
              is
              <Input type="number" min={25} max={500} step={5} className="h-8 w-20" value={l.percent} onChange={(e) => set({ percent: Number(e.target.value) })} aria-label="Percent of the target" />
              % used
            </div>
            <p className="text-meta text-muted-foreground">
              {l.percent === 100 ? 'At the moment the target is missed' : l.percent < 100 ? 'Before the target is missed' : 'After the target was missed'}, about {dur((target * l.percent) / 100)} after the ticket opened. 100% = breach.
            </p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Alert</legend>
            {(Object.keys(notifyLabel) as Notify[]).map((n) => (
              <label key={n} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={l.notify.includes(n)} onCheckedChange={(on) => set({ notify: on ? [...l.notify, n] : l.notify.filter((x) => x !== n) })} />
                {notifyLabel[n]}
              </label>
            ))}
            <label className="flex items-center gap-2.5 pt-1 text-sm">
              <Switch checked={l.email} onCheckedChange={(email) => set({ email })} />
              Also email them (not just the bell)
            </label>
          </fieldset>
          <div className="space-y-1.5">
            <Label>Move the ticket</Label>
            <Select value={l.reassignTeamId ?? 'stay'} onValueChange={(v) => set({ reassignTeamId: v === 'stay' ? null : v })}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stay">Keep it where it is</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    To {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <Switch checked={l.raisePriority} onCheckedChange={(raisePriority) => set({ raisePriority })} />
            Raise the priority one step
          </label>
        </SheetBody>
        <SheetFooter>
          {editing?.existing && (
            <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => void run(onRemove)}>
              <Trash2 className="size-4" /> Remove level
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void run(() => onSave(l))}>
            Save level
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
