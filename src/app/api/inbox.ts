// Inbox client: /api/inbox/* on the server (chats, replies, notes, assignment, thread control,
// canned responses, sample data). Dummy mode answers from sample chats in this browser instead.
import { jsonClient } from './client'
import { dummyInbox } from './supportDummy'

export type ChatOwner = 'ai' | 'human'
export interface ChatSummary {
  phone: string
  name: string | null
  tags: string[]
  owner: ChatOwner
  assigneeId: string | null
  unread: number
  lastMessageAt: string | null
  windowOpen: boolean
  sample: boolean
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
}
export interface ChatDetail {
  /** Teammates with this chat open in the last 20 seconds. */
  viewers?: { name: string; typing: boolean }[]
  conversation: { phone: string; owner: ChatOwner; assigneeId: string | null; lastInboundAt: string | null; windowOpen: boolean; sample: boolean }
  contact: { phone: string; name?: string; tags: string[]; fields: Record<string, string> } | null
  messages: ChatMessage[]
}
export interface CannedResponse {
  id: string
  title: string
  shortcut: string
  body: string
  shared: boolean
}
export type ChatFilter = 'all' | 'mine' | 'unassigned' | 'ai'

const call = jsonClient(dummyInbox)
const chat = (phone: string, action = '') => `/api/inbox/conversations/${encodeURIComponent(phone)}${action && '/' + action}`

export const listChats = (filter: ChatFilter = 'all', q = '') => call<ChatSummary[]>(`/api/inbox/conversations?filter=${filter}&q=${encodeURIComponent(q)}`)
export const getChat = (phone: string) => call<ChatDetail>(chat(phone))
export const sendReply = (phone: string, text: string) => call<ChatDetail>(chat(phone, 'messages'), 'POST', { text })
export const addNote = (phone: string, text: string) => call<ChatDetail>(chat(phone, 'notes'), 'POST', { text })
export const assignChat = (phone: string, userId: string | null) => call<ChatDetail>(chat(phone, 'assign'), 'POST', { userId })
export const setChatControl = (phone: string, action: 'take' | 'release') => call<ChatDetail>(chat(phone, 'control'), 'POST', { action })
export const markChatRead = (phone: string) => call<ChatDetail>(chat(phone, 'read'), 'POST', {})
/** How the business's own AI agent would answer the customer's last message. */
export const suggestReply = (phone: string) => call<{ text: string }>(chat(phone, 'suggest'), 'POST', {})
/** A short summary for whoever picks the chat up (needs ANTHROPIC_API_KEY on the server). */
export const summarizeChat = (phone: string) => call<{ text: string }>(chat(phone, 'summary'), 'POST', {})
/** Tells teammates this chat is open here (and whether someone is typing). */
export const sendPresence = (phone: string, typing: boolean) => call<{ ok: true }>(chat(phone, 'presence'), 'POST', { typing })

export const listCanned = () => call<CannedResponse[]>('/api/inbox/canned')
export const saveCanned = (c: Omit<CannedResponse, 'id'>, id?: string) => call<CannedResponse>(id ? `/api/inbox/canned/${id}` : '/api/inbox/canned', id ? 'PUT' : 'POST', c)
export const deleteCanned = (id: string) => call<{ ok: true }>(`/api/inbox/canned/${id}`, 'DELETE')

export const loadSampleChats = () => call<{ ok: true }>('/api/inbox/demo', 'POST', {})
export const clearSampleChats = () => call<{ ok: true }>('/api/inbox/demo', 'DELETE')
export const simulateCustomerMessage = (phone: string, text: string) => call<{ ok: true }>('/api/inbox/demo/simulate', 'POST', { phone, text })

/** Fills {{name}} and {{phone}} in a canned response for this customer. */
export const fillCanned = (body: string, c: { name?: string | null; phone: string }) =>
  body.replace(/\{\{\s*name\s*\}\}/gi, c.name?.split(/\s+/)[0] || 'there').replace(/\{\{\s*phone\s*\}\}/gi, '+' + c.phone)
