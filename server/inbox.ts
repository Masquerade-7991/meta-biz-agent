// Inbox: one chat per customer who talks to the agent, plus the WhatsApp webhook that feeds it.
// Before webhooks are routed here, chats are built from Meta's conversation-turns API (one turn per
// customer message: its wamid, the agent's reply preview and tool calls). Webhooks then add the
// customer's own words (same wamid, so the placeholder fills in), echoes of the agent's replies,
// delivery ticks and handovers. Replies from people go out through the Cloud API send endpoint.
import type http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, arr, digits, obj, readJson, serveJson, str } from './http.ts'
import { col, db, dbOffReason, needMetaAssets, ownsMetaAssets, withWorkspace, ws } from './db.ts'
import { callUpstream, env, ids, metaJson, parseJson, resolveIds } from './upstream.ts'
import { SAMPLE_CHATS } from '../src/app/inbox/sampleData.ts'
import { ensureTicket, onAgentReply, onCustomerMessage } from './tickets.ts'

export interface Actor {
  _id: string
  name: string
  role: 'owner' | 'member' | null
}

const fromSeconds = (v: unknown) => (Number(v) > 0 ? new Date(Number(v) * 1000) : new Date())
const DAY = 86_400_000

export const conversations = () => col('conversations')
const messages = () => col('messages')
const contacts = () => col('contacts')

function phoneParam(v: string): string {
  const p = digits(v)
  if (!/^\d{8,15}$/.test(p)) throw new HttpError(400, 'Phone must be 8 to 15 digits, country code first.')
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
}

/** Makes sure the customer has a contact and a conversation (AI-handled until someone takes over). */
export async function ensureConversation(phone: string, name?: string, sample = false) {
  const now = new Date()
  await contacts().updateOne(
    { workspaceId: ws(), phone },
    { $setOnInsert: { workspaceId: ws(), phone, tags: [], fields: {}, createdAt: now, source: sample ? 'sample' : 'whatsapp', ...(sample && { sample }) }, ...(name && { $set: { name } }) },
    { upsert: true },
  )
  await conversations().updateOne(
    { workspaceId: ws(), phone },
    { $setOnInsert: { workspaceId: ws(), phone, owner: 'ai', assigneeId: null, unread: 0, lastMessageAt: null, lastInboundAt: null, createdAt: now, ...(sample && { sample }) } },
    { upsert: true },
  )
}

/** Stores a message once (deduped by wamid or turn id) and keeps the conversation summary current.
 *  A webhook with the customer's words fills in a placeholder made from a turn (same wamid). */
export async function addMessage(m: Msg): Promise<boolean> {
  const doc = { ...m, workspaceId: ws(), createdAt: new Date() }
  let inserted = true
  if (m.waMessageId || m.turnId) {
    const key = m.waMessageId ? { waMessageId: m.waMessageId } : { turnId: m.turnId }
    // Text, when known, always wins: it fills a placeholder (body null) made from a turn.
    const { body, kind, ...rest } = doc
    const r = await messages().updateOne({ workspaceId: ws(), ...key }, body !== null ? { $setOnInsert: rest, $set: { body, kind } } : { $setOnInsert: doc }, { upsert: true })
    inserted = r.upsertedCount === 1
  } else await messages().insertOne(doc)
  if (!inserted) return false
  const inbound = m.direction === 'in'
  if (inbound) await contacts().updateOne({ workspaceId: ws(), phone: m.phone }, { $max: { lastSeenAt: m.at } })
  // History pulled from Meta isn't news; only messages from the last day count as unread.
  const fresh = Date.now() - m.at.getTime() < DAY
  await conversations().updateOne(
    { workspaceId: ws(), phone: m.phone },
    {
      $max: { lastMessageAt: m.at, ...(inbound && { lastInboundAt: m.at }) },
      ...(inbound && fresh && { $inc: { unread: 1 } }),
    },
  )
  return true
}

// ---- Meta: turns, send, thread control ----
interface Turn {
  turn_id?: string
  message_id?: string
  timestamp?: number
  steps?: { type?: string; llm_output_preview?: string; tool_name?: string }[]
}

/** Pulls the customer's recent turns from Meta into the chat (throttled per customer). */
const lastSync = new Map<string, number>()
async function syncTurns(phone: string, force = false) {
  if (!ownsMetaAssets()) return
  const key = `${ws()}|${phone}`
  if (!force && Date.now() - (lastSync.get(key) ?? 0) < 15_000) return
  lastSync.set(key, Date.now())
  const r = await callUpstream('meta', 'GET', resolveIds(`/PHONE_NUMBER_ID/insights/conversations/turns?user_phone_number=${phone}&limit=50`)).catch(() => null)
  if (!r || r.status !== 200) return
  for (const t of arr(obj(parseJson(r.text)).data) as Turn[]) {
    if (!t.turn_id) continue
    const at = new Date(Number(t.timestamp) || Date.now())
    const steps = t.steps ?? []
    const reply = [...steps].reverse().find((s) => s.type === 'LLM_CALL' && s.llm_output_preview)?.llm_output_preview
    const tools = steps.filter((s) => s.type === 'TOOL_CALL' && s.tool_name).map((s) => s.tool_name!)
    // Each turn starts with a customer message; its words arrive only by webhook.
    await addMessage({ phone, direction: 'in', author: 'customer', kind: 'text', body: null, at: new Date(at.getTime() - 1), waMessageId: t.message_id || `turn:${t.turn_id}` })
    const echoed = await messages().findOne({ workspaceId: ws(), phone, author: 'ai', turnId: { $exists: false }, at: { $gte: new Date(at.getTime() - 120_000), $lte: new Date(at.getTime() + 120_000) } })
    if ((reply || tools.length) && !echoed) await addMessage({ phone, direction: 'out', author: 'ai', kind: 'text', body: reply ?? '', at, turnId: t.turn_id, tools })
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
/** Turns one webhook `value` into chat updates. `field` is messages | standby | messaging_handovers. */
async function processChange(field: string, value: Obj) {
  const v = field === 'standby' ? obj(value.standby) : value
  const names = new Map(arr(v.contacts).map((c) => [digits(obj(c).wa_id), str(obj(obj(c).profile).name)]))
  for (const raw of arr(v.messages)) {
    const m = obj(raw)
    const phone = digits(m.from)
    if (!phone) continue
    await ensureConversation(phone, names.get(phone))
    const type = str(m.type) ?? 'text'
    const body =
      type === 'text'
        ? (str(obj(m.text).body) ?? '')
        : type === 'interactive'
          ? (str(obj(obj(m.interactive).button_reply).title) ?? str(obj(obj(m.interactive).list_reply).title) ?? 'Replied to a message')
          : type === 'button'
            ? (str(obj(m.button).text) ?? 'Tapped a button')
            : `Sent ${type === 'image' || type === 'audio' ? 'an' : 'a'} ${type}`
    await addMessage({ phone, direction: 'in', author: 'customer', kind: type === 'text' ? 'text' : type === 'interactive' || type === 'button' ? 'interactive' : 'media', body, at: fromSeconds(m.timestamp), waMessageId: str(m.id) })
    // A reply within 3 days counts towards the last broadcast this customer received.
    await col('broadcast_recipients').findOneAndUpdate(
      { workspaceId: ws(), phone, status: { $in: ['sent', 'delivered', 'read'] }, repliedAt: { $exists: false }, sentAt: { $gte: new Date(Date.now() - 3 * DAY) } },
      { $set: { repliedAt: new Date() } },
      { sort: { sentAt: -1 } },
    )
    // WhatsApp's opt-out words: STOP keeps the contact out of broadcasts, START lets them back in.
    const word = body.trim().toUpperCase()
    if (['STOP', 'UNSUBSCRIBE', 'START'].includes(word)) await contacts().updateOne({ workspaceId: ws(), phone }, { $set: { optedOut: word !== 'START' } })
    // On `messages` our app holds the chat; on `standby` the agent does.
    const owner = field === 'messages' ? 'human' : 'ai'
    const conv = await conversations().findOneAndUpdate({ workspaceId: ws(), phone }, { $set: { owner } }, { returnDocument: 'after' })
    await onCustomerMessage(phone, body, owner, !!conv?.sample)
  }
  for (const raw of arr(v.message_echoes)) {
    const e = obj(raw)
    const msg = obj(e.message)
    const phone = digits(msg.to)
    if (!phone) continue
    await ensureConversation(phone)
    const body = str(obj(msg.text).body) ?? str(obj(obj(msg.interactive).body).text) ?? `Sent a ${str(msg.type) ?? 'message'}`
    const at = fromSeconds(e.timestamp)
    await addMessage({ phone, direction: 'out', author: 'ai', kind: 'text', body, at, waMessageId: str(e.id) })
    // The full echo replaces the turn's short preview of the same reply.
    await messages().deleteMany({ workspaceId: ws(), phone, author: 'ai', turnId: { $exists: true }, at: { $gte: new Date(at.getTime() - 120_000), $lte: new Date(at.getTime() + 120_000) } })
  }
  for (const raw of arr(v.statuses)) {
    const s = obj(raw)
    const status = str(s.status)
    if (str(s.id) && status && ['sent', 'delivered', 'read', 'failed'].includes(status)) {
      await messages().updateOne({ workspaceId: ws(), waMessageId: String(s.id) }, { $set: { status } })
      const error = str(obj(arr(s.errors)[0]).title)
      await col('broadcast_recipients').updateOne({ workspaceId: ws(), waMessageId: String(s.id) }, { $set: { status, ...(error && { error }) } })
    }
  }
  if (field === 'messaging_handovers') {
    // control_taken goes to the app that lost control: someone else (a person or another app) now owns the chat.
    const phone = digits(value.recipient_id ?? obj(value.recipient).id ?? value.wa_id ?? value.to)
    if (phone && value.type === 'control_taken') {
      await ensureConversation(phone)
      await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human' } })
      await addMessage({ phone, direction: 'out', author: 'system', kind: 'event', body: 'The agent handed this chat to a person.', at: new Date() })
      await ensureTicket(phone, 'handoff')
    }
  }
}

export async function processWebhook(payload: unknown) {
  for (const entry of arr(obj(payload).entry))
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change)
      const value = obj(c.value)
      const phoneId = str(obj(value.metadata).phone_number_id)
      if (phoneId && phoneId !== ids.PHONE_NUMBER_ID) continue // another number on the shared account
      await processChange(String(c.field), value)
    }
}

/** Public: Meta's verification handshake (GET) and events (POST). Runs in the workspace that owns the number. */
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
  const secret = env('APP_SECRET')
  if (secret) {
    const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'))
    const got = Buffer.from(String(req.headers['x-hub-signature-256'] ?? ''))
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      res.writeHead(401).end()
      return true
    }
  }
  res.writeHead(200).end() // acknowledge first; Meta retries slow answers
  if (!db) return true
  const owner = await col('workspaces').findOne({ metaAssets: true })
  if (!owner) return true
  const payload = parseJson(raw.toString('utf8'))
  await withWorkspace(
    String(owner._id),
    async () => {
      await col('whatsapp_webhooks').insertOne({ workspaceId: ws(), at: new Date(), payload })
      await processWebhook(payload)
    },
    true,
  ).catch((err: unknown) => console.log('webhook processing failed:', err instanceof Error ? err.message : err))
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
        tags: c?.tags ?? [],
        owner: r.owner,
        assigneeId: r.assigneeId ?? null,
        unread: r.unread ?? 0,
        lastMessageAt: r.lastMessageAt,
        windowOpen: !!r.lastInboundAt && Date.now() - +r.lastInboundAt < WINDOW,
        sample: !!r.sample,
        preview: last ? { author: last.author, body: last.body } : null,
      }
    })
    .filter((r) => !needle || r.phone.includes(needle) || (r.name ?? '').toLowerCase().includes(needle))
}

async function getConversation(phone: string, me?: Actor) {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
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
    },
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
    const r = await metaJson('graph', 'POST', '/PHONE_NUMBER_ID/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, ...payload })
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

async function reply(me: Actor, phone: string, body: string) {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
  if (!conv.lastInboundAt || Date.now() - +conv.lastInboundAt >= WINDOW)
    throw new HttpError(400, 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
  await sendText(phone, body, { author: 'agent', actor: me, sample: !!conv.sample })
  // Sending from our app moves thread control to us (Meta's rule), so the chat is now with people.
  await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human', unread: 0, ...(!conv.assigneeId && { assigneeId: me._id }) } })
  await ensureTicket(phone, 'reply')
  await onAgentReply(phone)
}

export async function setControl(me: Actor, phone: string, action: 'take' | 'release') {
  const conv = await conversations().findOne({ workspaceId: ws(), phone })
  if (!conv) throw new HttpError(404, 'No chat with this number yet.')
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
  const doc = { title: text(body.title, 'a title', 80), shortcut, body: text(body.body, 'the reply'), shared: body.shared !== false, updatedAt: new Date() }
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
    await ensureConversation(c.phone, c.name, true)
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
  const out = str(obj(arr(json.content)[0]).text)
  if (!r?.ok || !out) throw new HttpError(502, 'Couldn’t write a summary right now. Try again.')
  return out
}

// ---- routes ----
async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/inbox/conversations' && m === 'GET') return listConversations(me, u.searchParams.get('filter') ?? 'all', u.searchParams.get('q') ?? '')
  if ((seg = path.match(/^\/api\/inbox\/conversations\/([^/]+)(?:\/([a-z]+))?$/))) {
    const phone = phoneParam(decodeURIComponent(seg[1]))
    const action = seg[2]
    if (!action && m === 'GET') return getConversation(phone, me)
    if (m !== 'POST') throw new HttpError(405, 'Method not allowed.')
    const body = obj(await readJson(req))
    if (action === 'presence') {
      // Collision detection: who else has this chat open (and is typing). Expires by TTL.
      await col('presence').updateOne({ workspaceId: ws(), phone, userId: me._id }, { $set: { name: me.name, typing: body.typing === true, at: new Date() } }, { upsert: true })
      return { ok: true }
    }
    if (action === 'suggest') return { text: await suggestReply(phone) }
    if (action === 'summary') return { text: await summarize(phone) }
    if (action === 'messages') await reply(me, phone, text(body.text, 'a reply'))
    else if (action === 'notes') {
      if (!(await conversations().findOne({ workspaceId: ws(), phone }))) throw new HttpError(404, 'No chat with this number yet.')
      await addMessage({ phone, direction: 'out', author: 'agent', authorId: me._id, authorName: me.name, kind: 'note', body: text(body.text, 'a note'), at: new Date() })
    } else if (action === 'assign') {
      const userId = body.userId === null ? null : String(body.userId ?? '')
      if (userId && !(await col('memberships').findOne({ workspaceId: ws(), userId }))) throw new HttpError(400, 'That person isn’t in this workspace.')
      await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { assigneeId: userId } })
    } else if (action === 'control') {
      if (body.action !== 'take' && body.action !== 'release') throw new HttpError(400, 'Action must be take or release.')
      await setControl(me, phone, body.action)
    } else if (action === 'read') await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { unread: 0 } })
    else throw new HttpError(404, 'Not found.')
    return getConversation(phone, me)
  }
  if (path === '/api/inbox/canned' && m === 'GET')
    return (await canned().find({ workspaceId: ws(), $or: [{ shared: true }, { createdBy: me._id }] }).sort({ shortcut: 1 }).toArray()).map(cannedOut)
  if (path === '/api/inbox/canned' && m === 'POST') return saveCanned(me, obj(await readJson(req)))
  if ((seg = path.match(/^\/api\/inbox\/canned\/([a-f0-9]{24})$/))) {
    if (m === 'PUT') return saveCanned(me, obj(await readJson(req)), seg[1])
    if (m === 'DELETE') {
      const r = await canned().deleteOne({ _id: new ObjectId(seg[1]), workspaceId: ws(), $or: [{ shared: true }, { createdBy: me._id }] })
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
              value: { metadata: { phone_number_id: ids.PHONE_NUMBER_ID }, ...(field === 'standby' ? { standby: event } : event) },
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
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'The inbox needs the database.' } }, () => route(req, u, me))
}
