import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Plus, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import {
  AGENT_EVENT_STATUS_META,
  SAMPLE_AGENT_EVENT_TYPES,
  SAMPLE_QUALITY_CHECK_RUN,
  buildDeveloperEventsChecklist,
  formatFullTimestamp,
  newId,
  newSecretKey,
  newWebhookUrl,
} from '@/app/wizard/mockData'
import type {
  ActivityLogRow,
  AgentEventRow,
  AgentEventTypeDef,
  AgentEventsState,
  ConnectionsPageState,
  QualityCheckItem,
  QualityCheckRun,
} from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

// ==================================================================================
// QUALITY CHECKS
// ==================================================================================

function QualityCheckItemRow({ item }: { item: QualityCheckItem }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          {item.status === 'normal' ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-warning" />
          )}
          <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
            {item.situation}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            {item.status === 'normal' ? 'Responded normally' : 'Check this'}
          </span>
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          <p style={{ fontSize: 'var(--text-sm)' }}>
            <span className="text-muted-foreground">Customer: </span>
            {item.sent}
          </p>
          <p style={{ fontSize: 'var(--text-sm)' }}>
            <span className="text-muted-foreground">Agent: </span>
            {item.reply}
          </p>
        </div>
      )}
    </div>
  )
}

function QualityChecksSection({ runs, onGoToTestPublish }: { runs: QualityCheckRun[]; onGoToTestPublish: () => void }) {
  const [viewedRunId, setViewedRunId] = useState<string | null>(null)
  const sorted = [...runs].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <section className="space-y-3">
      <span className="flex items-center gap-1.5">
        <h3>Quality checks</h3>
        <InfoTooltip text="Results from the standard checks run on the Test & publish step." />
      </span>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No checks run yet. Run the standard checks from{' '}
          <button type="button" onClick={onGoToTestPublish} className="text-primary underline underline-offset-2">
            Test &amp; publish
          </button>{' '}
          to see results here.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((run) => {
            const passed = run.items.filter((i) => i.status === 'normal').length
            const viewed = viewedRunId === run.id
            return (
              <div key={run.id} className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span style={{ fontSize: 'var(--text-sm)' }}>{formatFullTimestamp(run.timestamp)}</span>
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    {passed} of {run.items.length} passed
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setViewedRunId(viewed ? null : run.id)}>
                    View
                  </Button>
                </div>
                {viewed && (
                  <div className="space-y-1 border-t border-border p-3">
                    {run.items.map((item) => (
                      <QualityCheckItemRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ==================================================================================
// CONNECTOR ACTIVITY
// ==================================================================================

function ConnectorActivitySection({
  connectionsState,
  onGoToConnections,
}: {
  connectionsState: ConnectionsPageState
  onGoToConnections: () => void
}) {
  const { connections, activity } = connectionsState
  const [filterId, setFilterId] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const rows = activity
    .filter((row) => filterId === 'all' || row.connectionId === filterId)
    .sort((a, b) => b.timestamp - a.timestamp)

  return (
    <section className="space-y-3">
      <span className="flex items-center gap-1.5">
        <h3>Connector activity</h3>
        <InfoTooltip text="Recent calls across every connection this agent has." />
      </span>

      {connections.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          This agent has no connections set up.{' '}
          <button type="button" onClick={onGoToConnections} className="text-primary underline underline-offset-2">
            Set one up
          </button>
        </p>
      ) : (
        <>
          {connections.length > 1 && (
            <Select value={filterId} onValueChange={setFilterId}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All connections</SelectItem>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {rows.length === 0 ? (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              No connector activity yet.
            </p>
          ) : (
            <div className="space-y-1">
              {rows.map((row) => {
                const connection = connections.find((c) => c.id === row.connectionId)
                const expanded = expandedId === row.id
                return (
                  <div key={row.id} className="rounded-md border border-border">
                    <button
                      type="button"
                      onClick={() => row.outcome === 'failed' && setExpandedId(expanded ? null : row.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-3" style={{ fontSize: 'var(--text-sm)' }}>
                        <span className="shrink-0 text-muted-foreground">{formatFullTimestamp(row.timestamp)}</span>
                        <span className="shrink-0">{connection?.name ?? 'Unknown connection'}</span>
                        <span className="truncate text-muted-foreground">{row.actionName}</span>
                      </span>
                      <span
                        className={cn('shrink-0', row.outcome === 'worked' ? 'text-success' : 'text-warning-foreground')}
                        style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
                      >
                        {row.outcome === 'worked' ? 'Worked' : 'Failed'}
                      </span>
                    </button>
                    {row.outcome === 'failed' && expanded && (
                      <pre className="mx-3 mb-2 max-h-32 overflow-auto rounded-md bg-muted p-2" style={{ fontSize: 'var(--text-xs)' }}>
                        {row.errorText}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ==================================================================================
// INBOUND BUSINESS EVENTS
// ==================================================================================

function AgentEventRowView({ row }: { row: AgentEventRow }) {
  const [expanded, setExpanded] = useState(false)
  const meta = AGENT_EVENT_STATUS_META[row.status]
  const reason = row.status === 'failed' ? row.errorMessage : row.status === 'skipped' ? row.skippedReason : null
  const expandable = (row.status === 'failed' || row.status === 'skipped') && !!reason

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-3" style={{ fontSize: 'var(--text-sm)' }}>
          <span className="text-muted-foreground">{formatFullTimestamp(row.timestamp)}</span>
          <code style={{ fontSize: 'var(--text-xs)' }}>{row.eventType}</code>
        </span>
        <span
          className={cn(
            meta.tone === 'success' && 'text-success',
            meta.tone === 'destructive' && 'text-destructive',
            meta.tone === 'warning' && 'text-warning-foreground',
            meta.tone === 'muted' && 'text-muted-foreground',
          )}
          style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
        >
          {meta.label}
        </span>
      </button>
      {expandable && expanded && (
        <p className="mx-3 mb-2 rounded-md bg-muted p-2" style={{ fontSize: 'var(--text-xs)' }}>
          {reason}
        </p>
      )}
    </div>
  )
}

function InboundEventsSetupDialog({
  agentEvents,
  onSave,
  onClose,
}: {
  agentEvents: AgentEventsState
  onSave: (patch: Partial<AgentEventsState>) => void
  onClose: () => void
}) {
  const [webhookUrl] = useState(() => agentEvents.webhookUrl || newWebhookUrl())
  const [secretKey, setSecretKey] = useState(() => agentEvents.secretKey || newSecretKey())
  const [revealed, setRevealed] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [eventTypes, setEventTypes] = useState<AgentEventTypeDef[]>(agentEvents.eventTypes)
  const [typeName, setTypeName] = useState('')
  const [typeDescription, setTypeDescription] = useState('')
  const [copied, setCopied] = useState(false)

  function addEventType() {
    const name = typeName.trim()
    if (!name) return
    setEventTypes((prev) => [...prev, { id: newId('etype'), name, description: typeDescription.trim() }])
    setTypeName('')
    setTypeDescription('')
  }

  function removeEventType(id: string) {
    setEventTypes((prev) => prev.filter((t) => t.id !== id))
  }

  function regenerate() {
    setSecretKey(newSecretKey())
    setRevealed(true)
    setRegenerateOpen(false)
  }

  function copyChecklist() {
    navigator.clipboard?.writeText(buildDeveloperEventsChecklist(webhookUrl, secretKey, eventTypes)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Set up inbound events</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3">
              <p style={{ fontSize: 'var(--text-sm)' }}>
                This part is technical. If that is not you, you can copy the setup details to send
                to your developer.
              </p>
              <button type="button" onClick={copyChecklist} className="shrink-0 text-primary" style={{ fontSize: 'var(--text-xs)' }}>
                {copied ? 'Copied' : 'Copy setup details for my developer'}
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">Webhook endpoint</Label>
              <Input id="webhook-url" readOnly value={webhookUrl} />
            </div>

            <div className="space-y-1.5">
              <Label>Secret key</Label>
              <div className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
                <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                  {revealed ? secretKey : '•'.repeat(24)}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <button type="button" onClick={() => setRevealed((v) => !v)} className="text-primary" style={{ fontSize: 'var(--text-xs)' }}>
                    {revealed ? 'Hide' : 'Reveal'}
                  </button>
                  <button type="button" onClick={() => setRegenerateOpen(true)} className="text-primary" style={{ fontSize: 'var(--text-xs)' }}>
                    Regenerate
                  </button>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="flex items-center gap-1.5">
                <Label>Event types this agent expects</Label>
                <InfoTooltip text="A short name your systems will send, like payment_received, plus one line describing what it means." />
              </span>
              {eventTypes.length > 0 && (
                <div className="space-y-1.5">
                  {eventTypes.map((t) => (
                    <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div className="min-w-0">
                        <code style={{ fontSize: 'var(--text-xs)' }}>{t.name}</code>
                        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                          {t.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEventType(t.id)}
                        aria-label={`Remove ${t.name}`}
                        className="shrink-0 text-muted-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. payment_received" />
                  <Input value={typeDescription} onChange={(e) => setTypeDescription(e.target.value)} placeholder="What this means" />
                </div>
                <Button variant="outline" onClick={addEventType} disabled={!typeName.trim()}>
                  <Plus className="size-4" />
                  Add event type
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onSave({ configured: true, webhookUrl, secretKey, secretRevealed: revealed, eventTypes })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={regenerateOpen}
        title="Regenerate the secret key?"
        description="This will invalidate the current key. Anything still using it will stop working. Continue?"
        confirmLabel="Regenerate"
        onConfirm={regenerate}
        onCancel={() => setRegenerateOpen(false)}
      />
    </>
  )
}

function InboundEventsSection({
  agentEvents,
  onPatch,
  onAddSkillForEvent,
}: {
  agentEvents: AgentEventsState
  onPatch: (patch: Partial<AgentEventsState>) => void
  onAddSkillForEvent: () => void
}) {
  const [setupOpen, setSetupOpen] = useState(false)
  const sortedEvents = [...agentEvents.events].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <section className="space-y-4">
      <div>
        <h3>Inbound business events</h3>
        <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Let your other systems tell this agent when something happens, like a payment or a
          delivery update, so it can act on it in the conversation. Optional and technical: you may
          want your developer for this part.
        </p>
      </div>

      {!agentEvents.configured ? (
        <Button variant="outline" onClick={() => setSetupOpen(true)}>
          Set up inbound events
        </Button>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Inbound events set up</p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {agentEvents.eventTypes.length} event type{agentEvents.eventTypes.length === 1 ? '' : 's'} expected
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
            Edit setup
          </Button>
        </div>
      )}

      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
        To control what your agent says or does when an event arrives, add a custom skill on the
        Skills page.{' '}
        <button type="button" onClick={onAddSkillForEvent} className="text-primary underline underline-offset-2">
          Add a skill for this
        </button>
      </p>

      <div className="space-y-2">
        <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Recent events</p>
        {sortedEvents.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No events received yet.
          </p>
        ) : (
          <div className="space-y-1">
            {sortedEvents.map((row) => (
              <AgentEventRowView key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>

      {setupOpen && (
        <InboundEventsSetupDialog
          agentEvents={agentEvents}
          onSave={(patch) => {
            onPatch(patch)
            setSetupOpen(false)
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </section>
  )
}

// ==================================================================================
// PAGE
// ==================================================================================

// Monitor > Activity — quality checks, connector calls, and inbound business events in one
// place, exactly as the old Agent Activity view had it, now a plain section in the free-nav
// sidebar instead of a separate Configure/Activity toggle screen.
export function ActivityPage() {
  const { state, patch, setSection, setPendingSkillPrefill } = useWizard()

  function goToTestPublish() {
    setSection('publish')
  }

  function goToConnections() {
    setSection('connections')
  }

  function addSkillForEvent() {
    setPendingSkillPrefill({
      name: 'Business event handling',
      instruction: 'When a business event of type [event type] arrives, [describe what the agent should say or do].',
    })
    setSection('skills')
  }

  function demoLoadSampleActivity() {
    const now = Date.now()

    const runItems: QualityCheckItem[] = SAMPLE_QUALITY_CHECK_RUN.map((c) => ({ id: newId('qc'), ...c }))
    patch('qualityChecks', (prev) => ({
      runs: [{ id: newId('qcrun'), timestamp: now, items: runItems }, ...prev.runs],
    }))

    const existingConnection = state.connections.connections[0]
    const existingAction = state.connections.actions[0]
    let connectionId = existingConnection?.id
    let sampleActionId = existingAction?.id
    let sampleActionName = existingAction?.name ?? 'Look up an order'
    const seedConnections = [...state.connections.connections]
    const seedActions = [...state.connections.actions]
    if (!connectionId) {
      connectionId = newId('conn')
      seedConnections.push({
        id: connectionId,
        name: 'Our store system',
        description: 'Looks up orders and stock levels.',
        baseUrl: 'https://yourstore.example.com',
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: 'sample-key', location: 'header', fieldName: 'X-API-Key', prefix: '' }],
        createdAt: now,
        demoStatus: 'working',
      })
      sampleActionId = newId('action')
      sampleActionName = 'Look up an order'
      seedActions.push({
        id: sampleActionId,
        connectionId,
        name: sampleActionName,
        description: 'Find an order by its order number.',
        method: 'GET',
        path: '/orders/{order_id}',
        values: [],
        createdAt: now,
      })
    }
    const newActivity: ActivityLogRow[] = [
      { id: newId('activity'), connectionId, actionId: sampleActionId ?? '', actionName: sampleActionName, timestamp: now - 60_000, outcome: 'worked' },
      {
        id: newId('activity'),
        connectionId,
        actionId: sampleActionId ?? '',
        actionName: 'Look up a customer',
        timestamp: now - 780_000,
        outcome: 'failed',
        errorText: '503 Service Unavailable',
      },
    ]
    patch('connections', {
      connections: seedConnections,
      actions: seedActions,
      activity: [...newActivity, ...state.connections.activity],
    })

    const webhookUrl = state.agentEvents.webhookUrl || newWebhookUrl()
    const secretKey = state.agentEvents.secretKey || newSecretKey()
    const eventTypes =
      state.agentEvents.eventTypes.length > 0
        ? state.agentEvents.eventTypes
        : SAMPLE_AGENT_EVENT_TYPES.map((t) => ({ id: newId('etype'), ...t }))
    const sampleEvents: AgentEventRow[] = [
      { id: newId('aevent'), agentEventId: newId('meta_evt'), eventType: 'payment_received', status: 'success', timestamp: now - 3_600_000 },
      {
        id: newId('aevent'),
        agentEventId: newId('meta_evt'),
        eventType: 'document_verified',
        status: 'failed',
        timestamp: now - 5_400_000,
        errorMessage: 'Signature verification failed.',
      },
    ]
    patch('agentEvents', { configured: true, webhookUrl, secretKey, eventTypes, events: [...sampleEvents, ...state.agentEvents.events] })

    toast.success('Sample activity loaded')
  }

  function demoSimulateEventStates() {
    const now = Date.now()
    const webhookUrl = state.agentEvents.webhookUrl || newWebhookUrl()
    const secretKey = state.agentEvents.secretKey || newSecretKey()
    const rows: AgentEventRow[] = [
      { id: newId('aevent'), agentEventId: newId('meta_evt'), eventType: 'payment_received', status: 'request_received', timestamp: now - 10_000 },
      { id: newId('aevent'), agentEventId: newId('meta_evt'), eventType: 'payment_received', status: 'processing', timestamp: now - 30_000 },
      { id: newId('aevent'), agentEventId: newId('meta_evt'), eventType: 'payment_received', status: 'sent', timestamp: now - 60_000 },
      { id: newId('aevent'), agentEventId: newId('meta_evt'), eventType: 'document_verified', status: 'success', timestamp: now - 120_000 },
      {
        id: newId('aevent'),
        agentEventId: newId('meta_evt'),
        eventType: 'document_verified',
        status: 'failed',
        timestamp: now - 180_000,
        errorMessage: 'Signature verification failed.',
      },
      {
        id: newId('aevent'),
        agentEventId: newId('meta_evt'),
        eventType: 'payment_received',
        status: 'skipped',
        timestamp: now - 240_000,
        skippedReason: 'The conversation was already closed.',
      },
    ]
    patch('agentEvents', { configured: true, webhookUrl, secretKey, events: rows })
    toast.success('Simulated all six event states')
  }

  useRegisterDevControls(
    'activity',
    <DemoControlsGroup label="Activity">
      <Button variant="outline" size="sm" onClick={demoLoadSampleActivity}>
        Demo: load sample activity
      </Button>
      <Button variant="outline" size="sm" onClick={demoSimulateEventStates}>
        Demo: simulate inbound event states
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <div className="space-y-10">
      <QualityChecksSection runs={state.qualityChecks.runs} onGoToTestPublish={goToTestPublish} />
      <ConnectorActivitySection connectionsState={state.connections} onGoToConnections={goToConnections} />
      <InboundEventsSection
        agentEvents={state.agentEvents}
        onPatch={(p) => patch('agentEvents', p)}
        onAddSkillForEvent={addSkillForEvent}
      />
    </div>
  )
}
