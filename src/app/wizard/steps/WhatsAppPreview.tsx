import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BatteryFull,
  Camera,
  CheckCheck,
  ClipboardList,
  ExternalLink,
  Image as ImageIcon,
  List,
  MapPin,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Play,
  Reply,
  Signal,
  Smile,
  Video,
  Wifi,
  X,
} from 'lucide-react'
import { useWizard } from '@/app/wizard/WizardContext'
import type { ImageSource, RichReply, RichReplyType } from '@/app/wizard/types'

/** What the preview needs from an editor draft: the type, its blanks, and the trigger. */
export type RichReplyDraft = {
  [T in RichReplyType]: { type: T; trigger: string; blanks: NonNullable<Extract<RichReply, { type: T }>['blanks']> }
}[RichReplyType]

// WhatsApp's own light-mode palette. Local on purpose: this file mocks another product's UI, so
// these must not leak into the app's tokens.
const WA = {
  header: '#008069',
  wallpaper: '#efeae2',
  doodle: '#d9d1c4',
  bubbleIn: '#ffffff',
  bubbleOut: '#d9fdd3',
  text: '#111b21',
  meta: '#667781',
  faint: '#aebac1',
  link: '#027eb5',
  tick: '#53bdeb',
  divider: '#e9edef',
  chip: '#ffffff',
  notice: '#ffeecd',
  noticeText: '#54656f',
  green: '#00a884',
  mapLand: '#e8eadf',
  mapRoad: '#ffffff',
  mapWater: '#aad3df',
  pin: '#ea4335',
  font: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}

// A few hand-drawn-ish strokes tiled at low contrast, the way WhatsApp's default wallpaper reads.
const DOODLE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='${WA.doodle}' stroke-width='1.4' opacity='0.75' stroke-linecap='round' stroke-linejoin='round'>
    <circle cx='18' cy='20' r='7'/><path d='M15 19h.01M21 19h.01M15 23q3 3 6 0'/>
    <path d='M70 12l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z'/>
    <path d='M100 50q8-8 14 0t-7 12q-13-4-7-12z'/>
    <rect x='12' y='70' width='22' height='16' rx='3'/><circle cx='23' cy='78' r='4'/>
    <path d='M55 95c4-8 12-8 16 0M52 60l8 8m0-8l-8 8'/>
    <path d='M90 92h18v14H90zM94 92v-4h10v4'/>
    <path d='M40 40q6-10 12 0t12 0'/>
  </svg>`,
)}")`

const TIME_IN = '10:42'
const TIME_OUT = '10:41'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'B'
}

/** Turns "When someone asks where they can buy online" into "Where you can buy online?"-ish text.
 *  ponytail: naive prefix strip + pronoun swap; the preview only needs something plausible. */
function sampleCustomerText(trigger: string, type: RichReplyType): string {
  let t = trigger
    .trim()
    .replace(/^(when(ever)?|if)\s+(someone|a customer|the customer|customers|they|people|a user|the user)\s+/i, '')
    .replace(/^(asks?|wants? to know|is asking|says|wants?|needs?|mentions?)\s+(about\s+)?/i, '')
    .replace(/\btheir\b/gi, 'your')
    .replace(/\bthey\b/gi, 'you')
    .replace(/\bthem\b/gi, 'you')
    .replace(/[.]+$/, '')
  if (!t) {
    const fallback: Record<RichReplyType, string> = {
      cta_url: 'Where can I order online?',
      image: 'Can you show me a picture?',
      interactive_list: 'What are my options?',
      interactive_reply_buttons: 'How does this work?',
      carousel_url: 'What do you have?',
      carousel_quick_reply: 'What do you have?',
      location: 'Where are you located?',
      location_request: 'Do you deliver to my area?',
      flow: 'I want to book something',
    }
    return fallback[type]
  }
  t = t[0].toUpperCase() + t.slice(1)
  return /^(what|where|when|how|who|which|why|can|do|does|is|are)\b/i.test(t) && !t.endsWith('?') ? `${t}?` : t
}

/** Shows `value`, or a faint placeholder so the layout never collapses while fields are empty. */
function Ph({ value, placeholder }: { value: string | undefined; placeholder: string }) {
  return value?.trim() ? <>{value}</> : <span style={{ color: WA.faint }}>{placeholder}</span>
}

function Meta({ out }: { out?: boolean }) {
  return (
    <span className="float-right -mb-1 ml-2 mt-1.5 inline-flex items-center gap-0.5" style={{ fontSize: 10.5, color: WA.meta }}>
      {out ? TIME_OUT : TIME_IN}
      {out && <CheckCheck className="size-3.5" style={{ color: WA.tick }} />}
    </span>
  )
}

/** A chat bubble with WhatsApp's little corner tail. `flush` drops the padding for media. */
function Bubble({ out, children, footer, flush }: { out?: boolean; children: ReactNode; footer?: ReactNode; flush?: boolean }) {
  const bg = out ? WA.bubbleOut : WA.bubbleIn
  return (
    <div className={out ? 'flex justify-end pl-10' : 'flex justify-start pr-8'}>
      <div
        className="relative max-w-full shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
        style={{
          background: bg,
          borderRadius: 7.5,
          [out ? 'borderTopRightRadius' : 'borderTopLeftRadius']: 0,
          // Interactive and media bubbles keep a steady width, like WhatsApp's, instead of hugging placeholder text.
          width: flush ? 240 : undefined,
          minWidth: footer ? 200 : undefined,
        }}
      >
        <svg
          viewBox="0 0 8 13"
          width="8"
          height="13"
          className="absolute top-0"
          style={out ? { right: -8 } : { left: -8, transform: 'scaleX(-1)' }}
          aria-hidden
        >
          <path d="M0 0h8L1.5 10.5C.9 11.4 0 11 0 10z" fill={bg} />
        </svg>
        <div className={flush ? 'p-[3px]' : 'px-2 pb-1.5 pt-1.5'} style={{ color: WA.text, fontSize: 13, lineHeight: '18px' }}>
          {children}
        </div>
        {footer}
      </div>
    </div>
  )
}

function BubbleButton({ icon: Icon, label, placeholder, onClick }: { icon: typeof Reply; label: string; placeholder: string; onClick?: () => void }) {
  const content = (
    <>
      <Icon className="size-4 shrink-0" />
      <span className="truncate">
        <Ph value={label} placeholder={placeholder} />
      </span>
    </>
  )
  const cls = 'flex w-full items-center justify-center gap-1.5 px-3 py-2'
  const style = { color: WA.link, fontSize: 13.5, borderTop: `1px solid ${WA.divider}`, fontWeight: 500 }
  return onClick ? (
    <button type="button" className={`${cls} rounded-b-[7.5px] focus-visible:outline-2 focus-visible:outline-offset-[-2px]`} style={style} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls} style={style}>
      {content}
    </div>
  )
}

/** A separate white pill under the bubble, used by reply buttons. */
function DetachedButton({ icon: Icon, label, placeholder }: { icon: typeof Reply; label: string; placeholder: string }) {
  return (
    <div className="pr-8">
      <div
        className="flex items-center justify-center gap-1.5 px-3 py-2 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
        style={{ background: WA.bubbleIn, borderRadius: 7.5, color: WA.link, fontSize: 13.5, fontWeight: 500 }}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">
          <Ph value={label} placeholder={placeholder} />
        </span>
      </div>
    </div>
  )
}

function MediaTile({ source, mediaType = 'image', tall }: { source: ImageSource | undefined; mediaType?: 'image' | 'video'; tall?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null)
  const h = tall ? 180 : 120
  const showImg = source?.kind === 'url' && source.ref.trim() && mediaType === 'image' && broken !== source.ref
  if (showImg) {
    return (
      <img
        src={source!.ref}
        alt=""
        className="block w-full object-cover"
        style={{ height: h, borderRadius: 6 }}
        onError={() => setBroken(source!.ref)}
      />
    )
  }
  const label = source?.label?.trim()
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-1.5 px-3 text-center"
      style={{ height: h, borderRadius: 6, background: '#dfe5e7', color: WA.meta, fontSize: 11.5 }}
    >
      {mediaType === 'video' ? (
        <span className="flex size-9 items-center justify-center rounded-full" style={{ background: 'rgba(11,20,26,0.45)' }}>
          <Play className="size-4 fill-white text-white" />
        </span>
      ) : (
        <ImageIcon className="size-6" />
      )}
      <span className="line-clamp-2 break-all">{label ? `${mediaType === 'video' ? 'Video' : 'Image'} from: ${label}` : `Choose ${mediaType === 'video' ? 'a video' : 'an image'}`}</span>
    </div>
  )
}

function MapTile() {
  // Streets and a river painted with gradients; enough to read as "a map" at a glance.
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height: 130,
        borderRadius: 6,
        backgroundColor: WA.mapLand,
        backgroundImage: [
          `linear-gradient(100deg, transparent 58%, ${WA.mapWater} 58%, ${WA.mapWater} 66%, transparent 66%)`,
          `linear-gradient(0deg, transparent 46%, ${WA.mapRoad} 46%, ${WA.mapRoad} 52%, transparent 52%)`,
          `linear-gradient(90deg, transparent 30%, ${WA.mapRoad} 30%, ${WA.mapRoad} 34%, transparent 34%)`,
          `linear-gradient(35deg, transparent 70%, ${WA.mapRoad} 70%, ${WA.mapRoad} 73%, transparent 73%)`,
          `repeating-linear-gradient(0deg, transparent 0 22px, rgba(255,255,255,0.55) 22px 24px)`,
          `repeating-linear-gradient(90deg, transparent 0 28px, rgba(255,255,255,0.55) 28px 30px)`,
        ].join(','),
      }}
    >
      <MapPin className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-full" style={{ color: WA.pin, fill: WA.pin }} strokeWidth={1.5} stroke="#a50e0e" />
    </div>
  )
}

function ListSheet({ title, draft, onClose }: { title: string; draft: Extract<RichReplyDraft, { type: 'interactive_list' }>; onClose: () => void }) {
  const { options, groupsEnabled } = draft.blanks
  const groups = groupsEnabled
    ? [...new Set(options.map((o) => o.group.trim()))].map((g) => ({ heading: g, rows: options.filter((o) => o.group.trim() === g) }))
    : [{ heading: '', rows: options }]
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end" style={{ background: 'rgba(11,20,26,0.4)' }} onClick={onClose}>
      <div
        role="dialog"
        aria-label="List options"
        className="max-h-[75%] overflow-y-auto rounded-t-2xl pb-3"
        style={{ background: WA.bubbleIn, color: WA.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full" style={{ background: WA.divider }} />
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button type="button" aria-label="Close list" onClick={onClose} className="rounded-full focus-visible:outline-2" style={{ color: WA.meta }}>
            <X className="size-5" />
          </button>
          <span className="flex-1 truncate text-center" style={{ fontSize: 15, fontWeight: 500 }}>
            <Ph value={title} placeholder="Button text" />
          </span>
          <span className="w-5" />
        </div>
        {groups.map((g, gi) => (
          <div key={gi}>
            {groupsEnabled && (
              <div className="px-4 pb-1 pt-3" style={{ fontSize: 12.5, color: WA.header, fontWeight: 500 }}>
                <Ph value={g.heading} placeholder="Group heading" />
              </div>
            )}
            {g.rows.map((o) => (
              <div key={o.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${WA.divider}` }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 14 }}>
                    <Ph value={o.title} placeholder="Row title" />
                  </div>
                  {o.description.trim() && (
                    <div className="line-clamp-2" style={{ fontSize: 12.5, color: WA.meta }}>
                      {o.description}
                    </div>
                  )}
                </div>
                <span className="size-[18px] shrink-0 rounded-full" style={{ border: `2px solid ${WA.faint}` }} />
              </div>
            ))}
          </div>
        ))}
        <div className="px-4 pt-3 text-center" style={{ fontSize: 11.5, color: WA.meta }}>
          Tap an option to send it
        </div>
      </div>
    </div>
  )
}

function BusinessMessage({ draft, onOpenList }: { draft: RichReplyDraft; onOpenList: () => void }) {
  switch (draft.type) {
    case 'cta_url': {
      const b = draft.blanks
      return (
        <Bubble footer={<BubbleButton icon={ExternalLink} label={b.buttonLabel} placeholder="Button label" />}>
          {b.headerMedia && (
            <div className="-mx-[5px] -mt-[3px] mb-1.5">
              <MediaTile source={b.headerMedia} mediaType={b.headerMedia.mediaType} />
            </div>
          )}
          <div className="whitespace-pre-wrap break-words">
            <Ph value={b.messageText} placeholder="Message body" />
          </div>
          {b.footer?.trim() && (
            <div className="mt-0.5 break-words" style={{ fontSize: 11.5, color: WA.meta }}>
              {b.footer}
            </div>
          )}
          <Meta />
        </Bubble>
      )
    }
    case 'image': {
      const b = draft.blanks
      return (
        <Bubble flush>
          <MediaTile source={b.image} tall />
          <div className="px-[5px] pb-1 pt-1">
            {b.caption.trim() && <div className="whitespace-pre-wrap break-words">{b.caption}</div>}
            <Meta />
          </div>
        </Bubble>
      )
    }
    case 'interactive_list': {
      const b = draft.blanks
      return (
        <Bubble footer={<BubbleButton icon={List} label={b.menuButtonLabel} placeholder="Button text" onClick={onOpenList} />}>
          <div className="whitespace-pre-wrap break-words">
            <Ph value={b.messageText} placeholder="Message body" />
          </div>
          <Meta />
        </Bubble>
      )
    }
    case 'interactive_reply_buttons': {
      const b = draft.blanks
      return (
        <div className="space-y-[3px]">
          <Bubble>
            <div className="whitespace-pre-wrap break-words">
              <Ph value={b.messageText} placeholder="Message body" />
            </div>
            <Meta />
          </Bubble>
          {b.buttons.slice(0, 3).map((label, i) => (
            <DetachedButton key={i} icon={Reply} label={label} placeholder={`Button ${i + 1}`} />
          ))}
        </div>
      )
    }
    case 'location': {
      const b = draft.blanks
      return (
        <Bubble flush>
          <MapTile />
          <div className="px-[5px] pb-1 pt-1.5">
            <div className="truncate" style={{ color: WA.link, fontWeight: 500 }}>
              <Ph value={b.placeName} placeholder={b.latitude && b.longitude ? `${b.latitude}, ${b.longitude}` : 'Pinned location'} />
            </div>
            {b.address?.trim() && (
              <div className="line-clamp-2" style={{ fontSize: 12, color: WA.meta }}>
                {b.address}
              </div>
            )}
            <Meta />
          </div>
        </Bubble>
      )
    }
    case 'location_request':
      return (
        <Bubble footer={<BubbleButton icon={MapPin} label="Send location" placeholder="" />}>
          <div className="whitespace-pre-wrap break-words">
            <Ph value={draft.blanks.messageText} placeholder="Message body" />
          </div>
          <Meta />
        </Bubble>
      )
    case 'carousel_url':
    case 'carousel_quick_reply': {
      const b = draft.blanks
      const isUrl = draft.type === 'carousel_url'
      return (
        <div className="space-y-1.5">
          <Bubble>
            <div className="whitespace-pre-wrap break-words">
              <Ph value={b.messageText} placeholder="Message body" />
            </div>
            <Meta />
          </Bubble>
          <div className="flex snap-x gap-2 overflow-x-auto pb-1" tabIndex={0} aria-label="Carousel cards">
            {b.cards.map((c, i) => (
              <div
                key={c.id}
                className="w-[200px] shrink-0 snap-start overflow-hidden shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                style={{ background: WA.bubbleIn, borderRadius: 7.5 }}
              >
                <div className="p-[3px]">
                  <MediaTile source={c.image} />
                </div>
                <div className="line-clamp-3 px-2 pb-1.5 pt-1 break-words" style={{ fontSize: 13, color: WA.text, lineHeight: '17px', minHeight: 40 }}>
                  <Ph value={c.cardText} placeholder={`Card ${i + 1} text`} />
                </div>
                <BubbleButton icon={isUrl ? ExternalLink : Reply} label={c.buttonLabel} placeholder="Button label" />
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'flow':
      return (
        <Bubble footer={<BubbleButton icon={ClipboardList} label={draft.blanks.buttonLabel} placeholder="Button label" />}>
          <div className="whitespace-pre-wrap break-words">
            <Ph value={draft.blanks.messageText} placeholder="Message body" />
          </div>
          <Meta />
        </Bubble>
      )
  }
}

export function WhatsAppPreview({ draft }: { draft: RichReplyDraft }) {
  const { state } = useWizard()
  const [listOpen, setListOpen] = useState(false)
  const name = state.identity.companyName.trim() || state.gate.selectedWabaName?.trim() || state.identity.agentName.trim() || 'Your business'

  return (
    <section
      tabIndex={0}
      aria-label="Preview of the message the customer will see"
      className="mx-auto w-full max-w-[320px] rounded-[2.4rem] p-[9px] shadow-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      style={{ background: '#1f2328', fontFamily: WA.font }}
    >
      <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[1.9rem]" style={{ background: WA.wallpaper }}>
        {/* Status bar */}
        <div className="flex items-center justify-between px-6 pb-1 pt-2.5 text-white" style={{ background: WA.header, fontSize: 12, fontWeight: 600 }}>
          <span>9:41</span>
          <span className="flex items-center gap-1" aria-hidden>
            <Signal className="size-3.5" />
            <Wifi className="size-3.5" />
            <BatteryFull className="size-4" />
          </span>
        </div>
        {/* Chat header */}
        <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-white" style={{ background: WA.header }}>
          <ArrowLeft className="size-5 shrink-0" aria-hidden />
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: '#dfe5e7', color: '#54656f', fontSize: 12.5, fontWeight: 600 }}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate" style={{ fontSize: 14.5, fontWeight: 500 }}>
              {name}
            </div>
            <div className="truncate opacity-80" style={{ fontSize: 11.5 }}>
              Business account
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-3.5 pr-1" aria-hidden>
            <Video className="size-[18px]" />
            <Phone className="size-4" />
            <MoreVertical className="size-4" />
          </span>
        </div>

        {/* Conversation */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2" style={{ backgroundImage: DOODLE }}>
          <div className="mt-auto space-y-2">
            <div className="flex justify-center">
              <span className="rounded-md px-2 py-0.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]" style={{ background: WA.chip, color: WA.noticeText, fontSize: 11 }}>
                Today
              </span>
            </div>
            <div className="mx-3 rounded-md px-2 py-1 text-center" style={{ background: WA.notice, color: WA.noticeText, fontSize: 10.5, lineHeight: '14px' }}>
              This business uses a secure service from Meta to manage this chat.
            </div>
            <Bubble out>
              <span className="break-words">{sampleCustomerText(draft.trigger, draft.type)}</span>
              <Meta out />
            </Bubble>
            <BusinessMessage draft={draft} onOpenList={() => setListOpen(true)} />
          </div>
        </div>

        {/* Composer */}
        <div className="flex items-center gap-1.5 px-1.5 pb-3 pt-1.5" aria-hidden>
          <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-white px-3" style={{ color: WA.meta, fontSize: 13.5 }}>
            <Smile className="size-5 shrink-0" />
            <span className="flex-1">Message</span>
            <Paperclip className="size-[18px] shrink-0 -rotate-45" />
            <Camera className="size-[18px] shrink-0" />
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: WA.green }}>
            <Mic className="size-[18px]" />
          </span>
        </div>

        {listOpen && draft.type === 'interactive_list' && (
          <ListSheet title={draft.blanks.menuButtonLabel} draft={draft} onClose={() => setListOpen(false)} />
        )}
      </div>
    </section>
  )
}
