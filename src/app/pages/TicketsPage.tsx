import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronsUp, Star } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { errorDetail } from '@/app/api/meta'
import { bulkTickets, escalateDemoTicket, listTeams, listTickets, PRIORITIES, type Team, PRIORITY_CLASS, PRIORITY_LABEL, slaText, STATUS_LABEL, type Priority, type Ticket } from '@/app/api/tickets'
import { cn } from '@/app/lib/utils'
import { useMembers } from '@/app/auth/useMembers'
import { usePolling } from '@/app/lib/usePolling'
import { PillTabs, SearchInput } from '@/app/components/Filters'
import { customerLabel } from '@/app/lib/customer'
import { can } from '@/app/lib/permissions'
import { useAuth } from '@/app/auth/AuthContext'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { PageContainer, PageHeader } from '@/app/components/ui/page'
import { isDummyMode } from '@/app/api/dummy'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'

const LIVE_TICKETS = ['ticket.']

const VIEWS = [
  { id: 'open', label: 'Open' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'pending', label: 'Waiting on customer' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
] as const

export function SlaCell({ t }: { t: Ticket }) {
  const due = t.sla.at ? Date.parse(t.sla.at) - Date.now() : null
  return (
    <span
      className={cn('text-xs tabular-nums', t.sla.breached ? 'font-semibold text-destructive' : due !== null && due < 30 * 60_000 ? 'text-foreground' : 'text-muted-foreground')}
    >
      {slaText(t)}
    </span>
  )
}

/** Every issue handed to people: who has it, how urgent, and how long until its SLA runs out. */
export function TicketsPage({ onOpenChat }: { onOpenChat: (phone: string) => void }) {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('open')
  const [assignee, setAssignee] = useState('any')
  const [priority, setPriority] = useState('any')
  const [team, setTeam] = useState('any')
  const [teams, setTeams] = useState<Team[]>([])
  useEffect(() => {
    listTeams().then(setTeams, () => {})
  }, [])
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Ticket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const members = useMembers()
  const { me } = useAuth()
  const reassign = can(me?.role, 'tickets.reassign')
  // Agents hand tickets only to themselves or back to nobody.
  const assignable = reassign ? members : members.filter((m) => m.userId === me?.user.id)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    listTickets({
      status: view === 'escalated' ? 'open' : view,
      escalated: view === 'escalated' ? '1' : undefined,
      assignee: assignee === 'any' ? undefined : assignee,
      priority: priority === 'any' ? undefined : priority,
      team: team === 'any' ? undefined : team,
      q,
    }).then(
      (r) => {
        setRows(r)
        setError(null)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [view, assignee, priority, team, q])
  usePolling(refresh, 15_000, [refresh], true, LIVE_TICKETS)
  useEffect(() => setPicked(new Set()), [view, assignee, priority, team, q])
  const teamName = (id?: string | null) => (id ? teams.find((x) => x.id === id)?.name : null)

  // Demo controls: an open ticket's clock runs out, so its next escalation level fires.
  const demo = useMemo(
    () =>
      isDummyMode() ? (
        <DemoControlsGroup label="Tickets">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void escalateDemoTicket().then(
                (r) => {
                  toast.success(`Ticket #${r.number} reached escalation level ${r.level}`)
                  refresh()
                },
                (err) => toast.error(errorDetail(err)),
              )
            }
          >
            Simulate SLA breach
          </Button>
        </DemoControlsGroup>
      ) : null,
    [refresh],
  )
  useRegisterDevControls('tickets', demo)

  const nameOf = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.name ?? 'Someone') : 'Unassigned')
  const all = rows ?? []
  const allPicked = all.length > 0 && all.every((t) => picked.has(t.number))
  async function bulk(o: Parameters<typeof bulkTickets>[1], done: string) {
    setBusy(true)
    try {
      await bulkTickets([...picked], o)
      toast.success(done)
      setPicked(new Set())
      refresh()
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Tickets" description="Chats handed to your team, with their reply and resolution deadlines." className="mb-0" />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <PillTabs label="Ticket status" options={VIEWS} value={view} onChange={setView} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="h-9 w-40" aria-label="Assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Anyone</SelectItem>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 w-36" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any priority</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teams.length > 0 && (
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-9 w-40" aria-label="Team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">No team</SelectItem>
              </SelectContent>
            </Select>
          )}
          <SearchInput value={q} onChange={setQ} placeholder="Search tickets" label="Search tickets" className="h-9 w-56" />
        </div>
      </div>

      {picked.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span className="mr-2">{picked.size} selected</span>
          <Select onValueChange={(v) => void bulk({ patch: { assigneeId: v === 'none' ? null : v } }, 'Tickets reassigned.')} disabled={busy}>
            <SelectTrigger className="h-8 w-40" aria-label="Assign selected">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {assignable.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => void bulk({ patch: { priority: v as Priority } }, 'Priority changed.')} disabled={busy}>
            <SelectTrigger className="h-8 w-36" aria-label="Set priority of selected">
              <SelectValue placeholder="Set priority…" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reassign && teams.length > 0 && (
            <Select onValueChange={(v) => void bulk({ patch: { teamId: v === 'none' ? null : v } }, 'Tickets moved.')} disabled={busy}>
              <SelectTrigger className="h-8 w-40" aria-label="Move selected to team">
                <SelectValue placeholder="Move to team…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {view !== 'resolved' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk({ action: 'resolve' }, 'Tickets resolved.')}>
              Resolve
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {error ? (
          <p className="p-6 text-destructive text-sm">
            {error}
          </p>
        ) : !rows ? (
          <PageLoader context="tickets" className="min-h-[40vh]" />
        ) : rows.length === 0 ? (
          <div className="space-y-1 p-10 text-center text-muted-foreground text-sm">
            <p>{view === 'escalated' ? 'No escalated tickets. Everything is within its targets.' : view === 'open' && assignee === 'any' && priority === 'any' && team === 'any' && !q ? 'No open tickets. The AI agent has everything covered.' : 'No tickets match.'}</p>
            <p className="text-xs">A ticket opens when the AI agent hands a chat to your team, or when someone takes over or replies in the inbox.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPicked}
                    onCheckedChange={(v) => setPicked(v ? new Set(all.map((t) => t.number)) : new Set())}
                    aria-label="Select all tickets"
                  />
                </TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.number} className="cursor-pointer" onClick={() => onOpenChat(t.phone)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={picked.has(t.number)}
                      onCheckedChange={(v) =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(t.number)
                          else next.delete(t.number)
                          return next
                        })
                      }
                      aria-label={`Select ticket ${t.number}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[60vw] sm:max-w-md">
                    <p className="truncate text-sm font-semibold">
                      #{t.number} {t.subject}
                    </p>
                    {t.tags.length > 0 && (
                      <p className="text-muted-foreground text-xs">
                        {t.tags.join(', ')}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.name || customerLabel(t.phone)}
                    {t.sample && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 text-[0.6875rem] text-muted-foreground">
                        Sample
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn('rounded px-2 py-0.5 text-xs', PRIORITY_CLASS[t.priority])}>{PRIORITY_LABEL[t.priority]}</span>
                      {!!t.escalationLevel && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive"
                          title={t.escalations?.at(-1)?.reason ?? 'Escalated'}
                        >
                          <ChevronsUp className="size-3" /> L{t.escalationLevel}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {STATUS_LABEL[t.status]}
                    {t.csat && (
                      <span className="ml-2 inline-flex items-center gap-0.5 text-muted-foreground text-xs" title={`Customer said: ${t.csat.label}`}>
                        <Star className="size-3" /> {t.csat.label}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {nameOf(t.assigneeId)}
                    {teamName(t.teamId) && <span className="block text-xs text-muted-foreground">{teamName(t.teamId)}</span>}
                  </TableCell>
                  <TableCell>
                    <SlaCell t={t} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  )
}
