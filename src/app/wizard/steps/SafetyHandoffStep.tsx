import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Button } from '@/app/components/ui/button'
import { Switch } from '@/app/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { TagInput } from '@/app/components/wizard/TagInput'
import { UnsavedChangesDialog } from '@/app/components/wizard/UnsavedChangesDialog'
import { InlineError, SaveFailedBanner } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
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
import type { FollowUpInterval, GuardrailsState } from '@/app/wizard/types'
import { pathFor } from '@/app/nav'
import { toast } from 'sonner'
import { pushSlice } from '@/app/api/meta'

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

// One saved object spread over two slices (guardrails + replies): fields patch the store as they
// change, and this snapshot decides what's unsaved, what Save sends and what Discard puts back.
interface SafetySnapshot {
  groundingMode: GuardrailsState['groundingMode']
  neverSayPhrases: string[]
  topicsToAvoid: string[]
  handoffMessage: string
  handoffMessageSource: HandoffSource
  followUpInterval: FollowUpInterval
  followUpMessage: string
  followUpMessageSource: 'default' | 'custom'
}

const HANDOFF_OPTIONS: { value: HandoffSource; label: string }[] = [
  { value: 'default', label: 'Meta’s standard message (in the customer’s language)' },
  { value: 'agent', label: 'Let the agent write it, to fit the chat' },
  { value: 'custom', label: 'My own message' },
]

export function SafetyHandoffStep() {
  const { state, patch, setSection, setPendingSkillPrefill } = useWizard()
  const navigate = useNavigate()

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
      handoffMessage: state.guardrails.handoffMessage,
      handoffMessageSource: handoffSource,
      followUpInterval: state.replies.followUpInterval,
      followUpMessage: state.replies.followUpMessage,
      followUpMessageSource: followUpSource,
    }
  }

  const currentRef = useRef(currentSnapshot())
  useEffect(() => {
    currentRef.current = currentSnapshot()
  })

  // The studio loads the agent from Meta before this opens, so what's on screen is what's saved.
  const [savedSnapshot, setSavedSnapshot] = useState<SafetySnapshot>(currentSnapshot)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [forceSaveFailure, setForceSaveFailure] = useState(false)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  const stateRef = useRef(state)
  stateRef.current = state

  async function performSave(): Promise<boolean> {
    // PRD V-b2b / AC-b4: a custom message can't be saved empty.
    const cur = currentRef.current
    if (cur.handoffMessageSource === 'custom' && !cur.handoffMessage.trim()) {
      toast.error('Write the handoff message, or pick another option.')
      return false
    }
    if (cur.followUpInterval !== 0 && cur.followUpMessageSource === 'custom' && !cur.followUpMessage.trim()) {
      toast.error('Write the follow-up message, or use Meta’s standard one.')
      return false
    }
    setSaveStatus('saving')
    try {
      if (forceSaveFailure) throw new Error('Forced failure (Demo controls)')
      await pushSlice('guardrails', stateRef.current)
    } catch (err) {
      setSaveStatus('failed')
      toast.error('Couldn’t save to Meta', { description: err instanceof Error ? err.message : String(err) })
      return false
    }
    setSaveStatus('idle')
    setSavedSnapshot(currentRef.current)
    return true
  }

  function discard() {
    const s = savedSnapshot
    patch('guardrails', {
      groundingMode: s.groundingMode,
      neverSayPhrases: s.neverSayPhrases,
      topicsToAvoid: s.topicsToAvoid,
      handoffMessage: s.handoffMessage,
      handoffMessageSource: s.handoffMessageSource,
      handoffMessageEnabled: s.handoffMessageSource === 'custom',
    })
    patch('replies', {
      followUpInterval: s.followUpInterval,
      followUpEnabled: s.followUpInterval !== 0,
      followUpMessage: s.followUpMessage,
      followUpMessageSource: s.followUpMessageSource,
    })
    setSaveStatus('idle')
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

  const isDirty = () => JSON.stringify(savedSnapshot) !== JSON.stringify(currentRef.current)
  async function guard(intent: NavIntent): Promise<boolean> {
    if (!isDirty()) return true
    if (intent === 'discard') return askUnsaved()
    return performSave()
  }

  useRegisterNavGuard(guard)
  const { runGuard } = useNavigationGuard()

  const dirty = JSON.stringify(savedSnapshot) !== JSON.stringify(currentSnapshot())
  useReportSaveStatus(dirty, saveStatus === 'saving')

  // Both links leave this page, so unsaved changes are saved first (same as the studio nav).
  async function leaveTo(go: () => void) {
    if (await runGuard('save')) go()
  }
  const customiseHandoffRules = () =>
    leaveTo(() => {
      setPendingSkillPrefill({ name: 'Handoff rules', instruction: HANDOFF_RULES_PREFILL })
      setSection('abilities')
    })

  useRegisterDevControls(
    'safety',
    <DemoControlsGroup label="Safety & handoff">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Fills the form only; still unsaved until Save, same as typing it by hand.
          patch('guardrails', {
            neverSayPhrases: SAMPLE_NEVER_SAY_WORDS,
            topicsToAvoid: SAMPLE_TOPICS_TO_AVOID,
            handoffMessageSource: 'custom',
            handoffMessageEnabled: true,
            handoffMessage: SAMPLE_CUSTOM_HANDOFF_MESSAGE,
          })
          patch('replies', { followUpInterval: 1800, followUpEnabled: true })
        }}
      >
        Load sample safety settings
      </Button>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={state.demo.simulateMultipleLanguages} onChange={(e) => patch('demo', { simulateMultipleLanguages: e.target.checked })} />
        Simulate multiple languages
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => setForceSaveFailure(e.target.checked)} />
        Force save failure
      </label>
    </DemoControlsGroup>,
  )

  const hasMultipleLanguages = state.personalization.additionalLanguages.length > 0 || state.demo.simulateMultipleLanguages
  const followUpOn = state.replies.followUpInterval !== 0

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">What your agent stays away from, what happens when your team takes over, and checking in on quiet customers.</p>
        <SaveButton dirty={dirty} saving={saveStatus === 'saving'} onSave={performSave} onDiscard={discard} />
      </div>
      {saveStatus === 'failed' && <SaveFailedBanner message="Your changes weren’t saved. Nothing has been lost." onRetry={() => void performSave()} />}

      <Section title="How your agent answers">
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectableCard
            title="Only from my knowledge"
            helper="Answers from what you’ve given it, and hands over when it doesn’t know."
            selected={state.guardrails.groundingMode === 'strict'}
            onClick={() => patch('guardrails', { groundingMode: 'strict' })}
          />
          <SelectableCard
            title="Can chat naturally"
            helper="Small talk and general help within its role, still based on your knowledge."
            selected={state.guardrails.groundingMode === 'assisted'}
            onClick={() => patch('guardrails', { groundingMode: 'assisted' })}
          />
        </div>
        <WordsToAvoidField values={state.guardrails.neverSayPhrases} onChange={(values) => patch('guardrails', { neverSayPhrases: values })} />
        <div className="space-y-1.5">
          <Label>Topics it stays away from</Label>
          <TagInput
            values={state.guardrails.topicsToAvoid}
            onChange={(values) => patch('guardrails', { topicsToAvoid: values.filter((v) => v.length <= MAX_TOPIC_LENGTH).slice(0, MAX_TOPICS) })}
            placeholder="e.g. Competitors’ prices, then press Enter"
            aria-label="Topics it stays away from"
          />
          <p className="text-xs text-muted-foreground">Broader than words: the agent politely declines anything on these topics.</p>
        </div>
      </Section>

      <Section title="Handing over to your team" description="The agent hands a chat to your team when it’s unsure, something seems wrong, or the customer asks for a person.">
        <div className="space-y-1.5">
          <Label htmlFor="handoff-source">What it says when it hands over</Label>
          <Select value={handoffSource} onValueChange={(v) => setHandoffSource(v as HandoffSource)}>
            <SelectTrigger id="handoff-source" className="w-full sm:max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HANDOFF_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {handoffSource === 'custom' && (
          <div className="space-y-1.5">
            <Textarea
              aria-label="Handoff message"
              rows={2}
              maxLength={MAX_CUSTOM_HANDOFF}
              value={state.guardrails.handoffMessage}
              onChange={(e) => patch('guardrails', { handoffMessage: e.target.value })}
              placeholder="e.g. Let me get someone from our team to help with this. They’ll be with you shortly."
            />
            {hasMultipleLanguages && (
              <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Sent exactly as written, in this one language. Meta’s standard message matches the customer’s language.
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => void leaveTo(() => navigate(pathFor('settings', 'support')))}>
            Who receives handed-over chats
          </button>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => void customiseHandoffRules()}>
            Add your own handoff rules
          </button>
        </div>
      </Section>

      <Section title="Following up with quiet customers">
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Check in when a customer goes quiet</span>
            <span className="block text-xs text-muted-foreground">One short message. It’s charged like any other message the agent sends.</span>
          </span>
          <Switch
            checked={followUpOn}
            onCheckedChange={(on) => patch('replies', { followUpInterval: on ? 1800 : 0, followUpEnabled: on })}
            aria-label="Check in when a customer goes quiet"
          />
        </label>
        {followUpOn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="followup-after">After</Label>
              <Select value={String(state.replies.followUpInterval)} onValueChange={(v) => patch('replies', { followUpInterval: Number(v) as FollowUpInterval, followUpEnabled: true })}>
                <SelectTrigger id="followup-after" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOLLOW_UP_INTERVALS.filter((o) => o.value !== 0).map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-source">Message</Label>
              <Select value={followUpSource} onValueChange={(v) => patch('replies', { followUpMessageSource: v as 'default' | 'custom' })}>
                <SelectTrigger id="followup-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Meta’s standard message</SelectItem>
                  <SelectItem value="custom">My own message</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {followUpSource === 'custom' && (
              <Textarea
                aria-label="Follow-up message"
                className="sm:col-span-2"
                rows={2}
                maxLength={MAX_FOLLOWUP_MESSAGE}
                value={state.replies.followUpMessage}
                onChange={(e) => patch('replies', { followUpMessage: e.target.value })}
                placeholder="e.g. Just checking in. Is there anything else I can help with?"
              />
            )}
          </div>
        )}
      </Section>

      <p className="flex items-start gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        Always on: the agent never claims to be human when asked, never shares one customer’s details with another, and never gives medical, legal or financial advice as fact.
      </p>

      <UnsavedChangesDialog open={unsavedDialogOpen} onResolve={resolveUnsaved} />
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-section font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
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
      <Label>Words it never says</Label>
      <TagInput values={values} onChange={handleChange} placeholder="e.g. cheap, then press Enter" aria-label="Words it never says" />
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
      {!duplicateError && !suggestion && <p className="text-xs text-muted-foreground">Capital letters don’t matter: “cheap” also covers “Cheap”.</p>}
    </div>
  )
}
