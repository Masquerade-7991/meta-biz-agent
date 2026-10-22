import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronRight, Inbox, MessageCircle, Smartphone, Ticket, UserPlus, Users } from 'lucide-react'
import { useNavigate } from 'react-router'
import { listChats, type ChatSummary } from '@/app/api/inbox'
import { getSupportSettings, listTickets } from '@/app/api/tickets'
import { getOverview } from '@/app/api/overview'
import { addDays, isoDay, type Overview } from '@/app/analytics/types'
import { dur, num, pct } from '@/app/analytics/format'
import { getNumberHealth } from '@/app/api/whatsapp'
import { StatusPill } from '@/app/components/ui/status'
import { AGENT_STATUS, agentStatusOf, type Tone } from '@/app/lib/status'
import { cn } from '@/app/lib/utils'
import { Button } from '@/app/components/ui/button'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail, errorText, getAgentOnNumber, type AgentOnNumber } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import type { NavId } from '@/app/nav'
import type { SettingsTab } from '@/app/components/shell/settings/areas'
import { workspaceAccounts, type WaAccount } from '@/app/api/whatsapp'
import { AccountSteps } from '@/app/whatsapp/AccountSteps'
import { ConnectNumberButton } from '@/app/whatsapp/ConnectNumberDialog'
import { isDummyMode } from '@/app/api/dummy'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { listStoredAgents } from '@/app/api/store'
import { useWizard } from '@/app/wizard/WizardContext'

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
        <p className={cn('font-semibold', (done || locked) && 'text-muted-foreground')}>
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
  onNavigate,
  onAccountChange,
  onCreateAgent,
}: {
  onCreateAgent: () => void
  snap: Snapshot
  accounts: WaAccount[]
  onNavigate: (id: NavId) => void
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
    <section className="rounded-lg border border-border p-6 md:p-8">
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
                  {[number.verifiedName || account.wabaName, number.display].filter(Boolean).join(' · ')}
                </span>
                {can(me?.role, 'numbers.view') && (
                  <button type="button" className={link} onClick={() => onNavigate('whatsapp')}>
                    Manage numbers &rarr;
                  </button>
                )}
                {manage && <ConnectNumberButton variant="link" size="sm" label="Add another number" className="h-auto p-0" onConnected={onAccountChange} />}
              </span>
            )
          }
          action={
            <div className="pt-2">
              {connected ? (
                <AccountSteps account={account} canEdit={manage} onChange={onAccountChange} />
              ) : manage ? (
                <ConnectNumberButton size="lg" label="Connect WhatsApp" onConnected={onAccountChange} />
              ) : (
                <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">Ask an owner of {me?.workspace?.name ?? 'this workspace'} to connect a WhatsApp number. Only owners can connect accounts.</p>
              )}
            </div>
          }
        >
          {connected
            ? account.needsAttention
              ? 'Some setup steps didn’t finish. Retry them below.'
              : 'Add a payment method so your number can send messages.'
            : 'Your AI agent and inbox run on your own WhatsApp number. Connect it with Facebook in a few minutes, right here.'}
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
                  On {[snap.number?.name, snap.number?.display].filter(Boolean).join(' · ')}
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
          Name it, give it your business details and FAQs, test it, then publish. Its numbers then show here and in Analytics.
        </Step>
      </ol>
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
function AtAGlance({ agent, draftName, chats: loadChats, onNavigate }: { agent: AgentOnNumber | null; draftName: string; chats: () => Promise<ChatSummary[]>; onNavigate: (id: NavId) => void }) {
  // tickets null: they couldn't be loaded, so no count is shown (rather than a reassuring 0).
  const [data, setData] = useState<{ unread: number; chats: number; tickets: number | null; overdue: number; quality: string | null } | null>(null)
  useEffect(() => {
    Promise.all([loadChats(), listTickets({ limit: '1000' }).catch(() => null), getNumberHealth().catch(() => [])]).then(([chats, tickets, health]) =>
      setData({
        unread: chats.reduce((n, c) => n + c.unread, 0),
        chats: chats.filter((c) => c.unread > 0).length,
        tickets: tickets?.length ?? null,
        overdue: tickets?.filter((t) => t.sla.breached).length ?? 0,
        quality: health[0]?.quality ?? null,
      }),
    )
  }, [loadChats])
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

/** The things people do most, one click away. */
function QuickActions({ onNavigate, hasAgent }: { onNavigate: (id: NavId, tab?: SettingsTab) => void; hasAgent: boolean }) {
  const navigate = useNavigate()
  const { me } = useAuth()
  const actions = [
    hasAgent && { icon: MessageCircle, label: 'Test your AI agent', hint: 'Chat with it as a customer would', run: () => navigate('/agents') },
    { icon: UserPlus, label: 'Add a contact', hint: 'Or import a CSV', run: () => onNavigate('contacts') },
    can(me?.role, 'members.manage') && { icon: Users, label: 'Invite a teammate', hint: 'Agents, supervisors or admins', run: () => onNavigate('settings', 'members') },
  ].filter(Boolean) as { icon: typeof Inbox; label: string; hint: string; run: () => void }[]
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-5 py-3 text-section font-semibold">Quick actions</h2>
      <ul className="p-2">
        {actions.map((a) => (
          <li key={a.label}>
            <button type="button" onClick={a.run} className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                <a.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
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

/** Home: connect WhatsApp and build the agent; once that's done, what needs attention today. */
export function HomePage({ onNavigate, onOpenSettings, onOpenChat }: { onNavigate: (id: NavId) => void; onOpenSettings: (tab: SettingsTab) => void; onOpenChat: (phone: string) => void }) {
  const { me } = useAuth()
  const role = me?.role
  const navigate = useNavigate()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  // Signs this isn't a first visit: agents saved in the console (any number), and chats.
  const [history, setHistory] = useState<{ agents: number; chats: number }>({ agents: 0, chats: 0 })
  const { state } = useWizard()
  const draftName = state.identity.agentName.trim()
  const [accounts, setAccounts] = useState<WaAccount[]>([])
  // At a glance and Recent conversations both show chats: one request between them.
  const chatsRequest = useRef<Promise<ChatSummary[]> | null>(null)
  const loadChats = useCallback(() => (chatsRequest.current ??= listChats().catch(() => [])), [])
  useRegisterDevControls(
    'home-whatsapp',
    isDummyMode() ? (
      <DemoControlsGroup label="WhatsApp">
        <Button size="sm" variant="outline" onClick={() => void import('@/app/api/supportDummy').then((m) => {
            m.resetDummyWhatsApp(false)
            setAttempt((n) => n + 1)
          })}>
          New workspace (no number)
        </Button>
        <Button size="sm" variant="outline" onClick={() => void import('@/app/api/supportDummy').then((m) => {
            m.resetDummyWhatsApp(true)
            setAttempt((n) => n + 1)
          })}>
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
    Promise.all([
      workspaceAccounts(role).then(async (a) => [a, await loadSnapshot(a)] as const),
      listStoredAgents().catch(() => null),
      loadChats(),
    ]).then(
      ([[a, s], stored, chats]) => {
        if (cancelled) return
        setSnap(s)
        setAccounts(a)
        setHistory({ agents: stored?.length ?? 0, chats: chats.length })
      },
      (err) => !cancelled && setError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [attempt, loadChats, role])

  const account = accounts[0]
  const billed = !!account && billingDone(account)
  // Home is the dashboard once WhatsApp is connected and this isn't a first visit: an agent exists on
  // Meta or in the console (even a draft with just a name), or customers have already written.
  // A first visit gets the setup guide; anything unfinished shows as a note above the dashboard.
  const returning = !!snap && !!account && (!!snap.agent || history.agents > 0 || !!draftName || history.chats > 0)
  const getStarted = snap && (
    <GetStarted
      onCreateAgent={() => navigate('/agents?new')}
      snap={snap}
      accounts={accounts}
      onNavigate={onNavigate}
      onAccountChange={(a) => {
        setAccounts((prev) => [...prev.filter((x) => x.wabaId !== a.wabaId), a])
        // A newly connected number changes what the rest of Home shows (its agent).
        if (!accounts.some((x) => x.wabaId === a.wabaId)) setAttempt((n) => n + 1)
      }}
    />
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
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !snap ? (
        <PageLoader context="home" />
      ) : (
        <>
          {returning ? (
            <>
              {snap.lookupError && (
                <Notice tone="warning" title="Couldn’t reach your AI agent" action={<Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
                  {snap.lookupError}
                </Notice>
              )}
              {!billed ? (
                getStarted
              ) : (
                !snap.agent &&
                !snap.lookupError && (
                  <Notice
                    title={draftName ? `“${draftName}” isn’t live yet` : 'Build your AI agent'}
                    action={
                      <Button size="sm" onClick={() => (draftName ? navigate('/agents') : navigate('/agents?new'))}>
                        <Bot className="size-4" />
                        {draftName ? 'Continue setting it up' : 'Build agent'}
                      </Button>
                    }
                  >
                    {draftName ? 'Finish its setup, test it, then publish to start answering customers.' : 'Name it, give it your business details and FAQs, test it, then publish.'}
                  </Notice>
                )
              )}
              <AtAGlance agent={snap.agent} draftName={draftName} chats={loadChats} onNavigate={onNavigate} />
              <div className="grid items-start gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <RecentChats chats={loadChats} onOpenChat={onOpenChat} onNavigate={onNavigate} />
                </div>
                <QuickActions hasAgent={!!snap.agent || !!draftName} onNavigate={(id, tab) => (tab ? onOpenSettings(tab) : onNavigate(id))} />
              </div>
              {/* The team's numbers are for people who read reports; everyone else has the tiles above. */}
              {can(me?.role, 'reports.view') && <ThisWeek onNavigate={onNavigate} />}
            </>
          ) : snap.lookupError ? (
            <Notice tone="warning" title="Couldn’t reach your AI agent" action={<Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
              {snap.lookupError}
            </Notice>
          ) : (
            getStarted
          )}
        </>
      )}
    </div>
  )
}
