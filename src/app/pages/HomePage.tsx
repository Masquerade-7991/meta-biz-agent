import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, Check, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { useAuth } from '@/app/auth/AuthContext'
import { errorText, getAgentOnNumber, type AgentOnNumber } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import { HELP_GROUPS } from '@/app/home/helpLinks'
import type { NavId } from '@/app/nav'
import type { SettingsTab } from '@/app/components/shell/SettingsPage'
import { getSignupConfig, listAccounts, type SignupConfig, type WaAccount } from '@/app/api/whatsapp'
import { AccountSteps, ConnectWhatsApp } from '@/app/whatsapp/ConnectWhatsApp'
import { isDummyMode } from '@/app/api/dummy'
import { resetDummyWhatsApp } from '@/app/api/supportDummy'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { SECTION_TITLE, TEXT_SM_OPEN } from '@/app/lib/text'

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
        {done ? <Check className="size-4" /> : <span style={{ fontSize: 'var(--text-sm)' }}>{n}</span>}
      </span>
      <div className="min-w-0 space-y-2">
        <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }} className={done || locked ? 'text-muted-foreground' : undefined}>
          {title}
        </p>
        {done ? (
          note && (
            <div className="text-muted-foreground" style={TEXT_SM_OPEN}>
              {note}
            </div>
          )
        ) : locked ? (
          <p className="text-muted-foreground/80" style={TEXT_SM_OPEN}>
            {locked}
          </p>
        ) : (
          <>
            {children && (
              <div className="text-muted-foreground" style={TEXT_SM_OPEN}>
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
}: {
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
      <h2 style={SECTION_TITLE}>{!connected ? 'Start by connecting WhatsApp' : agent ? 'You’re set up' : 'Next, build your AI agent'}</h2>
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
                <Badge className={agent.enabled ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>{agent.enabled ? 'Active' : 'Off'}</Badge>
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
            <Button size="sm" onClick={() => onNavigate('ai-agents')}>
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

/** Home: connect WhatsApp and build the agent, then product guides. The agent's live state is on its Overview. */
export function HomePage({ onNavigate, onOpenSettings }: { onNavigate: (id: NavId) => void; onOpenSettings: (tab: SettingsTab) => void }) {
  const { me } = useAuth()
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
      ) : (
        <GetStarted
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
      <HelpGuides />
    </div>
  )
}
