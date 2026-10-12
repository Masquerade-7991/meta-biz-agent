import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Plus, Star } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { errorDetail } from '@/app/api/meta'
import { listTickets, PRIORITIES, PRIORITY_LABEL, resolveTicket, updateTicket, type Priority, type Ticket } from '@/app/api/tickets'
import { SlaCell } from '@/app/tickets/SlaCell'
import { ResolveDialog } from '@/app/tickets/ResolveDialog'
import { CreateTicketDialog } from '@/app/tickets/CreateTicketDialog'
import { TicketSheet } from '@/app/tickets/TicketSheet'


/** The chat's current ticket (status, priority, SLA, resolve) and its past tickets. */
export function TicketPanel({ phone, windowOpen, version, onChanged }: { phone: string; windowOpen: boolean; version: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Ticket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [details, setDetails] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(
    () =>
      listTickets({ phone, status: 'all', sort: 'new' }).then(
        (r) => {
          setRows(r)
          setError(null)
        },
        (err) => setError(errorDetail(err)),
      ),
    [phone],
  )
  useEffect(() => {
    void load()
  }, [load, version])
  const current = rows?.find((t) => t.status !== 'resolved') ?? null
  const past = rows?.filter((t) => t.status === 'resolved') ?? []

  async function patch(p: Parameters<typeof updateTicket>[1]) {
    if (!current) return
    setBusy(true)
    try {
      await updateTicket(current.number, p)
      await load()
      onChanged()
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        Ticket
      </p>
      {error && !rows ? (
        <InlineError message={`Couldn’t load tickets. ${error}`} onRetry={() => void load()} />
      ) : !rows ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : current ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <button type="button" onClick={() => setDetails(current.number)} className="block text-left text-sm font-semibold hover:underline">
            #{current.number} {current.subject}
          </button>
          <SlaCell t={current} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={current.status} onValueChange={(v) => void patch({ status: v as Ticket['status'] })} disabled={busy}>
              <SelectTrigger className="h-8" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Waiting on customer</SelectItem>
              </SelectContent>
            </Select>
            <Select value={current.priority} onValueChange={(v) => void patch({ priority: v as Priority })} disabled={busy}>
              <SelectTrigger className="h-8" aria-label="Priority">
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
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => setResolving(true)}>
              <CheckCircle2 className="size-4" />
              Resolve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDetails(current.number)}>
              Details
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" />
          Create ticket
        </Button>
      )}
      {past.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {past.slice(0, 5).map((t) => (
            <li key={t.number} className="flex items-center justify-between gap-2 text-muted-foreground">
              <button type="button" className="truncate text-left hover:text-foreground hover:underline" onClick={() => setDetails(t.number)}>
                #{t.number} {t.subject}
              </button>
              {t.csat && (
                <span className="inline-flex shrink-0 items-center gap-0.5" title={`Customer said: ${t.csat.label}`}>
                  <Star className="size-3" /> {t.csat.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {resolving && current && (
        <ResolveDialog
          title={`Resolve ticket #${current.number}`}
          description={current.subject}
          windowOpen={windowOpen}
          onClose={() => setResolving(false)}
          onResolve={async (c) => {
            try {
              await resolveTicket(current.number, c)
              toast.success(`Ticket #${current.number} resolved.`)
              setResolving(false)
              void load()
              onChanged()
            } catch (err) {
              toast.error(errorDetail(err))
            }
          }}
        />
      )}
      {creating && (
        <CreateTicketDialog
          phone={phone}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void load()
            onChanged()
          }}
        />
      )}
      <TicketSheet
        number={details}
        onClose={() => setDetails(null)}
        onOpenChat={() => setDetails(null)}
        onChanged={() => {
          void load()
          onChanged()
        }}
      />
    </div>
  )
}
