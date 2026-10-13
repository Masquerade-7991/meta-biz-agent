// Characterisation of the background machinery, in-process against the throwaway database: the job
// queue (claim, lease, backoff, dead, keys, release on shutdown), the shared locks and rate guard,
// webhook reprocessing and broadcast resumption. Pins the behaviour the role split depends on.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, serverModules, startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let m: Awaited<ReturnType<typeof serverModules>>
const runs: string[] = []
before(async () => {
  s = await startStack('jobs')
  w = await s.seed.workspace()
  m = await serverModules(s)
  m.jobs.defineJob('e2e.ok', async (p) => void runs.push(`ok:${p.n}`))
  m.jobs.defineJob('e2e.again', async (p) => {
    runs.push(`again:${p.n}`)
    return runs.filter((r) => r === `again:${p.n}`).length < 2 ? { again: new Date() } : undefined
  })
  m.jobs.defineJob(
    'e2e.fail',
    async () => {
      throw new Error('boom')
    },
    { maxAttempts: 2, onDead: async (p) => void runs.push(`dead:${p.n}`) },
  )
})
after(() => s?.stop())
const jobs = () => s.db.collection('jobs')

test('a queued job runs in its workspace and is marked done', async () => {
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.ok', { n: 1 }))
  assert.equal(await m.tick(), 1)
  assert.deepEqual(runs, ['ok:1'])
  const j = await jobs().findOne({ type: 'e2e.ok' })
  assert.equal(j?.status, 'done')
  assert.equal(j?.workspaceId, w.id)
})

test('`again` re-queues the same job, and one pass of the runner carries it through', async () => {
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.again', { n: 2 }))
  assert.equal(await m.tick(), 2, 'the re-queued job was claimed again in the same pass')
  assert.equal((await jobs().findOne({ type: 'e2e.again' }))?.status, 'done')
  assert.equal(runs.filter((r) => r.startsWith('again')).length, 2)
})

test('a failing job backs off, then is parked as dead and its onDead runs once', async () => {
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.fail', { n: 3 }))
  await m.tick()
  let j = await jobs().findOne({ type: 'e2e.fail' })
  assert.equal(j?.status, 'queued')
  assert.equal(j?.attempts, 1)
  assert.ok(+j!.runAt >= Date.now() + 29_000, 'backoff of at least 30 s')
  assert.equal(m.jobs.backoffMs(1), 30_000)
  assert.equal(m.jobs.backoffMs(10), 3_600_000)
  await jobs().updateOne({ _id: j!._id }, { $set: { runAt: new Date(0) } })
  await m.tick()
  j = await jobs().findOne({ type: 'e2e.fail' })
  assert.equal(j?.status, 'dead')
  assert.match(String(j?.lastError), /boom/)
  assert.deepEqual(runs.filter((r) => r.startsWith('dead')), ['dead:3'])
})

test('a job whose lease expired (a crashed worker) is picked up again', async () => {
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.ok', { n: 4 }))
  await jobs().updateOne({ type: 'e2e.ok', 'payload.n': 4 }, { $set: { status: 'running', lockedUntil: new Date(Date.now() - 1000) } })
  await m.tick()
  assert.equal((await jobs().findOne({ type: 'e2e.ok', 'payload.n': 4 }))?.status, 'done')
})

test('two enqueues under one key keep one row, at the earlier time', async () => {
  const later = new Date(Date.now() + 3_600_000)
  const sooner = new Date(Date.now() + 60_000)
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.ok', { n: 5 }, { key: 'k5', runAt: later }))
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.ok', { n: 5 }, { key: 'k5', runAt: sooner }))
  const rows = await jobs().find({ key: 'k5' }).toArray()
  assert.equal(rows.length, 1)
  assert.equal(+rows[0].runAt, +sooner)
})

test('shutting down releases this instance’s running jobs straight back to the queue', async () => {
  const ctx = await import('../../server/context.ts')
  await m.inWorkspace(w.id, () => m.jobs.enqueue('e2e.ok', { n: 6 }))
  await jobs().updateOne({ type: 'e2e.ok', 'payload.n': 6 }, { $set: { status: 'running', lockedUntil: new Date(Date.now() + 300_000), instance: ctx.INSTANCE, attempts: 1 } })
  await jobs().insertOne({ type: 'e2e.ok', payload: { n: 7 }, workspaceId: w.id, status: 'running', lockedUntil: new Date(Date.now() + 300_000), instance: 'other', attempts: 1, runAt: new Date(), createdAt: new Date(), updatedAt: new Date() })
  await m.jobs.releaseLeases()
  const mine = await jobs().findOne({ 'payload.n': 6 })
  assert.equal(mine?.status, 'queued')
  assert.equal(mine?.attempts, 0)
  assert.equal(mine?.lockedUntil, undefined)
  assert.equal((await jobs().findOne({ 'payload.n': 7 }))?.status, 'running', 'another instance’s job is left alone')
})

test('shared locks: one winner, held until it expires or is released', async () => {
  assert.equal(await m.locks.tryLock('e2e:a', 60_000), true)
  assert.equal(await m.locks.tryLock('e2e:a', 60_000), false)
  assert.equal(await m.locks.isLocked('e2e:a'), true)
  await m.locks.unlock('e2e:a')
  assert.equal(await m.locks.isLocked('e2e:a'), false)
  assert.equal(await m.locks.tryLock('e2e:b', 1), true)
  await new Promise((done) => setTimeout(done, 5))
  assert.equal(await m.locks.tryLock('e2e:b', 60_000), true, 'an expired lock can be taken')
})

test('the rate guard counts across the database, not per process', async () => {
  const cache = await import('../../server/cache.ts')
  assert.equal(await cache.allow('e2e|rate', 2), true)
  assert.equal(await cache.allow('e2e|rate', 2), true)
  assert.equal(await cache.allow('e2e|rate', 2), false)
  assert.equal(await s.db.collection('rate_hits').countDocuments({ key: 'e2e|rate' }), 2)
})

test('the relay cache is shared: a put on one process is a hit on the next', async () => {
  const cache = await import('../../server/cache.ts')
  const reply = { status: 200, text: '{"a":1}', contentType: 'application/json' }
  await cache.putCached('meta /770/agent_config/settings', reply, 60_000)
  assert.equal((await s.db.collection('relay_cache').findOne({ _id: 'meta /770/agent_config/settings' as never }))?.reply.text, '{"a":1}')
  await cache.invalidatePhone('770')
  assert.equal(await s.db.collection('relay_cache').countDocuments(), 0)
  assert.equal(await cache.getCached('meta /770/agent_config/settings'), undefined, 'the local layer is dropped too')
})

test('a webhook stored but never processed is picked up by the retry sweep', async () => {
  const payload = inbound(w.numbers[0], '919870000001', 'late delivery')
  await s.db.collection('webhook_inbox').insertOne({ _id: 'late1' as never, receivedAt: new Date(Date.now() - 120_000), app: 'e2e', payload, processedAt: null, attempts: 0 })
  await m.tick()
  assert.ok((await s.db.collection('webhook_inbox').findOne({ _id: 'late1' as never }))?.processedAt)
  assert.equal(await s.db.collection('messages').countDocuments({ phone: '919870000001' }), 1)
})

test('a scheduled broadcast without a job (lost at a restart) gets its job back', async () => {
  const r = await s.db.collection('broadcasts').insertOne({ workspaceId: w.id, name: 'orphan', status: 'scheduled', scheduledAt: new Date(Date.now() + 3_600_000), createdAt: new Date() })
  await m.tick()
  const j = await jobs().findOne({ type: 'broadcast.send', 'payload.broadcastId': String(r.insertedId) })
  assert.equal(j?.status, 'queued')
  await m.tick()
  assert.equal(await jobs().countDocuments({ type: 'broadcast.send', 'payload.broadcastId': String(r.insertedId) }), 1, 'resuming again adds nothing')
})
