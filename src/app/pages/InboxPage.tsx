import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Ban, Bot, Check, CheckCheck, Clock, FileText, Hand, ListChecks, Loader2, MessageSquareText, MoreHorizontal, Paperclip, Send, Sparkles, StickyNote, Undo2, Wrench, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Textarea } from '@/app/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { WA } from '@/app/wizard/steps/whatsappTheme'
import type { Member } from '@/app/auth/api'
import { errorDetail, errorText } from '@/app/api/meta'
import {
  addNote,
  assignChat,
  clearSampleChats,
  fillCanned,
  getChat,
  listCanned,
  listChats,
  loadSampleChats,
  markChatRead,
  sendPresence,
  blockChat,
  sendMedia,
  sendReply,
  setChatControl,
  simulateCustomerMessage,
  suggestReply,
  summarizeChat,
  type CannedResponse,
  type ChatDetail,
  type ChatFilter,
  type ChatMessage,
  type ChatSummary,
  type SavedView,
  type SearchHit,
  deleteView,
  listViews,
  saveView,
  searchMessages,
} from '@/app/api/inbox'
import { cn, initialsOf } from '@/app/lib/utils'
import { getSupportSettings } from '@/app/api/tickets'
import { TicketPanel } from './TicketPanel'
import { SendTemplateDialog } from './SendTemplateDialog'
import { TEXT_SM, TEXT_XS } from '@/app/lib/text'
import { useMembers } from '@/app/auth/useMembers'
import { usePolling } from '@/app/lib/usePolling'
import { PillTabs, SearchInput } from '@/app/components/Filters'
import { customerLabel, isBsuid, NO_CONTROL_HIDDEN } from '@/app/lib/customer'
import { MediaView } from '@/app/inbox/MediaView'
import { ACCEPT, checkMedia, formatSize } from '@/app/inbox/media'
import { EmojiPicker } from '@/app/inbox/EmojiPicker'
import { WindowChip } from '@/app/inbox/WindowChip'
import { FollowUpBanner, FollowUpMenu } from '@/app/inbox/FollowUpMenu'
import { InteractiveDialog } from '@/app/inbox/InteractiveDialog'
import { can } from '@/app/lib/permissions'
import { useAuth } from '@/app/auth/AuthContext'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'

// Live events that change the chat list, and the open chat.
const LIVE_INBOX = ['message.', 'conversation.', 'ticket.']
const LIVE_CHAT = ['message.', 'conversation.']

const POLL_MS = 5000
const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'ai', label: 'AI handling' },
  { id: 'snoozed', label: 'Snoozed' },
]

const display = (c: { name?: string | null; phone: string; username?: string }) => c.name || customerLabel(c.phone, c.username)
const initials = (c: { name?: string | null; phone: string }) => (c.name ? initialsOf(c.name) : '#')
function when(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor((today.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  return days === 1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
const dayLabel = (iso: string) => {
  const w = when(iso)
  return w.includes(':') ? 'Today' : w
}
/** WhatsApp's own formatting: *bold*, _italic_, ~strike~. */
function waText(s: string): ReactNode[] {
  // Markers only count at word edges, as in WhatsApp: order_update_v2 stays plain.
  return s.split(/((?<![\p{L}\p{N}])(?:\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)(?![\p{L}\p{N}]))/gu).map((part, i) => {
    const inner = part.slice(1, -1)
    if (/^\*[^*]+\*$/.test(part)) return <strong key={i}>{inner}</strong>
    if (/^_[^_]+_$/.test(part)) return <em key={i}>{inner}</em>
    if (/^~[^~]+~$/.test(part)) return <s key={i}>{inner}</s>
    return <Fragment key={i}>{part}</Fragment>
  })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })


function ChatRow({ c, active, onOpen }: { c: ChatSummary; active: boolean; onOpen: () => void }) {
  const who = c.preview?.author === 'ai' ? 'AI: ' : c.preview?.author === 'agent' ? 'You: ' : ''
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none', active && 'bg-muted')}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>
        {initials(c)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate" style={{ ...TEXT_SM, fontWeight: c.unread ? 'var(--font-weight-semi-bold)' : 'var(--font-weight-medium)' }}>
            {display(c)}
          </span>
          <span className={cn('shrink-0', c.unread ? 'text-primary' : 'text-muted-foreground')} style={TEXT_XS}>
            {when(c.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground" style={TEXT_XS}>
            {c.preview ? who + (c.preview.body ?? 'Sent a message') : 'No messages yet'}
          </span>
          {c.unread > 0 && (
            <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-primary-foreground" style={{ fontSize: '0.6875rem', lineHeight: '1.25rem' }}>
              {c.unread}
            </span>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded px-1.5', c.owner === 'ai' ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-foreground')} style={{ fontSize: '0.6875rem', lineHeight: '1.125rem' }}>
            {c.owner === 'ai' ? <Bot className="size-3" /> : <Hand className="size-3" />}
            {c.owner === 'ai' ? 'AI' : 'Team'}
          </span>
          {c.sample && (
            <span className="rounded bg-muted px-1.5 text-muted-foreground" style={{ fontSize: '0.6875rem', lineHeight: '1.125rem' }}>
              Sample
            </span>
          )}
          {c.snoozedUntil && Date.parse(c.snoozedUntil) > Date.now() && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-muted-foreground" style={{ fontSize: '0.6875rem', lineHeight: '1.125rem' }}>
              <Clock className="size-3" /> until {when(c.snoozedUntil)}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function Bubble({ m, highlight }: { m: ChatMessage; highlight?: boolean }) {
  if (m.kind === 'event')
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-md px-3 py-1" style={{ ...TEXT_XS, background: WA.notice, color: WA.noticeText }}>
          {m.body} &middot; {time(m.at)}
        </span>
      </div>
    )
  if (m.kind === 'note')
    return (
      <div className="mx-auto w-full max-w-xl rounded-lg border border-warning/40 bg-warning/10 px-3 py-2" style={TEXT_SM}>
        <p className="flex items-center gap-1.5 text-muted-foreground" style={TEXT_XS}>
          <StickyNote className="size-3" /> Internal note &middot; {m.authorName ?? 'Team'} &middot; {time(m.at)}
        </p>
        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
      </div>
    )
  const out = m.direction === 'out'
  return (
    <div id={`msg-${m.id}`} className={cn('flex rounded-lg transition-colors', out ? 'justify-end pl-16' : 'justify-start pr-16', highlight && 'bg-primary/15 ring-2 ring-primary/40')}>
      <div className="max-w-136 rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm" style={{ background: out ? WA.bubbleOut : WA.bubbleIn, color: WA.text, fontFamily: WA.font, fontSize: 14.2, lineHeight: '19px' }}>
        {out && (
          <p className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: m.author === 'ai' ? WA.green : WA.link }}>
            {m.author === 'ai' ? <Bot className="size-3" /> : null}
            {m.author === 'ai' ? 'AI agent' : (m.authorName ?? 'Team')}
          </p>
        )}
        {m.media && (
          <div className="pb-1">
            <MediaView media={m.media} />
          </div>
        )}
        {m.media ? (
          m.media.caption && <p className="whitespace-pre-wrap wrap-break-word">{waText(m.media.caption)}</p>
        ) : m.body === null ? (
          <p className="italic" style={{ color: WA.meta }}>
            Customer sent a message. The text shows here once WhatsApp webhooks are connected.
          </p>
        ) : (
          <p className="whitespace-pre-wrap wrap-break-word">{m.body ? waText(m.body) : m.tools?.length ? 'Looked something up' : ''}</p>
        )}
        {!!m.tools?.length && (
          <p className="mt-1 flex flex-wrap gap-1">
            {m.tools.map((t, i) => (
              <span key={`${t}${i}`} className="inline-flex items-center gap-1 rounded px-1.5" style={{ background: 'rgba(0,0,0,0.05)', fontSize: 11, color: WA.meta }}>
                <Wrench className="size-2.5" />
                {t}
              </span>
            ))}
          </p>
        )}
        <p className="mt-0.5 flex items-center justify-end gap-1" style={{ fontSize: 11, color: WA.meta }}>
          {m.turnId && <span title="Meta shares a short preview of each agent reply">Preview &middot; </span>}
          {time(m.at)}
          {m.author === 'agent' && m.status && (m.status === 'read' ? <CheckCheck className="size-3.5" style={{ color: WA.tick }} /> : m.status === 'delivered' ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />)}
        </p>
      </div>
    </div>
  )
}

/** The chat; `focusId` (a search hit) is scrolled to and highlighted instead of jumping to the end. */
function Thread({ messages, focusId }: { messages: ChatMessage[]; focusId?: string | null }) {
  const end = useRef<HTMLDivElement>(null)
  const count = messages.length
  useEffect(() => {
    const hit = focusId ? document.getElementById(`msg-${focusId}`) : null
    if (hit) hit.scrollIntoView({ block: 'center' })
    else end.current?.scrollIntoView({ block: 'end' })
  }, [count, focusId])
  let lastDay = ''
  return (
    <div className="space-y-1.5 px-4 py-4 md:px-8" style={{ background: WA.wallpaper }}>
      {messages.map((m) => {
        const d = dayLabel(m.at)
        const sep = d !== lastDay
        lastDay = d
        return (
          <div key={m.id} className="space-y-1.5">
            {sep && (
              <div className="flex justify-center py-2">
                <span className="rounded-md px-2.5 py-1 shadow-sm" style={{ background: WA.chip, color: WA.meta, fontSize: 12.5 }}>
                  {d}
                </span>
              </div>
            )}
            <Bubble m={m} highlight={m.id === focusId} />
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function Composer({ chat, canned, aiSummary, onSent, onSummary }: { chat: ChatDetail; canned: CannedResponse[]; aiSummary: boolean; onSent: (d: ChatDetail) => void; onSummary: (text: string) => void }) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(0)
  const [assist, setAssist] = useState<'suggest' | 'summary' | null>(null)
  const [templating, setTemplating] = useState(false)
  const [buttonsOpen, setButtonsOpen] = useState(false)
  // An attachment waiting to be sent; the draft becomes its caption.
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const fileInput = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const lastPing = useRef(0)
  const { conversation: conv, contact } = chat
  async function runAssist(kind: 'suggest' | 'summary') {
    setAssist(kind)
    try {
      if (kind === 'suggest') {
        setMode('reply')
        setDraft((await suggestReply(conv.phone)).text)
      } else onSummary((await summarizeChat(conv.phone)).text)
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setAssist(null)
    }
  }
  const slash = mode === 'reply' && /^\/\S*$/.test(draft) ? draft.toLowerCase() : null
  const matches = slash !== null ? canned.filter((c) => c.shortcut.startsWith(slash) || c.title.toLowerCase().includes(slash.slice(1))).slice(0, 6) : []
  const locked = mode === 'reply' && !conv.windowOpen

  function attach(f: File | undefined) {
    if (!f) return
    const check = checkMedia(f.type, f.size)
    if ('error' in check) return void toast.error(check.error)
    setMode('reply')
    setFile(f)
    box.current?.focus()
  }
  /** Puts an emoji where the cursor is. */
  function insert(text: string) {
    const el = box.current
    const at = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? at
    setDraft(draft.slice(0, at) + text + draft.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + text.length, at + text.length)
    })
  }
  const applyCanned = (c: CannedResponse) => {
    setDraft(fillCanned(c.body, { name: contact?.name, phone: conv.phone }))
    setPick(0)
  }
  async function submit() {
    const text = draft.trim()
    if ((!text && !file) || busy || locked) return
    setBusy(true)
    try {
      if (file) {
        setProgress(0)
        onSent(await sendMedia(conv.phone, file, text, setProgress))
        setFile(null)
      } else onSent(mode === 'note' ? await addNote(conv.phone, text) : await sendReply(conv.phone, text))
      setDraft('')
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
    } else if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      applyCanned(matches[Math.min(pick, matches.length - 1)])
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div
      className={cn('relative border-t border-border bg-background px-4 py-3', dragging && 'ring-2 ring-primary ring-inset')}
      onDragOver={(e) => {
        if (locked || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!locked) attach(e.dataTransfer.files[0])
      }}
    >
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
          attach(e.target.files?.[0])
          e.target.value = ''
        }} />
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Message type">
        {(['reply', 'note'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn('rounded-md px-2.5 py-1 whitespace-nowrap', mode === m ? (m === 'note' ? 'bg-warning/15' : 'bg-muted') : 'text-muted-foreground hover:bg-muted/60')}
            style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-medium)' }}
          >
            {m === 'reply' ? 'Reply' : 'Internal note'}
          </button>
        ))}
        <span className="ml-2 flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={assist !== null || !conv.windowOpen} onClick={() => void runAssist('suggest')} title="Ask your AI agent how it would answer">
            {assist === 'suggest' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            <span style={TEXT_XS}>Suggest reply</span>
          </Button>
          {mode === 'reply' && !locked && (
            <>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => fileInput.current?.click()} aria-label="Attach a file" title="Attach a photo, video, audio or document (or drop it here)">
                <Paperclip className="size-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={busy || !!file} onClick={() => setButtonsOpen(true)} title="Send reply buttons or a list">
                <ListChecks className="size-3.5" />
                <span style={TEXT_XS}>Buttons</span>
              </Button>
            </>
          )}
          <EmojiPicker onPick={insert} disabled={locked && mode === 'reply'} />
          {aiSummary && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={assist !== null} onClick={() => void runAssist('summary')}>
              {assist === 'summary' ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              <span style={TEXT_XS}>Summarize</span>
            </Button>
          )}
        </span>
        {mode === 'reply' && conv.owner === 'ai' && conv.windowOpen && (
          <span className="ml-auto hidden text-muted-foreground sm:inline" style={TEXT_XS}>
            Replying takes the chat over from the AI agent.
          </span>
        )}
      </div>
      {locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted px-3 py-2.5 text-muted-foreground" style={TEXT_SM}>
          <Clock className="size-4 shrink-0" />
          <span className="min-w-48 flex-1">WhatsApp allows free replies only within 24 hours of the customer&rsquo;s last message. Send an approved template to restart the chat.</span>
          <Button size="sm" onClick={() => setTemplating(true)}>
            <Send className="size-4" />
            Send a template
          </Button>
          {templating && (
            <SendTemplateDialog
              phone={conv.phone}
              name={contact?.name}
              onClose={() => setTemplating(false)}
              onSent={() => {
                setTemplating(false)
                toast.success('Template sent.')
                void getChat(conv.phone).then(onSent)
              }}
            />
          )}
        </div>
      ) : (
        <div className="relative">
          {matches.length > 0 && (
            <ul className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-popover shadow-md" role="listbox" aria-label="Canned responses">
              {matches.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === pick}>
                  <button type="button" onMouseDown={(e) => {
                      e.preventDefault()
                      applyCanned(c)
                    }} className={cn('block w-full px-3 py-2 text-left', i === pick && 'bg-muted')}>
                    <span style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>{c.shortcut}</span>
                    <span className="ml-2 text-muted-foreground" style={TEXT_XS}>
                      {c.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {file && (
            <div className="mb-2 flex items-center gap-3 rounded-md border border-border p-2">
              {preview ? <img src={preview} alt="" className="size-12 rounded object-cover" /> : <FileText className="size-8 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={TEXT_SM}>
                  {file.name}
                </span>
                <span className="text-muted-foreground" style={TEXT_XS}>
                  {formatSize(file.size)}
                  {progress !== null && ` · uploading ${Math.round(progress * 100)}%`}
                </span>
                {progress !== null && (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full bg-primary transition-[width]" style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
              </span>
              <Button type="button" size="icon" variant="ghost" aria-label="Remove attachment" disabled={busy} onClick={() => setFile(null)}>
                <X className="size-4" />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={box}
              value={draft}
              onPaste={(e) => {
                const f = e.clipboardData.files[0]
                if (f && mode === 'reply') {
                  e.preventDefault()
                  attach(f)
                }
              }}
              onChange={(e) => {
                setDraft(e.target.value)
                setPick(0)
                // Tell teammates someone is typing here, at most every 5 seconds.
                if (Date.now() - lastPing.current > 5000) {
                  lastPing.current = Date.now()
                  void sendPresence(conv.phone, true).catch(() => {})
                }
              }}
              onKeyDown={onKey}
              rows={2}
              placeholder={mode === 'note' ? 'Only your team sees notes' : file ? 'Add a caption (optional)' : 'Type a reply, or / for canned responses'}
              aria-label={mode === 'note' ? 'Internal note' : 'Reply'}
              className={cn('max-h-40 min-h-11 resize-none', mode === 'note' && 'bg-warning/5')}
            />
            <Button onClick={() => void submit()} disabled={(!draft.trim() && !file) || busy} aria-label={mode === 'note' ? 'Add note' : 'Send reply'}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : mode === 'note' ? <StickyNote className="size-4" /> : <Send className="size-4" />}
              {mode === 'note' ? 'Add note' : 'Send'}
            </Button>
          </div>
        </div>
      )}
      {buttonsOpen && (
        <InteractiveDialog
          phone={conv.phone}
          initialText={draft}
          onClose={() => setButtonsOpen(false)}
          onSent={(d) => {
            setButtonsOpen(false)
            setDraft('')
            onSent(d)
          }}
        />
      )}
    </div>
  )
}

/** Block the customer on WhatsApp (or unblock), after a confirmation that says what it does. */
function BlockMenu({ chat, onChange }: { chat: ChatDetail; onChange: (d: ChatDetail) => void }) {
  const [confirm, setConfirm] = useState(false)
  const blocked = !!chat.contact?.blocked
  const run = (block: boolean) =>
    blockChat(chat.conversation.phone, block).then(
      (d) => {
        onChange(d)
        toast.success(block ? 'Blocked on WhatsApp. They can’t message you any more.' : 'Unblocked.')
      },
      (err) => toast.error(errorDetail(err)),
    )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-9" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {blocked ? (
            <DropdownMenuItem onSelect={() => void run(false)}>Unblock on WhatsApp</DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm(true)} disabled={isBsuid(chat.conversation.phone)}>
              <Ban className="size-4" /> Block on WhatsApp
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        title="Block this customer on WhatsApp?"
        description="They won’t be able to message this number, and broadcasts skip them. You can unblock them later, here or on the WhatsApp page."
        confirmLabel="Block"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void run(true)
        }}
      />
    </>
  )
}

function ChatHeader({ chat, members, onChange }: { chat: ChatDetail; members: Member[]; onChange: (d: ChatDetail) => void }) {
  const [busy, setBusy] = useState(false)
  const { me } = useAuth()
  const { conversation: conv, contact } = chat
  const assignee = members.find((m) => m.userId === conv.assigneeId)
  // Agents take a chat or let it go; handing it to someone else is for supervisors and up.
  const reassign = can(me?.role, 'tickets.reassign')
  const assignable = reassign ? members : members.filter((m) => m.userId === me?.user.id)
  const lockedAssign = !reassign && !!conv.assigneeId && conv.assigneeId !== me?.user.id
  async function run(fn: () => Promise<ChatDetail>, done?: string) {
    setBusy(true)
    try {
      onChange(await fn())
      if (done) toast.success(done)
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <p className="truncate" style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>
          {display({ name: contact?.name, phone: conv.phone, username: contact?.username })}
          {contact?.blocked && (
            <Badge variant="destructive" className="ml-2 align-middle">
              Blocked
            </Badge>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground" style={TEXT_XS}>
          <span>
            {conv.owner === 'ai' ? 'The AI agent is answering this chat' : assignee ? `With ${assignee.name}` : 'With your team, unassigned'}
            {contact?.name ? ` · ${customerLabel(conv.phone, contact.username)}` : ''}
          </span>
          <WindowChip lastInboundAt={conv.lastInboundAt} />
        </p>
        {!!chat.viewers?.length && (
          <p className="text-primary" style={TEXT_XS}>
            {chat.viewers.map((v) => `${v.name} is ${v.typing ? 'typing…' : 'viewing'}`).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FollowUpMenu chat={chat} onChange={onChange} />
        {can(me?.role, 'numbers.edit') && <BlockMenu chat={chat} onChange={onChange} />}
        <Select value={conv.assigneeId ?? 'none'} onValueChange={(v) => void run(() => assignChat(conv.phone, v === 'none' ? null : v))} disabled={busy || lockedAssign}>
          <SelectTrigger className="h-9 w-44" aria-label="Assign to" title={lockedAssign ? 'Assigned to someone else. A supervisor can reassign it.' : undefined}>
            <SelectValue>{assignee?.name ?? (conv.assigneeId ? 'Assigned' : 'Unassigned')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {assignable.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isBsuid(conv.phone) ? (
          // Thread control needs a phone number, so this chat can't change hands yet.
          <span title={NO_CONTROL_HIDDEN}>
            <Button variant="outline" size="sm" disabled>
              {conv.owner === 'ai' ? <Hand className="size-4" /> : <Undo2 className="size-4" />}
              {conv.owner === 'ai' ? 'Take over' : 'Hand back to AI'}
            </Button>
          </span>
        ) : conv.owner === 'ai' ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setChatControl(conv.phone, 'take'), 'You took over. The AI agent stays quiet in this chat.')}>
            <Hand className="size-4" />
            Take over
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setChatControl(conv.phone, 'release'), 'The AI agent is answering again.')}>
            <Undo2 className="size-4" />
            Hand back to AI
          </Button>
        )}
      </div>
    </div>
  )
}

function CustomerPanel({ chat, version, onChanged }: { chat: ChatDetail; version: number; onChanged: () => void }) {
  const { conversation: conv, contact } = chat
  const closes = conv.lastInboundAt ? new Date(Date.parse(conv.lastInboundAt) + 86_400_000) : null
  return (
    <aside className="hidden w-72 shrink-0 space-y-6 overflow-y-auto border-l border-border p-5 xl:block">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary" style={{ fontSize: '1.25rem', fontWeight: 'var(--font-weight-semi-bold)' }}>
          {initials({ name: contact?.name, phone: conv.phone })}
        </span>
        <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{contact?.name ?? 'Unknown name'}</p>
        <p className="text-muted-foreground" style={TEXT_SM}>
          {customerLabel(conv.phone, contact?.username)}
        </p>
      </div>
      <TicketPanel phone={conv.phone} windowOpen={conv.windowOpen} version={version} onChanged={onChanged} />
      <dl className="space-y-4" style={TEXT_SM}>
        <div>
          <dt className="text-muted-foreground" style={TEXT_XS}>
            Reply window
          </dt>
          <dd>{conv.windowOpen && closes ? `Open until ${closes.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Closed. Templates only.'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground" style={TEXT_XS}>
            Tags
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {contact?.tags.length ? contact.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>) : <span className="text-muted-foreground">None yet</span>}
          </dd>
        </div>
      </dl>
    </aside>
  )
}

/** The search words in bold, so a hit shows why it matched. */
function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return <>{text}</>
  const rx = new RegExp(`(${words.join('|')})`, 'gi')
  return (
    <>
      {text.split(rx).map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-primary/20 text-foreground">{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  )
}

/** Your saved filter + search combinations, one tap away; the current one can be saved. */
function SavedViews({ views, current, onApply, onChange }: { views: SavedView[]; current: { filter: ChatFilter; q: string }; onApply: (v: SavedView) => void; onChange: (v: SavedView[]) => void }) {
  const [naming, setNaming] = useState<string | null>(null)
  const custom = current.filter !== 'all' || current.q.trim() !== ''
  const active = views.find((v) => v.filter === current.filter && v.q === current.q)
  if (!views.length && !custom) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" style={TEXT_XS}>
      {views.map((v) => (
        <span key={v.id} className={cn('inline-flex items-center rounded-full border pl-2.5', v === active ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
          <button type="button" onClick={() => onApply(v)}>
            {v.name}
          </button>
          <button type="button" aria-label={`Delete view ${v.name}`} className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground" onClick={() => void deleteView(v.id).then(onChange, (err) => toast.error(errorDetail(err)))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      {custom &&
        !active &&
        (naming === null ? (
          <button type="button" className="text-primary hover:underline" onClick={() => setNaming('')}>
            + Save this view
          </button>
        ) : (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              void saveView({ name: naming, ...current }).then(
                (v) => {
                  onChange(v)
                  setNaming(null)
                },
                (err) => toast.error(errorDetail(err)),
              )
            }}
          >
            <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="View name" maxLength={40} className="h-6 w-28 rounded border border-border bg-background px-1.5" aria-label="View name" />
            <button type="submit" className="text-primary" disabled={!naming.trim()}>
              Save
            </button>
            <button type="button" className="text-muted-foreground" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </form>
        ))}
    </div>
  )
}

/** One chat per customer who talks to the agent; people can step in, reply and hand back. */
export function InboxPage({ initialPhone }: { initialPhone?: string | null }) {
  const [aiSummary, setAiSummary] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [filter, setFilter] = useState<ChatFilter>('all')
  const [q, setQ] = useState('')
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [canned, setCanned] = useState<CannedResponse[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const members = useMembers()
  useEffect(() => {
    listViews().then(setViews, () => {})
  }, [])
  // Typing in search also looks through message text (debounced).
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null)
    const t = setTimeout(() => void searchMessages(q).then(setHits, () => setHits([])), 350)
    return () => clearTimeout(t)
  }, [q])

  const refreshList = useCallback(() => {
    listChats(filter, q).then(
      (r) => {
        setChats(r)
        setListError(null)
      },
      (err) => setListError(errorDetail(err)),
    )
  }, [filter, q])
  usePolling(refreshList, POLL_MS, [refreshList], true, LIVE_INBOX)
  usePolling(() => {
    if (!open) return
    getChat(open).then(setChat, () => {})
    void sendPresence(open, false).catch(() => {})
  }, POLL_MS, [open], true, LIVE_CHAT)
  useEffect(() => {
    getSupportSettings().then((s) => setAiSummary(s.aiSummary), () => {})
  }, [])
  useEffect(() => {
    if (initialPhone) void openChat(initialPhone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhone])
  useEffect(() => {
    listCanned().then(setCanned, () => {})
  }, [])

  async function openChat(phone: string, messageId: string | null = null) {
    setFocusId(messageId)
    setOpen(phone)
    setChat(null)
    setSummary(null)
    try {
      setChat(await markChatRead(phone))
      setChats((prev) => prev?.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)) ?? prev)
    } catch (err) {
      toast.error(errorDetail(err))
    }
  }

  const demo = useMemo(
    () => (
      <DemoControlsGroup label="Inbox">
        <Button size="sm" variant="outline" onClick={() => void loadSampleChats().then(refreshList, (e) => toast.error(errorText(e)))}>
          Load sample chats
        </Button>
        <Button size="sm" variant="outline" onClick={() => void clearSampleChats().then(refreshList, (e) => toast.error(errorText(e)))}>
          Clear sample chats
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const target = open ?? chats?.find((c) => c.sample)?.phone
            if (!target) return toast.message('Load sample chats first, or open a chat.')
            void simulateCustomerMessage(target, 'Hi, is anyone there? I need help with my order.').then(() => {
              refreshList()
              if (open === target) void getChat(target).then(setChat)
            })
          }}
        >
          Simulate customer message
        </Button>
      </DemoControlsGroup>
    ),
    [open, chats, refreshList],
  )
  useRegisterDevControls('inbox', demo)

  return (
    <div className="flex h-full min-h-0">
      <section className={cn('flex w-full shrink-0 flex-col border-r border-border md:w-80', open && 'hidden md:flex')} aria-label="Chats">
        <div className="space-y-3 border-b border-border p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search names, numbers and messages" label="Search chats" />
          <PillTabs label="Filter chats" options={FILTERS} value={filter} onChange={setFilter} compact />
          <SavedViews
            views={views}
            current={{ filter, q }}
            onApply={(v) => {
              setFilter(v.filter)
              setQ(v.q)
            }}
            onChange={setViews}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError ? (
            <p className="p-4 text-destructive" style={TEXT_SM}>
              {listError}
            </p>
          ) : !chats ? (
            <p className="flex items-center gap-2 p-4 text-muted-foreground" style={TEXT_SM}>
              <Loader2 className="size-4 animate-spin" /> Loading chats&hellip;
            </p>
          ) : chats.length === 0 ? (
            <div className="space-y-2 p-6 text-center text-muted-foreground" style={TEXT_SM}>
              <p>{q || filter !== 'all' ? 'No chats match.' : 'No customer chats yet.'}</p>
              {!q && filter === 'all' && <p style={TEXT_XS}>Chats appear here when customers message your WhatsApp number and the AI agent answers them.</p>}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {chats.map((c) => (
                <li key={c.phone}>
                  <ChatRow c={c} active={c.phone === open} onOpen={() => void openChat(c.phone)} />
                </li>
              ))}
            </ul>
          )}
          {hits && hits.length > 0 && (
            <div className="border-t border-border">
              <p className="px-4 pt-3 pb-1 text-muted-foreground" style={{ ...TEXT_XS, fontWeight: 'var(--font-weight-semi-bold)' }}>
                In messages
              </p>
              <ul className="divide-y divide-border">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="block w-full px-4 py-2.5 text-left hover:bg-muted/60" onClick={() => void openChat(h.phone, h.id)}>
                      <span className="flex justify-between gap-2" style={TEXT_SM}>
                        <span className="truncate" style={{ fontWeight: 'var(--font-weight-medium)' }}>
                          {h.name || customerLabel(h.phone)}
                        </span>
                        <span className="shrink-0 text-muted-foreground" style={TEXT_XS}>
                          {when(h.at)}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-muted-foreground" style={TEXT_XS}>
                        {h.kind === 'note' ? 'Note: ' : ''}
                        <Highlight text={h.body} q={q} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className={cn('min-w-0 flex-1 flex-col', open ? 'flex' : 'hidden md:flex')} aria-label="Conversation">
        {!open ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <MessageSquareText className="size-8" />
            <p style={TEXT_SM}>Pick a chat to read it, reply, or take over from the AI agent.</p>
          </div>
        ) : !chat ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground" style={TEXT_SM}>
            <Loader2 className="size-4 animate-spin" /> Loading the chat&hellip;
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-2 md:hidden">
              <button type="button" className="text-primary" style={TEXT_SM} onClick={() => setOpen(null)}>
                &larr; All chats
              </button>
            </div>
            <ChatHeader
              chat={chat}
              members={members}
              onChange={(d) => {
                setChat(d)
                setVersion((v) => v + 1)
              }}
            />
            <FollowUpBanner
              chat={chat}
              onChange={(d) => {
                setChat(d)
                refreshList()
              }}
            />
            {summary && (
              <div className="flex items-start gap-2 border-b border-border bg-primary/5 px-4 py-3" style={TEXT_SM}>
                <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="flex-1">{summary}</p>
                <button type="button" aria-label="Close summary" onClick={() => setSummary(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: WA.wallpaper }}>
              <Thread messages={chat.messages} focusId={focusId} />
            </div>
            <Composer
              chat={chat}
              canned={canned}
              aiSummary={aiSummary}
              onSummary={setSummary}
              onSent={(d) => {
                setChat(d)
                setVersion((v) => v + 1)
                refreshList()
              }}
            />
          </>
        )}
      </section>
      {chat && open && (
        <CustomerPanel
          chat={chat}
          version={version}
          onChanged={() => {
            void getChat(open).then(setChat)
            refreshList()
          }}
        />
      )}
    </div>
  )
}
