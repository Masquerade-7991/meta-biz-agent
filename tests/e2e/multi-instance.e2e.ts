// Two instances of the server on one database and one fake Meta (A takes requests, B runs the
// jobs): what must hold when the API runs as more than one process. Deliveries dedupe across
// instances, the relay cache is shared, work queued on one is done by the other (a reminder), and live events
// cross instances.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, type Stack } from './harness.ts'

let a: Stack
let b: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  a = await startStack('multi', { port: 8797 })
  b = await startStack('multi', { port: 8798, shareWith: a, jobs: true })
  w = await a.seed.workspace()
})
after(async () => {
  await b?.stop()
  await a?.stop()
})

test('the same delivery to both instances is stored and applied once', async () => {
  const p = inbound(w.numbers[0], '919880000001', 'hello twice', { id: 'wamid.MULTI1' })
  assert.equal((await a.webhook(p)).status, 200)
  assert.equal((await b.webhook(p)).status, 200)
  assert.equal(await a.db.collection('messages').countDocuments({ waMessageId: 'wamid.MULTI1' }), 1)
  assert.equal(await a.db.collection('webhook_inbox').countDocuments({ 'payload.entry.changes.value.messages.id': 'wamid.MULTI1' }), 1)
})

test('a relayed read cached by one instance is served by the other without asking Meta again', async () => {
  const path = '/api/meta/PHONE_NUMBER_ID/agent_config/settings'
  const before = a.fake.find('GET', /\/agent_config\/settings$/).length
  assert.equal((await a.api(w.owner, 'GET', path)).status, 200)
  assert.equal((await b.api(w.owner, 'GET', path)).status, 200)
  assert.equal(a.fake.find('GET', /\/agent_config\/settings$/).length - before, 1)
})

test('a reminder queued on the instance without a worker is fired by the one with it', async () => {
  const r = await a.api(w.owner, 'POST', '/api/inbox/conversations/919880000001/remind', { note: 'Cross', at: new Date(Date.now() + 60_000).toISOString() })
  assert.equal(r.status, 200, r.text)
  // Due now rather than in a minute, so the test needn't wait.
  await a.db.collection('jobs').updateOne({ type: 'reminder.fire', status: 'queued' }, { $set: { runAt: new Date() } })
  await a.until(async () => !!(await a.db.collection('reminders').findOne({ workspaceId: w.id, note: 'Cross', firedAt: { $ne: null } })), 30_000)
})

test('a live event raised on one instance reaches a stream open on the other', async () => {
  const ctl = new AbortController()
  const stream = await fetch(`${a.base}/api/stream`, { headers: { cookie: `sid=${w.owner.token}` }, signal: ctl.signal })
  assert.equal(stream.status, 200)
  const reader = stream.body!.getReader()
  let got = ''
  const seen = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      got += new TextDecoder().decode(value)
      if (/data: \{"kind":"/.test(got)) return
    }
  })()
  await new Promise((done) => setTimeout(done, 500))
  assert.equal((await b.webhook(inbound(w.numbers[0], '919880000002', 'event on B', { id: 'wamid.MULTI2' }))).status, 200)
  await Promise.race([seen, new Promise((_, no) => setTimeout(() => no(new Error(`no event from the other instance; got: ${got.slice(0, 200)}\nserver A said:\n${a.log().split('\n').filter((l) => /live events|change stream|events write/.test(l)).join('\n')}`)), 15_000))])
  ctl.abort()
})
