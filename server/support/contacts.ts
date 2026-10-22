// Contacts: everyone who has chatted, plus people added by hand or CSV. One contact per phone per
// workspace. Tags are free text; custom fields follow the workspace's field definitions; segments
// are saved filters on the Contacts page.
import type http from 'node:http'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, digits, obj, readJson, serveJson } from '../platform/http.ts'
import { createHash } from 'node:crypto'
import { col, db, dbOffReason, ws } from '../platform/db.ts'
import { diff, trace } from '../platform/trace.ts'
import { changedBy, needFresh, saveChecked, setChangedHeaders, staleAware } from './stale.ts'
import type { Actor } from '../messaging/index.ts'
import { can } from '../../src/app/lib/permissions.ts'

const contacts = () => col('contacts')

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string[]
}
export interface SegmentFilter {
  tags?: string[]
  field?: { key: string; value: string } | null
  /** Customers who wrote within this many days. */
  activeDays?: number | null
  includeOptedOut?: boolean
}

function phoneOf(v: unknown): string {
  const raw = String(v ?? '').trim()
  const p = digits(v)
  if (!/^\d{8,15}$/.test(p)) throw new HttpError(400, `${raw || 'That'} isn’t a phone number with a country code (8 to 15 digits).`)
  // Ten digits with no + is a local mobile number written without its country code (98765 43210 in
  // India); taken as is, it would be someone in another country.
  if (p.length === 10 && !/^(\+|00)/.test(raw)) throw new HttpError(400, `${raw} looks like a local number. Add the country code, like +91 ${raw}.`)
  return p
}
const tagsOf = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;|]/)).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30).map((t) => t.slice(0, 40))

/** Phone → saved name (or @username for a customer who hides their number), for lists that show customers by name. */
export async function contactNames(phones: string[]) {
  return new Map(
    (await contacts().find({ workspaceId: ws(), phone: { $in: phones } }, { projection: { phone: 1, name: 1, username: 1 } }).toArray()).map((c) => [
      String(c.phone),
      String(c.name || (c.username ? `@${String(c.username)}` : '')),
    ]),
  )
}

async function fieldDefs(): Promise<FieldDef[]> {
  return ((await col('contact_fields').findOne({ workspaceId: ws() }))?.fields as FieldDef[] | undefined) ?? []
}

/** Why a stored value no longer fits a field's type, or null when it does. */
function misfit(d: FieldDef, s: string): string | null {
  if (d.type === 'number' && !Number.isFinite(Number(s))) return `${d.label} must be a number.`
  if (d.type === 'date' && Number.isNaN(Date.parse(s))) return `${d.label} must be a date.`
  if (d.type === 'select' && d.options?.length && !d.options.includes(s)) return `${d.label} must be one of: ${d.options.join(', ')}.`
  return null
}

/** Contacts holding a value for `key`, and the segments that filter on it. */
async function fieldUsage(key: string) {
  const segs = await col('segments').find({ workspaceId: ws(), 'filter.field.key': key }, { projection: { name: 1 } }).toArray()
  return { contacts: await contacts().countDocuments({ workspaceId: ws(), [`fields.${key}`]: { $exists: true } }), segments: segs.map((x) => ({ id: String(x._id), name: String(x.name) })) }
}

const MAX_FIELDS = 30
const MAX_LABEL = 60
function parseFields(raw: unknown): FieldDef[] {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > MAX_FIELDS) throw new HttpError(400, `Keep it to ${MAX_FIELDS} fields or fewer.`)
  const seen = new Set<string>()
  return list.map((f): FieldDef => {
    const x = obj(f)
    const label = String(x.label ?? '').trim()
    if (!label) throw new HttpError(400, 'Every field needs a name.')
    if (label.length > MAX_LABEL) throw new HttpError(400, `Keep field names to ${MAX_LABEL} characters (“${label.slice(0, 20)}…” is longer).`)
    // Latin labels give readable keys; a label in another script (शहर, مدينة) gets a short stable one.
    const key = String(x.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `field_${createHash('sha256').update(label).digest('hex').slice(0, 6)}`
    if (seen.has(key)) throw new HttpError(400, `Two fields would both be called “${label}”.`)
    seen.add(key)
    if (x.type !== undefined && !['text', 'number', 'date', 'select'].includes(String(x.type))) throw new HttpError(400, `${label}: the type must be text, number, date or select.`)
    const type = (x.type as FieldDef['type'] | undefined) ?? 'text'
    const options = type === 'select' ? (Array.isArray(x.options) ? x.options : String(x.options ?? '').split(',')).map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : undefined
    if (type === 'select' && !options?.length) throw new HttpError(400, `Add the choices for ${label}, separated by commas.`)
    return { key, label, type, ...(options && { options }) }
  })
}

/** After the field list changed: values of removed fields go (and segments stop filtering on them);
 *  values that no longer fit a field's new type or choices go too, so every contact stays saveable. */
async function applyFieldChanges(before: FieldDef[], after: FieldDef[]) {
  const now = new Map(after.map((f) => [f.key, f]))
  let cleared = 0
  for (const old of before) {
    const next = now.get(old.key)
    if (!next) {
      cleared += (await contacts().updateMany({ workspaceId: ws(), [`fields.${old.key}`]: { $exists: true } }, { $unset: { [`fields.${old.key}`]: '' } })).modifiedCount
      await dropFieldFilter({ 'filter.field.key': old.key })
      continue
    }
    if (next.type === old.type && JSON.stringify(next.options ?? null) === JSON.stringify(old.options ?? null)) continue
    const rows = await contacts().find({ workspaceId: ws(), [`fields.${old.key}`]: { $exists: true } }, { projection: { [`fields.${old.key}`]: 1 } }).toArray()
    const bad = rows.filter((c) => misfit(next, String(obj(c.fields)[old.key] ?? '')))
    if (bad.length) cleared += (await contacts().updateMany({ _id: { $in: bad.map((c) => c._id) } }, { $unset: { [`fields.${old.key}`]: '' } })).modifiedCount
    // A segment filtering on a choice that's gone can't match any more.
    if (next.type === 'select') await dropFieldFilter({ 'filter.field.key': old.key, 'filter.field.value': { $nin: next.options ?? [] } })
  }
  return cleared
}

/** Segments filtering on a field (or choice) that's gone drop that filter; one left with no other
 *  filter is deleted, since an empty filter would match every contact (QA-40). */
async function dropFieldFilter(match: Obj) {
  const q = { workspaceId: ws(), ...match }
  const empty = { ...q, 'filter.tags.0': { $exists: false }, 'filter.activeDays': { $not: { $gt: 0 } } }
  for (const s of await col('segments').find(empty, { projection: { name: 1 } }).toArray()) {
    if ((await col('segments').deleteOne({ _id: s._id })).deletedCount) trace('segment.deleted', { name: String(s.name), reason: 'field_removed' }, { entity: 'segment', id: String(s._id) })
  }
  await col('segments').updateMany(q, { $set: { 'filter.field': null } })
}

/** Keeps only defined fields, coerced to their type; '' clears a field. */
function fieldsOf(v: unknown, defs: FieldDef[]): Record<string, string> {
  const raw = obj(v)
  const out: Record<string, string> = {}
  for (const d of defs) {
    if (!(d.key in raw)) continue
    const s = String(raw[d.key] ?? '').trim().slice(0, 500)
    if (!s) continue
    const why = misfit(d, s)
    if (why) throw new HttpError(400, why)
    out[d.key] = s
  }
  return out
}

/** The Mongo query for a segment. */
export function segmentQuery(f: SegmentFilter): Obj {
  const q: Obj = { workspaceId: ws() }
  if (f.tags?.length) q.tags = { $all: f.tags }
  if (f.field?.key) q[`fields.${f.field.key}`] = f.field.value
  if (f.activeDays) q.lastSeenAt = { $gte: new Date(Date.now() - f.activeDays * 86_400_000) }
  if (!f.includeOptedOut) q.optedOut = { $ne: true }
  return q
}
function parseFilter(v: unknown): SegmentFilter {
  const f = obj(v)
  const field = obj(f.field)
  return {
    tags: tagsOf(f.tags),
    field: field.key ? { key: String(field.key), value: String(field.value ?? '') } : null,
    activeDays: Number(f.activeDays) > 0 ? Math.min(365, Math.round(Number(f.activeDays))) : null,
    includeOptedOut: f.includeOptedOut === true,
  }
}

const out = ({ _id: _i, workspaceId: _w, ...c }: Obj) => c

async function list(u: URL) {
  const p = (k: string) => u.searchParams.get(k) ?? ''
  let filter: SegmentFilter = { includeOptedOut: true }
  if (p('segment')) {
    const seg = ObjectId.isValid(p('segment')) && (await col('segments').findOne({ workspaceId: ws(), _id: new ObjectId(p('segment')) }))
    if (!seg) throw new HttpError(404, 'That segment no longer exists.')
    filter = seg.filter as SegmentFilter
  }
  const q = segmentQuery({ ...filter, tags: [...(filter.tags ?? []), ...tagsOf(p('tag'))] })
  const needle = p('q').trim()
  if (needle) {
    const rx = { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    q.$or = [{ name: rx }, { email: rx }, { username: rx }, { phone: { $regex: digits(needle) || '^$' } }]
  }
  const rows = await contacts().find(q).sort({ lastSeenAt: -1, createdAt: -1 }).limit(5000).toArray()
  const open = new Set((await col('tickets').distinct('phone', { workspaceId: ws(), status: { $in: ['open', 'pending'] } })).map(String))
  return rows.map((c) => ({ ...out(c), openTicket: open.has(String(c.phone)) }))
}

async function save(b: Obj, phone?: string) {
  const defs = await fieldDefs()
  const p = phone ?? phoneOf(b.phone)
  const doc: Obj = {
    name: String(b.name ?? '').trim().slice(0, 120) || null,
    email: String(b.email ?? '').trim().slice(0, 200) || null,
    tags: tagsOf(b.tags),
    fields: fieldsOf(b.fields, defs),
    ...(typeof b.optedOut === 'boolean' && { optedOut: b.optedOut }),
    ...(b.optedOut === true && { optedOutAt: new Date() }),
    updatedAt: new Date(),
  }
  if (doc.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(doc.email))) throw new HttpError(400, 'That email address doesn’t look right.')
  if (phone) {
    // Opting someone back in must be a decision about what the form showed: a form opened before the
    // customer sent STOP still says "subscribed", and saving it must not undo their STOP.
    if (doc.optedOut === false && b.optedOutWas !== true) delete doc.optedOut
    if (doc.optedOut === true && b.optedOutWas === true) delete doc.optedOutAt
    const r = await contacts().findOneAndUpdate({ workspaceId: ws(), phone: p }, { $set: doc }, { returnDocument: 'before' })
    if (!r) throw new HttpError(404, 'That contact no longer exists.')
    // Which details changed, not their values: the activity log keeps no customer details.
    const fields = ['name', 'email', 'tags', 'fields', 'optedOut'].filter((k) => JSON.stringify(r[k] ?? null) !== JSON.stringify(doc[k] ?? null))
    if (fields.length) trace('contact.updated', { fields }, { entity: 'contact', id: p })
    return out({ ...r, ...doc })
  }
  if (await contacts().findOne({ workspaceId: ws(), phone: p })) throw new HttpError(409, `+${p} is already a contact.`)
  const full = { optedOut: false, ...doc, workspaceId: ws(), phone: p, source: 'manual', createdAt: new Date() }
  await contacts().insertOne(full)
  trace('contact.created', {}, { entity: 'contact', id: p })
  return out(full)
}

/** CSV rows (already parsed in the browser): add new numbers, update existing ones, report the rest. */
async function importRows(b: Obj) {
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 10_000) : []
  const defs = await fieldDefs()
  const extraTags = tagsOf(b.tags)
  let added = 0
  let updated = 0
  const skipped: { row: number; reason: string }[] = []
  for (const [i, raw] of rows.entries()) {
    const r = obj(raw)
    try {
      const phone = phoneOf(r.phone)
      const set: Obj = { updatedAt: new Date() }
      if (String(r.name ?? '').trim()) set.name = String(r.name).trim().slice(0, 120)
      if (String(r.email ?? '').trim()) set.email = String(r.email).trim().slice(0, 200)
      for (const [k, v] of Object.entries(fieldsOf(r.fields, defs))) set[`fields.${k}`] = v
      const tags = [...tagsOf(r.tags), ...extraTags]
      const res = await contacts().updateOne(
        { workspaceId: ws(), phone },
        { $set: set, ...(tags.length && { $addToSet: { tags: { $each: tags } } }), $setOnInsert: { workspaceId: ws(), phone, source: 'import', createdAt: new Date(), ...(!tags.length && { tags: [] }), ...(!Object.keys(set).some((k) => k.startsWith('fields.')) && { fields: {} }) } },
        { upsert: true },
      )
      if (res.upsertedCount) added++
      else updated++
    } catch (err) {
      // The line in the file when the browser sent it (blank lines don't shift the count); else header + index.
      skipped.push({ row: Number(r.line) > 0 ? Number(r.line) : i + 2, reason: err instanceof HttpError ? err.message : 'Couldn’t read this row.' })
    }
  }
  trace('contact.imported', { added, updated, skipped: skipped.length })
  return { added, updated, skipped: skipped.slice(0, 100), skippedCount: skipped.length }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/contacts' && m === 'GET') return list(u)
  if (path === '/api/contacts' && m === 'POST') return save(obj(await readJson(req)))
  if (path === '/api/contacts/import' && m === 'POST') {
    if (!can(me.role, 'contacts.manage')) throw new HttpError(403, 'Supervisors, admins and owners import contacts.')
    return importRows(obj(await readJson(req)))
  }
  if (path === '/api/contacts/tags' && m === 'GET')
    return (await contacts().aggregate([{ $match: { workspaceId: ws() } }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()).map((t) => ({ tag: t._id, count: t.count }))
  if (path === '/api/contacts/fields' && m === 'GET') {
    setChangedHeaders(res, await changedBy(await col('contact_fields').findOne({ workspaceId: ws() }, { projection: { updatedAt: 1, updatedBy: 1 } })))
    return fieldDefs()
  }
  if (path === '/api/contacts/fields/usage' && m === 'GET') {
    const key = u.searchParams.get('key') ?? ''
    if (!(await fieldDefs()).some((f) => f.key === key)) throw new HttpError(404, 'That field no longer exists.')
    return fieldUsage(key)
  }
  if (path === '/api/contacts/fields' && m === 'PUT') {
    if (!can(me.role, 'settings.manage')) throw new HttpError(403, 'Only owners and admins can change contact fields.')
    const stored = await col('contact_fields').findOne({ workspaceId: ws() })
    needFresh(req, stored?.updatedAt)
    const fields = parseFields(obj(await readJson(req)).fields)
    const before = ((stored?.fields as FieldDef[] | undefined) ?? [])
    const now = new Date()
    await saveChecked(col('contact_fields'), req, stored, { fields, updatedAt: now, updatedBy: me._id })
    const cleared = await applyFieldChanges(before, fields)
    const byKey = (l: FieldDef[]) => Object.fromEntries(l.map((f) => [f.key, f]))
    const changes = diff(byKey(before), byKey(fields)) ?? {}
    for (const f of before) if (!fields.some((x) => x.key === f.key)) changes[f.key] = [f, null]
    if (Object.keys(changes).length)
      trace('settings.updated', { area: 'contact_fields', count: fields.length, added: fields.filter((f) => !before.some((x) => x.key === f.key)).map((f) => f.label), removed: before.filter((f) => !fields.some((x) => x.key === f.key)).map((f) => f.label), valuesCleared: cleared }, undefined, changes)
    setChangedHeaders(res, await changedBy({ updatedAt: now, updatedBy: me._id }))
    return fields
  }
  if (path === '/api/contacts/segments' && m === 'GET')
    return Promise.all(
      (await col('segments').find({ workspaceId: ws() }).sort({ name: 1 }).toArray()).map(async (s) => ({ id: String(s._id), name: s.name, filter: s.filter, count: await contacts().countDocuments(segmentQuery(s.filter as SegmentFilter)) })),
    )
  if (path.startsWith('/api/contacts/segments') && m !== 'GET' && !can(me.role, 'contacts.manage')) throw new HttpError(403, 'Supervisors, admins and owners manage segments.')
  if (path === '/api/contacts/segments' && m === 'POST') {
    const b = obj(await readJson(req))
    const name = String(b.name ?? '').trim().slice(0, 80)
    if (!name) throw new HttpError(400, 'Give the segment a name.')
    const filter = parseFilter(b.filter)
    const r = await col('segments').insertOne({ workspaceId: ws(), name, filter, createdBy: me._id, createdAt: new Date() })
    trace('segment.created', { name }, { entity: 'segment', id: String(r.insertedId) })
    return { id: String(r.insertedId), name, filter, count: await contacts().countDocuments(segmentQuery(filter)) }
  }
  if ((seg = path.match(/^\/api\/contacts\/segments\/([a-f0-9]{24})$/)) && m === 'DELETE') {
    const gone = await col('segments').findOneAndDelete({ workspaceId: ws(), _id: new ObjectId(seg[1]) })
    if (gone) trace('segment.deleted', { name: String(gone.name) }, { entity: 'segment', id: seg[1] })
    return { ok: true }
  }
  // A contact is addressed by phone number, or by BSUID for a customer who hides their number.
  if ((seg = path.match(/^\/api\/contacts\/(\d{8,15}|[A-Z]{2}\.[A-Za-z0-9.]{1,140})$/))) {
    const phone = seg[1]
    if (m === 'GET') {
      const c = await contacts().findOne({ workspaceId: ws(), phone })
      if (!c) throw new HttpError(404, 'That contact no longer exists.')
      return out(c)
    }
    if (m === 'PUT') return save(obj(await readJson(req)), phone)
    if (m === 'DELETE') {
      if (!can(me.role, 'contacts.manage')) throw new HttpError(403, 'Supervisors, admins and owners delete contacts.')
      // Deleting a contact removes everything we hold about them: chat, messages and tickets.
      for (const name of ['contacts', 'conversations', 'messages', 'tickets', 'presence']) await col(name).deleteMany({ workspaceId: ws(), phone })
      trace('contact.deleted', {}, { entity: 'contact', id: phone })
      return { ok: true }
    }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 409: 'Already exists' }
export async function handleContacts(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/contacts')) return false
  const [titles, run] = staleAware(TITLES, () => route(req, res, u, me))
  return serveJson(req, res, { titles, db, noDb: { title: dbOffReason, detail: 'Contacts need the database.' } }, run)
}
