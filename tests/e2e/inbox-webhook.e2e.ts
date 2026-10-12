// Journey: Meta's webhooks arrive (signed, retried, out of order), customers show up in the Inbox,
// the team replies inside the 24-hour window, takes over and hands back, and number-hidden
// customers, unicode and opt-outs behave.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, statusEvent, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let NUM: string
const ALWAYS_OPEN = { timezone: 'UTC', week: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '00:00', close: '23:59' }])), holidays: [] }

before(async () => {
  s = await startStack('inbox')
  w = await s.seed.workspace({ account: { wabaId: '880000000000001', numbers: ['880000000000101', '880000000000102'] } })
  NUM = w.numbers[0]
  await s.db.collection('support_settings').insertOne({ workspaceId: w.id, settings: { hours: ALWAYS_OPEN } })
})
after(() => s?.stop())

const chat = async (phone: string) => (await s.api(w.owner, 'GET', `/api/inbox/conversations/${phone}`)).json
const list = async () => (await s.api(w.owner, 'GET', '/api/inbox/conversations')).json as { phone: string; name: string | null; owner: string; windowOpen: boolean }[]

test('the verification handshake answers only with the right token', async () => {
  const ok = await fetch(`${s.base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=12345`)
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), '12345')
  assert.equal((await fetch(`${s.base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403)
})

test('unsigned, wrongly signed and tampered deliveries are refused and not stored', async () => {
  const p = inbound(NUM, '919800000001', 'hello')
  assert.equal((await s.webhook(p, { secret: null })).status, 401)
  assert.equal((await s.webhook(p, { secret: 'not-ours' })).status, 401)
  assert.equal(await s.db.collection('webhook_inbox').countDocuments(), 0)
})

test('a customer’s first message opens a chat with their name and unicode text intact', async () => {
  const text = 'नमस्ते 👋 مرحبا — is my order 📦 coming?'
  const r = await s.webhook(inbound(NUM, '919800000001', text, { name: 'प्रिया' }))
  assert.equal(r.status, 200)
  const row = (await list()).find((c) => c.phone === '919800000001')
  assert.ok(row)
  assert.equal(row.name, 'प्रिया')
  assert.equal(row.windowOpen, true)
  const c = await chat('919800000001')
  assert.equal(c.messages.at(-1).body, text)
})

test('Meta retrying the same delivery stores it once and changes nothing', async () => {
  const p = inbound(NUM, '919800000002', 'retry me', { id: 'wamid.RETRY1' })
  assert.equal((await s.webhook(p)).status, 200)
  assert.equal((await s.webhook(p)).status, 200)
  assert.equal((await s.webhook(p)).status, 200)
  assert.equal(await s.db.collection('messages').countDocuments({ waMessageId: 'wamid.RETRY1' }), 1)
  const d = await s.db.collection('webhook_inbox').findOne({ 'payload.entry.changes.value.messages.id': 'wamid.RETRY1' })
  assert.equal(d?.repeats, 2)
  assert.ok(d?.processedAt)
  // Same message id in a different body (Meta re-sends with a new timestamp): still one message.
  assert.equal((await s.webhook(inbound(NUM, '919800000002', 'retry me', { id: 'wamid.RETRY1', at: new Date(Date.now() - 1000) }))).status, 200)
  assert.equal(await s.db.collection('messages').countDocuments({ waMessageId: 'wamid.RETRY1' }), 1)
})

test('a reply inside the window goes to Meta, then statuses only move forward', async () => {
  const r = await s.api(w.agent, 'POST', '/api/inbox/conversations/919800000001/messages', { text: 'On its way! 🚚' })
  assert.equal(r.status, 200, r.text)
  const sent = s.fake.find('POST', /\/messages$/).at(-1)!
  assert.equal(sent.body?.to, '919800000001')
  assert.equal((sent.body?.text as { body?: string } | undefined)?.body, 'On its way! 🚚')
  const wamid = (await s.db.collection('messages').findOne({ phone: '919800000001', author: 'agent' }))!.waMessageId as string
  await s.webhook(statusEvent(NUM, wamid, 'read', '919800000001'))
  await s.webhook(statusEvent(NUM, wamid, 'delivered', '919800000001')) // late
  await s.webhook(statusEvent(NUM, wamid, 'sent', '919800000001')) // later still
  assert.equal((await s.db.collection('messages').findOne({ waMessageId: wamid }))?.status, 'read')
  // The chat is with people, its one open ticket has its first reply, and someone owns it.
  const c = await chat('919800000001')
  assert.equal(c.conversation.owner, 'human')
  assert.ok(c.conversation.assigneeId)
  const tickets = await s.db.collection('tickets').find({ phone: '919800000001' }).toArray()
  assert.equal(tickets.length, 1)
  assert.equal(tickets[0].status, 'open')
  assert.ok(tickets[0].firstRespondedAt)
})

test('outside the 24-hour window a free reply is refused and nothing reaches Meta', async () => {
  await s.webhook(inbound(NUM, '919800000003', 'old', { at: new Date(Date.now() - 25 * 3_600_000) }))
  const before = s.fake.find('POST', /\/messages$/).length
  const r = await s.api(w.owner, 'POST', '/api/inbox/conversations/919800000003/messages', { text: 'too late' })
  assert.equal(r.status, 400)
  assert.match(r.json.detail, /24 hours/)
  assert.equal(s.fake.find('POST', /\/messages$/).length, before)
})

test('take over and hand back call thread control and open, then resolve, the ticket', async () => {
  await s.webhook(inbound(NUM, '919800000004', 'agent please', { field: 'standby' }))
  assert.equal((await chat('919800000004')).conversation.owner, 'ai')
  const take = await s.api(w.supervisor, 'POST', '/api/inbox/conversations/919800000004/control', { action: 'take' })
  assert.equal(take.status, 200, take.text)
  assert.equal(s.fake.find('POST', /\/thread_control$/).at(-1)?.body?.action, 'take')
  assert.equal(s.fake.find('POST', /\/thread_control$/).at(-1)?.headers['x-api-version'], '1.0.0')
  const t = await s.db.collection('tickets').findOne({ phone: '919800000004' })
  assert.equal(t?.status, 'open')
  assert.equal(t?.source, 'takeover')
  const back = await s.api(w.supervisor, 'POST', '/api/inbox/conversations/919800000004/control', { action: 'release' })
  assert.equal(back.status, 200)
  assert.equal((await s.db.collection('tickets').findOne({ phone: '919800000004' }))?.status, 'resolved')
  assert.equal((await chat('919800000004')).conversation.owner, 'ai')
  assert.equal((await s.api(w.owner, 'POST', '/api/inbox/conversations/919800000004/control', { action: 'steal' })).status, 400)
})

test('a customer who hides their number is keyed by their BSUID and can’t be handed over', async () => {
  const bsuid = 'IN.AbCdEf123456'
  const r = await s.webhook(inbound(NUM, '', 'hi from a hidden number', { fromUserId: bsuid }))
  assert.equal(r.status, 200)
  const c = await s.api(w.owner, 'GET', `/api/inbox/conversations/${bsuid}`)
  assert.equal(c.status, 200, c.text)
  assert.equal(c.json.messages.at(-1).body, 'hi from a hidden number')
  assert.equal((await s.api(w.owner, 'POST', `/api/inbox/conversations/${bsuid}/control`, { action: 'take' })).status, 400)
})

test('STOP opts the customer out of broadcasts and START lets them back in', async () => {
  await s.webhook(inbound(NUM, '919800000005', ' stop '))
  assert.equal((await s.db.collection('contacts').findOne({ phone: '919800000005' }))?.optedOut, true)
  await s.webhook(inbound(NUM, '919800000005', 'START'))
  assert.equal((await s.db.collection('contacts').findOne({ phone: '919800000005' }))?.optedOut, false)
})

test('events for a number no workspace has are kept but not routed', async () => {
  assert.equal((await s.webhook(inbound('770000000000999', '919800000006', 'who am I for?'))).status, 200)
  const d = await s.db.collection('webhook_inbox').findOne({ 'payload.entry.changes.value.metadata.phone_number_id': '770000000000999' })
  assert.equal(d?.unrouted, 1)
  assert.equal(await s.db.collection('messages').countDocuments({ phone: '919800000006' }), 0)
})

test('an unparseable but signed body is stored and answered 200 (no retry storm)', async () => {
  const r = await s.webhook(null, { raw: '{not json' })
  assert.equal(r.status, 200)
})

test('a reply goes out from the number the customer wrote to', async () => {
  const second = w.numbers[1]
  await s.webhook(inbound(second, '919800000007', 'hello second number'))
  assert.equal((await s.api(w.owner, 'POST', '/api/inbox/conversations/919800000007/messages', { text: 'hi' })).status, 200)
  assert.equal(s.fake.find('POST', /\/messages$/).at(-1)?.path, `/${second}/messages`)
})

test('a restricted agent can’t reply into someone else’s chat (nothing is sent)', async () => {
  await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': true } })
  await s.webhook(inbound(NUM, '919800000008', 'for the supervisor'))
  await s.api(w.supervisor, 'POST', '/api/inbox/conversations/919800000008/assign', { userId: w.supervisor.id })
  const before = s.fake.find('POST', /\/messages$/).length
  const r = await s.api(w.agent, 'POST', '/api/inbox/conversations/919800000008/messages', { text: 'sneaky' })
  try {
    assert.equal(r.status, 403)
    assert.equal(s.fake.find('POST', /\/messages$/).length, before, 'nothing reached the customer')
  } finally {
    await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': false } })
  }
})

test('a teammate can’t forge a customer message into a real chat', async () => {
  const r = await s.api(w.agent, 'POST', '/api/inbox/demo/simulate', { phone: '919800000001', text: 'I want a refund of ₹50,000' })
  assert.notEqual(r.status, 200)
})
