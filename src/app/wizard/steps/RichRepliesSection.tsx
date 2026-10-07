import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ClipboardList, GalleryHorizontal, Image as ImageIcon, Link2, List, MapPin, MessageSquareReply, MoreHorizontal, Navigation, Plus } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Switch } from '@/app/components/ui/switch'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { EmptyState, SectionHeader } from '@/app/components/ui/page'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'
import { RICH_REPLY_STARTERS, RICH_REPLY_TYPE_LABEL, SAMPLE_RICH_REPLIES, newId } from '@/app/wizard/mockData'
import { compileRichReplySentence } from '@/app/wizard/richReplies'
import { normalizeForCompare } from '@/app/wizard/csv'
import type { RichReply, RichReplyType } from '@/app/wizard/types'
import { createUiSkill, deleteUiSkill, errorText, updateUiSkill } from '@/app/api/meta'
import { cn } from '@/app/lib/utils'
import { RichReplyEditor } from './richReplies/RichReplyEditor'
import { blankDraft, effectiveName, type EditorState } from './richReplies/editorState'

const COUNT_WARNING = 10

const TYPE_ICON: Record<RichReplyType, typeof Link2> = {
  cta_url: Link2,
  image: ImageIcon,
  interactive_list: List,
  carousel_url: GalleryHorizontal,
  carousel_quick_reply: GalleryHorizontal,
  location: MapPin,
  location_request: Navigation,
  flow: ClipboardList,
  interactive_reply_buttons: MessageSquareReply,
}

/** The reply whose trigger says the same thing, so the agent may not know which to send. */
const sameTrigger = (trigger: string, replies: RichReply[], excludeId?: string) => {
  const norm = normalizeForCompare(trigger)
  return norm ? replies.find((r) => r.id !== excludeId && r.blanks !== null && normalizeForCompare(r.trigger) === norm) : undefined
}

export function RichRepliesSection({ onOpenSkills }: { onOpenSkills?: () => void }) {
  const { state, patch } = useWizard()
  const { me } = useAuth()
  const canEdit = can(me?.role, 'agent.edit')
  const { richReplies } = state.richReplies
  const { customSkills } = state.personalization
  const forceSaveFailure = state.demo.richRepliesForceSaveFailure

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({})

  useRegisterDevControls(
    'richReplies',
    <DemoControlsGroup label="Rich replies">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => patch('demo', { richRepliesForceSaveFailure: e.target.checked })} />
        Force save failure
      </label>
      <Button variant="outline" size="sm" onClick={() => patch('richReplies', { richReplies: SAMPLE_RICH_REPLIES })}>
        Load sample rich replies
      </Button>
    </DemoControlsGroup>,
  )

  function open(next: EditorState) {
    setSaveError(null)
    setEditor(next)
  }
  const startNew = (draft = blankDraft('interactive_reply_buttons')) => open({ ...draft, name: '', nameEdited: false })
  function startEdit(r: RichReply) {
    // A reply made outside Helo.ai has only Meta's instruction text: start its form empty, same type.
    const draft = r.blanks ? ({ type: r.type, trigger: r.trigger, blanks: r.blanks } as EditorState) : { ...blankDraft(r.type), madeElsewhere: true }
    open({ ...draft, replyId: r.id, name: r.name, nameEdited: true })
  }

  function flash(id: string) {
    rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000)
  }

  async function save(e: EditorState) {
    const sentence = compileRichReplySentence(e)
    const existing = e.replyId ? richReplies.find((r) => r.id === e.replyId) : undefined
    const id = existing?.id ?? newId('rr')
    const reply = {
      ...(existing ?? { id, enabled: true, createdAt: Date.now() }),
      type: e.type,
      name: effectiveName(e),
      trigger: e.trigger.trim(),
      blanks: e.blanks,
      instructionSentence: sentence,
    } as RichReply
    setSaving(true)
    setSaveError(null)
    try {
      if (forceSaveFailure) throw new Error('forced')
      if (existing?.metaId && existing.type === reply.type) {
        await updateUiSkill(existing.metaId, { title: reply.name, instruction: sentence }, reply)
      } else {
        // New, or a different type: Meta can't change a type in place, so it's replaced.
        reply.metaId = (await createUiSkill(reply)).id
        if (existing?.metaId) await deleteUiSkill(existing.metaId)
      }
    } catch (err) {
      setSaveError(forceSaveFailure ? 'Couldn’t save. Nothing was lost.' : `Couldn’t save. Nothing was lost. ${errorText(err)}`)
      return
    } finally {
      setSaving(false)
    }
    patch('richReplies', (prev) => ({ richReplies: existing ? prev.richReplies.map((r) => (r.id === id ? reply : r)) : [reply, ...prev.richReplies] }))
    setEditor(null)
    toast.success(existing ? 'Rich reply saved' : 'Rich reply added. The agent can send it now.')
  }

  async function toggle(r: RichReply) {
    try {
      if (forceSaveFailure) throw new Error('forced')
      // Takes effect immediately on Meta (PRD AC-c21).
      if (r.metaId) await updateUiSkill(r.metaId, { status: r.enabled ? 'disabled' : 'enabled' })
    } catch (err) {
      toast.error('Couldn’t save. Nothing was lost.', forceSaveFailure ? undefined : { description: errorText(err) })
      return
    }
    patch('richReplies', (prev) => ({ richReplies: prev.richReplies.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) }))
    toast.success(r.enabled ? 'Turned off' : 'Turned on')
  }

  async function confirmDelete() {
    const id = pendingDeleteId
    if (!id) return
    setPendingDeleteId(null)
    const metaId = richReplies.find((r) => r.id === id)?.metaId
    try {
      if (forceSaveFailure) throw new Error('forced')
      if (metaId) await deleteUiSkill(metaId)
    } catch {
      setDeleteError('Couldn’t delete. The rich reply is still here.')
      return
    }
    patch('richReplies', (prev) => ({ richReplies: prev.richReplies.filter((r) => r.id !== id) }))
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Rich replies"
        description="Buttons, menus, links and pictures the agent sends instead of plain text when they fit."
        actions={
          canEdit &&
          richReplies.length > 0 && (
            <Button size="sm" onClick={() => startNew()}>
              <Plus className="size-3.5" />
              New rich reply
            </Button>
          )
        }
      />

      {richReplies.length >= COUNT_WARNING && (
        <p className="flex items-center gap-1.5 text-xs text-warning-foreground">
          <AlertTriangle className="size-3.5 shrink-0" />
          With this many, keep each one’s “when” clearly different so the agent picks the right one.
        </p>
      )}
      {deleteError && <InlineError message={deleteError} onRetry={() => setDeleteError(null)} />}

      {richReplies.length === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Make the agent’s answers tappable"
          description="Customers tap a button instead of typing. Start from an example and change it to fit."
          action={
            canEdit && (
              <div className="flex max-w-lg flex-wrap justify-center gap-2">
                {RICH_REPLY_STARTERS.map((s) => {
                  const Icon = TYPE_ICON[s.draft.type]
                  return (
                    <Button key={s.label} variant="outline" size="sm" onClick={() => startNew(structuredClone(s.draft))}>
                      <Icon className="size-3.5 text-muted-foreground" />
                      {s.label}
                    </Button>
                  )
                })}
                <Button size="sm" onClick={() => startNew()}>
                  <Plus className="size-3.5" />
                  Start from scratch
                </Button>
              </div>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {richReplies.map((r) => {
            const Icon = TYPE_ICON[r.type]
            const twin = r.blanks ? sameTrigger(r.trigger, richReplies, r.id) : undefined
            const skillTwin = r.blanks && normalizeForCompare(r.trigger) && customSkills.some((s) => normalizeForCompare(s.instruction) === normalizeForCompare(r.trigger))
            return (
              <li
                key={r.id}
                data-density-row
                ref={(el) => {
                  rowRefs.current[r.id] = el
                }}
                className={cn('flex items-center gap-3 px-4 py-3 transition-colors', highlightId === r.id ? 'bg-accent' : canEdit && 'hover:bg-muted/50')}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <button type="button" disabled={!canEdit} onClick={() => startEdit(r)} className="min-w-0 flex-1 text-left disabled:cursor-default">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('font-medium', !r.enabled && 'text-muted-foreground')}>{r.name}</span>
                    <span className="text-meta text-muted-foreground">{RICH_REPLY_TYPE_LABEL[r.type]}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{r.blanks ? r.trigger : 'Made outside Helo.ai. Open it to set it up here.'}</span>
                  {(twin || skillTwin) && (
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-warning-foreground">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {twin ? 'Another rich reply has the same “when”.' : 'A skill covers the same situation.'}
                    </span>
                  )}
                </button>
                {twin && (
                  <Button variant="link" size="sm" className="hidden px-0 sm:inline-flex" onClick={() => flash(twin.id)}>
                    Show it
                  </Button>
                )}
                {!twin && skillTwin && onOpenSkills && (
                  <Button variant="link" size="sm" className="hidden px-0 sm:inline-flex" onClick={onOpenSkills}>
                    Open Skills
                  </Button>
                )}
                <Switch aria-label={r.enabled ? `Turn off ${r.name}` : `Turn on ${r.name}`} checked={r.enabled} disabled={!canEdit} onCheckedChange={() => toggle(r)} />
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`More for ${r.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => startEdit(r)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setPendingDeleteId(r.id)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editor && (
        <RichReplyEditor
          editor={editor}
          otherNames={richReplies.filter((r) => r.id !== editor.replyId).map((r) => r.name)}
          saving={saving}
          error={saveError}
          businessAddress={state.business.businessAddress}
          onChange={setEditor}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this rich reply?"
        description="The agent stops sending it straight away."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
