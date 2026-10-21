// WhatsApp message templates (/api/templates). Dummy mode answers in this browser.
import { jsonClient, supportDummy } from './client'
import type { Template } from '../templates/templates'

export type WaTemplate = Template & { id: string; status: string; category: string; rejectedReason?: string }
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

const call = jsonClient(supportDummy('dummyTemplates'))

export const listTemplates = () => call<WaTemplate[]>('/api/templates')
export const createTemplate = (t: NewTemplate) => call<{ id: string; status: string }>('/api/templates', 'POST', t)
export const deleteTemplate = (name: string) => call<{ ok: true }>(`/api/templates/${name}`, 'DELETE')
/** One template into one chat, e.g. to reopen it after the 24-hour window. */
export const sendTemplateToChat = (phone: string, template: WaTemplate, values: Record<string, string>) => call<{ ok: true }>('/api/templates/send-one', 'POST', { phone, template, values })
