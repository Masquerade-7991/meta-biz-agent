import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
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
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import {
  BUSINESS_CATEGORY_OPTIONS,
  CATEGORY_SUGGESTIONS,
  SIGNAL_LIBRARY,
  composeSentence,
  looksLikeInstruction,
  type SignalId,
} from '@/app/wizard/mockData'

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

export function AgentIdentityStep() {
  const { state, patch } = useWizard()
  const { identity } = state
  const [pendingApply, setPendingApply] = useState<{ text: string; fromDocument: boolean } | null>(null)
  const [showOtherExamples, setShowOtherExamples] = useState(false)
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

  const category = demoCategory !== 'No category' && CATEGORY_SUGGESTIONS[demoCategory] ? demoCategory : null

  useRegisterDevControls(
    'identity',
    <DemoControlsGroup label="Identity">
      <label htmlFor="demo-business-category" className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        Business category
      </label>
      <select
        id="demo-business-category"
        value={demoCategory}
        onChange={(e) => {
          patch('demo', { businessCategory: e.target.value })
          setShowOtherExamples(false)
        }}
        className="rounded border border-border bg-background"
        style={{ fontSize: 'var(--text-xs)' }}
      >
        {BUSINESS_CATEGORY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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
    <div className="space-y-8">
      <div className="max-w-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="agent-name">Agent name</Label>
            <InfoTooltip text="This is only for you. Customers never see it." />
          </span>
          {identity.agentName.length > 50 && (
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
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
          <p className="flex items-center gap-1 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
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

        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          {category ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleCategorySuggestion}>
                Suggest for {category}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowOtherExamples((v) => !v)}>
                Show other examples
              </Button>
            </>
          ) : (
            ROLE_EXAMPLES.map((example) => (
              <Button
                key={example.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => requestApplyText(example.text)}
              >
                {example.label}
              </Button>
            ))
          )}

          <div className="space-y-1">
            <Button type="button" variant="outline" size="sm" onClick={handleDocumentButtonClick} disabled={docStatus === 'reading'}>
              <FileText className="size-3.5" />
              Draft from a document
            </Button>
            {docStatus === 'reading' ? (
              <span className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                <Loader2 className="size-3.5 animate-spin" /> Reading your document&hellip;
              </span>
            ) : (
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Reads a document and suggests a starting point below
              </p>
            )}
          </div>
        </div>

        {category && showOtherExamples && (
          <div className="flex flex-wrap gap-2">
            {ROLE_EXAMPLES.map((example) => (
              <Button
                key={example.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => requestApplyText(example.text)}
              >
                {example.label}
              </Button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_DOC_EXTENSIONS.join(',')}
          className="hidden"
          onChange={handleFileChange}
        />

        {docNotice && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning bg-warning/10 p-2.5 text-warning-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {docNotice}
          </p>
        )}

        <div className="space-y-1.5">
          {isDraftFromDocument && (
            <p className="text-primary" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>
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
              <p className="flex items-center gap-1 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
                <AlertCircle className="size-3.5" /> {roleError}
              </p>
            ) : (
              <span />
            )}
            {identity.agentRole.length > 200 && (
              <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                {identity.agentRole.length}/{MAX_ROLE}
              </span>
            )}
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
