import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { TagInput } from '@/app/components/wizard/TagInput'
import { UnsavedChangesDialog } from '@/app/components/wizard/UnsavedChangesDialog'
import { InlineError, LoadFailedBanner, SaveFailedBanner, SavingIndicator, LoadingIndicator } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { SaveButton } from '@/app/components/wizard/SaveButton'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useNavigationGuard, useRegisterNavGuard, useReportSaveStatus, type NavIntent } from '@/app/wizard/NavigationGuardContext'
import {
  FOLLOW_UP_INTERVALS,
  SAMPLE_CUSTOM_HANDOFF_MESSAGE,
  SAMPLE_NEVER_SAY_WORDS,
  SAMPLE_TOPICS_TO_AVOID,
  suggestWordVariants,
} from '@/app/wizard/mockData'
import type { FollowUpInterval, FollowUpMaxAttempts, GuardrailsState } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { toast } from 'sonner'
import { pushSlice } from '@/app/api/meta'

type TabId = 'avoids' | 'handoff' | 'followup'
type HandoffSource = 'default' | 'agent' | 'custom'

const MAX_WORD_PHRASES = 50
const MAX_WORD_LENGTH = 60
const MAX_TOPICS = 20
const MAX_TOPIC_LENGTH = 100
const MAX_CUSTOM_HANDOFF = 300
const MAX_FOLLOWUP_MESSAGE = 300

const HANDOFF_RULES_PREFILL = `Attempt to resolve the customer's request first. Hand off to a
person only when their need is beyond what you can do, or when one
of these applies: they ask to speak to a person directly, they seem
frustrated after a couple of exchanges with no progress, or the
request involves a refund, compensation, or something sensitive.

Do not hand off for: unsupported message types like voice notes,
where you should ask the customer to type instead; messages outside
business hours, where you should confirm receipt and give an expected
reply time; or a connection or action that failed once, where you
should try again or offer an alternative before involving a person.`

// ---- Combined save-on-Next lifecycle across the guardrails + replies slices ----
// This screen is "one saved object" per spec, but its fields live in two existing reducer slices.
// Fields already patch the store live on every keystroke (same convention as every other
// save-on-Next section here) — this local state exists only to simulate the load/save round trip
// and gate navigation with a single combined dirty-check, mirroring useSaveOnNextSection's
// behaviour but spanning two slices instead of one.
interface SafetySnapshot {
  groundingMode: GuardrailsState['groundingMode']
  neverSayPhrases: string[]
  topicsToAvoid: string[]
  handoffMessageEnabled: boolean
  handoffMessage: string
  handoffMessageSource: HandoffSource
  followUpInterval: FollowUpInterval
  followUpMessage: string
  followUpMessageSource: 'default' | 'custom'
  followUpMaxAttempts: FollowUpMaxAttempts
  followUpRespectHours: boolean
}

export function SafetyHandoffStep() {
  const { state, patch, setSection, setPendingSkillPrefill } = useWizard()
  const [activeTab, setActiveTab] = useState<TabId>('avoids')

  const handoffSource: HandoffSource =
    state.guardrails.handoffMessageSource ?? (state.guardrails.handoffMessageEnabled ? 'custom' : 'default')
  const followUpSource = state.replies.followUpMessageSource ?? 'custom'
  const setHandoffSource = (source: HandoffSource) =>
    patch('guardrails', { handoffMessageSource: source, handoffMessageEnabled: source === 'custom' })

  function currentSnapshot(): SafetySnapshot {
    return {
      groundingMode: state.guardrails.groundingMode,
      neverSayPhrases: state.guardrails.neverSayPhrases,
      topicsToAvoid: state.guardrails.topicsToAvoid,
      handoffMessageEnabled: state.guardrails.handoffMessageEnabled,
      handoffMessage: state.guardrails.handoffMessage,
      handoffMessageSource: handoffSource,
      followUpInterval: state.replies.followUpInterval,
      followUpMessage: state.replies.followUpMessage,
      followUpMessageSource: followUpSource,
      followUpMaxAttempts: state.replies.followUpMaxAttempts,
      followUpRespectHours: state.replies.followUpRespectHours,
    }
  }

  const currentRef = useRef(currentSnapshot())
  useEffect(() => {
    currentRef.current = currentSnapshot()
  })

  // The studio loads the agent before this opens, so the saved snapshot is what's on screen.
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'failed'>('loaded')
  const [savedSnapshot, setSavedSnapshot] = useState<SafetySnapshot | null>(currentSnapshot)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [forceSaveFailure, setForceSaveFailure] = useState(false)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  function retryLoad() {
    setLoadStatus('loading')
    setTimeout(() => {
      setLoadStatus('loaded')
      setSavedSnapshot(currentRef.current)
    }, 900)
  }

  function simulateLoadFailure() {
    setLoadStatus('loading')
    setTimeout(() => setLoadStatus('failed'), 900)
  }

  const stateRef = useRef(state)
  stateRef.current = state

  async function performSave(): Promise<boolean> {
    // PRD V-b2b / AC-b4: a custom message can't be saved empty.
    const cur = stateRef.current
    const emptyCustom =
      ((cur.guardrails.handoffMessageSource ?? (cur.guardrails.handoffMessageEnabled ? 'custom' : 'default')) === 'custom' &&
        !cur.guardrails.handoffMessage.trim()) ||
      (cur.replies.followUpEnabled && (cur.replies.followUpMessageSource ?? 'custom') === 'custom' && !cur.replies.followUpMessage.trim())
    if (emptyCustom) {
      toast.error('A custom message cannot be empty.')
      return false
    }
    setSaveStatus('saving')
    try {
      if (forceSaveFailure) throw new Error('Forced failure (Demo controls)')
      await pushSlice('guardrails', stateRef.current)
    } catch (err) {
      setSaveStatus('failed')
      toast.error("Couldn't save to Meta", { description: err instanceof Error ? err.message : String(err) })
      return false
    }
    setSaveStatus('idle')
    setSavedSnapshot(currentRef.current)
    return true
  }

  function askUnsaved(): Promise<boolean> {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setUnsavedDialogOpen(true)
    })
  }

  function resolveUnsaved(result: boolean) {
    setUnsavedDialogOpen(false)
    resolverRef.current?.(result)
    resolverRef.current = null
  }

  async function guard(intent: NavIntent): Promise<boolean> {
    const saved = savedSnapshot
    const curr = currentRef.current
    if (!saved) return true
    const dirty = JSON.stringify(saved) !== JSON.stringify(curr)
    if (!dirty) return true
    if (intent === 'discard') return askUnsaved()
    return performSave()
  }

  useRegisterNavGuard(guard)
  const { runGuard } = useNavigationGuard()

  const loading = loadStatus === 'loading'
  // Same combined-slice comparison guard() uses — all three tabs share one saved snapshot, so
  // each tab's Save button reflects the whole step's dirty state, not just its own fields.
  const dirty = savedSnapshot !== null && JSON.stringify(savedSnapshot) !== JSON.stringify(currentSnapshot())
  useReportSaveStatus(dirty, saveStatus === 'saving')

  async function customiseHandoffRules() {
    // Same save-or-warn discipline as Back/Next — this button navigates away from the page too,
    // and must not silently discard unsaved changes made here.
    const ok = await runGuard('save')
    if (!ok) return
    setPendingSkillPrefill({ name: 'Handoff rules', instruction: HANDOFF_RULES_PREFILL })
    setSection('abilities')
  }

  function loadSampleSettings() {
    // Populates the form only — still unsaved until Next/Save and close, same as typing it by hand.
    patch('guardrails', {
      neverSayPhrases: SAMPLE_NEVER_SAY_WORDS,
      topicsToAvoid: SAMPLE_TOPICS_TO_AVOID,
      handoffMessageEnabled: true,
      handoffMessage: SAMPLE_CUSTOM_HANDOFF_MESSAGE,
    })
    patch('replies', { followUpInterval: 1800, followUpEnabled: true, followUpMaxAttempts: 2 })
  }

  useRegisterDevControls(
    'safety',
    <DemoControlsGroup label="Safety & handoff">
      <Button variant="outline" size="sm" onClick={loadSampleSettings}>
        Load sample safety settings
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <input
          type="checkbox"
          checked={state.demo.simulateMultipleLanguages}
          onChange={(e) => patch('demo', { simulateMultipleLanguages: e.target.checked })}
        />
        Simulate multiple languages
      </label>
      <Button variant="outline" size="sm" onClick={simulateLoadFailure}>
        Force load failure
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => setForceSaveFailure(e.target.checked)} />
        Force save failure
      </label>
    </DemoControlsGroup>,
  )

  const hasMultipleLanguages = state.personalization.additionalLanguages.length > 0 || state.demo.simulateMultipleLanguages
  const avoidsCount = state.guardrails.neverSayPhrases.length + state.guardrails.topicsToAvoid.length
  const followUpOn = state.replies.followUpInterval !== 0

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Words and topics your agent avoids, what happens when a person takes over, and whether it
        follows up with quiet customers.
      </p>

      {loadStatus === 'failed' && (
        <LoadFailedBanner
          message="We could not load your saved choices. Anything you save now will replace them."
          onRetry={retryLoad}
        />
      )}
      {saveStatus === 'failed' && (
        <SaveFailedBanner message="We could not save your changes. Nothing has been lost." onRetry={() => void performSave()} />
      )}
      {saveStatus === 'saving' && <SavingIndicator />}
      {loading && <LoadingIndicator label="Loading your saved choices" />}

      <div className={cn(loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
          <TabsList actions={<SaveButton dirty={dirty} saving={saveStatus === 'saving'} onSave={performSave} />}>
            <TabsTrigger value="avoids" className="gap-1.5">
              What the agent avoids
              {avoidsCount > 0 && (
                <Badge variant="secondary" className="text-muted-foreground">
                  {avoidsCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="handoff">When a person takes over</TabsTrigger>
            <TabsTrigger value="followup" className="gap-1.5">
              Following up with quiet customers
              {followUpOn && (
                <Badge variant="secondary" className="text-muted-foreground">
                  On
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* forceMount + CSS-hidden (not Radix's default unmount-when-inactive) so every tab's
              fields keep patching the shared guardrails/replies slices no matter which tab is
              showing — otherwise switching tabs mid-edit would silently drop unsaved changes. */}
          <TabsContent value="avoids" forceMount className="space-y-7 data-[state=inactive]:hidden">
            <p className="text-muted-foreground text-sm">
              These become instructions the agent follows strongly, not a filter that blocks a
              message after it&rsquo;s written.
            </p>

            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label>How much the agent can improvise</Label>
                <InfoTooltip text="Strict keeps every answer grounded in what you've configured, and hands off to a person rather than guessing. Assisted allows some natural conversation within its role." />
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectableCard
                  title="Strict"
                  helper="Only answers from what you've told it, otherwise asks a person."
                  selected={state.guardrails.groundingMode === 'strict'}
                  onClick={() => patch('guardrails', { groundingMode: 'strict' })}
                />
                <SelectableCard
                  title="Assisted"
                  helper="Some natural conversation allowed within its role."
                  selected={state.guardrails.groundingMode === 'assisted'}
                  onClick={() => patch('guardrails', { groundingMode: 'assisted' })}
                />
              </div>
            </div>

            <WordsToAvoidField
              values={state.guardrails.neverSayPhrases}
              onChange={(values) => patch('guardrails', { neverSayPhrases: values })}
            />

            <TopicsToAvoidField
              values={state.guardrails.topicsToAvoid}
              onChange={(values) => patch('guardrails', { topicsToAvoid: values })}
              disabled={loading}
            />

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground text-xs">
                <span className="font-medium">Always protected</span>{' '}
                &mdash; no matter what you configure above, the agent never claims to be human
                when directly asked, never shares one customer&rsquo;s details with another, and
                never states medical, legal, or financial advice as certain fact.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="handoff" forceMount className="space-y-7 data-[state=inactive]:hidden">
            <p className="text-muted-foreground text-sm">
              Once handed over, your team picks the conversation up from your usual inbox —
              that part isn&rsquo;t set up in this wizard.
            </p>

            <div className="space-y-2 rounded-lg bg-muted p-3">
              <p className="text-sm">
                <span className="font-medium">This happens automatically</span>{' '}
                &mdash; the agent hands off when it&rsquo;s unsure, something seems wrong, or the
                customer asks for a person, and this can&rsquo;t be turned off. Below, you control
                what it says at that moment.
              </p>
              <button type="button" onClick={customiseHandoffRules} className="text-primary text-xs">
                Customise handoff rules for your business
              </button>
            </div>

            <div className="space-y-2">
              <Label>What the agent says when it hands over</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <SelectableCard
                  title="Meta’s standard message"
                  info="A ready-made message, shown in the customer’s own language automatically."
                  selected={handoffSource === 'default'}
                  onClick={() => setHandoffSource('default')}
                />
                <SelectableCard
                  title="Let the agent write its own"
                  info="The agent writes a handoff message for each conversation, matching what was being discussed."
                  selected={handoffSource === 'agent'}
                  onClick={() => setHandoffSource('agent')}
                />
                <SelectableCard
                  title="Write my own message"
                  selected={handoffSource === 'custom'}
                  onClick={() => setHandoffSource('custom')}
                />
              </div>

              {handoffSource === 'custom' && (
                <div className="space-y-1.5">
                  <Textarea
                    id="handoff-message"
                    rows={2}
                    maxLength={MAX_CUSTOM_HANDOFF}
                    value={state.guardrails.handoffMessage}
                    onChange={(e) => patch('guardrails', { handoffMessage: e.target.value })}
                    placeholder="e.g. Let me get a member of our team to help you with this. They'll be with you shortly."
                    className="bg-input-background shadow-sm"
                    disabled={loading}
                  />
                  {hasMultipleLanguages && (
                    <p className="flex items-start gap-1.5 text-warning-foreground text-xs">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      This is sent exactly as written, in this one language — Meta&rsquo;s
                      standard message adapts to the customer&rsquo;s language instead.
                    </p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="followup" forceMount className="space-y-6 data-[state=inactive]:hidden">
            <p className="text-muted-foreground text-sm">
              If a customer goes quiet mid-conversation, the agent can re-engage them with one
              short check-in message.
            </p>

            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label>Follow up after</Label>
                <InfoTooltip text="Most businesses that use this choose 30 minutes to 1 hour. Shorter can feel pushy, longer may be too late to be useful." />
              </span>
              <Select
                value={String(state.replies.followUpInterval)}
                onValueChange={(v) => {
                  const interval = Number(v) as FollowUpInterval
                  patch('replies', { followUpInterval: interval, followUpEnabled: interval !== 0 })
                }}
                disabled={loading}
              >
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOLLOW_UP_INTERVALS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {followUpOn && (
              <>
                <p className="text-muted-foreground text-xs">
                  Follow-up messages are charged the same way as any other message the agent sends.
                </p>
                <div className="space-y-2">
                  <span className="flex items-center gap-1.5">
                    <Label>Follow-up message</Label>
                    <InfoTooltip text="Sent once, after the time above. Kept short and low pressure works best for a check-in message." />
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SelectableCard
                      title="Meta’s standard message"
                      selected={followUpSource === 'default'}
                      onClick={() => patch('replies', { followUpMessageSource: 'default' })}
                    />
                    <SelectableCard
                      title="Write my own message"
                      selected={followUpSource === 'custom'}
                      onClick={() => patch('replies', { followUpMessageSource: 'custom' })}
                    />
                  </div>
                </div>
                {followUpSource === 'custom' && (
                  <Textarea
                    aria-label="Follow-up message"
                    id="followup-message"
                    rows={2}
                    maxLength={MAX_FOLLOWUP_MESSAGE}
                    value={state.replies.followUpMessage}
                    onChange={(e) => patch('replies', { followUpMessage: e.target.value })}
                    className="bg-input-background shadow-sm"
                    disabled={loading}
                  />
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <UnsavedChangesDialog open={unsavedDialogOpen} onResolve={resolveUnsaved} />
    </div>
  )
}

// ==================================================================================
// Words to avoid
// ==================================================================================

function WordsToAvoidField({
  values,
  onChange,
}: {
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string[] | null>(null)

  function handleChange(next: string[]) {
    setDuplicateError(null)
    if (next.length <= values.length) {
      // A chip was removed.
      onChange(next)
      setSuggestion(null)
      return
    }
    const added = next[next.length - 1]
    const isDuplicate = values.some((v) => v.toLowerCase() === added.toLowerCase())
    if (isDuplicate) {
      setDuplicateError('You already have this word or phrase.')
      return
    }
    if (added.length > MAX_WORD_LENGTH || values.length >= MAX_WORD_PHRASES) return
    onChange(next)
    const suggestions = suggestWordVariants(added, next)
    setSuggestion(suggestions.length > 0 ? suggestions : null)
  }

  function addBoth() {
    if (!suggestion) return
    onChange([...values, ...suggestion])
    setSuggestion(null)
  }

  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5">
        <Label>Specific words or phrases</Label>
        <InfoTooltip text="The agent is instructed never to use these. This does not depend on capital letters, so adding “cheap” also covers “Cheap” and “CHEAP”." />
      </span>
      <TagInput
        values={values}
        onChange={handleChange}
        placeholder="Type a word or phrase and press Enter"
        aria-label="Specific words or phrases"
      />
      {duplicateError && <InlineError message={duplicateError} />}
      {suggestion && suggestion.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2">
          <p className="text-xs">Also add: {suggestion.join(', ')}?</p>
          <button type="button" onClick={addBoth} className="text-primary text-xs">
            Add both
          </button>
          <button type="button" onClick={() => setSuggestion(null)} className="text-muted-foreground text-xs">
            Dismiss
          </button>
        </div>
      )}
      {values.length === 0 && (
        <span className="flex items-center gap-1.5">
          <p className="text-muted-foreground text-xs">
            No words added.
          </p>
          <InfoTooltip text="The agent has no specific words it has been told to avoid." />
        </span>
      )}
    </div>
  )
}

// ==================================================================================
// Topics to avoid
// ==================================================================================

function TopicsToAvoidField({
  values,
  onChange,
  disabled,
}: {
  values: string[]
  onChange: (values: string[]) => void
  disabled: boolean
}) {
  function updateRow(i: number, text: string) {
    onChange(values.map((v, idx) => (idx === i ? text : v)))
  }
  function removeRow(i: number) {
    onChange(values.filter((_, idx) => idx !== i))
  }
  function addRow() {
    if (values.length >= MAX_TOPICS) return
    onChange([...values, ''])
  }

  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5">
        <Label>Topics to avoid</Label>
        <InfoTooltip text="Broader than a specific word. The agent reads each topic and uses its judgement about what counts, so it is not exact the way words above are." />
      </span>
      {values.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No topics added.
        </p>
      ) : (
        <div className="space-y-1.5">
          {values.map((topic, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                maxLength={MAX_TOPIC_LENGTH}
                value={topic}
                onChange={(e) => updateRow(i, e.target.value)}
                placeholder="e.g. Comparing us to specific competitors"
                disabled={disabled}
                className="border-transparent bg-muted shadow-none focus-visible:border-ring focus-visible:bg-input-background"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeRow(i)}
                disabled={disabled}
                aria-label="Remove topic"
              >
                <X className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {values.length < MAX_TOPICS && (
        <Button size="sm" variant="outline" onClick={addRow} disabled={disabled}>
          + Add a topic
        </Button>
      )}
    </div>
  )
}
