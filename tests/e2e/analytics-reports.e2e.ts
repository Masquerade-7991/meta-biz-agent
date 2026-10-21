// Journey: Analytics counts by the workspace's local day (India here: UTC+5:30, so 18:30 UTC is
// already tomorrow), with one definition per number; reports download as CSV and go out by email
// on a schedule, with the right people allowed to do each.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let NUM: string
const Z = (iso: string) => new Date(iso)

before(async () => {
  s = await startStack('analytics')
  w = await s.seed.workspace()
  NUM = w.numbers[0]
  // Default support hours: Asia/Kolkata. Monday 5 Oct and Tuesday 6 Oct 2026, local days.
  const msg = (phone: string, author: string, at: string, kind = 'text') => ({ workspaceId: w.id, phone, direction: author === 'customer' ? 'in' : 'out', author, kind, body: 'x', at: Z(at), phoneNumberId: NUM, createdAt: Z(at) })
  await s.db.collection('messages').insertMany([
    msg('919840000002', 'customer', '2026-10-05T18:15:00Z'), // Mon 23:45 IST
    msg('919840000002', 'agent', '2026-10-05T18:20:00Z'), // team replied Monday
    msg('919840000001', 'customer', '2026-10-05T18:45:00Z'), // Tue 00:15 IST
    msg('919840000001', 'ai', '2026-10-05T18:46:00Z'), // AI alone, Tuesday
    msg('919840000003', 'customer', '2026-10-06T05:00:00Z'), // Tue 10:30 IST, nobody answered…
    msg('919840000003', 'agent', '2026-10-06T05:05:00Z', 'note'), // …an internal note isn't an answer
    msg('919840000009', 'customer', '2026-10-06T18:31:00Z'), // Wed 00:01 IST: outside the range
  ])
  const t = (o: Record<string, unknown>) => ({ workspaceId: w.id, phone: '919840000003', status: 'open', priority: 'normal', assigneeId: null, teamId: null, tags: [], source: 'customer', phoneNumberId: NUM, firstRespondedAt: null, resolvedAt: null, csat: null, escalationLevel: 0, ...o })
  await s.db.collection('tickets').insertMany([
    t({ number: 1001, source: 'handoff', createdAt: Z('2026-10-06T06:00:00Z'), firstResponseDueAt: Z('2026-10-06T07:00:00Z'), resolveDueAt: Z('2026-10-06T08:00:00Z'), firstRespondedAt: Z('2026-10-06T06:10:00Z'), status: 'resolved', resolvedAt: Z('2026-10-06T07:00:00Z'), csat: { score: 3, label: 'Good' }, assigneeId: w.agent.id }),
    t({ number: 1002, phone: '919840000002', createdAt: Z('2026-10-05T10:00:00Z'), firstResponseDueAt: Z('2026-10-05T11:00:00Z'), resolveDueAt: Z('2026-10-06T10:00:00Z') }),
  ])
})
after(() => s?.stop())

const overview = (q: string, who = w.owner) => s.api(who, 'GET', `/api/analytics/overview?${q}`)

test('chats count on the local day, by who answered; notes are not answers', async () => {
  const r = await overview('from=2026-10-05&to=2026-10-06')
  assert.equal(r.status, 200, r.text)
  const [mon, tue] = r.json.series
  assert.deepEqual([mon.date, mon.conversations, mon.withTeam, mon.aiOnly, mon.noReply], ['2026-10-05', 1, 1, 0, 0])
  assert.deepEqual([tue.date, tue.conversations, tue.withTeam, tue.aiOnly, tue.noReply], ['2026-10-06', 2, 0, 1, 1])
  assert.equal(r.json.range.timezone, 'Asia/Kolkata')
  assert.equal(r.json.kpis.conversations.value, 3, 'three distinct chats in the period')
  assert.ok(Math.abs(r.json.kpis.containment.value - 1 / 3) < 1e-9)
})

test('tickets: opened, resolved on time, rated, and the backlog at the end of each day', async () => {
  const { json } = await overview('from=2026-10-05&to=2026-10-06')
  const [mon, tue] = json.series
  assert.deepEqual([mon.ticketsOpened, mon.backlog], [1, 1])
  assert.deepEqual([tue.ticketsOpened, tue.ticketsResolved, tue.handoffs, tue.slaMet, tue.csatGood, tue.backlog], [1, 1, 1, 1, 1, 1])
  assert.equal(json.kpis.ticketsOpened.value, 2)
  assert.equal(json.kpis.ticketsResolved.value, 1)
  assert.equal(json.kpis.csat.value, 1)
  assert.equal(json.kpis.medianFirstReplyMin.value, 10)
})

test('the heatmap places customer messages on the local weekday and hour', async () => {
  const { json } = await overview('from=2026-10-05&to=2026-10-06')
  assert.equal(json.heatmap[0][23], 1, 'Monday 23:00 IST')
  assert.equal(json.heatmap[1][0], 1, 'Tuesday 00:00 IST')
  assert.equal(json.heatmap[1][10], 1, 'Tuesday 10:00 IST')
})

test('the period before is the same length and empty here', async () => {
  const { json } = await overview('from=2026-10-05&to=2026-10-06')
  assert.deepEqual([json.range.prevFrom, json.range.prevTo], ['2026-10-03', '2026-10-04'])
  assert.equal(json.kpis.conversations.prev, 0)
})

test('the same numbers come out when filtered to the one agent there is', async () => {
  const all = (await overview('from=2026-10-05&to=2026-10-06')).json
  const one = (await overview(`from=2026-10-05&to=2026-10-06&numbers=${NUM}`)).json
  assert.equal(one.kpis.conversations.value, all.kpis.conversations.value)
  assert.equal(one.byAgent.length, 1)
  assert.equal(one.byAgent[0].conversations, 3)
  // Someone else's number is ignored, not an error and not a leak.
  assert.equal((await overview('from=2026-10-05&to=2026-10-06&numbers=770000000000001')).json.kpis.conversations.value, 3)
})

test('bad ranges and the wrong role are refused', async () => {
  assert.equal((await overview('from=2026-10-06&to=2026-10-05')).status, 400)
  assert.equal((await overview('from=2026-02-30&to=2026-03-01')).status, 400)
  assert.equal((await overview('from=2024-01-01&to=2026-10-06')).status, 400)
  assert.equal((await overview('from=2026-10-05&to=2026-10-06', w.agent)).status, 403)
  assert.equal((await s.api(w.supervisor, 'GET', '/api/analytics/logs/nope')).status, 404)
})

test('the ticket log lists both tickets in the period', async () => {
  const r = await s.api(w.supervisor, 'GET', '/api/analytics/logs/tickets?from=2026-10-05&to=2026-10-06')
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.total, 2)
  assert.ok(r.json.columns.length > 3)
})

test('report CSVs: a file for supervisors and up, with Excel’s byte-order mark', async () => {
  const r = await s.api(w.supervisor, 'GET', '/api/reports/business_review.csv?from=2026-10-05&to=2026-10-06')
  assert.equal(r.status, 200, r.text)
  assert.match(r.headers.get('content-disposition') ?? '', /helo-business-review-2026-10-05-to-2026-10-06\.csv/)
  assert.ok(r.text.startsWith('﻿Measure,2026-10-05 to 2026-10-06,2026-10-03 to 2026-10-04\r\n'))
  assert.match(r.text, /\r\nConversations,3,0\r\n/)
  assert.equal((await s.api(w.agent, 'GET', '/api/reports/business_review.csv')).status, 403)
  assert.equal((await s.api(w.owner, 'GET', '/api/reports/everything.csv')).status, 404)
  assert.equal((await s.api(w.owner, 'GET', '/api/reports/tickets.csv?from=2026-13-01&to=2026-13-02')).status, 400)
})

test('reports that ignore team and assignee give the same file with them set (catalog filters match the server)', async () => {
  const q = 'from=2026-10-05&to=2026-10-06'
  for (const id of ['consumption', 'charges', 'agent_usage']) {
    const plain = await s.api(w.owner, 'GET', `/api/reports/${id}.csv?${q}`)
    const narrowed = await s.api(w.owner, 'GET', `/api/reports/${id}.csv?${q}&team=nope&person=none`)
    assert.equal(plain.status, 200, plain.text)
    assert.equal(narrowed.text, plain.text, id)
  }
})

test('schedules: who may send outside the workspace, and the limits', async () => {
  const body = { name: 'Weekly review 📊', reports: ['business_review', 'tickets'], cadence: 'weekly', hour: 9, userIds: [w.supervisor.id] }
  const mine = await s.api(w.supervisor, 'POST', '/api/reports/schedules', body)
  assert.equal(mine.status, 200, mine.text)
  assert.ok(mine.json.nextRunAt)
  assert.equal((await s.api(w.supervisor, 'POST', '/api/reports/schedules', { ...body, emails: ['cfo@outside.example'] })).status, 403)
  assert.equal((await s.api(w.admin, 'POST', '/api/reports/schedules', { ...body, emails: ['cfo@outside.example'] })).status, 200)
  assert.equal((await s.api(w.admin, 'POST', '/api/reports/schedules', { ...body, hour: 24 })).status, 400)
  assert.equal((await s.api(w.admin, 'POST', '/api/reports/schedules', { ...body, cadence: 'hourly' })).status, 400)
  assert.equal((await s.api(w.admin, 'POST', '/api/reports/schedules', { ...body, emails: ['not-an-email'] })).status, 400)
  assert.equal((await s.api(w.admin, 'POST', '/api/reports/schedules', { ...body, userIds: [], emails: Array.from({ length: 26 }, (_, i) => `p${i}@x.example`) })).status, 400)
  assert.equal((await s.api(w.agent, 'POST', '/api/reports/schedules', body)).status, 403)
})

test('send now emails the people on it with the CSVs attached, and logs it', async () => {
  const list = (await s.api(w.supervisor, 'GET', '/api/reports/schedules')).json
  const sched = list.find((x: { name: string }) => x.name === 'Weekly review 📊')
  const r = await s.api(w.supervisor, 'POST', `/api/reports/schedules/${sched.id}/send`)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.sent, 1)
  const log = s.log()
  assert.ok(log.includes(`[mail → ${w.supervisor.email}]`))
  assert.match(log, /\(attached: helo-business-review-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv/)
  assert.ok(await s.db.collection('events').findOne({ kind: 'report.sent' }))
})
