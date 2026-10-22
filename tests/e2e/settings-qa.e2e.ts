// Journey: QA verification of the Settings revamp (2026-10-22-settings-revamp). Probes the edges the
// revamp's own journeys (settings.e2e.ts) leave out: two saves at the same moment on every settings
// document, the budget's validation and 409, the activity log's day filter near midnight in the
// workspace's time zone, role changes by an admin, sessions of someone else, and what a removed
// contact field does to a segment. Known, unfixed bugs are `todo` with their QA id (tests/QA_REPORT.md).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('settings_qa')
  w = await s.seed.workspace()
})
after(() => s?.stop())

type Doc = { path: string; body: unknown; read: (r: Awaited<ReturnType<Stack['api']>>) => string | null }
const DOCS: Record<string, Doc> = {
  'support settings': { path: '/api/support/settings', body: { awayMessage: 'Same moment' }, read: (r) => r.json.updatedAt },
  'routing rules': { path: '/api/support/rules', body: [], read: (r) => r.headers.get('x-updated-at') },
  escalation: { path: '/api/support/escalation', body: { enabled: false, levels: {} }, read: (r) => r.json.updatedAt },
  'contact fields': { path: '/api/contacts/fields', body: { fields: [] }, read: (r) => r.headers.get('x-updated-at') },
  'billing budget': { path: '/api/billing', body: { budget: 500 }, read: (r) => r.json.updatedAt },
}

/** Two people who opened the same copy press Save at the same moment: only one may win. */
async function sameMoment(d: Doc) {
  assert.equal((await s.api(w.owner, 'PUT', d.path, d.body)).status, 200, d.path)
  const seen = d.read(await s.api(w.owner, 'GET', d.path))
  assert.ok(seen, `${d.path} tells when it was saved`)
  await new Promise((done) => setTimeout(done, 5))
  const h = { 'If-Unmodified-Since': seen! }
  const codes = (await Promise.all(Array.from({ length: 4 }, () => s.api(w.owner, 'PUT', d.path, d.body, h)))).map((r) => r.status).sort()
  assert.equal(codes.filter((c) => c === 200).length, 1, `${d.path}: exactly one of four simultaneous saves wins, got ${codes.join(',')}`)
}

test('support settings: of two saves at the same moment over the same copy, one gets 409', () => sameMoment(DOCS['support settings']))
test('billing budget: of two saves at the same moment over the same copy, one gets 409', () => sameMoment(DOCS['billing budget']))
for (const name of ['routing rules', 'escalation', 'contact fields'])
  test(`${name}: of two saves at the same moment over the same copy, one gets 409`, () => sameMoment(DOCS[name]))

test('billing budget: refuses text, negatives and huge numbers; 0 means none; a stale save is 409', async () => {
  for (const budget of ['100', -1, 1e10, true, {}]) assert.equal((await s.api(w.owner, 'PUT', '/api/billing', { budget })).status, 400, JSON.stringify(budget))
  assert.equal((await s.api(w.owner, 'PUT', '/api/billing', {})).status, 400, 'a missing budget is not read as none')
  assert.equal((await s.api(w.admin, 'PUT', '/api/billing', { budget: 10 })).status, 403, 'only owners set it')
  const zero = await s.api(w.owner, 'PUT', '/api/billing', { budget: 0 })
  assert.equal(zero.status, 200, zero.text)
  assert.equal(zero.json.budget, null)
  const set = await s.api(w.owner, 'PUT', '/api/billing', { budget: 1234.567 })
  assert.equal(set.json.budget, 1234.57)
  const seen = set.json.updatedAt
  await new Promise((done) => setTimeout(done, 5))
  assert.equal((await s.api(w.owner, 'PUT', '/api/billing', { budget: 1 })).status, 200)
  const stale = await s.api(w.owner, 'PUT', '/api/billing', { budget: 2 }, { 'If-Unmodified-Since': seen })
  assert.equal(stale.status, 409, stale.text)
  assert.equal((await s.api(w.admin, 'POST', '/api/billing/sync')).status, 403, 'Update now is the owners’')
})

test('activity: a day filter is that day in the workspace’s time zone, not UTC', async () => {
  // Asia/Kolkata (the default) is UTC+05:30: 20:00 UTC on the 10th is already the 11th there.
  const at = new Date('2026-03-10T20:00:00Z')
  await s.db.collection('events').insertOne({ workspaceId: w.id, kind: 'ticket.updated', entity: 'ticket', entityId: '1', data: { number: 1 }, userId: w.owner.id, at })
  const tenth = await s.api(w.owner, 'GET', '/api/activity?from=2026-03-10&to=2026-03-10')
  const eleventh = await s.api(w.owner, 'GET', '/api/activity?from=2026-03-11&to=2026-03-11')
  assert.equal(tenth.json.events.length, 0, 'not on the 10th in Kolkata')
  assert.equal(eleventh.json.events.length, 1, 'on the 11th in Kolkata')
})

test('role changes: admins can’t promote to owner or demote an owner; an unknown role is 400', async () => {
  const p = await s.seed.person({ name: 'Promo Target', role: 'agent', workspaceId: w.id })
  assert.equal((await s.api(w.admin, 'PUT', `/api/workspace/members/${p.id}`, { role: 'owner' })).status, 403)
  assert.equal((await s.api(w.admin, 'PUT', `/api/workspace/members/${w.owner.id}`, { role: 'admin' })).status, 403)
  assert.equal((await s.api(w.owner, 'PUT', `/api/workspace/members/${p.id}`, { role: 'Owner' })).status, 400)
  assert.equal((await s.db.collection('memberships').findOne({ userId: p.id }))?.role, 'agent')
})

test('sessions: nobody can sign out someone else’s session; an API token can’t sign anyone out', async () => {
  const a = await s.seed.person({ name: 'Alice Sessions', role: 'agent', workspaceId: w.id })
  const b = await s.seed.person({ name: 'Bob Sessions', role: 'owner', workspaceId: w.id })
  const mine = (await s.api(a, 'GET', '/api/account/sessions')).json.sessions[0].id
  assert.equal((await s.api(b, 'DELETE', `/api/account/sessions/${mine}`)).status, 404)
  assert.equal((await s.api(a, 'GET', '/api/auth/me')).status, 200)
  const t = await s.api(a, 'POST', '/api/account/tokens', { name: 'Peek', expiresInDays: 30 })
  const r = await fetch(`${s.base}/api/account/sessions/revoke-others`, { method: 'POST', headers: { authorization: `Bearer ${t.json.token}` } })
  assert.equal(r.status, 403)
})

test('a revoked invite link can’t be opened, and revoking clears the person from the list', async () => {
  const email = `revoked.${Date.now().toString(36)}@e2e.test`
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email })).status, 200)
  const token = await s.until(() => s.log().slice(s.log().lastIndexOf(`[mail → ${email}]`)).match(/token=([A-Za-z0-9_-]{20,})/)?.[1])
  const inv = (await s.api(w.admin, 'GET', '/api/workspace/members')).json.invites.find((i: { email: string }) => i.email === email)
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/invites/${inv.id}`)).status, 200)
  assert.equal((await s.api(null, 'POST', '/api/auth/verify', { token })).status, 410)
  const list = (await s.api(w.admin, 'GET', '/api/workspace/members')).json
  assert.ok(!list.invites.some((i: { email: string }) => i.email === email) && !list.joining.some((j: { email: string }) => j.email === email))
})

test('a segment whose only filter was a removed field doesn’t widen to every contact', async () => {
  assert.equal((await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ label: 'Region' }] })).status, 200)
  for (const [phone, region] of [['919811100011', 'North'], ['919811100012', 'South'], ['919811100013', 'South']])
    assert.equal((await s.api(w.admin, 'POST', '/api/contacts', { phone: `+${phone}`, name: `C ${phone}`, fields: { region } })).status, 200)
  const seg = await s.api(w.admin, 'POST', '/api/contacts/segments', { name: 'North only', filter: { field: { key: 'region', value: 'North' } } })
  assert.equal(seg.json.count, 1)
  assert.equal((await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [] })).status, 200)
  const after = ((await s.api(w.admin, 'GET', '/api/contacts/segments')).json as { id: string; count: number }[]).find((x) => x.id === seg.json.id)
  assert.ok(!after || after.count <= 1, `“North only” now holds ${after?.count} contacts`)
  assert.ok(await s.db.collection('events').findOne({ workspaceId: w.id, kind: 'segment.deleted', 'data.reason': 'field_removed', 'data.name': 'North only' }), 'the deletion is in the activity log')
})

test('saving one day’s hours keeps the other days open', async () => {
  const before = (await s.api(w.admin, 'GET', '/api/support/settings')).json.hours.week
  assert.ok(before.tue, 'Tuesday starts open')
  const r = await s.api(w.admin, 'PUT', '/api/support/settings', { hours: { week: { mon: { open: '10:00', close: '18:00' } } } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json.hours.week.tue, before.tue, 'Tuesday left out stays as it was')
})
