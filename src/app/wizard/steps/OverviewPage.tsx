import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, FileText, Inbox, Rocket, Ticket } from 'lucide-react'
import { errorText, getAgentOnNumber, type AgentOnNumber } from '@/app/api/meta'
import { StatusPill } from '@/app/components/ui/status'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { AGENT_STATUS, agentStatusOf } from '@/app/lib/status'
import { readiness } from '@/app/wizard/readiness'
import { cn } from '@/app/lib/utils'
import { listAccounts } from '@/app/api/whatsapp'
import { listChats } from '@/app/api/inbox'
import { listTickets } from '@/app/api/tickets'
import { Button } from '@/app/components/ui/button'
import { NumberHealthCard } from '@/app/whatsapp/NumberHealthCard'
import { useExitWizard } from '@/app/wizard/ExitContext'
import { CompiledConfigViewer } from '@/app/components/wizard/CompiledConfigViewer'
import { Card } from '@/app/components/ui/card'
import { useWizard } from '@/app/wizard/WizardContext'
import { compileConfig } from '@/app/wizard/compiler'
import type { StepId, StudioSectionId } from '@/app/wizard/types'

// The studio's landing page: where the agent stands (status, number, what's waiting for the team),
// what's left before it can go live, and the full configuration one click away.
export function OverviewPage() {
  const { state, setSection, setPendingStepFocus } = useWizard()
  const compiled = useMemo(() => compileConfig(state), [state])
  const items = readiness(state)
  const done = items.filter((i) => i.done).length
  const [configOpen, setConfigOpen] = useState(false)

  // CompiledConfigViewer only ever calls onNavigate with a handful of (step, tab) combinations —
  // knowledge's own inner tabs need pendingStepFocus, everything else maps straight to a section.
  function onNavigate(step: StepId, tab?: string) {
    setConfigOpen(false)
    if (step === 'knowledge') {
      if (tab) setPendingStepFocus({ step, tab })
      setSection('knowledge')
      return
    }
    if (step === 'agent' && tab) {
      setPendingStepFocus({ step, tab })
      setSection(tab === 'personality' ? 'identity' : 'abilities')
      return
    }
    const bySection: Partial<Record<StepId, StudioSectionId>> = {
      connections: 'connections',
      safety: 'safety',
      publish: 'publish',
    }
    setSection(bySection[step] ?? 'identity')
  }

  return (
    <div className="space-y-6">
      <LiveOnWhatsApp phoneId={state.gate.selectedPhoneNumberId ?? null} onGoLive={() => setSection('publish')} />

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-section font-semibold">{done === items.length ? 'Your agent is live' : 'Get ready to go live'}</h2>
            <p className="text-sm text-muted-foreground">
              {done} of {items.length} done
            </p>
          </div>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
        <ol className="divide-y divide-border">
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => item.section !== 'overview' && setSection(item.section)}
                className={cn('flex w-full items-center gap-3 px-5 py-3 text-left transition-colors', item.section !== 'overview' && 'hover:bg-muted/60')}
              >
                {item.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-meta text-muted-foreground">{i + 1}</span>
                )}
                <span className={cn('min-w-0 flex-1', item.done ? 'text-muted-foreground' : 'font-medium')}>{item.label}</span>
                {item.detail && <span className="hidden truncate text-sm text-muted-foreground sm:block">{item.detail}</span>}
                {item.section !== 'overview' && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
          <FileText className="size-4" />
          View full configuration
        </Button>
      </div>
      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Full configuration</SheetTitle>
            <SheetDescription>Everything your agent has been set up with. Click a part to change it.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <CompiledConfigViewer config={compiled} state={state} onNavigate={onNavigate} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface Live {
  number: { name: string; display: string } | null
  agent: AgentOnNumber | null
  team: { tickets: number; overdue: number; unread: number }
}

/** Where the agent runs and what's waiting for the team: status, number health, and open work. */
function LiveOnWhatsApp({ phoneId, onGoLive }: { phoneId: string | null; onGoLive: () => void }) {
  const exitTo = useExitWizard()
  const { state } = useWizard()
  const [live, setLive] = useState<Live | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    Promise.all([
      listAccounts(),
      phoneId ? getAgentOnNumber(phoneId) : Promise.resolve(null),
      listTickets(),
      listChats(),
    ]).then(
      ([accounts, agent, tickets, chats]) => {
        const n = accounts.flatMap((a) => a.phoneNumbers).find((x) => x.id === phoneId)
        setLive({
          number: n ? { name: n.verifiedName, display: n.display || n.id } : null,
          agent,
          team: { tickets: tickets.length, overdue: tickets.filter((t) => t.sla.breached).length, unread: chats.reduce((s, c) => s + c.unread, 0) },
        })
      },
      (err) => setError(errorText(err)),
    )
  }, [phoneId])
  useEffect(load, [load])

  if (error)
    return (
      <Card className="flex-row flex-wrap items-center gap-3 px-5">
        <p className="text-destructive">Couldn&rsquo;t load how your agent is doing on WhatsApp. {error}</p>
        <Button size="sm" variant="outline" onClick={load}>
          Try again
        </Button>
      </Card>
    )
  const a = live?.agent
  // What Meta says, when it has answered; the saved publish settings until then.
  const status = a
    ? agentStatusOf({ activated: a.enabled, stopped: !a.enabled && state.publish.stopped, audienceMode: a.audience === 'EVERYONE' ? 'everyone' : 'allowlisted' })
    : agentStatusOf(state.publish)
  const s = AGENT_STATUS[status]
  const t = live?.team
  return (
    <Card className="gap-4 px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-section font-semibold">Status</h2>
            <StatusPill tone={s.tone}>{s.label}</StatusPill>
          </div>
          <p className="text-muted-foreground">
            {status === 'live'
              ? 'Answering every customer who messages this number.'
              : status === 'testing'
                ? 'Answering your test numbers only. Open it to everyone in Publish when you’re ready.'
                : status === 'paused'
                  ? 'Paused: customers get no AI replies until you resume it.'
                  : 'Not answering anyone yet.'}
          </p>
        </div>
        {(status === 'draft' || status === 'paused') && (
          <Button onClick={onGoLive}>
            <Rocket className="size-4" />
            {status === 'paused' ? 'Resume' : 'Go live'}
          </Button>
        )}
      </div>
      <NumberHealthCard compact />
      {t && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">Waiting for your team:</span>
          <button type="button" onClick={() => exitTo('tickets')} className="inline-flex items-center gap-1.5 hover:underline">
            <Ticket className="size-4 text-muted-foreground" />
            <span className="tabular-nums font-medium">{t.tickets}</span> open ticket{t.tickets === 1 ? '' : 's'}
            {t.overdue > 0 && <span className="text-destructive">({t.overdue} overdue)</span>}
          </button>
          <button type="button" onClick={() => exitTo('inbox')} className="inline-flex items-center gap-1.5 hover:underline">
            <Inbox className="size-4 text-muted-foreground" />
            <span className="tabular-nums font-medium">{t.unread}</span> unread message{t.unread === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </Card>
  )
}
