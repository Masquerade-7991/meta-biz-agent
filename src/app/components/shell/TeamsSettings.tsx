import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Switch } from '@/app/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { EmptyState } from '@/app/components/ui/page'
import { TagInput } from '@/app/components/wizard/TagInput'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { createTeam, deleteTeam, getSupportSettings, listAgents, listTeams, saveSupportSettings, updateAgent, updateTeam, type AgentRow, type Team } from '@/app/api/tickets'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { SettingsSection } from './SettingsSection'
import { FormFooter, LoadGate, ReadOnlyNote, SettingsLink } from './settings/SettingsUi'
import { stampOf } from './settings/formCore'
import { useSettingsForm } from './settings/useSettingsForm'
import { useLeaveGuard } from './settings/leaveGuard'

const ASSIGN: { id: Team['assign']; label: string; hint: string }[] = [
  { id: 'least_busy', label: 'Least busy first', hint: 'The person with the fewest open tickets gets the next one.' },
  { id: 'round_robin', label: 'Take turns', hint: 'Each person in turn.' },
  { id: 'queue', label: 'Team queue', hint: 'Nobody is picked; the team takes tickets from its queue.' },
]
const AVAILABILITY = [
  { id: 'online', label: 'Available', dot: 'bg-success' },
  { id: 'away', label: 'Away', dot: 'bg-warning' },
  { id: 'offline', label: 'Offline', dot: 'bg-muted-foreground' },
] as const
const blankTeam = (): Omit<Team, 'id'> => ({ name: '', description: '', leadId: null, memberIds: [], assign: 'least_busy' })

/** Settings › Teams & people: who works together, and each person's skills, limit and availability. */
export function TeamsSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [people, setPeople] = useState<AgentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; team: Omit<Team, 'id'> } | null>(null)
  const [removing, setRemoving] = useState<Team | null>(null)
  // One person's skills and limit, edited together and saved once.
  const [row, setRow] = useState<{ userId: string; skills: string[]; maxOpen: string } | null>(null)
  const [rowBusy, setRowBusy] = useState(false)
  const rowLimit = row ? (row.maxOpen.trim() === '' ? null : Number(row.maxOpen)) : null
  const rowError = row && rowLimit !== null && !(Number.isInteger(rowLimit) && rowLimit >= 1 && rowLimit <= 500) ? 'A whole number from 1 to 500, or empty for no limit.' : null
  const rowPerson = row ? people.find((p) => p.userId === row.userId) : null
  useLeaveGuard('teams-person', !!row && !!rowPerson && (row.skills.join() !== rowPerson.skills.join() || rowLimit !== rowPerson.maxOpen))

  const load = useCallback(() => {
    setError(null)
    Promise.all([listTeams(), listAgents()]).then(
      ([t, p]) => {
        setTeams(t)
        setPeople(p)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])

  if (!teams) return <LoadGate error={error} onRetry={load} what="teams and people" />
  const nameOf = (id: string | null) => people.find((p) => p.userId === id)?.name || 'Someone'

  /** Availability changes at once; a failure puts back only that person's earlier status. */
  async function setAvailability(userId: string, availability: AgentRow['availability']) {
    const before = people.find((p) => p.userId === userId)?.availability
    setPeople((ps) => ps.map((p) => (p.userId === userId ? { ...p, availability } : p)))
    try {
      await updateAgent(userId, { availability })
    } catch (err) {
      toast.error('Couldn’t change the status', { description: errorDetail(err) })
      setPeople((ps) => ps.map((p) => (p.userId === userId && p.availability === availability && before ? { ...p, availability: before } : p)))
    }
  }
  async function saveRow() {
    if (!row || rowError) return
    setRowBusy(true)
    try {
      await updateAgent(row.userId, { skills: row.skills, maxOpen: rowLimit })
      setPeople((ps) => ps.map((p) => (p.userId === row.userId ? { ...p, skills: row.skills.map((x) => x.trim().toLowerCase()).filter(Boolean), maxOpen: rowLimit } : p)))
      toast.success(`${rowPerson?.name || 'Their'} skills and limit saved`)
      setRow(null)
    } catch (err) {
      toast.error('Couldn’t save', { description: errorDetail(err) })
    } finally {
      setRowBusy(false)
    }
  }

  return (
    <div className="min-w-0">
      {!canEdit && <ReadOnlyNote>Only owners and admins change teams, skills and limits. You can set your own status.</ReadOnlyNote>}
      <SettingsSection wide title="Teams" description="Group people who handle the same kind of work. Routing rules send tickets to a team, and team leads hear about escalations.">
        {teams.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No teams yet"
            description="Make a team for each kind of work, such as Billing or Orders."
            action={
              canEdit && (
                <Button size="sm" onClick={() => setEditing({ id: null, team: blankTeam() })}>
                  <Plus className="size-4" /> New team
                </Button>
              )
            }
          />
        ) : (
          <>
            <ul className="grid gap-3 lg:grid-cols-2">
              {teams.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name}</p>
                      {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing({ id: t.id, team: { ...t } })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.name}`} onClick={() => setRemoving(t)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-meta text-muted-foreground">
                    {t.memberIds.length} {t.memberIds.length === 1 ? 'person' : 'people'} · {ASSIGN.find((a) => a.id === t.assign)?.label}
                    {t.leadId && ` · Lead: ${nameOf(t.leadId)}`}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {t.memberIds.map((id) => (
                      <span key={id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {nameOf(id)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing({ id: null, team: blankTeam() })}>
                <Plus className="size-4" /> New team
              </Button>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        stacked
        title="People"
        description="Only available people get new tickets. A limit stops new tickets once someone has that many open. Skills let a rule pick, say, a Hindi speaker."
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-56">Skills</TableHead>
                <TableHead className="w-28">Open limit</TableHead>
                <TableHead className="text-right">Open now</TableHead>
                {canEdit && <TableHead className="w-0" aria-label="Actions" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const mine = p.userId === me?.user.id
                const editingRow = row?.userId === p.userId ? row : null
                return (
                  <TableRow key={p.userId} data-density-row>
                    <TableCell>
                      <span className="block font-medium">{p.name || 'Someone'}</span>
                      <span className="block text-meta text-muted-foreground">{p.teamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || 'No team'}</span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={p.availability}
                        disabled={!mine && !can(me?.role, 'tickets.reassign')}
                        onValueChange={(v) => void setAvailability(p.userId, v as AgentRow['availability'])}
                      >
                        <SelectTrigger className="h-8 w-36" aria-label={`Status of ${p.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABILITY.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span className={cn('size-2 rounded-full', a.dot)} /> {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {editingRow ? (
                        <TagInput values={editingRow.skills} onChange={(skills) => setRow({ ...editingRow, skills })} placeholder="e.g. hindi" aria-label={`Skills of ${p.name}`} />
                      ) : (
                        <span className="text-sm text-muted-foreground">{p.skills.join(', ') || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingRow ? (
                        <span className="block space-y-1">
                          <Input inputMode="numeric" className="h-8 w-20" aria-label={`Open ticket limit for ${p.name}`} placeholder="None" value={editingRow.maxOpen} onChange={(e) => setRow({ ...editingRow, maxOpen: e.target.value.replace(/[^\d]/g, '') })} aria-invalid={!!rowError} />
                          {rowError && <span className="block max-w-40 text-xs text-destructive">{rowError}</span>}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">{p.maxOpen ?? 'None'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.open}</TableCell>
                    {canEdit && (
                      <TableCell className="whitespace-nowrap">
                        {editingRow ? (
                          <span className="flex gap-1">
                            <Button size="icon-sm" aria-label={`Save ${p.name}`} disabled={rowBusy || !!rowError} onClick={() => void saveRow()}>
                              {rowBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label="Cancel" disabled={rowBusy} onClick={() => setRow(null)}>
                              <X className="size-4" />
                            </Button>
                          </span>
                        ) : (
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}’s skills and limit`} disabled={!!row} onClick={() => setRow({ userId: p.userId, skills: p.skills, maxOpen: p.maxOpen === null ? '' : String(p.maxOpen) })}>
                            <Pencil className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <ChatVisibility canEdit={canEdit} />

      <TeamSheet
        editing={editing}
        people={people}
        names={teams.filter((t) => t.id !== editing?.id).map((t) => t.name.trim().toLowerCase())}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={`Delete ${removing?.name ?? 'team'}?`}
        description="Its open tickets stay with whoever has them and leave the team’s queue; resolved tickets keep it for reports. Rules that send tickets to the team must be changed first."
        confirmLabel="Delete team"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const t = removing!
          setRemoving(null)
          try {
            await deleteTeam(t.id)
            toast.success(`${t.name} deleted`)
            load()
          } catch (err) {
            toast.error('Couldn’t delete the team', { description: errorDetail(err) })
          }
        }}
      />
    </div>
  )
}

/** Who sees which chats (moved here from Hours & targets): one switch, saved on its own. */
function ChatVisibility({ canEdit }: { canEdit: boolean }) {
  const form = useSettingsForm<{ restrictAgents: boolean }>({
    load: () => getSupportSettings().then((s) => ({ value: { restrictAgents: !!s.restrictAgents }, stamp: stampOf(s) })),
    save: (v, since) => saveSupportSettings({ restrictAgents: v.restrictAgents }, since).then((s) => ({ value: { restrictAgents: !!s.restrictAgents }, stamp: stampOf(s) })),
  })
  return (
    <SettingsSection wide title="Who sees which chats" description="Supervisors, admins and owners always see every chat. Agents see everything too, unless you limit them here.">
      {form.state !== 'ready' || !form.draft ? (
        <LoadGate error={form.loadError} onRetry={form.reload} what="chat visibility" />
      ) : (
        <>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Agents see only chats and tickets assigned to them, plus unassigned ones
              <span className="block text-xs text-muted-foreground">Useful when agents shouldn&rsquo;t read each other&rsquo;s customers. They can still pick up unassigned work.</span>
            </span>
            <Switch checked={form.draft.restrictAgents} disabled={!canEdit} onCheckedChange={(restrictAgents) => form.set({ restrictAgents })} />
          </label>
          {canEdit && <FormFooter form={form} />}
        </>
      )}
    </SettingsSection>
  )
}

function TeamSheet({ editing, people, names, onClose, onSaved }: { editing: { id: string | null; team: Omit<Team, 'id'> } | null; people: AgentRow[]; names: string[]; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState<Omit<Team, 'id'>>(blankTeam)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(editing)
  // A new team or a different one: start the form from it.
  if (editing !== shown) {
    setShown(editing)
    if (editing) {
      setT(editing.team)
      setError(null)
    }
  }
  const set = (patch: Partial<Omit<Team, 'id'>>) => setT((x) => ({ ...x, ...patch }))
  const taken = !!t.name.trim() && names.includes(t.name.trim().toLowerCase())
  const changed = !!editing && JSON.stringify(t) !== JSON.stringify(editing.team)
  useLeaveGuard('team-sheet', changed)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (editing?.id) await updateTeam(editing.id, t)
      else await createTeam(t)
      toast.success(`${t.name} saved`)
      onSaved()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing?.id ? `Edit ${editing.team.name}` : 'New team'}</SheetTitle>
          <SheetDescription>
            <SettingsLink tab="routing">Routing rules</SettingsLink> can send tickets here; the lead hears about escalations.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input id="team-name" value={t.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Billing" aria-invalid={taken} />
            {taken && <p className="text-xs text-destructive">Another team already has this name.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-desc">What the team handles</Label>
            <Textarea id="team-desc" rows={2} maxLength={200} value={t.description} onChange={(e) => set({ description: e.target.value })} placeholder="Refunds, invoices and payments" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">How new tickets are handed out</legend>
            <RadioGroup value={t.assign} onValueChange={(v) => set({ assign: v as Team['assign'] })} className="space-y-2">
              {ASSIGN.map((a) => (
                <label key={a.id} className="flex items-start gap-2.5 text-sm">
                  <RadioGroupItem value={a.id} className="mt-0.5" />
                  <span>
                    {a.label}
                    <span className="block text-xs text-muted-foreground">{a.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Members</legend>
            {people.map((p) => (
              <label key={p.userId} className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={t.memberIds.includes(p.userId)}
                  onCheckedChange={(on) =>
                    set({ memberIds: on ? [...t.memberIds, p.userId] : t.memberIds.filter((id) => id !== p.userId), ...(!on && t.leadId === p.userId && { leadId: null }) })
                  }
                />
                {p.name || 'Someone'}
                {p.skills.length > 0 && <span className="text-xs text-muted-foreground">{p.skills.join(', ')}</span>}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <Label>Team lead</Label>
            <Select value={t.leadId ?? 'none'} onValueChange={(v) => set({ leadId: v === 'none' ? null : v })}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No lead</SelectItem>
                {people
                  .filter((p) => t.memberIds.includes(p.userId))
                  .map((p) => (
                    <SelectItem key={p.userId} value={p.userId}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {error && <FormError>{error}</FormError>}
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !t.name.trim() || taken}>
            {editing?.id ? 'Save team' : 'Create team'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
