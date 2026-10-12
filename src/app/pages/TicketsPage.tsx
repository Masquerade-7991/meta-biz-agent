import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ChevronsUp, Star } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { errorDetail } from '@/app/api/meta'
import { bulkTickets, escalateDemoTicket, listTeams, listTickets, PRIORITIES, type Team, PRIORITY_CLASS, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Ticket } from '@/app/api/tickets'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { TicketSheet } from '@/app/tickets/TicketSheet'
import { ResolveDialog } from '@/app/tickets/ResolveDialog'
import { SlaCell } from '@/app/tickets/SlaCell'
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
  { id: 'overdue', label: 'Overdue' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'pending', label: 'Waiting on customer' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
] as const
type View = (typeof VIEWS)[number]['id']
const isView = (v: string | null): v is View => VIEWS.some((x) => x.id === v)
const PAGE = 100
const ANY = 'any'

/** Every issue handed to people: who has it, how urgent, and how long until its deadline. Filters
 *  live in the address, so a link (from Analytics, an email or a colleague) opens the same list. */
export function TicketsPage({ onOpenChat }: { onOpenChat: (phone: string) => void }) {
  const [params, setParams] = useSearchParams()
  const get = (k: string, fallback = ANY) => params.get(k) || fallback
  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'open'
  const assignee = get('assignee')
  const priority = get('priority')
  const team = get('team')
  const tag = params.get('tag') ?? ''
  const q = params.get('q') ?? ''
  // Due soonest suits work still to do; finished work reads newest first.
  const sort = get('sort', view === 'resolved' || view === 'all' ? 'new' : 'due')
  const linked = params.get('n')
  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) if (v && v !== ANY) next.set(k, v)
        else next.delete(k)
        return next
      },
      { replace: true },
    )
  const [teams, setTeams] = useState<Team[]>([])
  useEffect(() => {
    listTeams().then(setTeams, () => {})
  }, [])
  const [limit, setLimit] = useState(PAGE)
  const [rows, setRows] = useState<Ticket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bulkResolve, setBulkResolve] = useState(false)
  const members = useMembers()
  const { me } = useAuth()
  const reassign = can(me?.role, 'tickets.reassign')
  // Agents hand tickets only to themselves or back to nobody.
  const assignable = reassign ? members : members.filter((m) => m.userId === me?.user.id)
  const [busy, setBusy] = useState(false)
  const filterKey = `${view}|${assignee}|${priority}|${team}|${tag}|${q}|${sort}`

  const refresh = useCallback(() => {
    listTickets({
      status: view === 'escalated' || view === 'overdue' ? 'open' : view,
      escalated: view === 'escalated' ? '1' : undefined,
      breached: view === 'overdue' ? '1' : undefined,
      assignee: assignee === ANY ? undefined : assignee,
      priority: priority === ANY ? undefined : priority,
      team: team === ANY ? undefined : team,
      tag: tag || undefined,
      q,
      sort,
      limit: String(limit),
    }).then(
      (r) => {
        setRows(r)
        setError(null)
      },
      (err) => setError(errorDetail(err)),
    )
  }, [view, assignee, priority, team, tag, q, sort, limit])
  usePolling(refresh, 15_000, [refresh], true, LIVE_TICKETS)
  useEffect(() => {
    setPicked(new Set())
    setLimit(PAGE)
  }, [filterKey])
  const teamName = (id?: string | null) => (id ? teams.find((x) => x.id === id)?.name : null)
  const filtered = assignee !== ANY || priority !== ANY || team !== ANY || !!tag || !!q

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
  /** Runs one change on every picked ticket and says exactly what happened. */
  async function bulk(o: Parameters<typeof bulkTickets>[1], verb: string) {
    setBusy(true)
    try {
      const r = await bulkTickets([...picked], o)
      const what = `${r.done} ticket${r.done === 1 ? '' : 's'} ${verb}`
      if (!r.failed.length) toast.success(`${what}.`)
      else
        toast.warning(`${what}; ${r.failed.length} couldn’t be.`, {
          description: r.failed.slice(0, 3).map((f) => f.reason).join(' ') + (r.failed.length > 3 ? ` And ${r.failed.length - 3} more.` : ''),
        })
      setPicked(new Set(r.failed.map((f) => f.number)))
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
        <PillTabs label="Ticket status" options={VIEWS} value={view} onChange={(v) => setParam({ view: v === 'open' ? null : v })} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={assignee} onValueChange={(v) => setParam({ assignee: v })}>
            <SelectTrigger className="h-9 w-44" aria-label="Assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anyone</SelectItem>
              <SelectItem value="me">Assigned to me</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {reassign &&
                members
                  .filter((m) => m.userId !== me?.user.id)
                  .map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => setParam({ priority: v })}>
            <SelectTrigger className="h-9 w-36" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any priority</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teams.length > 0 && (
            <Select value={team} onValueChange={(v) => setParam({ team: v })}>
              <SelectTrigger className="h-9 w-40" aria-label="Team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">No team</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setParam({ sort: v })}>
            <SelectTrigger className="h-9 w-36" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due">Due soonest</SelectItem>
              <SelectItem value="new">Newest</SelectItem>
            </SelectContent>
          </Select>
          <SearchInput value={q} onChange={(v) => setParam({ q: v || null })} placeholder="Number, subject, customer" label="Search tickets" className="h-9 w-56" />
        </div>
      </div>
      {filtered && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {tag && <span className="rounded bg-muted px-1.5 py-0.5">Tag: {tag}</span>}
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setParam({ assignee: null, priority: null, team: null, tag: null, q: null })}>
            Clear filters
          </Button>
        </p>
      )}

      {picked.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span className="mr-2">{picked.size} selected</span>
          <Select value="" onValueChange={(v) => void bulk({ patch: { assigneeId: v === 'none' ? null : v } }, 'reassigned')} disabled={busy}>
            <SelectTrigger className="h-8 w-40" aria-label="Assign selected">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {assignable.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value="" onValueChange={(v) => void bulk({ patch: { priority: v as Priority } }, `set to ${PRIORITY_LABEL[v as Priority].toLowerCase()}`)} disabled={busy}>
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
            <Select value="" onValueChange={(v) => void bulk({ patch: { teamId: v === 'none' ? null : v } }, 'moved')} disabled={busy}>
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
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setBulkResolve(true)}>
              Resolve…
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {error && !rows ? (
          <div className="p-6">
            <InlineError message={`Couldn’t load tickets. ${error}`} onRetry={refresh} />
          </div>
        ) : !rows ? (
          <PageLoader context="tickets" className="min-h-[40vh]" />
        ) : rows.length === 0 ? (
          <div className="space-y-1 p-10 text-center text-muted-foreground text-sm">
            <p>
              {filtered
                ? 'No tickets match these filters.'
                : view === 'overdue'
                  ? 'Nothing is overdue. Every open ticket is within its deadline.'
                  : view === 'escalated'
                    ? 'No escalated tickets. Everything is within its targets.'
                    : view === 'pending'
                      ? 'No tickets are waiting on a customer.'
                      : view === 'open'
                        ? 'No open tickets. The AI agent has everything covered.'
                        : 'No tickets yet.'}
            </p>
            <p className="text-xs">A ticket opens when the AI agent hands a chat to your team, when someone takes over or replies in the inbox, or when a customer writes again after it was resolved.</p>
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
                <TableRow key={t.number} className="cursor-pointer" onClick={() => setParam({ n: String(t.number) })}>
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
                      <span className="ml-1.5 rounded bg-muted px-1.5 text-micro text-muted-foreground">
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
      {rows && rows.length >= limit && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => Math.min(1000, l + PAGE))} disabled={limit >= 1000}>
            {limit >= 1000 ? 'Showing the first 1,000. Narrow the filters to see more.' : 'Load more'}
          </Button>
        </div>
      )}
      <TicketSheet number={linked && /^\d+$/.test(linked) ? Number(linked) : null} onClose={() => setParam({ n: null })} onOpenChat={onOpenChat} onChanged={refresh} />
      {bulkResolve && (
        <ResolveDialog
          title={`Resolve ${picked.size} ticket${picked.size === 1 ? '' : 's'}`}
          onClose={() => setBulkResolve(false)}
          onResolve={async (c) => {
            await bulk({ action: 'resolve', ...c }, 'resolved')
            setBulkResolve(false)
          }}
        />
      )}
    </PageContainer>
  )
}
