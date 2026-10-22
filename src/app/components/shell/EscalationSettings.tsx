import { useEffect, useState, type ReactNode } from 'react'
import { Bell, ChevronsUp, Mail, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { getEscalation, getSupportSettings, listTeams, PRIORITIES, PRIORITY_CLASS, PRIORITY_LABEL, saveEscalation, type Level, type Matrix, type Priority, type SupportSettings, type Team } from '@/app/api/tickets'
import { describeLevel, MAX_LEVELS, notifyLabel, parseMatrix, type Notify } from '@/app/support/routing'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { SettingsSection } from './SettingsSection'
import { ConflictBanner, LastChanged, LoadGate, ReadOnlyNote, SettingsLink } from './settings/SettingsUi'
import { useChainedList } from './settings/useChainedList'
import { confirmLeave, useLeaveGuard } from './settings/leaveGuard'
import { same } from './settings/formCore'

const dur = (min: number) => (min < 60 ? `${Math.round(min)} min` : min < 60 * 48 ? `${Math.round((min / 60) * 10) / 10} h` : `${Math.round(min / 1440)} d`)
type EscalationLevel = Level
const blankLevel = (): EscalationLevel => ({ clock: 'resolution', percent: 100, notify: ['assignee', 'team_lead'], email: false, reassignTeamId: null, raisePriority: false })

/** The same checks the server runs (src/app/support/routing.ts), so a bad level is caught in the form. */
function matrixProblem(m: Matrix, teams: Team[]): string | null {
  try {
    parseMatrix(m, new Set(teams.map((t) => t.id)))
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
type Editing = { priority: Priority; index: number; level: EscalationLevel; existing: boolean }

/** Settings › Escalation: what happens as a ticket uses up its response targets, per priority, in up
 *  to three levels. Each level keeps its id, so editing the matrix never skips or repeats a level on
 *  a ticket already on its way. Changes save at once, one at a time (useChainedList). */
export function EscalationSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const [sla, setSla] = useState<SupportSettings['sla'] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirm, setConfirm] = useState<'off' | 'remove' | null>(null)
  const list = useChainedList<Matrix>({
    load: () => getEscalation().then((r) => ({ value: r.matrix, stamp: r.stamp })),
    save: (m, since) => saveEscalation(m, since).then((r) => ({ value: r.matrix, stamp: r.stamp })),
    failTitle: 'Couldn’t save escalation',
  })
  const [slaError, setSlaError] = useState<string | null>(null)
  const loadSla = () => {
    setSlaError(null)
    getSupportSettings().then((s) => setSla(s.sla), (err: Error) => setSlaError(err.message))
  }
  useEffect(() => {
    loadSla()
    listTeams().then(setTeams, () => {})
  }, [])
  const m = list.value
  if (!m || !sla) return <LoadGate error={list.loadError ?? slaError} onRetry={() => (list.reload(), loadSla())} what="the escalation matrix" />

  const at = (p: Priority, l: EscalationLevel) => dur((sla[p][l.clock === 'first_response' ? 'firstResponse' : 'resolve'] * l.percent) / 100)
  const levelCard = (p: Priority, l: EscalationLevel, i: number) => (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing({ priority: p, index: i, level: { ...l }, existing: true })}
      className="w-full space-y-1.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-border-strong disabled:cursor-default"
    >
      <span className="block text-meta text-muted-foreground md:hidden">Level {i + 1}</span>
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
  )
  const addButton = (p: Priority) => {
    const levels = m.levels[p]
    return (
      <button
        type="button"
        onClick={() => setEditing({ priority: p, index: levels.length, level: { ...blankLevel(), percent: levels.at(-1) ? Math.min(500, levels.at(-1)!.percent + 25) : 100 }, existing: false })}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong p-3 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-4" /> Add level
      </button>
    )
  }
  const withLevel = (e: Editing, lv: EscalationLevel | null): Matrix => {
    const levels = [...m.levels[e.priority]]
    if (lv) levels[e.index] = lv
    else levels.splice(e.index, 1)
    return { ...m, levels: { ...m.levels, [e.priority]: levels } }
  }

  return (
    <div className="min-w-0">
      {!canEdit && <ReadOnlyNote />}
      {list.conflict && <ConflictBanner onReload={list.reload} onKeepMine={list.keepMine} />}
      <SettingsSection
        stacked
        title="Escalation matrix"
        description="As a ticket uses up its response targets, it moves up one level at a time. Each level can alert people, move the ticket to another team or raise its priority. Times count business hours."
      >
        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <Switch checked={m.enabled} disabled={!canEdit} onCheckedChange={(on) => (on ? void list.change((v) => ({ ...v, enabled: true }), 'Escalation is on') : setConfirm('off'))} />
          <span>
            <span className="block font-medium">{m.enabled ? 'Escalation is on' : 'Escalation is off'}</span>
            <span className="block text-muted-foreground">{m.enabled ? 'Open tickets are checked every minute.' : 'Tickets still show as overdue, but nobody is alerted and nothing moves.'}</span>
          </span>
        </label>

        {/* Wide screens: a table, priorities down and levels across. Phones: one card per priority. */}
        <div className={cn('hidden overflow-x-auto md:block', !m.enabled && 'opacity-70')}>
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
                    {Array.from({ length: MAX_LEVELS }, (_, i) => (
                      <td key={levels[i]?.id ?? i}>{levels[i] ? levelCard(p, levels[i], i) : i === levels.length && canEdit ? addButton(p) : null}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ul className={cn('space-y-3 md:hidden', !m.enabled && 'opacity-70')}>
          {PRIORITIES.map((p) => {
            const levels = m.levels[p]
            return (
              <li key={p} className="space-y-2 rounded-lg border border-border p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_CLASS[p])}>{PRIORITY_LABEL[p]}</span>
                  <span className="text-meta text-muted-foreground">
                    Reply {dur(sla[p].firstResponse)} · Resolve {dur(sla[p].resolve)}
                  </span>
                </p>
                {levels.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">No levels.</p>}
                {levels.map((l, i) => (
                  <div key={l.id ?? i}>{levelCard(p, l, i)}</div>
                ))}
                {levels.length < MAX_LEVELS && canEdit && addButton(p)}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Targets come from <SettingsLink tab="support">Hours &amp; targets</SettingsLink>; team leads from <SettingsLink tab="teams">Teams &amp; people</SettingsLink>.
            {list.saving && ' Saving…'}
          </p>
          <LastChanged stamp={list.stamp} />
        </div>
      </SettingsSection>

      <LevelSheet
        editing={editing}
        teams={teams}
        sla={sla}
        problem={(lv) => (editing ? matrixProblem(withLevel(editing, lv), teams) : null)}
        onClose={() => setEditing(null)}
        onSave={async (lv) => {
          const e = editing!
          if (await list.change(() => withLevel(e, lv), 'Escalation saved')) setEditing(null)
        }}
        onRemove={() => setConfirm('remove')}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'off' ? 'Turn escalation off?' : `Remove ${editing ? `${PRIORITY_LABEL[editing.priority].toLowerCase()} level ${editing.index + 1}` : 'this level'}?`}
        description={
          confirm === 'off'
            ? 'Tickets still show as overdue, but nobody is alerted and nothing moves until you turn it back on.'
            : 'Later levels move up one. Tickets that already reached this level don’t get it again.'
        }
        confirmLabel={confirm === 'off' ? 'Turn off' : 'Remove level'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm
          setConfirm(null)
          if (c === 'off') return void list.change((v) => ({ ...v, enabled: false }), 'Escalation is off')
          const e = editing
          if (e && (await list.change(() => withLevel(e, null), 'Level removed'))) setEditing(null)
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
  problem,
  onClose,
  onSave,
  onRemove,
}: {
  editing: Editing | null
  teams: Team[]
  sla: SupportSettings['sla']
  /** What the server would refuse about the matrix with this level in it. */
  problem: (l: EscalationLevel) => string | null
  onClose: () => void
  onSave: (l: EscalationLevel) => Promise<void>
  onRemove: () => void
}) {
  const [l, setL] = useState<EscalationLevel>(blankLevel)
  const [shown, setShown] = useState(editing)
  const [busy, setBusy] = useState(false)
  if (editing !== shown) {
    setShown(editing)
    if (editing) setL(editing.level)
  }
  const set = (patch: Partial<EscalationLevel>) => setL((x) => ({ ...x, ...patch }))
  const changed = !!editing && !same(l, editing.level)
  useLeaveGuard('level-sheet', changed)
  const close = () => void confirmLeave().then((ok) => ok && onClose())
  const pct = Number.isFinite(l.percent) && Number.isInteger(l.percent) && l.percent >= 25 && l.percent <= 500
  const noAction = !l.notify.length && !l.reassignTeamId && !l.raisePriority
  const issue = !pct ? 'Fire between 25% and 500% of the target, in whole percent.' : noAction ? 'This level does nothing: alert someone, move the ticket or raise its priority.' : problem(l)
  const target = editing ? sla[editing.priority][l.clock === 'first_response' ? 'firstResponse' : 'resolve'] : 0
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }
  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && close()}>
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
              <Input inputMode="numeric" className="h-8 w-20" value={Number.isFinite(l.percent) ? l.percent : ''} onChange={(e) => set({ percent: e.target.value.trim() === '' ? Number.NaN : Number(e.target.value.replace(/[^\d]/g, '')) })} aria-label="Percent of the target" aria-invalid={!pct} />
              % used
            </div>
            <p className="text-meta text-muted-foreground">
              {!pct ? '25% to 500%. ' : `${l.percent === 100 ? 'At the moment the target is missed' : l.percent < 100 ? 'Before the target is missed' : 'After the target was missed'}, about ${dur((target * l.percent) / 100)} after the ticket opened. `}100% = breach.
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
          {issue && <p className="w-full text-sm text-destructive">{issue}</p>}
          {editing?.existing && (
            <Button variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={onRemove}>
              <Trash2 className="size-4" /> Remove level
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || !!issue} onClick={() => void run(() => onSave(l))}>
            Save level
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
