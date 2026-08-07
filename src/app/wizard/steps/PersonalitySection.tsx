import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Switch } from '@/app/components/ui/switch'
import { Button } from '@/app/components/ui/button'
import { Separator } from '@/app/components/ui/separator'
import { SegmentedControl } from '@/app/components/wizard/SegmentedControl'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { LoadFailedBanner, LoadingIndicator, SaveFailedBanner, SavingIndicator } from '@/app/components/wizard/RetryBanner'
import { UnsavedChangesDialog } from '@/app/components/wizard/UnsavedChangesDialog'
import { LanguageMultiSelect, LanguageSelect } from '@/app/components/wizard/LanguageCombobox'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useSaveOnNextSection } from '@/app/wizard/useSaveOnNextSection'
import { LANGUAGE_OPTIONS, TONE_PRESETS } from '@/app/wizard/mockData'
import type { AnswerLength, EmojiUse, PersonalizationState, ToneId } from '@/app/wizard/types'
import { useState } from 'react'
import { cn } from '@/app/lib/utils'

const MAX_CUSTOM_TONE = 250

const ANSWER_LENGTHS: { id: AnswerLength; label: string }[] = [
  { id: 'concise', label: 'Concise' },
  { id: 'standard', label: 'Standard' },
  { id: 'detailed', label: 'Detailed' },
]

const EMOJI_OPTIONS: { id: EmojiUse; label: string }[] = [
  { id: 'never', label: 'Never' },
  { id: 'sparingly', label: 'Sparingly' },
  { id: 'freely', label: 'Freely' },
]

// Layer 1 ("easy controls") is what this section's save/dirty-tracking cares about. Layer 2's
// custom skills (a separate tab) save independently and must never affect this unsaved-changes check.
type Layer1 = Pick<
  PersonalizationState,
  | 'tone'
  | 'customToneInstructions'
  | 'emojiUse'
  | 'nameIntroduction'
  | 'answerLength'
  | 'defaultLanguage'
  | 'additionalLanguages'
  | 'matchCustomerLanguage'
  | 'allowMixedLanguage'
>
function pickLayer1(p: PersonalizationState): Layer1 {
  const {
    tone,
    customToneInstructions,
    emojiUse,
    nameIntroduction,
    answerLength,
    defaultLanguage,
    additionalLanguages,
    matchCustomerLanguage,
    allowMixedLanguage,
  } = p
  return { tone, customToneInstructions, emojiUse, nameIntroduction, answerLength, defaultLanguage, additionalLanguages, matchCustomerLanguage, allowMixedLanguage }
}

export function PersonalitySection() {
  const { state, patch } = useWizard()
  const { personalization } = state
  const agentName = state.identity.agentName.trim() || 'your agent'

  const section = useSaveOnNextSection('personalization', {
    isDirty: (saved, current) => JSON.stringify(pickLayer1(saved)) !== JSON.stringify(pickLayer1(current)),
    beforeSave: (current) => {
      if (current.tone === 'custom' && !current.customToneInstructions.trim()) {
        patch('personalization', { tone: 'professional' })
      }
    },
  })

  useRegisterDevControls(
    'personality',
    <DemoControlsGroup label="Personality">
      <Button variant="outline" size="sm" onClick={section.simulateLoadFailure}>
        Force load failure
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        <input
          type="checkbox"
          checked={section.forceSaveFailure}
          onChange={(e) => section.setForceSaveFailure(e.target.checked)}
        />
        Force save failure
      </label>
    </DemoControlsGroup>,
  )

  const [alreadyDefaultNote, setAlreadyDefaultNote] = useState(false)

  function toggleAdditionalLanguage(lang: string) {
    if (lang === personalization.defaultLanguage) {
      setAlreadyDefaultNote(true)
      setTimeout(() => setAlreadyDefaultNote(false), 2500)
      return
    }
    const has = personalization.additionalLanguages.includes(lang)
    patch('personalization', {
      additionalLanguages: has
        ? personalization.additionalLanguages.filter((l) => l !== lang)
        : [...personalization.additionalLanguages, lang],
    })
  }

  function changeDefaultLanguage(lang: string) {
    patch('personalization', {
      defaultLanguage: lang,
      additionalLanguages: personalization.additionalLanguages.filter((l) => l !== lang),
    })
  }

  const showCustomFallbackNote = personalization.tone === 'custom' && !personalization.customToneInstructions.trim()
  const matchingOff = !personalization.matchCustomerLanguage

  return (
    <div className="space-y-6">
      {section.loadStatus === 'failed' && (
        <LoadFailedBanner
          message="We could not load your saved choices. Anything you save now will replace them."
          onRetry={section.retryLoad}
        />
      )}
      {section.saveStatus === 'failed' && (
        <SaveFailedBanner message="We could not save your choices. Nothing has been lost." onRetry={() => void section.performSave()} />
      )}
      {section.saveStatus === 'saving' && <SavingIndicator />}
      {section.loading && <LoadingIndicator label="Loading your saved choices" />}

      <div className={cn('space-y-6', section.loading && 'pointer-events-none opacity-50')} aria-hidden={section.loading}>
        <div className="space-y-3">
          <Label>Tone</Label>
          <div className="grid grid-cols-2 gap-3">
            {TONE_PRESETS.map((preset) => {
              const active = personalization.tone === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => patch('personalization', { tone: preset.id as ToneId })}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-colors',
                    active ? 'border-primary bg-accent' : 'border-border hover:border-primary/50',
                  )}
                >
                  <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{preset.label}</p>
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    {preset.description}
                  </p>
                  {preset.id === 'custom' && showCustomFallbackNote && (
                    <p className="mt-1 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      No custom tone written yet, so the standard professional tone is used.
                    </p>
                  )}
                </button>
              )
            })}
          </div>

          {personalization.tone === 'custom' && (
            <div className="space-y-1.5">
              <Textarea
                id="custom-tone"
                rows={3}
                maxLength={MAX_CUSTOM_TONE}
                value={personalization.customToneInstructions}
                onChange={(e) => patch('personalization', { customToneInstructions: e.target.value })}
                placeholder="e.g. Friendly and reassuring, like a helpful neighbour. Patient with confused customers."
                className="bg-input-background shadow-sm"
              />
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Describe how the agent should sound, not instructions to it. Keep it in plain English.
                </p>
                {personalization.customToneInstructions.length > 200 && (
                  <span className="shrink-0 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    {personalization.customToneInstructions.length}/{MAX_CUSTOM_TONE}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label>Emoji use</Label>
              <SegmentedControl options={EMOJI_OPTIONS} value={personalization.emojiUse} onChange={(id) => patch('personalization', { emojiUse: id })} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={personalization.nameIntroduction}
                onChange={(e) => patch('personalization', { nameIntroduction: e.target.checked })}
              />
              <span style={{ fontSize: 'var(--text-sm)' }}>
                Agent introduces itself as &ldquo;{agentName}&rdquo; when conversations start
              </span>
            </label>
          </div>

          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Words the agent must never use are set in step 4, Safety &amp; handoff.
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Answer length</Label>
          <SegmentedControl options={ANSWER_LENGTHS} value={personalization.answerLength} onChange={(id) => patch('personalization', { answerLength: id })} />
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Longer answers cost slightly more per message, since Meta charges by the amount of text generated.
          </p>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Detailed suits complex products. For most businesses, Concise or Standard reads best on WhatsApp.
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Default language</Label>
            <LanguageSelect options={LANGUAGE_OPTIONS} value={personalization.defaultLanguage} onChange={changeDefaultLanguage} />
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              The language the agent uses unless a customer writes in another configured language.
            </p>
          </div>

          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="match-language">Match customer&rsquo;s language automatically</Label>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Only applies within the languages configured above, not any language the model could theoretically
                  produce.
                </p>
              </div>
              <Switch
                id="match-language"
                checked={personalization.matchCustomerLanguage}
                onCheckedChange={(checked) => patch('personalization', { matchCustomerLanguage: checked })}
              />
            </div>

            <div className="space-y-3 border-l-2 border-border pl-4">
              <div className="space-y-1.5">
                <Label className={cn(matchingOff && 'text-muted-foreground')}>Additional languages</Label>
                <LanguageMultiSelect
                  options={LANGUAGE_OPTIONS}
                  selected={personalization.additionalLanguages}
                  onToggle={toggleAdditionalLanguage}
                  disabled={matchingOff}
                />
                {alreadyDefaultNote && (
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    Already your default language.
                  </p>
                )}
              </div>

              <label className={cn('flex items-center gap-2', matchingOff ? 'text-muted-foreground' : 'cursor-pointer')}>
                <input
                  type="checkbox"
                  disabled={matchingOff}
                  checked={personalization.allowMixedLanguage}
                  onChange={(e) => patch('personalization', { allowMixedLanguage: e.target.checked })}
                />
                <span style={{ fontSize: 'var(--text-sm)' }}>Allow natural mixed-language replies (e.g. Hinglish)</span>
              </label>

              {matchingOff && (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Switch on language matching to use additional languages.
                </p>
              )}
            </div>
          </div>

          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            You can test your agent in each language before going live, in step 5.
          </p>
        </div>
      </div>

      <UnsavedChangesDialog open={section.unsavedDialogOpen} onResolve={section.resolveUnsaved} />
    </div>
  )
}
