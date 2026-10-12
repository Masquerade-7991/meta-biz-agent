import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { errorDetail } from '@/app/api/meta'
import { createTicket, PRIORITIES, PRIORITY_LABEL, type Priority, type Ticket } from '@/app/api/tickets'

/** A ticket by hand for this chat: what it's about and how urgent. Empty subject = the customer's last message. */
export function CreateTicketDialog({ phone, onClose, onCreated }: { phone: string; onClose: () => void; onCreated: (t: Ticket) => void }) {
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      const t = await createTicket(phone, subject.trim(), priority)
      toast.success(`Ticket #${t.number} opened.`)
      onCreated(t)
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create ticket</DialogTitle>
          <DialogDescription>Track an issue in this chat. Routing rules pick who gets it, unless the chat already has someone.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input id="ticket-subject" autoFocus maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Leave empty to use the customer’s last message" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger id="ticket-priority" className="w-40">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
