import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Inbox, Ticket } from 'lucide-react'
import { conversationInsights, errorText, getAgentOnNumber, toolCallInsights, type AgentOnNumber } from '@/app/api/meta'
import { listAccounts } from '@/app/api/whatsapp'
import { listChats } from '@/app/api/inbox'
import { listTickets } from '@/app/api/tickets'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { NumberHealthCard } from '@/app/whatsapp/NumberHealthCard'
import { useExitWizard } from '@/app/wizard/ExitContext'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { CompiledConfigViewer } from '@/app/components/wizard/CompiledConfigViewer'
import { Card } from '@/app/components/ui/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/app/components/ui/hover-card'
import { useWizard } from '@/app/wizard/WizardContext'
import { compileConfig } from '@/app/wizard/compiler'
import { STUDIO_NAV_SECTIONS } from '@/app/wizard/studioNav'
import type { StepId, StudioSectionId } from '@/app/wizard/types'

// One line of what each section covers, shown only on this page's nav cards — the sidebar itself
// stays label-only, so this lives here rather than on the shared STUDIO_NAV_SECTIONS entry.
const SECTION_BLURB: Partial<Record<StudioSectionId, string>> = {
  identity: 'Name, role and personality',
  abilities: 'Skills and rich replies',
  knowledge: 'FAQs, docs, website',
  connections: 'Other systems',
  safety: 'Words and handoff',
  testEval: 'Try it and run checks',
  publish: 'Go live',
  analytics: 'Trends and performance',
  activity: 'Health and logs',
}

// The studio's landing page: what Test & publish used to show at the very end ("Your agent's
// configuration") promoted to the front, plus a real stats-and-navigation hub above it so
// Overview does the job of a landing page rather than only a leftover review panel.
export function OverviewPage() {
  const { state, setSection, setPendingStepFocus } = useWizard()
  const compiled = useMemo(() => compileConfig(state), [state])

  // Live numbers from Meta's insights (last 30 days); cards show '—' until they load or if they can't.
  const [live, setLive] = useState<{ threads: string; handoffs: string; toolSuccess: string }>({ threads: '—', handoffs: '—', toolSuccess: '—' })
  useEffect(() => {
    conversationInsights().then(
      (c) => setLive((prev) => ({ ...prev, threads: String(c.aiThreads), handoffs: String(c.aiHandoffs) })),
      () => {},
    )
    toolCallInsights().then(
      (t) => {
        const rows = t.data ?? []
        const calls = rows.reduce((n, r) => n + r.thread_count, 0)
        const ok = rows.reduce((n, r) => n + r.thread_count * (r.success_rate ?? 0), 0)
        setLive((prev) => ({ ...prev, toolSuccess: calls ? `${Math.round((ok / calls) * 100)}%` : '—' }))
      },
      () => {},
    )
  }, [])

  // CompiledConfigViewer only ever calls onNavigate with a handful of (step, tab) combinations —
  // knowledge's own inner tabs need pendingStepFocus, everything else maps straight to a section.
  function onNavigate(step: StepId, tab?: string) {
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

  const faqCount = state.knowledge.faqs.length
  const docCount = state.knowledge.documents.length
  const siteCount = state.knowledge.websites.length
  const connectionCount = state.connections.connections.length

  return (
    <div className="space-y-10">
      <LiveOnWhatsApp phoneId={state.gate.selectedPhoneNumberId ?? null} />
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="AI conversations (30 days)" value={live.threads} />
        <MetricCard label="Handed to a person now" value={live.handoffs} />
        <MetricCard label="Tool success (30 days)" value={live.toolSuccess} />
        <MetricCard label="Skills" value={String(compiled.skills.length)} />
        <MetricCard
          label="Connections"
          value={String(connectionCount)}
          hoverContent={
            connectionCount === 0 ? (
              <p className="text-muted-foreground text-sm">
                No connections yet.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {state.connections.connections.map((conn) => (
                  <li key={conn.id}>{conn.name}</li>
                ))}
              </ul>
            )
          }
        />
        <MetricCard
          label="Knowledge"
          value={String(faqCount + docCount + siteCount)}
          hoverContent={
            <ul className="space-y-1 text-sm">
              <li>
                {faqCount} FAQ{faqCount === 1 ? '' : 's'}
              </li>
              <li>
                {docCount} document{docCount === 1 ? '' : 's'}
              </li>
              <li>
                {siteCount} website{siteCount === 1 ? '' : 's'} crawled
              </li>
            </ul>
          }
        />
        <MetricCard label="Rich replies" value={String(state.richReplies.richReplies.length)} />
      </section>

      <section className="space-y-3">
        <h3>Jump to a section</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIO_NAV_SECTIONS.filter((item) => item.group).map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" onClick={() => setSection(item.id)} className="h-full text-left">
                <Card className="h-full gap-2 p-4 transition-colors hover:bg-accent">
                  <div className="flex items-start gap-3">
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium">{item.label}</p>
                      <p className="text-muted-foreground text-xs">
                        {SECTION_BLURB[item.id]}
                      </p>
                    </div>
                  </div>
                </Card>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <span className="flex items-center gap-1.5">
          <h3>Your agent&rsquo;s configuration</h3>
          <InfoTooltip text="Everything you’ve set up, already saved as you went. This is a review, not a preview." />
        </span>
        <div className="rounded-lg border border-border bg-card p-8">
          <CompiledConfigViewer config={compiled} state={state} onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, hoverContent }: { label: string; value: string; hoverContent?: ReactNode }) {
  const card = (
    <div className="rounded-lg bg-muted p-4">
      <p className="text-muted-foreground" style={{ fontSize: '0.8125rem' }}>
        {label}
      </p>
      <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>{value}</p>
    </div>
  )
  if (!hoverContent) return card
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent>{hoverContent}</HoverCardContent>
    </HoverCard>
  )
}

interface Live {
  number: { name: string; display: string } | null
  agent: AgentOnNumber | null
  team: { tickets: number; overdue: number; unread: number }
}

/** Where the agent runs and what's waiting for the team: the number, on/off, open tickets and unread chats. */
function LiveOnWhatsApp({ phoneId }: { phoneId: string | null }) {
  const exitTo = useExitWizard()
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
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-5 text-sm">
        <p className="text-destructive">Couldn&rsquo;t load how your agent is doing on WhatsApp. {error}</p>
        <Button size="sm" variant="outline" onClick={load}>
          Try again
        </Button>
      </section>
    )
  const a = live?.agent
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3>Live on WhatsApp</h3>
          <p className="text-muted-foreground text-sm">
            {live ? (live.number ? `${live.number.name} · ${live.number.display}` : 'No WhatsApp number linked yet') : 'Loading…'}
          </p>
        </div>
        {live && <Badge className={a?.enabled ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>{a?.enabled ? 'Active' : 'Off'}</Badge>}
      </div>
      {live && (
        <p className="max-w-2xl text-sm">
          {a?.enabled
            ? a.audience === 'EVERYONE'
              ? 'Your agent answers every customer who messages this number.'
              : 'Your agent answers the phone numbers on its allowlist. Add a payment method in Billing Hub to let it answer everyone.'
            : 'Your agent is off, so customers get no AI replies. Turn it on in Publish.'}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard label="Open tickets" value={live ? String(live.team.tickets) : '—'} />
        <MetricCard label="Unread messages" value={live ? String(live.team.unread) : '—'} />
      </div>
      {!!live?.team.overdue && (
        <p className="text-destructive text-sm">
          {live.team.overdue} ticket{live.team.overdue === 1 ? ' is' : 's are'} past the response time.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => exitTo('inbox')}>
          <Inbox className="size-4" />
          Open inbox
        </Button>
        <Button variant="outline" size="sm" onClick={() => exitTo('tickets')}>
          <Ticket className="size-4" />
          View tickets
        </Button>
      </div>
      <div className="border-t border-border pt-4">
        <NumberHealthCard compact />
      </div>
    </section>
  )
}
