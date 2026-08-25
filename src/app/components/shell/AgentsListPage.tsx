import { useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  Archive,
  ArrowRight,
  Bot,
  Copy,
  FileCode2,
  History,
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
import { Card, CardContent } from '@/app/components/ui/card'
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

  // A brand new agent skips the agents table entirely and goes straight into the setup front
  // door — "Open configuration" for an EXISTING draft row still goes straight to the wizard via
  // openAgentConfiguration below, unaffected.
  function handleAgentCreated(agent: AgentInstanceSummary) {
    resetWizard()
    patch('identity', { agentName: agent.name, companyName: agent.companyName })
    patch('gate', {
      gatePassed: true,
      selectedPhoneNumber: agent.phoneNumber,
      selectedWabaName: agent.companyName,
    })
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
  function openAgentConfiguration(agent: AgentInstanceSummary) {
    if (!agent.isCurrent) {
      resetWizard()
      patch('identity', { agentName: agent.name, companyName: agent.companyName })
      patch('gate', {
        gatePassed: true,
        selectedPhoneNumber: agent.phoneNumber,
        selectedWabaName: agent.companyName,
      })
      removeCreatedAgent(agent.id)
    }
    onOpenBuilder()
  }

  const currentAgent: AgentInstanceSummary | null = state.identity.agentName.trim()
    ? {
        id: 'current',
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

  const rows = currentAgent ? [currentAgent, ...createdAgents] : createdAgents

  function handleAction(agent: AgentInstanceSummary, action: string) {
    if (action === 'open') {
      openAgentConfiguration(agent)
      return
    }
    if (!agent.isCurrent) {
      toast('This is a demo agent instance for illustration — actions here don’t affect real data.')
      return
    }
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
        patch('publish', { activated: false, stopped: true })
        toast.success(`${agent.name} stopped`)
        break
      case 'resume':
        patch('publish', { activated: true, stopped: false })
        toast.success(`${agent.name} is live again`)
        break
      default:
        toast(`"${action}" isn’t wired to real state in this prototype yet.`)
    }
  }

  return (
    <>
      {rows.length === 0 ? (
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1>Welcome back</h1>
          <p className="mt-1 text-muted-foreground">You haven&rsquo;t configured any AI agents yet.</p>

          <Card className="mt-6 border-primary/30 bg-accent">
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <div className="flex items-center gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Bot className="size-6" />
                </div>
                <div>
                  <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>Build your first AI agent</p>
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Configure a governed, tested WhatsApp AI agent in structured steps — no prompt
                    engineering required.
                  </p>
                </div>
              </div>
              <Button onClick={() => setModalOpen(true)} className="shrink-0">
                Create agent
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
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

          <div className="mt-6 overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent name</TableHead>
                  <TableHead>WABA name</TableHead>
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
                      <span style={{ fontSize: 'var(--text-sm)' }}>{agent.companyName}</span>
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
                            <Archive /> Archive agent
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

      <CreateAgentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleAgentCreated}
        existingAgentNames={rows.map((r) => r.name)}
      />
    </>
  )
}
