import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Checkbox } from '@/app/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { EmptyState } from '@/app/components/ui/page'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { TagInput } from '@/app/components/wizard/TagInput'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { createTeam, deleteTeam, listAgents, listTeams, updateAgent, updateTeam, type AgentRow, type Team } from '@/app/api/tickets'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { SettingsSection } from './SettingsSection'

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

  const load = useCallback(() => {
    Promise.all([listTeams(), listAgents()]).then(
      ([t, p]) => {
        setTeams(t)
        setPeople(p)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])

  if (!teams) return error ? <FormError>{error}</FormError> : <PageLoader context="settings" className="min-h-[30vh] py-10" />
  const nameOf = (id: string | null) => people.find((p) => p.userId === id)?.name || 'Someone'

  async function patchPerson(userId: string, patch: Parameters<typeof updateAgent>[1]) {
    setPeople((ps) => ps.map((p) => (p.userId === userId ? { ...p, ...patch } : p)))
    try {
      await updateAgent(userId, patch)
    } catch (err) {
      toast.error('Couldn’t save', { description: errorDetail(err) })
      load()
    }
  }

  return (
    <div className="min-w-0">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const mine = p.userId === me?.user.id
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
                        onValueChange={(v) => void patchPerson(p.userId, { availability: v as AgentRow['availability'] })}
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
                      {canEdit ? (
                        <TagInput values={p.skills} onChange={(skills) => void patchPerson(p.userId, { skills })} placeholder="e.g. hindi" aria-label={`Skills of ${p.name}`} />
                      ) : (
                        <span className="text-sm text-muted-foreground">{p.skills.join(', ') || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        disabled={!canEdit}
                        className="h-8 w-20"
                        aria-label={`Open ticket limit for ${p.name}`}
                        placeholder="None"
                        defaultValue={p.maxOpen ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          if (v !== p.maxOpen) void patchPerson(p.userId, { maxOpen: v })
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.open}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <TeamSheet
        editing={editing}
        people={people}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={`Delete ${removing?.name ?? 'team'}?`}
        description="Its open tickets stay with whoever has them and leave the team’s queue. Rules that send tickets to the team must be changed first."
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

function TeamSheet({ editing, people, onClose, onSaved }: { editing: { id: string | null; team: Omit<Team, 'id'> } | null; people: AgentRow[]; onClose: () => void; onSaved: () => void }) {
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
          <SheetDescription>Routing rules can send tickets here; the lead hears about escalations.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input id="team-name" value={t.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Billing" />
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
          <Button onClick={() => void save()} disabled={busy || !t.name.trim()}>
            {editing?.id ? 'Save team' : 'Create team'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
