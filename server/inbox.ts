// Inbox: one chat per customer who talks to the agent, plus the WhatsApp webhook that feeds it.
// Before webhooks are routed here, chats are built from Meta's conversation-turns API (one turn per
// customer message: its wamid, the agent's reply preview and tool calls). Webhooks then add the
// customer's own words (same wamid, so the placeholder fills in), echoes of the agent's replies,
// delivery ticks and handovers. Replies from people go out through the Cloud API send endpoint.
import type http from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, arr, digits, obj, readJson, serveJson, str } from './http.ts'
import { col, db, dbOffReason, needMetaAssets, ownsMetaAssets, withWorkspace, ws } from './db.ts'
import { callUpstream, env, metaJson, parseJson, resolveIds } from './upstream.ts'
import { currentAssets } from './context.ts'
import { trace } from './trace.ts'
import { contactFor, resolveCustomer, webhookContacts } from './customers.ts'
import { recipientFailed } from './broadcasts.ts'
import { onAccountWebhook } from './health.ts'
import { inboundMedia, MEDIA_TYPES, saveMedia, serveMedia, uploadToMeta } from './media.ts'
import { enqueue } from './jobs.ts'
import { deleteView, listViews, remind, saveView, searchMessages, snooze, upcomingReminders, wakeOnMessage } from './followups.ts'
import { checkMedia, mediaLabel, MEDIA_RULES, type MediaKind, type MessageMedia } from '../src/app/inbox/media.ts'
import { interactiveError, interactivePayload, interactiveText, type InteractiveReply } from '../src/app/inbox/interactive.ts'
import { reasonOf, undeliveredLine } from '../src/app/broadcasts/sendErrors.ts'
import { isBsuid, NO_CONTROL_HIDDEN, parseCustomerKey, sendTarget } from '../src/app/lib/customer.ts'
import { accounts, assetsFor, workspaceForNumber } from './accounts.ts'
import { SAMPLE_CHATS } from '../src/app/inbox/sampleData.ts'
import { ensureTicket, needCanAssign, needInScope, onAgentReply, onCustomerMessage, scopeFor } from './tickets.ts'
import { can, type Role } from '../src/app/lib/permissions.ts'
import { setBlocked } from './numbers.ts'
import { recordAiUsage } from './aiUsage.ts'
import { isProtected } from './protect.ts'
import { chargeOf, deliveryId, replaceable, signedBy } from './webhookCore.ts'

export interface Actor {
  _id: string
  name: string
  role: Role | null
}

const fromSeconds = (v: unknown) => (Number(v) > 0 ? new Date(Number(v) * 1000) : new Date())
const DAY = 86_400_000

export const conversations = () => col('conversations')

/** The WhatsApp number a piece of chat work is for: the number a webhook event arrived on, else the
 *  workspace's default. Stamped on messages, conversations and tickets so analytics can split by agent.
 *  Rows from before this was stamped have none and count as the default number. */
const numberScope = new AsyncLocalStorage<string>()
export const currentNumber = () => numberScope.getStore() || currentAssets()?.phoneNumberId || null
const messages = () => col('messages')
const contacts = () => col('contacts')

/** A chat's key from a URL: a phone number (8 to 15 digits) or, for a customer who hides it, their BSUID. */
function phoneParam(v: string): string {
  const p = parseCustomerKey(v)
  if (!isBsuid(p) && !/^\d{8,15}$/.test(p)) throw new HttpError(400, 'Phone must be 8 to 15 digits, country code first.')
  return p
}
function text(v: unknown, what: string, max = 4096): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new HttpError(400, `Write ${what} first.`)
  if (s.length > max) throw new HttpError(400, `${what[0].toUpperCase() + what.slice(1)} is too long (max ${max} characters).`)
  return s
}

// ---- storage ----
interface Msg {
  phone: string
  direction: 'in' | 'out'
  author: 'customer' | 'ai' | 'agent' | 'system'
  authorId?: string
  authorName?: string
  kind: 'text' | 'note' | 'media' | 'interactive' | 'template' | 'event'
  body: string | null
  at: Date
  waMessageId?: string
  turnId?: string
  status?: 'sent' | 'delivered' | 'read' | 'failed'
  tools?: string[]
  sample?: boolean
  media?: MessageMedia & { waMediaId?: string }
}

/** Makes sure the customer has a contact and a conversation (AI-handled until someone takes over). */
export async function ensureConversation(phone: string, name?: string, sample = false, link: Obj = {}) {
  const now = new Date()
  const set = { ...(name && { name }), ...link }
  await contacts().updateOne(
    { workspaceId: ws(), phone },
    {
      $setOnInsert: { workspaceId: ws(), phone, tags: [], fields: {}, createdAt: now, source: sample ? 'sample' : 'whatsapp', ...(sample && { sample }), ...(isBsuid(phone) && !link.bsuid && { bsuid: phone }) },
      ...(Object.keys(set).length && { $set: set }),
    },
    { upsert: true },
  )
  await conversations().updateOne(
    { workspaceId: ws(), phone },
    { $setOnInsert: { workspaceId: ws(), phone, owner: 'ai', assigneeId: null, unread: 0, lastMessageAt: null, lastInboundAt: null, createdAt: now, ...(sample && { sample }) } },
    { upsert: true },
  )
}

/** Stores a message once (deduped by wamid or turn id) and keeps the conversation summary current.
 *  A webhook with the customer's words fills in a placeholder made from a turn (same wamid).
 *  True when this brought something new (a new message, or a placeholder's words): Meta's retries
 *  and repeats answer false, so callers run their side effects once. */
export async function addMessage(m: Msg): Promise<boolean> {
  const number = currentNumber()
  const doc = { ...m, workspaceId: ws(), createdAt: new Date(), ...(number && { phoneNumberId: number }) }
  if (m.waMessageId || m.turnId) {
    const key = m.waMessageId ? { waMessageId: m.waMessageId } : { turnId: m.turnId }
    // Text, when known, always wins: it fills a placeholder (body null) made from a turn.
    const { body, kind, ...rest } = doc
    const before = await messages().findOneAndUpdate({ workspaceId: ws(), ...key }, body !== null ? { $setOnInsert: rest, $set: { body, kind } } : { $setOnInsert: doc }, { upsert: true, returnDocument: 'before', projection: { body: 1 } })
    // A turn's placeholder getting the customer's words is news too (opt-out words, replies), but not a new message.
    if (before) return before.body === null && body !== null
  } else await messages().insertOne(doc)
  const inbound = m.direction === 'in'
  if (inbound) await contacts().updateOne({ workspaceId: ws(), phone: m.phone }, { $max: { lastSeenAt: m.at } })
  // History pulled from Meta isn't news; only messages from the last day count as unread.
  const fresh = Date.now() - m.at.getTime() < DAY
  await conversations().updateOne(
    { workspaceId: ws(), phone: m.phone },
    {
      $max: { lastMessageAt: m.at, ...(inbound && { lastInboundAt: m.at }) },
      ...(inbound && fresh && { $inc: { unread: 1 } }),
      // The number the customer last wrote to: replies and tickets belong to it.
      ...(inbound && number && { $set: { phoneNumberId: number } }),
    },
  )
  trace('message.added', { direction: m.direction, author: m.author, kind: m.kind }, { entity: 'conversation', id: m.phone })
  return true
}

// ---- Meta: turns, send, thread control ----
export interface Turn {
  turn_id?: string
  message_id?: string
  timestamp?: number
  steps?: { type?: string; llm_output_preview?: string; tool_name?: string }[]
}

/** Pulls the customer's recent turns from Meta into the chat (throttled per customer). */
const lastSync = new Map<string, number>()
/** Customers Meta has no conversation with (allowlisted numbers that never chatted): not asked again for
 *  10 minutes, or until they write. Otherwise every inbox open makes a failed call per such number. */
const noConversation = new Map<string, number>()
async function syncTurns(phone: string, force = false) {
  // Meta's turns are looked up by phone number; a number-hidden customer's arrive by webhook only.
  if (!ownsMetaAssets() || isBsuid(phone)) return
  const key = `${ws()}|${phone}`
  if (!force && Date.now() - (lastSync.get(key) ?? 0) < 15_000) return
  if (!force && Date.now() < (noConversation.get(key) ?? 0)) return
  lastSync.set(key, Date.now())
  const r = await callUpstream('meta', 'GET', resolveIds(`/PHONE_NUMBER_ID/insights/conversations/turns?user_phone_number=${phone}&limit=50`)).catch(() => null)
  if (r && (r.status === 400 || r.status === 404)) noConversation.set(key, Date.now() + 10 * 60_000)
  if (!r || r.status !== 200) return
  noConversation.delete(key)
  await importTurns(phone, arr(obj(parseJson(r.text)).data) as Turn[])
}

/** Meta's conversation turns into the chat: the customer's message (its words arrive by webhook)
 *  and the agent's reply. Used when a chat opens (syncTurns) and by the hourly collector, so
 *  transcripts are kept even for chats nobody opens. Safe to repeat. */
export async function importTurns(phone: string, turns: Turn[]) {
  if (turns.some((t) => t.turn_id)) await ensureConversation(phone)
  for (const t of turns) {
    if (!t.turn_id) continue
    const at = new Date(Number(t.timestamp) || Date.now())
    const steps = t.steps ?? []
    const reply = [...steps].reverse().find((s) => s.type === 'LLM_CALL' && s.llm_output_preview)?.llm_output_preview
    const tools = steps.filter((s) => s.type === 'TOOL_CALL' && s.tool_name).map((s) => s.tool_name!)
    // Each turn starts with a customer message; its words arrive only by webhook.
    await addMessage({ phone, direction: 'in', author: 'customer', kind: 'text', body: null, at: new Date(at.getTime() - 1), waMessageId: t.message_id || `turn:${t.turn_id}` })
    // An echo of this reply may have arrived first (full words, unknown author): it's the agent's.
    const near = { $gte: new Date(at.getTime() - 120_000), $lte: new Date(at.getTime() + 120_000) }
    const echoed = await messages().findOne({ workspaceId: ws(), phone, direction: 'out', turnId: { $exists: false }, $or: [{ author: 'ai' }, { authorName: OUTSIDE }], at: near })
    if (echoed) await messages().updateOne({ _id: echoed._id, turnId: { $exists: false } }, { $set: { author: 'ai', turnId: t.turn_id, tools }, $unset: { authorName: '' } }).catch(() => null)
    else if (reply || tools.length) await addMessage({ phone, direction: 'out', author: 'ai', kind: 'text', body: reply ?? '', at, turnId: t.turn_id, tools })
  }
}

/** Everyone the agent may talk to: the allowlist (the agent answers only these while ALLOWLISTED_ONLY). */
const lastRoster = new Map<string, number>()
async function syncRoster() {
  if (!ownsMetaAssets() || Date.now() - (lastRoster.get(ws()) ?? 0) < 60_000) return
  lastRoster.set(ws(), Date.now())
  const r = await callUpstream('meta', 'GET', resolveIds('/PHONE_NUMBER_ID/agent_config/allowlist')).catch(() => null)
  const listed = r?.status === 200 ? arr(parseJson(r.text)).map((a) => digits(obj(a).consumer_phone_number)) : []
  const traced = (await col('conversation_traces').distinct('consumer', { workspaceId: ws() })).map(digits)
  // ponytail: syncs every known customer's latest turns once a minute; page through when the allowlist grows large.
  for (const phone of new Set([...listed, ...traced].filter(Boolean))) {
    await ensureConversation(phone)
    await syncTurns(phone)
  }
}

// ---- webhook ----
/** Who sent an outbound message that didn't come from this console: another app or the WhatsApp Business app. */
const OUTSIDE = 'Sent outside this console'
/** The business's own number (protect.ts): the console only listens there. */
const listenOnly = () => isProtected(currentAssets()?.wabaId)
/** Turns one webhook `value` into chat updates. `field` is messages | standby | messaging_handovers. */
async function processChange(field: string, value: Obj) {
  // Account events: number quality and limits, template reviews (health.ts).
  if (await onAccountWebhook(field, value)) return
  const v = field === 'standby' ? obj(value.standby) : value
  const people = webhookContacts(v)
  for (const raw of arr(v.messages)) {
    const m = obj(raw)
    // `from` (the phone number) is left out when the customer hides it behind a username; `from_user_id` is their BSUID.
    const who = contactFor(people, digits(m.from), str(m.from_user_id) ?? '')
    const { key: phone, link } = await resolveCustomer(m.from, m.from_user_id ?? who?.bsuid, { username: who?.username })
    if (!phone) continue
    noConversation.delete(`${ws()}|${phone}`)
    await ensureConversation(phone, who?.name, false, link)
    const type = str(m.type) ?? 'text'
    const media = MEDIA_TYPES.has(type as MediaKind) ? inboundMedia(type as MediaKind, m) : undefined
    const body =
      type === 'text'
        ? (str(obj(m.text).body) ?? '')
        : type === 'interactive'
          ? (str(obj(obj(m.interactive).button_reply).title) ?? str(obj(obj(m.interactive).list_reply).title) ?? 'Replied to a message')
          : type === 'button'
            ? (str(obj(m.button).text) ?? 'Tapped a button')
            : media
              ? (media.caption ?? mediaLabel(media.kind, media.filename))
              : `Sent a ${type} message`
    const fresh = await addMessage({ phone, direction: 'in', author: 'customer', kind: type === 'text' ? 'text' : type === 'interactive' || type === 'button' ? 'interactive' : 'media', body, at: fromSeconds(m.timestamp), waMessageId: str(m.id), ...(media && { media }) })
    // Meta's retries and repeats change nothing past this point.
    if (!fresh) continue
    // The file itself comes from WhatsApp in the background (media.ts), so the webhook answers fast.
    if (media?.waMediaId) {
      const saved = await messages().findOne({ workspaceId: ws(), waMessageId: str(m.id) }, { projection: { _id: 1 } })
      if (saved) await enqueue('media.fetch', { messageId: String(saved._id) })
    }
    // A reply within 3 days counts towards the last broadcast this customer received.
    await col('broadcast_recipients').findOneAndUpdate(
      { workspaceId: ws(), phone, status: { $in: ['sent', 'delivered', 'read'] }, repliedAt: { $exists: false }, sentAt: { $gte: new Date(Date.now() - 3 * DAY) } },
      { $set: { repliedAt: new Date() } },
      { sort: { sentAt: -1 } },
    )
    // WhatsApp's opt-out words: STOP keeps the contact out of broadcasts, START lets them back in.
    const word = body.trim().toUpperCase()
    if (['STOP', 'UNSUBSCRIBE', 'START'].includes(word)) await contacts().updateOne({ workspaceId: ws(), phone }, { $set: { optedOut: word !== 'START' } })
    await wakeOnMessage(phone)
    // On `messages` our app holds the chat; on `standby` the agent does. A listen-only app (the
    // business's own number) can't tell from the field, so ownership there follows handovers only.
    const conv = listenOnly()
      ? await conversations().findOne({ workspaceId: ws(), phone })
      : await conversations().findOneAndUpdate({ workspaceId: ws(), phone }, { $set: { owner: field === 'messages' ? 'human' : 'ai' } }, { returnDocument: 'after' })
    await onCustomerMessage(phone, body, conv?.owner === 'human' ? 'human' : 'ai', !!conv?.sample)
  }
  for (const raw of arr(v.message_echoes)) {
    const e = obj(raw)
    const msg = obj(e.message)
    const { key: phone, link } = await resolveCustomer(msg.to, msg.recipient)
    if (!phone) continue
    await ensureConversation(phone, undefined, false, link)
    const body = str(obj(msg.text).body) ?? str(obj(obj(msg.interactive).body).text) ?? `Sent a ${str(msg.type) ?? 'message'}`
    const at = fromSeconds(e.timestamp)
    const waMessageId = str(e.id)
    // Sent from this console: already stored under its id.
    if (waMessageId && (await messages().findOne({ workspaceId: ws(), waMessageId }, { projection: { _id: 1 } }))) continue
    // The agent's reply: its turn's short preview gets the full words.
    const turn = await messages().findOneAndUpdate(
      { workspaceId: ws(), phone, author: 'ai', turnId: { $exists: true }, waMessageId: { $exists: false }, at: { $gte: new Date(at.getTime() - 120_000), $lte: new Date(at.getTime() + 120_000) } },
      { $set: { body, ...(waMessageId && { waMessageId }) } },
    )
    // Anything else was sent by another app or the WhatsApp Business app; a later turn may show it was the agent (syncTurns).
    if (!turn) await addMessage({ phone, direction: 'out', author: 'agent', authorName: OUTSIDE, kind: 'text', body, at, waMessageId })
  }
  for (const raw of arr(v.statuses)) {
    const s = obj(raw)
    const status = str(s.status)
    const allowed = status ? replaceable(status) : null
    // What it cost, when Meta says (pricing and conversation on the status), once per status.
    const charge = chargeOf(s)
    if (charge)
      await col('message_charges').updateOne(
        { workspaceId: ws(), waMessageId: charge.waMessageId, status: charge.status },
        { $setOnInsert: { ...charge, workspaceId: ws(), phoneNumberId: str(obj(value.metadata).phone_number_id) ?? null } },
        { upsert: true },
      )
    if (str(s.id) && status && allowed) {
      const error = str(obj(arr(s.errors)[0]).title)
      const code = obj(arr(s.errors)[0]).code
      // Statuses only move forward: a late "delivered" never replaces "read".
      const msg = await messages().findOneAndUpdate(
        { workspaceId: ws(), waMessageId: String(s.id), $or: [{ status: { $exists: false } }, { status: { $in: allowed } }] },
        { $set: { status, ...(error && { error: { title: error, code: typeof code === 'number' ? code : null, detail: str(obj(obj(arr(s.errors)[0]).error_data).details) ?? null } }) } },
        { projection: { phone: 1 } },
      )
      if (msg) trace('message.status', { status, ...(error && { error, code }) }, { entity: 'conversation', id: String(msg.phone) })
      // A reply WhatsApp couldn't deliver that isn't stored under its own id (the AI agent's replies are
      // rebuilt from Meta's turns): say so in the chat, once, instead of showing an answer nobody got.
      else if (status === 'failed' && !(await messages().findOne({ workspaceId: ws(), waMessageId: String(s.id) }, { projection: { _id: 1 } }))) {
        const { key: phone, link } = await resolveCustomer(s.recipient_id, s.recipient_user_id)
        if (phone) {
          await ensureConversation(phone, undefined, false, link)
          const detail = str(obj(obj(arr(s.errors)[0]).error_data).details) ?? error ?? null
          await addMessage({ phone, direction: 'out', author: 'system', kind: 'event', body: undeliveredLine(code, detail), at: fromSeconds(s.timestamp), waMessageId: `failed:${String(s.id)}` })
        }
      }
      // Same trace as the broadcast that sent it, so one id follows click → send → delivery.
      const rec = await col('broadcast_recipients').findOne({ workspaceId: ws(), waMessageId: String(s.id), status: { $in: ['queued', ...allowed.filter(Boolean)] } })
      if (rec)
        await withWorkspace(
          ws(),
          async () => {
            // A failure Meta reports later (e.g. the daily marketing cap) may be retried.
            if (status === 'failed') await recipientFailed(rec, reasonOf(code), error ?? 'WhatsApp couldn’t deliver it.', typeof code === 'number' ? code : undefined)
            else await col('broadcast_recipients').updateOne({ _id: rec._id }, { $set: { status } })
            trace('broadcast.recipient', { status, ...(error && { error, code }) }, { entity: 'broadcast', id: String(rec.broadcastId) })
          },
          currentAssets() ?? null,
          { traceId: rec.traceId },
        )
    }
  }
  // A customer stopped or resumed marketing messages from WhatsApp's own settings.
  for (const raw of arr(v.user_preferences)) {
    const pref = obj(raw)
    const { key: phone } = await resolveCustomer(pref.wa_id, pref.user_id)
    if (!phone || pref.category !== 'marketing_messages') continue
    if (pref.value === 'stop' || pref.value === 'resume') {
      await contacts().updateOne({ workspaceId: ws(), phone }, { $set: { optedOut: pref.value === 'stop' } })
      trace('contact.preference', { marketing: pref.value }, { entity: 'conversation', id: phone })
    }
  }
  if (field === 'messaging_handovers') {
    // control_taken goes to the app that lost control: someone else (a person or another app) now owns the chat.
    const { key: phone } = await resolveCustomer(value.recipient_id ?? obj(value.recipient).id ?? value.wa_id ?? value.to, value.recipient_user_id ?? obj(value.recipient).user_id)
    if (phone && value.type === 'control_taken') {
      await ensureConversation(phone)
      await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human' } })
      await addMessage({ phone, direction: 'out', author: 'system', kind: 'event', body: 'The agent handed this chat to a person.', at: new Date() })
      await ensureTicket(phone, 'handoff')
    }
  }
}

/** Handles the events for the current workspace's numbers (anything else in the payload is skipped). */
export async function processWebhook(payload: unknown) {
  const mine = currentAssets()?.ids
  for (const entry of arr(obj(payload).entry))
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change)
      const value = obj(c.value)
      const phoneId = str(obj(value.metadata).phone_number_id)
      if (phoneId && !mine?.has(phoneId)) continue
      if (phoneId) await numberScope.run(phoneId, () => processChange(String(c.field), value))
      else await processChange(String(c.field), value)
    }
}

/** Sends each event to the workspace that connected that number (or, for account events, that WABA).
 *  Returns how many changes no workspace claimed (kept in webhook_inbox, shown in Webhook status). */
async function routeWebhook(payload: unknown): Promise<number> {
  const byWorkspace = new Map<string, unknown[]>()
  let unrouted = 0
  for (const entry of arr(obj(payload).entry))
    for (const change of arr(obj(entry).changes)) {
      const phoneId = str(obj(obj(obj(change).value).metadata).phone_number_id)
      const wsId = phoneId
        ? await workspaceForNumber(phoneId)
        : ((await accounts().findOne({ wabaId: String(obj(entry).id ?? '') }, { projection: { workspaceId: 1 } }))?.workspaceId ?? null)
      if (wsId) byWorkspace.set(wsId, [...(byWorkspace.get(wsId) ?? []), { ...obj(entry), changes: [change] }])
      else unrouted++
    }
  for (const [wsId, entries] of byWorkspace)
    await withWorkspace(
      wsId,
      async () => {
        await col('whatsapp_webhooks').insertOne({ workspaceId: ws(), at: new Date(), payload: { entry: entries } })
        trace('webhook.received', { fields: [...new Set(entries.flatMap((e) => arr(obj(e).changes).map((c) => String(obj(c).field))))] })
        await processWebhook({ entry: entries })
      },
      await assetsFor(wsId),
    )
  return unrouted
}

/** Apps whose signature the receiver accepts (WEBHOOK_APP_SECRETS, comma-separated): the listening
 *  app, and any other we add later. Kept apart from META_APP_SECRET (Embedded Signup). */
const webhookSecrets = () => env('WEBHOOK_APP_SECRETS').split(',').map((x) => x.trim()).filter(Boolean)

/** One delivery from Meta, exactly as sent. */
interface Delivery {
  _id: string
  receivedAt: Date
  /** Which secret in WEBHOOK_APP_SECRETS signed it. */
  app: number
  payload: unknown
  processedAt: Date | null
  attempts: number
  error?: string
  /** Changes for a number or WABA no workspace has. */
  unrouted?: number
  /** The same body arrived again (Meta's retries, its Test button): when last, and how often. */
  lastSeenAt?: Date
  repeats?: number
}
const inboxCol = () => col<Delivery>('webhook_inbox')

/** Processes one stored delivery and records the outcome on it. */
async function processDelivery(id: string, payload: unknown) {
  const inbox = inboxCol()
  try {
    const unrouted = await routeWebhook(payload)
    await inbox.updateOne({ _id: id }, { $set: { processedAt: new Date(), unrouted }, $unset: { error: '' }, $inc: { attempts: 1 } })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.log('webhook processing failed:', error)
    await inbox.updateOne({ _id: id }, { $set: { error }, $inc: { attempts: 1 } })
  }
}

/** Deliveries stored but not processed (a crash, a cold instance): tried again, oldest first.
 *  Runs after each delivery and from the daily cron. */
export async function reprocessWebhooks(limit = 20) {
  const pending = await inboxCol()
    .find({ processedAt: null, attempts: { $lt: 10 }, receivedAt: { $lt: new Date(Date.now() - 60_000) } })
    .sort({ receivedAt: 1 })
    .limit(limit)
    .toArray()
  for (const d of pending) await processDelivery(d._id, d.payload)
  return pending.length
}

/** Public: Meta's verification handshake (GET) and events (POST).
 *  POST: check the signature, store the delivery exactly as sent (once, even when Meta retries),
 *  process it, then answer. A failure is kept and retried later; nothing is dropped. */
export async function handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (u.pathname !== '/api/webhooks/whatsapp') return false
  if (req.method === 'GET') {
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!env('WEBHOOK_VERIFY_TOKEN') && u.searchParams.get('hub.verify_token') === env('WEBHOOK_VERIFY_TOKEN')
    res.writeHead(ok ? 200 : 403, { 'content-type': 'text/plain' }).end(ok ? (u.searchParams.get('hub.challenge') ?? '') : 'Verification failed')
    return true
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks)
  const secrets = webhookSecrets()
  // Not set up yet: 503 makes Meta keep the event and retry (up to 7 days) instead of losing it.
  if (!secrets.length) return void res.writeHead(503).end(), true
  const app = signedBy(raw, req.headers['x-hub-signature-256'] as string | undefined, secrets)
  if (app === null) return void res.writeHead(401).end(), true
  if (!db) return void res.writeHead(503).end(), true
  const id = deliveryId(raw)
  const payload = parseJson(raw.toString('utf8'))
  const stored = await inboxCol()
    .insertOne({ _id: id, receivedAt: new Date(), app, payload, processedAt: null, attempts: 0 })
    .then(() => true, (err: { code?: number }) => (err?.code === 11000 ? false : Promise.reject(err)))
    .catch((err: unknown) => {
      console.log('webhook not stored:', err instanceof Error ? err.message : err)
      return null
    })
  // Couldn't store it: 503 so Meta sends it again later.
  if (stored === null) return void res.writeHead(503).end(), true
  if (stored) await processDelivery(id, payload)
  // The same body again (Meta's retry, or its "Test" button pressed twice): kept once, but noted.
  else await inboxCol().updateOne({ _id: id }, { $set: { lastSeenAt: new Date() }, $inc: { repeats: 1 } }).catch(() => null)
  res.writeHead(200).end()
  await reprocessWebhooks(5).catch(() => 0)
  return true
}

// ---- reads ----
const WINDOW = DAY
async function listConversations(me: Actor, filter: string, q: string) {
  await syncRoster()
  const where: Obj = { workspaceId: ws() }
  if (filter === 'mine') where.assigneeId = me._id
  if (filter === 'unassigned') Object.assign(where, { owner: 'human', assigneeId: null })
  if (filter === 'ai') where.owner = 'ai'
  // Snoozed chats live under their own filter until their time comes.
  const now = new Date()
  const scope = await scopeFor(me)
  where.$and = [
    filter === 'snoozed' ? { snoozedUntil: { $gt: now } } : { $or: [{ snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: now } }] },
    ...(scope ? [scope] : []),
  ]
  const rows = await conversations().find(where).sort({ lastMessageAt: -1 }).limit(500).toArray()
  const people = new Map((await contacts().find({ workspaceId: ws(), phone: { $in: rows.map((r) => r.phone) } }).toArray()).map((c) => [c.phone, c]))
  const lastByPhone = new Map(
    (
      await messages()
        .aggregate([{ $match: { workspaceId: ws(), phone: { $in: rows.map((r) => r.phone) }, kind: { $ne: 'note' } } }, { $sort: { at: -1 } }, { $group: { _id: '$phone', m: { $first: '$$ROOT' } } }])
        .toArray()
    ).map((x) => [x._id, x.m]),
  )
  const needle = q.trim().toLowerCase()
  return rows
    .map((r) => {
      const c = people.get(r.phone)
      const last = lastByPhone.get(r.phone)
      return {
        phone: r.phone,
        name: c?.name ?? null,
        ...(c?.username && { username: c.username }),
        tags: c?.tags ?? [],
        owner: r.owner,
        assigneeId: r.assigneeId ?? null,
        unread: r.unread ?? 0,
        lastMessageAt: r.lastMessageAt,
        windowOpen: !!r.lastInboundAt && Date.now() - +r.lastInboundAt < WINDOW,
        sample: !!r.sample,
        snoozedUntil: r.snoozedUntil ?? null,
        preview: last ? { author: last.author, body: last.body } : null,
      }
    })
    .filter((r) => !needle || r.phone.includes(needle) || (r.name ?? '').toLowerCase().includes(needle))
}

/** The whole conversation in order, with who said what: the customer, the AI agent, a teammate, or
 *  someone outside this console. `from`/`to` limit it to a time range. */
async function transcript(phone: string, me: Actor, u: URL) {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
  await needInScope(me, conv.assigneeId)
  const range = (k: string) => {
    const v = u.searchParams.get(k)
    if (!v) return null
    const d = new Date(/^\d+$/.test(v) ? Number(v) : v)
    if (Number.isNaN(+d)) throw new HttpError(400, `${k} must be a date.`)
    return d
  }
  const [from, to] = [range('from'), range('to')]
  const contact = await contacts().findOne({ workspaceId: ws(), phone }, { projection: { name: 1 } })
  const rows = await messages()
    .find({ workspaceId: ws(), phone, ...((from || to) && { at: { ...(from && { $gte: from }), ...(to && { $lte: to }) } }) })
    .sort({ at: 1 })
    .toArray()
  const who = (m: Obj) =>
    m.author === 'customer' ? (str(contact?.name) ?? `+${phone}`) : m.author === 'ai' ? 'AI agent' : m.author === 'system' ? 'System' : (str(m.authorName) ?? 'Team')
  return {
    phone,
    name: str(contact?.name) ?? null,
    from: from ?? rows[0]?.at ?? null,
    to: to ?? rows.at(-1)?.at ?? null,
    messages: rows.map((m) => ({
      at: m.at,
      from: who(m),
      author: m.author,
      kind: m.kind,
      text: m.body ?? (m.author === 'customer' ? '(message words not received)' : ''),
      ...(m.media && { media: { kind: obj(m.media).kind, filename: obj(m.media).filename ?? null } }),
      ...(m.status && { status: m.status }),
      ...(m.waMessageId && { waMessageId: m.waMessageId }),
      ...(Array.isArray(m.tools) && m.tools.length && { tools: m.tools }),
    })),
  }
}

/** The transcript as plain text, one line per message. */
const transcriptText = (t: Awaited<ReturnType<typeof transcript>>) =>
  [`Conversation with ${t.name ? `${t.name} (+${t.phone})` : `+${t.phone}`}`, '', ...t.messages.map((m) => `[${new Date(m.at as Date).toISOString().replace('T', ' ').slice(0, 19)} UTC] ${m.from}: ${m.text}${m.media ? ` [${m.media.kind}${m.media.filename ? `: ${m.media.filename}` : ''}]` : ''}`)].join('\n') + '\n'

async function getConversation(phone: string, me?: Actor) {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
  if (me) await needInScope(me, conv.assigneeId)
  if (!conv.sample) await syncTurns(phone)
  const [contact, rows] = await Promise.all([
    contacts().findOne({ workspaceId: ws(), phone }, { projection: { _id: 0, workspaceId: 0 } }),
    messages().find({ workspaceId: ws(), phone }, { projection: { workspaceId: 0 } }).sort({ at: 1 }).limit(1000).toArray(),
  ])
  const fresh = await conversations().findOne({ workspaceId: ws(), phone })
  const viewers = me
    ? (await col('presence').find({ workspaceId: ws(), phone, userId: { $ne: me._id }, at: { $gte: new Date(Date.now() - 20_000) } }).toArray()).map((p) => ({ name: String(p.name), typing: !!p.typing }))
    : []
  return {
    viewers,
    conversation: {
      phone,
      owner: fresh!.owner,
      assigneeId: fresh!.assigneeId ?? null,
      lastInboundAt: fresh!.lastInboundAt ?? null,
      windowOpen: !!fresh!.lastInboundAt && Date.now() - +fresh!.lastInboundAt < WINDOW,
      sample: !!fresh!.sample,
      snoozedUntil: fresh!.snoozedUntil && +fresh!.snoozedUntil > Date.now() ? fresh!.snoozedUntil : null,
    },
    reminders: me ? (await upcomingReminders(me._id, phone)).map((r) => ({ id: String(r._id), note: r.note, dueAt: r.dueAt })) : [],
    contact,
    messages: rows.map(({ _id, ...m }) => ({ id: String(_id), ...m })),
  }
}

// ---- writes ----
/** Sends a WhatsApp message (sample chats are only stored) and records it in the chat. */
async function deliver(phone: string, payload: Obj, msg: Omit<Msg, 'phone' | 'direction' | 'at' | 'waMessageId'>, sample: boolean): Promise<string | undefined> {
  let waMessageId: string | undefined
  if (!sample) {
    needMetaAssets()
    const r = await metaJson('graph', 'POST', '/PHONE_NUMBER_ID/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', ...sendTarget(phone), ...payload })
    waMessageId = str(obj(arr(r.messages)[0]).id)
  }
  await addMessage({ ...msg, phone, direction: 'out', at: new Date(), waMessageId, status: 'sent', ...(sample && { sample: true }) })
  return waMessageId
}
/** An approved template (the only kind allowed outside the 24-hour window). Returns the wamid. */
export const sendTemplateMessage = (phone: string, template: Obj, rendered: string, o: { sample: boolean; actor?: Actor; label?: string }) =>
  deliver(phone, { type: 'template', template }, { author: o.actor ? 'agent' : 'system', authorId: o.actor?._id, authorName: o.actor?.name ?? o.label, kind: 'template', body: rendered }, o.sample)
export const sendText = (phone: string, body: string, o: { author: Msg['author']; actor?: Actor; sample: boolean }) =>
  deliver(phone, { type: 'text', text: { body } }, { author: o.author, authorId: o.actor?._id, authorName: o.actor?.name, kind: 'text', body }, o.sample)
/** Up to 3 reply buttons (WhatsApp's limit), e.g. the CSAT question. */
export const sendInteractive = (phone: string, body: string, buttons: { id: string; title: string }[], o: { sample: boolean }) =>
  deliver(
    phone,
    { type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) } } },
    { author: 'system', kind: 'interactive', body: `${body} [${buttons.map((b) => b.title).join(' · ')}]` },
    o.sample,
  )

/** A person's message into an open chat: checks the 24-hour window, sends, then the chat is the team's. */
async function agentSend(me: Actor, phone: string, send: (sample: boolean) => Promise<unknown>) {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
  if (!conv.lastInboundAt || Date.now() - +conv.lastInboundAt >= WINDOW)
    throw new HttpError(400, 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
  await send(!!conv.sample)
  // Sending from our app moves thread control to us (Meta's rule), so the chat is now with people.
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human', unread: 0, ...(!conv.assigneeId && { assigneeId: me._id }) } })
  await ensureTicket(phone, 'reply')
  await onAgentReply(phone)
}
const reply = (me: Actor, phone: string, body: string) => agentSend(me, phone, (sample) => sendText(phone, body, { author: 'agent', actor: me, sample }))

async function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > max) throw new HttpError(413, 'That file is too big for WhatsApp.')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

/** An attachment from a person: stored here, uploaded to WhatsApp, then sent (sample chats: stored only). */
async function sendMedia(me: Actor, phone: string, req: http.IncomingMessage) {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const announced = checkMedia(mime, Number(req.headers['content-length'] ?? 1) || 1)
  if ('error' in announced) throw new HttpError(400, announced.error)
  const buf = await readRaw(req, MEDIA_RULES[announced.kind].max)
  const checked = checkMedia(mime, buf.length)
  if ('error' in checked) throw new HttpError(400, checked.error)
  const kind = checked.kind
  const header = (k: string) => {
    try {
      return decodeURIComponent(String(req.headers[k] ?? ''))
    } catch {
      return ''
    }
  }
  const filename = header('x-filename').replace(/[\\/\r\n]/g, '_').slice(0, 200) || kind
  const caption = kind === 'audio' ? '' : header('x-caption').trim().slice(0, 1024)
  await agentSend(me, phone, async (sample) => {
    const id = await saveMedia(buf, { mime, filename, source: 'upload' })
    const media: MessageMedia = { kind, mime, id, filename, size: buf.length, ...(caption && { caption }), state: 'ready' }
    const payload = sample ? {} : { type: kind, [kind]: { id: await uploadToMeta(buf, mime, filename), ...(caption && { caption }), ...(kind === 'document' && { filename }) } }
    await deliver(phone, payload, { author: 'agent', authorId: me._id, authorName: me.name, kind: 'media', body: caption || mediaLabel(kind, filename), media }, sample)
  })
  trace('message.media_sent', { kind, size: buf.length }, { entity: 'conversation', id: phone })
}

export async function setControl(me: Actor, phone: string, action: 'take' | 'release') {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
  // Sample chats follow the same rule, so demos show what real ones do.
  if (isBsuid(phone)) throw new HttpError(400, NO_CONTROL_HIDDEN)
  if (!conv.sample) {
    needMetaAssets()
    // Thread control refusals are the caller's to fix (e.g. another app owns the chat): always 400.
    await metaJson('meta', 'POST', '/business/whatsapp/phone_numbers/PHONE_NUMBER_ID/thread_control', { messaging_product: 'whatsapp', action, to: phone }, 400)
  }
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: action === 'take' ? 'human' : 'ai', ...(action === 'take' && !conv.assigneeId && { assigneeId: me._id }) } })
  if (action === 'take') await ensureTicket(phone, 'takeover')
  await addMessage({
    phone,
    direction: 'out',
    author: 'system',
    kind: 'event',
    body: action === 'take' ? `${me.name} took over from the AI agent.` : `${me.name} handed the chat back to the AI agent.`,
    at: new Date(),
  })
}

// ---- canned responses ----
const canned = () => col('canned_responses')
const cannedOut = ({ _id, workspaceId: _w, ...c }: Obj) => ({ id: String(_id), ...c })
async function saveCanned(me: Actor, body: Obj, id?: string) {
  const shortcut = text(body.shortcut, 'a shortcut', 40).replace(/^\/?/, '/').toLowerCase()
  if (!/^\/[a-z0-9-_]+$/.test(shortcut)) throw new HttpError(400, 'Shortcuts use letters, numbers, - and _ only, like /refund.')
  // Shared responses are the team's; only roles that manage settings can share or change them.
  const admin = can(me.role, 'settings.manage')
  const doc = { title: text(body.title, 'a title', 80), shortcut, body: text(body.body, 'the reply'), shared: body.shared !== false && admin, updatedAt: new Date() }
  if (id && !admin && (await canned().findOne({ _id: new ObjectId(id), workspaceId: ws(), shared: true }))) throw new HttpError(403, 'Only owners and admins can change the team’s shared responses.')
  const clash = await canned().findOne({ workspaceId: ws(), shortcut, ...(id && { _id: { $ne: new ObjectId(id) } }) })
  if (clash) throw new HttpError(409, `${shortcut} is already used by “${clash.title}”.`)
  if (id) {
    const r = await canned().findOneAndUpdate({ _id: new ObjectId(id), workspaceId: ws(), $or: [{ shared: true }, { createdBy: me._id }] }, { $set: doc }, { returnDocument: 'after' })
    if (!r) throw new HttpError(404, 'That response no longer exists.')
    return cannedOut(r)
  }
  const full = { ...doc, workspaceId: ws(), createdBy: me._id, createdAt: new Date() }
  const r = await canned().insertOne(full)
  return cannedOut({ ...full, _id: r.insertedId })
}

// ---- demo data ----
async function seedSamples(me: Actor) {
  const now = Date.now()
  for (const c of SAMPLE_CHATS) {
    await ensureConversation(c.phone, c.name || undefined, true, c.username ? { username: c.username } : {})
    await contacts().updateOne({ workspaceId: ws(), phone: c.phone }, { $set: { tags: c.tags } })
    for (const m of c.messages) {
      const at = new Date(now - m.ago * 60_000)
      await addMessage({
        phone: c.phone,
        direction: m.author === 'customer' ? 'in' : 'out',
        author: m.author === 'note' ? 'agent' : m.author,
        ...(m.author === 'agent' || m.author === 'note' ? { authorId: me._id, authorName: me.name } : {}),
        kind: m.author === 'note' ? 'note' : 'text',
        body: m.body,
        at,
        sample: true,
      })
    }
    await conversations().updateOne({ workspaceId: ws(), phone: c.phone }, { $set: { owner: c.owner, ...(c.owner === 'human' && c.phone.endsWith('103') && { assigneeId: me._id }) } })
    if (c.owner === 'human') await ensureTicket(c.phone, 'handoff', { priority: c.tags.includes('priority') ? 'high' : 'normal', sample: true })
  }
}
async function clearSamples() {
  for (const c of [conversations(), messages(), contacts(), col('tickets')]) await c.deleteMany({ workspaceId: ws(), sample: true })
}

// ---- AI assist ----
/** Asks the business's own agent (agent_test) how it would answer the customer's last message. */
async function suggestReply(phone: string) {
  needMetaAssets()
  const last = await messages().findOne({ workspaceId: ws(), phone, author: 'customer', body: { $type: 'string', $ne: '' } }, { sort: { at: -1 } })
  if (!last) throw new HttpError(400, 'There’s no customer text to answer yet. It arrives once WhatsApp webhooks are connected.')
  const r = await callUpstream('meta', 'POST', resolveIds('/PHONE_NUMBER_ID/agent_test'), Buffer.from(JSON.stringify({ user_msg: last.body })), 'application/json')
  const answer = str(obj(parseJson(r.text)).agent_response)
  if (r.status >= 300 || !answer) throw new HttpError(502, 'The AI agent couldn’t suggest a reply this time. Try again.')
  return answer
}

/** A short summary for whoever picks the chat up, written by Claude (needs ANTHROPIC_API_KEY). */
async function summarize(phone: string) {
  const key = env('ANTHROPIC_API_KEY')
  if (!key) throw new HttpError(400, 'Summaries need an Anthropic API key in the server settings (ANTHROPIC_API_KEY).')
  const rows = await messages().find({ workspaceId: ws(), phone, kind: { $ne: 'event' } }).sort({ at: -1 }).limit(60).toArray()
  const transcript = rows
    .reverse()
    .map((x) => `${x.kind === 'note' ? 'Internal note' : x.author === 'customer' ? 'Customer' : x.author === 'ai' ? 'AI agent' : (x.authorName ?? 'Team')}: ${x.body ?? '(message text not available)'}`)
    .join('\n')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'You summarise WhatsApp support chats for the support agent taking over. Write 2 to 4 short sentences in plain English: what the customer wants, what has been done, and what is still open. No preamble.',
      messages: [{ role: 'user', content: transcript || 'No messages yet.' }],
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  const json = r ? obj(await r.json().catch(() => ({}))) : {}
  recordAiUsage('chat_summary', 'claude-haiku-4-5-20251001', json.usage)
  const out = str(obj(arr(json.content)[0]).text)
  if (!r?.ok || !out) throw new HttpError(502, 'Couldn’t write a summary right now. Try again.')
  return out
}

// ---- routes ----
async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/inbox/search' && m === 'GET') return searchMessages(u.searchParams.get('q') ?? '')
  if (path === '/api/inbox/views' && m === 'GET') return listViews(me._id)
  if (path === '/api/inbox/views' && m === 'POST') return saveView(me._id, obj(await readJson(req)))
  if ((seg = path.match(/^\/api\/inbox\/views\/([a-f0-9]{24})$/)) && m === 'DELETE') return deleteView(me._id, seg[1])
  if (path === '/api/inbox/conversations' && m === 'GET') return listConversations(me, u.searchParams.get('filter') ?? 'all', u.searchParams.get('q') ?? '')
  if ((seg = path.match(/^\/api\/inbox\/conversations\/([^/]+)(?:\/([a-z]+))?$/))) {
    const phone = phoneParam(decodeURIComponent(seg[1]))
    const action = seg[2]
    if (!action && m === 'GET') return getConversation(phone, me)
    if (action === 'transcript' && m === 'GET') return transcript(phone, me, u)
    if (m !== 'POST') throw new HttpError(405, 'Method not allowed.')
    if (action === 'media') {
      await sendMedia(me, phone, req)
      return getConversation(phone, me)
    }
    const body = obj(await readJson(req))
    if (action === 'presence') {
      // Collision detection: who else has this chat open (and is typing). Expires by TTL.
      await col('presence').updateOne({ workspaceId: ws(), phone, userId: me._id }, { $set: { name: me.name, typing: body.typing === true, at: new Date() } }, { upsert: true })
      return { ok: true }
    }
    if (action === 'suggest') return { text: await suggestReply(phone) }
    if (action === 'summary') return { text: await summarize(phone) }
    if (action === 'messages') await reply(me, phone, text(body.text, 'a reply'))
    else if (action === 'interactive') {
      // Reply buttons or a list, within WhatsApp's limits (src/app/inbox/interactive.ts).
      const r: InteractiveReply =
        body.type === 'list'
          ? { type: 'list', body: String(body.body ?? ''), button: String(body.button ?? ''), rows: arr(body.rows).map((x) => ({ title: String(obj(x).title ?? ''), description: str(obj(x).description) })) }
          : { type: 'button', body: String(body.body ?? ''), buttons: arr(body.buttons).map(String) }
      const problem = interactiveError(r)
      if (problem) throw new HttpError(400, problem)
      await agentSend(me, phone, (sample) =>
        deliver(phone, { type: 'interactive', interactive: interactivePayload(r) }, { author: 'agent', authorId: me._id, authorName: me.name, kind: 'interactive', body: interactiveText(r) }, sample),
      )
    }
    else if (action === 'notes') {
      if (!(await conversations().findOne({ workspaceId: ws(), phone }))) throw new HttpError(404, 'No chat with this number yet.')
      await addMessage({ phone, direction: 'out', author: 'agent', authorId: me._id, authorName: me.name, kind: 'note', body: text(body.text, 'a note'), at: new Date() })
    } else if (action === 'assign') {
      const userId = body.userId === null ? null : String(body.userId ?? '')
      needCanAssign(me, userId, (await conversations().findOne({ workspaceId: ws(), phone }, { projection: { assigneeId: 1 } }))?.assigneeId)
      if (userId && !(await col('memberships').findOne({ workspaceId: ws(), userId }))) throw new HttpError(400, 'That person isn’t in this workspace.')
      await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { assigneeId: userId } })
    } else if (action === 'control') {
      if (body.action !== 'take' && body.action !== 'release') throw new HttpError(400, 'Action must be take or release.')
      await setControl(me, phone, body.action)
    } else if (action === 'read') await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { unread: 0 } })
    else if (action === 'snooze') await snooze(phone, body.until ?? null, me._id)
    else if (action === 'block' || action === 'unblock') {
      // Blocking happens on WhatsApp, on the workspace's default number (sample chats: only here).
      if (!can(me.role, 'numbers.edit')) throw new HttpError(403, 'Owners and admins block customers.')
      const conv = await conversations().findOne({ workspaceId: ws(), phone })
      if (conv?.sample) await contacts().updateOne({ workspaceId: ws(), phone }, action === 'block' ? { $set: { blocked: true } } : { $unset: { blocked: '' } })
      else {
        needMetaAssets()
        await setBlocked(currentAssets()!.phoneNumberId, phone, action === 'block')
      }
    }
    else if (action === 'remind') await remind(phone, body, me._id)
    else throw new HttpError(404, 'Not found.')
    if (action !== 'messages' && action !== 'notes') trace('conversation.updated', { action, ...(action === 'control' && { to: body.action }) }, { entity: 'conversation', id: phone })
    return getConversation(phone, me)
  }
  if (path === '/api/inbox/canned' && m === 'GET')
    return (await canned().find({ workspaceId: ws(), $or: [{ shared: true }, { createdBy: me._id }] }).sort({ shortcut: 1 }).toArray()).map(cannedOut)
  if (path === '/api/inbox/canned' && m === 'POST') return saveCanned(me, obj(await readJson(req)))
  if ((seg = path.match(/^\/api\/inbox\/canned\/([a-f0-9]{24})$/))) {
    if (m === 'PUT') return saveCanned(me, obj(await readJson(req)), seg[1])
    if (m === 'DELETE') {
      const r = await canned().deleteOne({ _id: new ObjectId(seg[1]), workspaceId: ws(), $or: [{ createdBy: me._id }, ...(can(me.role, 'settings.manage') ? [{ shared: true }] : [])] })
      if (!r.deletedCount) throw new HttpError(404, 'That response no longer exists.')
      return { ok: true }
    }
  }
  if (path === '/api/inbox/demo' && m === 'POST') {
    await seedSamples(me)
    return { ok: true }
  }
  if (path === '/api/inbox/demo' && m === 'DELETE') {
    await clearSamples()
    return { ok: true }
  }
  if (path === '/api/inbox/demo/simulate' && m === 'POST') {
    // A fake customer message through the real webhook processor, so the whole path can be tried today.
    const body = obj(await readJson(req))
    const phone = phoneParam(String(body.phone ?? SAMPLE_CHATS[0].phone))
    const conv = await conversations().findOne({ workspaceId: ws(), phone })
    const sample = !!conv?.sample
    // Meta delivers on `messages` while people hold the chat, on `standby` while the agent does.
    const field = conv?.owner === 'human' ? 'messages' : 'standby'
    const event = { contacts: [{ wa_id: phone, profile: { name: str(body.name) } }], messages: [{ from: phone, id: `sim.${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text(body.text, 'a message') } }] }
    await processWebhook({
      entry: [
        {
          changes: [
            {
              field,
              value: { metadata: { phone_number_id: currentAssets()?.phoneNumberId }, ...(field === 'standby' ? { standby: event } : event) },
            },
          ],
        },
      ],
    })
    if (sample) await messages().updateMany({ workspaceId: ws(), phone, sample: { $exists: false } }, { $set: { sample: true } })
    return { ok: true }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'No WhatsApp account connected', 404: 'Not found', 409: 'Already exists', 502: 'WhatsApp didn’t accept it' }
export async function handleInbox(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/inbox/')) return false
  // Files stream out as they are, not as JSON.
  const file = u.pathname.match(/^\/api\/inbox\/media\/([a-f0-9]{24})$/)
  if (file && req.method === 'GET' && db)
    return serveMedia(file[1], res, u.searchParams.has('download')).then(
      () => true,
      (err: unknown) => {
        res.writeHead(err instanceof HttpError ? err.status : 500, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Not found', detail: err instanceof Error ? err.message : 'No such file.' }))
        return true
      },
    )
  // Transcript as a .txt download.
  const txt = u.pathname.match(/^\/api\/inbox\/conversations\/([^/]+)\/transcript$/)
  if (txt && req.method === 'GET' && u.searchParams.get('format') === 'txt' && db) {
    try {
      const phone = phoneParam(decodeURIComponent(txt[1]))
      const text = transcriptText(await transcript(phone, me, u))
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="chat-${phone}.txt"` }).end(text)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ title: TITLES[status] ?? 'Error', detail: err instanceof Error ? err.message : 'Couldn’t build the transcript.', status }))
    }
    return true
  }
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'The inbox needs the database.' } }, () => route(req, u, me))
}
