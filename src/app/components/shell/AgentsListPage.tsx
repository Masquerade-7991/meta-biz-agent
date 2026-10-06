import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bot, FlaskConical, Loader2, MoreHorizontal, Pause, Play, Plus, SquarePen, Trash2 } from 'lucide-react'
import { PageContainer, PageHeader, EmptyState } from '@/app/components/ui/page'
import { StatusPill } from '@/app/components/ui/status'
import { AGENT_STATUS, type AgentStatus } from '@/app/lib/status'
import { Button } from '@/app/components/ui/button'
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
import { listStoredAgents, ms, putStoredAgent, putStoredAgents } from '@/app/api/store'
import { storageKey } from '@/app/api/dummy'
import { useWizard } from '@/app/wizard/WizardContext'
import type { AgentInstanceSummary, BusinessState } from '@/app/wizard/types'
import { can } from '@/app/lib/permissions'
import { useAuth } from '@/app/auth/AuthContext'

const CREATED_AGENTS_KEY = storageKey('meta-agent-wizard-created-agents-v1')

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
// The server's store (/api/store/agents) is the record; this localStorage key is the fallback cache.
const NUMBER_META_KEY = storageKey('meta-agent-wizard-numbers-v1')
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
  void putStoredAgent(phoneNumberId, {
    ...(meta.name !== undefined ? { displayName: meta.name } : {}),
    ...(meta.updatedAt !== undefined ? { lastOpenedAt: meta.updatedAt } : {}),
    ...(meta.launched !== undefined ? { everLive: meta.launched } : {}),
  })
}

/** The store's record when the database is on, merged over (and cached into) localStorage. */
async function loadAllNumberMeta(): Promise<Record<string, NumberMeta>> {
  const local = loadNumberMeta()
  const stored = await listStoredAgents()
  if (!stored) return local
  // One-time move of entries only this browser knows into the store.
  const known = new Set(stored.map((a) => a.phoneNumberId))
  const missing = Object.entries(local).filter(([id]) => !known.has(id))
  if (missing.length > 0)
    void putStoredAgents(missing.map(([phoneNumberId, m]) => ({ phoneNumberId, displayName: m.name, everLive: m.launched, lastOpenedAt: m.updatedAt })))
  for (const a of stored) {
    const l = local[a.phoneNumberId] ?? {}
    local[a.phoneNumberId] = { name: a.displayName || l.name, updatedAt: ms(a.lastOpenedAt) || l.updatedAt, launched: a.everLive ?? l.launched }
  }
  try {
    window.localStorage.setItem(NUMBER_META_KEY, JSON.stringify(local))
  } catch {
    // cache only
  }
  return local
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
  const [stored, wabas] = await Promise.all([loadAllNumberMeta(), listWabas()])
  const perWaba = await Promise.all(
    wabas.map(async (waba) => {
      const numbers = await listPhoneNumbers(waba.id)
      return Promise.all(
        numbers.map(async (n): Promise<AgentRow | null> => {
          const m = stored[n.id] ?? {}
          // Meta can refuse the check (e.g. 429 rate limit). A number we've already recorded as an
          // agent still gets its row, with on/off status unknown until Meta answers again.
          const agent = await getAgentOnNumber(n.id).catch((err: unknown) => {
            if (stored[n.id]) return { agentId: '', enabled: false, audience: undefined }
            throw err
          })
          if (!agent) return null
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
/** The list's status in the console-wide words (src/app/lib/status.ts). */
function rowStatus(agent: AgentInstanceSummary): AgentStatus {
  if (agent.status === 'paused') return 'paused'
  if (agent.status === 'live') return agent.audienceMode === 'Everyone' ? 'live' : 'testing'
  return 'draft'
}
function statusBadge(agent: AgentInstanceSummary) {
  const s = AGENT_STATUS[rowStatus(agent)]
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>
}

const READ_ONLY = 'Only owners and admins change AI agents. You can open them and see their activity.'

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
  const { me } = useAuth()
  // Supervisors and agents can look at the AI agents and their activity; changing them is for admins.
  const canEdit = can(me?.role, 'agent.edit')
  const [modalOpen, setModalOpenRaw] = useState(false)
  const setModalOpen = (open: boolean) => (open && !canEdit ? toast(READ_ONLY) : setModalOpenRaw(open))
  const [createdAgents, setCreatedAgents] = useState<AgentInstanceSummary[]>(loadCreatedAgents)

  // Meta is the source of truth for which agents exist. If it can't be reached, the list falls back
  // to the agent in this browser (so the app still demos offline) under the PRD 5.1 V1 error.
  const [metaRows, setMetaRows] = useState<AgentRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const retryLoad = () => {
    setLoadFailed(false)
    setMetaRows(null)
    setLoadAttempt((n) => n + 1)
  }
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
  }, [loadAttempt])
  const loading = metaRows === null && !loadFailed

  // A brand new agent skips the agents table entirely and goes straight into the setup front
  // door — "Open configuration" for an EXISTING draft row still goes straight to the wizard via
  // openAgentConfiguration below, unaffected.
  function handleAgentCreated(agent: AgentInstanceSummary, phoneNumberId?: string, wabaId?: string, business?: Partial<BusinessState>) {
    resetWizard()
    patch('identity', { agentName: agent.name, companyName: agent.companyName })
    if (business) patch('business', business)
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
    if (!canEdit && !['open', 'activity', 'compiled'].includes(action)) return void toast(READ_ONLY)
    if (action === 'open') {
      openAgentConfiguration(agent)
      return
    }
    if (!agent.isCurrent && !agent.phoneNumberId) {
      toast('This is a demo agent instance for illustration — actions here don’t affect real data.')
      return
    }
    // Every other action works on the open agent, so a Meta row becomes it first.
    selectAgent(agent)
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
    }
  }

  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your agents&hellip;
        </div>
      ) : (
        <PageContainer>
          <PageHeader
            title="AI Agents"
            description="Each AI agent answers customers on one WhatsApp number, from your knowledge and systems."
            actions={
              rows.length > 0 && (
                <Button onClick={() => setModalOpen(true)}>
                  <Plus className="size-4" />
                  Create agent
                </Button>
              )
            }
          />
          {loadFailed && (
            <p className="mb-4 flex items-center gap-2 text-destructive">
              Couldn&rsquo;t load your agents from Meta.
              <Button variant="link" onClick={retryLoad}>
                Try again
              </Button>
            </p>
          )}
          {rows.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="Create your first AI agent"
              description="It answers customers on WhatsApp around the clock, using your website, FAQs and documents, and hands over to your team when needed."
              action={
                <Button onClick={() => setModalOpen(true)}>
                  <Plus className="size-4" />
                  Create agent
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>WhatsApp number</TableHead>
                    <TableHead className="hidden lg:table-cell">Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Answers</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((agent) => (
                    <TableRow key={agent.id} onClick={() => handleAction(agent, 'open')} className="cursor-pointer">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {agent.isCurrent && state.identity.avatarDataUrl ? <AvatarImage src={state.identity.avatarDataUrl} alt="" /> : null}
                            <AvatarFallback className="bg-muted text-muted-foreground">
                              <Bot className="size-4" />
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate font-medium">{agent.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-dense">{agent.phoneNumber}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{agent.companyName || '—'}</TableCell>
                      <TableCell>{statusBadge(agent)}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {agent.audienceMode === 'Everyone' ? 'Everyone' : 'Test numbers only'}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{agent.updatedAt}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${agent.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleAction(agent, 'open')}>
                              <SquarePen /> Open
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAction(agent, 'test')}>
                              <FlaskConical /> Test
                            </DropdownMenuItem>
                            {(agent.status === 'live' || agent.status === 'paused') && (
                              <DropdownMenuItem onClick={() => handleAction(agent, agent.status === 'paused' ? 'resume' : 'stop')}>
                                {agent.status === 'paused' ? <Play /> : <Pause />}
                                {agent.status === 'paused' ? 'Resume' : 'Pause'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => handleAction(agent, 'archive')}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </PageContainer>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? 'this agent'}?`}
        description={
          rows.length === 1
            ? 'This removes its setup on Meta: knowledge, skills, connections and settings. It is your last agent, so Meta also disconnects the AI agent from your WhatsApp account. Your number keeps working for your team.'
            : 'This removes its setup on Meta: knowledge, skills, connections and settings. The WhatsApp number keeps working for your team.'
        }
        confirmText={pendingDelete?.name}
        confirmLabel="Delete agent"
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
