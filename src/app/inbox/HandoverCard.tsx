import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Check, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { errorDetail } from '@/app/api/meta'
import { assignChat, summarizeChat, type ChatDetail } from '@/app/api/inbox'
import { PRIORITY_CLASS, PRIORITY_LABEL, type Ticket } from '@/app/api/tickets'
import { useAuth } from '@/app/auth/AuthContext'
import { cn } from '@/app/lib/utils'

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return min < 60 ? `${min} min ago` : min < 60 * 48 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`
}

/**
 * Pinned above the thread while a handed-over chat waits for its first human reply: why it came to
 * people, how long it has waited, and one click to take it. The summary helps catch up fast.
 */
export function HandoverCard({ chat, ticket, teamName, aiSummary, onChange }: { chat: ChatDetail; ticket: Ticket | null; teamName: string | null; aiSummary: boolean; onChange: (d: ChatDetail) => void }) {
  const { me } = useAuth()
  const [busy, setBusy] = useState<'accept' | 'summary' | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  if (!ticket || ticket.firstRespondedAt || chat.conversation.owner !== 'human') return null
  const mine = ticket.assigneeId === me?.user.id
  const how = ticket.source === 'handoff' ? 'The AI agent handed this chat over' : ticket.source === 'takeover' ? 'Someone took this chat over' : 'This chat came to the team'

  return (
    <div className="border-b border-border bg-primary/5 px-4 py-3 md:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ArrowRightLeft className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{how}</span> {ago(ticket.createdAt)} · Ticket #{ticket.number}
          {teamName && ` · ${teamName}`}{' '}
          <span className={cn('ml-1 rounded px-1.5 py-0.5 text-xs', PRIORITY_CLASS[ticket.priority])}>{PRIORITY_LABEL[ticket.priority]}</span>
          {ticket.sla.at && <span className={cn('ml-2 text-xs', ticket.sla.breached ? 'font-medium text-destructive' : 'text-muted-foreground')}>{ticket.sla.breached ? 'First reply overdue' : `Reply by ${new Date(ticket.sla.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span>}
        </p>
        <div className="flex gap-2">
          {aiSummary && !summary && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('summary')
                try {
                  setSummary((await summarizeChat(chat.conversation.phone)).text)
                } catch (err) {
                  toast.error(errorDetail(err))
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === 'summary' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Catch me up
            </Button>
          )}
          {mine ? (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="size-4" /> Yours. Reply to start the clock.
            </span>
          ) : (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('accept')
                try {
                  onChange(await assignChat(chat.conversation.phone, me?.user.id ?? null))
                  toast.success('It’s yours')
                  document.querySelector<HTMLTextAreaElement>('[data-composer]')?.focus()
                } catch (err) {
                  toast.error(errorDetail(err))
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === 'accept' && <Loader2 className="size-4 animate-spin" />} Accept
            </Button>
          )}
        </div>
      </div>
      {summary && <p className="mt-2 rounded-md bg-background px-3 py-2 text-sm whitespace-pre-line">{summary}</p>}
    </div>
  )
}
