import { useEffect, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronRight, Inbox, Smartphone, Ticket } from 'lucide-react'
import { useNavigate } from 'react-router'
import { listChats } from '@/app/api/inbox'
import { listTickets } from '@/app/api/tickets'
import { getNumberHealth } from '@/app/api/whatsapp'
import { StatusPill } from '@/app/components/ui/status'
import { AGENT_STATUS, agentStatusOf, type Tone } from '@/app/lib/status'
import { cn } from '@/app/lib/utils'
import { Button } from '@/app/components/ui/button'
import { useAuth } from '@/app/auth/AuthContext'
import { errorText, getAgentOnNumber, type AgentOnNumber } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import type { NavId } from '@/app/nav'
import type { SettingsTab } from '@/app/components/shell/SettingsPage'
import { getSignupConfig, listAccounts, type SignupConfig, type WaAccount } from '@/app/api/whatsapp'
import { AccountSteps, ConnectWhatsApp } from '@/app/whatsapp/ConnectWhatsApp'
import { isDummyMode } from '@/app/api/dummy'
import { resetDummyWhatsApp } from '@/app/api/supportDummy'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { PageLoader } from '@/app/components/ui/wavy-loader'

interface Snapshot {
  number: { id: string; display: string; name: string } | null
  agent: AgentOnNumber | null
}

/** What Home needs: the workspace's WhatsApp accounts, and the first number that has an agent. */
async function loadSnapshot(accounts: WaAccount[]): Promise<Snapshot> {
  const numbers = accounts.flatMap((a) => a.phoneNumbers)
  const withAgents = await Promise.all(numbers.map(async (n) => ({ n, agent: await getAgentOnNumber(n.id).catch(() => null) })))
  const pick = withAgents.find((x) => x.agent) ?? withAgents[0]
  return {
    number: pick ? { id: pick.n.id, display: pick.n.display || pick.n.id, name: pick.n.verifiedName } : null,
    agent: pick?.agent ?? null,
  }
}

function greeting(name?: string) {
  const h = new Date().getHours()
  const first = name?.trim().split(/\s+/)[0]
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return first ? `${part}, ${first}` : part
}

/** One step of the setup guide; `done` comes from live data, never from a click. */
function Step({ n, done, locked, title, note, children, action }: { n: number; done: boolean; locked?: string; title: string; note?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-5">
      <span
        className={
          done
            ? 'flex size-8 items-center justify-center rounded-full bg-success text-success-foreground'
            : locked
              ? 'flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground/60'
              : 'flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground'
        }
        aria-label={done ? 'Done' : `Step ${n}`}
      >
        {done ? <Check className="size-4 text-sm" /> : <span>{n}</span>}
      </span>
      <div className="min-w-0 space-y-2">
        <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }} className={done || locked ? 'text-muted-foreground' : undefined}>
          {title}
        </p>
        {done ? (
          note && (
            <div className="text-muted-foreground text-sm">
              {note}
            </div>
          )
        ) : locked ? (
          <p className="text-muted-foreground/80 text-sm">
            {locked}
          </p>
        ) : (
          <>
            {children && (
              <div className="text-muted-foreground text-sm">
                {children}
              </div>
            )}
            {action}
          </>
        )}
      </div>
    </li>
  )
}

const billingDone = (a: WaAccount) => a.source === 'env' || (a.billing.mode === 'partner_credit' ? a.billing.state === 'shared' : a.billing.state === 'confirmed')

const link = 'text-primary underline-offset-4 hover:underline'

/** The two things Home is for: connect WhatsApp, then build the agent. `done` comes from live data. */
function GetStarted({
  snap,
  accounts,
  config,
  onNavigate,
  onOpenSettings,
  onAccountChange,
  onCreateAgent,
}: {
  onCreateAgent: () => void
  snap: Snapshot
  accounts: WaAccount[]
  config: SignupConfig | null
  onNavigate: (id: NavId) => void
  onOpenSettings: (tab: SettingsTab) => void
  onAccountChange: (a: WaAccount) => void
}) {
  const { me } = useAuth()
  const manage = can(me?.role, 'whatsapp.manage')
  const account = accounts[0]
  const connected = !!account
  const billed = connected && billingDone(account)
  const number = account?.phoneNumbers[0]
  const agent = snap.agent
  return (
    <section className="rounded-xl border border-border p-6 md:p-8">
      <h2 className="text-section font-semibold">{!connected ? 'Start by connecting WhatsApp' : agent ? 'You’re set up' : 'Next, build your AI agent'}</h2>
      <ol className="mt-2 divide-y divide-border">
        <Step
          n={1}
          done={billed}
          title={connected ? 'WhatsApp connected' : 'Connect your WhatsApp Business number'}
          note={
            number && (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  {number.verifiedName || account.wabaName} · {number.display || number.id}
                </span>
                {can(me?.role, 'numbers.view') && (
                  <button type="button" className={link} onClick={() => onNavigate('whatsapp')}>
                    Manage numbers &rarr;
                  </button>
                )}
                {manage && (
                  <button type="button" className={link} onClick={() => onOpenSettings('whatsapp')}>
                    Add another number
                  </button>
                )}
              </span>
            )
          }
          action={
            <div className="pt-2">
              {connected ? (
                <AccountSteps account={account} canEdit={can(me?.role, 'billing.manage')} onChange={onAccountChange} />
              ) : (
                <ConnectWhatsApp config={config} isOwner={manage} workspaceName={me?.workspace?.name ?? 'this workspace'} variant="hero" onConnected={onAccountChange} />
              )}
            </div>
          }
        >
          {connected
            ? 'Finish billing so your number can send messages.'
            : 'Your AI agent, inbox and broadcasts all run on your own WhatsApp number. Connect it with Facebook in a few minutes, right here.'}
        </Step>
        <Step
          n={2}
          done={!!agent}
          locked={connected ? undefined : 'Unlocks after you connect your number.'}
          title={agent ? 'AI agent built' : 'Build your AI agent'}
          note={
            agent && (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <AgentPill agent={agent} />
                <span>
                  On {snap.number?.name} · {snap.number?.display}
                </span>
                <button type="button" className={link} onClick={() => onNavigate('ai-agents')}>
                  Open your agent &rarr;
                </button>
              </span>
            )
          }
          action={
            <Button size="sm" onClick={onCreateAgent}>
              <Bot className="size-4" />
              Build agent
            </Button>
          }
        >
          Name it, give it your business details and FAQs, test it, then publish. Its live numbers show on the agent&rsquo;s Overview.
        </Step>
      </ol>
    </section>
  )
}

/** The agent's status in the console's words, from what Meta reports. */
function AgentPill({ agent }: { agent: AgentOnNumber }) {
  const s = AGENT_STATUS[agentStatusOf({ activated: agent.enabled, stopped: false, audienceMode: agent.audience === 'EVERYONE' ? 'everyone' : 'allowlisted' })]
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

const QUALITY: Record<string, { label: string; tone: Tone }> = {
  GREEN: { label: 'High quality', tone: 'success' },
  YELLOW: { label: 'Medium quality', tone: 'warning' },
  RED: { label: 'Low quality', tone: 'danger' },
}

/** Once set up, Home is what needs attention today: open chats and tickets, the agent, the number. */
function AtAGlance({ agent, onNavigate }: { agent: AgentOnNumber; onNavigate: (id: NavId) => void }) {
  const [data, setData] = useState<{ unread: number; chats: number; tickets: number; overdue: number; quality: string | null } | null>(null)
  useEffect(() => {
    Promise.all([listChats().catch(() => []), listTickets().catch(() => []), getNumberHealth().catch(() => [])]).then(([chats, tickets, health]) =>
      setData({
        unread: chats.reduce((n, c) => n + c.unread, 0),
        chats: chats.filter((c) => c.unread > 0).length,
        tickets: tickets.length,
        overdue: tickets.filter((t) => t.sla.breached).length,
        quality: health[0]?.quality ?? null,
      }),
    )
  }, [])
  const q = data?.quality ? QUALITY[data.quality] : undefined
  const tiles: { id: NavId; icon: typeof Inbox; label: string; value: ReactNode; note?: ReactNode; urgent?: boolean }[] = [
    { id: 'inbox', icon: Inbox, label: 'Unread messages', value: data?.unread ?? '—', note: data ? `${data.chats} chat${data.chats === 1 ? '' : 's'} waiting` : undefined, urgent: !!data?.unread },
    {
      id: 'tickets',
      icon: Ticket,
      label: 'Open tickets',
      value: data?.tickets ?? '—',
      note: data?.overdue ? <span className="text-destructive">{data.overdue} past the response time</span> : data ? 'All within response time' : undefined,
      urgent: !!data?.overdue,
    },
    { id: 'ai-agents', icon: Bot, label: 'AI agent', value: <AgentPill agent={agent} />, note: agent.enabled ? 'Answering customers' : 'Not answering yet' },
    { id: 'whatsapp', icon: Smartphone, label: 'WhatsApp number', value: q ? <StatusPill tone={q.tone}>{q.label}</StatusPill> : '—', note: 'Quality rating from Meta' },
  ]
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold">At a glance</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onNavigate(t.id)}
            className={cn('group flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-border-strong', t.urgent ? 'border-warning/50' : 'border-border')}
          >
            <span className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <t.icon className="size-4" />
                {t.label}
              </span>
              <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="text-title font-semibold tabular-nums">{t.value}</span>
            {t.note && <span className="text-xs text-muted-foreground">{t.note}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Home: connect WhatsApp and build the agent; once that's done, what needs attention today. */
export function HomePage({ onNavigate, onOpenSettings }: { onNavigate: (id: NavId) => void; onOpenSettings: (tab: SettingsTab) => void }) {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [accounts, setAccounts] = useState<WaAccount[]>([])
  const [config, setConfig] = useState<SignupConfig | null>(null)
  useRegisterDevControls(
    'home-whatsapp',
    isDummyMode() ? (
      <DemoControlsGroup label="WhatsApp">
        <Button size="sm" variant="outline" onClick={() => {
            resetDummyWhatsApp(false)
            setAttempt((n) => n + 1)
          }}>
          New workspace (no number)
        </Button>
        <Button size="sm" variant="outline" onClick={() => {
            resetDummyWhatsApp(true)
            setAttempt((n) => n + 1)
          }}>
          Number connected
        </Button>
      </DemoControlsGroup>
    ) : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([listAccounts().then(async (a) => [a, await loadSnapshot(a)] as const), getSignupConfig().catch(() => null)]).then(
      ([[a, s], c]) => {
        if (cancelled) return
        setSnap(s)
        setAccounts(a)
        setConfig(c)
      },
      (err) => !cancelled && setError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-display">{greeting(me?.user.name)}</h1>
        <p className="mt-1 text-muted-foreground">{me?.workspace?.name}</p>
      </div>
      {error ? (
        <div className="rounded-xl border border-border p-6 text-sm">
          <p className="text-destructive">Couldn&rsquo;t check your WhatsApp setup. {error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !snap ? (
        <PageLoader context="home" />
      ) : (
        <>
          {snap.agent && accounts[0] && billingDone(accounts[0]) && <AtAGlance agent={snap.agent} onNavigate={onNavigate} />}
          {!(snap.agent && accounts[0] && billingDone(accounts[0])) && (
        <GetStarted
          onCreateAgent={() => navigate('/agents?new')}
          snap={snap}
          accounts={accounts}
          config={config}
          onNavigate={onNavigate}
          onOpenSettings={onOpenSettings}
          onAccountChange={(a) => {
            setAccounts((prev) => [...prev.filter((x) => x.wabaId !== a.wabaId), a])
            // A newly connected number changes what the rest of Home shows (its agent).
            if (!accounts.some((x) => x.wabaId === a.wabaId)) setAttempt((n) => n + 1)
          }}
        />
          )}
        </>
      )}
    </div>
  )
}
