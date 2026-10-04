import { useState } from 'react'
import { toast } from 'sonner'
import { AlarmClock, BellRing, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { remindMe, snoozeChat, type ChatDetail } from '@/app/api/inbox'

/** Quick times: in an hour, this evening, tomorrow morning, next Monday morning. */
function presets(now = new Date()) {
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const monday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000) },
    ...(now.getHours() < 17 ? [{ label: 'This evening (6 pm)', at: at(0, 18) }] : []),
    { label: 'Tomorrow morning (9 am)', at: at(1, 9) },
    { label: 'Next Monday (9 am)', at: at(monday, 9) },
  ]
}
const fmt = (d: Date | string) => new Date(d).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

/** Header menu: snooze the chat until a time, or set yourself a reminder about it. */
export function FollowUpMenu({ chat, onChange }: { chat: ChatDetail; onChange: (d: ChatDetail) => void }) {
  const phone = chat.conversation.phone
  const [busy, setBusy] = useState(false)
  // A custom time (or a reminder, which also takes a note) opens a small form.
  const [form, setForm] = useState<{ kind: 'snooze' | 'remind'; at: string; note: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'snooze' | 'remind', at: Date, note = '') {
    setBusy(true)
    setError(null)
    try {
      onChange(kind === 'snooze' ? await snoozeChat(phone, at.toISOString()) : await remindMe(phone, at.toISOString(), note))
      toast.success(kind === 'snooze' ? `Snoozed until ${fmt(at)}. It comes back sooner if the customer writes.` : `We’ll remind you ${fmt(at)}.`)
      setForm(null)
    } catch (err) {
      if (form) setError(errorDetail(err))
      else toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy} aria-label="Snooze or remind me">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <AlarmClock className="size-4" />}
            Later
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Snooze this chat until&hellip;</DropdownMenuLabel>
          {presets().map((p) => (
            <DropdownMenuItem key={`s${p.label}`} onSelect={() => void run('snooze', p.at)}>
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setForm({ kind: 'snooze', at: localInput(new Date(Date.now() + 2 * 3_600_000)), note: '' })}>Pick a time&hellip;</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setForm({ kind: 'remind', at: localInput(presets()[1].at), note: '' })}>
            <BellRing className="size-4" /> Remind me about it&hellip;
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{form?.kind === 'snooze' ? 'Snooze until' : 'Remind me'}</DialogTitle>
            <DialogDescription>{form?.kind === 'snooze' ? 'The chat leaves your list and comes back unread at this time, or as soon as the customer writes.' : 'A reminder about this chat appears in your notifications at this time.'}</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void run(form.kind, new Date(form.at), form.note)
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="fu-at">When</Label>
                <Input id="fu-at" type="datetime-local" value={form.at} min={localInput(new Date())} onChange={(e) => setForm({ ...form, at: e.target.value })} required />
              </div>
              {form.kind === 'remind' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fu-note">Note</Label>
                  <Input id="fu-note" value={form.note} maxLength={300} placeholder="Check the refund went through" onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
              )}
              {error && <FormError>{error}</FormError>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !form.at}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {form.kind === 'snooze' ? 'Snooze' : 'Set reminder'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Shown under the chat header while snoozed, or while you have reminders coming. */
export function FollowUpBanner({ chat, onChange }: { chat: ChatDetail; onChange: (d: ChatDetail) => void }) {
  const until = chat.conversation.snoozedUntil
  const next = chat.reminders?.[0]
  if (!until && !next) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/50 px-4 py-2 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
      {until && (
        <span className="flex items-center gap-2">
          <AlarmClock className="size-3.5" /> Snoozed until {fmt(until)}
          <button type="button" className="text-primary hover:underline" onClick={() => void snoozeChat(chat.conversation.phone, null).then(onChange, (err) => toast.error(errorDetail(err)))}>
            Bring back now
          </button>
        </span>
      )}
      {next && (
        <span className="flex items-center gap-2">
          <BellRing className="size-3.5" /> Reminder {fmt(next.dueAt)}: {next.note}
          {chat.reminders!.length > 1 && ` (+${chat.reminders!.length - 1} more)`}
        </span>
      )}
    </div>
  )
}
