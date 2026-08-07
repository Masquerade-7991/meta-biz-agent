import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Button } from '@/app/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { TagInput } from '@/app/components/wizard/TagInput'
import { UnsavedChangesDialog } from '@/app/components/wizard/UnsavedChangesDialog'
import { InlineError, LoadFailedBanner, SaveFailedBanner, SavingIndicator, LoadingIndicator } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useNavigationGuard, useRegisterNavGuard, type NavIntent } from '@/app/wizard/NavigationGuardContext'
import {
  FOLLOW_UP_INTERVALS,
  SAMPLE_CUSTOM_HANDOFF_MESSAGE,
  SAMPLE_NEVER_SAY_WORDS,
  SAMPLE_TOPICS_TO_AVOID,
  suggestWordVariants,
} from '@/app/wizard/mockData'
import type { FollowUpInterval } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

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
  neverSayPhrases: string[]
  topicsToAvoid: string[]
  handoffMessageEnabled: boolean
  handoffMessage: string
  followUpInterval: FollowUpInterval
  followUpMessage: string
}

export function SafetyHandoffStep() {
  const { state, patch, setStep, setPendingSkillPrefill } = useWizard()

  function currentSnapshot(): SafetySnapshot {
    return {
      neverSayPhrases: state.guardrails.neverSayPhrases,
      topicsToAvoid: state.guardrails.topicsToAvoid,
      handoffMessageEnabled: state.guardrails.handoffMessageEnabled,
      handoffMessage: state.guardrails.handoffMessage,
      followUpInterval: state.replies.followUpInterval,
      followUpMessage: state.replies.followUpMessage,
    }
  }

  const currentRef = useRef(currentSnapshot())
  useEffect(() => {
    currentRef.current = currentSnapshot()
  })

  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [savedSnapshot, setSavedSnapshot] = useState<SafetySnapshot | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [forceSaveFailure, setForceSaveFailure] = useState(false)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadStatus('loaded')
      setSavedSnapshot(currentRef.current)
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function performSave(): Promise<boolean> {
    return new Promise((resolve) => {
      setSaveStatus('saving')
      setTimeout(() => {
        if (forceSaveFailure) {
          setSaveStatus('failed')
          resolve(false)
          return
        }
        setSaveStatus('idle')
        setSavedSnapshot(currentRef.current)
        resolve(true)
      }, 900)
    })
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

  async function customiseHandoffRules() {
    // Same save-or-warn discipline as Back/Next — this button navigates away from the page too,
    // and must not silently discard unsaved changes made here.
    const ok = await runGuard('save')
    if (!ok) return
    setPendingSkillPrefill({ name: 'Handoff rules', instruction: HANDOFF_RULES_PREFILL })
    setStep('agent')
  }

  function loadSampleSettings() {
    // Populates the form only — still unsaved until Next/Save and close, same as typing it by hand.
    patch('guardrails', {
      neverSayPhrases: SAMPLE_NEVER_SAY_WORDS,
      topicsToAvoid: SAMPLE_TOPICS_TO_AVOID,
      handoffMessageEnabled: true,
      handoffMessage: SAMPLE_CUSTOM_HANDOFF_MESSAGE,
    })
    patch('replies', { followUpInterval: 1800, followUpEnabled: true })
  }

  useRegisterDevControls(
    'safety',
    <DemoControlsGroup label="Safety & handoff">
      <Button variant="outline" size="sm" onClick={loadSampleSettings}>
        Load sample safety settings
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
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
      <label className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => setForceSaveFailure(e.target.checked)} />
        Force save failure
      </label>
    </DemoControlsGroup>,
  )

  const hasMultipleLanguages = state.personalization.additionalLanguages.length > 0 || state.demo.simulateMultipleLanguages

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
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

      <div className={cn('space-y-10', loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
        {/* Section 1: What the agent avoids */}
        <section className="space-y-4">
          <div>
            <h3>What the agent avoids</h3>
            <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Two ways to guide the agent away from things it should not say or discuss.
            </p>
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

          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Both of these become instructions the agent follows. They guide it strongly, but they
            are instructions, not a filter that blocks a message after it is written.
          </p>
        </section>

        {/* Section 2: When a person takes over */}
        <section className="space-y-4">
          <h3>When a person takes over</h3>

          <div className="space-y-3 rounded-lg bg-muted p-4">
            <p style={{ fontSize: 'var(--text-sm)' }}>
              <span style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>This happens automatically.</span>{' '}
              Your agent hands the conversation to a person on its own, when it is unsure, when
              something seems wrong, or when the customer asks for one. You cannot turn this off
              from here. What you can control below is what the agent says at that moment.
            </p>
            <p style={{ fontSize: 'var(--text-sm)' }}>
              Want more control over exactly when this happens? You can add specific rules for
              your business.
            </p>
            <Button size="sm" variant="outline" onClick={customiseHandoffRules}>
              Customise handoff rules
            </Button>
          </div>

          <div className="space-y-2">
            <Label>What the agent says when it hands over</Label>
            <RadioGroup
              value={state.guardrails.handoffMessageEnabled ? 'custom' : 'standard'}
              onValueChange={(v) => patch('guardrails', { handoffMessageEnabled: v === 'custom' })}
            >
              <label className="flex items-start gap-2">
                <RadioGroupItem value="standard" id="handoff-standard" className="mt-0.5" disabled={loading} />
                <span>
                  <span style={{ fontSize: 'var(--text-sm)' }}>Meta&rsquo;s standard message</span>
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    A ready-made message, shown in the customer&rsquo;s own language automatically.
                  </p>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <RadioGroupItem value="custom" id="handoff-custom" className="mt-0.5" disabled={loading} />
                <span style={{ fontSize: 'var(--text-sm)' }}>Write my own message</span>
              </label>
            </RadioGroup>

            {state.guardrails.handoffMessageEnabled && (
              <div className="ml-6 space-y-1.5">
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
                  <p className="flex items-start gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    Your agent replies in more than one language, but this message is sent exactly
                    as written, in this one language, no matter which language the customer was
                    using. Meta&rsquo;s standard message adjusts to the customer&rsquo;s language
                    automatically. If most of your customers write in a language other than the
                    one you type here, the standard message may serve them better.
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Once a conversation is handed over, your team picks it up from your usual inbox. That
            part is not set up in this wizard.
          </p>
        </section>

        {/* Section 3: Following up with quiet customers */}
        <section className="space-y-4">
          <div>
            <h3>Following up with quiet customers</h3>
            <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              If a customer goes quiet mid-conversation, the agent can send one message to check
              back in.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Follow up after</Label>
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
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              Most businesses that use this choose 30 minutes to 1 hour. Shorter can feel pushy,
              longer may be too late to be useful.
            </p>
          </div>

          {state.replies.followUpInterval !== 0 && (
            <>
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Follow-up messages are charged the same way as any other message the agent sends.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="followup-message">What the agent sends</Label>
                <Textarea
                  id="followup-message"
                  rows={2}
                  maxLength={MAX_FOLLOWUP_MESSAGE}
                  value={state.replies.followUpMessage}
                  onChange={(e) => patch('replies', { followUpMessage: e.target.value })}
                  className="bg-input-background shadow-sm"
                  disabled={loading}
                />
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Kept short and low pressure works best for a check-in message.
                </p>
              </div>
            </>
          )}
        </section>
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
      <Label>Specific words or phrases</Label>
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        The agent is instructed never to use these. This does not depend on capital letters, so
        adding &ldquo;cheap&rdquo; also covers &ldquo;Cheap&rdquo; and &ldquo;CHEAP&rdquo;.
      </p>
      <TagInput
        values={values}
        onChange={handleChange}
        placeholder="Type a word or phrase and press Enter"
        aria-label="Specific words or phrases"
      />
      {duplicateError && <InlineError message={duplicateError} />}
      {suggestion && suggestion.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2">
          <p style={{ fontSize: 'var(--text-xs)' }}>Also add: {suggestion.join(', ')}?</p>
          <button type="button" onClick={addBoth} className="text-primary" style={{ fontSize: 'var(--text-xs)' }}>
            Add both
          </button>
          <button type="button" onClick={() => setSuggestion(null)} className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Dismiss
          </button>
        </div>
      )}
      {values.length === 0 && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          No words added. The agent has no specific words it has been told to avoid.
        </p>
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
      <Label>Topics to avoid</Label>
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        Broader than a specific word. The agent reads each topic and uses its judgement about what
        counts, so it is not exact the way words above are.
      </p>
      {values.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          No topics added.
        </p>
      ) : (
        <div className="space-y-2">
          {values.map((topic, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                maxLength={MAX_TOPIC_LENGTH}
                value={topic}
                onChange={(e) => updateRow(i, e.target.value)}
                placeholder="e.g. Comparing us to specific competitors"
                disabled={disabled}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="shrink-0 text-muted-foreground"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Remove
              </button>
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
