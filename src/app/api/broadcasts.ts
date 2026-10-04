// Broadcasts and WhatsApp templates (/api/broadcasts/*). Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyBroadcasts } from './supportDummy'
import type { Template } from '../broadcasts/templates'

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
export interface BroadcastDetail extends Broadcast {
  preview: string
  recipients: { phone: string; name: string | null; status: keyof BroadcastStats | 'queued'; error?: string; sentAt?: string; repliedAt?: string }[]
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

const call = jsonClient(dummyBroadcasts)

export const listTemplates = () => call<WaTemplate[]>('/api/broadcasts/templates')
export const createTemplate = (t: NewTemplate) => call<{ id: string; status: string }>('/api/broadcasts/templates', 'POST', t)
export const deleteTemplate = (name: string) => call<{ ok: true }>(`/api/broadcasts/templates/${name}`, 'DELETE')
export const listBroadcasts = () => call<Broadcast[]>('/api/broadcasts')
export const getBroadcast = (id: string) => call<BroadcastDetail>(`/api/broadcasts/${id}`)
export const createBroadcast = (b: { name: string; template: { name: string; language: string }; segmentId: string | null; mapping: Record<string, SlotMapping>; scheduledAt: string | null }) =>
  call<BroadcastDetail>('/api/broadcasts', 'POST', b)
export const cancelBroadcast = (id: string) => call<BroadcastDetail>(`/api/broadcasts/${id}/cancel`, 'POST', {})
/** One template into one chat, e.g. to reopen it after the 24-hour window. */
export const sendTemplateToChat = (phone: string, template: WaTemplate, values: Record<string, string>) => call<{ ok: true }>('/api/broadcasts/send-one', 'POST', { phone, template, values })
