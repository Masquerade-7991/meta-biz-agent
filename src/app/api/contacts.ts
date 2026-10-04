// Contacts, tags, custom fields and segments (/api/contacts/*). Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyContacts } from './supportDummy'
import type { ImportRow } from '../contacts/csv'

export interface Contact {
  /** Phone number, or BSUID for a customer who hides their number. */
  phone: string
  name: string | null
  /** WhatsApp username, when the customer has one. */
  username?: string
  email: string | null
  tags: string[]
  fields: Record<string, string>
  optedOut?: boolean
  source: 'whatsapp' | 'manual' | 'import' | 'sample'
  createdAt: string
  lastSeenAt?: string
  openTicket?: boolean
}
export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string[]
}
export interface SegmentFilter {
  tags?: string[]
  field?: { key: string; value: string } | null
  activeDays?: number | null
  includeOptedOut?: boolean
}
export interface Segment {
  id: string
  name: string
  filter: SegmentFilter
  count: number
}
export type ContactInput = Pick<Contact, 'name' | 'email' | 'tags' | 'fields'> & { phone?: string; optedOut?: boolean }

const call = jsonClient(dummyContacts)

export const listContacts = (f: { q?: string; tag?: string; segment?: string } = {}) =>
  call<Contact[]>(`/api/contacts?${new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString()}`)
export const createContact = (c: ContactInput) => call<Contact>('/api/contacts', 'POST', c)
export const updateContact = (phone: string, c: ContactInput) => call<Contact>(`/api/contacts/${phone}`, 'PUT', c)
export const deleteContact = (phone: string) => call<{ ok: true }>(`/api/contacts/${phone}`, 'DELETE')
export const importContacts = (rows: ImportRow[], tags: string) =>
  call<{ added: number; updated: number; skipped: { row: number; reason: string }[]; skippedCount: number }>('/api/contacts/import', 'POST', { rows, tags })
export const listTags = () => call<{ tag: string; count: number }[]>('/api/contacts/tags')
export const listFields = () => call<FieldDef[]>('/api/contacts/fields')
export const saveFields = (fields: Omit<FieldDef, 'key'>[] | FieldDef[]) => call<FieldDef[]>('/api/contacts/fields', 'PUT', { fields })
export const listSegments = () => call<Segment[]>('/api/contacts/segments')
export const createSegment = (name: string, filter: SegmentFilter) => call<Segment>('/api/contacts/segments', 'POST', { name, filter })
export const deleteSegment = (id: string) => call<{ ok: true }>(`/api/contacts/segments/${id}`, 'DELETE')
