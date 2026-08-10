import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  Rocket,
  Send,
  ShieldQuestion,
  X,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Checkbox } from '@/app/components/ui/checkbox'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { Switch } from '@/app/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { CompiledConfigViewer } from '@/app/components/wizard/CompiledConfigViewer'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useExitWizard } from '@/app/wizard/ExitContext'
import { compileConfig } from '@/app/wizard/compiler'
import {
  SAMPLE_BUSINESS_PROFILE,
  SAMPLE_DOCUMENTS,
  SAMPLE_FAQS,
  SAMPLE_NEVER_SAY_WORDS,
  SAMPLE_RICH_REPLIES,
  SAMPLE_TOPICS_TO_AVOID,
  SAMPLE_WEBSITES,
  matchConnectionPreviewMessage,
  matchFaqPreviewMessage,
  newId,
  pickConnectionPreviewReply,
} from '@/app/wizard/mockData'
import type { Connection, ConnectionAction, StepId, WizardState } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const E164_RE = /^\+[1-9]\d{6,14}$/
const BILLING_HUB_URL = 'https://business.facebook.com/latest/billing_hub/credit_lines/'
const VERSION_NOTE_MAX = 300

function simulateAgentReply(state: WizardState, message: string): string {
  const faqMatches = matchFaqPreviewMessage(message, state.knowledge.faqs)
  if (faqMatches.length > 0) return faqMatches[0].answer
  const connMatches = matchConnectionPreviewMessage(message, state.connections.connections, state.connections.actions)
  if (connMatches.length > 0) return pickConnectionPreviewReply(connMatches[0])
  if (/\b(hi|hello|hey)\b/i.test(message)) return state.replies.greetingReply
  return state.replies.fallbackReply
}

type CheckStatus = 'pending' | 'normal' | 'warn'
interface CheckRow {
  id: string
  situation: string
  sent: string
  reply: string
  status: CheckStatus
}

type CheckDef = Omit<CheckRow, 'status'> & { finalStatus: CheckStatus }

function buildStandardChecks(state: WizardState, forceAmberGreeting: boolean): CheckDef[] {
  const rows: CheckDef[] = []

  rows.push({
    id: 'greeting',
    situation: 'Greeting',
    sent: 'Hi',
    reply: state.replies.greetingReply,
    finalStatus: forceAmberGreeting ? 'warn' : 'normal',
  })

  const faq = state.knowledge.faqs[0]
  rows.push({
    id: 'faq',
    situation: 'A question from your FAQ',
    sent: faq ? faq.question : 'Do you have a returns policy?',
    reply: faq ? faq.answer : state.replies.fallbackReply,
    finalStatus: 'normal',
  })

  rows.push({
    id: 'outside',
    situation: 'Something outside what you sell',
    sent: 'Can you help me file my taxes?',
    reply: state.replies.fallbackReply,
    finalStatus: 'normal',
  })

  // A prototype has no way to confirm a human was actually notified, so this check can never
  // honestly report success — same "never claim to have verified the unverifiable" rule as the
  // billing checkbox below.
  rows.push({
    id: 'person',
    situation: 'Asking for a person',
    sent: 'Can I talk to a real person?',
    reply: state.guardrails.handoffMessageEnabled ? state.guardrails.handoffMessage : "I'll connect you with someone from our team.",
    finalStatus: 'warn',
  })

  if (state.connections.actions.length > 0) {
    const action = state.connections.actions[0]
    const connection = state.connections.connections.find((c) => c.id === action.connectionId)
    rows.push({
      id: 'action',
      situation: 'A configured action, if any',
      sent: `Can you help with ${action.name.toLowerCase()}?`,
      reply: connection ? pickConnectionPreviewReply({ action, connection }) : state.replies.fallbackReply,
      finalStatus: 'normal',
    })
  }

  return rows
}

export function ReviewPublishStep() {
  const { state, patch, setStep, setPendingStepFocus } = useWizard()
  const { publish } = state
  const exitWizard = useExitWizard()

  const compiled = useMemo(() => compileConfig(state), [state])

  // ---- Quick test (local, per-visit only — no history kept between visits) ----
  const [chatMessages, setChatMessages] = useState<{ from: 'customer' | 'agent'; text: string }[]>([])
  const [chatDraft, setChatDraft] = useState('')

  function sendQuickTest() {
    const text = chatDraft.trim()
    if (!text) return
    setChatDraft('')
    setChatMessages((prev) => [...prev, { from: 'customer', text }])
    setTimeout(() => {
      setChatMessages((prev) => [...prev, { from: 'agent', text: simulateAgentReply(state, text) }])
    }, 700)
  }

  // ---- Standard checks (local, per-visit only) ----
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null)
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)
  const [hasRunStandardChecks, setHasRunStandardChecks] = useState(false)

  function runStandardChecks(forceAmberGreeting = false) {
    const defs = buildStandardChecks(state, forceAmberGreeting)
    setCheckRows(defs.map((d) => ({ ...d, status: 'pending' })))
    setHasRunStandardChecks(false)
    defs.forEach((d, i) => {
      setTimeout(() => {
        setCheckRows((prev) => (prev ? prev.map((r) => (r.id === d.id ? { ...r, status: d.finalStatus } : r)) : prev))
        if (i === defs.length - 1) setHasRunStandardChecks(true)
      }, (i + 1) * 500)
    })
  }

  // ---- Who can talk to your agent ----
  const [numberDraft, setNumberDraft] = useState('')
  const [numberError, setNumberError] = useState<string | null>(null)

  function addAllowlistNumber() {
    const value = numberDraft.trim()
    if (!E164_RE.test(value)) {
      setNumberError("This doesn't look like a valid number")
      return
    }
    setNumberDraft('')
    setNumberError(null)
    if (publish.allowlistNumbers.includes(value)) return
    patch('publish', { allowlistNumbers: [...publish.allowlistNumbers, value] })
    toast.success('Saved')
  }

  function removeAllowlistNumber(value: string) {
    patch('publish', { allowlistNumbers: publish.allowlistNumbers.filter((n) => n !== value) })
    toast.success('Saved')
  }

  function setAudienceMode(mode: 'allowlisted' | 'everyone') {
    patch('publish', { audienceMode: mode })
    toast.success('Saved')
  }

  // ---- Publish ----
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)

  const canActivate = hasRunStandardChecks && publish.billingConfirmed
  const activateReason = !hasRunStandardChecks && !publish.billingConfirmed
    ? 'Run the standard checks and confirm your billing setup to continue'
    : !hasRunStandardChecks
      ? 'Run the standard checks to continue'
      : !publish.billingConfirmed
        ? 'Confirm your billing setup to continue'
        : null

  const activateLabel = publish.approverRequired ? 'Submit for approval' : 'Activate on channels'

  function confirmActivate() {
    setConfirmOpen(false)
    if (state.demo.forceNextFailure) {
      patch('demo', { forceNextFailure: false })
      setActivateError('Could not save. Nothing was lost.')
      return
    }
    setActivateError(null)
    if (publish.approverRequired) {
      patch('publish', { pendingApproval: true })
    } else {
      patch('publish', { activated: true, activatedChannels: ['WhatsApp'] })
    }
  }

  function onNavigate(step: StepId, tab?: string) {
    if (tab) setPendingStepFocus({ step, tab })
    setStep(step)
  }

  // ---- Demo controls ----
  function demoLoadCompiledConfig() {
    const now = Date.now()
    patch('business', SAMPLE_BUSINESS_PROFILE)
    patch('knowledge', {
      faqs: SAMPLE_FAQS.map((f, i) => ({ id: newId('faq'), question: f.question, answer: f.answer, createdAt: now - i * 1000 })),
      documents: SAMPLE_DOCUMENTS.map((d) => ({
        id: newId('doc'),
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        type: d.type,
        uploadedAt: now - d.daysAgo * 86_400_000,
      })),
      websites: SAMPLE_WEBSITES.map((w) => ({
        id: newId('site'),
        url: w.url,
        status: w.status,
        pagesRead: w.pagesRead,
        updatedAt: now - w.daysAgo * 86_400_000,
      })),
    })
    const connectionId = newId('conn')
    const demoConnections: Connection[] = [
      {
        id: connectionId,
        name: 'Order lookup API',
        description: 'Looks up order status by order number.',
        baseUrl: 'https://api.example.com',
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: 'sample-key', location: 'header', fieldName: 'X-API-Key', prefix: '' }],
        createdAt: now,
        demoStatus: 'working',
      },
    ]
    const demoActions: ConnectionAction[] = [
      {
        id: newId('action'),
        connectionId,
        name: 'Look up an order',
        description: 'find an order by its order number',
        method: 'GET',
        path: '/orders/{order_id}',
        values: [],
        createdAt: now,
      },
    ]
    patch('connections', { connections: demoConnections, actions: demoActions })
    patch('richReplies', { richReplies: SAMPLE_RICH_REPLIES })
    patch('guardrails', { neverSayPhrases: SAMPLE_NEVER_SAY_WORDS, topicsToAvoid: SAMPLE_TOPICS_TO_AVOID })
    toast.success('Sample configuration loaded')
  }

  useRegisterDevControls(
    'publish',
    <DemoControlsGroup label="Test & publish">
      <Button variant="outline" size="sm" onClick={demoLoadCompiledConfig}>
        Demo: load compiled configuration
      </Button>
      <Button variant="outline" size="sm" onClick={() => runStandardChecks(true)}>
        Demo: simulate standard checks result
      </Button>
      <Button variant="outline" size="sm" onClick={() => patch('demo', { forceNextFailure: !state.demo.forceNextFailure })}>
        {state.demo.forceNextFailure ? 'Demo: force save failure (armed)' : 'Demo: force save failure'}
      </Button>
    </DemoControlsGroup>,
  )

  const audiencePhrase = publish.audienceMode === 'everyone' ? 'everyone who messages this number' : 'the numbers on your allowlist'

  return (
    <div className="space-y-10">
      {/* Compiled configuration */}
      <section className="space-y-3">
        <span className="flex items-center gap-1.5">
          <h3>Your agent&rsquo;s configuration</h3>
          <InfoTooltip text="Everything you’ve set up, already saved as you went. This is a review, not a preview." />
        </span>
        <CompiledConfigViewer config={compiled} state={state} onNavigate={onNavigate} />
      </section>

      {/* Test before you launch */}
      <section className="space-y-4">
        <div>
          <span className="flex items-center gap-1.5">
            <h3>Test before you launch</h3>
            <InfoTooltip text="Have a real exchange with your agent, or run through a standard set of checks, before anyone else can." />
          </span>
        </div>

        {/* Quick test */}
        <div className="space-y-2 rounded-lg border border-border p-4">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {chatMessages.length === 0 ? (
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                No messages yet.
              </p>
            ) : (
              chatMessages.map((m, i) => (
                <div key={i} className={cn('flex', m.from === 'customer' ? 'justify-end' : 'justify-start')}>
                  <p
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-1.5',
                      m.from === 'customer' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                    )}
                    style={{ fontSize: 'var(--text-sm)' }}
                  >
                    {m.text}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendQuickTest()
              }}
              placeholder="Type a message to try..."
            />
            <Button size="icon" onClick={sendQuickTest} disabled={!chatDraft.trim()}>
              <Send className="size-4" />
            </Button>
          </div>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Test messages here are free and do not count toward your usage.
          </p>
        </div>

        {/* Standard checks */}
        <div className="space-y-2">
          <div>
            <span className="flex items-center gap-1.5">
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Run our standard checks</p>
              <InfoTooltip text="A short set of common situations, run automatically, so you don’t have to think of them yourself." />
            </span>
          </div>
          <Button variant="outline" onClick={() => runStandardChecks(false)} disabled={checkRows !== null && checkRows.some((r) => r.status === 'pending')}>
            Run standard checks
          </Button>

          {checkRows && (
            <div className="space-y-2">
              {checkRows.map((row) => {
                const expanded = expandedCheck === row.id
                return (
                  <div key={row.id} className="rounded-lg border border-border px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedCheck(expanded ? null : row.id)}
                      disabled={row.status === 'pending'}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {row.status === 'pending' ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : row.status === 'normal' ? (
                          <CheckCircle2 className="size-4 shrink-0 text-success" />
                        ) : (
                          <AlertTriangle className="size-4 shrink-0 text-warning" />
                        )}
                        <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                          {row.situation}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                          {row.status === 'pending' ? '' : row.status === 'normal' ? 'Responded normally' : 'Check this'}
                        </span>
                        {row.status !== 'pending' && (
                          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                        )}
                      </span>
                    </button>
                    {expanded && row.status !== 'pending' && (
                      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                          <span className="text-muted-foreground">Customer: </span>
                          {row.sent}
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                          <span className="text-muted-foreground">Agent: </span>
                          {row.reply}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Who can talk to your agent */}
      <section className="space-y-3">
        <div>
          <span className="flex items-center gap-1.5">
            <h3>Who can talk to your agent</h3>
            <InfoTooltip text="Start with a small group while you’re confident it’s ready, then open it up." />
          </span>
        </div>

        <div className="space-y-2">
          <SelectableCard
            title="Only the numbers I list below"
            selected={publish.audienceMode === 'allowlisted'}
            onClick={() => setAudienceMode('allowlisted')}
          />
          <SelectableCard
            title="Everyone"
            selected={publish.audienceMode === 'everyone'}
            onClick={() => setAudienceMode('everyone')}
          />
        </div>

        {publish.audienceMode === 'allowlisted' ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  value={numberDraft}
                  onChange={(e) => {
                    setNumberDraft(e.target.value)
                    setNumberError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addAllowlistNumber()
                  }}
                  placeholder="+15551234567"
                />
                {numberError && (
                  <p className="mt-1 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
                    {numberError}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={addAllowlistNumber}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            {publish.allowlistNumbers.length === 0 ? (
              <span className="flex items-center gap-1.5">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  No numbers added yet.
                </p>
                <InfoTooltip text="Add your own number first to try the agent as a real customer would." />
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {publish.allowlistNumbers.map((n) => (
                  <span key={n} className="badge flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                    {n}
                    <button type="button" onClick={() => removeAllowlistNumber(n)} aria-label={`Remove ${n}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Any customer who messages this number will reach your agent immediately once you activate.
          </p>
        )}
      </section>

      {/* Publish */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2">
          <Rocket className="size-4 text-muted-foreground" />
          Publish
        </h3>

        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="version-note">What changed in this version?</Label>
            <InfoTooltip text="For your own records. This is not sent to Meta." />
          </span>
          <Textarea
            id="version-note"
            rows={2}
            maxLength={VERSION_NOTE_MAX}
            value={publish.versionNote}
            onChange={(e) => patch('publish', { versionNote: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="size-4 text-muted-foreground" />
            <span className="flex items-center gap-1.5">
              <Label htmlFor="approval-toggle">Requires approval before going live</Label>
              <InfoTooltip text="Someone else on your team must approve before this agent can go live." />
            </span>
          </div>
          <Switch
            id="approval-toggle"
            checked={publish.approverRequired}
            onCheckedChange={(checked) => patch('publish', { approverRequired: checked })}
          />
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={publish.billingConfirmed}
              onCheckedChange={(checked) => patch('publish', { billingConfirmed: checked === true })}
              className="mt-0.5"
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>I&rsquo;ve completed Meta&rsquo;s billing and compliance setup for this agent</span>
          </label>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Meta Business Agent uses its own billing, separate from your regular WhatsApp messaging, and requires
            accepting Meta&rsquo;s terms and completing their checks directly. We can&rsquo;t confirm this has been
            done from here, so please check it yourself before switching on.
          </p>
          <a
            href={BILLING_HUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            Open Meta&rsquo;s Billing Hub
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        {publish.activated ? (
          <div className="flex items-center justify-between rounded-lg border border-success bg-success/10 p-4">
            <span className="flex items-center gap-3">
              <CheckCircle2 className="size-5 text-success" />
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Your agent is live.</p>
            </span>
            <Button variant="outline" size="sm" onClick={exitWizard}>
              Back to agents list
            </Button>
          </div>
        ) : publish.pendingApproval ? (
          <div className="rounded-lg border border-border bg-muted p-4">
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>
              Sent for approval. You&rsquo;ll be notified once it&rsquo;s reviewed.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Button size="lg" disabled={!canActivate} onClick={() => setConfirmOpen(true)}>
                <Rocket className="size-4" />
                {activateLabel}
              </Button>
              {activateReason && (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {activateReason}
                </p>
              )}
            </div>
            {activateError && (
              <p className="text-destructive" style={{ fontSize: 'var(--text-sm)' }}>
                {activateError}
              </p>
            )}
          </div>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          {publish.approverRequired ? (
            <>
              <DialogHeader>
                <DialogTitle>Send for approval?</DialogTitle>
                <DialogDescription>
                  This will notify your team that this agent is ready for review. It will not go live until approved.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Go back
                </Button>
                <Button onClick={confirmActivate}>Send for approval</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Ready to go live?</DialogTitle>
                <DialogDescription>
                  Once activated, your agent becomes the main responder for {audiencePhrase}. Meta charges for every
                  message it sends. This is not a test anymore.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Go back
                </Button>
                <Button onClick={confirmActivate}>Yes, activate</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
