// Journey: templates from WhatsApp, a broadcast to a segment (never to people who opted out, never
// to Meta for sample contacts), the send worker, delivery ticks and replies, scheduling and cancel.
// Runs the server's job worker (JOBS on): every send goes to the fake Meta.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, statusEvent, TEMPLATE, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let segmentId: string
before(async () => {
  s = await startStack('broadcasts', { jobs: true })
  w = await s.seed.workspace()
  const c = (phone: string, o: Record<string, unknown> = {}) => ({ workspaceId: w.id, phone, tags: ['diwali'], fields: {}, createdAt: new Date(), source: 'manual', ...o })
  await s.db.collection('contacts').insertMany([
    c('919860000001', { name: 'Asha Rao' }),
    c('919860000002'), // no name
    c('919860000003', { name: 'Opted Out', optedOut: true }),
    c('919860000004', { name: 'Sample Sam', sample: true }),
  ])
  segmentId = (await s.api(w.owner, 'POST', '/api/contacts/segments', { name: 'Diwali', filter: { tags: ['diwali'] } })).json.id
})
after(() => s?.stop())

const body = (o: Record<string, unknown> = {}) => ({ name: 'Diwali 🪔 offer', template: { name: TEMPLATE.name, language: 'en' }, mapping: { 'body:1': { source: 'name', text: 'there' } }, segmentId, ...o })
const waitFor = (id: string, status: string) => s.until(async () => (await s.api(w.owner, 'GET', `/api/broadcasts/${id}`)).json.status === status, 30_000)

test('templates come from the WhatsApp account', async () => {
  const r = await s.api(w.agent, 'GET', '/api/broadcasts/templates')
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json[0].name, 'order_update')
})

test('preflight counts who it reaches: opted-out people never, sample contacts separately', async () => {
  const r = await s.api(w.supervisor, 'POST', '/api/broadcasts/preflight', { segmentId, category: 'UTILITY' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.audience, 3)
  assert.equal(r.json.sample, 1)
})

test('a malformed segment id is a 400, not a server error', async () => {
  assert.equal((await s.api(w.supervisor, 'POST', '/api/broadcasts/preflight', { segmentId: 'abc' })).status, 400)
})

test('agents can’t send broadcasts; missing templates and empty slots are explained', async () => {
  assert.equal((await s.api(w.agent, 'POST', '/api/broadcasts', body())).status, 403)
  assert.equal((await s.api(w.owner, 'POST', '/api/broadcasts', body({ template: { name: 'nope', language: 'en' } }))).status, 404)
  assert.equal((await s.api(w.owner, 'POST', '/api/broadcasts', body({ mapping: { 'body:1': { source: 'text', text: '  ' } } }))).status, 400)
  assert.equal((await s.api(w.owner, 'POST', '/api/broadcasts', body({ scheduledAt: '2020-01-01T00:00:00Z' }))).status, 400)
})

let sent: { id: string }
test('sending: real contacts get the template, sample contacts are only recorded', async () => {
  const before = s.fake.find('POST', /\/messages$/).length
  const r = await s.api(w.supervisor, 'POST', '/api/broadcasts', body())
  assert.equal(r.status, 200, r.text)
  sent = r.json
  await waitFor(sent.id, 'completed')
  const calls = s.fake.find('POST', /\/messages$/).slice(before)
  assert.deepEqual(calls.map((c) => c.body?.to).sort(), ['919860000001', '919860000002'])
  const byTo = Object.fromEntries(calls.map((c) => [c.body?.to, c.body?.template as { components: { parameters: { text: string }[] }[] }]))
  assert.equal(byTo['919860000001'].components[0].parameters[0].text, 'Asha', 'first name from the contact')
  assert.equal(byTo['919860000002'].components[0].parameters[0].text, 'there', 'fallback when there is no name')
  const one = (await s.api(w.owner, 'GET', `/api/broadcasts/${sent.id}`)).json
  assert.equal(one.stats.sent, 3)
  assert.ok(one.recipients.every((x: { phone: string }) => x.phone !== '919860000003'), 'the opted-out contact was never queued')
})

test('delivery ticks and a reply within 3 days count towards the broadcast', async () => {
  const rec = await s.db.collection('broadcast_recipients').findOne({ phone: '919860000001', waMessageId: { $exists: true } })
  await s.webhook(statusEvent(w.numbers[0], rec!.waMessageId, 'delivered', '919860000001'))
  await s.webhook(statusEvent(w.numbers[0], rec!.waMessageId, 'read', '919860000001'))
  await s.webhook(inbound(w.numbers[0], '919860000001', 'Interested! 🎉'))
  const one = (await s.api(w.owner, 'GET', `/api/broadcasts/${sent.id}`)).json
  assert.equal(one.stats.read, 1)
  assert.equal(one.stats.replied, 1)
})

test('a failure WhatsApp reports later is recorded with its reason', async () => {
  const rec = await s.db.collection('broadcast_recipients').findOne({ phone: '919860000002', waMessageId: { $exists: true } })
  await s.webhook(statusEvent(w.numbers[0], rec!.waMessageId, 'failed', '919860000002', { errors: [{ code: 131026, title: 'Message undeliverable' }] }))
  const after = await s.db.collection('broadcast_recipients').findOne({ _id: rec!._id })
  assert.ok(['failed', 'queued'].includes(String(after!.status)))
  assert.ok(after!.reason)
})

test('a scheduled broadcast can be cancelled once; nobody is sent anything', async () => {
  const before = s.fake.find('POST', /\/messages$/).length
  const r = await s.api(w.owner, 'POST', '/api/broadcasts', body({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }))
  assert.equal(r.json.status, 'scheduled')
  const c = await s.api(w.owner, 'POST', `/api/broadcasts/${r.json.id}/cancel`)
  assert.equal(c.json.status, 'cancelled')
  assert.equal(c.json.stats.skipped, 3)
  assert.equal((await s.api(w.owner, 'POST', `/api/broadcasts/${r.json.id}/cancel`)).status, 400)
  assert.equal(s.fake.find('POST', /\/messages$/).length, before)
})

test('pressing Send twice quickly creates one broadcast', async () => {
  const before = (await s.api(w.owner, 'GET', '/api/broadcasts')).json.length
  const at = new Date(Date.now() + 3_600_000).toISOString()
  const [a, b] = await Promise.all([s.api(w.owner, 'POST', '/api/broadcasts', body({ scheduledAt: at })), s.api(w.owner, 'POST', '/api/broadcasts', body({ scheduledAt: at }))])
  for (const r of [a, b]) if (r.json?.id) await s.api(w.owner, 'POST', `/api/broadcasts/${r.json.id}/cancel`)
  assert.equal((await s.api(w.owner, 'GET', '/api/broadcasts')).json.length, before + 1)
})
