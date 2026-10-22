// Contacts, tags, custom fields and segments (/api/contacts/*). Dummy mode answers in this browser.
import { guard, jsonClient, stampedClient, supportDummy } from './client'
import type { Stamp } from '@/app/components/shell/settings/formCore'
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
type ContactInput = Pick<Contact, 'name' | 'email' | 'tags' | 'fields'> & { phone?: string; optedOut?: boolean }

const call = jsonClient(supportDummy('dummyContacts'))
const stamped = stampedClient(supportDummy('dummyContacts'))

export const listContacts = (f: { q?: string; tag?: string; segment?: string } = {}) =>
  call<Contact[]>(`/api/contacts?${new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString()}`)
export const createContact = (c: ContactInput) => call<Contact>('/api/contacts', 'POST', c)
export const updateContact = (phone: string, c: ContactInput) => call<Contact>(`/api/contacts/${phone}`, 'PUT', c)
export const deleteContact = (phone: string) => call<{ ok: true }>(`/api/contacts/${phone}`, 'DELETE')
export const importContacts = (rows: ImportRow[], tags: string) =>
  call<{ added: number; updated: number; skipped: { row: number; reason: string }[]; skippedCount: number }>('/api/contacts/import', 'POST', { rows, tags })
export const listTags = () => call<{ tag: string; count: number }[]>('/api/contacts/tags')
type FieldsAnswer = FieldDef[] | { fields: FieldDef[] }
/** The fields come as a list; when they were saved comes in headers (Dummy mode: wrapped in the body). */
const fieldsOf = ({ data, stamp }: { data: FieldsAnswer; stamp: Stamp }) => ({ fields: Array.isArray(data) ? data : data.fields, stamp })
export const listFields = () => stamped<FieldsAnswer>('/api/contacts/fields').then((r) => fieldsOf(r).fields)
export const getFields = () => stamped<FieldsAnswer>('/api/contacts/fields').then(fieldsOf)
/** Removing a field clears it from every contact and from segment filters; a new type clears values that don't fit. */
export const saveFields = (fields: (Omit<FieldDef, 'key'> & { key?: string })[], updatedAt?: string | null) => stamped<FieldsAnswer>('/api/contacts/fields', 'PUT', { fields }, guard(updatedAt)).then(fieldsOf)
/** How many contacts hold a value for this field, and which segments filter on it. */
export const fieldUsage = (key: string) => call<{ contacts: number; segments: { id: string; name: string }[] }>(`/api/contacts/fields/usage?key=${encodeURIComponent(key)}`)
/** The column name a contacts CSV fills this field from (the server's rule: lowercase, _ between words). */
export const fieldKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
export const FIELD_LIMITS = { fields: 30, label: 60 }
export const listSegments = () => call<Segment[]>('/api/contacts/segments')
export const createSegment = (name: string, filter: SegmentFilter) => call<Segment>('/api/contacts/segments', 'POST', { name, filter })
export const deleteSegment = (id: string) => call<{ ok: true }>(`/api/contacts/segments/${id}`, 'DELETE')
