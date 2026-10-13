// What happens when things go wrong: Meta failing (the circuit opens, requests fail fast, then
// recover), a request sent twice (idempotency keys), a job that gave up (seen and retried), and
// the health answer that tells an operator why something is slow.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { serverModules, startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('resilience', { env: { BREAKER_OPEN_MS: '1500', RELAY_CACHE: 'off' } })
  w = await s.seed.workspace()
})
after(() => s?.stop())

test('five failures from Meta open the circuit: the next call fails at once, and it recovers', async () => {
  const off = s.fake.on('GET', /\/agent_config\/settings$/, () => ({ status: 500, json: { error: { message: 'Meta is having a moment' } } }))
  const path = '/api/meta/PHONE_NUMBER_ID/agent_config/settings'
  for (let i = 0; i < 5; i++) assert.equal((await s.api(w.owner, 'GET', path)).status, 500)
  const calls = s.fake.find('GET', /\/agent_config\/settings$/).length
  const fast = await s.api(w.owner, 'GET', path)
  assert.equal(fast.status, 502)
  assert.match(fast.json.detail, /paused for a moment/)
  assert.equal(s.fake.find('GET', /\/agent_config\/settings$/).length, calls, 'nothing reached Meta while open')
  assert.equal((await s.api(null, 'GET', '/api/health')).json.breaker.meta, 'open')
  assert.equal((await s.api(w.owner, 'GET', '/api/tickets')).status, 200, 'routes that don’t need Meta are untouched')
  off()
  await new Promise((done) => setTimeout(done, 1700))
  assert.equal((await s.api(w.owner, 'GET', path)).status, 200, 'after the pause, a working Meta closes it again')
  assert.equal((await s.api(null, 'GET', '/api/health')).json.breaker.meta, 'closed')
})

test('the same request twice with one Idempotency-Key does the work once', async () => {
  const h = { 'idempotency-key': 'seg-2026-10-13-a' }
  const first = await s.api(w.owner, 'POST', '/api/contacts/segments', { name: 'Twice', filter: { tags: ['x'] } }, h)
  assert.equal(first.status, 200, first.text)
  const again = await s.api(w.owner, 'POST', '/api/contacts/segments', { name: 'Twice', filter: { tags: ['x'] } }, h)
  assert.equal(again.status, 200)
  assert.equal(again.headers.get('idempotent-replayed'), 'true')
  assert.deepEqual(again.json, first.json)
  assert.equal(await s.db.collection('segments').countDocuments({ name: 'Twice' }), 1)
  // A different person, or a different key, is a new request.
  const other = await s.api(w.admin, 'POST', '/api/contacts/segments', { name: 'Twice', filter: { tags: ['x'] } }, h)
  assert.equal(other.headers.get('idempotent-replayed'), null)
  assert.equal(await s.db.collection('segments').countDocuments({ name: 'Twice' }), 2)
})

test('a job that gave up is listed with its error and can be retried by an admin, not an agent', async () => {
  const dead = await s.db.collection('jobs').insertOne({ workspaceId: w.id, type: 'webhook.process', payload: { id: 'gone' }, status: 'dead', attempts: 5, lastError: 'boom', runAt: new Date(), createdAt: new Date(), updatedAt: new Date() })
  const id = String(dead.insertedId)
  const list = await s.api(w.admin, 'GET', '/api/jobs')
  assert.equal(list.status, 200, list.text)
  assert.ok(list.json.some((j: { id: string; lastError: string }) => j.id === id && j.lastError === 'boom'))
  assert.equal((await s.api(w.agent, 'GET', '/api/jobs')).status, 403)
  assert.equal((await s.api(w.agent, 'POST', `/api/jobs/${id}/retry`)).status, 403)
  assert.equal((await s.api(w.admin, 'POST', `/api/jobs/${'0'.repeat(24)}/retry`)).status, 404)
  const r = await s.api(w.admin, 'POST', `/api/jobs/${id}/retry`)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.status, 'queued')
  assert.equal((await s.api(w.admin, 'POST', `/api/jobs/${id}/retry`)).status, 404, 'only dead jobs retry')
  const m = await serverModules(s)
  await m.tick()
  assert.equal((await s.db.collection('jobs').findOne({ _id: dead.insertedId }))?.status, 'done')
  const ops = await s.api(w.admin, 'GET', '/api/activity?area=operations')
  assert.ok(ops.json.events.some((e: { kind: string }) => e.kind === 'job.retried'))
})

test('the health answer carries what an operator needs', async () => {
  const h = (await s.api(null, 'GET', '/api/health')).json
  assert.equal(h.role, 'all')
  assert.deepEqual(Object.keys(h.jobs).sort(), ['dead', 'queued', 'running'])
  assert.deepEqual(Object.keys(h.webhooks).sort(), ['oldestAgeS', 'pending'])
  assert.deepEqual(h.breaker, { meta: 'closed', graph: 'closed' })
})
