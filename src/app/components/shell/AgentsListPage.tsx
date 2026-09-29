import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  Archive,
  Bot,
  Copy,
  FileCode2,
  History,
  Loader2,
  MoreHorizontal,
  Play,
  PlayCircle,
  Plus,
  Square,
  SquarePen,
  Users,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/app/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { CreateAgentModal } from './CreateAgentModal'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import {
  deleteAgent,
  errorText,
  getAgentOnNumber,
  listPhoneNumbers,
  listWabas,
  setActivePhoneNumberId,
  setRollout,
} from '@/app/api/meta'
import { useWizard } from '@/app/wizard/WizardContext'
import type { AgentInstanceSummary, AgentRolloutStatus } from '@/app/wizard/types'

const CREATED_AGENTS_KEY = 'meta-agent-wizard-created-agents-v1'

function loadCreatedAgents(): AgentInstanceSummary[] {
  try {
    const raw = window.localStorage.getItem(CREATED_AGENTS_KEY)
    return raw ? (JSON.parse(raw) as AgentInstanceSummary[]) : []
  } catch {
    return []
  }
}

function persistCreatedAgents(agents: AgentInstanceSummary[]) {
  window.localStorage.setItem(CREATED_AGENTS_KEY, JSON.stringify(agents))
}

// What Meta doesn't hold about an agent, keyed by phone number id: the display name given at
// creation, when it was last touched here, and whether it has ever gone live (Stopped vs In progress).
const NUMBER_META_KEY = 'meta-agent-wizard-numbers-v1'
interface NumberMeta {
  name?: string
  updatedAt?: number
  launched?: boolean
}

function loadNumberMeta(): Record<string, NumberMeta> {
  try {
    return JSON.parse(window.localStorage.getItem(NUMBER_META_KEY) ?? '{}') as Record<string, NumberMeta>
  } catch {
    return {}
  }
}

function saveNumberMeta(phoneNumberId: string, meta: NumberMeta) {
  try {
    const all = loadNumberMeta()
    all[phoneNumberId] = { ...all[phoneNumberId], ...meta }
    window.localStorage.setItem(NUMBER_META_KEY, JSON.stringify(all))
  } catch {
    // Storage unavailable: the list falls back to Meta's verified name.
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
/** "DD Mon YYYY, HH:MM" (PRD 5.1 AC5). */
function formatStamp(t: number) {
  const d = new Date(t)
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A list row; Meta-backed rows carry the ids needed to open the agent. */
type AgentRow = AgentInstanceSummary & { phoneNumberId?: string; wabaId?: string }

/** One row per phone number that has an agent, across every WABA the account can see. */
async function loadMetaRows(): Promise<AgentRow[]> {
  const stored = loadNumberMeta()
  const wabas = await listWabas()
  const perWaba = await Promise.all(
    wabas.map(async (waba) => {
      const numbers = await listPhoneNumbers(waba.id)
      return Promise.all(
        numbers.map(async (n): Promise<AgentRow | null> => {
          const agent = await getAgentOnNumber(n.id)
          if (!agent) return null
          const m = stored[n.id] ?? {}
          if (agent.enabled && !m.launched) saveNumberMeta(n.id, { launched: true })
          return {
            id: n.id,
            phoneNumberId: n.id,
            wabaId: waba.id,
            name: m.name || n.verifiedName,
            companyName: waba.name,
            phoneNumber: n.displayPhoneNumber,
            status: agent.enabled ? 'live' : m.launched ? 'paused' : 'draft',
            connector: 'None',
            journeyProfile: '—',
            audienceMode: agent.audience === 'EVERYONE' ? 'Everyone' : 'Allowlisted',
            allowlistCount: 0,
            evalScore: null,
            updatedAt: m.updatedAt ? formatStamp(m.updatedAt) : '—',
          }
        }),
      )
    }),
  )
  // Newest first (PRD 5.1 AC10); agents never touched here go last.
  const at = (r: AgentRow) => stored[r.id]?.updatedAt ?? 0
  return perWaba
    .flat()
    .filter((r): r is AgentRow => r !== null)
    .sort((a, b) => at(b) - at(a))
}

// Collapsed to the three states the listing surfaces: green while live, red once stopped, blue
// for everything still being built or verified before it can go live.
function statusBadge(status: AgentRolloutStatus) {
  switch (status) {
    case 'live':
      return <Badge className="bg-success text-success-foreground">Active</Badge>
    case 'paused':
      return <Badge className="bg-destructive text-destructive-foreground">Stopped</Badge>
    case 'needs_testing':
    case 'draft':
    default:
      return <Badge className="bg-primary text-primary-foreground">In progress</Badge>
  }
}

export function AgentsListPage({
  onOpenBuilder,
  onAgentCreated,
  onOpenActivity,
}: {
  onOpenBuilder: () => void
  onAgentCreated: () => void
  onOpenActivity: () => void
}) {
  const { state, patch, setSection, resetWizard } = useWizard()
  const [modalOpen, setModalOpen] = useState(false)
  const [createdAgents, setCreatedAgents] = useState<AgentInstanceSummary[]>(loadCreatedAgents)

  // Meta is the source of truth for which agents exist. If it can't be reached, the list falls back
  // to the agent in this browser (so the app still demos offline) under the PRD 5.1 V1 error.
  const [metaRows, setMetaRows] = useState<AgentRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadMetaRows().then(
      (r) => !cancelled && setMetaRows(r),
      (err) => {
        if (cancelled) return
        console.log('[agent list]', errorText(err))
        setLoadFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])
  const loading = metaRows === null && !loadFailed

  // A brand new agent skips the agents table entirely and goes straight into the setup front
  // door — "Open configuration" for an EXISTING draft row still goes straight to the wizard via
  // openAgentConfiguration below, unaffected.
  function handleAgentCreated(agent: AgentInstanceSummary, phoneNumberId?: string, wabaId?: string) {
    resetWizard()
    patch('identity', { agentName: agent.name, companyName: agent.companyName })
    patch('gate', {
      gatePassed: true,
      selectedPhoneNumber: agent.phoneNumber,
      selectedWabaName: agent.companyName,
      selectedWabaId: wabaId ?? null,
      selectedPhoneNumberId: phoneNumberId,
    })
    if (phoneNumberId) saveNumberMeta(phoneNumberId, { name: agent.name, updatedAt: Date.now() })
    toast.success(`${agent.name} created`)
    onAgentCreated()
  }

  function removeCreatedAgent(id: string) {
    setCreatedAgents((prev) => {
      const next = prev.filter((a) => a.id !== id)
      persistCreatedAgents(next)
      return next
    })
  }

  // Loads a draft agent's known fields into the wizard and opens the stepped
  // configuration flow. The app only tracks one agent's deep config at a time,
  // so the stub is "promoted" out of the static list and into live wizard state.
  function selectAgent(agent: AgentRow) {
    if (agent.isCurrent) return
    resetWizard()
    patch('identity', { agentName: agent.name, companyName: agent.companyName })
    patch('gate', {
      gatePassed: true,
      selectedPhoneNumber: agent.phoneNumber,
      selectedWabaName: agent.companyName,
      selectedWabaId: agent.wabaId ?? null,
      selectedPhoneNumberId: agent.phoneNumberId,
    })
    setActivePhoneNumberId(agent.phoneNumberId ?? null)
    if (!agent.phoneNumberId) removeCreatedAgent(agent.id)
  }

  function openAgentConfiguration(agent: AgentRow) {
    selectAgent(agent)
    onOpenBuilder()
  }

  const currentAgent: AgentRow | null = state.identity.agentName.trim()
    ? {
        id: 'current',
        wabaId: state.gate.selectedWabaId ?? undefined,
        name: state.identity.agentName,
        companyName: state.identity.companyName || 'Untitled workspace',
        phoneNumber: state.gate.selectedPhoneNumber ?? '—',
        status: state.publish.stopped
          ? 'paused'
          : state.publish.activated
            ? 'live'
            : state.publish.testResults.length > 0 && state.publish.testResults.every((r) => r.passed) && !state.publish.testsStaleSince
              ? 'needs_testing'
              : 'draft',
        connector:
          state.connectors.connectorType === 'shopify'
            ? 'Shopify'
            : state.connectors.connectorType === 'woocommerce'
              ? 'WooCommerce'
              : state.connectors.connectorType === 'custom_rest'
                ? 'Custom REST'
                : 'None',
        journeyProfile:
          state.routing.journeyProfile === 'support'
            ? 'Support'
            : state.routing.journeyProfile === 'commerce'
              ? 'Commerce'
              : state.routing.journeyProfile === 'both'
                ? 'Both'
                : '—',
        audienceMode: state.publish.audienceMode === 'everyone' ? 'Everyone' : 'Allowlisted',
        allowlistCount: state.publish.allowlistNumbers.length,
        evalScore: state.publish.metaEval.available ? state.publish.metaEval.avgConversationScore : null,
        updatedAt: 'Just now',
        isCurrent: true,
      }
    : null

  const localRows: AgentRow[] = currentAgent ? [currentAgent, ...createdAgents] : createdAgents
  // The open agent's row takes its name and stop state from the wizard; everything else is Meta's.
  const rows: AgentRow[] = metaRows
    ? metaRows.map((r) =>
        currentAgent && r.phoneNumberId === state.gate.selectedPhoneNumberId
          ? { ...r, name: currentAgent.name, status: r.status === 'draft' && currentAgent.status === 'paused' ? 'paused' : r.status, isCurrent: true }
          : r,
      )
    : loadFailed
      ? localRows
      : []

  function updateMetaRow(id: string, fields: Partial<AgentRow> | null) {
    setMetaRows((prev) => prev && (fields ? prev.map((r) => (r.id === id ? { ...r, ...fields } : r)) : prev.filter((r) => r.id !== id)))
  }

  const [pendingDelete, setPendingDelete] = useState<AgentRow | null>(null)
  async function confirmDeleteAgent() {
    const agent = pendingDelete
    setPendingDelete(null)
    if (!agent) return
    try {
      await deleteAgent()
    } catch (err) {
      toast.error("Couldn't delete the agent on Meta", { description: errorText(err) })
      return
    }
    resetWizard()
    setActivePhoneNumberId(null)
    updateMetaRow(agent.id, null)
    toast.success(`${agent.name} deleted`)
  }

  function handleAction(agent: AgentRow, action: string) {
    if (action === 'open') {
      openAgentConfiguration(agent)
      return
    }
    if (!agent.isCurrent && !agent.phoneNumberId) {
      toast('This is a demo agent instance for illustration — actions here don’t affect real data.')
      return
    }
    // Every other action works on the open agent, so a Meta row becomes it first.
    if (action !== 'duplicate') selectAgent(agent)
    switch (action) {
      case 'activity':
        setSection('activity')
        onOpenActivity()
        break
      case 'compiled':
        setSection('overview')
        onOpenBuilder()
        break
      case 'test':
        setSection('testEval')
        onOpenBuilder()
        break
      case 'allowlist':
        setSection('publish')
        onOpenBuilder()
        break
      case 'stop':
      case 'resume': {
        // Same rollout lever as Publish: Meta first, then the row.
        const enabled = action === 'resume'
        setRollout(enabled, agent.audienceMode === 'Everyone' ? 'everyone' : 'allowlisted').then(
          () => {
            patch('publish', { activated: enabled, stopped: !enabled })
            updateMetaRow(agent.id, { status: enabled ? 'live' : 'paused' })
            if (agent.phoneNumberId) saveNumberMeta(agent.phoneNumberId, { launched: true, updatedAt: Date.now() })
            toast.success(enabled ? `${agent.name} is live again` : `${agent.name} stopped`)
          },
          (err) => toast.error("Couldn't save to Meta", { description: errorText(err) }),
        )
        break
      }
      case 'archive':
        setPendingDelete(agent)
        break
      case 'duplicate':
        // One agent per number, and this proof of concept is connected to a single number (.env).
        toast('Duplicating needs a second WhatsApp number. This setup is connected to one number, so there is nowhere to put the copy yet.')
        break
      default:
        toast(`"${action}" isn’t wired to real state in this prototype yet.`)
    }
  }

  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          <Loader2 className="size-4 animate-spin" />
          Loading your agents&hellip;
        </div>
      ) : loadFailed && rows.length === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1>AI Agents</h1>
          <p className="mt-4 text-destructive">Failed to load the list. Please try again after some time.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
          <h1>Get started with AI agents</h1>
          <Button onClick={() => setModalOpen(true)} size="lg">
            <Plus className="size-4" />
            Create agent
          </Button>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1>AI Agents</h1>
              <p className="mt-1 text-muted-foreground">
                Every Meta Business Agent configured across your WhatsApp numbers.
              </p>
            </div>
            <Button onClick={() => setModalOpen(true)} size="lg">
              <Plus className="size-4" />
              Create agent
            </Button>
          </div>
          {loadFailed && (
            <p className="mt-4 text-destructive" style={{ fontSize: 'var(--text-sm)' }}>
              Failed to load the list. Please try again after some time.
            </p>
          )}

          <div className="mt-6 overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent name</TableHead>
                  <TableHead>WABA ID</TableHead>
                  <TableHead>Phone number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          {agent.isCurrent && state.identity.avatarDataUrl ? (
                            <AvatarImage src={state.identity.avatarDataUrl} alt={agent.name} />
                          ) : null}
                          <AvatarFallback className="bg-muted text-muted-foreground">
                            <Bot className="size-4" />
                          </AvatarFallback>
                        </Avatar>
                        <p className="truncate" style={{ fontWeight: 'var(--font-weight-medium)' }}>
                          {agent.name}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span style={{ fontSize: 'var(--text-sm)' }}>{agent.wabaId ?? '—'}</span>
                    </TableCell>
                    <TableCell>
                      <span style={{ fontSize: 'var(--text-sm)' }}>{agent.phoneNumber}</span>
                    </TableCell>
                    <TableCell>{statusBadge(agent.status)}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                        {agent.updatedAt}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${agent.name}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleAction(agent, 'open')}>
                            <SquarePen /> Open configuration
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(agent, 'activity')}>
                            <Activity /> View activity
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(agent, 'compiled')}>
                            <FileCode2 /> View compiled configuration
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(agent, 'test')}>
                            <PlayCircle /> Run test conversations
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(agent, 'history')}>
                            <History /> View version history
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleAction(agent, 'allowlist')}>
                            <Users /> Manage allowlist
                          </DropdownMenuItem>
                          {(agent.status === 'live' || agent.status === 'paused') && (
                            <DropdownMenuItem onClick={() => handleAction(agent, agent.status === 'paused' ? 'resume' : 'stop')}>
                              {agent.status === 'paused' ? <Play /> : <Square />}
                              {agent.status === 'paused' ? 'Resume rollout' : 'Stop agent'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleAction(agent, 'duplicate')}>
                            <Copy /> Duplicate agent
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => handleAction(agent, 'archive')}>
                            <Archive /> Delete agent
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete agent?"
        description={
          rows.length === 1
            ? 'This is your last agent. Deleting it disconnects your WhatsApp Business integration entirely, not just this agent. Are you sure you want to delete it?'
            : 'Are you sure you want to delete this agent?'
        }
        confirmLabel="Proceed"
        onConfirm={() => void confirmDeleteAgent()}
        onCancel={() => setPendingDelete(null)}
      />

      <CreateAgentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleAgentCreated}
        existingAgentNames={rows.map((r) => r.name)}
      />
    </>
  )
}
