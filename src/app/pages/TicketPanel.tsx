import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Plus, Star } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { errorDetail } from '@/app/api/meta'
import { createTicket, listTickets, PRIORITIES, PRIORITY_LABEL, resolveTicket, updateTicket, type Priority, type Ticket } from '@/app/api/tickets'
import { SlaCell } from './TicketsPage'


function ResolveDialog({ t, windowOpen, onClose, onDone }: { t: Ticket; windowOpen: boolean; onClose: () => void; onDone: () => void }) {
  const [resolution, setResolution] = useState('')
  const [askFeedback, setAskFeedback] = useState(windowOpen)
  const [handBack, setHandBack] = useState(true)
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      await resolveTicket(t.number, { resolution, askFeedback, handBack })
      toast.success(`Ticket #${t.number} resolved.`)
      onDone()
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve ticket #{t.number}</DialogTitle>
          <DialogDescription>{t.subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resolution">What fixed it (optional)</Label>
            <Textarea id="resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Refunded the duplicate charge." />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={askFeedback} onCheckedChange={(v) => setAskFeedback(v === true)} disabled={!windowOpen} className="mt-0.5" />
            <span>
              Ask the customer how we did
              <span className="block text-muted-foreground text-xs">
                {windowOpen ? 'Sends Good / Okay / Bad buttons on WhatsApp.' : 'Not possible: the 24-hour reply window is closed.'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={handBack} onCheckedChange={(v) => setHandBack(v === true)} className="mt-0.5" />
            <span>
              Hand the chat back to the AI agent
              <span className="block text-muted-foreground text-xs">
                The agent answers this customer&rsquo;s next message.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void go()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Resolve ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The chat's current ticket (status, priority, SLA, resolve) and its past tickets. */
export function TicketPanel({ phone, windowOpen, version, onChanged }: { phone: string; windowOpen: boolean; version: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Ticket[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => listTickets({ phone, status: 'all' }).then(setRows, () => setRows([])), [phone])
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
      {!rows ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : current ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">
            #{current.number} {current.subject}
          </p>
          <SlaCell t={current} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={current.status} onValueChange={(v) => void patch({ status: v as Ticket['status'] })} disabled={busy}>
              <SelectTrigger className="h-8" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Waiting</SelectItem>
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
          <Button size="sm" className="w-full" onClick={() => setResolving(true)}>
            <CheckCircle2 className="size-4" />
            Resolve
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            createTicket(phone, '', 'normal')
              .then(load)
              .then(onChanged, (err) => toast.error(errorDetail(err)))
              .finally(() => setBusy(false))
          }}
        >
          <Plus className="size-4" />
          Create ticket
        </Button>
      )}
      {past.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {past.slice(0, 5).map((t) => (
            <li key={t.number} className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="truncate">
                #{t.number} {t.subject}
              </span>
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
          t={current}
          windowOpen={windowOpen}
          onClose={() => setResolving(false)}
          onDone={() => {
            setResolving(false)
            void load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
