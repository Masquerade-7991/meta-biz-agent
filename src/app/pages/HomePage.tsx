import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, Check, Inbox, Loader2, Ticket } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { useAuth } from '@/app/auth/AuthContext'
import { conversationInsights, errorText, getAgentOnNumber, listPhoneNumbers, listWabas, type AgentOnNumber } from '@/app/api/meta'
import { HELP_GROUPS } from '@/app/home/helpLinks'
import { listChats } from '@/app/api/inbox'
import { listTickets } from '@/app/api/tickets'
import type { NavId } from '@/app/nav'
import { SECTION_TITLE, TEXT_SM_OPEN } from '@/app/lib/text'

interface Snapshot {
  waba: { id: string; name: string } | null
  number: { id: string; display: string; name: string } | null
  agent: AgentOnNumber | null
  week: { aiThreads: number; aiHandoffs: number } | null
}


const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** What Home needs to pick its state: the connected WhatsApp number, its agent, and last week's numbers. */
async function loadSnapshot(): Promise<Snapshot> {
  const [waba] = await listWabas()
  if (!waba) return { waba: null, number: null, agent: null, week: null }
  const numbers = await listPhoneNumbers(waba.id)
  const withAgents = await Promise.all(numbers.map(async (n) => ({ n, agent: await getAgentOnNumber(n.id).catch(() => null) })))
  const pick = withAgents.find((x) => x.agent) ?? withAgents[0]
  const now = new Date()
  const week = pick?.agent
    ? await conversationInsights({ start_date: isoDay(new Date(now.getTime() - 6 * 86_400_000)), end_date: isoDay(now) }).catch(() => null)
    : null
  return {
    waba,
    number: pick ? { id: pick.n.id, display: pick.n.displayPhoneNumber, name: pick.n.verifiedName } : null,
    agent: pick?.agent ?? null,
    week,
  }
}

function greeting(name?: string) {
  const h = new Date().getHours()
  const first = name?.trim().split(/\s+/)[0]
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return first ? `${part}, ${first}` : part
}

/** One step of the setup guide; `done` comes from live data, never from a click. */
function Step({ n, done, title, children, action }: { n: number; done: boolean; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-5">
      <span
        className={
          done
            ? 'flex size-8 items-center justify-center rounded-full bg-success text-success-foreground'
            : 'flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground'
        }
        aria-label={done ? 'Done' : `Step ${n}`}
      >
        {done ? <Check className="size-4" /> : <span style={{ fontSize: 'var(--text-sm)' }}>{n}</span>}
      </span>
      <div className="space-y-2">
        <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }} className={done ? 'text-muted-foreground' : undefined}>
          {title}
        </p>
        {!done && (
          <>
            <div className="text-muted-foreground" style={TEXT_SM_OPEN}>
              {children}
            </div>
            {action}
          </>
        )}
      </div>
    </li>
  )
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ArrowUpRight className="size-3.5" />
      </a>
    </Button>
  )
}

/** New workspace: what to do, in order, to get an AI agent answering on WhatsApp. */
function SetupGuide({ snap, onNavigate }: { snap: Snapshot; onNavigate: (id: NavId) => void }) {
  const connected = !!snap.waba
  const hasAgent = !!snap.agent
  const steps = [connected, connected, connected, hasAgent, !!snap.agent?.enabled]
  const doneCount = steps.filter(Boolean).length
  return (
    <section className="rounded-xl border border-border p-6 md:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 style={SECTION_TITLE}>Set up WhatsApp for your AI agent</h2>
        <p className="text-muted-foreground" style={TEXT_SM_OPEN}>
          {doneCount} of {steps.length} done
        </p>
      </div>
      <ol className="mt-2 divide-y divide-border">
        <Step n={1} done={steps[0]} title="Create a Meta Business portfolio" action={<ExternalButton href="https://business.facebook.com/settings">Open Business settings</ExternalButton>}>
          Your business&rsquo;s home on Meta. It owns your WhatsApp account and decides who can manage it.
        </Step>
        <Step n={2} done={steps[1]} title="Add a WhatsApp Business number" action={<ExternalButton href="https://business.facebook.com/wa/manage/home/">Open WhatsApp Manager</ExternalButton>}>
          Use a number that isn&rsquo;t on the WhatsApp app. Meta checks it by SMS or call, then asks you to approve a display name customers will see.
        </Step>
        <Step n={3} done={steps[2]} title="Connect the number to this workspace" action={<ExternalButton href="https://helo.ai/contact-us">Contact Helo.ai</ExternalButton>}>
          Helo.ai links your WhatsApp Business Account to this workspace. Once it&rsquo;s linked, this step ticks itself.
        </Step>
        <Step
          n={4}
          done={steps[3]}
          title="Create your AI agent"
          action={
            <Button size="sm" onClick={() => onNavigate('ai-agents')} disabled={!connected}>
              Create agent
            </Button>
          }
        >
          {connected ? 'Name it, check the number is eligible, then give it your business details and FAQs.' : 'Available once your number is connected.'}
        </Step>
        <Step
          n={5}
          done={steps[4]}
          title="Switch your agent on"
          action={
            <Button size="sm" variant="outline" onClick={() => onNavigate('ai-agents')} disabled={!hasAgent}>
              Open AI agents
            </Button>
          }
        >
          Test it, add the phone numbers allowed to chat with it, then switch it on. It answers those customers straight away.
        </Step>
      </ol>
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-muted-foreground" style={TEXT_SM_OPEN}>
        {label}
      </p>
      <p style={{ fontSize: 'var(--text-h4)', fontWeight: 'var(--font-weight-semi-bold)', lineHeight: 1.1 }}>{value}</p>
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        {hint}
      </p>
    </div>
  )
}

/** Returning workspace: the agent's live state and the next things to do. */
function AgentHome({ snap, onNavigate }: { snap: Snapshot; onNavigate: (id: NavId) => void }) {
  const a = snap.agent!
  const [team, setTeam] = useState<{ tickets: number; overdue: number; unread: number } | null>(null)
  useEffect(() => {
    Promise.all([listTickets(), listChats()]).then(
      ([t, c]) => setTeam({ tickets: t.length, overdue: t.filter((x) => x.sla.breached).length, unread: c.reduce((n, x) => n + x.unread, 0) }),
      () => {},
    )
  }, [])
  return (
    <section className="rounded-xl border border-border p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 style={SECTION_TITLE}>Get started with your agent</h2>
          <p className="text-muted-foreground" style={TEXT_SM_OPEN}>
            {snap.number?.name} &middot; {snap.number?.display}
          </p>
        </div>
        <Badge className={a.enabled ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}>{a.enabled ? 'Active' : 'Stopped'}</Badge>
      </div>
      <p className="mt-4 max-w-2xl" style={TEXT_SM_OPEN}>
        {a.enabled
          ? a.audience === 'EVERYONE'
            ? 'Your agent answers every customer who messages this number.'
            : 'Your agent answers the phone numbers on its allowlist. Add a payment method in Billing Hub to let it answer everyone.'
          : 'Your agent is switched off, so customers get no AI replies. Switch it on from AI agents.'}
      </p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="AI conversations" value={snap.week ? String(snap.week.aiThreads) : '–'} hint="Last 7 days" />
        <Stat label="Handed to a person" value={snap.week ? String(snap.week.aiHandoffs) : '–'} hint="Waiting for your team right now" />
        <Stat label="Open tickets" value={team ? String(team.tickets) : '–'} hint={team?.overdue ? `${team.overdue} overdue` : 'None overdue'} />
        <Stat label="Unread messages" value={team ? String(team.unread) : '–'} hint="Across all chats" />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => onNavigate('ai-agents')}>
          <Bot className="size-4" />
          Open your agent
        </Button>
        <Button variant="outline" onClick={() => onNavigate('inbox')}>
          <Inbox className="size-4" />
          Open inbox
        </Button>
        <Button variant="outline" onClick={() => onNavigate('tickets')}>
          <Ticket className="size-4" />
          View tickets
        </Button>
      </div>
    </section>
  )
}

function HelpGuides() {
  return (
    <section className="space-y-6">
      <h2 style={SECTION_TITLE}>Product guides</h2>
      {HELP_GROUPS.map((g) => (
        <div key={g.title} className="space-y-2">
          <h3 className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>
            {g.title}
          </h3>
          <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {g.links.map((l) => (
              <li key={l.href} className="border-t border-border">
                <a href={l.href} target="_blank" rel="noreferrer" className="group block rounded-sm py-3 focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex items-center gap-1 text-primary group-hover:underline" style={{ ...TEXT_SM_OPEN, fontWeight: 'var(--font-weight-semi-bold)' }}>
                    {l.title}
                    <ArrowUpRight className="size-3.5 shrink-0" />
                  </span>
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                    {l.description}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** Home: a WhatsApp setup guide until an agent exists, then the agent's live state; product guides always. */
export function HomePage({ onNavigate }: { onNavigate: (id: NavId) => void }) {
  const { me } = useAuth()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(null)
    loadSnapshot().then(
      (s) => !cancelled && setSnap(s),
      (err) => !cancelled && setError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-8">
      <div>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, var(--text-2xl))', lineHeight: 1.1 }}>{greeting(me?.user.name)}</h1>
        <p className="mt-1 text-muted-foreground">{me?.workspace?.name}</p>
      </div>
      {error ? (
        <div className="rounded-xl border border-border p-6" style={TEXT_SM_OPEN}>
          <p className="text-destructive">Couldn&rsquo;t check your WhatsApp setup. {error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !snap ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground" style={TEXT_SM_OPEN}>
          <Loader2 className="size-4 animate-spin" />
          Checking your WhatsApp setup&hellip;
        </div>
      ) : snap.agent ? (
        <AgentHome snap={snap} onNavigate={onNavigate} />
      ) : (
        <SetupGuide snap={snap} onNavigate={onNavigate} />
      )}
      <HelpGuides />
    </div>
  )
}
