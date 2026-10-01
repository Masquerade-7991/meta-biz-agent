import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react'
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
import { InboundEventsMonitor } from './InboundEventsMonitor'
import {
  SAMPLE_AGENT_EVENT_TYPES,
  SAMPLE_CONVERSATION_NUMBER,
  SAMPLE_QUALITY_CHECK_RUN,
  buildDeveloperEventsChecklist,
  buildSampleAgentEventLog,
  buildSampleConversationTurns,
  buildSlowOrFailedTurn,
  formatConversationTurnTime,
  formatFullTimestamp,
  formatLatencySeconds,
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
  ConversationTurn,
  QualityCheckItem,
  QualityCheckRun,
} from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { Textarea } from '@/app/components/ui/textarea'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import {
  conversationInsights,
  conversationTurns,
  errorText,
  getAgentEvent,
  MetaError,
  sendAgentEvent,
  threadControl,
} from '@/app/api/meta'
import { listAgentEvents, listAudit, listTraces, ms, type AuditRow, type StoredTrace } from '@/app/api/store'

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
        <InfoTooltip text="Results from the standard checks run on the Test & Eval step." />
      </span>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No checks run yet. Run the standard checks from{' '}
          <button type="button" onClick={onGoToTestPublish} className="text-primary underline underline-offset-2">
            Test &amp; Eval
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
            <div className="space-y-2">
              <div className="flex items-center gap-5">
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  <span className="text-muted-foreground">Worked: </span>
                  <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{rows.filter((r) => r.outcome === 'worked').length}</span>
                </span>
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  <span className="text-muted-foreground">Failed: </span>
                  <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{rows.filter((r) => r.outcome === 'failed').length}</span>
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

      {/* A real Agent Event: Meta queues it, then the agent acts on it in that customer's conversation. */}
      <div className="space-y-2 rounded-lg border border-border p-3">
        <span className="flex items-center gap-1.5">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Send a test event</p>
          <InfoTooltip text="The customer must already have a conversation with this number. Their status updates below as Meta processes it." />
        </span>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Customer WhatsApp number" placeholder="+15551234567" value={eventDraft.to} onChange={(e) => setEventDraft({ ...eventDraft, to: e.target.value })} />
          <Input aria-label="Event type" placeholder="e.g. payment_received" maxLength={256} value={eventDraft.type} onChange={(e) => setEventDraft({ ...eventDraft, type: e.target.value })} />
        </div>
        <Input aria-label="Event description" placeholder="e.g. Payment confirmed for order 1042" maxLength={1024} value={eventDraft.description} onChange={(e) => setEventDraft({ ...eventDraft, description: e.target.value })} />
        <Textarea aria-label="Event payload (JSON)" rows={2} maxLength={4096} value={eventDraft.payload} onChange={(e) => setEventDraft({ ...eventDraft, payload: e.target.value })} className="font-mono" />
        {!payloadValid && <p className="text-destructive" style={{ fontSize: 'var(--text-xs)' }}>The payload must be valid JSON.</p>}
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

type ConversationLookupStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'failed'
type TestEvent = { to: string; type: string; description: string; payload: string }

/** Precomputes each turn's display time in one pass: the turn's own timestamp when Meta actually
 *  returned one, otherwise `~` plus the last turn that did have one — never an invented time,
 *  since `timestamp` is documented as present only "if available." */
function turnDisplayTimes(turns: ConversationTurn[]): (string | null)[] {
  let lastKnown: string | null = null
  return turns.map((turn) => {
    if (turn.timestamp !== undefined) {
      lastKnown = formatConversationTurnTime(turn.timestamp)
      return lastKnown
    }
    return lastKnown ? `~${lastKnown}` : null
  })
}

function ConversationTurnRow({ turn, displayTime }: { turn: ConversationTurn; displayTime: string | null }) {
  return (
    <div className="space-y-0.5">
      {displayTime && (
        <p style={{ fontSize: 'var(--text-sm)' }}>
          <span className="text-muted-foreground">{displayTime}</span>
          {turn.e2eLatencyMs !== undefined && (
            <span className="text-muted-foreground"> &middot; Responded in {formatLatencySeconds(turn.e2eLatencyMs)}</span>
          )}
        </p>
      )}
      {turn.tool && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Used: {turn.tool}
          {turn.toolWorked === true && ' — worked'}
          {turn.toolWorked === false && " — this didn't work"}
        </p>
      )}
    </div>
  )
}

function ConversationsSection({
  numberDraft,
  onNumberDraftChange,
  status,
  turns,
  onLookup,
  lookupError,
  insights,
  onThreadControl,
  past,
}: {
  past: PastConversation[]
  numberDraft: string
  onNumberDraftChange: (value: string) => void
  status: ConversationLookupStatus
  turns: ConversationTurn[]
  onLookup: () => void
  lookupError: string | null
  insights: { aiThreads: number; aiHandoffs: number } | null
  onThreadControl: (action: 'take' | 'release') => Promise<string | null>
}) {
  const displayTimes = turnDisplayTimes(turns)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlNote, setControlNote] = useState<string | null>(null)

  async function control(action: 'take' | 'release') {
    setControlBusy(true)
    const err = await onThreadControl(action)
    setControlBusy(false)
    setControlNote(
      err
        ? `Could not ${action === 'take' ? 'take over' : 'hand back'}: ${err}`
        : action === 'take'
          ? 'You now hold this conversation. The agent stops replying until you hand it back.'
          : 'Handed back. The agent replies to this customer again.',
    )
  }

  return (
    <section className="space-y-3">
      <div>
        <h3>Conversations</h3>
        <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Look up a customer&rsquo;s real conversation with your agent.
        </p>
      </div>

      {insights && (
        <div className="grid max-w-md grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              AI conversations, last 30 days
            </p>
            <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{insights.aiThreads}</p>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              Handed to a person right now
            </p>
            <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{insights.aiHandoffs}</p>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="max-w-xs flex-1 space-y-1.5">
          <Label htmlFor="convo-number">Customer&rsquo;s WhatsApp number</Label>
          <Input
            id="convo-number"
            value={numberDraft}
            onChange={(e) => onNumberDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLookup()
            }}
            placeholder="+15551234567"
          />
        </div>
        <Button variant="outline" onClick={onLookup} disabled={!numberDraft.trim() || status === 'loading'}>
          {status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Look up
        </Button>
      </div>

      {status === 'not_found' && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No conversation found for this number.
        </p>
      )}

      {status === 'failed' && <InlineError message={`Could not look up this conversation. ${lookupError ?? ''}`} onRetry={onLookup} />}

      {status === 'found' && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          {/* Human takeover via WhatsApp thread control (PRD 5.3.7 d). */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void control('take')} disabled={controlBusy}>
              Take over conversation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void control('release')} disabled={controlBusy}>
              Hand back to agent
            </Button>
            {controlBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          {controlNote && (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {controlNote}
            </p>
          )}
          {turns.map((turn, i) => (
            <ConversationTurnRow key={i} turn={turn} displayTime={displayTimes[i]} />
          ))}
        </div>
      )}

      {/* Earlier conversations the server recorded, newest first (only when it has a database). */}
      {past.length > 0 && (
        <div className="space-y-2">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Earlier conversations</p>
          {past.map((c) => {
            const times = turnDisplayTimes(c.turns)
            return (
              <details key={c.id} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer" style={{ fontSize: 'var(--text-sm)' }}>
                  {formatFullTimestamp(c.startedAt)} &middot; {c.turns.length} turn{c.turns.length === 1 ? '' : 's'}
                </summary>
                <div className="mt-2 space-y-3">
                  {c.turns.map((turn, i) => (
                    <ConversationTurnRow key={i} turn={turn} displayTime={times[i]} />
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}

type PastConversation = { id: string; startedAt: number; turns: ConversationTurn[] }

function toPastConversation(c: StoredTrace): PastConversation {
  return {
    id: c.conversationId,
    startedAt: ms(c.startedAt),
    turns: c.turns.map((t) => {
      const tool = t.steps.find((st) => st.type === 'TOOL_CALL')
      return {
        timestamp: ms(t.ts) || undefined,
        e2eLatencyMs: t.e2eLatencyMs ?? undefined,
        tool: tool?.tool_name,
        toolWorked: tool?.status ? tool.status === 'SUCCESS' : undefined,
      }
    }),
  }
}

// ==================================================================================
// CHANGE HISTORY (the server's audit log; hidden when it has no database)
// ==================================================================================

function ChangeHistorySection({ rows }: { rows: AuditRow[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h3>Change history</h3>
        <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Every change this console sent to Meta for this agent, newest first.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No changes recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left" style={{ fontSize: 'var(--text-sm)' }}>
            <thead className="bg-muted text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
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
export function ActivityPage() {
  const { state, patch, setSection, setPendingSkillPrefill } = useWizard()

  // ---- Conversations: real customer lookup, local to this visit only, not wizard config ----
  const [convoNumberDraft, setConvoNumberDraft] = useState('')
  const [convoStatus, setConvoStatus] = useState<ConversationLookupStatus>('idle')
  const [convoTurns, setConvoTurns] = useState<ConversationTurn[]>([])

  function normalizePhone(value: string): string {
    return value.replace(/[^\d+]/g, '')
  }

  const [lookupError, setLookupError] = useState<string | null>(null)
  const [insights, setInsights] = useState<{ aiThreads: number; aiHandoffs: number } | null>(null)
  useEffect(() => {
    conversationInsights().then(setInsights, () => {})
  }, [])

  // From the server's store; each stays empty/null when it has no database.
  const [pastConvos, setPastConvos] = useState<PastConversation[]>([])
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [storedEvents, setStoredEvents] = useState<AgentEventRow[]>([])
  useEffect(() => {
    listAudit().then(setAudit)
    listAgentEvents().then((rows) => rows && setStoredEvents(rows))
  }, [])
  // This browser's rows win for events it sent (they update live); the store adds everything else.
  const knownEventIds = new Set(state.agentEvents.events.map((e) => e.agentEventId))
  const events = [...state.agentEvents.events, ...storedEvents.filter((e) => !knownEventIds.has(e.agentEventId))].sort(
    (a, b) => b.createdAt - a.createdAt,
  )

  /** Meta's conversation-turns insight: the customer's most recent conversation, turn metadata only. */
  async function lookupConversation() {
    const query = convoNumberDraft.trim()
    if (!query) return
    setConvoStatus('loading')
    setLookupError(null)
    setPastConvos([])
    // The demo sample number still shows the sample conversation without calling Meta.
    if (normalizePhone(query) === normalizePhone(SAMPLE_CONVERSATION_NUMBER)) {
      setConvoTurns(buildSampleConversationTurns())
      setConvoStatus('found')
      return
    }
    const tracesPromise = listTraces(query)
    try {
      const turns = await conversationTurns(query)
      const latestId = turns[0]?.conversation_id
      void tracesPromise.then((list) => setPastConvos((list ?? []).filter((c) => c.conversationId !== latestId).map(toPastConversation)))
      setConvoTurns(
        turns.map((t) => {
          const tool = t.steps?.find((st) => st.type === 'TOOL_CALL')
          return {
            timestamp: t.timestamp,
            e2eLatencyMs: t.e2e_latency_ms,
            tool: tool?.tool_name,
            toolWorked: tool?.status ? tool.status === 'SUCCESS' : undefined,
          }
        }),
      )
      setConvoStatus(turns.length > 0 ? 'found' : 'not_found')
    } catch (err) {
      void tracesPromise.then((list) => setPastConvos((list ?? []).map(toPastConversation)))
      if (err instanceof MetaError && (err.status === 404 || /not found/i.test(err.message))) {
        setConvoTurns([])
        setConvoStatus('not_found')
      } else {
        setLookupError(errorText(err))
        setConvoStatus('failed')
      }
    }
  }

  async function handleThreadControl(action: 'take' | 'release'): Promise<string | null> {
    try {
      await threadControl(action, convoNumberDraft)
      conversationInsights().then(setInsights, () => {})
      return null
    } catch (err) {
      return errorText(err)
    }
  }

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

  function goToTestPublish() {
    setSection('testEval')
  }

  function goToConnections() {
    setSection('connections')
  }

  function addSkillForEvent() {
    setPendingSkillPrefill({
      name: 'Business event handling',
      instruction: 'When a business event of type [event type] arrives, [describe what the agent should say or do].',
    })
    setSection('abilities')
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
    patch('agentEvents', { configured: true, webhookUrl, secretKey, eventTypes, events: [...buildSampleAgentEventLog(), ...state.agentEvents.events] })

    setConvoNumberDraft(SAMPLE_CONVERSATION_NUMBER)
    setConvoTurns(buildSampleConversationTurns())
    setConvoStatus('found')

    toast.success('Sample activity loaded')
  }

  // Appends one slow, failed-tool-call turn to whatever conversation is currently shown, seeding
  // the sample conversation first if none has been looked up yet — for reviewing how that line
  // reads in plain language without a fresh lookup.
  function demoSimulateSlowOrFailedTurn() {
    setConvoNumberDraft((prev) => prev || SAMPLE_CONVERSATION_NUMBER)
    setConvoTurns((prev) => [...(prev.length > 0 ? prev : buildSampleConversationTurns()), buildSlowOrFailedTurn()])
    setConvoStatus('found')
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
      <Button variant="outline" size="sm" onClick={demoSimulateSlowOrFailedTurn}>
        Demo: simulate a slow or failed turn
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <div className="space-y-10">
      <QualityChecksSection runs={state.qualityChecks.runs} onGoToTestPublish={goToTestPublish} />
      <ConnectorActivitySection connectionsState={state.connections} onGoToConnections={goToConnections} />
      <InboundEventsSection
        agentEvents={{ ...state.agentEvents, events }}
        onPatch={(p) => patch('agentEvents', p)}
        onAddSkillForEvent={addSkillForEvent}
        onSendEvent={sendTestEvent}
      />
      <ConversationsSection
        numberDraft={convoNumberDraft}
        onNumberDraftChange={setConvoNumberDraft}
        status={convoStatus}
        turns={convoTurns}
        onLookup={() => void lookupConversation()}
        lookupError={lookupError}
        insights={insights}
        onThreadControl={handleThreadControl}
        past={pastConvos}
      />
      {audit && <ChangeHistorySection rows={audit} />}
    </div>
  )
}
