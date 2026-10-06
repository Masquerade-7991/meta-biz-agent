import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw, Send, UserRound } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { errorText, MetaError, sendTestMessage } from '@/app/api/meta'
import { useWizard } from '@/app/wizard/WizardContext'
import { isMetaFallback } from '@/app/wizard/testTools'
import { cn } from '@/app/lib/utils'
import { WaText } from './WaText'

type Line = { from: 'customer' | 'agent' | 'note'; text: string }

/** A quick test chat from any studio section, so a change can be tried straight away. Same
 *  agent_test call as Test & Eval (not billed); the full chat, checks and details stay there. */
export function TryItPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, patch } = useWizard()
  const [lines, setLines] = useState<Line[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const end = useRef<HTMLDivElement>(null)
  // A block body: newer browsers make scrollIntoView return a Promise, and an effect must return nothing.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines, sending])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setLines((l) => [...l, { from: 'customer', text }])
    setSending(true)
    try {
      const r = await sendTestMessage(text, conversationId)
      setConversationId(r.conversation_id)
      if (!state.publish.chatTested) patch('publish', { chatTested: true })
      setLines((l) => [
        ...l,
        ...(r.agent_response ? [{ from: 'agent' as const, text: r.agent_response }] : []),
        ...(r.agent_response && isMetaFallback(r.agent_response) ? [{ from: 'note' as const, text: 'Meta’s agent couldn’t answer this one. Try again or reword it.' }] : []),
        ...(r.handoff_reason ? [{ from: 'note' as const, text: 'A person on your team would take over here.' }] : []),
        ...(!r.agent_response && !r.handoff_reason ? [{ from: 'note' as const, text: 'The agent didn’t reply to this.' }] : []),
      ])
    } catch (err) {
      const meta = err instanceof MetaError && err.status >= 500
      setLines((l) => [...l, { from: 'note', text: meta ? 'The agent didn’t answer this time (Meta’s error). Try sending it again.' : `Couldn’t reach the agent: ${errorText(err)}` }])
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Try your agent</SheetTitle>
          <SheetDescription>Chat as a customer would. Free, and nobody else sees it.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-2 bg-canvas">
          {lines.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Ask something a customer might, like &ldquo;What are your opening hours?&rdquo;</p>}
          {lines.map((l, i) =>
            l.from === 'note' ? (
              <p key={i} className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <UserRound className="size-3.5" />
                {l.text}
              </p>
            ) : (
              <div key={i} className={cn('flex', l.from === 'customer' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', l.from === 'customer' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card')}>
                  {l.from === 'agent' ? <WaText text={l.text} /> : l.text}
                </div>
              </div>
            ),
          )}
          {sending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Your agent is replying…
            </p>
          )}
          <div ref={end} />
        </SheetBody>
        <SheetFooter className="gap-2">
          {lines.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Start a new conversation"
              onClick={() => {
                setLines([])
                setConversationId(undefined)
              }}
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" aria-label="Message to your agent" disabled={sending} />
            <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
