// Broadcasts: an approved template sent to a segment of contacts, now or at a set time. A worker
// sends a few messages a second; each send also lands in the customer's chat. Delivery and read
// ticks arrive by webhook (inbox.ts updates the recipient rows). Templates are read from and
// created on the WhatsApp Business Account.
import type http from 'node:http'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, arr, obj, readJson, serveJson } from './http.ts'
import { col, db, dbOffReason, needMetaAssets, withWorkspace, ws } from './db.ts'
import { metaJson } from './upstream.ts'
import { traceId } from './context.ts'
import { trace } from './trace.ts'
import { isBsuid, parseCustomerKey } from '../src/app/lib/customer.ts'
import { reasonOf, retryAt, type FailureReason } from '../src/app/broadcasts/sendErrors.ts'
import { defineJob, enqueue, type JobResult } from './jobs.ts'
import { estimate } from './billing.ts'
import { conversations, ensureConversation, sendTemplateMessage, type Actor } from './inbox.ts'
import { contactNames, segmentQuery, type SegmentFilter } from './contacts.ts'
import { renderTemplate, slotsOf, templatePayload, type Template } from '../src/app/broadcasts/templates.ts'
import { can } from '../src/app/lib/permissions.ts'

const broadcasts = () => col('broadcasts')
const recipients = () => col('broadcast_recipients')

// ---- templates ----
const FIELDS = 'id,name,status,category,language,components,rejected_reason'
const toTemplate = (t: Obj): Template & { id: string; rejectedReason?: string } => ({
  id: String(t.id),
  name: String(t.name),
  language: String(t.language),
  status: String(t.status),
  category: String(t.category),
  components: arr(t.components) as Template['components'],
  ...(t.rejected_reason && t.rejected_reason !== 'NONE' ? { rejectedReason: String(t.rejected_reason) } : {}),
})
async function listTemplates() {
  needMetaAssets()
  const out: ReturnType<typeof toTemplate>[] = []
  let after = ''
  // ponytail: first 500 templates; page further if a business ever keeps more.
  for (let page = 0; page < 5; page++) {
    const r = await metaJson('graph', 'GET', `/WABA_ID/message_templates?fields=${FIELDS}&limit=100${after ? `&after=${after}` : ''}`)
    out.push(...arr(r.data).map((t) => toTemplate(obj(t))))
    after = String(obj(obj(r.paging).cursors).after ?? '')
    if (!obj(r.paging).next || !after) break
  }
  return out
}
async function getTemplate(name: string, language: string): Promise<Template> {
  needMetaAssets()
  const r = await metaJson('graph', 'GET', `/WABA_ID/message_templates?fields=${FIELDS}&name=${encodeURIComponent(name)}&limit=50`)
  const t = arr(r.data).map((x) => toTemplate(obj(x))).find((x) => x.name === name && x.language === language)
  if (!t) throw new HttpError(404, `Template ${name} (${language}) wasn’t found on your WhatsApp account.`)
  if (t.status !== 'APPROVED') throw new HttpError(400, `Template ${name} is ${String(t.status).toLowerCase()}; only approved templates can be sent.`)
  return t
}

/** Builds Meta's create-template body; every {{n}} needs an example value for review. */
async function createTemplate(b: Obj) {
  needMetaAssets()
  const name = String(b.name ?? '').trim()
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new HttpError(400, 'Template names use lowercase letters, numbers and underscores only, like order_update.')
  const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(String(b.category)) ? String(b.category) : 'MARKETING'
  const body = String(b.body ?? '').trim()
  if (!body || body.length > 1024) throw new HttpError(400, 'The message is required and can be up to 1024 characters.')
  const examples = obj(b.examples)
  const nums = (s: string) => [...new Set([...s.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, z) => a - z)
  const ex = (prefix: string, s: string) =>
    nums(s).map((n) => {
      const v = String(examples[`${prefix}:${n}`] ?? '').trim()
      if (!v) throw new HttpError(400, `Add an example for {{${n}}} so Meta can review the template.`)
      return v
    })
  const components: Obj[] = []
  const header = String(b.header ?? '').trim()
  if (header) components.push({ type: 'HEADER', format: 'TEXT', text: header, ...(nums(header).length && { example: { header_text: ex('header', header) } }) })
  components.push({ type: 'BODY', text: body, ...(nums(body).length && { example: { body_text: [ex('body', body)] } }) })
  const footer = String(b.footer ?? '').trim()
  if (footer) components.push({ type: 'FOOTER', text: footer.slice(0, 60) })
  const buttons = arr(b.buttons)
    .map(obj)
    .slice(0, 3)
    .map((x) => (x.type === 'URL' ? { type: 'URL', text: String(x.text).slice(0, 25), url: String(x.url) } : { type: 'QUICK_REPLY', text: String(x.text).slice(0, 25) }))
    .filter((x) => x.text)
  if (buttons.length) components.push({ type: 'BUTTONS', buttons })
  const r = await metaJson('graph', 'POST', '/WABA_ID/message_templates', { name, category, language: String(b.language || 'en'), components })
  return { id: String(r.id), status: String(r.status ?? 'PENDING') }
}

// ---- values: each slot is filled per contact ----
export interface Mapping {
  /** 'text' uses `text`; 'name' / 'phone' / 'field:<key>' read the contact, then `text` as the fallback. */
  [slot: string]: { source: string; text?: string }
}
function valuesFor(slots: ReturnType<typeof slotsOf>, mapping: Mapping, c: Obj): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of slots) {
    const m = mapping[s.id] ?? { source: 'text' }
    const fromContact =
      m.source === 'name' ? String(c.name ?? '').split(/\s+/)[0] : m.source === 'phone' ? `+${c.phone}` : m.source.startsWith('field:') ? String(obj(c.fields)[m.source.slice(6)] ?? '') : ''
    out[s.id] = (fromContact || m.text || '').trim()
  }
  return out
}

// ---- broadcasts ----
/** Everyone a broadcast to this segment (or all contacts) would reach: never people who opted out. */
async function audienceFor(segmentId: unknown) {
  let filter: SegmentFilter = {}
  let segmentName = 'All contacts'
  if (segmentId) {
    const seg = await col('segments').findOne({ workspaceId: ws(), _id: new ObjectId(String(segmentId)) })
    if (!seg) throw new HttpError(404, 'That segment no longer exists.')
    filter = { ...(seg.filter as SegmentFilter), includeOptedOut: false }
    segmentName = String(seg.name)
  }
  const audience = await col('contacts').find(segmentQuery(filter), { projection: { phone: 1, sample: 1 } }).toArray()
  return { audience, segmentName }
}

/**
 * What to know before sending: who it reaches, who already got a marketing message from us today
 * (WhatsApp may hold theirs back under its daily limit), and the cost from this workspace's own rates.
 */
async function preflight(b: Obj) {
  const { audience } = await audienceFor(b.segmentId)
  const keys = audience.map((c) => String(c.phone))
  const category = String(b.category ?? 'MARKETING').toUpperCase()
  const gotMarketingToday =
    category === 'MARKETING'
      ? (await recipients().distinct('phone', { workspaceId: ws(), phone: { $in: keys }, category: 'MARKETING', sentAt: { $gte: new Date(Date.now() - 86_400_000) } })).length
      : 0
  return {
    audience: keys.length,
    sample: audience.filter((c) => c.sample).length,
    hiddenNumbers: keys.filter(isBsuid).length,
    gotMarketingToday,
    estimate: await estimate(keys.filter((_, i) => !audience[i].sample), category),
  }
}

async function createBroadcast(b: Obj, me: Actor) {
  needMetaAssets()
  const name = String(b.name ?? '').trim().slice(0, 100)
  if (!name) throw new HttpError(400, 'Give the broadcast a name.')
  const tpl = obj(b.template)
  const template = await getTemplate(String(tpl.name ?? ''), String(tpl.language ?? ''))
  const mapping = obj(b.mapping) as unknown as Mapping
  for (const s of slotsOf(template)) {
    const m = mapping[s.id]
    if (!m || (m.source === 'text' && !String(m.text ?? '').trim())) throw new HttpError(400, `Choose what goes in ${s.label}.`)
  }
  const { audience, segmentName } = await audienceFor(b.segmentId)
  if (!audience.length) throw new HttpError(400, 'Nobody to send to: the segment has no contacts who accept messages.')
  const at = b.scheduledAt ? new Date(String(b.scheduledAt)) : null
  if (at && (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000)) throw new HttpError(400, 'Pick a time in the future.')
  const doc = {
    workspaceId: ws(),
    name,
    template,
    mapping,
    segmentId: b.segmentId ? String(b.segmentId) : null,
    segmentName,
    audienceCount: audience.length,
    status: 'scheduled',
    scheduledAt: at ?? new Date(),
    createdBy: me._id,
    createdByName: me.name,
    createdAt: new Date(),
  }
  const r = await broadcasts().insertOne(doc)
  await recipients().insertMany(audience.map((c) => ({ workspaceId: ws(), broadcastId: r.insertedId, phone: c.phone, status: 'queued', ...(c.sample && { sample: true }) })))
  await enqueue('broadcast.send', { broadcastId: String(r.insertedId) }, { runAt: doc.scheduledAt, key: jobKey(r.insertedId) })
  trace('broadcast.created', { audience: audience.length, scheduled: !!at, template: template.name }, { entity: 'broadcast', id: String(r.insertedId) })
  return one(String(r.insertedId))
}

const EMPTY_STATS = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0, retrying: 0 }
async function stats(ids: ObjectId[]) {
  const rows = await recipients()
    .aggregate([
      { $match: { workspaceId: ws(), broadcastId: { $in: ids } } },
      {
        $group: {
          _id: { b: '$broadcastId', s: '$status' },
          n: { $sum: 1 },
          replied: { $sum: { $cond: [{ $ifNull: ['$repliedAt', false] }, 1, 0] } },
          retrying: { $sum: { $cond: [{ $ifNull: ['$retryAt', false] }, 1, 0] } },
        },
      },
    ])
    .toArray()
  const by = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const k = String(r._id.b)
    const m = by.get(k) ?? { ...EMPTY_STATS }
    m[r._id.s] = (m[r._id.s] ?? 0) + r.n
    m.replied += r.replied
    if (r._id.s === 'queued') m.retrying += r.retrying
    by.set(k, m)
  }
  return by
}
const out = (b: Obj, s?: Record<string, number>) => {
  const { _id, workspaceId: _w, mapping: _m, ...rest } = b
  return { id: String(_id), ...rest, template: { name: obj(b.template).name, language: obj(b.template).language }, stats: s ?? { ...EMPTY_STATS } }
}
async function list() {
  const rows = await broadcasts().find({ workspaceId: ws() }).sort({ createdAt: -1 }).limit(200).toArray()
  const s = await stats(rows.map((r) => r._id))
  return rows.map((r) => out(r, s.get(String(r._id))))
}
async function one(id: string) {
  const b = await broadcasts().findOne({ workspaceId: ws(), _id: new ObjectId(id) })
  if (!b) throw new HttpError(404, 'That broadcast no longer exists.')
  const s = await stats([b._id])
  const rec = await recipients().find({ workspaceId: ws(), broadcastId: b._id }).sort({ status: 1 }).limit(500).toArray()
  const names = await contactNames(rec.map((r) => String(r.phone)))
  // Why people didn't get it, biggest group first (the report groups failures by reason).
  const failures = await recipients()
    .aggregate([
      { $match: { workspaceId: ws(), broadcastId: b._id, $or: [{ status: { $in: ['failed', 'skipped'] } }, { retryAt: { $exists: true }, status: 'queued' }] } },
      { $group: { _id: { reason: { $ifNull: ['$reason', 'other'] }, retrying: { $eq: ['$status', 'queued'] } }, count: { $sum: 1 }, nextAt: { $min: '$retryAt' } } },
      { $sort: { count: -1 } },
    ])
    .toArray()
  return {
    ...out(b, s.get(String(b._id))),
    failures: failures.map((f) => ({ reason: f._id.reason, retrying: f._id.retrying, count: f.count, nextAt: f.nextAt ?? null })),
    preview: renderTemplate(b.template as Template, {}), recipients: rec.map(({ _id, workspaceId: _w, broadcastId: _b, ...r }) => ({ ...r, name: names.get(String(r.phone)) || null })) }
}

// ---- sending (a job per broadcast, jobs.ts) ----
const BATCH = 20
const jobKey = (id: unknown) => `broadcast:${String(id)}`

/**
 * Records why a recipient didn't get the message. Reasons Meta asks us to retry (the daily marketing
 * cap, throttling) go back in the queue for later and the broadcast's job is woken by then.
 * Used when the send call is refused and when a failed-status webhook arrives later.
 */
export async function recipientFailed(r: Obj, reason: FailureReason, error: string, code?: number) {
  const again = retryAt(reason, Number(r.retries ?? 0))
  const base = { reason, error: error.slice(0, 300), ...(code !== undefined && { code }) }
  if (again) {
    await recipients().updateOne({ _id: r._id as ObjectId }, { $set: { ...base, status: 'queued', retryAt: again }, $inc: { retries: 1 }, $unset: { waMessageId: '' } })
    await enqueue('broadcast.send', { broadcastId: String(r.broadcastId) }, { runAt: again, key: jobKey(r.broadcastId) })
    // A finished broadcast with someone to retry is sending again.
    await broadcasts().updateOne({ _id: r.broadcastId as ObjectId, status: 'completed' }, { $set: { status: 'sending' }, $unset: { completedAt: '' } })
  } else await recipients().updateOne({ _id: r._id as ObjectId }, { $set: { ...base, status: 'failed' }, $unset: { retryAt: '' } })
  trace(again ? 'broadcast.retry_scheduled' : 'broadcast.recipient_failed', { reason, ...(code !== undefined && { code }), ...(again && { at: again }) }, { entity: 'broadcast', id: String(r.broadcastId) })
  return again
}

/** Sends one batch of a broadcast, then asks to run again until nobody is left in the queue. */
async function sendBatch(p: Record<string, unknown>): Promise<JobResult> {
  const b = await broadcasts().findOne({ workspaceId: ws(), _id: new ObjectId(String(p.broadcastId)) })
  if (!b || (b.status !== 'scheduled' && b.status !== 'sending')) return
  const ref = { entity: 'broadcast', id: String(b._id) }
  if (b.status === 'scheduled') {
    await broadcasts().updateOne({ _id: b._id }, { $set: { status: 'sending', startedAt: new Date() } })
    trace('broadcast.started', { audience: b.audienceCount }, ref)
  }
  const due = { workspaceId: ws(), broadcastId: b._id, status: 'queued', $or: [{ retryAt: { $exists: false } }, { retryAt: { $lte: new Date() } }] }
  const batch = await recipients().find(due).limit(BATCH).toArray()
  const template = b.template as Template
  const slots = slotsOf(template)
  const tally = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
  for (const r of batch) {
    // A cancel lands between messages, not only between batches.
    if ((await broadcasts().findOne({ _id: b._id }, { projection: { status: 1 } }))?.status === 'cancelled') return
    const c = await col('contacts').findOne({ workspaceId: ws(), phone: r.phone })
    if (!c || c.optedOut || c.blocked) {
      await recipients().updateOne({ _id: r._id }, { $set: { status: 'skipped', reason: c?.optedOut ? 'opted_out' : 'other', error: !c ? 'Contact deleted' : c.optedOut ? 'Opted out' : 'Blocked on WhatsApp' } })
      tally.skipped++
      continue
    }
    // WhatsApp sends authentication templates to phone numbers only, never to a BSUID.
    if (isBsuid(String(r.phone)) && template.category === 'AUTHENTICATION') {
      await recipients().updateOne({ _id: r._id }, { $set: { status: 'skipped', reason: 'no_phone', error: 'Hides their phone number (login codes need one)' } })
      tally.skipped++
      continue
    }
    try {
      const values = valuesFor(slots, b.mapping as Mapping, c)
      const payload = templatePayload(template, values)
      await ensureConversation(String(r.phone))
      const waMessageId = await sendTemplateMessage(String(r.phone), payload, renderTemplate(template, values), { sample: !!(r.sample || c.sample), label: `Broadcast: ${b.name}` })
      await recipients().updateOne({ _id: r._id }, { $set: { status: 'sent', sentAt: new Date(), category: template.category ?? null, traceId: traceId(), ...(waMessageId && { waMessageId }) }, $unset: { retryAt: '', reason: '', error: '' } })
      tally.sent++
    } catch (err) {
      const code = err instanceof HttpError ? err.code : undefined
      if (await recipientFailed(r, reasonOf(code), err instanceof Error ? err.message : String(err), code)) tally.retrying++
      else tally.failed++
    }
  }
  trace('broadcast.progress', tally, ref)
  if (batch.length === BATCH) return { again: new Date() }
  // People waiting for a retry keep the broadcast open until their time comes.
  const next = await recipients().findOne({ workspaceId: ws(), broadcastId: b._id, status: 'queued' }, { sort: { retryAt: 1 }, projection: { retryAt: 1 } })
  if (next) return { again: (next.retryAt as Date | undefined) ?? new Date() }
  await broadcasts().updateOne({ _id: b._id, status: 'sending' }, { $set: { status: 'completed', completedAt: new Date() } })
  trace('broadcast.completed', {}, ref)
}
defineJob('broadcast.send', sendBatch)

/** Broadcasts left scheduled or sending by an older server (or a lost job) get their job back. */
export async function resumeBroadcasts() {
  if (!db) return
  for (const b of await col('broadcasts').find({ status: { $in: ['scheduled', 'sending'] } }, { projection: { workspaceId: 1, scheduledAt: 1 } }).toArray()) {
    await withWorkspace(String(b.workspaceId), async () => {
      if (await col('jobs').findOne({ workspaceId: ws(), key: jobKey(b._id), status: { $in: ['queued', 'running'] } })) return
      await enqueue('broadcast.send', { broadcastId: String(b._id) }, { runAt: b.scheduledAt as Date, key: jobKey(b._id) })
    })
  }
}

// ---- routes ----
async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/broadcasts/templates' && m === 'GET') return listTemplates()
  if (path === '/api/broadcasts/templates' && m === 'POST') {
    if (!can(me.role, 'templates.create')) throw new HttpError(403, 'Supervisors, admins and owners create templates.')
    return createTemplate(obj(await readJson(req)))
  }
  if ((seg = path.match(/^\/api\/broadcasts\/templates\/([a-z0-9_]+)$/)) && m === 'DELETE') {
    needMetaAssets()
    if (!can(me.role, 'templates.delete')) throw new HttpError(403, 'Only owners and admins can delete templates.')
    await metaJson('graph', 'DELETE', `/WABA_ID/message_templates?name=${seg[1]}`)
    return { ok: true }
  }
  if (path === '/api/broadcasts/send-one' && m === 'POST') {
    // One template to one chat, e.g. to restart a conversation after the 24-hour window.
    const b = obj(await readJson(req))
    const phone = parseCustomerKey(String(b.phone ?? ''))
    const conv = await conversations().findOne({ workspaceId: ws(), phone })
    if (!conv) throw new HttpError(404, 'No chat with this number yet.')
    const tpl = obj(b.template)
    const template = conv.sample ? (tpl as unknown as Template) : await getTemplate(String(tpl.name ?? ''), String(tpl.language ?? ''))
    const values = Object.fromEntries(Object.entries(obj(b.values)).map(([k, v]) => [k, String(v)]))
    let payload
    try {
      payload = templatePayload(template, values)
    } catch (err) {
      throw new HttpError(400, (err as Error).message)
    }
    await sendTemplateMessage(phone, payload, renderTemplate(template, values), { sample: !!conv.sample, actor: me })
    await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human', ...(!conv.assigneeId && { assigneeId: me._id }) } })
    return { ok: true }
  }
  if (path === '/api/broadcasts/preflight' && m === 'POST') return preflight(obj(await readJson(req)))
  if (path === '/api/broadcasts' && m === 'GET') return list()
  // Sending to many people is for supervisors and up; agents can still see what went out.
  if ((path === '/api/broadcasts' || path.endsWith('/cancel')) && m === 'POST' && !can(me.role, 'broadcasts.send')) throw new HttpError(403, 'Supervisors, admins and owners send broadcasts.')
  if (path === '/api/broadcasts' && m === 'POST') return createBroadcast(obj(await readJson(req)), me)
  if ((seg = path.match(/^\/api\/broadcasts\/([a-f0-9]{24})(\/cancel)?$/))) {
    if (seg[2] && m === 'POST') {
      const r = await broadcasts().updateOne({ workspaceId: ws(), _id: new ObjectId(seg[1]), status: { $in: ['scheduled', 'sending'] } }, { $set: { status: 'cancelled', completedAt: new Date() } })
      if (!r.modifiedCount) throw new HttpError(400, 'Only scheduled or sending broadcasts can be cancelled.')
      await recipients().updateMany({ workspaceId: ws(), broadcastId: new ObjectId(seg[1]), status: 'queued' }, { $set: { status: 'skipped', error: 'Broadcast cancelled' } })
      trace('broadcast.cancelled', {}, { entity: 'broadcast', id: seg[1] })
      return one(seg[1])
    }
    if (m === 'GET') return one(seg[1])
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 502: 'WhatsApp didn’t accept it' }
export async function handleBroadcasts(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/broadcasts')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Broadcasts need the database.' } }, () => route(req, u, me))
}
