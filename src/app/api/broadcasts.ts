// Broadcasts and WhatsApp templates (/api/broadcasts/*). Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyBroadcasts } from './supportDummy'
import type { Template } from '../broadcasts/templates'
import type { FailureReason } from '../broadcasts/sendErrors'

export type WaTemplate = Template & { id: string; status: string; category: string; rejectedReason?: string }
export interface SlotMapping {
  /** 'text' | 'name' | 'phone' | 'field:<key>'; `text` is the fixed value or the fallback. */
  source: string
  text?: string
}
export interface BroadcastStats {
  queued: number
  sent: number
  delivered: number
  read: number
  failed: number
  skipped: number
  replied: number
  /** Queued again after a failure WhatsApp asked us to retry (e.g. its daily marketing limit). */
  retrying: number
}
export interface Broadcast {
  id: string
  name: string
  template: { name: string; language: string }
  segmentId: string | null
  segmentName: string
  audienceCount: number
  status: 'scheduled' | 'sending' | 'completed' | 'cancelled'
  scheduledAt: string
  startedAt?: string
  completedAt?: string
  createdByName: string
  createdAt: string
  stats: BroadcastStats
}
export interface BroadcastFailure {
  reason: FailureReason
  /** true = these are waiting for a retry at `nextAt`; false = gave up. */
  retrying: boolean
  count: number
  nextAt: string | null
}
export interface BroadcastDetail extends Broadcast {
  preview: string
  failures: BroadcastFailure[]
  recipients: { phone: string; name: string | null; status: keyof BroadcastStats | 'queued'; reason?: FailureReason; error?: string; retryAt?: string; sentAt?: string; repliedAt?: string }[]
}
export interface NewTemplate {
  name: string
  category: 'MARKETING' | 'UTILITY'
  language: string
  header: string
  body: string
  footer: string
  buttons: { type: 'QUICK_REPLY' | 'URL'; text: string; url?: string }[]
  examples: Record<string, string>
}

/** Cost of one message to each person, from rates this workspace paid in the last 30 days (server/billing.ts). */
export interface Estimate {
  currency: string | null
  total: number
  /** People whose country has no recent rate, so they aren't in `total`. */
  unpriced: number
  countries: { country: string; people: number; rate: number | null }[]
}
export interface Preflight {
  audience: number
  /** Sample contacts: stored, never sent to WhatsApp. */
  sample: number
  /** Customers who hide their number (reachable, but not by login-code templates). */
  hiddenNumbers: number
  /** Already got a marketing message from you in the last 24 hours. */
  gotMarketingToday: number
  estimate: Estimate
}

const call = jsonClient(dummyBroadcasts)

export const listTemplates = () => call<WaTemplate[]>('/api/broadcasts/templates')
export const createTemplate = (t: NewTemplate) => call<{ id: string; status: string }>('/api/broadcasts/templates', 'POST', t)
export const deleteTemplate = (name: string) => call<{ ok: true }>(`/api/broadcasts/templates/${name}`, 'DELETE')
export const listBroadcasts = () => call<Broadcast[]>('/api/broadcasts')
export const getBroadcast = (id: string) => call<BroadcastDetail>(`/api/broadcasts/${id}`)
export const createBroadcast = (b: { name: string; template: { name: string; language: string }; segmentId: string | null; mapping: Record<string, SlotMapping>; scheduledAt: string | null }) =>
  call<BroadcastDetail>('/api/broadcasts', 'POST', b)
export const preflightBroadcast = (b: { segmentId: string | null; category: string }) => call<Preflight>('/api/broadcasts/preflight', 'POST', b)
export const cancelBroadcast = (id: string) => call<BroadcastDetail>(`/api/broadcasts/${id}/cancel`, 'POST', {})
/** One template into one chat, e.g. to reopen it after the 24-hour window. */
export const sendTemplateToChat = (phone: string, template: WaTemplate, values: Record<string, string>) => call<{ ok: true }>('/api/broadcasts/send-one', 'POST', { phone, template, values })
