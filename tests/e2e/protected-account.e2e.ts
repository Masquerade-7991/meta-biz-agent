// Journey: the business's own WhatsApp account (.env) is listen-only and can't be rewired: no
// webhook, registration or PIN changes through any route, no automatic messages to its customers,
// and the raw relay only reaches the workspace's own ids.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, type Stack } from './harness.ts'

const WABA = '880000000000001'
const PHONE = '880000000000101'
let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('protected', { env: { WABA_ID: WABA, PHONE_NUMBER_ID: PHONE, BUSINESS_ID: '880000000000999' } })
  w = await s.seed.workspace({ account: { wabaId: WABA, numbers: [PHONE], source: 'env' } })
})
after(() => s?.stop())

const metaCallsSince = (n: number) => s.fake.calls.slice(n).filter((c) => c.method !== 'GET')

test('rewiring webhooks, registration and the PIN is refused before it reaches Meta', async () => {
  const n = s.fake.calls.length
  const tries: [string, string, unknown][] = [
    ['POST', '/api/graph/WABA_ID/subscribed_apps', { override_callback_uri: 'https://x.example/hook', verify_token: 't' }],
    ['DELETE', '/api/graph/WABA_ID/subscribed_apps', undefined],
    ['POST', '/api/graph/PHONE_NUMBER_ID/register', { messaging_product: 'whatsapp', pin: '123456' }],
    ['POST', '/api/graph/PHONE_NUMBER_ID/deregister', {}],
    ['POST', '/api/graph/PHONE_NUMBER_ID', { pin: '654321' }],
    ['POST', '/api/graph/PHONE_NUMBER_ID', { webhook_configuration: { override_callback_uri: 'https://x.example' } }],
  ]
  for (const [m, p, b] of tries) {
    const r = await s.api(w.owner, m, p, b)
    assert.equal(r.status, 403, `${m} ${p}: ${r.text}`)
  }
  assert.deepEqual(metaCallsSince(n), [])
})

test('number settings routes refuse the protected number too', async () => {
  const n = s.fake.calls.length
  for (const p of [`/api/whatsapp/numbers/${PHONE}/register`, `/api/whatsapp/numbers/${PHONE}/deregister`, `/api/whatsapp/numbers/${PHONE}/request-code`]) {
    const r = await s.api(w.owner, 'POST', p, { pin: '123456', method: 'SMS' })
    assert.ok(r.status >= 400 && r.status < 500, `${p}: ${r.status} ${r.text}`)
  }
  assert.deepEqual(metaCallsSince(n), [])
})

test('reading and configuring the AI agent still work', async () => {
  assert.equal((await s.api(w.owner, 'GET', '/api/graph/WABA_ID/subscribed_apps')).status, 200)
  assert.equal((await s.api(w.owner, 'PUT', '/api/meta/PHONE_NUMBER_ID/agent_config/business_info', { business_description: 'हम चाय बेचते हैं ☕' })).status, 200)
})

test('another workspace’s ids are refused by the relay', async () => {
  assert.equal((await s.api(w.owner, 'GET', '/api/graph/770000000000001/phone_numbers')).status, 403)
})

test('listen-only: no away message and no rating question to the business’s customers', async () => {
  const closed = { timezone: 'UTC', week: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, null])), holidays: [] }
  await s.db.collection('support_settings').insertOne({ workspaceId: w.id, settings: { hours: closed } })
  const n = s.fake.calls.length
  await s.webhook(inbound(PHONE, '919870000001', 'hello?'))
  await s.webhook(inbound(PHONE, '919870000001', 'anyone?'))
  assert.deepEqual(metaCallsSince(n).filter((c) => /\/messages$/.test(c.path)), [], 'no away message')
  // People can still reply by choice, and resolving asks nothing of the customer.
  assert.equal((await s.api(w.owner, 'POST', '/api/inbox/conversations/919870000001/messages', { text: 'Hi, Olivia here' })).status, 200)
  const t = await s.db.collection('tickets').findOne({ phone: '919870000001' })
  const m = s.fake.calls.length
  assert.equal((await s.api(w.owner, 'POST', `/api/tickets/${t!.number}/resolve`, { handBack: false })).status, 200)
  assert.deepEqual(metaCallsSince(m).filter((c) => /\/messages$/.test(c.path)), [], 'no rating question')
})

test('a Graph batch call can’t smuggle a protected write past the checks', { todo: 'QA-03: POST /api/graph/ with a batch body names no id in its path' }, async () => {
  const n = s.fake.calls.length
  const r = await s.api(w.owner, 'POST', '/api/graph/', { batch: [{ method: 'POST', relative_url: `${WABA}/subscribed_apps` }] })
  assert.equal(r.status, 403, r.text)
  assert.deepEqual(metaCallsSince(n), [])
})

test('the relay can’t read another business through ?ids=', { todo: 'QA-04: pathIds checks only the path, so GET /api/graph/?ids=<any id> uses the server token' }, async () => {
  const n = s.fake.calls.length
  const r = await s.api(w.agent, 'GET', '/api/graph/?ids=770000000000001&fields=name,phone_numbers')
  assert.equal(r.status, 403, r.text)
  assert.equal(s.fake.calls.length, n)
})
