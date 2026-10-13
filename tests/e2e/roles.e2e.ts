// The server split by role on one database: the ingress only stores and acknowledges Meta's
// deliveries, a worker processes them from the queue, the api serves the routes, and every role
// answers only its own paths plus health and readiness.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, type Stack } from './harness.ts'

let ingress: Stack
let worker: Stack
let api: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  ingress = await startStack('roles', { port: 8797, env: { ROLE: 'ingress' } })
  api = await startStack('roles', { port: 8799, shareWith: ingress, env: { ROLE: 'api' } })
  w = await api.seed.workspace()
})
after(async () => {
  await worker?.stop()
  await api?.stop()
  await ingress?.stop()
})

test('the ingress acknowledges a delivery at once and queues its processing', async () => {
  const r = await ingress.webhook(inbound(w.numbers[0], '919890000001', 'via ingress', { id: 'wamid.ROLE1' }))
  assert.equal(r.status, 200)
  const stored = await ingress.db.collection('webhook_inbox').findOne({ 'payload.entry.changes.value.messages.id': 'wamid.ROLE1' })
  assert.ok(stored)
  assert.equal(stored.processedAt, null, 'not processed by the ingress')
  assert.equal(await ingress.db.collection('jobs').countDocuments({ type: 'webhook.process', status: 'queued' }), 1)
  assert.equal(await ingress.db.collection('messages').countDocuments({ waMessageId: 'wamid.ROLE1' }), 0)
})

test('each role answers only its own paths; health and readiness everywhere', async () => {
  assert.equal((await ingress.api(w.owner, 'GET', '/api/tickets')).status, 404)
  assert.equal((await ingress.api(null, 'GET', '/api/ready')).status, 200)
  assert.equal((await ingress.api(null, 'GET', '/api/health')).json.role, 'ingress')
  assert.equal((await api.api(w.owner, 'GET', '/api/tickets')).status, 200)
  assert.equal((await api.api(null, 'GET', '/api/health')).json.role, 'api')
  assert.equal((await api.api(w.owner, 'GET', '/api/stream')).status, 204, 'the api role alone has no live stream')
  // A delivery posted to the api role (the all-in-one path, or a misrouted proxy) still works.
  assert.equal((await api.webhook(inbound(w.numbers[0], '919890000002', 'via api', { id: 'wamid.ROLE2' }))).status, 200)
  assert.equal(await api.db.collection('messages').countDocuments({ waMessageId: 'wamid.ROLE2' }), 1)
})

test('a worker picks the queued delivery up and reports the queue in its health', async () => {
  worker = await startStack('roles', { port: 8798, shareWith: ingress, jobs: true, env: { ROLE: 'worker' } })
  assert.equal((await worker.api(w.owner, 'GET', '/api/tickets')).status, 404)
  const h = (await worker.api(null, 'GET', '/api/health')).json
  assert.equal(h.role, 'worker')
  assert.ok(h.jobs && typeof h.jobs.queued === 'number')
  await worker.until(async () => (await worker.db.collection('webhook_inbox').findOne({ 'payload.entry.changes.value.messages.id': 'wamid.ROLE1' }))?.processedAt, 20_000)
  assert.equal(await worker.db.collection('messages').countDocuments({ waMessageId: 'wamid.ROLE1' }), 1)
  assert.equal(await worker.db.collection('jobs').countDocuments({ type: 'webhook.process', status: 'done' }), 1)
})
