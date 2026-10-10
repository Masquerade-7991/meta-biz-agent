// Coming back to a chat later: snooze (the chat leaves the list until a time, or until the customer
// writes) and personal reminders (a note in your bell at a time). Both run on the job runner, so
// they fire after restarts too. Also saved inbox views and full-text search over messages.
import { ObjectId } from 'mongodb'
import { HttpError, type Obj } from './http.ts'
import { col, ws } from './db.ts'
import { defineJob, enqueue } from './jobs.ts'
import { trace } from './trace.ts'
import { contactNames } from './contacts.ts'
import { customerLabel } from '../src/app/lib/customer.ts'

const MAX_AHEAD = 60 * 86_400_000
const conversations = () => col('conversations')
const reminders = () => col('reminders')

/** A time from the browser that must be in the future (and not absurdly far). */
export function futureTime(v: unknown, what: string): Date {
  const d = new Date(String(v ?? ''))
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Pick when to ${what}.`)
  if (d.getTime() < Date.now() + 30_000) throw new HttpError(400, 'Pick a time in the future.')
  if (d.getTime() > Date.now() + MAX_AHEAD) throw new HttpError(400, 'Pick a time within the next 60 days.')
  return d
}

// ---- snooze ----
export async function snooze(phone: string, until: unknown, userId: string) {
  if (until === null) {
    await conversations().updateOne({ workspaceId: ws(), phone }, { $unset: { snoozedUntil: '', snoozedBy: '' } })
    return
  }
  const at = futureTime(until, 'bring it back')
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { snoozedUntil: at, snoozedBy: userId } })
  await enqueue('conversation.wake', { phone }, { runAt: at, key: `wake:${phone}` })
}

/** A customer writing ends the snooze at once. */
export async function wakeOnMessage(phone: string) {
  const r = await conversations().updateOne({ workspaceId: ws(), phone, snoozedUntil: { $exists: true } }, { $unset: { snoozedUntil: '', snoozedBy: '' } })
  if (r.modifiedCount) trace('conversation.updated', { action: 'woke', by: 'customer' }, { entity: 'conversation', id: phone })
}

defineJob('conversation.wake', async (p) => {
  const phone = String(p.phone)
  const c = await conversations().findOne({ workspaceId: ws(), phone })
  if (!c?.snoozedUntil) return
  // Snoozed again for later: wait for the new time.
  if (+c.snoozedUntil > Date.now()) return { again: c.snoozedUntil as Date }
  await conversations().updateOne({ _id: c._id }, { $unset: { snoozedUntil: '', snoozedBy: '' }, $max: { unread: 1 } })
  if (c.snoozedBy) await addReminder(String(c.snoozedBy), phone, 'Back from snooze', new Date(), true)
  trace('conversation.updated', { action: 'woke', by: 'time' }, { entity: 'conversation', id: phone })
})

// ---- reminders ----
async function addReminder(userId: string, phone: string, note: string, dueAt: Date, fired = false) {
  const r = await reminders().insertOne({ workspaceId: ws(), userId, phone, note, dueAt, firedAt: fired ? new Date() : null, dismissedAt: null, createdAt: new Date() })
  if (fired) trace('reminder.due', { userId }, { entity: 'conversation', id: phone })
  else await enqueue('reminder.fire', { id: String(r.insertedId) }, { runAt: dueAt })
}

export async function remind(phone: string, b: Obj, userId: string) {
  const note = String(b.note ?? '').trim().slice(0, 300) || 'Follow up'
  await addReminder(userId, phone, note, futureTime(b.at, 'remind you'))
}

defineJob('reminder.fire', async (p) => {
  const r = await reminders().findOneAndUpdate({ workspaceId: ws(), _id: new ObjectId(String(p.id)), firedAt: null }, { $set: { firedAt: new Date() } })
  if (r) trace('reminder.due', { userId: r.userId }, { entity: 'conversation', id: String(r.phone) })
})

/** Reminders that are due for this person and not dismissed, for the bell. */
export async function dueReminders(userId: string) {
  const rows = await reminders().find({ workspaceId: ws(), userId, firedAt: { $ne: null }, dismissedAt: null }).sort({ firedAt: -1 }).limit(20).toArray()
  const names = await contactNames(rows.map((r) => String(r.phone)))
  return rows.map((r) => ({ id: `reminder:${String(r._id)}`, kind: 'reminder', text: `${String(r.note)} · ${names.get(String(r.phone)) || customerLabel(String(r.phone))}`, at: r.firedAt as Date, phone: String(r.phone) }))
}
/** This person's reminders still to come for a chat (shown in the chat header). */
export const upcomingReminders = (userId: string, phone: string) =>
  reminders().find({ workspaceId: ws(), userId, phone, firedAt: null }, { projection: { note: 1, dueAt: 1 } }).sort({ dueAt: 1 }).limit(5).toArray()
export async function dismissReminder(id: string, userId: string) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'Not found.')
  await reminders().updateOne({ workspaceId: ws(), _id: new ObjectId(id), userId }, { $set: { dismissedAt: new Date() } })
}

// ---- saved views ----
const FILTERS = new Set(['all', 'mine', 'team', 'unassigned', 'closing', 'ai', 'snoozed'])
export const listViews = (userId: string) =>
  col('saved_views').find({ workspaceId: ws(), userId }).sort({ name: 1 }).toArray().then((rows) => rows.map((v) => ({ id: String(v._id), name: v.name, filter: v.filter, q: v.q })))
export async function saveView(userId: string, b: Obj) {
  const name = String(b.name ?? '').trim().slice(0, 40)
  if (!name) throw new HttpError(400, 'Name the view.')
  const filter = FILTERS.has(String(b.filter)) ? String(b.filter) : 'all'
  const q = String(b.q ?? '').trim().slice(0, 100)
  if (await col('saved_views').countDocuments({ workspaceId: ws(), userId }) >= 20) throw new HttpError(400, 'You can keep 20 views. Delete one first.')
  await col('saved_views').updateOne({ workspaceId: ws(), userId, name }, { $set: { filter, q, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true })
  return listViews(userId)
}
export async function deleteView(userId: string, id: string) {
  if (ObjectId.isValid(id)) await col('saved_views').deleteOne({ workspaceId: ws(), userId, _id: new ObjectId(id) })
  return listViews(userId)
}

// ---- search ----
/** Messages containing the words of `q` (Mongo text search on whole words, any language), best first. */
export async function searchMessages(q: string) {
  const needle = q.trim().slice(0, 100)
  if (needle.length < 2) return []
  const rows = await col('messages')
    .find({ workspaceId: ws(), $text: { $search: needle }, body: { $type: 'string' } }, { projection: { phone: 1, body: 1, at: 1, kind: 1, author: 1, score: { $meta: 'textScore' } } })
    .sort({ score: { $meta: 'textScore' }, at: -1 })
    .limit(30)
    .toArray()
  const names = await contactNames(rows.map((r) => String(r.phone)))
  return rows.map((r) => ({ id: String(r._id), phone: String(r.phone), name: names.get(String(r.phone)) || null, body: String(r.body).slice(0, 300), at: r.at, kind: r.kind, author: r.author }))
}
