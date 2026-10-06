import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  GalleryHorizontal,
  GripVertical,
  Image as ImageIcon,
  Link2,
  List,
  Loader2,
  MapPin,
  MessageSquareReply,
  Navigation,
  Plus,
  X,
} from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Button } from '@/app/components/ui/button'
import { Switch } from '@/app/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import {
  CANNED_FLOWS,
  RICH_REPLY_TYPE_GALLERY,
  RICH_REPLY_TYPE_LABEL,
  SAMPLE_RICH_REPLIES,
  newCarouselCard,
  newId,
  newMenuOption,
} from '@/app/wizard/mockData'
import { RICH_REPLY_LIMITS, compileRichReplySentence, rowIdFromTitle, validateRichReply, type RichReplyIssue } from '@/app/wizard/richReplies'
import { normalizeForCompare } from '@/app/wizard/csv'
import type { CarouselCard, CustomSkill, ImageSource, InteractiveListBlanks, RichReply, RichReplyType } from '@/app/wizard/types'
import { createUiSkill, deleteUiSkill, errorText, updateUiSkill } from '@/app/api/meta'
import { cn } from '@/app/lib/utils'
import { WhatsAppPreview, type RichReplyDraft } from './WhatsAppPreview'

const MAX_NAME = 60
const MAX_TRIGGER = 300
const RICH_REPLY_COUNT_WARNING_THRESHOLD = 10
const MAX_LOCATION_NAME = 100
const MAX_LOCATION_ADDRESS = 300
const L = RICH_REPLY_LIMITS

const RICH_REPLY_TYPE_ICON: Record<RichReplyType, typeof Link2> = {
  cta_url: Link2,
  image: ImageIcon,
  interactive_list: List,
  carousel_url: GalleryHorizontal,
  carousel_quick_reply: MessageSquareReply,
  location: MapPin,
  location_request: Navigation,
  flow: ClipboardList,
  interactive_reply_buttons: MessageSquareReply,
}

// ---- Editor state: a draft (type + blanks + trigger) plus in-progress add/edit bookkeeping ----
type RichReplyEditorState = { mode: 'add' | 'edit'; replyId?: string; name: string } & RichReplyDraft

const emptySource = (): ImageSource => ({ kind: 'document', ref: '', label: '' })

function emptyBlanksForType(type: RichReplyType): RichReplyEditorState {
  const shared = { mode: 'add' as const, name: '', trigger: '' }
  switch (type) {
    case 'cta_url':
      return { ...shared, type, blanks: { messageText: '', buttonLabel: '', link: '' } }
    case 'image':
      return { ...shared, type, blanks: { image: emptySource(), caption: '' } }
    case 'interactive_list':
      return { ...shared, type, blanks: { messageText: '', menuButtonLabel: '', groupsEnabled: false, options: [newMenuOption()] } }
    case 'carousel_url':
      return { ...shared, type, blanks: { messageText: '', cards: [newCarouselCard(), newCarouselCard()] } }
    case 'carousel_quick_reply':
      return { ...shared, type, blanks: { messageText: '', cards: [newCarouselCard(), newCarouselCard()] } }
    case 'location':
      return { ...shared, type, blanks: { placeName: '', address: '', latitude: '', longitude: '' } }
    case 'location_request':
      return { ...shared, type, blanks: { messageText: '' } }
    case 'flow':
      return { ...shared, type, blanks: { flowName: CANNED_FLOWS[0] ?? null, messageText: '', buttonLabel: '' } }
    case 'interactive_reply_buttons':
      return { ...shared, type, blanks: { messageText: '', buttons: [''] } }
  }
}

function editorFromExisting(reply: RichReply): RichReplyEditorState {
  return { mode: 'edit', replyId: reply.id, name: reply.name, trigger: reply.trigger, type: reply.type, blanks: reply.blanks } as RichReplyEditorState
}

function findSimilarRichReplyTrigger(trigger: string, replies: RichReply[], excludeId?: string): RichReply | undefined {
  const norm = normalizeForCompare(trigger)
  if (!norm) return undefined
  return replies.find((r) => r.id !== excludeId && r.blanks !== null && normalizeForCompare(r.trigger) === norm)
}

function findSimilarSkillTrigger(trigger: string, skills: CustomSkill[]): CustomSkill | undefined {
  const norm = normalizeForCompare(trigger)
  if (!norm) return undefined
  return skills.find((s) => normalizeForCompare(s.instruction) === norm)
}

type RowWarning = { text: string; viewExistingId?: string }

function computeTriggerWarnings(trigger: string, replies: RichReply[], skills: CustomSkill[], excludeId?: string): RowWarning[] {
  const warnings: RowWarning[] = []
  const similarReply = findSimilarRichReplyTrigger(trigger, replies, excludeId)
  if (similarReply) {
    warnings.push({
      text: "Another rich reply has a very similar trigger. The agent may struggle to pick between them.",
      viewExistingId: similarReply.id,
    })
  }
  const similarSkill = findSimilarSkillTrigger(trigger, skills)
  if (similarSkill) {
    warnings.push({
      text: 'A custom skill above covers a similar situation. Having both may make the agent inconsistent.',
    })
  }
  return warnings
}

export function RichRepliesSection() {
  const { state, patch } = useWizard()
  const { richReplies } = state.richReplies
  const { customSkills } = state.personalization
  const replyCount = richReplies.length
  const forceSaveFailure = state.demo.richRepliesForceSaveFailure

  const [editor, setEditor] = useState<RichReplyEditorState | null>(null)
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [rowWarnings, setRowWarnings] = useState<Record<string, RowWarning[]>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [pendingRebuildId, setPendingRebuildId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function loadSampleRichReplies() {
    patch('richReplies', { richReplies: SAMPLE_RICH_REPLIES })
  }

  useRegisterDevControls(
    'richReplies',
    <DemoControlsGroup label="Rich replies">
      <label className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        <input
          type="checkbox"
          checked={forceSaveFailure}
          onChange={(e) => patch('demo', { richRepliesForceSaveFailure: e.target.checked })}
        />
        Force save failure
      </label>
      <Button variant="outline" size="sm" onClick={loadSampleRichReplies}>
        Load sample rich replies
      </Button>
    </DemoControlsGroup>,
  )

  function scrollToAndHighlight(id: string) {
    rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000)
  }

  function startAdd(type: RichReplyType) {
    setGalleryOpen(false)
    setEditor(emptyBlanksForType(type))
    setEditorError(null)
  }

  function startEdit(reply: RichReply) {
    if (!reply.blanks) return
    setEditor(editorFromExisting(reply))
    setEditorError(null)
  }

  function startRebuildAsForm(reply: RichReply) {
    setPendingRebuildId(null)
    const fresh = emptyBlanksForType(reply.type)
    setEditor({ ...fresh, name: reply.name, mode: 'edit', replyId: reply.id } as RichReplyEditorState)
    setEditorError(null)
  }

  async function saveEditor() {
    if (!editor || !editor.name.trim() || !editor.trigger.trim() || validateRichReply(editor).length) return
    const warnings = computeTriggerWarnings(editor.trigger, richReplies, customSkills, editor.replyId)
    const shouldFail = forceSaveFailure
    setEditorSaving(true)
    setEditorError(null)
    const sentence = compileRichReplySentence(editor)
    const isEdit = editor.mode === 'edit' && !!editor.replyId
    const id = isEdit ? editor.replyId! : newId('rr')
    const existing = richReplies.find((r) => r.id === id)
    const reply = {
      ...(existing ?? { id, enabled: true, createdAt: Date.now() }),
      type: editor.type,
      name: editor.name.trim(),
      trigger: editor.trigger.trim(),
      blanks: editor.blanks,
      instructionSentence: sentence,
    } as RichReply
    try {
      if (shouldFail) throw new Error('forced')
      if (existing?.metaId && existing.type === reply.type) {
        await updateUiSkill(existing.metaId, { title: reply.name, instruction: sentence }, reply)
      } else {
        // New, or rebuilt as a different type: Meta can't change a type in place, so replace it.
        reply.metaId = (await createUiSkill(reply)).id
        if (existing?.metaId) await deleteUiSkill(existing.metaId)
      }
    } catch (err) {
      setEditorError(shouldFail ? 'Could not save. Nothing was lost.' : `Could not save. Nothing was lost. (${errorText(err)})`)
      return
    } finally {
      setEditorSaving(false)
    }
    patch('richReplies', (prev) => ({
      richReplies: isEdit ? prev.richReplies.map((r) => (r.id === id ? reply : r)) : [reply, ...prev.richReplies],
    }))
    setRowWarnings((prev) => ({ ...prev, [id]: warnings }))
    setEditor(null)
  }

  async function toggleEnabled(reply: RichReply) {
    const shouldFail = forceSaveFailure
    try {
      if (shouldFail) throw new Error('forced')
      // Takes effect immediately on Meta (PRD AC-c21).
      if (reply.metaId) await updateUiSkill(reply.metaId, { status: reply.enabled ? 'disabled' : 'enabled' })
    } catch (err) {
      toast.error('Could not save. Nothing was lost.', shouldFail ? undefined : { description: errorText(err) })
      return
    }
    patch('richReplies', (prev) => ({
      richReplies: prev.richReplies.map((r) => (r.id === reply.id ? { ...r, enabled: !r.enabled } : r)),
    }))
    toast.success('Saved')
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    const shouldFail = forceSaveFailure
    const metaId = richReplies.find((r) => r.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (metaId) await deleteUiSkill(metaId)
    } catch {
      setDeleteError('Could not delete. The item is still here.')
      setPendingDeleteId(null)
      return
    }
    patch('richReplies', (prev) => ({ richReplies: prev.richReplies.filter((r) => r.id !== id) }))
    setRowWarnings((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setPendingDeleteId(null)
  }

  return (
    <div className="space-y-4">
      <span className="flex items-center gap-1.5">
        <h3>Rich replies</h3>
        <InfoTooltip text="Optional. Buttons, images, menus and more, sent instead of a plain text answer when they fit. Changes here take effect as soon as you save each one." />
      </span>

      {replyCount > 0 && replyCount >= RICH_REPLY_COUNT_WARNING_THRESHOLD && (
        <p className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          <AlertTriangle className="size-3.5 shrink-0" />
          Many rich replies with similar triggers can make the agent pick the wrong one. Fewer,
          clearly triggered ones work better.
        </p>
      )}

      {deleteError && <InlineError message={deleteError} onRetry={() => setDeleteError(null)} />}

      {replyCount === 0 ? (
        <div className="space-y-3 rounded-lg border border-border bg-accent p-4 text-center">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No rich replies yet. These make the agent&rsquo;s answers feel like a real WhatsApp
            business: a button to your website, a photo of a product, or a menu of choices. Add
            one to see how it works.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {richReplies.map((reply) => {
            const Icon = RICH_REPLY_TYPE_ICON[reply.type]
            const warnings = rowWarnings[reply.id]
            const isRaw = reply.blanks === null
            return (
              <div
                key={reply.id}
                ref={(el) => {
                  rowRefs.current[reply.id] = el
                }}
                className={cn('rounded-lg border border-border transition-colors', highlightId === reply.id && 'bg-accent')}
              >
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{reply.name}</p>
                      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        {RICH_REPLY_TYPE_LABEL[reply.type]}
                      </span>
                    </div>
                    <p className="truncate text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      {isRaw ? reply.instructionSentence : reply.trigger}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      {reply.enabled ? 'On' : 'Off'}
                    </span>
                    <Switch checked={reply.enabled} onCheckedChange={() => toggleEnabled(reply)} />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-1.5">
                  {isRaw ? (
                    <Button size="sm" variant="ghost" onClick={() => setPendingRebuildId(reply.id)}>
                      Edit
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => startEdit(reply)}>
                      Edit
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(reply.id)}>
                    Delete
                  </Button>
                </div>
                {warnings && warnings.length > 0 && (
                  <div className="space-y-1 border-t border-border bg-warning/10 px-3 py-2">
                    {warnings.map((w, i) => (
                      <p key={i} className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {w.text}
                        {w.viewExistingId && (
                          <button type="button" onClick={() => scrollToAndHighlight(w.viewExistingId!)} className="underline">
                            View existing
                          </button>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
        <Plus className="size-3.5" />
        Add a rich reply
      </Button>

      {galleryOpen && <RichReplyGalleryDialog onSelect={startAdd} onClose={() => setGalleryOpen(false)} />}

      {editor && (
        <RichReplyEditorDialog
          editor={editor}
          saving={editorSaving}
          error={editorError}
          businessAddress={state.business.businessAddress}
          onChange={setEditor}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this rich reply?"
        description="The agent will stop sending it immediately."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />

      <ConfirmDialog
        open={pendingRebuildId !== null}
        title="Edit this rich reply?"
        description="It was set up outside Helo.ai, so the form starts empty. Saving replaces its current setup."
        confirmLabel="Edit"
        onConfirm={() => {
          const reply = richReplies.find((r) => r.id === pendingRebuildId)
          if (reply) startRebuildAsForm(reply)
        }}
        onCancel={() => setPendingRebuildId(null)}
      />
    </div>
  )
}

// ==================================================================================
// TYPE GALLERY
// ==================================================================================

function RichReplyGalleryDialog({ onSelect, onClose }: { onSelect: (type: RichReplyType) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a rich reply</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto">
          {RICH_REPLY_TYPE_GALLERY.map((card) => {
            const Icon = RICH_REPLY_TYPE_ICON[card.type]
            return (
              <button
                key={card.type}
                type="button"
                onClick={() => onSelect(card.type)}
                className="space-y-2 rounded-lg border border-border p-3 text-left hover:bg-accent/40"
              >
                <div className="flex h-16 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-6 text-muted-foreground" />
                </div>
                <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{card.name}</p>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {card.description}
                </p>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}


// ==================================================================================
// EDITOR
// ==================================================================================

/** Which errors are visible: a field shows its issue once touched, or all at once after the user
 *  asks what's blocking Save. */
const FormContext = createContext<{ issue: (field: string) => string | undefined; touch: (field: string) => void }>({
  issue: () => undefined,
  touch: () => {},
})

function RichReplyEditorDialog({
  editor,
  saving,
  error,
  businessAddress,
  onChange,
  onSave,
  onClose,
}: {
  editor: RichReplyEditorState
  saving: boolean
  error: string | null
  businessAddress: string
  onChange: (editor: RichReplyEditorState) => void
  onSave: () => void
  onClose: () => void
}) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const issues: RichReplyIssue[] = [
    ...(editor.name.trim() ? [] : [{ field: 'name', message: 'Name is required.' }]),
    ...(editor.trigger.trim() ? [] : [{ field: 'trigger', message: 'Describe when the agent should send this.' }]),
    ...validateRichReply(editor),
  ]
  const canSave = issues.length === 0
  const form = {
    issue: (field: string) => (showAll || touched.has(field) ? issues.find((i) => i.field === field)?.message : undefined),
    touch: (field: string) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{RICH_REPLY_TYPE_LABEL[editor.type]}</DialogTitle>
        </DialogHeader>
        <FormContext.Provider value={form}>
          {/* items-start keeps the shorter column from stretching to the taller one's height. */}
          <div className="grid max-h-[75vh] items-start gap-6 overflow-y-auto pr-1 md:grid-cols-[minmax(0,1fr)_336px]">
            <div className="space-y-5">
              <div className="space-y-4">
                <TextField
                  field="name"
                  label="Name"
                  required
                  hint="Only for you, so you can find it in the list."
                  max={MAX_NAME}
                  value={editor.name}
                  onChange={(name) => onChange({ ...editor, name })}
                  placeholder="e.g. Product page button"
                />
                <TextField
                  field="trigger"
                  label="When should the agent send this?"
                  required
                  hint="Written for the agent. Describe the situation, and the agent decides in the moment whether it fits."
                  rows={2}
                  max={MAX_TRIGGER}
                  value={editor.trigger}
                  onChange={(trigger) => onChange({ ...editor, trigger })}
                  placeholder="e.g. When someone asks where they can buy online"
                />
              </div>
              <div className="border-t border-border pt-5">
                <RichReplyBlanksForm editor={editor} businessAddress={businessAddress} onChange={onChange} />
              </div>
              {error && <InlineError message={error} onRetry={onSave} />}
            </div>

            <div className="space-y-3 md:sticky md:top-0">
              <WhatsAppPreview draft={editor} />
              <details className="group rounded-lg border border-border">
                <summary
                  className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  Instruction the agent will read
                </summary>
                <p className="whitespace-pre-wrap wrap-break-word border-t border-border px-3 py-2 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {compileRichReplySentence(editor)}
                </p>
              </details>
            </div>
          </div>
        </FormContext.Provider>
        <DialogFooter className="items-center sm:justify-between">
          {canSave ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-left text-muted-foreground underline-offset-2 hover:underline"
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {issues.length === 1 ? '1 field needs attention before you can save' : `${issues.length} fields need attention before you can save`}
              {!showAll && '. Show them'}
            </button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={!canSave || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Field primitives ----

function FieldShell({
  htmlFor,
  label,
  required,
  hint,
  count,
  max,
  error,
  errorId,
  action,
  children,
}: {
  htmlFor?: string
  label: string
  required?: boolean
  hint?: string
  count?: number
  max?: number
  error?: string
  errorId?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Label htmlFor={htmlFor}>
            {label}
            {required && (
              <>
                <span className="text-destructive" aria-hidden>
                  *
                </span>
                <span className="sr-only">(required)</span>
              </>
            )}
          </Label>
          {hint && <InfoTooltip text={hint} />}
        </span>
        <span className="flex items-center gap-2">
          {max !== undefined && count !== undefined && (
            <span
              className={cn(
                'tabular-nums text-muted-foreground',
                count > max ? 'text-destructive' : count >= max * 0.9 && 'text-warning-foreground',
              )}
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {count}/{max}
            </span>
          )}
          {action}
        </span>
      </div>
      {children}
      {error && (
        <p id={errorId} className="text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function TextField({
  field,
  label,
  value,
  onChange,
  max,
  required,
  hint,
  placeholder,
  rows,
  inputMode,
  action,
}: {
  field: string
  label: string
  value: string
  onChange: (value: string) => void
  max?: number
  required?: boolean
  hint?: string
  placeholder?: string
  rows?: number
  inputMode?: 'url' | 'decimal'
  action?: ReactNode
}) {
  const { issue, touch } = useContext(FormContext)
  const id = useId()
  const err = issue(field)
  const common = {
    id,
    value,
    placeholder,
    maxLength: max,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': err ? `${id}-err` : undefined,
    onBlur: () => touch(field),
  }
  return (
    <FieldShell htmlFor={id} label={label} required={required} hint={hint} count={max ? value.length : undefined} max={max} error={err} errorId={`${id}-err`} action={action}>
      {rows ? (
        <Textarea rows={rows} {...common} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input inputMode={inputMode} {...common} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldShell>
  )
}

function OptionalGroup({ children }: { children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-dashed border-border px-3 pb-3 pt-1">
      <legend className="px-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        Optional
      </legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            o.value === value && 'bg-background text-foreground shadow-sm',
          )}
          style={{ fontSize: 'var(--text-xs)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Where an image (or header video) comes from: something the agent already has access to, or a
 *  plain https link. Never an upload (PRD Appendix C). */
function ImageSourcePicker({
  field,
  label,
  value,
  onChange,
  required,
  media = 'image',
}: {
  field: string
  label: string
  value: ImageSource
  onChange: (src: ImageSource) => void
  required?: boolean
  media?: 'image' | 'video'
}) {
  const { state, setSection } = useWizard()
  const { issue, touch } = useContext(FormContext)
  const id = useId()
  const listId = useId()
  const err = issue(field)
  const { documents, websites } = state.knowledge
  const tools = state.connections.actions
  const refOf = (x: { id: string; metaId?: string }) => x.metaId ?? x.id
  const pick = (next: ImageSource) => {
    onChange(next)
    touch(field)
  }
  const aria = { 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `${id}-err` : undefined }
  const empty = (text: string, section: 'knowledge' | 'connections', where: string) => (
    <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
      {text}{' '}
      <button type="button" className="text-primary underline underline-offset-2" onClick={() => setSection(section)}>
        Add one in {where}
      </button>
    </p>
  )
  const site = value.kind === 'website' ? websites.find((w) => refOf(w) === value.ref) : undefined

  return (
    <FieldShell htmlFor={value.kind === 'url' ? id : undefined} label={label} required={required} error={err} errorId={`${id}-err`}>
      <div className="space-y-2">
        <Segmented
          label={`Where the ${media} comes from`}
          value={value.kind}
          options={[
            { value: 'document', label: 'Knowledge document' },
            { value: 'website', label: 'Website page' },
            { value: 'connector', label: 'Connector tool' },
            { value: 'url', label: media === 'video' ? 'Video link' : 'Image link' },
          ]}
          onChange={(kind) => kind !== value.kind && onChange({ kind, ref: '', label: '' })}
        />
        {value.kind === 'document' &&
          (documents.length ? (
            <Select value={value.ref || undefined} onValueChange={(ref) => pick({ kind: 'document', ref, label: documents.find((d) => refOf(d) === ref)?.fileName ?? '' })}>
              <SelectTrigger className="w-full" {...aria}>
                <SelectValue placeholder="Choose a document" />
              </SelectTrigger>
              <SelectContent>
                {documents.map((d) => (
                  <SelectItem key={d.id} value={refOf(d)}>
                    {d.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            empty('No documents yet.', 'knowledge', 'Knowledge')
          ))}
        {value.kind === 'website' &&
          (websites.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={value.ref || undefined} onValueChange={(ref) => pick({ kind: 'website', ref, label: websites.find((w) => refOf(w) === ref)?.url ?? '' })}>
                <SelectTrigger className="w-full" {...aria}>
                  <SelectValue placeholder="Choose a website" />
                </SelectTrigger>
                <SelectContent>
                  {websites.map((w) => (
                    <SelectItem key={w.id} value={refOf(w)}>
                      {w.url}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Page path (optional)"
                list={listId}
                disabled={!value.ref}
                value={value.path ?? ''}
                onChange={(e) => onChange({ ...value, path: e.target.value || undefined })}
                placeholder="Page path, e.g. /products (optional)"
              />
              <datalist id={listId}>
                {site?.subpages.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
          ) : (
            empty('No websites yet.', 'knowledge', 'Knowledge')
          ))}
        {value.kind === 'connector' &&
          (tools.length ? (
            <>
              <Select value={value.ref || undefined} onValueChange={(ref) => pick({ kind: 'connector', ref, label: tools.find((a) => refOf(a) === ref)?.name ?? '' })}>
                <SelectTrigger className="w-full" {...aria}>
                  <SelectValue placeholder="Choose a tool" />
                </SelectTrigger>
                <SelectContent>
                  {tools.map((a) => (
                    <SelectItem key={a.id} value={refOf(a)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Pick a tool whose response includes a link to the {media}.
              </p>
            </>
          ) : (
            empty('No connector tools yet.', 'connections', 'Connections')
          ))}
        {value.kind === 'url' && (
          <Input
            id={id}
            inputMode="url"
            {...aria}
            value={value.ref}
            onChange={(e) => onChange({ kind: 'url', ref: e.target.value, label: e.target.value })}
            onBlur={() => touch(field)}
            placeholder="https://"
          />
        )}
      </div>
    </FieldShell>
  )
}

// ---- Per-type forms (fields in PRD Appendix C order) ----

function RichReplyBlanksForm({
  editor,
  businessAddress,
  onChange,
}: {
  editor: RichReplyEditorState
  businessAddress: string
  onChange: (editor: RichReplyEditorState) => void
}) {
  const up = <B,>(b: B, patch: Partial<B>) => onChange({ ...editor, blanks: { ...b, ...patch } } as unknown as RichReplyEditorState)

  switch (editor.type) {
    case 'cta_url': {
      const b = editor.blanks
      const media = b.headerMedia
      return (
        <div className="space-y-4">
          <TextField
            field="messageText"
            label="Body"
            required
            rows={3}
            max={L.bodyMax}
            value={b.messageText}
            onChange={(v) => up(b, { messageText: v })}
            placeholder="e.g. You can order directly from our website."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              field="buttonLabel"
              label="Button label"
              required
              hint="Keep it to a word or two. Long labels get cut off on phones."
              max={L.labelMax}
              value={b.buttonLabel}
              onChange={(v) => up(b, { buttonLabel: v })}
              placeholder="e.g. Shop now"
            />
            <TextField field="link" label="Button URL" required inputMode="url" value={b.link} onChange={(v) => up(b, { link: v })} placeholder="https://" />
          </div>
          <OptionalGroup>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Header media</Label>
                <Segmented
                  label="Header media"
                  value={media?.mediaType ?? 'none'}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'image', label: 'Image' },
                    { value: 'video', label: 'Video' },
                  ]}
                  onChange={(v) => up(b, { headerMedia: v === 'none' ? undefined : { ...(media ?? emptySource()), mediaType: v } })}
                />
              </div>
              {media && (
                <ImageSourcePicker
                  field="headerMedia"
                  label={media.mediaType === 'video' ? 'Header video' : 'Header image'}
                  media={media.mediaType}
                  value={media}
                  onChange={(src) => up(b, { headerMedia: { ...src, mediaType: media.mediaType } })}
                />
              )}
            </div>
            <TextField
              field="footer"
              label="Footer"
              max={L.footerMax}
              value={b.footer ?? ''}
              onChange={(v) => up(b, { footer: v })}
              placeholder="e.g. Free delivery on orders over ₹999"
            />
          </OptionalGroup>
        </div>
      )
    }

    case 'image': {
      const b = editor.blanks
      return (
        <div className="space-y-4">
          <ImageSourcePicker field="image" label="Image source" required value={b.image} onChange={(image) => up(b, { image })} />
          <OptionalGroup>
            <TextField field="caption" label="Caption" rows={2} max={L.bodyMax} value={b.caption} onChange={(v) => up(b, { caption: v })} />
          </OptionalGroup>
        </div>
      )
    }

    case 'interactive_list': {
      const b = editor.blanks
      return (
        <div className="space-y-4">
          <TextField field="messageText" label="Body" required rows={3} max={L.listBodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} />
          <TextField
            field="menuButtonLabel"
            label="Button text"
            required
            hint="The button that opens the list."
            max={L.labelMax}
            value={b.menuButtonLabel}
            onChange={(v) => up(b, { menuButtonLabel: v })}
            placeholder="e.g. See options"
          />
          <MenuOptionsEditor
            options={b.options}
            groupsEnabled={b.groupsEnabled}
            onChange={(options) => up(b, { options })}
            onToggleGroups={(groupsEnabled) => up(b, { groupsEnabled })}
          />
        </div>
      )
    }

    case 'carousel_url':
    case 'carousel_quick_reply': {
      const b = editor.blanks
      return (
        <div className="space-y-4">
          <TextField field="messageText" label="Body" required rows={2} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} />
          <CarouselCardsEditor cards={b.cards} hasLink={editor.type === 'carousel_url'} onChange={(cards) => up(b, { cards })} />
        </div>
      )
    }

    case 'location': {
      const b = editor.blanks
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField field="latitude" label="Latitude" required inputMode="decimal" value={b.latitude} onChange={(v) => up(b, { latitude: v })} placeholder="e.g. 19.0596" />
            <TextField field="longitude" label="Longitude" required inputMode="decimal" value={b.longitude} onChange={(v) => up(b, { longitude: v })} placeholder="e.g. 72.8295" />
          </div>
          <p className="flex items-start gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            <MapPin className="mt-px size-3.5 shrink-0" />
            Copy the coordinates from a verified source, like your Google Business Profile or a pin dropped at your door. A wrong pin sends customers to the wrong place.
          </p>
          <OptionalGroup>
            <TextField
              field="placeName"
              label="Name"
              max={MAX_LOCATION_NAME}
              value={b.placeName ?? ''}
              onChange={(v) => up(b, { placeName: v })}
              placeholder="e.g. Aurora Home Goods, Bandra West"
            />
            <div className="space-y-2">
              <TextField field="address" label="Address" rows={2} max={MAX_LOCATION_ADDRESS} value={b.address ?? ''} onChange={(v) => up(b, { address: v })} />
              {businessAddress.trim() && b.address !== businessAddress && (
                <Button size="sm" variant="outline" onClick={() => up(b, { address: businessAddress })}>
                  Use my business address
                </Button>
              )}
              {businessAddress.trim() && b.address === businessAddress && (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Filled from your business details. Edit if this reply should point somewhere else.
                </p>
              )}
            </div>
          </OptionalGroup>
        </div>
      )
    }

    case 'interactive_reply_buttons': {
      const b = editor.blanks
      return <ReplyButtonsEditor messageText={b.messageText} buttons={b.buttons} onChange={(patch) => up(b, patch)} />
    }

    case 'location_request': {
      const b = editor.blanks
      return (
        <TextField
          field="messageText"
          label="Body"
          required
          hint="The customer always chooses whether to share. The agent should never insist."
          rows={3}
          max={L.bodyMax}
          value={b.messageText}
          onChange={(v) => up(b, { messageText: v })}
          placeholder="e.g. Please share your location so we can check delivery to your area."
        />
      )
    }

    case 'flow': {
      // Out of scope (hidden from the gallery); kept editable for rows that already exist.
      const b = editor.blanks
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Which form</Label>
            <Select value={b.flowName ?? undefined} onValueChange={(v) => up(b, { flowName: v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a form" />
              </SelectTrigger>
              <SelectContent>
                {CANNED_FLOWS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField field="messageText" label="Body" required rows={2} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} />
          <TextField field="buttonLabel" label="Button label" required max={L.labelMax} value={b.buttonLabel} onChange={(v) => up(b, { buttonLabel: v })} />
        </div>
      )
    }
  }
}

function CountError({ field }: { field: string }) {
  const message = useContext(FormContext).issue(field)
  return message ? (
    <p className="text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
      {message}
    </p>
  ) : null
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <X className="size-3.5" />
    </button>
  )
}

function ReplyButtonsEditor({
  messageText,
  buttons,
  onChange,
}: {
  messageText: string
  buttons: string[]
  onChange: (patch: { messageText?: string; buttons?: string[] }) => void
}) {
  return (
    <div className="space-y-4">
      <TextField
        field="messageText"
        label="Body"
        required
        rows={3}
        max={L.bodyMax}
        value={messageText}
        onChange={(v) => onChange({ messageText: v })}
        placeholder="e.g. How would you like to receive your order?"
      />
      <div className="space-y-3">
        <span className="flex items-center gap-1.5">
          <Label>Buttons</Label>
          <InfoTooltip text="One to three buttons, each with a different title. Tapping one sends its title as the customer's reply." />
        </span>
        {buttons.map((label, i) => (
          <TextField
            key={i}
            field={`buttons.${i}`}
            label={`Button ${i + 1}`}
            required
            max={L.labelMax}
            value={label}
            onChange={(v) => onChange({ buttons: buttons.map((b, j) => (j === i ? v : b)) })}
            placeholder={i === 0 ? 'e.g. Home delivery' : 'e.g. Store pickup'}
            action={buttons.length > L.buttonsMin && <RemoveButton label={`Remove button ${i + 1}`} onClick={() => onChange({ buttons: buttons.filter((_, j) => j !== i) })} />}
          />
        ))}
        <CountError field="buttons" />
        {buttons.length < L.buttonsMax && (
          <Button size="sm" variant="outline" onClick={() => onChange({ buttons: [...buttons, ''] })}>
            <Plus className="size-3.5" />
            Add a button
          </Button>
        )}
      </div>
    </div>
  )
}

function MenuOptionsEditor({
  options,
  groupsEnabled,
  onChange,
  onToggleGroups,
}: {
  options: InteractiveListBlanks['options']
  groupsEnabled: boolean
  onChange: (options: InteractiveListBlanks['options']) => void
  onToggleGroups: (enabled: boolean) => void
}) {
  const otherIds = (id: string) => options.filter((o) => o.id !== id).map((o) => o.rowId)
  const autoId = (title: string, id: string) => (title.trim() ? rowIdFromTitle(title, otherIds(id)) : '')
  // Rows whose ID the user typed themselves; those stop following the title.
  const [manual, setManual] = useState(() => new Set(options.filter((o) => o.rowId && o.rowId !== autoId(o.title, o.id)).map((o) => o.id)))
  const edit = (id: string, patch: Partial<InteractiveListBlanks['options'][number]>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Label>Rows</Label>
          <InfoTooltip text={`${L.rowsMin} to ${L.rowsMax} rows. The customer picks one from the list.`} />
        </span>
        <button
          type="button"
          onClick={() => onToggleGroups(!groupsEnabled)}
          className="text-primary underline-offset-2 hover:underline"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          {groupsEnabled ? 'Remove groups' : 'Group these rows'}
        </button>
      </div>
      {options.map((option, i) => (
        <div key={option.id} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>Row {i + 1}</p>
            {options.length > L.rowsMin && <RemoveButton label={`Remove row ${i + 1}`} onClick={() => onChange(options.filter((o) => o.id !== option.id))} />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              field={`options.${option.id}.title`}
              label="Row title"
              required
              hint="Short. This is the line the customer taps."
              max={L.rowTitleMax}
              value={option.title}
              onChange={(title) => edit(option.id, manual.has(option.id) ? { title } : { title, rowId: autoId(title, option.id) })}
            />
            <TextField
              field={`options.${option.id}.rowId`}
              label="Row ID"
              required
              hint="Sent back when the customer picks this row. Filled in from the title; each row needs a different one."
              max={L.rowIdMax}
              value={option.rowId}
              onChange={(rowId) => {
                setManual((prev) => {
                  const next = new Set(prev)
                  if (rowId) next.add(option.id)
                  else next.delete(option.id)
                  return next
                })
                edit(option.id, { rowId })
              }}
            />
          </div>
          <TextField
            field={`options.${option.id}.description`}
            label="Row description (optional)"
            max={L.rowDescriptionMax}
            value={option.description}
            onChange={(description) => edit(option.id, { description })}
          />
          {groupsEnabled && <TextField field={`options.${option.id}.group`} label="Group heading" value={option.group} onChange={(group) => edit(option.id, { group })} />}
        </div>
      ))}
      <CountError field="options" />
      {options.length < L.rowsMax && (
        <Button size="sm" variant="outline" onClick={() => onChange([...options, newMenuOption()])}>
          <Plus className="size-3.5" />
          Add row
        </Button>
      )}
    </div>
  )
}

function CarouselCardsEditor({
  cards,
  hasLink,
  onChange,
}: {
  cards: CarouselCard[]
  hasLink: boolean
  onChange: (cards: CarouselCard[]) => void
}) {
  const dragIndex = useRef<number | null>(null)
  const edit = (id: string, patch: Partial<CarouselCard>) => onChange(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  function handleDrop(targetIndex: number) {
    if (dragIndex.current === null || dragIndex.current === targetIndex) return
    const next = [...cards]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
    dragIndex.current = null
  }

  return (
    <div className="space-y-3">
      <span className="flex items-center gap-1.5">
        <Label>Cards</Label>
        <InfoTooltip text={`${L.cardsMin} to ${L.cardsMax} cards. Drag to reorder.`} />
      </span>
      {cards.map((card, i) => (
        <div
          key={card.id}
          draggable
          onDragStart={() => {
            dragIndex.current = i
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(i)}
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <div className="flex items-center gap-2">
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
            <p className="flex-1" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>
              Card {i + 1}
            </p>
            {cards.length > L.cardsMin && <RemoveButton label={`Remove card ${i + 1}`} onClick={() => onChange(cards.filter((c) => c.id !== card.id))} />}
          </div>
          <ImageSourcePicker field={`cards.${card.id}.image`} label="Image" required value={card.image} onChange={(image) => edit(card.id, { image })} />
          <TextField
            field={`cards.${card.id}.cardText`}
            label="Card text"
            required
            rows={2}
            max={L.cardTextMax}
            value={card.cardText}
            onChange={(cardText) => edit(card.id, { cardText })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              field={`cards.${card.id}.buttonLabel`}
              label="Button label"
              required
              hint={hasLink ? undefined : 'Tapping this sends the label back as the customer’s answer.'}
              max={L.labelMax}
              value={card.buttonLabel}
              onChange={(buttonLabel) => edit(card.id, { buttonLabel })}
            />
            {hasLink && (
              <TextField field={`cards.${card.id}.link`} label="Button URL" required inputMode="url" value={card.link} onChange={(link) => edit(card.id, { link })} placeholder="https://" />
            )}
          </div>
        </div>
      ))}
      <CountError field="cards" />
      {cards.length < L.cardsMax && (
        <Button size="sm" variant="outline" onClick={() => onChange([...cards, newCarouselCard()])}>
          <Plus className="size-3.5" />
          Add card
        </Button>
      )}
    </div>
  )
}
