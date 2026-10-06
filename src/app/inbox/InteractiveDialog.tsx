import { useState } from 'react'
import { Loader2, Plus, Send, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { PillTabs } from '@/app/components/Filters'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { sendInteractiveReply, type ChatDetail } from '@/app/api/inbox'
import { interactiveError, LIMITS, type InteractiveReply } from './interactive'

const KINDS = [
  { id: 'button' as const, label: 'Reply buttons' },
  { id: 'list' as const, label: 'List of options' },
]

/** Sends a message with up to 3 reply buttons, or a list of up to 10 options, into an open chat. */
export function InteractiveDialog({ phone, initialText, onClose, onSent }: { phone: string; initialText: string; onClose: () => void; onSent: (d: ChatDetail) => void }) {
  const [type, setType] = useState<'button' | 'list'>('button')
  const [body, setBody] = useState(initialText)
  const [buttons, setButtons] = useState(['', ''])
  const [listButton, setListButton] = useState('See options')
  const [rows, setRows] = useState([{ title: '', description: '' }, { title: '', description: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reply: InteractiveReply = type === 'button' ? { type, body, buttons } : { type, body, button: listButton, rows }
  const problem = interactiveError(reply)
  const count = (n: number, max: number) => <span className={n > max ? 'text-destructive' : 'text-muted-foreground'}>{`${n}/${max}`}</span>

  async function send() {
    setBusy(true)
    setError(null)
    try {
      onSent(await sendInteractiveReply(phone, reply))
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send buttons or a list</DialogTitle>
          <DialogDescription>The customer taps an answer instead of typing it. Their choice shows up here as their reply.</DialogDescription>
        </DialogHeader>
        <PillTabs label="Kind of message" options={KINDS} value={type} onChange={setType} compact />
        <div className="space-y-1.5">
          <Label htmlFor="ix-body" className="flex justify-between">
            Message {count(body.length, LIMITS.body)}
          </Label>
          <Textarea id="ix-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Which time suits you for the delivery?" />
        </div>
        {type === 'button' ? (
          <div className="space-y-2">
            <Label>Buttons (up to {LIMITS.buttons})</Label>
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={b} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? e.target.value : x)))} placeholder={['Morning', 'Evening', 'Call me'][i]} aria-label={`Button ${i + 1}`} />
                <span className="text-xs">{count(b.length, LIMITS.buttonTitle)}</span>
                {buttons.length > 1 && (
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove button ${i + 1}`} onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {buttons.length < LIMITS.buttons && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setButtons([...buttons, ''])}>
                <Plus className="size-4" /> Add a button
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ix-btn" className="flex justify-between">
                Button that opens the list {count(listButton.length, LIMITS.listButton)}
              </Label>
              <Input id="ix-btn" value={listButton} onChange={(e) => setListButton(e.target.value)} />
            </div>
            <Label>Options (up to {LIMITS.rows})</Label>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
                <Input value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Title" aria-label={`Option ${i + 1} title`} maxLength={LIMITS.rowTitle + 10} />
                <Input value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Description (optional)" aria-label={`Option ${i + 1} description`} />
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove option ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {rows.length < LIMITS.rows && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows([...rows, { title: '', description: '' }])}>
                <Plus className="size-4" /> Add an option
              </Button>
            )}
          </div>
        )}
        {(error || (problem && body.trim())) && <FormError>{error ?? problem}</FormError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={busy || !!problem}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
