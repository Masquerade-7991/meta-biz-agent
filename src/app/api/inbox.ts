// Inbox client: /api/inbox/* on the server (chats, replies, notes, assignment, thread control,
// canned responses, sample data). Dummy mode answers from sample chats in this browser instead.
import { jsonClient } from './client'
import { dummyInbox } from './supportDummy'
import { isDummyMode } from './dummy'
import { parse } from './meta'
import type { MessageMedia } from '../inbox/media'
import type { InteractiveReply } from '../inbox/interactive'

export type ChatOwner = 'ai' | 'human'
export interface ChatSummary {
  phone: string
  name: string | null
  /** WhatsApp username, for a customer who hides their number. */
  username?: string
  tags: string[]
  owner: ChatOwner
  assigneeId: string | null
  unread: number
  lastMessageAt: string | null
  windowOpen: boolean
  sample: boolean
  /** Hidden from the list until then (or until the customer writes). */
  snoozedUntil?: string | null
  preview: { author: ChatMessage['author']; body: string | null } | null
}
export interface ChatMessage {
  id: string
  phone: string
  direction: 'in' | 'out'
  author: 'customer' | 'ai' | 'agent' | 'system'
  authorId?: string
  authorName?: string
  kind: 'text' | 'note' | 'media' | 'interactive' | 'template' | 'event'
  /** null: a customer message Meta told us about (from a turn) whose words arrive only by webhook. */
  body: string | null
  at: string
  status?: 'sent' | 'delivered' | 'read' | 'failed'
  tools?: string[]
  /** Set on agent replies rebuilt from Meta's conversation turns, whose text is a short preview. */
  turnId?: string
  /** An attachment (photo, video, audio, document); `body` is then its caption or a short label. */
  media?: MessageMedia
}
export interface ChatDetail {
  /** Teammates with this chat open in the last 20 seconds. */
  viewers?: { name: string; typing: boolean }[]
  conversation: { phone: string; owner: ChatOwner; assigneeId: string | null; lastInboundAt: string | null; windowOpen: boolean; sample: boolean; snoozedUntil?: string | null }
  /** Your reminders still to come for this chat. */
  reminders?: { id: string; note: string; dueAt: string }[]
  contact: { phone: string; name?: string; username?: string; tags: string[]; fields: Record<string, string>; blocked?: boolean } | null
  messages: ChatMessage[]
}
export interface CannedResponse {
  id: string
  title: string
  shortcut: string
  body: string
  shared: boolean
}
export type ChatFilter = 'all' | 'mine' | 'unassigned' | 'ai' | 'snoozed'
export interface SavedView {
  id: string
  name: string
  filter: ChatFilter
  q: string
}
export interface SearchHit {
  id: string
  phone: string
  name: string | null
  body: string
  at: string
  kind: ChatMessage['kind']
  author: ChatMessage['author']
}

const call = jsonClient(dummyInbox)
const chat = (phone: string, action = '') => `/api/inbox/conversations/${encodeURIComponent(phone)}${action && '/' + action}`

export const listChats = (filter: ChatFilter = 'all', q = '') => call<ChatSummary[]>(`/api/inbox/conversations?filter=${filter}&q=${encodeURIComponent(q)}`)
export const getChat = (phone: string) => call<ChatDetail>(chat(phone))
export const sendReply = (phone: string, text: string) => call<ChatDetail>(chat(phone, 'messages'), 'POST', { text })
/** Reply buttons or a list message (WhatsApp's interactive messages). */
export const sendInteractiveReply = (phone: string, r: InteractiveReply) => call<ChatDetail>(chat(phone, 'interactive'), 'POST', r)
export const addNote = (phone: string, text: string) => call<ChatDetail>(chat(phone, 'notes'), 'POST', { text })
export const assignChat = (phone: string, userId: string | null) => call<ChatDetail>(chat(phone, 'assign'), 'POST', { userId })
export const setChatControl = (phone: string, action: 'take' | 'release') => call<ChatDetail>(chat(phone, 'control'), 'POST', { action })
/** Hides the chat until `until` (or until the customer writes); null brings it back now. */
export const snoozeChat = (phone: string, until: string | null) => call<ChatDetail>(chat(phone, 'snooze'), 'POST', { until })
/** A note in your bell at `at`, about this chat. */
export const remindMe = (phone: string, at: string, note: string) => call<ChatDetail>(chat(phone, 'remind'), 'POST', { at, note })
export const searchMessages = (q: string) => call<SearchHit[]>(`/api/inbox/search?q=${encodeURIComponent(q)}`)
export const listViews = () => call<SavedView[]>('/api/inbox/views')
export const saveView = (v: Omit<SavedView, 'id'>) => call<SavedView[]>('/api/inbox/views', 'POST', v)
export const deleteView = (id: string) => call<SavedView[]>(`/api/inbox/views/${id}`, 'DELETE')
/** Blocks (or unblocks) the customer on WhatsApp: they can't message the number any more. */
export const blockChat = (phone: string, block: boolean) => call<ChatDetail>(chat(phone, block ? 'block' : 'unblock'), 'POST', {})
export const markChatRead = (phone: string) => call<ChatDetail>(chat(phone, 'read'), 'POST', {})
/** How the business's own AI agent would answer the customer's last message. */
export const suggestReply = (phone: string) => call<{ text: string }>(chat(phone, 'suggest'), 'POST', {})
/** A short summary for whoever picks the chat up (needs ANTHROPIC_API_KEY on the server). */
export const summarizeChat = (phone: string) => call<{ text: string }>(chat(phone, 'summary'), 'POST', {})
/** Tells teammates this chat is open here (and whether someone is typing). */
export const sendPresence = (phone: string, typing: boolean) => call<{ ok: true }>(chat(phone, 'presence'), 'POST', { typing })

/** Where a stored attachment is served from (a blob URL in dummy mode). */
export const mediaUrl = (id: string, download = false) => (id.startsWith('blob:') ? id : `/api/inbox/media/${id}${download ? '?download' : ''}`)

/** Sends a file into the chat, reporting upload progress (0 to 1). Checks happen on both sides. */
export function sendMedia(phone: string, file: File, caption: string, onProgress: (p: number) => void): Promise<ChatDetail> {
  if (isDummyMode()) return dummyInbox<ChatDetail>('POST', chat(phone, 'media'), { file, caption })
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', chat(phone, 'media'))
    x.setRequestHeader('content-type', file.type)
    x.setRequestHeader('x-filename', encodeURIComponent(file.name))
    x.setRequestHeader('x-caption', encodeURIComponent(caption))
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    x.onload = () => {
      const headers = new Headers()
      const t = x.getResponseHeader('x-trace-id')
      if (t) headers.set('x-trace-id', t)
      parse<ChatDetail>(new Response(x.responseText || null, { status: x.status, headers })).then(resolve, reject)
    }
    x.onerror = () => reject(new Error('Upload failed: the connection dropped. Try again.'))
    x.send(file)
  })
}

export const listCanned = () => call<CannedResponse[]>('/api/inbox/canned')
export const saveCanned = (c: Omit<CannedResponse, 'id'>, id?: string) => call<CannedResponse>(id ? `/api/inbox/canned/${id}` : '/api/inbox/canned', id ? 'PUT' : 'POST', c)
export const deleteCanned = (id: string) => call<{ ok: true }>(`/api/inbox/canned/${id}`, 'DELETE')

export const loadSampleChats = () => call<{ ok: true }>('/api/inbox/demo', 'POST', {})
export const clearSampleChats = () => call<{ ok: true }>('/api/inbox/demo', 'DELETE')
export const simulateCustomerMessage = (phone: string, text: string) => call<{ ok: true }>('/api/inbox/demo/simulate', 'POST', { phone, text })

/** Fills {{name}} and {{phone}} in a canned response for this customer. */
export const fillCanned = (body: string, c: { name?: string | null; phone: string }) =>
  body.replace(/\{\{\s*name\s*\}\}/gi, c.name?.split(/\s+/)[0] || 'there').replace(/\{\{\s*phone\s*\}\}/gi, '+' + c.phone)
