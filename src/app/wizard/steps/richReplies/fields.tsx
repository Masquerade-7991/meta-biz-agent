import { useContext, useId, useRef, useState, type ReactNode } from 'react'
import { GripVertical, MapPin, Plus, X } from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { useWizard } from '@/app/wizard/WizardContext'
import { CANNED_FLOWS, newCarouselCard, newMenuOption, type RichReplyStarter } from '@/app/wizard/mockData'
import { RICH_REPLY_LIMITS as L, coordsFromMapsLink, rowIdFromTitle } from '@/app/wizard/richReplies'
import type { CarouselCard, ImageSource, InteractiveListBlanks } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { FormContext, urlSource } from './editorState'

// The message part of the rich reply editor: one small form per type, in WhatsApp's own words
// ("Message", "Button text", "Options"), no tooltips, and counters only when a limit is near.

const MAX_LOCATION_NAME = 100
const MAX_LOCATION_ADDRESS = 300


function Field({ id, label, optional, help, count, max, error, action, children }: {
  id?: string
  label: string
  optional?: boolean
  help?: string
  count?: number
  max?: number
  error?: string
  action?: ReactNode
  children: ReactNode
}) {
  const near = max !== undefined && count !== undefined && count >= max * 0.8
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <span className="flex items-center gap-2">
          {near && <span className={cn('text-meta tabular-nums', count > max ? 'text-destructive' : 'text-muted-foreground')}>{count}/{max}</span>}
          {action}
        </span>
      </div>
      {children}
      {error ? (
        <p id={id && `${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        help && <p className="text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  )
}

export function TextField({ field, label, value, onChange, max, optional, help, placeholder, rows, inputMode, action, errorFields }: {
  field: string
  label: string
  value: string
  onChange: (value: string) => void
  max?: number
  optional?: boolean
  help?: string
  placeholder?: string
  rows?: number
  inputMode?: 'url' | 'decimal'
  action?: ReactNode
  /** Other fields whose errors show here (e.g. a menu option's hidden row ID). */
  errorFields?: string[]
}) {
  const { issue, touch } = useContext(FormContext)
  const id = useId()
  const err = issue(field) ?? errorFields?.map(issue).find(Boolean)
  const common = {
    id,
    value,
    placeholder,
    'aria-invalid': err ? true : undefined,
    'aria-describedby': err ? `${id}-err` : undefined,
    onBlur: () => touch(field),
  }
  return (
    <Field id={id} label={label} optional={optional} help={help} count={max ? value.length : undefined} max={max} error={err} action={action}>
      {rows ? <Textarea rows={rows} {...common} onChange={(e) => onChange(e.target.value)} /> : <Input inputMode={inputMode} {...common} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

/** "+ Add footer" style link that reveals an optional part. */
function AddLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      <Plus className="size-3.5" />
      {children}
    </button>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <X className="size-4" />
    </button>
  )
}

function CountError({ field }: { field: string }) {
  const message = useContext(FormContext).issue(field)
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

/** An image (or header video): a link by default; something the agent already has (a knowledge
 *  document, a website page, a tool's answer) on request. Never an upload (PRD Appendix C). */
function ImageSourcePicker({ field, label, value, onChange, media = 'image', action }: {
  field: string
  label: string
  value: ImageSource
  onChange: (src: ImageSource) => void
  media?: 'image' | 'video'
  action?: ReactNode
}) {
  const { state, setSection } = useWizard()
  const { issue, touch } = useContext(FormContext)
  const id = useId()
  const listId = useId()
  const err = issue(field)
  const [other, setOther] = useState(value.kind !== 'url')
  const { documents, websites } = state.knowledge
  const tools = state.connections.actions
  const refOf = (x: { id: string; metaId?: string }) => x.metaId ?? x.id
  const pick = (next: ImageSource) => {
    onChange(next)
    touch(field)
  }
  const aria = { 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `${id}-err` : undefined }
  const missing = (what: string, section: 'knowledge' | 'connections', where: string) => (
    <p className="text-xs text-muted-foreground">
      No {what} yet.{' '}
      <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSection(section)}>
        Add one in {where}
      </button>
    </p>
  )
  const site = value.kind === 'website' ? websites.find((w) => refOf(w) === value.ref) : undefined
  const select = (placeholder: string, items: { key: string; value: string; label: string }[], onPick: (ref: string) => void) => (
    <Select value={value.ref || undefined} onValueChange={onPick}>
      <SelectTrigger className="w-full" {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.key} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <Field id={id} label={label} error={err} action={action}>
      {!other ? (
        <div className="space-y-1.5">
          <Input id={id} inputMode="url" {...aria} value={value.ref} onChange={(e) => onChange({ kind: 'url', ref: e.target.value, label: e.target.value })} onBlur={() => touch(field)} placeholder={`https:// link to the ${media}`} />
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setOther(true)}>
            Use one from your knowledge, website or a tool instead
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Select
            value={value.kind}
            onValueChange={(kind) => {
              if (kind === value.kind) return
              onChange({ kind: kind as ImageSource['kind'], ref: '', label: '' })
              if (kind === 'url') setOther(false)
            }}
          >
            <SelectTrigger className="w-full" aria-label={`Where the ${media} comes from`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="url">A link</SelectItem>
              <SelectItem value="document">A knowledge document</SelectItem>
              <SelectItem value="website">A page on your website</SelectItem>
              <SelectItem value="connector">A tool’s answer</SelectItem>
            </SelectContent>
          </Select>
          {value.kind === 'document' &&
            (documents.length
              ? select('Choose a document', documents.map((d) => ({ key: d.id, value: refOf(d), label: d.fileName })), (ref) => pick({ kind: 'document', ref, label: documents.find((d) => refOf(d) === ref)?.fileName ?? '' }))
              : missing('documents', 'knowledge', 'Knowledge'))}
          {value.kind === 'website' &&
            (websites.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {select('Choose a website', websites.map((w) => ({ key: w.id, value: refOf(w), label: w.url })), (ref) => pick({ kind: 'website', ref, label: websites.find((w) => refOf(w) === ref)?.url ?? '' }))}
                <Input aria-label="Page (optional)" list={listId} disabled={!value.ref} value={value.path ?? ''} onChange={(e) => onChange({ ...value, path: e.target.value || undefined })} placeholder="Page, e.g. /products (optional)" />
                <datalist id={listId}>{site?.subpages.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
            ) : (
              missing('websites', 'knowledge', 'Knowledge')
            ))}
          {value.kind === 'connector' &&
            (tools.length ? (
              <>
                {select('Choose a tool', tools.map((a) => ({ key: a.id, value: refOf(a), label: a.name })), (ref) => pick({ kind: 'connector', ref, label: tools.find((a) => refOf(a) === ref)?.name ?? '' }))}
                <p className="text-xs text-muted-foreground">Pick a tool whose answer includes a link to the {media}.</p>
              </>
            ) : (
              missing('tools', 'connections', 'Connections')
            ))}
          {value.kind === 'url' && <Input id={id} inputMode="url" {...aria} value={value.ref} onChange={(e) => onChange({ kind: 'url', ref: e.target.value, label: e.target.value })} onBlur={() => touch(field)} placeholder="https://" />}
        </div>
      )}
    </Field>
  )
}


/** The fields for one rich reply type. */
export function MessageFields({ draft, businessAddress, onChange }: { draft: RichReplyStarter; businessAddress: string; onChange: (draft: RichReplyStarter) => void }) {
  const up = <B,>(b: B, patch: Partial<B>) => onChange({ ...draft, blanks: { ...b, ...patch } } as unknown as RichReplyStarter)

  switch (draft.type) {
    case 'cta_url': {
      const b = draft.blanks
      const media = b.headerMedia
      return (
        <div className="space-y-4">
          {media && (
            <ImageSourcePicker
              field="headerMedia"
              label={media.mediaType === 'video' ? 'Video above the message' : 'Image above the message'}
              media={media.mediaType}
              value={media}
              onChange={(src) => up(b, { headerMedia: { ...src, mediaType: media.mediaType } })}
              action={<RemoveButton label="Remove the image" onClick={() => up(b, { headerMedia: undefined })} />}
            />
          )}
          <TextField field="messageText" label="Message" rows={3} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} placeholder="e.g. You can order directly from our website." />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField field="buttonLabel" label="Button text" max={L.labelMax} value={b.buttonLabel} onChange={(v) => up(b, { buttonLabel: v })} placeholder="e.g. Shop now" />
            <TextField field="link" label="Opens this link" inputMode="url" value={b.link} onChange={(v) => up(b, { link: v })} placeholder="https://" />
          </div>
          {b.footer !== undefined && (
            <TextField field="footer" label="Small print under the message" max={L.footerMax} value={b.footer} onChange={(v) => up(b, { footer: v })} placeholder="e.g. Free delivery on orders over ₹999" action={<RemoveButton label="Remove the small print" onClick={() => up(b, { footer: undefined })} />} />
          )}
          {(!media || b.footer === undefined) && (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {!media && <AddLink onClick={() => up(b, { headerMedia: { ...urlSource(), mediaType: 'image' } })}>Add an image</AddLink>}
              {!media && <AddLink onClick={() => up(b, { headerMedia: { ...urlSource(), mediaType: 'video' } })}>Add a video</AddLink>}
              {b.footer === undefined && <AddLink onClick={() => up(b, { footer: '' })}>Add small print</AddLink>}
            </div>
          )}
        </div>
      )
    }

    case 'image': {
      const b = draft.blanks
      return (
        <div className="space-y-4">
          <ImageSourcePicker field="image" label="Image" value={b.image} onChange={(image) => up(b, { image })} />
          <TextField field="caption" label="Caption" optional rows={2} max={L.bodyMax} value={b.caption} onChange={(v) => up(b, { caption: v })} />
        </div>
      )
    }

    case 'interactive_list': {
      const b = draft.blanks
      return (
        <div className="space-y-4">
          <TextField field="messageText" label="Message" rows={3} max={L.listBodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} placeholder="e.g. Here’s what we offer. Pick one to learn more." />
          <TextField field="menuButtonLabel" label="Button that opens the menu" max={L.labelMax} value={b.menuButtonLabel} onChange={(v) => up(b, { menuButtonLabel: v })} placeholder="e.g. See products" />
          <MenuOptions options={b.options} groupsEnabled={b.groupsEnabled} onChange={(options) => up(b, { options })} onToggleGroups={(groupsEnabled) => up(b, { groupsEnabled })} />
        </div>
      )
    }

    case 'interactive_reply_buttons': {
      const b = draft.blanks
      return (
        <div className="space-y-4">
          <TextField field="messageText" label="Message" rows={3} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} placeholder="e.g. How would you like to receive your order?" />
          <div className="space-y-2">
            <Label>Buttons</Label>
            {b.buttons.map((label, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <ListInput
                    field={`buttons.${i}`}
                    label={`Button ${i + 1}`}
                    max={L.labelMax}
                    value={label}
                    onChange={(v) => up(b, { buttons: b.buttons.map((x, j) => (j === i ? v : x)) })}
                    placeholder={['e.g. Home delivery', 'e.g. Store pickup', 'e.g. Not sure yet'][i]}
                  />
                </div>
                {b.buttons.length > L.buttonsMin && <span className="pt-2"><RemoveButton label={`Remove button ${i + 1}`} onClick={() => up(b, { buttons: b.buttons.filter((_, j) => j !== i) })} /></span>}
              </div>
            ))}
            <CountError field="buttons" />
            <p className="text-xs text-muted-foreground">Tapping a button sends its text back as the customer’s answer.</p>
            {b.buttons.length < L.buttonsMax && <AddLink onClick={() => up(b, { buttons: [...b.buttons, ''] })}>Add a button</AddLink>}
          </div>
        </div>
      )
    }

    case 'carousel_url':
    case 'carousel_quick_reply': {
      const b = draft.blanks
      return (
        <div className="space-y-4">
          <TextField field="messageText" label="Message" rows={2} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} />
          <CarouselCards cards={b.cards} hasLink={draft.type === 'carousel_url'} onChange={(cards) => up(b, { cards })} />
        </div>
      )
    }

    case 'location':
      return <LocationFields blanks={draft.blanks} businessAddress={businessAddress} onChange={(patch) => up(draft.blanks, patch)} />

    case 'location_request': {
      const b = draft.blanks
      return (
        <TextField
          field="messageText"
          label="Message"
          help="The customer always chooses whether to share."
          rows={3}
          max={L.bodyMax}
          value={b.messageText}
          onChange={(v) => up(b, { messageText: v })}
          placeholder="e.g. Share your location so we can check delivery to your area."
        />
      )
    }

    case 'flow': {
      // Not offered for new replies (PRD §4); kept editable for rows that already exist.
      const b = draft.blanks
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
          <TextField field="messageText" label="Message" rows={2} max={L.bodyMax} value={b.messageText} onChange={(v) => up(b, { messageText: v })} />
          <TextField field="buttonLabel" label="Button text" max={L.labelMax} value={b.buttonLabel} onChange={(v) => up(b, { buttonLabel: v })} />
        </div>
      )
    }
  }
}

/** A labelled-by-placeholder input for list items (buttons, options), with its error underneath. */
function ListInput({ field, label, value, onChange, max, placeholder, errorFields }: {
  field: string
  label: string
  value: string
  onChange: (v: string) => void
  max: number
  placeholder?: string
  errorFields?: string[]
}) {
  const { issue, touch } = useContext(FormContext)
  const id = useId()
  const err = issue(field) ?? errorFields?.map(issue).find(Boolean)
  const near = value.length >= max * 0.8
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input aria-label={label} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => touch(field)} placeholder={placeholder} className={near ? 'pr-14' : undefined} />
        {near && <span className={cn('absolute top-1/2 right-3 -translate-y-1/2 text-meta tabular-nums', value.length > max ? 'text-destructive' : 'text-muted-foreground')}>{value.length}/{max}</span>}
      </div>
      {err && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {err}
        </p>
      )}
    </div>
  )
}

function MenuOptions({ options, groupsEnabled, onChange, onToggleGroups }: {
  options: InteractiveListBlanks['options']
  groupsEnabled: boolean
  onChange: (options: InteractiveListBlanks['options']) => void
  onToggleGroups: (enabled: boolean) => void
}) {
  // Each option's ID (sent back when it's picked) follows its title, unless it was set elsewhere.
  const otherIds = (id: string) => options.filter((o) => o.id !== id).map((o) => o.rowId)
  const autoId = (title: string, id: string) => (title.trim() ? rowIdFromTitle(title, otherIds(id)) : '')
  const [kept] = useState(() => new Set(options.filter((o) => o.rowId && o.rowId !== autoId(o.title, o.id)).map((o) => o.id)))
  const edit = (id: string, patch: Partial<InteractiveListBlanks['options'][number]>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  return (
    <div className="space-y-2">
      <Label>Options</Label>
      <ol className="space-y-2">
        {options.map((o, i) => (
          <li key={o.id} className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5">
            <span className="mt-2 w-5 shrink-0 text-center text-meta text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-2">
              <ListInput
                field={`options.${o.id}.title`}
                errorFields={[`options.${o.id}.rowId`]}
                label={`Option ${i + 1}`}
                max={L.rowTitleMax}
                value={o.title}
                onChange={(title) => edit(o.id, kept.has(o.id) ? { title } : { title, rowId: autoId(title, o.id) })}
                placeholder="Option, e.g. Gift sets"
              />
              <ListInput field={`options.${o.id}.description`} label={`Option ${i + 1} description`} max={L.rowDescriptionMax} value={o.description} onChange={(description) => edit(o.id, { description })} placeholder="Short description (optional)" />
              {groupsEnabled && <ListInput field={`options.${o.id}.group`} label={`Option ${i + 1} heading`} max={L.rowTitleMax} value={o.group} onChange={(group) => edit(o.id, { group })} placeholder="Heading it sits under" />}
            </div>
            {options.length > L.rowsMin && <span className="pt-2"><RemoveButton label={`Remove option ${i + 1}`} onClick={() => onChange(options.filter((x) => x.id !== o.id))} /></span>}
          </li>
        ))}
      </ol>
      <CountError field="options" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {options.length < L.rowsMax ? <AddLink onClick={() => onChange([...options, newMenuOption()])}>Add an option</AddLink> : <span className="text-xs text-muted-foreground">That’s the most a menu can hold (10).</span>}
        <button type="button" onClick={() => onToggleGroups(!groupsEnabled)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          {groupsEnabled ? 'Remove headings' : 'Group options under headings'}
        </button>
      </div>
    </div>
  )
}

function CarouselCards({ cards, hasLink, onChange }: { cards: CarouselCard[]; hasLink: boolean; onChange: (cards: CarouselCard[]) => void }) {
  const dragIndex = useRef<number | null>(null)
  const edit = (id: string, patch: Partial<CarouselCard>) => onChange(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  function drop(target: number) {
    if (dragIndex.current === null || dragIndex.current === target) return
    const next = [...cards]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(target, 0, moved)
    onChange(next)
    dragIndex.current = null
  }
  return (
    <div className="space-y-2">
      <Label>Cards</Label>
      {cards.map((card, i) => (
        <div
          key={card.id}
          draggable
          onDragStart={() => {
            dragIndex.current = i
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
          className="space-y-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex items-center gap-2">
            <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-muted-foreground" />
            <p className="flex-1 text-sm font-medium">Card {i + 1}</p>
            {cards.length > L.cardsMin && <RemoveButton label={`Remove card ${i + 1}`} onClick={() => onChange(cards.filter((c) => c.id !== card.id))} />}
          </div>
          <ImageSourcePicker field={`cards.${card.id}.image`} label="Picture" value={card.image} onChange={(image) => edit(card.id, { image })} />
          <TextField field={`cards.${card.id}.cardText`} label="Text" rows={2} max={L.cardTextMax} value={card.cardText} onChange={(cardText) => edit(card.id, { cardText })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField field={`cards.${card.id}.buttonLabel`} label="Button text" max={L.labelMax} value={card.buttonLabel} onChange={(buttonLabel) => edit(card.id, { buttonLabel })} />
            {hasLink && <TextField field={`cards.${card.id}.link`} label="Opens this link" inputMode="url" value={card.link} onChange={(link) => edit(card.id, { link })} placeholder="https://" />}
          </div>
        </div>
      ))}
      <CountError field="cards" />
      {cards.length < L.cardsMax && <AddLink onClick={() => onChange([...cards, newCarouselCard()])}>Add a card</AddLink>}
    </div>
  )
}

function LocationFields({ blanks: b, businessAddress, onChange }: {
  blanks: Extract<RichReplyStarter, { type: 'location' }>['blanks']
  businessAddress: string
  onChange: (patch: Partial<Extract<RichReplyStarter, { type: 'location' }>['blanks']>) => void
}) {
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const id = useId()
  const pin = b.latitude.trim() && b.longitude.trim() ? `${b.latitude.trim()}, ${b.longitude.trim()}` : null
  function readLink(text: string) {
    setLink(text)
    if (!text.trim()) return setLinkError(null)
    const c = coordsFromMapsLink(text)
    if (c) {
      onChange(c)
      setLinkError(null)
    } else
      setLinkError(/goo\.gl|maps\.app/.test(text) ? 'Short links hide the pin. Open it, then copy the full link from your browser’s address bar.' : 'No pin found in that link. Copy the link of a place from Google Maps.')
  }
  return (
    <div className="space-y-4">
      <Field id={id} label="Pin on the map" error={linkError ?? undefined}>
        <Input id={id} inputMode="url" value={link} onChange={(e) => readLink(e.target.value)} placeholder="Paste a Google Maps link to your place" aria-invalid={linkError ? true : undefined} aria-describedby={linkError ? `${id}-err` : undefined} />
      </Field>
      {pin && !linkError && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <MapPin className="size-4" />
          Pin set at {pin}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField field="latitude" label="Latitude" inputMode="decimal" value={b.latitude} onChange={(v) => onChange({ latitude: v })} placeholder="e.g. 19.0596" />
        <TextField field="longitude" label="Longitude" inputMode="decimal" value={b.longitude} onChange={(v) => onChange({ longitude: v })} placeholder="e.g. 72.8295" />
      </div>
      <TextField field="placeName" label="Place name" optional max={MAX_LOCATION_NAME} value={b.placeName ?? ''} onChange={(v) => onChange({ placeName: v })} placeholder="e.g. Aurora Home Goods, Bandra West" />
      <TextField
        field="address"
        label="Address"
        optional
        rows={2}
        max={MAX_LOCATION_ADDRESS}
        value={b.address ?? ''}
        onChange={(v) => onChange({ address: v })}
        action={
          businessAddress.trim() && b.address !== businessAddress ? (
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onChange({ address: businessAddress })}>
              Use my business address
            </button>
          ) : undefined
        }
      />
    </div>
  )
}
