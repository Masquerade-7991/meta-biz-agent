import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Eye, Image as ImageIcon, Link2, List, Loader2, MapPin, Navigation, PencilLine } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/app/components/ui/sheet'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { compileRichReplySentence, validateRichReply, type RichReplyIssue } from '@/app/wizard/richReplies'
import { titleTaken } from '@/app/wizard/skillTitle'
import type { RichReplyType } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { WhatsAppPreview } from '../WhatsAppPreview'
import { MessageFields } from './fields'
import { FormContext, effectiveName, switchType, type EditorState } from './editorState'

const MAX_NAME = 60
const MAX_TRIGGER = 300


/** Types in the order people reach for them; the rest sit under "More". */
const MAIN: { type: RichReplyType; name: string; hint: string }[] = [
  { type: 'interactive_reply_buttons', name: 'Buttons', hint: 'Up to 3 quick answers' },
  { type: 'cta_url', name: 'Link button', hint: 'Opens a web page' },
  { type: 'interactive_list', name: 'Menu', hint: 'Up to 10 options' },
  { type: 'image', name: 'Image', hint: 'A picture and caption' },
  { type: 'location', name: 'Location', hint: 'A pin on the map' },
]
const MORE: typeof MAIN = [
  { type: 'carousel_url', name: 'Cards with links', hint: 'Swipeable pictures, each with a link' },
  { type: 'carousel_quick_reply', name: 'Cards with answers', hint: 'Swipeable pictures, each with a reply button' },
  { type: 'location_request', name: 'Ask for location', hint: 'Asks the customer to share theirs' },
]

const TRIGGER_EXAMPLES = ['When a customer asks for your menu', 'When a customer wants to book a demo', 'When a customer asks where your store is', 'When a customer asks how to pay']



export function RichReplyEditor({
  editor,
  otherNames,
  saving,
  error,
  businessAddress,
  onChange,
  onSave,
  onClose,
}: {
  editor: EditorState
  /** Names of the other rich replies: two names can't reach Meta as the same title. */
  otherNames: string[]
  saving: boolean
  error: string | null
  businessAddress: string
  onChange: (e: EditorState) => void
  onSave: (e: EditorState) => void
  onClose: () => void
}) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [showMore, setShowMore] = useState(() => MORE.some((m) => m.type === editor.type))
  const [preview, setPreview] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLTextAreaElement>(null)
  const name = effectiveName(editor)
  const issues: RichReplyIssue[] = [
    ...(editor.trigger.trim() ? [] : [{ field: 'trigger', message: 'Say when the agent should send this.' }]),
    ...(editor.nameEdited && !name ? [{ field: 'name', message: 'Give it a name.' }] : []),
    ...(name && titleTaken(name, otherNames) ? [{ field: 'name', message: 'Another rich reply already has this name. Change the name at the top.' }] : []),
    ...validateRichReply(editor),
  ]
  const form = {
    issue: (field: string) => (showAll || touched.has(field) ? issues.find((i) => i.field === field)?.message : undefined),
    touch: (field: string) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
  }
  const triggerError = form.issue('trigger')
  const nameError = issues.find((i) => i.field === 'name' && (showAll || i.message.startsWith('Another')))?.message

  function save() {
    if (issues.length) {
      setShowAll(true)
      setPreview(false)
      // After the errors render, bring the first one into view.
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        el?.focus()
        el?.scrollIntoView({ block: 'center' })
      })
      return
    }
    onSave(editor)
  }

  const types = editor.type === 'flow' ? [...MAIN, { type: 'flow' as const, name: 'WhatsApp form', hint: 'Opens a form' }] : MAIN

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="sm:max-w-5xl"
        // Start where the work starts (step 1), not with the name selected.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <SheetHeader className="gap-0.5">
          <SheetDescription className="text-meta">{editor.replyId ? 'Edit rich reply' : 'New rich reply'}</SheetDescription>
          <SheetTitle asChild>
            <div className="flex items-center gap-2">
              <PencilLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Name"
                value={editor.nameEdited ? editor.name : name}
                maxLength={MAX_NAME}
                placeholder="Name it, or it’s named from step 1"
                onChange={(e) => onChange({ ...editor, name: e.target.value, nameEdited: true })}
                className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-section font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground hover:bg-muted focus:bg-muted"
              />
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                <Eye className="size-3.5" />
                {preview ? 'Edit' : 'Preview'}
              </Button>
            </div>
          </SheetTitle>
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </SheetHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <FormContext.Provider value={form}>
            <div ref={formRef} className={cn('min-h-0 space-y-8 overflow-y-auto px-6 py-6', preview && 'hidden lg:block')}>
              {editor.madeElsewhere && (
                <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">This reply was made outside Helo.ai, so only its type is known. Fill it in here, and saving replaces it.</p>
              )}

              <Step n={1} title="When should the agent send it?">
                <Textarea
                  ref={triggerRef}
                  aria-label="When should the agent send it?"
                  rows={2}
                  maxLength={MAX_TRIGGER}
                  value={editor.trigger}
                  onChange={(e) => onChange({ ...editor, trigger: e.target.value })}
                  onBlur={() => form.touch('trigger')}
                  placeholder="e.g. When a customer asks where your store is"
                  aria-invalid={triggerError ? true : undefined}
                />
                {triggerError ? (
                  <p className="text-xs text-destructive">{triggerError}</p>
                ) : (
                  !editor.trigger.trim() && (
                    <div className="flex flex-wrap gap-1.5">
                      {TRIGGER_EXAMPLES.map((t) => (
                        <button key={t} type="button" onClick={() => onChange({ ...editor, trigger: t })} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
                          {t.replace('When a customer ', '…')}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </Step>

              <Step n={2} title="What should it look like?">
                <div role="radiogroup" aria-label="Kind of reply" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {[...types, ...(showMore ? MORE : [])].map((t) => (
                    <TypeTile key={t.type} {...t} selected={editor.type === t.type} onSelect={() => editor.type !== t.type && onChange(switchType(editor, t.type))} />
                  ))}
                </div>
                {!showMore && (
                  <button type="button" onClick={() => setShowMore(true)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ChevronDown className="size-3.5" />
                    More kinds: cards, asking for a location
                  </button>
                )}
              </Step>

              <Step n={3} title="Write the message">
                <MessageFields draft={editor} businessAddress={businessAddress} onChange={(d) => onChange({ ...editor, ...d } as EditorState)} />
              </Step>

              {error && <InlineError message={error} onRetry={save} />}
            </div>
          </FormContext.Provider>

          <div className={cn('min-h-0 space-y-4 overflow-y-auto border-border bg-canvas px-6 py-6 lg:border-l', !preview && 'hidden lg:block')}>
            <p className="text-meta font-medium text-muted-foreground">How the customer sees it</p>
            <WhatsAppPreview draft={editor} />
            <details className="group text-xs text-muted-foreground">
              <summary className="cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden">What the agent is told ›</summary>
              <p className="mt-2 rounded-md border border-border bg-card p-3 whitespace-pre-wrap wrap-break-word">{compileRichReplySentence(editor)}</p>
            </details>
          </div>
        </div>

        <SheetFooter className="justify-between">
          <p className="text-xs text-muted-foreground">{showAll && issues.length ? `${issues.length === 1 ? '1 thing' : `${issues.length} things`} to fix before saving` : 'It goes live as soon as you save.'}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {editor.replyId ? 'Save changes' : 'Save rich reply'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold">
        <span aria-hidden className="flex size-5.5 items-center justify-center rounded-full bg-primary/10 text-meta font-semibold text-primary">
          {n}
        </span>
        {title}
      </h3>
      <div className="space-y-3 pl-8">{children}</div>
    </section>
  )
}

function TypeTile({ type, name, hint, selected, onSelect }: { type: RichReplyType; name: string; hint: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      title={hint}
      className={cn(
        'flex flex-col items-stretch gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-border-strong',
      )}
    >
      <MiniMock type={type} />
      <span className="px-0.5">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block text-meta text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

/** A thumbnail of the message, so the kinds read at a glance instead of by name. */
function MiniMock({ type }: { type: RichReplyType }) {
  const bubble = <span className="block h-1.5 w-4/5 rounded-full bg-muted-foreground/25" />
  const pill = (icon?: ReactNode) => (
    <span className="flex h-3.5 items-center justify-center gap-0.5 rounded bg-card text-primary shadow-[0_0_0_1px_var(--border)]">
      {icon}
      <span className="block h-1 w-6 rounded-full bg-primary/50" />
    </span>
  )
  const card = (
    <span className="flex flex-1 flex-col gap-0.5 rounded bg-card p-0.5 shadow-[0_0_0_1px_var(--border)]">
      <span className="flex h-5 items-center justify-center rounded-sm bg-muted">
        <ImageIcon className="size-2.5 text-muted-foreground" />
      </span>
      <span className="block h-1 w-3/4 rounded-full bg-muted-foreground/25" />
    </span>
  )
  const body = (() => {
    switch (type) {
      case 'interactive_reply_buttons':
        return (
          <>
            <span className="space-y-1 rounded bg-card p-1 shadow-[0_0_0_1px_var(--border)]">{bubble}</span>
            {pill()}
            {pill()}
          </>
        )
      case 'cta_url':
        return (
          <>
            <span className="space-y-1 rounded bg-card p-1 shadow-[0_0_0_1px_var(--border)]">{bubble}</span>
            {pill(<Link2 className="size-2" />)}
          </>
        )
      case 'interactive_list':
        return (
          <>
            <span className="space-y-1 rounded bg-card p-1 shadow-[0_0_0_1px_var(--border)]">{bubble}</span>
            {pill(<List className="size-2" />)}
          </>
        )
      case 'image':
      case 'location':
        return (
          <span className="flex h-full flex-1 items-center justify-center rounded bg-card shadow-[0_0_0_1px_var(--border)]">
            {type === 'image' ? <ImageIcon className="size-4 text-muted-foreground" /> : <MapPin className="size-4 text-primary" />}
          </span>
        )
      case 'carousel_url':
      case 'carousel_quick_reply':
        return (
          <span className="flex flex-1 gap-1">
            {card}
            {card}
          </span>
        )
      case 'location_request':
        return (
          <>
            <span className="space-y-1 rounded bg-card p-1 shadow-[0_0_0_1px_var(--border)]">{bubble}</span>
            {pill(<Navigation className="size-2" />)}
          </>
        )
      default:
        return <span className="space-y-1 rounded bg-card p-1 shadow-[0_0_0_1px_var(--border)]">{bubble}</span>
    }
  })()
  return <span className="flex h-14 flex-col justify-end gap-1 rounded-md bg-muted/70 p-1.5">{body}</span>
}
