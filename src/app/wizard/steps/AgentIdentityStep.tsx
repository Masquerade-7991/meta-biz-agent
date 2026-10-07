import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, ChevronDown, FileText, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { assistWrite } from '@/app/api/assist'
import { errorDetail } from '@/app/api/meta'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { getNumber } from '@/app/api/numbers'
import { isDummyMode } from '@/app/api/dummy'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Button } from '@/app/components/ui/button'
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
import { SaveButton } from '@/app/components/wizard/SaveButton'
import { LoadFailedBanner, LoadingIndicator, SaveFailedBanner, SavingIndicator } from '@/app/components/wizard/RetryBanner'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useSaveOnNextSection } from '@/app/wizard/useSaveOnNextSection'
import {
  BUSINESS_CATEGORY_OPTIONS,
  CATEGORY_SUGGESTIONS,
  CATEGORY_FROM_VERTICAL,
  SIGNAL_LIBRARY,
  composeSentence,
  looksLikeInstruction,
  type SignalId,
} from '@/app/wizard/mockData'
import { cn } from '@/app/lib/utils'
import { PersonalitySection } from './PersonalitySection'

const MAX_NAME = 60
const MAX_ROLE = 250

const ROLE_EXAMPLES = [
  {
    label: 'Retail example',
    text: 'Helps customers browse products, check stock, track orders, and start a return or exchange.',
  },
  {
    label: 'Services example',
    text: 'Helps customers book appointments, check availability, and answer questions about our services and pricing.',
  },
  {
    label: 'Just show me a starting point',
    text: 'Helps customers with common questions about our business, and points them to a human for anything more complex.',
  },
]

const ACCEPTED_DOC_EXTENSIONS = ['.txt', '.pdf', '.docx']
const MAX_DOC_BYTES = 5 * 1024 * 1024

const DOCUMENT_NOTE = `We will read this document and look for things your agent could help with, like order tracking or booking appointments. This only fills the box below, it does not give your agent access to the document. To let your agent actually use a document as a reference, add it in the Knowledge step instead.`

const NO_SIGNALS_MESSAGE = 'We could not find enough in this document to suggest a description. Try writing it yourself, or use one of the example buttons above.'

function trimToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text
  const truncated = text.slice(0, limit)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim()
}

function pickRandomSignals(): SignalId[] {
  const ids = Object.keys(SIGNAL_LIBRARY) as SignalId[]
  const count = Math.random() < 0.5 ? 2 : 3
  const pool = [...ids]
  const picked: SignalId[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(index, 1)[0])
  }
  return picked
}

type TabId = 'about' | 'personality'

// Identity is who the agent is: About (name and role) and Personality (tone, languages, length).
// Both tabs stay mounted (hidden with CSS) so each keeps its own save state and nav guard.
export function AgentIdentityStep() {
  const { state, setPendingStepFocus } = useWizard()
  const [tab, setTab] = useState<TabId>('about')
  const [saveSlot, setSaveSlot] = useState<HTMLDivElement | null>(null)

  // Arriving from an Overview link that named the Personality tab.
  useEffect(() => {
    if (state.pendingStepFocus?.step === 'agent' && state.pendingStepFocus.tab === 'personality') {
      setTab('personality')
      setPendingStepFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingStepFocus])

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
      <TabsList actions={<div ref={setSaveSlot} className="flex" />}>
        <TabsTrigger value="about">About</TabsTrigger>
        <TabsTrigger value="personality">Personality</TabsTrigger>
      </TabsList>
      <TabsContent value="about" forceMount className="data-[state=inactive]:hidden">
        <AboutSection saveSlot={tab === 'about' ? saveSlot : null} />
      </TabsContent>
      <TabsContent value="personality" forceMount className="data-[state=inactive]:hidden">
        <PersonalitySection saveSlot={tab === 'personality' ? saveSlot : null} />
      </TabsContent>
    </Tabs>
  )
}

function AboutSection({ saveSlot }: { saveSlot?: HTMLElement | null } = {}) {
  const { state, patch } = useWizard()
  const { identity } = state
  const section = useSaveOnNextSection('identity')
  const [pendingApply, setPendingApply] = useState<{ text: string; fromDocument: boolean } | null>(null)
  const demoCategory = state.demo.businessCategory
  const [noteOpen, setNoteOpen] = useState(false)
  const [docStatus, setDocStatus] = useState<'idle' | 'reading'>('idle')
  const [docNotice, setDocNotice] = useState<string | null>(null)
  const [isDraftFromDocument, setIsDraftFromDocument] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nameError = looksLikeInstruction(identity.agentName)
    ? 'This looks like an instruction rather than a name. Rephrase it as a plain agent name.'
    : null

  const roleError = looksLikeInstruction(identity.agentRole)
    ? 'This looks like an instruction rather than a description. Rephrase it in plain language.'
    : null

  // The business's own category, from its WhatsApp profile; Demo controls can override it in demo mode.
  const [profileCategory, setProfileCategory] = useState<string | null>(null)
  useEffect(() => {
    const id = state.gate.selectedPhoneNumberId
    if (!id) return
    getNumber(id).then((n) => setProfileCategory(CATEGORY_FROM_VERTICAL[n.profile.vertical] ?? null), () => {})
  }, [state.gate.selectedPhoneNumberId])
  const demoPick = isDummyMode() && demoCategory !== 'No category' && CATEGORY_SUGGESTIONS[demoCategory] ? demoCategory : null
  const category = demoPick ?? profileCategory

  useRegisterDevControls(
    'identity',
    <DemoControlsGroup label="Identity">
      <label htmlFor="demo-business-category" className="text-muted-foreground text-xs">
        Business category
      </label>
      <select
        id="demo-business-category"
        value={demoCategory}
        onChange={(e) => {
          patch('demo', { businessCategory: e.target.value })
        }}
        className="rounded border border-border bg-background text-xs"
      >
        {BUSINESS_CATEGORY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" onClick={section.simulateLoadFailure}>
        Force load failure
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <input
          type="checkbox"
          checked={section.forceSaveFailure}
          onChange={(e) => section.setForceSaveFailure(e.target.checked)}
        />
        Force save failure
      </label>
    </DemoControlsGroup>,
  )

  function applyText(text: string, fromDocument: boolean) {
    patch('identity', { agentRole: trimToLimit(text, MAX_ROLE) })
    setIsDraftFromDocument(fromDocument)
  }

  function requestApplyText(text: string, fromDocument = false) {
    setDocNotice(null)
    if (identity.agentRole.trim().length > 0 && identity.agentRole.trim() !== text.trim()) {
      setPendingApply({ text, fromDocument })
    } else {
      applyText(text, fromDocument)
    }
  }

  function handleRoleTextareaChange(value: string) {
    patch('identity', { agentRole: value })
    setIsDraftFromDocument(false)
  }

  const [aiBusy, setAiBusy] = useState(false)
  /** Claude drafts the description from the business details, or tidies what's there. */
  async function writeWithAi(task: 'draft_role' | 'improve') {
    setAiBusy(true)
    try {
      const { text } = await assistWrite(task, identity.agentRole, {
        agentName: identity.agentName,
        business: state.business.businessDescription,
        category: category ?? undefined,
      })
      requestApplyText(text)
    } catch (err) {
      toast.error('Couldn’t write that', { description: errorDetail(err) })
    } finally {
      setAiBusy(false)
    }
  }

  function handleCategorySuggestion() {
    if (!category) return
    requestApplyText(composeSentence(CATEGORY_SUGGESTIONS[category]))
  }

  function handleDocumentButtonClick() {
    setDocNotice(null)
    setNoteOpen(true)
  }

  function confirmNoteAndOpenPicker() {
    setNoteOpen(false)
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`
    if (!ACCEPTED_DOC_EXTENSIONS.includes(extension)) {
      toast.error('Use a .txt, .pdf, or .docx file.')
      return
    }
    if (file.size > MAX_DOC_BYTES) {
      toast.error('This file is too large. Please choose a smaller document, under 5MB.')
      return
    }

    setDocStatus('reading')
    setDocNotice(null)
    setTimeout(() => {
      setDocStatus('idle')
      if (file.name.toLowerCase().includes('test')) {
        setDocNotice(NO_SIGNALS_MESSAGE)
        return
      }
      const signals = pickRandomSignals()
      requestApplyText(composeSentence(signals), true)
    }, 1300)
  }

  return (
    <div className="space-y-6">
      {/* In the tab row when this tab is showing (Identity), otherwise above the form. */}
      {saveSlot === undefined ? (
        <div className="flex items-center justify-end">
          <SaveButton dirty={section.dirty} saving={section.saveStatus === 'saving'} onSave={section.performSave} onDiscard={section.discard} />
        </div>
      ) : (
        saveSlot && createPortal(<SaveButton dirty={section.dirty} saving={section.saveStatus === 'saving'} onSave={section.performSave} onDiscard={section.discard} />, saveSlot)
      )}

      {section.loadStatus === 'failed' && (
        <LoadFailedBanner
          message="We could not load your saved choices. Anything you save now will replace them."
          onRetry={section.retryLoad}
        />
      )}
      {section.saveStatus === 'failed' && (
        <SaveFailedBanner message="We could not save your changes. Nothing has been lost." onRetry={() => void section.performSave()} />
      )}
      {section.saveStatus === 'saving' && <SavingIndicator />}
      {section.loading && <LoadingIndicator label="Loading your saved choices" />}

    <div className={cn('space-y-8', section.loading && 'pointer-events-none opacity-50')} aria-hidden={section.loading}>
      <div className="max-w-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="agent-name">Agent name</Label>
            <InfoTooltip text="This is only for you. Customers never see it." />
          </span>
          {identity.agentName.length > 50 && (
            <span className="text-muted-foreground text-xs">
              {identity.agentName.length}/{MAX_NAME}
            </span>
          )}
        </div>
        <Input
          id="agent-name"
          value={identity.agentName}
          maxLength={MAX_NAME}
          aria-invalid={Boolean(nameError)}
          onChange={(e) => patch('identity', { agentName: e.target.value })}
          placeholder="e.g. Aria"
        />
        {nameError && (
          <p className="flex items-center gap-1 text-destructive text-xs">
            <AlertCircle className="size-3.5" /> {nameError}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <h4 id="agent-role-label">What does this agent do for customers?</h4>
            <InfoTooltip text="Describe what your agent helps customers with. This shapes how it behaves in every conversation, so take a moment to get it right. Write this as a description of what your agent does, not as instructions to it. Keep it in plain English and avoid technical terms." />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={docStatus === 'reading'}>
                <Sparkles className="size-3.5" />
                Need ideas?
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem onSelect={() => void writeWithAi('draft_role')}>
                <Wand2 className="size-4" />
                Write it for me
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void writeWithAi('improve')} disabled={!identity.agentRole.trim()}>
                <Sparkles className="size-4" />
                Improve my wording
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {category && (
                <>
                  <DropdownMenuItem onSelect={handleCategorySuggestion}>Suggest for {category.toLowerCase()} businesses</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Start from an example</DropdownMenuLabel>
              {ROLE_EXAMPLES.map((example) => (
                <DropdownMenuItem key={example.label} onSelect={() => requestApplyText(example.text)}>
                  {example.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleDocumentButtonClick}>
                <FileText className="size-4" />
                Draft from a document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {aiBusy && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Writing&hellip;
            </span>
          )}
          {docStatus === 'reading' && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reading your document&hellip;
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_DOC_EXTENSIONS.join(',')}
          className="hidden"
          onChange={handleFileChange}
        />

        {docNotice && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning bg-warning/10 p-2.5 text-warning-foreground text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {docNotice}
          </p>
        )}

        <div className="space-y-1.5">
          {isDraftFromDocument && (
            <p className="text-primary text-xs font-medium">
              Suggested from your document, please review and edit
            </p>
          )}
          <Textarea
            id="agent-role"
            rows={5}
            maxLength={MAX_ROLE}
            value={identity.agentRole}
            aria-invalid={Boolean(roleError)}
            aria-labelledby="agent-role-label"
            onChange={(e) => handleRoleTextareaChange(e.target.value)}
            placeholder="e.g. Helps customers track orders, browse products, and start a return"
            className="resize-none bg-input-background text-base shadow-sm"
          />
          <div className="flex items-center justify-between">
            {roleError ? (
              <p className="flex items-center gap-1 text-destructive text-xs">
                <AlertCircle className="size-3.5" /> {roleError}
              </p>
            ) : (
              <span />
            )}
            {identity.agentRole.length > 200 && (
              <span className="text-muted-foreground text-xs">
                {identity.agentRole.length}/{MAX_ROLE}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>

      {/* Document upload explanation note */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft from a document</DialogTitle>
            <DialogDescription>{DOCUMENT_NOTE}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmNoteAndOpenPicker}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm before overwriting existing text — applies to every suggestion source */}
      <Dialog open={pendingApply !== null} onOpenChange={(open) => !open && setPendingApply(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your text?</DialogTitle>
            <DialogDescription>This will replace what you have written. Continue?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingApply(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingApply) applyText(pendingApply.text, pendingApply.fromDocument)
                setPendingApply(null)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
