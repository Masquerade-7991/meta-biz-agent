import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Route, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { EmptyState } from '@/app/components/ui/page'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { TagInput } from '@/app/components/wizard/TagInput'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { useMembers } from '@/app/auth/useMembers'
import { errorDetail } from '@/app/api/meta'
import { getRules, getSupportSettings, listTeams, PRIORITIES, PRIORITY_LABEL, saveRules, type Rule, type SupportSettings, type Team } from '@/app/api/tickets'
import { applyRule, firstMatch, type Action, type Condition, type TicketSource } from '@/app/support/routing'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { SettingsSection } from './SettingsSection'

const SOURCES: { id: TicketSource; label: string }[] = [
  { id: 'handoff', label: 'AI handed over' },
  { id: 'takeover', label: 'Someone took over' },
  { id: 'reply', label: 'Team replied' },
  { id: 'manual', label: 'Created by hand' },
]
type Field = Exclude<Condition['field'], 'number'>
const FIELDS: { id: Field; label: string }[] = [
  { id: 'keyword', label: 'Message mentions' },
  { id: 'contactTag', label: 'Contact has tag' },
  { id: 'source', label: 'Ticket opened because' },
  { id: 'priority', label: 'Priority is' },
  { id: 'hours', label: 'Business hours' },
]
const ACTIONS: { id: Action['do']; label: string }[] = [
  { id: 'assignTeam', label: 'Send to team' },
  { id: 'assignUser', label: 'Assign to person' },
  { id: 'leaveUnassigned', label: 'Leave unassigned' },
  { id: 'setPriority', label: 'Set priority' },
  { id: 'addTags', label: 'Add tags' },
]
const blankCondition = (field: Field): Condition =>
  field === 'keyword' ? { field, any: [] } : field === 'contactTag' ? { field, any: [] } : field === 'source' ? { field, in: ['handoff'] } : field === 'priority' ? { field, in: ['urgent'] } : { field, is: 'closed' }
const blankAction = (d: Action['do'], teams: Team[]): Action =>
  d === 'assignTeam'
    ? { do: d, teamId: teams[0]?.id ?? '' }
    : d === 'assignUser'
      ? { do: d, userId: '' }
      : d === 'setPriority'
        ? { do: d, priority: 'high' }
        : d === 'addTags'
          ? { do: d, tags: [] }
          : { do: 'leaveUnassigned' }
const newRule = (): Rule => ({ id: `r${Date.now().toString(36)}`, name: '', enabled: true, match: 'all', when: [{ field: 'keyword', any: [] }], then: [] })

/** Settings › Routing rules: where each new ticket goes, decided top to bottom. */
export function RoutingRulesSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const members = useMembers()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [fallback, setFallback] = useState<SupportSettings['routing'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Rule | null>(null)

  useEffect(() => {
    Promise.all([getRules(), listTeams(), getSupportSettings()]).then(
      ([r, t, s]) => {
        setRules(r)
        setTeams(t)
        setFallback(s.routing)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [])

  if (!rules) return error ? <FormError>{error}</FormError> : <PageLoader context="settings" className="min-h-[30vh] py-10" />

  async function persist(next: Rule[], done?: string) {
    const before = rules
    setRules(next)
    try {
      setRules(await saveRules(next))
      if (done) toast.success(done)
      return true
    } catch (err) {
      setRules(before)
      toast.error('Couldn’t save the rules', { description: errorDetail(err) })
      return false
    }
  }
  const move = (i: number, by: -1 | 1) => {
    const next = [...rules]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    void persist(next)
  }
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? 'a deleted team'
  const personName = (id: string) => members.find((m) => m.userId === id)?.name ?? 'someone'
  const fallbackText = !fallback
    ? ''
    : fallback.mode === 'fixed'
      ? `assigned to ${personName(fallback.userId ?? '')}`
      : fallback.mode === 'unassigned'
        ? 'left unassigned'
        : fallback.teamId
          ? `handed out in ${teamName(fallback.teamId)}`
          : 'handed out to everyone in turn'

  return (
    <div className="min-w-0">
      <SettingsSection
        wide
        title="Routing rules"
        description="When a ticket opens, the rules are checked from the top. The first one that matches decides; the others are skipped. Someone already looking after the chat keeps it."
      >
        {rules.length === 0 ? (
          <EmptyState
            icon={Route}
            title="No rules yet"
            description="Without rules, every new ticket follows the default below."
            action={
              canEdit && (
                <Button size="sm" onClick={() => setEditing(newRule())}>
                  <Plus className="size-4" /> New rule
                </Button>
              )
            }
          />
        ) : (
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <li key={r.id} className={cn('flex items-start gap-3 rounded-lg border border-border bg-card p-3', !r.enabled && 'opacity-60')}>
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-meta font-medium tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">When</span> {describeWhen(r)} <span className="font-medium text-foreground">then</span>{' '}
                    {r.then.map((a) => describeAction(a, teamName, personName)).join(', ')}.
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch checked={r.enabled} aria-label={`${r.enabled ? 'Turn off' : 'Turn on'} ${r.name}`} onCheckedChange={(on) => void persist(rules.map((x) => (x.id === r.id ? { ...x, enabled: on } : x)))} />
                    <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(structuredClone(r))}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={() => void persist(rules.filter((x) => x.id !== r.id), `${r.name} deleted`)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
            <li className="flex items-start gap-3 rounded-lg border border-dashed border-border-strong p-3 text-sm text-muted-foreground">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-meta">∗</span>
              <span>
                <span className="font-medium text-foreground">Otherwise</span> new tickets are {fallbackText}. Change this in Hours &amp; response targets.
              </span>
            </li>
          </ol>
        )}
        {canEdit && rules.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setEditing(newRule())}>
            <Plus className="size-4" /> New rule
          </Button>
        )}
      </SettingsSection>

      <SettingsSection wide title="Try it" description="Check which rule a new ticket would meet, using the rules as they are saved.">
        <RuleTester rules={rules} teamName={teamName} personName={personName} />
      </SettingsSection>

      <RuleSheet
        rule={editing}
        teams={teams}
        members={members}
        onClose={() => setEditing(null)}
        onSave={async (r) => {
          const exists = rules.some((x) => x.id === r.id)
          if (await persist(exists ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r], `${r.name} saved`)) setEditing(null)
        }}
      />
    </div>
  )
}

function describeWhen(r: Rule) {
  if (!r.when.length) return 'any ticket opens'
  const parts = r.when.map((c) => {
    switch (c.field) {
      case 'keyword':
        return `the message mentions ${c.any.map((k) => `“${k}”`).join(' or ')}`
      case 'contactTag':
        return `the contact is tagged ${c.any.join(' or ')}`
      case 'source':
        return `it opened because ${c.in.map((s) => SOURCES.find((x) => x.id === s)?.label.toLowerCase()).join(' or ')}`
      case 'priority':
        return `priority is ${c.in.map((p) => PRIORITY_LABEL[p].toLowerCase()).join(' or ')}`
      case 'hours':
        return c.is === 'open' ? 'the team is working' : 'the team is off'
      case 'number':
        return 'it came to a chosen number'
    }
  })
  return parts.join(r.match === 'any' ? ', or ' : ', and ')
}

function describeAction(a: Action, teamName: (id: string) => string, personName: (id: string) => string) {
  switch (a.do) {
    case 'assignTeam':
      return `send to ${teamName(a.teamId)}${a.skill ? ` (someone with ${a.skill})` : ''}`
    case 'assignUser':
      return `assign to ${personName(a.userId)}`
    case 'leaveUnassigned':
      return 'leave unassigned'
    case 'setPriority':
      return `set priority to ${PRIORITY_LABEL[a.priority].toLowerCase()}`
    case 'addTags':
      return `tag ${a.tags.join(', ')}`
  }
}

function RuleTester({ rules, teamName, personName }: { rules: Rule[]; teamName: (id: string) => string; personName: (id: string) => string }) {
  const [text, setText] = useState('I was charged twice, I need a refund')
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState<TicketSource>('handoff')
  const facts = { source, priority: 'normal' as const, text, contactTags: tags, open: true, phoneNumberId: null }
  const hit = useMemo(() => firstMatch(rules, facts), [rules, text, tags, source]) // eslint-disable-line react-hooks/exhaustive-deps
  const out = applyRule(hit, facts)
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor="try-text">The customer writes</Label>
          <Input id="try-text" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Ticket opened because</Label>
          <Select value={source} onValueChange={(v) => setSource(v as TicketSource)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Contact tags</Label>
        <TagInput values={tags} onChange={setTags} placeholder="e.g. vip" aria-label="Contact tags" />
      </div>
      <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">
        {hit ? (
          <>
            Matches <strong>{hit.name}</strong>: {hit.then.map((a) => describeAction(a, teamName, personName)).join(', ')}. Priority {PRIORITY_LABEL[out.priority].toLowerCase()}.
          </>
        ) : (
          'No rule matches: the default routing applies.'
        )}
      </p>
    </div>
  )
}

function RuleSheet({ rule, teams, members, onClose, onSave }: { rule: Rule | null; teams: Team[]; members: { userId: string; name: string }[]; onClose: () => void; onSave: (r: Rule) => Promise<void> }) {
  const [r, setR] = useState<Rule | null>(rule)
  const [shown, setShown] = useState(rule)
  const [busy, setBusy] = useState(false)
  if (rule !== shown) {
    setShown(rule)
    setR(rule)
  }
  if (!r) return <Sheet open={false} />
  const set = (patch: Partial<Rule>) => setR({ ...r, ...patch })
  const setWhen = (i: number, c: Condition) => set({ when: r.when.map((x, j) => (j === i ? c : x)) })
  const setThen = (i: number, a: Action) => set({ then: r.then.map((x, j) => (j === i ? a : x)) })
  const unused = ACTIONS.filter((a) => !r.then.some((x) => x.do === a.id || (['assignTeam', 'assignUser', 'leaveUnassigned'].includes(a.id) && ['assignTeam', 'assignUser', 'leaveUnassigned'].includes(x.do))))

  return (
    <Sheet open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{r.name || 'New rule'}</SheetTitle>
          <SheetDescription>Checked when a ticket opens. Keep specific rules above general ones.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" value={r.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Refunds go to Billing" />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              When
              <Select value={r.match} onValueChange={(v) => set({ match: v as Rule['match'] })}>
                <SelectTrigger className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all of</SelectItem>
                  <SelectItem value="any">any of</SelectItem>
                </SelectContent>
              </Select>
              these hold
            </div>
            {r.when.map((c, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Select value={c.field} onValueChange={(v) => setWhen(i, blankCondition(v as Field))}>
                    <SelectTrigger className="h-8 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELDS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Remove condition" onClick={() => set({ when: r.when.filter((_, j) => j !== i) })}>
                    <X className="size-4" />
                  </Button>
                </div>
                <ConditionValue c={c} onChange={(x) => setWhen(i, x)} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set({ when: [...r.when, blankCondition('keyword')] })}>
              <Plus className="size-4" /> Add condition
            </Button>
            {!r.when.length && <p className="text-sm text-muted-foreground">No conditions: this rule catches every ticket that reaches it.</p>}
          </section>

          <section className="space-y-3">
            <p className="text-sm font-medium">Then</p>
            {r.then.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                <span className="w-36 text-sm">{ACTIONS.find((x) => x.id === a.do)?.label}</span>
                <ActionValue a={a} teams={teams} members={members} onChange={(x) => setThen(i, x)} />
                <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Remove action" onClick={() => set({ then: r.then.filter((_, j) => j !== i) })}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {unused.length > 0 && (
              <Select value="" onValueChange={(v) => set({ then: [...r.then, blankAction(v as Action['do'], teams)] })}>
                <SelectTrigger className="h-8 w-48" aria-label="Add action">
                  <SelectValue placeholder="Add action…" />
                </SelectTrigger>
                <SelectContent>
                  {unused.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.id === 'assignTeam' && !teams.length}>
                      {a.label}
                      {a.id === 'assignTeam' && !teams.length && ' (make a team first)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !r.name.trim() || !r.then.length}
            onClick={async () => {
              setBusy(true)
              await onSave(r)
              setBusy(false)
            }}
          >
            Save rule
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ConditionValue({ c, onChange }: { c: Condition; onChange: (c: Condition) => void }) {
  if (c.field === 'keyword' || c.field === 'contactTag')
    return <TagInput values={c.any} onChange={(any) => onChange({ ...c, any })} placeholder={c.field === 'keyword' ? 'e.g. refund, then Enter' : 'e.g. vip'} aria-label="Values" />
  if (c.field === 'hours')
    return (
      <Select value={c.is} onValueChange={(v) => onChange({ field: 'hours', is: v as 'open' | 'closed' })}>
        <SelectTrigger className="h-8 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Team is working</SelectItem>
          <SelectItem value="closed">Team is off</SelectItem>
        </SelectContent>
      </Select>
    )
  if (c.field === 'source')
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {SOURCES.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={c.in.includes(s.id)} onCheckedChange={(on) => onChange({ ...c, in: on ? [...c.in, s.id] : c.in.filter((x) => x !== s.id) })} />
            {s.label}
          </label>
        ))}
      </div>
    )
  if (c.field === 'priority')
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {PRIORITIES.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <Checkbox checked={c.in.includes(p)} onCheckedChange={(on) => onChange({ ...c, in: on ? [...c.in, p] : c.in.filter((x) => x !== p) })} />
            {PRIORITY_LABEL[p]}
          </label>
        ))}
      </div>
    )
  return null
}

function ActionValue({ a, teams, members, onChange }: { a: Action; teams: Team[]; members: { userId: string; name: string }[]; onChange: (a: Action) => void }) {
  if (a.do === 'assignTeam')
    return (
      <>
        <Select value={a.teamId} onValueChange={(teamId) => onChange({ ...a, teamId })}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Pick a team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="h-8 w-36" placeholder="Skill (optional)" value={a.skill ?? ''} onChange={(e) => onChange({ ...a, skill: e.target.value || undefined })} aria-label="Needed skill" />
      </>
    )
  if (a.do === 'assignUser')
    return (
      <Select value={a.userId || undefined} onValueChange={(userId) => onChange({ ...a, userId })}>
        <SelectTrigger className="h-8 w-44">
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
    )
  if (a.do === 'setPriority')
    return (
      <Select value={a.priority} onValueChange={(v) => onChange({ ...a, priority: v as typeof a.priority })}>
        <SelectTrigger className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  if (a.do === 'addTags')
    return (
      <div className="min-w-48 flex-1">
        <TagInput values={a.tags} onChange={(tags) => onChange({ ...a, tags })} placeholder="e.g. billing" aria-label="Tags to add" />
      </div>
    )
  return null
}
