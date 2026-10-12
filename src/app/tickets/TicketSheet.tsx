import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ChevronsUp, MessageCircle, RotateCcw, Star } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { errorDetail } from '@/app/api/meta'
import { getTicket, listTeams, PRIORITIES, PRIORITY_LABEL, resolveTicket, updateTicket, type Priority, type Team, type Ticket } from '@/app/api/tickets'
import { useMembers } from '@/app/auth/useMembers'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'
import { customerLabel } from '@/app/lib/customer'
import { ActivityList } from '@/app/activity/ActivityList'
import { ResolveDialog } from './ResolveDialog'
import { SlaCell } from './SlaCell'

const SOURCE: Record<Ticket['source'], string> = {
  handoff: 'The AI agent handed the chat over',
  takeover: 'Someone took the chat over',
  reply: 'The team replied in the chat',
  manual: 'Created by hand',
  customer: 'The customer wrote again',
}
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const NONE = 'none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** One ticket: everything about it, editable in place, with its history. Opens from the Tickets list,
 *  a link (/tickets?n=1042) or the chat's ticket box. */
export function TicketSheet({ number, onClose, onOpenChat, onChanged }: { number: number | null; onClose: () => void; onOpenChat: (phone: string) => void; onChanged: () => void }) {
  const [t, setT] = useState<Ticket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  // The timeline reloads after each change this panel makes.
  const [version, setVersion] = useState(0)
  const [subject, setSubject] = useState('')
  const [tags, setTags] = useState('')
  const members = useMembers()
  const { me } = useAuth()
  const reassign = can(me?.role, 'tickets.reassign')

  const load = useCallback(() => {
    if (number == null) return
    setError(null)
    getTicket(number).then(
      (x) => {
        setT(x)
        setSubject(x.subject)
        setTags(x.tags.join(', '))
      },
      (err) => setError(errorDetail(err)),
    )
  }, [number])
  useEffect(() => {
    setT(null)
    load()
  }, [load])
  useEffect(() => {
    if (number != null) listTeams().then(setTeams, () => setTeams([]))
  }, [number])

  async function patch(p: Parameters<typeof updateTicket>[1], done?: string) {
    if (!t) return
    setBusy(true)
    try {
      const next = await updateTicket(t.number, p)
      setT(next)
      setSubject(next.subject)
      setTags(next.tags.join(', '))
      setVersion((v) => v + 1)
      if (done) toast.success(done)
      onChanged()
    } catch (err) {
      toast.error(errorDetail(err))
      // Put the fields back to what's saved.
      setSubject(t.subject)
      setTags(t.tags.join(', '))
    } finally {
      setBusy(false)
    }
  }

  // Agents hand tickets only to themselves or back to nobody; the current assignee always shows.
  const assignable = members.filter((m) => reassign || m.userId === me?.user.id || m.userId === t?.assigneeId)
  const assigneeGone = !!t?.assigneeId && members.length > 0 && !members.some((m) => m.userId === t.assigneeId)
  const resolved = t?.status === 'resolved'
  const tagList = (s: string) => [...new Set(s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))]

  return (
    <Sheet open={number != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Ticket #{number}</SheetTitle>
          <SheetDescription>{t ? `${t.name || customerLabel(t.phone)} · opened ${when(t.createdAt)}` : 'Loading…'}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {error ? (
            <InlineError message={`Couldn’t open this ticket. ${error}`} onRetry={load} />
          ) : !t ? (
            <PageLoader context="tickets" />
          ) : (
            <>
              <section className="space-y-3">
                <Input
                  aria-label="Subject"
                  value={subject}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => setSubject(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={() => {
                    const s = subject.trim()
                    if (!s) setSubject(t.subject)
                    else if (s !== t.subject) void patch({ subject: s })
                  }}
                  className="font-semibold"
                />
                <Field label="Status">
                  {resolved ? (
                    <span>Resolved {t.resolvedAt && when(t.resolvedAt)}</span>
                  ) : (
                    <Select value={t.status} onValueChange={(v) => void patch({ status: v as Ticket['status'] })} disabled={busy}>
                      <SelectTrigger className="h-8 w-56" aria-label="Status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="pending">Waiting on customer</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="Deadline">
                  <SlaCell t={t} />
                </Field>
                <Field label="Priority">
                  <span className="flex items-center gap-2">
                    <Select value={t.priority} onValueChange={(v) => void patch({ priority: v as Priority })} disabled={busy || resolved}>
                      <SelectTrigger className="h-8 w-40" aria-label="Priority">
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
                    {!!t.escalationLevel && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        <ChevronsUp className="size-3" /> Level {t.escalationLevel}
                      </span>
                    )}
                  </span>
                </Field>
                <Field label="Assignee">
                  <Select value={t.assigneeId ?? NONE} onValueChange={(v) => void patch({ assigneeId: v === NONE ? null : v })} disabled={busy || resolved}>
                    <SelectTrigger className="h-8 w-56" aria-label="Assignee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned</SelectItem>
                      {assigneeGone && <SelectItem value={t.assigneeId!}>A former member</SelectItem>}
                      {assignable.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name || m.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {(teams.length > 0 || t.teamId) && (
                  <Field label="Team">
                    <Select value={t.teamId ?? NONE} onValueChange={(v) => void patch({ teamId: v === NONE ? null : v })} disabled={busy || resolved || !reassign}>
                      <SelectTrigger className="h-8 w-56" aria-label="Team">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No team</SelectItem>
                        {teams.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field label="Tags">
                  <Input
                    aria-label="Tags"
                    value={tags}
                    disabled={busy}
                    placeholder="refund, vip"
                    onChange={(e) => setTags(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={() => {
                      const next = tagList(tags)
                      if (next.join() !== t.tags.join()) void patch({ tags: next })
                    }}
                    className="h-8"
                  />
                </Field>
                <Field label="Opened because">
                  <span>{SOURCE[t.source] ?? 'New conversation'}</span>
                </Field>
              </section>

              {resolved && (
                <section className="space-y-2 rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">How it was resolved</p>
                  <p className="text-muted-foreground">{t.resolution || 'No note was left.'}</p>
                  {t.csat ? (
                    <p className="inline-flex items-center gap-1">
                      <Star className="size-3.5" /> The customer rated it {t.csat.label.toLowerCase()}.
                    </p>
                  ) : null}
                </section>
              )}

              {!!t.escalations?.length && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Escalations</h3>
                  <ul className="space-y-1 text-sm">
                    {t.escalations.map((e) => (
                      <li key={`${e.level}-${e.at}`} className="flex justify-between gap-3">
                        <span>
                          Level {e.level}: {e.reason}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{when(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">History</h3>
                <ActivityList key={version} compact query={{ entity: 'ticket', entityId: String(t.number) }} empty="Changes to this ticket show up here." />
              </section>
            </>
          )}
        </SheetBody>
        {t && (
          <SheetFooter className="justify-between">
            <Button variant="outline" onClick={() => onOpenChat(t.phone)}>
              <MessageCircle className="size-4" />
              Open chat
            </Button>
            {resolved ? (
              <Button variant="outline" disabled={busy} onClick={() => void patch({ status: 'open' }, `Ticket #${t.number} reopened.`)}>
                <RotateCcw className="size-4" />
                Reopen
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => setResolving(true)}>
                <CheckCircle2 className="size-4" />
                Resolve
              </Button>
            )}
          </SheetFooter>
        )}
        {resolving && t && (
          <ResolveDialog
            title={`Resolve ticket #${t.number}`}
            description={t.subject}
            onClose={() => setResolving(false)}
            onResolve={async (c) => {
              try {
                setT(await resolveTicket(t.number, c))
                setResolving(false)
                setVersion((v) => v + 1)
                toast.success(`Ticket #${t.number} resolved.`)
                onChanged()
              } catch (err) {
                toast.error(errorDetail(err))
              }
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
