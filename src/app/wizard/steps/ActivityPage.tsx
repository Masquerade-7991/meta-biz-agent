import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
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
import { useExitWizard } from '@/app/wizard/ExitContext'
import { InboundEventsMonitor } from './InboundEventsMonitor'
import {
  SAMPLE_AGENT_EVENT_TYPES,
  buildDeveloperEventsChecklist,
  buildSampleAgentEventLog,
  formatFullTimestamp,
  newId,
  newSecretKey,
  newWebhookUrl,
} from '@/app/wizard/mockData'
import type {
  ActivityLogRow,
  AgentEventRow,
  AgentEventStatus,
  AgentEventTypeDef,
  AgentEventsState,
  ConnectionsPageState,
  } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { Textarea } from '@/app/components/ui/textarea'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import {
  errorText,
  getAgentEvent,
  sendAgentEvent,
  } from '@/app/api/meta'
import { listAgentEvents, listAudit, ms, type AuditRow } from '@/app/api/store'

// ==================================================================================
// QUALITY CHECKS
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
        <p className="text-muted-foreground text-sm">
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
            <p className="text-muted-foreground text-sm">
              No connector activity yet.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-5">
                <span className="text-sm">
                  <span className="text-muted-foreground">Worked: </span>
                  <span className="font-medium">{rows.filter((r) => r.outcome === 'worked').length}</span>
                </span>
                <span className="text-sm">
                  <span className="text-muted-foreground">Failed: </span>
                  <span className="font-medium">{rows.filter((r) => r.outcome === 'failed').length}</span>
                </span>
              </div>
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
                      <span className="flex min-w-0 items-center gap-3 text-sm">
                        <span className="shrink-0 text-muted-foreground">{formatFullTimestamp(row.timestamp)}</span>
                        <span className="shrink-0">{connection?.name ?? 'Unknown connection'}</span>
                        <span className="truncate text-muted-foreground">{row.actionName}</span>
                      </span>
                      <span
                        className={cn('shrink-0 text-sm font-medium', row.outcome === 'worked' ? 'text-success' : 'text-warning-foreground')}
                      >
                        {row.outcome === 'worked' ? 'Worked' : 'Failed'}
                      </span>
                    </button>
                    {row.outcome === 'failed' && expanded && (
                      <pre className="mx-3 mb-2 max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
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
              <p className="text-sm">
                This part is technical. If that is not you, you can copy the setup details to send
                to your developer.
              </p>
              <button type="button" onClick={copyChecklist} className="shrink-0 text-primary text-xs">
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
                <span className="truncate text-sm">
                  {revealed ? secretKey : '•'.repeat(24)}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <button type="button" onClick={() => setRevealed((v) => !v)} className="text-primary text-xs">
                    {revealed ? 'Hide' : 'Reveal'}
                  </button>
                  <button type="button" onClick={() => setRegenerateOpen(true)} className="text-primary text-xs">
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
                        <code className="text-xs">{t.name}</code>
                        <p className="text-muted-foreground text-xs">
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
  onSendEvent,
}: {
  agentEvents: AgentEventsState
  onPatch: (patch: Partial<AgentEventsState>) => void
  onAddSkillForEvent: () => void
  onSendEvent: (event: TestEvent) => Promise<string | null>
}) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [eventDraft, setEventDraft] = useState<TestEvent>({ to: '', type: '', description: '', payload: '{}' })
  const [eventSending, setEventSending] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)
  const payloadValid = (() => {
    try {
      JSON.parse(eventDraft.payload || '{}')
      return true
    } catch {
      return false
    }
  })()
  const canSendEvent = /^\+[1-9]\d{6,14}$/.test(eventDraft.to.trim()) && eventDraft.type.trim() && eventDraft.description.trim() && payloadValid

  async function sendEvent() {
    setEventSending(true)
    setEventError(null)
    setEventError(await onSendEvent({ ...eventDraft, to: eventDraft.to.trim(), payload: eventDraft.payload || '{}' }))
    setEventSending(false)
  }

  return (
    <section className="space-y-4">
      <div>
        <h3>Inbound business events</h3>
        <p className="mt-1 text-muted-foreground text-sm">
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
            <p className="font-medium">Inbound events set up</p>
            <p className="text-muted-foreground text-xs">
              {agentEvents.eventTypes.length} event type{agentEvents.eventTypes.length === 1 ? '' : 's'} expected
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
            Edit setup
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        To control what your agent says or does when an event arrives, add a custom skill on the
        Skills page.{' '}
        <button type="button" onClick={onAddSkillForEvent} className="text-primary underline underline-offset-2">
          Add a skill for this
        </button>
      </p>

      {/* A real Agent Event: Meta queues it, then the agent acts on it in that customer's conversation. */}
      <div className="space-y-2 rounded-lg border border-border p-3">
        <span className="flex items-center gap-1.5">
          <p className="font-medium">Send a test event</p>
          <InfoTooltip text="The customer must already have a conversation with this number. Their status updates below as Meta processes it." />
        </span>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Customer WhatsApp number" placeholder="+15551234567" value={eventDraft.to} onChange={(e) => setEventDraft({ ...eventDraft, to: e.target.value })} />
          <Input aria-label="Event type" placeholder="e.g. payment_received" maxLength={256} value={eventDraft.type} onChange={(e) => setEventDraft({ ...eventDraft, type: e.target.value })} />
        </div>
        <Input aria-label="Event description" placeholder="e.g. Payment confirmed for order 1042" maxLength={1024} value={eventDraft.description} onChange={(e) => setEventDraft({ ...eventDraft, description: e.target.value })} />
        <Textarea aria-label="Event payload (JSON)" rows={2} maxLength={4096} value={eventDraft.payload} onChange={(e) => setEventDraft({ ...eventDraft, payload: e.target.value })} className="font-mono" />
        {!payloadValid && <p className="text-destructive text-xs">The payload must be valid JSON.</p>}
        {eventError && <InlineError message={eventError} />}
        <Button size="sm" onClick={() => void sendEvent()} disabled={!canSendEvent || eventSending}>
          {eventSending ? <Loader2 className="size-3.5 animate-spin" /> : 'Send event'}
        </Button>
      </div>

      <InboundEventsMonitor events={agentEvents.events} />

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
// CONVERSATIONS
// ==================================================================================

type TestEvent = { to: string; type: string; description: string; payload: string }

/** Precomputes each turn's display time in one pass: the turn's own timestamp when Meta actually
 *  returned one, otherwise `~` plus the last turn that did have one — never an invented time,
 *  since `timestamp` is documented as present only "if available." */
function ChangeHistorySection({ rows }: { rows: AuditRow[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h3>Change history</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Every change this console sent to Meta for this agent, newest first.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No changes recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Resource</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const failed = Number(r.status) >= 400
                return (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatFullTimestamp(ms(r.at))}</td>
                    <td className={cn('px-3 py-2 capitalize', failed && 'text-destructive')}>
                      {r.action}
                      {failed && ` (failed, ${r.status})`}
                    </td>
                    <td className="px-3 py-2">{r.resource}</td>
                    <td className="px-3 py-2 wrap-break-word text-muted-foreground">
                      {Object.entries(r.summary ?? {})
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
/** Business events (orders paid, bookings made…) the business sends the agent: setup, a test send
 *  and the live log. Lives under Connections, since it is another way systems talk to the agent. */
export function BusinessEventsPanel() {
  const { state, patch, setSection, setPendingSkillPrefill } = useWizard()
  const [storedEvents, setStoredEvents] = useState<AgentEventRow[]>([])
  useEffect(() => {
    listAgentEvents().then((rows) => rows && setStoredEvents(rows), () => {})
  }, [])
  // This browser's rows win for events it sent (they update live); the store adds everything else.
  const knownEventIds = new Set(state.agentEvents.events.map((e) => e.agentEventId))
  const events = [...state.agentEvents.events, ...storedEvents.filter((e) => !knownEventIds.has(e.agentEventId))].sort(
    (a, b) => b.createdAt - a.createdAt,
  )

  /** POST agent_event, then poll its status every 2 s until Meta reports a final one. */
  async function sendTestEvent(ev: TestEvent): Promise<string | null> {
    let agentEventId: string | undefined
    try {
      agentEventId = (await sendAgentEvent(ev.to, { type: ev.type, description: ev.description, payload: ev.payload })).agent_event_id
    } catch (err) {
      return errorText(err)
    }
    const id = newId('aevent')
    const createdAt = Date.now()
    const row: AgentEventRow = {
      id,
      agentEventId: agentEventId ?? id,
      eventType: ev.type,
      description: ev.description,
      to: ev.to,
      status: 'request_received',
      createdAt,
      updatedAt: createdAt,
      payload: ev.payload,
    }
    patch('agentEvents', (prev) => ({ configured: true, events: [row, ...prev.events] }))
    if (!agentEventId) return null
    void (async () => {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const e = await getAgentEvent(agentEventId)
          patch('agentEvents', (prev) => ({
            events: prev.events.map((r) =>
              r.id === id
                ? { ...r, status: e.status, updatedAt: Date.parse(e.updated_at) || Date.now(), errorMessage: e.error_message, skippedReason: e.skipped_reason }
                : r,
            ),
          }))
          if (e.status === 'success' || e.status === 'failed' || e.status === 'skipped') return
        } catch {
          // transient: keep polling
        }
      }
    })()
    return null
  }

  function addSkillForEvent() {
    setPendingSkillPrefill({
      name: 'Business event handling',
      instruction: 'When a business event of type [event type] arrives, [describe what the agent should say or do].',
    })
    setSection('abilities')
  }

  return (
    <InboundEventsSection
      agentEvents={{ ...state.agentEvents, events }}
      onPatch={(p) => patch('agentEvents', p)}
      onAddSkillForEvent={addSkillForEvent}
      onSendEvent={sendTestEvent}
    />
  )
}

export function ActivityPage() {
  const { state, patch, setSection } = useWizard()

  const exitTo = useExitWizard()
  // From the server's store; null when it has no database.
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  useEffect(() => {
    listAudit().then(setAudit, () => setAudit([]))
  }, [])

  function goToConnections() {
    setSection('connections')
  }

  function demoLoadSampleActivity() {
    const now = Date.now()

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
    patch('agentEvents', { configured: true, webhookUrl, secretKey, eventTypes, events: [...buildSampleAgentEventLog(), ...state.agentEvents.events] })

    toast.success('Sample activity loaded')
  }

  // One event arrives as `request_received` and, over a few seconds, walks forward through the
  // real lifecycle to a terminal status — for reviewing the table and detail panel's real-time
  // feel rather than a static snapshot. Each step reads the latest state via patch's updater form,
  // since the earlier steps are still pending in setTimeout when this function returns.
  function demoSimulateLiveEvent() {
    const webhookUrl = state.agentEvents.webhookUrl || newWebhookUrl()
    const secretKey = state.agentEvents.secretKey || newSecretKey()
    const id = newId('aevent')
    const createdAt = Date.now()
    const orderId = String(1000 + Math.floor(Math.random() * 9000))
    const newRow: AgentEventRow = {
      id,
      agentEventId: newId('meta_evt'),
      eventType: 'payment_received',
      description: `Payment confirmed for order ${orderId}`,
      to: '+91 98765 43210',
      status: 'request_received',
      createdAt,
      updatedAt: createdAt,
      payload: JSON.stringify({ order_id: orderId, amount: '1499.00', currency: 'INR' }),
    }
    patch('agentEvents', (prev) => ({ configured: true, webhookUrl, secretKey, events: [newRow, ...prev.events] }))

    function advanceTo(status: AgentEventStatus, delayMs: number, extra?: Partial<AgentEventRow>) {
      setTimeout(() => {
        patch('agentEvents', (prev) => ({
          events: prev.events.map((row) => (row.id === id ? { ...row, status, updatedAt: Date.now(), ...extra } : row)),
        }))
      }, delayMs)
    }

    advanceTo('processing', 900)
    advanceTo('sent', 1900)
    const terminalRoll = Math.random()
    if (terminalRoll < 0.7) advanceTo('success', 3000)
    else if (terminalRoll < 0.85) advanceTo('failed', 3000, { errorMessage: 'Signature verification failed.' })
    else advanceTo('skipped', 3000, { skippedReason: 'The conversation was already closed.' })

    toast.success('Simulating a live event arriving…')
  }

  useRegisterDevControls(
    'activity',
    <DemoControlsGroup label="Activity">
      <Button variant="outline" size="sm" onClick={demoLoadSampleActivity}>
        Demo: load sample activity
      </Button>
      <Button variant="outline" size="sm" onClick={demoSimulateLiveEvent}>
        Demo: simulate live event arriving
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <div className="space-y-10">
      <ConnectorActivitySection connectionsState={state.connections} onGoToConnections={goToConnections} />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        To read a customer&rsquo;s conversation or take it over from the agent, open it in the Inbox.
        <Button variant="outline" size="sm" onClick={() => exitTo('inbox')}>
          Open Inbox
        </Button>
      </p>
      {audit && <ChangeHistorySection rows={audit} />}
    </div>
  )
}
