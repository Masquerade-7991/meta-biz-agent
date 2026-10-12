// Journey: a ticket's whole life. Opened by a customer, a handoff or by hand; waiting on the
// customer pauses its clocks; resolved with a rating question; the customer rates, writes again
// (reopen) or much later (a new ticket); people race to resolve; escalation levels fire in order.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { handover, inbound, serverModules, startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let NUM: string
const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const ALWAYS_OPEN = { timezone: 'UTC', week: Object.fromEntries(days.map((d) => [d, { open: '00:00', close: '23:59' }])), holidays: [] }
const NEVER_OPEN = { timezone: 'UTC', week: Object.fromEntries(days.map((d) => [d, null])), holidays: [] }
const H = 3_600_000

before(async () => {
  s = await startStack('tickets')
  w = await s.seed.workspace()
  NUM = w.numbers[0]
  await s.db.collection('support_settings').insertOne({ workspaceId: w.id, settings: { hours: ALWAYS_OPEN } })
})
after(() => s?.stop())

const ticketOf = (phone: string) => s.db.collection('tickets').findOne({ phone }, { sort: { createdAt: -1 } })
const write = (phone: string, text: string, field: 'messages' | 'standby' = 'messages') => s.webhook(inbound(NUM, phone, text, { field }))

test('a customer writing to a chat the team holds opens one ticket with deadlines', async () => {
  await write('919810000001', 'Where is my refund?')
  await write('919810000001', 'Hello??')
  const all = await s.db.collection('tickets').find({ phone: '919810000001' }).toArray()
  assert.equal(all.length, 1, 'a second message does not open a second ticket')
  const t = all[0]
  assert.equal(t.status, 'open')
  assert.equal(t.source, 'customer')
  assert.equal(t.subject, 'Where is my refund?')
  assert.ok(+t.firstResponseDueAt > +t.createdAt && +t.resolveDueAt >= +t.firstResponseDueAt)
  assert.equal(t.phoneNumberId, NUM)
})

test('waiting on the customer pauses the clocks; their answer resumes them later by that long', async () => {
  const t = (await ticketOf('919810000001'))!
  const r = await s.api(w.owner, 'PATCH', `/api/tickets/${t.number}`, { status: 'pending' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.sla.kind, 'paused')
  // Pretend they waited 2 hours.
  await s.db.collection('tickets').updateOne({ _id: t._id }, { $set: { pausedAt: new Date(Date.now() - 2 * H) } })
  await write('919810000001', 'Here is my order id: #A-1')
  const back = (await ticketOf('919810000001'))!
  assert.equal(back.status, 'open')
  const shifted = +back.resolveDueAt - +t.resolveDueAt
  assert.ok(Math.abs(shifted - 2 * H) < 60_000, `deadline moved by ${shifted / H}h`)
  assert.ok(Math.abs(Number(back.pausedMs) - 2 * H) < 60_000)
})

test('resolving asks for a rating; the customer’s "Good" is recorded once', async () => {
  const t = (await ticketOf('919810000001'))!
  const r = await s.api(w.owner, 'POST', `/api/tickets/${t.number}/resolve`, { resolution: 'Refund sent ✅', handBack: false })
  assert.equal(r.status, 200, r.text)
  const asked = s.fake.find('POST', /\/messages$/).at(-1)!
  assert.equal(asked.body?.type, 'interactive')
  await write('919810000001', 'Good')
  const rated = (await ticketOf('919810000001'))!
  assert.equal(rated.status, 'resolved', 'a rating does not reopen it')
  assert.deepEqual([rated.csat?.score, rated.csat?.label], [3, 'Good'])
})

test('writing again within 3 days reopens the same ticket with fresh deadlines', async () => {
  const t = (await ticketOf('919810000001'))!
  await write('919810000001', 'Actually it hasn’t arrived')
  const again = (await ticketOf('919810000001'))!
  assert.equal(again.number, t.number)
  assert.equal(again.status, 'open')
  assert.equal(again.firstRespondedAt, null)
  assert.equal(again.escalationLevel, 0)
})

test('writing after 3 days starts a new ticket', async () => {
  const t = (await ticketOf('919810000001'))!
  await s.api(w.owner, 'POST', `/api/tickets/${t.number}/resolve`, { askFeedback: false, handBack: false })
  await s.db.collection('tickets').updateOne({ _id: t._id }, { $set: { resolvedAt: new Date(Date.now() - 4 * 86_400_000) } })
  await write('919810000001', 'New problem')
  const t2 = (await ticketOf('919810000001'))!
  assert.notEqual(t2.number, t.number)
  assert.equal(t2.status, 'open')
})

test('two people resolving at once: one wins, the other is told it’s done', async () => {
  const t = (await ticketOf('919810000001'))!
  const [a, b] = await Promise.all([
    s.api(w.owner, 'POST', `/api/tickets/${t.number}/resolve`, { askFeedback: false, handBack: false }),
    s.api(w.supervisor, 'POST', `/api/tickets/${t.number}/resolve`, { askFeedback: false, handBack: false }),
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal(await s.db.collection('events').countDocuments({ kind: 'ticket.resolved', 'data.number': t.number }), 1)
})

test('a handoff and a reply racing for the same chat still leave one open ticket', async () => {
  await write('919810000002', 'hi', 'standby')
  await Promise.all([s.webhook(handover(NUM, '919810000002')), s.webhook(handover(NUM, '919810000002')), s.webhook(handover(NUM, '919810000002'))])
  assert.equal(await s.db.collection('tickets').countDocuments({ phone: '919810000002', status: { $in: ['open', 'pending'] } }), 1)
  assert.equal((await ticketOf('919810000002'))?.source, 'handoff')
})

test('a manual ticket needs a chat, and only one open ticket per chat', async () => {
  assert.equal((await s.api(w.agent, 'POST', '/api/tickets', { phone: '919899999999', subject: 'x' })).status, 404)
  assert.equal((await s.api(w.agent, 'POST', '/api/tickets', { phone: '919810000002', subject: 'x' })).status, 409)
})

test('agents take unassigned work but can’t move someone else’s; supervisors can', async () => {
  const t = (await ticketOf('919810000002'))!
  await s.db.collection('tickets').updateOne({ _id: t._id }, { $set: { assigneeId: w.admin.id } })
  assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { assigneeId: w.agent.id })).status, 403)
  assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { teamId: null })).status, 403)
  assert.equal((await s.api(w.supervisor, 'PATCH', `/api/tickets/${t.number}`, { assigneeId: w.agent.id })).status, 200)
  assert.equal((await s.api(w.supervisor, 'PATCH', `/api/tickets/${t.number}`, { assigneeId: 'not-a-member-0000-0000-000000000000' })).status, 400)
  assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { status: 'resolved' })).status, 400, 'resolve has its own route')
  assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { priority: 'asap' })).status, 400)
  assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { subject: '   ' })).status, 400)
  const tags = await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { tags: [' VIP ', 'vip', 'रिफंड', ''] })
  assert.deepEqual(tags.json.tags, ['vip', 'रिफंड'])
})

test('with restricted agents, an agent can’t open someone else’s ticket', async () => {
  const t = (await ticketOf('919810000002'))!
  await s.db.collection('tickets').updateOne({ _id: t._id }, { $set: { assigneeId: w.supervisor.id } })
  await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': true } })
  try {
    assert.equal((await s.api(w.agent, 'PATCH', `/api/tickets/${t.number}`, { priority: 'low' })).status, 403)
    const mine = await s.api(w.agent, 'GET', '/api/tickets?status=all')
    assert.ok(!mine.json.some((x: { number: number }) => x.number === t.number), 'not in their list')
  } finally {
    await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': false } })
  }
})

test('with restricted agents, an agent can’t read someone else’s ticket by its number either', { todo: 'QA-15: GET /api/tickets/{n} (one()) skips needInScope, so numbers can be walked' }, async () => {
  const t = (await ticketOf('919810000002'))!
  await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': true } })
  try {
    assert.equal((await s.api(w.agent, 'GET', `/api/tickets/${t.number}`)).status, 403)
  } finally {
    await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': false } })
  }
})

test('outside business hours the away message goes once per 12 hours', async () => {
  await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.hours': NEVER_OPEN } })
  try {
    const before = s.fake.find('POST', /\/messages$/).length
    await write('919810000003', 'anyone there?')
    await write('919810000003', 'hello?')
    const sent = s.fake.find('POST', /\/messages$/).slice(before)
    assert.equal(sent.length, 1)
    assert.match(String((sent[0].body?.text as { body?: string } | undefined)?.body), /offline/)
    // No open hours at all: the deadline is "never", and the list still sorts.
    const t = (await ticketOf('919810000003'))!
    assert.ok(+t.resolveDueAt > Date.now() + 100 * 365 * 86_400_000)
    assert.equal((await s.api(w.owner, 'GET', '/api/tickets?sort=due')).status, 200)
  } finally {
    await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.hours': ALWAYS_OPEN } })
  }
})

test('settings refuse overnight hours, unknown zones and upside-down targets', async () => {
  const base = (await s.api(w.owner, 'GET', '/api/support/settings')).json
  const put = (patch: object) => s.api(w.owner, 'PUT', '/api/support/settings', { ...base, ...patch })
  assert.equal((await put({ hours: { ...ALWAYS_OPEN, timezone: 'Mars/Olympus' } })).status, 400)
  assert.equal((await put({ hours: { ...ALWAYS_OPEN, week: { ...ALWAYS_OPEN.week, mon: { open: '22:00', close: '06:00' } } } })).status, 400)
  assert.equal((await put({ sla: { ...base.sla, urgent: { firstResponse: 60, resolve: 30 } } })).status, 400)
  assert.equal((await s.api(w.supervisor, 'PUT', '/api/support/settings', base)).status, 403)
  assert.equal((await put({ hours: ALWAYS_OPEN })).status, 200)
})

test('escalation levels fire in order, once each, as time passes', async () => {
  const ops = await serverModules(s)
  const level = (clock: string, percent: number) => ({ clock, percent, notify: ['assignee', 'admins'], email: false, reassignTeamId: null, raisePriority: false })
  const r = await s.api(w.admin, 'PUT', '/api/support/escalation', { enabled: true, levels: { urgent: [level('first_response', 50), level('first_response', 100), level('resolution', 100)], high: [], normal: [], low: [] } })
  assert.equal(r.status, 200, r.text)
  await write('919810000004', 'urgent!!', 'standby')
  const created = await s.api(w.owner, 'POST', '/api/tickets', { phone: '919810000004', priority: 'urgent', subject: 'Payment failed twice' })
  assert.equal(created.status, 200, created.text)
  const t = (await ticketOf('919810000004'))!
  const start = +t.createdAt
  const fr = +t.firstResponseDueAt - start
  assert.equal(await ops.escalate(w.id, start + fr * 0.4), 0)
  assert.equal(await ops.escalate(w.id, start + fr * 0.6), 1)
  assert.equal(await ops.escalate(w.id, start + fr * 0.6), 0, 'the same level never fires twice')
  // Both remaining levels are due at once: one per sweep.
  const late = +t.resolveDueAt + H
  assert.equal(await ops.escalate(w.id, late), 1)
  assert.equal((await ticketOf('919810000004'))!.escalationLevel, 2)
  assert.equal(await ops.escalate(w.id, late), 1)
  const done = (await ticketOf('919810000004'))!
  assert.equal(done.escalationLevel, 3)
  assert.deepEqual(done.escalations.map((e: { level: number }) => e.level), [1, 2, 3])
  assert.ok(done.escalations[0].notify.includes(w.owner.id), 'admins & owners were notified')
})

test('a ticket answered on time still escalates when its resolution breaches', { todo: 'QA-01: the first-reply level never fires once answered, and blocks the resolution level behind it' }, async () => {
  const ops = await serverModules(s)
  await write('919810000005', 'please help', 'standby')
  await s.api(w.owner, 'POST', '/api/tickets', { phone: '919810000005', priority: 'urgent', subject: 'Answered quickly' })
  const t = (await ticketOf('919810000005'))!
  await s.db.collection('tickets').updateOne({ _id: t._id }, { $set: { firstRespondedAt: new Date(+t.createdAt + 60_000) } })
  assert.equal(await ops.escalate(w.id, +t.resolveDueAt + H), 1)
  assert.equal((await ticketOf('919810000005'))!.escalationLevel, 3)
})
