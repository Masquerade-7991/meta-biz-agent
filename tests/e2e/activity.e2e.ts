// Journey: the activity log. What people do shows up as plain sentences with before → after,
// filtered by area, person, date and error reference; who may read which history; the CSV export.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
let NUM: string
let ticketNo: number
type Ev = { id: string; kind: string; userId: string | null; data: Record<string, unknown> }
const read = async (q = '', who = w.owner) => {
  const r = await s.api(who, 'GET', `/api/activity${q ? '?' + q : ''}`)
  return r
}

before(async () => {
  s = await startStack('activity')
  w = await s.seed.workspace()
  NUM = w.numbers[0]
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  await s.db.collection('support_settings').insertOne({ workspaceId: w.id, settings: { hours: { timezone: 'UTC', week: Object.fromEntries(days.map((d) => [d, { open: '00:00', close: '23:59' }])), holidays: [] } } })
  await s.webhook(inbound(NUM, '919820000001', 'my parcel is late'))
  ticketNo = Number((await s.db.collection('tickets').findOne({ phone: '919820000001' }))!.number)
})
after(() => s?.stop())

test('a ticket edit reads as who changed what from what to what', async () => {
  const r = await s.api(w.owner, 'PATCH', `/api/tickets/${ticketNo}`, { priority: 'urgent', assigneeId: w.agent.id })
  assert.equal(r.status, 200, r.text)
  const { json } = await read('area=tickets')
  const ev = json.events.find((e: Ev) => e.kind === 'ticket.updated' && e.userId === w.owner.id)
  assert.ok(ev, 'the edit is logged')
  const { activityText } = await import('../../src/app/activity/activityText.ts')
  const sentence = activityText(ev, json.names)
  assert.match(sentence, new RegExp(`^Olivia Owner changed priority from Normal to Urgent and assignee from .+ to Ajay Agent on #${ticketNo}$`))
})

test('every sentence in the log is a sentence (no undefined, null or raw kinds)', async () => {
  await s.api(w.owner, 'POST', '/api/workspace/invites', { email: 'nadia@e2e.test', role: 'supervisor' })
  await s.api(w.owner, 'POST', '/api/contacts', { phone: '919820000099', name: 'Zoë 🌟' })
  const { json } = await read()
  const { activityText } = await import('../../src/app/activity/activityText.ts')
  assert.ok(json.events.length >= 4)
  for (const e of json.events) assert.doesNotMatch(activityText(e, json.names), /undefined|null|NaN/, e.kind)
})

test('only owners and admins read the whole log; any member reads a ticket’s own history', async () => {
  assert.equal((await read('', w.supervisor)).status, 403)
  assert.equal((await read('', w.agent)).status, 403)
  assert.equal((await read('', w.admin)).status, 200)
  const own = await read(`entity=ticket&entityId=${ticketNo}`, w.agent)
  assert.equal(own.status, 200)
  assert.ok(own.json.events.every((e: { entity: string }) => e.entity === 'ticket'))
  assert.equal((await read('entity=ticket&entityId=999999', w.agent)).status, 404)
  // A number's history is for supervisors and up.
  assert.equal((await read(`entity=number&entityId=${NUM}`, w.agent)).status, 403)
  assert.equal((await read(`entity=number&entityId=PHONE_NUMBER_ID`, w.supervisor)).status, 200)
  // Other entities need the whole-log permission.
  assert.equal((await read(`entity=member&entityId=${w.agent.id}`, w.supervisor)).status, 403)
})

test('a restricted agent can’t read the history of someone else’s ticket', async () => {
  await s.db.collection('tickets').updateOne({ number: ticketNo }, { $set: { assigneeId: w.supervisor.id } })
  await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': true } })
  try {
    assert.equal((await read(`entity=ticket&entityId=${ticketNo}`, w.agent)).status, 403)
  } finally {
    await s.db.collection('support_settings').updateOne({ workspaceId: w.id }, { $set: { 'settings.restrictAgents': false } })
  }
})

test('filters: area, person, system, dates and an unknown area', async () => {
  const people = await read('area=people')
  assert.ok(people.json.events.length > 0 && people.json.events.every((e: Ev) => /^(member|team)\./.test(e.kind)))
  const mine = await read(`userId=${w.owner.id}`)
  assert.ok(mine.json.events.every((e: Ev) => e.userId === w.owner.id))
  const system = await read('userId=system')
  assert.ok(system.json.events.every((e: Ev) => e.userId === null))
  const today = new Date().toISOString().slice(0, 10)
  assert.ok((await read(`from=${today}&to=${today}`)).json.events.length > 0, 'a date includes that whole day')
  assert.equal((await read('from=2000-01-01&to=2000-01-02')).json.events.length, 0)
  assert.equal((await read('area=toString')).status, 200, 'an unknown area means all areas')
  assert.equal((await read('from=not-a-date')).status, 200, 'an unreadable date is ignored')
})

test('an error reference shows everything behind that one request', async () => {
  const r = await s.api(w.owner, 'PATCH', `/api/tickets/${ticketNo}`, { tags: ['traced'] })
  const ref = r.headers.get('x-trace-id')!.slice(0, 8)
  const { json } = await read(`ref=${ref}`)
  assert.ok(json.events.length >= 1)
  assert.ok(json.events.every((e: { traceId: string }) => e.traceId.startsWith(ref)))
})

test('pages of 50, continued from the last id seen, with no overlap', async () => {
  for (let i = 0; i < 55; i++) await s.db.collection('events').insertOne({ workspaceId: w.id, kind: 'contact.created', userId: w.owner.id, entity: 'contact', entityId: String(919830000000 + i), data: {}, at: new Date() })
  const first = await read('area=contacts')
  assert.equal(first.json.events.length, 50)
  assert.equal(first.json.more, true)
  const next = await read(`area=contacts&before=${first.json.events.at(-1).id}`)
  const ids = new Set(first.json.events.map((e: Ev) => e.id))
  assert.ok(next.json.events.length >= 6)
  assert.ok(next.json.events.every((e: Ev) => !ids.has(e.id)))
})

test('the CSV export opens in Excel and carries the same sentences', async () => {
  const r = await s.api(w.owner, 'GET', '/api/activity.csv?area=tickets')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/)
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="helo-activity-\d{4}-\d{2}-\d{2}\.csv"/)
  assert.ok(r.text.startsWith('﻿When (UTC),Who,What,Item,Reference\r\n'))
  assert.match(r.text, /Olivia Owner changed priority from Normal to Urgent/)
  assert.equal((await s.api(w.supervisor, 'GET', '/api/activity.csv')).status, 403)
})

test('changes to the AI agent appear under the AI agent area', { todo: 'QA-12: nothing on the server writes agent.* events; the area is always empty outside Dummy mode' }, async () => {
  await s.api(w.admin, 'PUT', '/api/meta/PHONE_NUMBER_ID/agent_config/settings', { rollout: { enabled: true } })
  assert.ok((await read('area=agent')).json.events.length > 0)
})

test('blocking a customer on a number shows in the workspace log', { todo: 'QA-08: number.blocked matches no area prefix' }, async () => {
  const r = await s.api(w.owner, 'POST', '/api/inbox/conversations/919820000001/block')
  assert.equal(r.status, 200, r.text)
  const { json } = await read('area=whatsapp')
  assert.ok(json.events.some((e: Ev) => e.kind === 'number.blocked'))
})
