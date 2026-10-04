import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Bot, Check, CheckCheck, Clock, FileText, Hand, Loader2, MessageSquareText, Send, Sparkles, StickyNote, Undo2, Wrench, X } from 'lucide-react'
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
} from '@/app/api/inbox'
import { cn, initialsOf } from '@/app/lib/utils'
import { getSupportSettings } from '@/app/api/tickets'
import { TicketPanel } from './TicketPanel'
import { SendTemplateDialog } from './SendTemplateDialog'
import { TEXT_SM, TEXT_XS } from '@/app/lib/text'
import { useMembers } from '@/app/auth/useMembers'
import { usePolling } from '@/app/lib/usePolling'
import { PillTabs, SearchInput } from '@/app/components/Filters'

// Live events that change the chat list, and the open chat.
const LIVE_INBOX = ['message.', 'conversation.', 'ticket.']
const LIVE_CHAT = ['message.', 'conversation.']

const POLL_MS = 5000
const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'ai', label: 'AI handling' },
]

const display = (c: { name?: string | null; phone: string }) => c.name || `+${c.phone}`
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
        </span>
      </span>
    </button>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
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
    <div className={cn('flex', out ? 'justify-end pl-16' : 'justify-start pr-16')}>
      <div className="max-w-136 rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm" style={{ background: out ? WA.bubbleOut : WA.bubbleIn, color: WA.text, fontFamily: WA.font, fontSize: 14.2, lineHeight: '19px' }}>
        {out && (
          <p className="flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: m.author === 'ai' ? WA.green : WA.link }}>
            {m.author === 'ai' ? <Bot className="size-3" /> : null}
            {m.author === 'ai' ? 'AI agent' : (m.authorName ?? 'Team')}
          </p>
        )}
        {m.body === null ? (
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

function Thread({ messages }: { messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null)
  const count = messages.length
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count])
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
            <Bubble m={m} />
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

  const applyCanned = (c: CannedResponse) => {
    setDraft(fillCanned(c.body, { name: contact?.name, phone: conv.phone }))
    setPick(0)
  }
  async function submit() {
    const text = draft.trim()
    if (!text || busy || locked) return
    setBusy(true)
    try {
      onSent(mode === 'note' ? await addNote(conv.phone, text) : await sendReply(conv.phone, text))
      setDraft('')
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
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
    <div className="border-t border-border bg-background px-4 py-3">
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
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
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
              placeholder={mode === 'note' ? 'Only your team sees notes' : 'Type a reply, or / for canned responses'}
              aria-label={mode === 'note' ? 'Internal note' : 'Reply'}
              className={cn('max-h-40 min-h-11 resize-none', mode === 'note' && 'bg-warning/5')}
            />
            <Button onClick={() => void submit()} disabled={!draft.trim() || busy} aria-label={mode === 'note' ? 'Add note' : 'Send reply'}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : mode === 'note' ? <StickyNote className="size-4" /> : <Send className="size-4" />}
              {mode === 'note' ? 'Add note' : 'Send'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChatHeader({ chat, members, onChange }: { chat: ChatDetail; members: Member[]; onChange: (d: ChatDetail) => void }) {
  const [busy, setBusy] = useState(false)
  const { conversation: conv, contact } = chat
  const assignee = members.find((m) => m.userId === conv.assigneeId)
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
          {display({ name: contact?.name, phone: conv.phone })}
        </p>
        <p className="text-muted-foreground" style={TEXT_XS}>
          {conv.owner === 'ai' ? 'The AI agent is answering this chat' : assignee ? `With ${assignee.name}` : 'With your team, unassigned'}
          {contact?.name ? ` · +${conv.phone}` : ''}
        </p>
        {!!chat.viewers?.length && (
          <p className="text-primary" style={TEXT_XS}>
            {chat.viewers.map((v) => `${v.name} is ${v.typing ? 'typing…' : 'viewing'}`).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={conv.assigneeId ?? 'none'} onValueChange={(v) => void run(() => assignChat(conv.phone, v === 'none' ? null : v))} disabled={busy}>
          <SelectTrigger className="h-9 w-44" aria-label="Assign to">
            <SelectValue>{assignee?.name ?? (conv.assigneeId ? 'Assigned' : 'Unassigned')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {conv.owner === 'ai' ? (
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
          +{conv.phone}
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
  const members = useMembers()

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

  async function openChat(phone: string) {
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
          <SearchInput value={q} onChange={setQ} placeholder="Search name or number" label="Search chats" />
          <PillTabs label="Filter chats" options={FILTERS} value={filter} onChange={setFilter} compact />
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
              <Thread messages={chat.messages} />
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
