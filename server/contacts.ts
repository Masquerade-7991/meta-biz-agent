// Contacts: everyone who has chatted, plus people added by hand or CSV. One contact per phone per
// workspace. Tags are free text; custom fields follow the workspace's field definitions; segments
// are saved filters that Contacts and Broadcasts share.
import type http from 'node:http'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, digits, obj, readJson, serveJson } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import type { Actor } from './inbox.ts'

const contacts = () => col('contacts')

export interface FieldDef {
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
  const p = digits(v)
  if (!/^\d{8,15}$/.test(p)) throw new HttpError(400, `${String(v ?? '') || 'That'} isn’t a phone number with a country code (8 to 15 digits).`)
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

export async function fieldDefs(): Promise<FieldDef[]> {
  return ((await col('contact_fields').findOne({ workspaceId: ws() }))?.fields as FieldDef[] | undefined) ?? []
}

/** Keeps only defined fields, coerced to their type; '' clears a field. */
function fieldsOf(v: unknown, defs: FieldDef[]): Record<string, string> {
  const raw = obj(v)
  const out: Record<string, string> = {}
  for (const d of defs) {
    if (!(d.key in raw)) continue
    const s = String(raw[d.key] ?? '').trim().slice(0, 500)
    if (!s) continue
    if (d.type === 'number' && !Number.isFinite(Number(s))) throw new HttpError(400, `${d.label} must be a number.`)
    if (d.type === 'date' && Number.isNaN(Date.parse(s))) throw new HttpError(400, `${d.label} must be a date.`)
    if (d.type === 'select' && d.options?.length && !d.options.includes(s)) throw new HttpError(400, `${d.label} must be one of: ${d.options.join(', ')}.`)
    out[d.key] = s
  }
  return out
}

/** The Mongo query for a segment; Broadcasts uses the same one. */
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
    const seg = await col('segments').findOne({ workspaceId: ws(), _id: new ObjectId(p('segment')) })
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
    optedOut: b.optedOut === true,
    updatedAt: new Date(),
  }
  if (doc.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(doc.email))) throw new HttpError(400, 'That email address doesn’t look right.')
  if (phone) {
    const r = await contacts().findOneAndUpdate({ workspaceId: ws(), phone: p }, { $set: doc }, { returnDocument: 'after' })
    if (!r) throw new HttpError(404, 'That contact no longer exists.')
    return out(r)
  }
  if (await contacts().findOne({ workspaceId: ws(), phone: p })) throw new HttpError(409, `+${p} is already a contact.`)
  const full = { ...doc, workspaceId: ws(), phone: p, source: 'manual', createdAt: new Date() }
  await contacts().insertOne(full)
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
      skipped.push({ row: i + 2, reason: err instanceof HttpError ? err.message : 'Couldn’t read this row.' })
    }
  }
  return { added, updated, skipped: skipped.slice(0, 100), skippedCount: skipped.length }
}

async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/contacts' && m === 'GET') return list(u)
  if (path === '/api/contacts' && m === 'POST') return save(obj(await readJson(req)))
  if (path === '/api/contacts/import' && m === 'POST') return importRows(obj(await readJson(req)))
  if (path === '/api/contacts/tags' && m === 'GET')
    return (await contacts().aggregate([{ $match: { workspaceId: ws() } }, { $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()).map((t) => ({ tag: t._id, count: t.count }))
  if (path === '/api/contacts/fields' && m === 'GET') return fieldDefs()
  if (path === '/api/contacts/fields' && m === 'PUT') {
    if (me.role !== 'owner') throw new HttpError(403, 'Only owners can change contact fields.')
    const raw = obj(await readJson(req)).fields
    const seen = new Set<string>()
    const fields = (Array.isArray(raw) ? raw : []).slice(0, 30).map((f): FieldDef => {
      const x = obj(f)
      const label = String(x.label ?? '').trim().slice(0, 60)
      if (!label) throw new HttpError(400, 'Every field needs a name.')
      const key = String(x.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field'
      if (seen.has(key)) throw new HttpError(400, `Two fields would both be called “${label}”.`)
      seen.add(key)
      const type = ['number', 'date', 'select'].includes(String(x.type)) ? (x.type as FieldDef['type']) : 'text'
      const options = type === 'select' ? (Array.isArray(x.options) ? x.options : String(x.options ?? '').split(',')).map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : undefined
      if (type === 'select' && !options?.length) throw new HttpError(400, `Add the choices for ${label}, separated by commas.`)
      return { key, label, type, ...(options && { options }) }
    })
    await col('contact_fields').updateOne({ workspaceId: ws() }, { $set: { fields, updatedAt: new Date() } }, { upsert: true })
    return fields
  }
  if (path === '/api/contacts/segments' && m === 'GET')
    return Promise.all(
      (await col('segments').find({ workspaceId: ws() }).sort({ name: 1 }).toArray()).map(async (s) => ({ id: String(s._id), name: s.name, filter: s.filter, count: await contacts().countDocuments(segmentQuery(s.filter as SegmentFilter)) })),
    )
  if (path === '/api/contacts/segments' && m === 'POST') {
    const b = obj(await readJson(req))
    const name = String(b.name ?? '').trim().slice(0, 80)
    if (!name) throw new HttpError(400, 'Give the segment a name.')
    const filter = parseFilter(b.filter)
    const r = await col('segments').insertOne({ workspaceId: ws(), name, filter, createdBy: me._id, createdAt: new Date() })
    return { id: String(r.insertedId), name, filter, count: await contacts().countDocuments(segmentQuery(filter)) }
  }
  if ((seg = path.match(/^\/api\/contacts\/segments\/([a-f0-9]{24})$/)) && m === 'DELETE') {
    await col('segments').deleteOne({ workspaceId: ws(), _id: new ObjectId(seg[1]) })
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
      // Deleting a contact removes everything we hold about them: chat, messages and tickets.
      for (const name of ['contacts', 'conversations', 'messages', 'tickets', 'presence']) await col(name).deleteMany({ workspaceId: ws(), phone })
      return { ok: true }
    }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 409: 'Already exists' }
export async function handleContacts(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/contacts')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Contacts need the database.' } }, () => route(req, u, me))
}
