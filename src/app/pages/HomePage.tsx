import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, BarChart3, Bot, ChevronRight, CreditCard, Headset, Inbox, MessageCircle, Rocket, Smartphone, Ticket, UserPlus, Users } from 'lucide-react'
import { useNavigate } from 'react-router'
import { listChats, type ChatSummary } from '@/app/api/inbox'
import { getSupportSettings, listTickets } from '@/app/api/tickets'
import { getOverview } from '@/app/api/overview'
import { addDays, isoDay, type Overview } from '@/app/analytics/types'
import { dur, num, pct } from '@/app/analytics/format'
import { getNumberHealth } from '@/app/api/whatsapp'
import { StatusPill } from '@/app/components/ui/status'
import { AGENT_STATUS, agentStatusOf, progressTone, type Tone } from '@/app/lib/status'
import { cn } from '@/app/lib/utils'
import { Button } from '@/app/components/ui/button'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail, errorText, getAgentOnNumber, type AgentOnNumber } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import type { NavId } from '@/app/nav'
import type { SettingsTab } from '@/app/components/shell/settings/areas'
import { workspaceAccounts, type WaAccount } from '@/app/api/whatsapp'
import { ConnectNumberButton } from '@/app/whatsapp/ConnectNumberDialog'
import { isDummyMode } from '@/app/api/dummy'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { hasTestConversations, listStoredAgents } from '@/app/api/store'
import { authApi, resetDemoTeam } from '@/app/auth/api'
import { DOCS_BASE, QUICK_START } from '@/app/home/helpLinks'
import { setupSteps, type SetupSignals, type SetupStepId } from '@/app/home/setupSteps'
import { studioPath } from '@/app/wizard/studioPaths'
import { useWizard } from '@/app/wizard/WizardContext'
import { useOmnibarScope } from '@/app/omnibar/OmnibarContext'
import type { OmniItem } from '@/app/omnibar/scope'

interface Snapshot {
  number: { id: string; display: string; name: string } | null
  agent: AgentOnNumber | null
  /** Why the agent lookup failed, when no number answered with one: Home can't tell "no agent" apart. */
  lookupError: string | null
}

/** What Home needs: the workspace's WhatsApp accounts, and the first number that has an agent. */
async function loadSnapshot(accounts: WaAccount[]): Promise<Snapshot> {
  const numbers = accounts.flatMap((a) => a.phoneNumbers)
  const withAgents = await Promise.all(
    numbers.map(async (n) => {
      try {
        return { n, agent: await getAgentOnNumber(n.id), error: null }
      } catch (err) {
        return { n, agent: null, error: errorDetail(err) }
      }
    }),
  )
  const pick = withAgents.find((x) => x.agent) ?? withAgents[0]
  return {
    number: pick ? { id: pick.n.id, display: pick.n.display, name: pick.n.verifiedName } : null,
    agent: pick?.agent ?? null,
    lookupError: pick?.agent ? null : (withAgents.find((x) => x.error)?.error ?? null),
  }
}

function greeting(name?: string) {
  const h = new Date().getHours()
  const first = name?.trim().split(/\s+/)[0]
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return first ? `${part}, ${first}` : part
}

const billingDone = (a: WaAccount) => a.source === 'env' || (a.billing.mode === 'partner_credit' ? a.billing.state === 'shared' : a.billing.state === 'confirmed')

const link = 'text-primary underline-offset-4 hover:underline'

/** A link to another site: a new tab, and screen readers are told so. */
function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1', link, className)}>
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/** A quiet note in place of a button someone's role can't use. */
const WhoDoesIt = ({ children }: { children: ReactNode }) => <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">{children}</p>

interface StepView {
  title: string
  icon: typeof Bot
  /** One sentence on what this step is for. */
  why: ReactNode
  /** The step's one action (or who does it). */
  action: ReactNode
  docs: string
}

/** Setup on Home, kept small: one card with the next thing to do, one with what comes after.
 *  Done-ness comes from live data (setupSteps.ts); the full checklist lives in the agent's overview. */
const STEP_TITLE: Record<SetupStepId, string> = {
  connect: 'Connect your WhatsApp number',
  account: 'Finish account setup',
  build: 'Build your AI agent',
  test: 'Test it in a chat',
  live: 'Go live',
  invite: 'Invite your team',
}

/** Scrolls to a card on Home and puts focus on its first button or link (the omnibar's matches). */
function focusCard(id: string) {
  const el = document.getElementById(id)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
}

function SetupGuide({
  signals,
  snap,
  account,
  draftName,
  onOpenSettings,
  onAccountChange,
}: {
  signals: SetupSignals
  snap: Snapshot
  account: WaAccount | undefined
  draftName: string
  onOpenSettings: (tab: SettingsTab) => void
  onAccountChange: (a: WaAccount) => void
}) {
  const { me } = useAuth()
  const navigate = useNavigate()
  const manage = can(me?.role, 'whatsapp.manage')
  const edit = can(me?.role, 'agent.edit')
  const ws = me?.workspace?.name ?? 'this workspace'
  const { steps } = setupSteps(signals)
  const agentOnly = <WhoDoesIt>An admin or owner of {ws} sets up the AI agent.</WhoDoesIt>
  const view: Record<SetupStepId, StepView> = {
    connect: {
      title: STEP_TITLE.connect,
      icon: Smartphone,
      why: 'Your AI agent and inbox run on your own WhatsApp number. Connect it with Facebook in a few minutes.',
      action: manage ? <ConnectNumberButton onConnected={onAccountChange} /> : <WhoDoesIt>An owner of {ws} connects the number.</WhoDoesIt>,
      docs: `${DOCS_BASE}/guide/connect-number`,
    },
    account: {
      title: STEP_TITLE.account,
      icon: CreditCard,
      why: account?.needsAttention ? 'A setup step didn’t finish. Retry it so your number can send messages.' : 'Add a payment method so your number can send messages.',
      action: manage ? (
        <Button onClick={() => navigate('/whatsapp?tab=account')}>
          <CreditCard className="size-4" />
          Finish setup
        </Button>
      ) : (
        <WhoDoesIt>An owner of {ws} finishes this.</WhoDoesIt>
      ),
      docs: `${DOCS_BASE}/guide/connect-number#setup-steps`,
    },
    build: {
      title: STEP_TITLE.build,
      icon: Bot,
      why: draftName ? `“${draftName}” is started. Finish its details so it can answer.` : 'Name it and give it your business details and FAQs. It takes a few minutes.',
      action: edit ? (
        <Button onClick={() => navigate(draftName && !snap.agent ? '/agents' : '/agents?new')}>
          <Bot className="size-4" />
          {draftName ? 'Continue setting it up' : 'Build agent'}
        </Button>
      ) : (
        agentOnly
      ),
      docs: `${DOCS_BASE}/guide/build-agent`,
    },
    test: {
      title: STEP_TITLE.test,
      icon: MessageCircle,
      why: 'Chat with your agent as a customer would, and check its answers before anyone else sees them.',
      action: edit ? (
        <Button onClick={() => navigate(studioPath('testEval'))}>
          <MessageCircle className="size-4" />
          Open Try it
        </Button>
      ) : (
        agentOnly
      ),
      docs: `${DOCS_BASE}/guide/build-agent/test`,
    },
    live: {
      title: STEP_TITLE.live,
      icon: Rocket,
      why: 'Switch it on for everyone, so it starts answering your customers.',
      action: edit ? (
        <Button onClick={() => navigate(studioPath('publish'))}>
          <Rocket className="size-4" />
          Go live
        </Button>
      ) : (
        agentOnly
      ),
      docs: `${DOCS_BASE}/guide/build-agent/publish`,
    },
    invite: { title: STEP_TITLE.invite, icon: Users, why: null, action: null, docs: `${DOCS_BASE}/guide/settings#members-and-roles` },
  }
  const required = steps.filter((s) => !s.optional)
  const current = required.find((s) => s.current)
  if (!current) return null
  const at = required.indexOf(current)
  const next = view[current.id]
  const later = required.slice(at + 1)
  const invite = steps.find((s) => s.optional && !s.done)
  return (
    <section className="grid gap-4 lg:grid-cols-3" aria-label="Get set up">
      <div id="home-next-step" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">
            Next step · {at + 1} of {required.length}
          </p>
          <div className="flex gap-1" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={at}>
            {required.map((s, i) => (
              <span key={s.id} className={cn('h-1.5 w-6 rounded-full', i < at ? progressTone(at, required.length) : i === at ? 'bg-primary/40' : 'bg-muted')} />
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <next.icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-section font-semibold">{next.title}</h2>
            <p className="text-sm text-muted-foreground">{next.why}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:pl-14">
          {next.action}
          <ExternalLink href={next.docs} className="text-sm">
            Learn how
          </ExternalLink>
        </div>
      </div>
      <div className="flex flex-col rounded-lg border border-border bg-card p-5">
        <p className="text-xs font-medium text-muted-foreground">After that</p>
        {later.length ? (
          <ol className="mt-3 space-y-2.5">
            {later.map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">{s.n}</span>
                {view[s.id].title}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">This is the last step. Then Home becomes your dashboard.</p>
        )}
        {invite && (
          <button type="button" onClick={() => onOpenSettings('members')} className={cn(link, 'mt-auto flex items-center gap-1.5 pt-4 text-sm')}>
            <Users className="size-4" />
            Invite your team (optional)
          </button>
        )}
      </div>
    </section>
  )
}

/** One line about something unfinished or wrong, above the dashboard. */
function Notice({ title, children, action, tone }: { title: string; children: ReactNode; action?: ReactNode; tone?: 'warning' }) {
  return (
    <section className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4', tone === 'warning' ? 'border-warning/50 bg-warning/10' : 'border-border bg-card')}>
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      {action}
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
function AtAGlance({
  agent,
  draftName,
  chats: loadChats,
  onNavigate,
  preview,
}: {
  agent: AgentOnNumber | null
  draftName: string
  chats: () => Promise<ChatSummary[]>
  onNavigate: (id: NavId) => void
  /** First visit: the same tiles, empty, with a hint of what fills them (whether a number is connected yet). Nothing is loaded. */
  preview?: 'connected' | 'new'
}) {
  // tickets null: they couldn't be loaded, so no count is shown (rather than a reassuring 0).
  const [data, setData] = useState<{ unread: number; chats: number; tickets: number | null; overdue: number; quality: string | null } | null>(null)
  useEffect(() => {
    if (preview) return
    Promise.all([loadChats(), listTickets({ limit: '1000' }).catch(() => null), getNumberHealth().catch(() => [])]).then(([chats, tickets, health]) =>
      setData({
        unread: chats.reduce((n, c) => n + c.unread, 0),
        chats: chats.filter((c) => c.unread > 0).length,
        tickets: tickets?.length ?? null,
        overdue: tickets?.filter((t) => t.sla.breached).length ?? 0,
        quality: health[0]?.quality ?? null,
      }),
    )
  }, [loadChats, preview])
  const q = data?.quality ? QUALITY[data.quality] : undefined
  const tiles: { id: NavId; icon: typeof Inbox; label: string; value: ReactNode; note?: ReactNode; urgent?: boolean }[] = [
    { id: 'inbox', icon: Inbox, label: 'Unread messages', value: data?.unread ?? '—', note: data ? `${data.chats} chat${data.chats === 1 ? '' : 's'} waiting` : undefined, urgent: !!data?.unread },
    {
      id: 'tickets',
      icon: Ticket,
      label: 'Open tickets',
      value: data?.tickets ?? '—',
      note: data?.overdue ? (
        <span className="text-destructive">{data.overdue} past the response time</span>
      ) : data?.tickets == null ? (
        data && 'Couldn’t load tickets'
      ) : (
        'All within response time'
      ),
      urgent: !!data?.overdue,
    },
    {
      id: 'ai-agents',
      icon: Bot,
      label: 'AI agent',
      value: agent ? <AgentPill agent={agent} /> : <StatusPill tone={AGENT_STATUS.draft.tone}>{draftName ? AGENT_STATUS.draft.label : 'Not built'}</StatusPill>,
      note: agent?.enabled ? 'Answering customers' : draftName ? `“${draftName}” isn’t live yet` : 'Not answering yet',
    },
    { id: 'whatsapp', icon: Smartphone, label: 'WhatsApp number', value: q ? <StatusPill tone={q.tone}>{q.label}</StatusPill> : '—', note: 'Quality rating from Meta' },
  ]
  if (preview) {
    const hints: Partial<Record<NavId, string>> = {
      inbox: 'Shows unread messages once customers write',
      tickets: 'Tickets open when chats need your team',
      'ai-agents': 'Answers customers once it’s live',
      whatsapp: preview === 'connected' ? 'Quality rating from Meta' : 'Quality rating appears after you connect',
    }
    for (const t of tiles) Object.assign(t, { note: hints[t.id], urgent: false })
  }
  return (
    <section className="space-y-3">
      <h2 className="text-section font-semibold">At a glance</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onNavigate(t.id)}
            className={cn('group flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:border-border-strong', t.urgent ? 'border-warning/50' : preview ? 'border-dashed border-border' : 'border-border')}
          >
            <span className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <t.icon className="size-4" />
                {t.label}
              </span>
              <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className={cn('text-title font-semibold tabular-nums', preview && 'text-muted-foreground')}>{t.value}</span>
            {t.note && <span className="text-xs text-muted-foreground">{t.note}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

const timeAgo = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)}d`
}
const initialsOf = (name: string | null, phone: string) => (name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : phone.slice(-2))

/** The latest conversations, each one click from its chat. */
function RecentChats({ chats: loadChats, onOpenChat, onNavigate }: { chats: () => Promise<ChatSummary[]>; onOpenChat: (phone: string) => void; onNavigate: (id: NavId) => void }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  useEffect(() => {
    void loadChats().then((c) => setChats(c.slice(0, 6)))
  }, [loadChats])
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-section font-semibold">Recent conversations</h2>
        <Button variant="link" size="sm" onClick={() => onNavigate('inbox')}>
          Open Inbox
        </Button>
      </div>
      {!chats ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">No conversations yet. They show up here as customers message your number.</p>
      ) : (
        <ul className="divide-y divide-border">
          {chats.map((c) => (
            <li key={c.phone}>
              <button type="button" onClick={() => onOpenChat(c.phone)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initialsOf(c.name, c.phone)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn('truncate', c.unread ? 'font-semibold' : 'font-medium')}>{c.name || (c.username ? `@${c.username}` : `+${c.phone}`)}</span>
                    <StatusPill tone={c.owner === 'ai' ? 'info' : 'warning'} dot={false}>
                      {c.owner === 'ai' ? 'AI' : 'Team'}
                    </StatusPill>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {c.preview?.author === 'ai' ? 'AI: ' : c.preview?.author === 'agent' ? 'You: ' : ''}
                    {c.preview?.body ?? 'No messages yet'}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums">{timeAgo(c.lastMessageAt)}</span>
                  {c.unread > 0 && <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-micro leading-5 text-primary-foreground">{c.unread}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface QuickAction {
  icon: typeof Inbox
  label: string
  hint: string
  run?: () => void
  /** Another site, opened in a new tab. */
  href?: string
}

/** The things people do most, one click away. */
function QuickActions({ title = 'Quick actions', actions }: { title?: string; actions: (QuickAction | false)[] }) {
  const row = 'group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60'
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-5 py-3 text-section font-semibold">{title}</h2>
      <ul className="p-2">
        {actions.filter((a): a is QuickAction => !!a).map((a) => {
          const body = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                <a.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
              </span>
              {a.href ? <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-4 text-muted-foreground" />}
            </>
          )
          return (
            <li key={a.label}>
              {a.href ? (
                <a href={a.href} target="_blank" rel="noreferrer" className={row}>
                  {body}
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <button type="button" onClick={a.run} className={row}>
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** First visit: Helo.ai's guides, each opening the docs site in a new tab. */
function QuickStartGuides() {
  return (
    <section id="home-guides" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section font-semibold">Quick-start guides</h2>
        <ExternalLink href={`${DOCS_BASE}/guide`} className="text-sm">
          All guides
        </ExternalLink>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_START.map((g) => (
          <li key={g.href}>
            <a href={g.href} target="_blank" rel="noreferrer" className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-border-strong">
              <span className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                  <g.icon className="size-5" />
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="font-semibold">{g.title}</span>
              <span className="line-clamp-2 text-sm text-muted-foreground">{g.description}</span>
              <span className="mt-auto text-xs text-muted-foreground">{g.minutes} min read</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The last 7 days, counted exactly as on the Analytics page (calendar days, the same definitions):
 *  how chats split between the AI, the team and no reply, and tickets opened vs resolved. */
function ThisWeek({ onNavigate }: { onNavigate: (id: NavId) => void }) {
  const [d, setD] = useState<Overview | null | 'none'>(null)
  useEffect(() => {
    // The business's day (its support hours' time zone), as on the Analytics page.
    getSupportSettings()
      .then((s) => s.hours.timezone, () => Intl.DateTimeFormat().resolvedOptions().timeZone)
      .then((tz) => {
        const to = isoDay(new Date(), tz)
        return getOverview({ from: addDays(to, -6), to, numbers: [], team: null, person: null })
      })
      .then(setD, () => setD('none'))
  }, [])
  if (d === 'none') return null
  const k = d?.kpis
  const sum = (key: 'aiOnly' | 'withTeam' | 'noReply') => (d ? d.series.reduce((a, p) => a + p[key], 0) : 0)
  const split = d ? { ai: sum('aiOnly'), team: sum('withTeam'), none: sum('noReply') } : null
  const total = split ? split.ai + split.team + split.none : 0
  const max = d ? Math.max(1, ...d.series.map((x) => Math.max(x.ticketsOpened, x.ticketsResolved))) : 1
  const stats = k
    ? [
        { label: 'Conversations', value: num(k.conversations.value) },
        { label: 'Handled by AI alone', value: pct(k.containment.value) },
        { label: 'Typical first reply', value: dur(k.medianFirstReplyMin.value) },
        { label: 'Customer satisfaction', value: pct(k.csat.value) },
      ]
    : []
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-section font-semibold">Last 7 days</h2>
        <Button variant="link" size="sm" onClick={() => onNavigate('analytics')}>
          Full analytics
        </Button>
      </div>
      {!d ? (
        <div className="h-56 animate-pulse rounded-b-lg bg-muted/40" />
      ) : (
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="text-title font-semibold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
            {split && total > 0 && (
              <div className="space-y-1.5">
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${split.ai} chats by the AI alone, ${split.team} with your team, ${split.none} with no reply`}>
                  <div className="bg-primary" style={{ width: `${(split.ai / total) * 100}%` }} />
                  <div className="bg-warning" style={{ width: `${(split.team / total) * 100}%` }} />
                  <div className="bg-destructive/60" style={{ width: `${(split.none / total) * 100}%` }} />
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary" /> AI alone {split.ai}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-warning" /> With your team {split.team}
                  </span>
                  {split.none > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-destructive/60" /> No reply {split.none}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Tickets per day</span>
              <span className="flex gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-border-strong" /> Opened
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-success" /> Resolved
                </span>
              </span>
            </p>
            {d.series.every((x) => !x.ticketsOpened && !x.ticketsResolved) ? (
              <p className="flex h-36 items-center justify-center rounded-md bg-muted/40 text-sm text-muted-foreground">No tickets in the last 7 days.</p>
            ) : (
              <div className="flex h-36 items-end gap-2" role="img" aria-label={`Tickets opened and resolved per day: ${k?.ticketsOpened.value ?? 0} opened, ${k?.ticketsResolved.value ?? 0} resolved in the last 7 days`}>
                {d.series.map((x) => (
                  <div key={x.date} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-28 w-full items-end justify-center gap-1">
                      <div className="w-1/3 rounded-t-sm bg-border-strong" style={{ height: `${(x.ticketsOpened / max) * 100}%`, minHeight: x.ticketsOpened ? 3 : 0 }} title={`${x.ticketsOpened} opened`} />
                      <div className="w-1/3 rounded-t-sm bg-success" style={{ height: `${(x.ticketsResolved / max) * 100}%`, minHeight: x.ticketsResolved ? 3 : 0 }} title={`${x.ticketsResolved} resolved`} />
                    </div>
                    <span className="text-micro text-muted-foreground">{new Date(x.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** Home: a first visit gets the setup guide over quiet previews of the dashboard and the quick-start
 *  guides; once set up, what needs attention today. */
export function HomePage({ onNavigate, onOpenSettings, onOpenChat }: { onNavigate: (id: NavId) => void; onOpenSettings: (tab: SettingsTab) => void; onOpenChat: (phone: string) => void }) {
  const { me } = useAuth()
  const role = me?.role
  const navigate = useNavigate()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  // Signs this isn't a first visit: agents saved in the console (any number), and chats. Plus the
  // setup guide's own signals: a test chat, and the team (people and pending invites).
  const [history, setHistory] = useState<{ agents: number; chats: number; tested: boolean; members: number; invites: number }>({ agents: 0, chats: 0, tested: false, members: 1, invites: 0 })
  const { state, resetWizard } = useWizard()
  const draftName = state.identity.agentName.trim()
  const [accounts, setAccounts] = useState<WaAccount[]>([])
  // At a glance and Recent conversations both show chats: one request between them.
  const chatsRequest = useRef<Promise<ChatSummary[]> | null>(null)
  const loadChats = useCallback(() => (chatsRequest.current ??= listChats().catch(() => [])), [])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const reload = () => {
    chatsRequest.current = null
    setAttempt((n) => n + 1)
  }
  useRegisterDevControls(
    'home-whatsapp',
    isDummyMode() ? (
      <DemoControlsGroup label="WhatsApp">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void Promise.all([import('@/app/api/supportDummy'), import('@/app/api/dummyMeta')]).then(([m, d]) => {
              // A brand-new workspace: no number, no chats, no agent and no draft.
              m.resetDummyWhatsApp(false)
              d.resetDummyAgent()
              resetDemoTeam()
              resetWizard()
              reload()
            })
          }
        >
          New workspace (no number)
        </Button>
        <Button size="sm" variant="outline" onClick={() => void import('@/app/api/supportDummy').then((m) => {
            m.resetDummyWhatsApp(true)
            reload()
          })}>
          Number connected
        </Button>
      </DemoControlsGroup>
    ) : null,
  )
  const invites = can(role, 'members.manage')
  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      workspaceAccounts(role).then(async (a) => [a, await loadSnapshot(a)] as const),
      listStoredAgents().catch(() => null),
      loadChats(),
      hasTestConversations().catch(() => false),
      invites ? authApi.members().catch(() => null) : null,
    ]).then(
      ([[a, s], stored, chats, tested, team]) => {
        if (cancelled) return
        setSnap(s)
        setAccounts(a)
        setHistory({ agents: stored?.length ?? 0, chats: chats.length, tested, members: team?.members.length ?? 1, invites: team?.invites.filter((x) => !x.expired).length ?? 0 })
      },
      (err) => !cancelled && setError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [attempt, loadChats, role, invites])

  const account = accounts[0]
  // Home is the dashboard once WhatsApp is connected and this isn't a first visit: an agent exists on
  // Meta or in the console (even a draft with just a name), or customers have already written.
  // A first visit gets the setup guide; anything unfinished shows as the guide above the dashboard.
  const returning = !!snap && !!account && (!!snap.agent || history.agents > 0 || !!draftName || history.chats > 0)
  const signals: SetupSignals = {
    connected: !!account,
    billed: !!account && billingDone(account),
    built: !!snap?.agent || history.agents > 0 || !!draftName,
    tested: history.tested || !!snap?.agent?.enabled,
    live: !!snap?.agent?.enabled && snap.agent.audience === 'EVERYONE',
    invited: history.members > 1 || history.invites > 0,
    canInvite: invites,
  }
  const setupDone = setupSteps(signals).allDone
  const guide = snap && (
    <SetupGuide
      signals={signals}
      snap={snap}
      account={account}
      draftName={draftName}
      onOpenSettings={onOpenSettings}
      onAccountChange={(a) => {
        setAccounts((prev) => [...prev.filter((x) => x.wabaId !== a.wabaId), a])
        // A newly connected number changes what the rest of Home shows (its agent).
        if (!accounts.some((x) => x.wabaId === a.wabaId)) reload()
      }}
    />
  )
  const quick: (QuickAction | false)[] = returning
    ? [
        (!!snap?.agent || !!draftName) && { icon: MessageCircle, label: 'Test your AI agent', hint: 'Chat with it as a customer would', run: () => navigate('/agents') },
        { icon: UserPlus, label: 'Add a contact', hint: 'Or import a CSV', run: () => onNavigate('contacts') },
        invites && { icon: Users, label: 'Invite a teammate', hint: 'Agents, supervisors or admins', run: () => onOpenSettings('members') },
      ]
    : [
        { icon: Headset, label: 'Talk to Helo.ai', hint: 'Our team helps you get started', href: 'https://helo.ai/contact-us' },
        { icon: UserPlus, label: 'Add a contact', hint: 'Or import a CSV', run: () => onNavigate('contacts') },
        invites && { icon: Users, label: 'Invite a teammate', hint: 'Agents, supervisors or admins', run: () => onOpenSettings('members') },
      ]

  // The omnibar searches what's on Home: the next setup step, the tiles, the quick actions and guides.
  // The guide shows on a first visit unless the agent lookup failed (lookupNotice takes its place).
  const nextStep = snap && !setupDone && (returning || !snap.lookupError) ? setupSteps(signals).steps.find((s) => s.current) : undefined
  const homeScope = useMemo(() => {
    const items: OmniItem[] = []
    if (nextStep) items.push({ id: 'next', label: `Next step: ${STEP_TITLE[nextStep.id]}`, hint: 'Setup', run: () => focusCard('home-next-step') })
    items.push(
      { id: 'inbox', label: 'Inbox', hint: 'Chats waiting', icon: Inbox, run: () => onNavigate('inbox') },
      { id: 'tickets', label: 'Tickets', hint: 'Open and overdue', icon: Ticket, run: () => onNavigate('tickets') },
      { id: 'recent', label: 'Recent conversations', hint: 'Inbox', icon: MessageCircle, run: () => onNavigate('inbox') },
    )
    for (const a of quick) if (a) items.push({ id: `quick:${a.label}`, label: a.label, hint: a.hint, icon: a.icon, run: a.href ? () => void window.open(a.href, '_blank', 'noreferrer') : a.run! })
    if (snap && !returning) for (const g of QUICK_START) items.push({ id: `guide:${g.href}`, label: g.title, hint: 'Guide', keywords: g.description, icon: g.icon, run: () => void window.open(g.href, '_blank', 'noreferrer') })
    if (returning && can(role, 'reports.view')) items.push({ id: 'week', label: 'Last 7 days', hint: 'Analytics', icon: BarChart3, run: () => onNavigate('analytics') })
    return { id: 'home', placeholder: 'Search Home', items }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, returning, nextStep?.id, draftName, invites, role])
  useOmnibarScope(homeScope)

  const lookupNotice = snap?.lookupError && (
    <Notice tone="warning" title="Couldn’t reach your AI agent" action={<Button variant="outline" size="sm" onClick={reload}>Try again</Button>}>
      {snap.lookupError}
    </Notice>
  )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-display">{greeting(me?.user.name)}</h1>
        <p className="mt-1 text-muted-foreground">{me?.workspace?.name}</p>
      </div>
      {error ? (
        <div className="rounded-lg border border-border p-6 text-sm">
          <p className="text-destructive">Couldn&rsquo;t check your WhatsApp setup. {error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : !snap ? (
        <PageLoader context="home" />
      ) : returning ? (
        <>
          {lookupNotice}
          {!setupDone && guide}
          <AtAGlance agent={snap.agent} draftName={draftName} chats={loadChats} onNavigate={onNavigate} />
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentChats chats={loadChats} onOpenChat={onOpenChat} onNavigate={onNavigate} />
            </div>
            <QuickActions actions={quick} />
          </div>
          {/* The team's numbers are for people who read reports; everyone else has the tiles above. */}
          {can(role, 'reports.view') && <ThisWeek onNavigate={onNavigate} />}
        </>
      ) : (
        <>
          {lookupNotice || guide}
          <AtAGlance preview={account ? 'connected' : 'new'} agent={snap.agent} draftName={draftName} chats={loadChats} onNavigate={onNavigate} />
          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentChats chats={loadChats} onOpenChat={onOpenChat} onNavigate={onNavigate} />
            </div>
            <QuickActions title="Need a hand?" actions={quick} />
          </div>
          <QuickStartGuides />
        </>
      )}
    </div>
  )
}
