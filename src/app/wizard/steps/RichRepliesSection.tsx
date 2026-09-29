import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
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
  compileRichReplySentence,
  newCarouselCard,
  newId,
  newMenuOption,
} from '@/app/wizard/mockData'
import { normalizeForCompare } from '@/app/wizard/csv'
import type {
  CarouselCard,
  CarouselQuickReplyBlanks,
  CarouselUrlBlanks,
  CtaUrlBlanks,
  CustomSkill,
  FlowBlanks,
  ReplyButtonsBlanks,
  ImageBlanks,
  InteractiveListBlanks,
  LocationBlanks,
  LocationRequestBlanks,
  RichReply,
  RichReplyType,
} from '@/app/wizard/types'
import { createUiSkill, deleteUiSkill, errorText, updateUiSkill } from '@/app/api/meta'
import { cn } from '@/app/lib/utils'

const MAX_NAME = 60
const MAX_TRIGGER = 300
const RICH_REPLY_COUNT_WARNING_THRESHOLD = 10

const MAX_MESSAGE_TEXT = 300
const MAX_BUTTON_LABEL = 20
const MAX_CAPTION = 300
const MAX_MENU_OPTION_TITLE = 24
const MAX_MENU_OPTION_DESC = 72
const MAX_CAROUSEL_CARD_TEXT = 160
const MAX_LOCATION_NAME = 100
const MAX_LOCATION_ADDRESS = 300
const MIN_MENU_OPTIONS = 1
const MAX_MENU_OPTIONS = 10
const MIN_CAROUSEL_CARDS = 2
const MAX_CAROUSEL_CARDS = 10

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

// ---- Editor state: mirrors RichReply's blanks shape, plus in-progress add/edit bookkeeping ----
type RichReplyEditorState =
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'cta_url'; blanks: CtaUrlBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'image'; blanks: ImageBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'interactive_list'; blanks: InteractiveListBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'carousel_url'; blanks: CarouselUrlBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'carousel_quick_reply'; blanks: CarouselQuickReplyBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'location'; blanks: LocationBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'location_request'; blanks: LocationRequestBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'flow'; blanks: FlowBlanks }
  | { mode: 'add' | 'edit'; replyId?: string; name: string; trigger: string; type: 'interactive_reply_buttons'; blanks: ReplyButtonsBlanks }

function emptyBlanksForType(type: RichReplyType): RichReplyEditorState {
  const shared = { mode: 'add' as const, name: '', trigger: '' }
  switch (type) {
    case 'cta_url':
      return { ...shared, type, blanks: { messageText: '', buttonLabel: '', link: '' } }
    case 'image':
      return { ...shared, type, blanks: { imageUrl: '', caption: '' } }
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

function editorFromExisting(reply: RichReply & { blanks: NonNullable<RichReply['blanks']> }): RichReplyEditorState {
  const shared = { mode: 'edit' as const, replyId: reply.id, name: reply.name, trigger: reply.trigger }
  switch (reply.type) {
    case 'cta_url':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'image':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'interactive_list':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'carousel_url':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'carousel_quick_reply':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'location':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'location_request':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'flow':
      return { ...shared, type: reply.type, blanks: reply.blanks }
    case 'interactive_reply_buttons':
      return { ...shared, type: reply.type, blanks: reply.blanks }
  }
}

function isUrl(value: string): boolean {
  return /^https:\/\//.test(value.trim())
}

/** Every required blank present — gates the Save button. Link *format* is checked separately,
 *  since an invalid https:// link blocks Save with its own visible warning (section 7). */
function isBlanksComplete(editor: RichReplyEditorState): boolean {
  switch (editor.type) {
    case 'cta_url':
      return !!(editor.blanks.messageText.trim() && editor.blanks.buttonLabel.trim() && editor.blanks.link.trim())
    case 'image':
      return !!editor.blanks.imageUrl.trim()
    case 'interactive_list':
      return !!(
        editor.blanks.messageText.trim() &&
        editor.blanks.menuButtonLabel.trim() &&
        editor.blanks.options.length >= MIN_MENU_OPTIONS &&
        editor.blanks.options.every((o) => o.title.trim())
      )
    case 'carousel_url':
      return !!(
        editor.blanks.messageText.trim() &&
        editor.blanks.cards.length >= MIN_CAROUSEL_CARDS &&
        editor.blanks.cards.every((c) => c.imageUrl.trim() && c.cardText.trim() && c.buttonLabel.trim() && c.link.trim())
      )
    case 'carousel_quick_reply':
      return !!(
        editor.blanks.messageText.trim() &&
        editor.blanks.cards.length >= MIN_CAROUSEL_CARDS &&
        editor.blanks.cards.every((c) => c.imageUrl.trim() && c.cardText.trim() && c.buttonLabel.trim())
      )
    case 'location':
      return !!(editor.blanks.placeName.trim() && editor.blanks.address.trim() && editor.blanks.latitude.trim() && editor.blanks.longitude.trim())
    case 'location_request':
      return !!editor.blanks.messageText.trim()
    case 'flow':
      return !!(editor.blanks.flowName && editor.blanks.messageText.trim() && editor.blanks.buttonLabel.trim())
    case 'interactive_reply_buttons': {
      const labels = editor.blanks.buttons.map((b) => b.trim())
      return !!(editor.blanks.messageText.trim() && labels.length >= 1 && labels.every(Boolean) && new Set(labels).size === labels.length)
    }
  }
}

const LINK_FORMAT_WARNING = 'Links need to start with https:// to open reliably on WhatsApp.'

/** Any filled link blank that doesn't start with https:// — this one blocks Save, unlike the
 *  other warnings in section 7 which are advisory only. */
function linkFormatError(editor: RichReplyEditorState): string | null {
  if (editor.type === 'cta_url' && editor.blanks.link.trim() && !isUrl(editor.blanks.link)) return LINK_FORMAT_WARNING
  if (editor.type === 'carousel_url' && editor.blanks.cards.some((c) => c.link.trim() && !isUrl(c.link))) return LINK_FORMAT_WARNING
  return null
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
    setEditor(editorFromExisting(reply as RichReply & { blanks: NonNullable<RichReply['blanks']> }))
    setEditorError(null)
  }

  function startRebuildAsForm(reply: RichReply) {
    setPendingRebuildId(null)
    const fresh = emptyBlanksForType(reply.type)
    setEditor({ ...fresh, mode: 'edit', replyId: reply.id } as RichReplyEditorState)
    setEditorError(null)
  }

  async function saveEditor() {
    if (!editor || !editor.name.trim() || !editor.trigger.trim() || !isBlanksComplete(editor)) return
    if (linkFormatError(editor)) return
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
        await updateUiSkill(existing.metaId, { title: reply.name, instruction: sentence })
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
                      Rebuild as a form
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
        title="This will replace the existing setup for this rich reply. Continue?"
        confirmLabel="Continue"
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
  const linkError = linkFormatError(editor)
  const canSave = !!(editor.name.trim() && editor.trigger.trim() && isBlanksComplete(editor) && !linkError)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{RICH_REPLY_TYPE_LABEL[editor.type]}</DialogTitle>
        </DialogHeader>
        {/* items-start keeps the shorter preview column from being stretched to match the fields
         *  column's height — the default grid stretch left a large empty gap under the preview. */}
        <div className="grid max-h-[75vh] grid-cols-[1fr_320px] items-start gap-6 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5">
                  <Label htmlFor="rr-name">Name</Label>
                  <InfoTooltip text="Only for you, so you can find it in the list." />
                </span>
                <Input
                  id="rr-name"
                  maxLength={MAX_NAME}
                  value={editor.name}
                  onChange={(e) => onChange({ ...editor, name: e.target.value })}
                  placeholder="e.g. Product page button"
                />
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5">
                  <Label htmlFor="rr-trigger">When should the agent send this?</Label>
                  <InfoTooltip text="Written for the agent. Describe the situation, and the agent decides in the moment whether it fits." />
                </span>
                <Textarea
                  id="rr-trigger"
                  rows={3}
                  maxLength={MAX_TRIGGER}
                  value={editor.trigger}
                  onChange={(e) => onChange({ ...editor, trigger: e.target.value })}
                  placeholder="e.g. When someone asks where they can buy online"
                  className="bg-input-background shadow-sm"
                />
              </div>
            </div>

            <RichReplyBlanksForm editor={editor} businessAddress={businessAddress} onChange={onChange} />

            {linkError && (
              <p className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                <AlertTriangle className="size-3.5 shrink-0" />
                {linkError}
              </p>
            )}
            {error && <InlineError message={error} onRetry={onSave} />}
          </div>

          <div className="sticky top-0 space-y-1.5">
            <Label>What the customer sees</Label>
            <RichReplyPreview editor={editor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave || saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RichReplyBlanksForm({
  editor,
  businessAddress,
  onChange,
}: {
  editor: RichReplyEditorState
  businessAddress: string
  onChange: (editor: RichReplyEditorState) => void
}) {
  switch (editor.type) {
    case 'cta_url':
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rr-message">Message text</Label>
            <Textarea
              id="rr-message"
              rows={2}
              maxLength={MAX_MESSAGE_TEXT}
              value={editor.blanks.messageText}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
              placeholder="e.g. You can order directly from our website."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="rr-button-label">Button label</Label>
                <InfoTooltip text="Keep it to a word or two. Long labels get cut off on phones." />
              </span>
              <Input
                id="rr-button-label"
                maxLength={MAX_BUTTON_LABEL}
                value={editor.blanks.buttonLabel}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, buttonLabel: e.target.value } })}
                placeholder="e.g. Shop now"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rr-link">Link</Label>
              <Input
                id="rr-link"
                value={editor.blanks.link}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, link: e.target.value } })}
                placeholder="https://"
              />
            </div>
          </div>
        </div>
      )

    case 'image':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="rr-image-url">Image</Label>
              <InfoTooltip text="A link to a hosted image. Uploading from your computer comes later." />
            </span>
            <Input
              id="rr-image-url"
              value={editor.blanks.imageUrl}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, imageUrl: e.target.value } })}
              placeholder="Paste a link to the image"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-caption">Caption</Label>
            <Input
              id="rr-caption"
              maxLength={MAX_CAPTION}
              value={editor.blanks.caption}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, caption: e.target.value } })}
            />
          </div>
        </div>
      )

    case 'interactive_list':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rr-menu-message">Message text</Label>
              <Textarea
                id="rr-menu-message"
                rows={2}
                maxLength={MAX_MESSAGE_TEXT}
                value={editor.blanks.messageText}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rr-menu-button-label">Menu button label</Label>
              <Input
                id="rr-menu-button-label"
                maxLength={MAX_BUTTON_LABEL}
                value={editor.blanks.menuButtonLabel}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, menuButtonLabel: e.target.value } })}
                placeholder="e.g. See options"
              />
            </div>
          </div>
          <MenuOptionsEditor
            options={editor.blanks.options}
            groupsEnabled={editor.blanks.groupsEnabled}
            onChange={(options) => onChange({ ...editor, blanks: { ...editor.blanks, options } })}
            onToggleGroups={(groupsEnabled) => onChange({ ...editor, blanks: { ...editor.blanks, groupsEnabled } })}
          />
        </div>
      )

    case 'carousel_url':
    case 'carousel_quick_reply':
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rr-carousel-message">Message text</Label>
            <Textarea
              id="rr-carousel-message"
              rows={2}
              maxLength={MAX_MESSAGE_TEXT}
              value={editor.blanks.messageText}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
            />
          </div>
          <CarouselCardsEditor
            cards={editor.blanks.cards}
            hasLink={editor.type === 'carousel_url'}
            onChange={(cards) => onChange({ ...editor, blanks: { ...editor.blanks, cards } } as RichReplyEditorState)}
          />
        </div>
      )

    case 'location':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rr-place-name">Name of the place</Label>
              <Input
                id="rr-place-name"
                maxLength={MAX_LOCATION_NAME}
                value={editor.blanks.placeName}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, placeName: e.target.value } })}
                placeholder="e.g. Aurora Home Goods, Bandra West"
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="rr-lat">Map position</Label>
                <InfoTooltip text="Tip: copy these from the share options in any maps app." />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  id="rr-lat"
                  aria-label="Latitude"
                  value={editor.blanks.latitude}
                  onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, latitude: e.target.value } })}
                  placeholder="Latitude"
                />
                <Input
                  id="rr-lng"
                  aria-label="Longitude"
                  value={editor.blanks.longitude}
                  onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, longitude: e.target.value } })}
                  placeholder="Longitude"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rr-address">Address</Label>
            <Textarea
              id="rr-address"
              rows={2}
              maxLength={MAX_LOCATION_ADDRESS}
              value={editor.blanks.address}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, address: e.target.value } })}
            />
            {businessAddress.trim() && !editor.blanks.placeName.trim() && !editor.blanks.address.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...editor,
                    blanks: { ...editor.blanks, address: businessAddress },
                  })
                }
              >
                Fill from business details
              </Button>
            )}
            {editor.blanks.address === businessAddress && businessAddress.trim() && (
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Filled from your business details. Edit if this reply should point somewhere else.
              </p>
            )}
          </div>
        </div>
      )

    case 'interactive_reply_buttons':
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rr-buttons-message">Message text</Label>
            <Textarea
              id="rr-buttons-message"
              rows={2}
              maxLength={MAX_MESSAGE_TEXT}
              value={editor.blanks.messageText}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
              placeholder="e.g. How would you like to receive your order?"
            />
          </div>
          <div className="space-y-2">
            <span className="flex items-center gap-1.5">
              <Label>Buttons</Label>
              <InfoTooltip text="One to three buttons. Each label must be different, up to 20 characters. Tapping one sends its label as the customer's reply." />
            </span>
            {editor.blanks.buttons.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Button ${i + 1} label`}
                  maxLength={MAX_BUTTON_LABEL}
                  value={label}
                  onChange={(e) =>
                    onChange({ ...editor, blanks: { ...editor.blanks, buttons: editor.blanks.buttons.map((b, j) => (j === i ? e.target.value : b)) } })
                  }
                  placeholder={i === 0 ? 'e.g. Home delivery' : 'e.g. Store pickup'}
                />
                {editor.blanks.buttons.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove button ${i + 1}`}
                    onClick={() => onChange({ ...editor, blanks: { ...editor.blanks, buttons: editor.blanks.buttons.filter((_, j) => j !== i) } })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {editor.blanks.buttons.length < 3 && (
              <Button size="sm" variant="outline" onClick={() => onChange({ ...editor, blanks: { ...editor.blanks, buttons: [...editor.blanks.buttons, ''] } })}>
                Add a button
              </Button>
            )}
          </div>
        </div>
      )

    case 'location_request':
      return (
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="rr-location-request-message">Message text</Label>
            <InfoTooltip text="The customer always chooses whether to share. The agent should never insist." />
          </span>
          <Textarea
            id="rr-location-request-message"
            rows={2}
            maxLength={MAX_MESSAGE_TEXT}
            value={editor.blanks.messageText}
            onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
            placeholder="e.g. Please share your location so we can check delivery to your area."
          />
        </div>
      )

    case 'flow': {
      if (CANNED_FLOWS.length === 0) {
        return (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No WhatsApp forms are set up on this number yet. Forms are created separately from
            this wizard.
          </p>
        )
      }
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rr-flow-message">Message text</Label>
            <Textarea
              id="rr-flow-message"
              rows={2}
              maxLength={MAX_MESSAGE_TEXT}
              value={editor.blanks.messageText}
              onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, messageText: e.target.value } })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Which form</Label>
              <Select
                value={editor.blanks.flowName ?? undefined}
                onValueChange={(v) => onChange({ ...editor, blanks: { ...editor.blanks, flowName: v } })}
              >
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
            <div className="space-y-1.5">
              <Label htmlFor="rr-flow-button-label">Button label</Label>
              <Input
                id="rr-flow-button-label"
                maxLength={MAX_BUTTON_LABEL}
                value={editor.blanks.buttonLabel}
                onChange={(e) => onChange({ ...editor, blanks: { ...editor.blanks, buttonLabel: e.target.value } })}
              />
            </div>
          </div>
        </div>
      )
    }
  }
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
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Options</Label>
        {!groupsEnabled && (
          <button type="button" onClick={() => onToggleGroups(true)} className="text-primary" style={{ fontSize: 'var(--text-xs)' }}>
            Group these options
          </button>
        )}
      </div>
      <div className="space-y-2">
        {options.map((option, i) => (
          <div key={option.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>Option {i + 1}</p>
              {options.length > MIN_MENU_OPTIONS && (
                <button
                  type="button"
                  onClick={() => onChange(options.filter((o) => o.id !== option.id))}
                  className="text-muted-foreground"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="flex items-center gap-1.5">
                  <Label className="text-xs">Option title</Label>
                  <InfoTooltip text="Short. This is the line the customer taps." />
                </span>
                <Input
                  maxLength={MAX_MENU_OPTION_TITLE}
                  value={option.title}
                  onChange={(e) => onChange(options.map((o) => (o.id === option.id ? { ...o, title: e.target.value } : o)))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input
                  maxLength={MAX_MENU_OPTION_DESC}
                  value={option.description}
                  onChange={(e) => onChange(options.map((o) => (o.id === option.id ? { ...o, description: e.target.value } : o)))}
                />
              </div>
            </div>
            {groupsEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">Group heading</Label>
                <Input
                  value={option.group}
                  onChange={(e) => onChange(options.map((o) => (o.id === option.id ? { ...o, group: e.target.value } : o)))}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {options.length < MAX_MENU_OPTIONS && (
        <Button size="sm" variant="outline" onClick={() => onChange([...options, newMenuOption()])}>
          <Plus className="size-3.5" />
          Add option
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

  function handleDrop(targetIndex: number) {
    if (dragIndex.current === null || dragIndex.current === targetIndex) return
    const next = [...cards]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
    dragIndex.current = null
  }

  return (
    <div className="space-y-2">
      <Label>Cards</Label>
      <div className="space-y-2">
        {cards.map((card, i) => (
          <div
            key={card.id}
            draggable
            onDragStart={() => {
              dragIndex.current = i
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(i)}
            className="space-y-2 rounded-lg border border-border p-3"
          >
            <div className="flex items-center gap-2">
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
              <p className="flex-1" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                Card {i + 1}
              </p>
              {cards.length > MIN_CAROUSEL_CARDS && (
                <button
                  type="button"
                  onClick={() => onChange(cards.filter((c) => c.id !== card.id))}
                  className="text-muted-foreground"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Picture</Label>
                <Input
                  value={card.imageUrl}
                  onChange={(e) => onChange(cards.map((c) => (c.id === card.id ? { ...c, imageUrl: e.target.value } : c)))}
                  placeholder="Paste a link to the image"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Card text</Label>
                <Input
                  maxLength={MAX_CAROUSEL_CARD_TEXT}
                  value={card.cardText}
                  onChange={(e) => onChange(cards.map((c) => (c.id === card.id ? { ...c, cardText: e.target.value } : c)))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="flex items-center gap-1.5">
                  <Label className="text-xs">Button label</Label>
                  {!hasLink && <InfoTooltip text="Tapping this sends the label back as the customer’s answer." />}
                </span>
                <Input
                  maxLength={MAX_BUTTON_LABEL}
                  value={card.buttonLabel}
                  onChange={(e) => onChange(cards.map((c) => (c.id === card.id ? { ...c, buttonLabel: e.target.value } : c)))}
                />
              </div>
              {hasLink && (
                <div className="space-y-1">
                  <Label className="text-xs">Link</Label>
                  <Input
                    value={card.link}
                    onChange={(e) => onChange(cards.map((c) => (c.id === card.id ? { ...c, link: e.target.value } : c)))}
                    placeholder="https://"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {cards.length < MAX_CAROUSEL_CARDS && (
        <Button size="sm" variant="outline" onClick={() => onChange([...cards, newCarouselCard()])}>
          <Plus className="size-3.5" />
          Add card
        </Button>
      )}
    </div>
  )
}

// ==================================================================================
// PREVIEW
// ==================================================================================

function PreviewBubble({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <div className="max-w-full rounded-xl rounded-br-sm bg-accent px-3 py-2 text-accent-foreground">
      <p className="whitespace-pre-wrap break-words" style={{ fontSize: 'var(--text-sm)' }}>
        {text}
      </p>
    </div>
  )
}

function PreviewButton({ label, icon: Icon }: { label: string; icon?: typeof Link2 }) {
  if (!label.trim()) return null
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg border border-accent px-3 py-2 text-accent">
      {Icon && <Icon className="size-3.5" />}
      <span style={{ fontSize: 'var(--text-sm)' }}>{label}</span>
    </div>
  )
}

function RichReplyPreview({ editor }: { editor: RichReplyEditorState }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      {editor.type === 'cta_url' && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          <PreviewButton label={editor.blanks.buttonLabel} icon={Link2} />
        </>
      )}
      {editor.type === 'image' && (
        <>
          {editor.blanks.imageUrl.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={editor.blanks.imageUrl}
              alt=""
              className="h-32 w-full rounded-lg object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg bg-muted">
              <ImageIcon className="size-6 text-muted-foreground" />
            </div>
          )}
          {editor.blanks.caption.trim() && (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {editor.blanks.caption}
            </p>
          )}
        </>
      )}
      {editor.type === 'interactive_list' && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          <PreviewButton label={editor.blanks.menuButtonLabel} icon={List} />
          {editor.blanks.options.some((o) => o.title.trim()) && (
            <ul className="space-y-1 rounded-lg bg-muted p-2">
              {editor.blanks.options
                .filter((o) => o.title.trim())
                .map((o) => (
                  <li key={o.id} style={{ fontSize: 'var(--text-xs)' }}>
                    {o.title}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
      {(editor.type === 'carousel_url' || editor.type === 'carousel_quick_reply') && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          {editor.blanks.cards.some((c) => c.cardText.trim() || c.imageUrl.trim()) && (
            <div className="flex gap-2 overflow-x-auto">
              {editor.blanks.cards.map((c) => (
                <div key={c.id} className="w-28 shrink-0 space-y-1 rounded-lg border border-border p-2">
                  <div className="flex h-14 items-center justify-center rounded bg-muted">
                    <ImageIcon className="size-4 text-muted-foreground" />
                  </div>
                  <p className="line-clamp-2" style={{ fontSize: 'var(--text-xs)' }}>
                    {c.cardText || '—'}
                  </p>
                  {c.buttonLabel.trim() && (
                    <p className="truncate rounded border border-accent px-1 py-0.5 text-center text-accent" style={{ fontSize: 'var(--text-xs)' }}>
                      {c.buttonLabel}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {editor.type === 'location' && (editor.blanks.placeName.trim() || editor.blanks.address.trim()) && (
        <div className="space-y-1 rounded-lg bg-muted p-3">
          <div className="flex items-center gap-1.5 text-primary">
            <MapPin className="size-4" />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
              {editor.blanks.placeName || 'Untitled place'}
            </span>
          </div>
          {editor.blanks.address.trim() && (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {editor.blanks.address}
            </p>
          )}
        </div>
      )}
      {editor.type === 'interactive_reply_buttons' && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          {editor.blanks.buttons.filter((b) => b.trim()).map((b, i) => (
            <PreviewButton key={i} label={b} icon={MessageSquareReply} />
          ))}
        </>
      )}
      {editor.type === 'location_request' && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          <PreviewButton label="Send location" icon={Navigation} />
        </>
      )}
      {editor.type === 'flow' && (
        <>
          <PreviewBubble text={editor.blanks.messageText} />
          <PreviewButton label={editor.blanks.buttonLabel} icon={ClipboardList} />
          {editor.blanks.flowName && (
            <p className="text-center text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              Opens: {editor.blanks.flowName}
            </p>
          )}
        </>
      )}
    </div>
  )
}
