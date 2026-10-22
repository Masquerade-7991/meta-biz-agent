// Journey: the Settings revamp's server side. Invites and pending sign-ups, a password change that
// revokes API tokens, partial support-settings saves, 409 on concurrent saves, workspace rename and
// ownership transfer, sessions, notification preferences, canned responses, contact-field removal,
// and the activity CSV's truncation line.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Person, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('settings')
  w = await s.seed.workspace()
})
after(() => s?.stop())

const linkToken = (log: string, email: string, after = 0) => {
  const i = log.lastIndexOf(`[mail → ${email}]`)
  const m = i >= after ? log.slice(i).match(/token=([A-Za-z0-9_-]{20,})/) : null
  return m?.[1] ?? null
}
const sidOf = (r: { headers: Headers }) => r.headers.get('set-cookie')?.match(/sid=([^;]*)/)?.[1] ?? ''
const as = (token: string) => ({ token }) as unknown as Person
const unique = (name: string) => `${name}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.test`
const bearer = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${s.base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
const login = async (email: string, password: string, ua: string) => {
  const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ email, password }) })
  assert.equal(r.status, 200, await r.clone().text())
  return as(sidOf(r))
}
/** Event kinds recorded in a workspace, read from the database (new kinds get their activity area
 *  and sentence in src/app/activity/activityText.ts, which the API's area filter follows). */
const kindsIn = async (workspaceId: string) => (await s.db.collection('events').distinct('kind', { workspaceId })) as string[]

/** Invites someone new, opens the link: an unfinished account waiting to join `w`. */
async function openedInvite(by: Person, role = 'agent') {
  const email = unique('joiner')
  const sent = await s.api(by, 'POST', '/api/workspace/invites', { email, role })
  assert.equal(sent.status, 200, sent.text)
  const token = await s.until(() => linkToken(s.log(), email))
  const v = await s.api(null, 'POST', '/api/auth/verify', { token })
  assert.equal(v.status, 200, v.text)
  return { email, sid: as(sidOf(v)) }
}

// ---- AC3: security ----
test('a cancelled sign-up can’t finish joining; setup then makes their own workspace', async () => {
  const { email, sid } = await openedInvite(w.admin)
  const list = await s.api(w.admin, 'GET', '/api/workspace/members')
  const j = list.json.joining.find((x: { email: string }) => x.email === email)
  assert.ok(j?.userId, 'joining rows carry the userId to cancel')
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/joining/${j.userId}`)).status, 200)
  assert.equal((await s.api(sid, 'GET', '/api/auth/me')).json.joining, null, 'no longer joining')
  const done = await s.api(sid, 'POST', '/api/account/setup', { name: 'Late Joiner', password: 'a long password' })
  assert.equal(done.status, 400, 'without a workspace name: there is nothing to join any more')
  const members = (await s.api(w.admin, 'GET', '/api/workspace/members')).json.members as { email: string }[]
  assert.ok(!members.some((x) => x.email === email))
  const own = await s.api(sid, 'POST', '/api/account/setup', { name: 'Late Joiner', password: 'a long password', workspaceName: 'Mine' })
  assert.equal(own.status, 200, own.text)
  assert.equal(own.json.role, 'owner')
  assert.notEqual(own.json.workspace.id, w.id)
  assert.ok((await kindsIn(w.id)).includes('member.signup_cancelled'))
})

test('an invite withdrawn while the person is still setting up stops the join (410)', async () => {
  const { email, sid } = await openedInvite(w.admin)
  // The link they used is revoked behind their back (what revoking or cancelling does to it).
  await s.db.collection('magic_links').updateMany({ email, purpose: 'invite' }, { $set: { revokedAt: new Date() } })
  const done = await s.api(sid, 'POST', '/api/account/setup', { name: 'Raced Joiner', password: 'a long password' })
  assert.equal(done.status, 410, done.text)
  assert.equal(await s.db.collection('memberships').countDocuments({ workspaceId: w.id, userId: (await s.api(sid, 'GET', '/api/auth/me')).json.user.id }), 0)
})

test('joining through an invite is recorded as member.joined', async () => {
  const { sid } = await openedInvite(w.admin)
  const done = await s.api(sid, 'POST', '/api/account/setup', { name: 'Jo Joiner', password: 'a long password' })
  assert.equal(done.status, 200, done.text)
  assert.equal(done.json.workspace.id, w.id)
  assert.ok((await kindsIn(w.id)).includes('member.joined'))
})

test('changing the password revokes the person’s API tokens and other sessions', async () => {
  const p = await s.seed.person({ name: 'Pat Password', role: 'agent', workspaceId: w.id })
  const other = await login(p.email, p.password, 'OtherBrowser/1')
  const t = await s.api(p, 'POST', '/api/account/tokens', { name: 'CI', expiresInDays: 30 })
  assert.equal((await bearer(t.json.token, 'GET', '/api/tickets')).status, 200)
  const r = await s.api(p, 'POST', '/api/account/password', { currentPassword: p.password, newPassword: 'another long password' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.tokensRevoked, 1)
  assert.equal((await bearer(t.json.token, 'GET', '/api/tickets')).status, 401)
  assert.equal((await s.api(other, 'GET', '/api/auth/me')).status, 401)
  assert.equal((await s.api(p, 'GET', '/api/auth/me')).status, 200, 'this session stays')
  assert.ok((await kindsIn(w.id)).includes('profile.password_changed'))
})

test('a password reset revokes API tokens too', async () => {
  const p = await s.seed.person({ name: 'Rita Reset', role: 'agent', workspaceId: w.id })
  const t = await s.api(p, 'POST', '/api/account/tokens', { name: 'Old', expiresInDays: 30 })
  assert.equal((await s.api(null, 'POST', '/api/auth/forgot', { email: p.email })).status, 200)
  const token = await s.until(() => linkToken(s.log(), p.email))
  assert.equal((await s.api(null, 'POST', '/api/auth/verify', { token })).status, 200)
  assert.equal((await bearer(t.json.token, 'GET', '/api/tickets')).status, 401)
})

test('owner invites: admins can’t resend or revoke them; an unknown role is refused', async () => {
  const email = unique('future.owner')
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email: unique('x'), role: 'superuser' })).status, 400)
  assert.equal((await s.api(w.owner, 'POST', '/api/workspace/invites', { email, role: 'owner' })).status, 200)
  const inv = (await s.api(w.owner, 'GET', '/api/workspace/members')).json.invites.find((i: { email: string }) => i.email === email)
  assert.equal((await s.api(w.admin, 'POST', `/api/workspace/invites/${inv.id}/resend`)).status, 403)
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/invites/${inv.id}`)).status, 403)
  assert.equal((await s.api(w.owner, 'DELETE', `/api/workspace/invites/${inv.id}`)).status, 200)
})

test('invites: twice is 409, revoke then re-invite works, resend kills the old link', async () => {
  const email = unique('twice')
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email })).status, 200)
  const again = await s.api(w.admin, 'POST', '/api/workspace/invites', { email })
  assert.equal(again.status, 409, again.text)
  const inv = (await s.api(w.admin, 'GET', '/api/workspace/members')).json.invites.find((i: { email: string }) => i.email === email)
  assert.equal(inv.expired, false)
  assert.ok(inv.sentAt)
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/invites/${inv.id}`)).status, 200)
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email })).status, 200, 'revoked invites don’t block a new one')
  const old = await s.until(() => linkToken(s.log(), email))
  const inv2 = (await s.api(w.admin, 'GET', '/api/workspace/members')).json.invites.find((i: { email: string }) => i.email === email)
  const mark = s.log().length
  const re = await s.api(w.admin, 'POST', `/api/workspace/invites/${inv2.id}/resend`)
  assert.equal(re.status, 200, re.text)
  const fresh = await s.until(() => linkToken(s.log(), email, mark))
  assert.notEqual(fresh, old)
  assert.equal((await s.api(null, 'POST', '/api/auth/verify', { token: old })).status, 410)
  assert.ok((await kindsIn(w.id)).includes('member.invite_resent'))
})

test('expired invites stay listed and can be resent', async () => {
  const email = unique('expired')
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email })).status, 200)
  await s.db.collection('magic_links').updateOne({ email, purpose: 'invite' }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  const inv = (await s.api(w.admin, 'GET', '/api/workspace/members')).json.invites.find((i: { email: string }) => i.email === email)
  assert.equal(inv?.expired, true)
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email })).status, 200, 'an expired invite no longer counts as live')
})

test('accepting the same invite twice at once answers 200 both times', async () => {
  const p = await s.seed.person({ name: 'Existing Person' })
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email: p.email, role: 'supervisor' })).status, 200)
  const id = (await s.api(p, 'GET', '/api/auth/me')).json.invites[0].id
  const [a, b] = await Promise.all([s.api(p, 'POST', `/api/account/invites/${id}/accept`), s.api(p, 'POST', `/api/account/invites/${id}/accept`)])
  assert.deepEqual([a.status, b.status], [200, 200], `${a.text} ${b.text}`)
  assert.equal(a.json.workspace.id, w.id)
  assert.equal(await s.db.collection('memberships').countDocuments({ userId: p.id, workspaceId: w.id }), 1)
})

test('changing email: pending, cancel, and confirming logs out other devices', async () => {
  const p = await s.seed.person({ name: 'Eve Email', role: 'agent', workspaceId: w.id })
  const other = await login(p.email, p.password, 'Phone/1')
  const next = unique('eve.new')
  assert.equal((await s.api(p, 'POST', '/api/account/email', { password: p.password, newEmail: next })).status, 200)
  assert.equal((await s.api(p, 'GET', '/api/auth/me')).json.pendingEmail, next)
  const cancelled = await s.api(p, 'POST', '/api/account/email/cancel')
  assert.equal(cancelled.json.pendingEmail, null)
  const old = await s.until(() => linkToken(s.log(), next))
  assert.equal((await s.api(null, 'POST', '/api/auth/verify', { token: old })).status, 410, 'a cancelled change can’t be confirmed')
  const mark = s.log().length
  assert.equal((await s.api(p, 'POST', '/api/account/email', { password: p.password, newEmail: next })).status, 200)
  const token = await s.until(() => linkToken(s.log(), next, mark))
  const v = await fetch(`${s.base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `sid=${p.token}` }, body: JSON.stringify({ token }) })
  assert.equal(v.status, 200)
  assert.equal((await s.api(other, 'GET', '/api/auth/me')).status, 401)
  assert.equal((await s.api(p, 'GET', '/api/auth/me')).json.user.email, next)
})

// ---- support settings ----
test('a partial support-settings save keeps everything it leaves out', async () => {
  const first = await s.api(w.admin, 'PUT', '/api/support/settings', { restrictAgents: true, awayMessage: 'Back soon.' })
  assert.equal(first.status, 200, first.text)
  const r = await s.api(w.admin, 'PUT', '/api/support/settings', { sla: { urgent: { firstResponse: 10, resolve: 120 } } })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.restrictAgents, true)
  assert.equal(r.json.awayMessage, 'Back soon.')
  assert.equal(r.json.sla.urgent.firstResponse, 10)
  assert.equal(r.json.sla.high.firstResponse, 30, 'other priorities untouched')
  assert.equal(r.json.hours.week.mon.open, '09:30')
  assert.equal(typeof r.json.openTickets, 'number')
  assert.equal(r.json.updatedBy, 'Adam Admin')
  for (const [body, why] of [
    [{ routing: { mode: 'random' } }, 'enum'],
    [{ sla: { low: { firstResponse: '', resolve: 10 } } }, 'empty target'],
    [{ sla: { low: { firstResponse: 60, resolve: 30 } } }, 'resolve < first'],
    [{ hours: { timezone: '+05:30' } }, 'offset zone'],
    [{ hours: { holidays: ['2020-01-01'] } }, 'past date'],
    [{ hours: { holidays: ['2031-02-31'] } }, 'not a date'],
    [{ hours: { week: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null } } }, 'all closed'],
    [{ restrictAgents: 'yes' }, 'boolean'],
  ] as const)
    assert.equal((await s.api(w.admin, 'PUT', '/api/support/settings', body)).status, 400, why)
  const ok = await s.api(w.admin, 'PUT', '/api/support/settings', {
    hours: { timezone: 'America/Argentina/Buenos_Aires', week: { sun: { open: '00:00', close: '24:00' }, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null }, holidays: [{ date: '2020-12-25', name: 'Christmas', yearly: true }] },
  })
  assert.equal(ok.status, 200, ok.text)
  assert.deepEqual(ok.json.hours.week.sun, { open: '00:00', close: '24:00' })
  assert.equal(ok.json.hours.holidays[0].name, 'Christmas')
  const closed = { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null }
  assert.equal((await s.api(w.admin, 'PUT', '/api/support/settings', { hours: { week: closed }, confirmNoHours: true })).status, 200)
  const always = await s.api(w.admin, 'PUT', '/api/support/settings', { twentyFourSeven: true })
  assert.equal(always.json.hours.twentyFourSeven, true)
  assert.equal(always.json.restrictAgents, true)
  const rec = await s.api(w.admin, 'POST', '/api/support/settings/recompute')
  assert.equal(rec.status, 200)
  assert.equal(typeof rec.json.updated, 'number')
  assert.equal((await s.api(w.agent, 'POST', '/api/support/settings/recompute')).status, 403)
  await s.api(w.admin, 'PUT', '/api/support/settings', { restrictAgents: false, twentyFourSeven: false, hours: { timezone: 'Asia/Kolkata', week: { mon: { open: '09:30', close: '18:30' } } } })
})

test('two admins saving: the second gets 409 Changed by someone else (settings, rules, escalation, fields)', async () => {
  const cases: { path: string; body: unknown; read: (r: Awaited<ReturnType<Stack['api']>>) => string | null }[] = [
    { path: '/api/support/settings', body: { awayMessage: 'One' }, read: (r) => r.json.updatedAt },
    { path: '/api/support/rules', body: [], read: (r) => r.headers.get('x-updated-at') },
    { path: '/api/support/escalation', body: { enabled: false, levels: {} }, read: (r) => r.json.updatedAt },
    { path: '/api/contacts/fields', body: { fields: [] }, read: (r) => r.headers.get('x-updated-at') },
  ]
  for (const c of cases) {
    // Something saved first, so there is an updatedAt to read.
    assert.equal((await s.api(w.owner, 'PUT', c.path, c.body)).status, 200, c.path)
    const seen = c.read(await s.api(w.owner, 'GET', c.path))
    assert.ok(seen, `${c.path} tells when it was saved`)
    await new Promise((done) => setTimeout(done, 5))
    const mine = await s.api(w.admin, 'PUT', c.path, c.body, { 'If-Unmodified-Since': seen! })
    assert.equal(mine.status, 200, `${c.path}: ${mine.text}`)
    const theirs = await s.api(w.owner, 'PUT', c.path, c.body, { 'If-Unmodified-Since': seen! })
    assert.equal(theirs.status, 409, `${c.path}: ${theirs.text}`)
    assert.equal(theirs.json.title, 'Changed by someone else')
    assert.equal((await s.api(w.owner, 'PUT', c.path, c.body)).status, 200, `${c.path}: Keep mine (no header) saves`)
  }
})

test('escalation levels get stable ids that survive a save', async () => {
  const level = (percent: number) => ({ clock: 'resolution', percent, notify: ['assignee'], email: false, reassignTeamId: null, raisePriority: false })
  const a = await s.api(w.admin, 'PUT', '/api/support/escalation', { enabled: true, levels: { urgent: [level(50), level(100)] } })
  assert.equal(a.status, 200, a.text)
  const ids = a.json.levels.urgent.map((l: { id: string }) => l.id)
  assert.equal(new Set(ids).size, 2)
  // Insert a level before the others, sending the ids back.
  const b = await s.api(w.admin, 'PUT', '/api/support/escalation', { enabled: true, levels: { urgent: [level(25), { ...level(50), id: ids[0] }, { ...level(100), id: ids[1] }] } })
  assert.deepEqual(b.json.levels.urgent.slice(1).map((l: { id: string }) => l.id), ids)
  await s.api(w.admin, 'PUT', '/api/support/escalation', { enabled: false, levels: {} })
})

test('teams: names are unique; the lead must be a member', async () => {
  const t = await s.api(w.admin, 'POST', '/api/support/teams', { name: 'Billing desk', memberIds: [w.agent.id] })
  assert.equal(t.status, 200, t.text)
  assert.equal((await s.api(w.admin, 'POST', '/api/support/teams', { name: 'billing DESK' })).status, 409)
  assert.equal((await s.api(w.admin, 'PUT', `/api/support/teams/${t.json.id}`, { name: 'Billing desk', memberIds: [w.agent.id], leadId: w.supervisor.id })).status, 400)
  assert.equal((await s.api(w.admin, 'DELETE', `/api/support/teams/${t.json.id}`)).status, 200)
})

// ---- canned responses ----
test('canned: shared stays shared when left out; private titles never leak; departed members free their shortcuts', async () => {
  const shared = await s.api(w.admin, 'POST', '/api/inbox/canned', { title: 'Refunds', shortcut: '/refund-e2e', body: 'We refund within 7 days.', shared: true })
  assert.equal(shared.status, 200, shared.text)
  const edited = await s.api(w.admin, 'PUT', `/api/inbox/canned/${shared.json.id}`, { title: 'Refunds', shortcut: '/refund-e2e', body: 'We refund within 5 days.' })
  assert.equal(edited.json.shared, true, 'shared left out keeps its value')
  const p = await s.seed.person({ name: 'Leaving Agent', role: 'agent', workspaceId: w.id })
  const mine = await s.api(p, 'POST', '/api/inbox/canned', { title: 'My secret greeting', shortcut: '/hello-e2e', body: 'Hi!' })
  assert.equal(mine.json.shared, false, 'new responses are private by default')
  const clash = await s.api(w.agent, 'POST', '/api/inbox/canned', { title: 'Mine', shortcut: '/hello-e2e', body: 'Hey' })
  assert.equal(clash.status, 409)
  assert.ok(!clash.text.includes('My secret greeting'), 'someone else’s private title is not shown')
  assert.equal((await s.api(w.agent, 'DELETE', `/api/inbox/canned/${shared.json.id}`)).status, 403, 'deleting a shared one needs admin, like editing')
  assert.equal((await s.api(w.owner, 'DELETE', `/api/workspace/members/${p.id}`)).status, 200)
  assert.equal((await s.api(w.agent, 'POST', '/api/inbox/canned', { title: 'Mine', shortcut: '/hello-e2e', body: 'Hey' })).status, 200, 'shortcut freed')
  const kinds = await kindsIn(w.id)
  assert.ok(kinds.includes('canned.created') && kinds.includes('canned.updated'), kinds.join(','))
})

// ---- contact fields ----
test('removing a contact field clears its values and segment filters; a type change clears misfits', async () => {
  const f = await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ label: 'City' }, { label: 'Tier', type: 'select', options: ['gold', 'silver'] }] })
  assert.equal(f.status, 200, f.text)
  const phone = '919811100001'
  assert.equal((await s.api(w.admin, 'POST', '/api/contacts', { phone: `+${phone}`, name: 'Field Person', fields: { city: 'Pune', tier: 'silver' } })).status, 200)
  const seg = await s.api(w.admin, 'POST', '/api/contacts/segments', { name: 'Pune people', filter: { tags: ['vip'], field: { key: 'city', value: 'Pune' } } })
  assert.equal(seg.status, 200, seg.text)
  const usage = await s.api(w.admin, 'GET', '/api/contacts/fields/usage?key=city')
  assert.deepEqual(usage.json, { contacts: 1, segments: [{ id: seg.json.id, name: 'Pune people' }] })
  assert.equal((await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: Array.from({ length: 31 }, (_, i) => ({ label: `F${i}` })) })).status, 400, 'over 30 is refused, not cut')
  const r = await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ key: 'tier', label: 'Tier', type: 'select', options: ['gold'] }] })
  assert.equal(r.status, 200, r.text)
  const c = await s.api(w.admin, 'GET', `/api/contacts/${phone}`)
  assert.deepEqual(c.json.fields, {})
  const segs = (await s.api(w.admin, 'GET', '/api/contacts/segments')).json as { id: string; filter: { field: unknown } }[]
  assert.equal(segs.find((x) => x.id === seg.json.id)?.filter.field, null, 'a segment with another filter keeps it and drops the field (one with none is deleted: settings-qa.e2e.ts)')
  assert.equal((await s.api(w.admin, 'PUT', `/api/contacts/${phone}`, { name: 'Field Person', fields: {} })).status, 200, 'the contact still saves')
  const ev = (await s.api(w.owner, 'GET', '/api/activity?area=settings')).json.events.find((e: { data: { area?: string; removed?: string[] } }) => e.data.area === 'contact_fields' && e.data.removed?.includes('City'))
  assert.ok(ev?.changes?.city, 'the removed field is in the changes')
})

// ---- workspace ----
test('every role learns whether a number is connected; the account list stays the owner’s', async () => {
  const none = await s.seed.workspace({ account: null })
  for (const p of [w.owner, w.admin, w.supervisor, w.agent]) {
    const r = await s.api(p, 'GET', '/api/whatsapp/config')
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.connected, true)
  }
  assert.equal((await s.api(none.agent, 'GET', '/api/whatsapp/config')).json.connected, false)
  assert.equal((await s.api(w.agent, 'GET', '/api/whatsapp/accounts')).status, 403)
  assert.equal((await s.api(w.owner, 'GET', '/api/whatsapp/accounts')).status, 200)
})

test('rename the workspace and hand it over', async () => {
  const v = await s.seed.workspace({ name: 'Handover Shop', account: null })
  assert.equal((await s.api(v.admin, 'PUT', '/api/workspace', { name: 'Nope' })).status, 403)
  const r = await s.api(v.owner, 'PUT', '/api/workspace', { name: 'Renamed Shop' })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.workspace.name, 'Renamed Shop')
  const info = await s.api(v.agent, 'GET', '/api/workspace')
  assert.deepEqual([info.json.id, info.json.name, info.json.ownerId], [v.id, 'Renamed Shop', v.owner.id])
  assert.equal((await s.api(v.owner, 'POST', '/api/workspace/transfer', { userId: v.admin.id, password: 'wrong password', stepDown: true })).status, 400)
  assert.equal((await s.api(v.admin, 'POST', '/api/workspace/transfer', { userId: v.admin.id, password: v.admin.password })).status, 403)
  const t = await s.api(v.owner, 'POST', '/api/workspace/transfer', { userId: v.admin.id, password: v.owner.password, stepDown: true })
  assert.equal(t.status, 200, t.text)
  assert.equal(t.json.role, 'admin')
  assert.equal((await s.api(v.admin, 'GET', '/api/workspace')).json.ownerId, v.admin.id)
  assert.equal((await s.api(v.admin, 'GET', '/api/auth/me')).json.role, 'owner')
  const kinds = await kindsIn(v.id)
  assert.ok(kinds.includes('workspace.renamed') && kinds.includes('workspace.transferred'), kinds.join(','))
})

// ---- You › Security and Notifications ----
test('sessions are listed newest first and can be signed out', async () => {
  const p = await s.seed.person({ name: 'Sam Sessions', role: 'agent', workspaceId: w.id })
  const a = await login(p.email, p.password, 'Laptop/1')
  await new Promise((done) => setTimeout(done, 20))
  const b = await login(p.email, p.password, 'Phone/2')
  const list = await s.api(b, 'GET', '/api/account/sessions')
  assert.equal(list.status, 200, list.text)
  const rows = list.json.sessions as { id: string; userAgent: string | null; current: boolean; lastSeenAt: string }[]
  assert.equal(rows[0].userAgent, 'Phone/2')
  assert.equal(rows[0].current, true)
  assert.ok(rows.every((r, i) => i === 0 || r.lastSeenAt <= rows[i - 1].lastSeenAt), 'newest first')
  const laptop = rows.find((r) => r.userAgent === 'Laptop/1')!
  assert.equal((await s.api(b, 'DELETE', `/api/account/sessions/${laptop.id}`)).status, 200)
  assert.equal((await s.api(a, 'GET', '/api/auth/me')).status, 401)
  const others = await s.api(b, 'POST', '/api/account/sessions/revoke-others')
  assert.equal(others.json.revoked, 1, 'the seeded session')
  assert.equal((await s.api(p, 'GET', '/api/auth/me')).status, 401)
  assert.equal((await s.api(b, 'GET', '/api/auth/me')).status, 200)
  const t = await s.api(b, 'POST', '/api/account/tokens', { name: 'Peek', expiresInDays: 30 })
  assert.equal((await bearer(t.json.token, 'GET', '/api/account/sessions')).status, 403, 'cookie only')
})

test('notification preferences: on by default, partial saves, cookie only', async () => {
  const p = await s.seed.person({ name: 'Nia Notify', role: 'supervisor', workspaceId: w.id })
  const d = await s.api(p, 'GET', '/api/account/notifications')
  assert.deepEqual(d.json, { escalations: true, assigned: true, slaBreach: true, budget: true, digest: true })
  const r = await s.api(p, 'PUT', '/api/account/notifications', { escalations: false })
  assert.equal(r.json.escalations, false)
  assert.equal(r.json.digest, true)
  assert.equal((await s.db.collection('memberships').findOne({ userId: p.id }))?.notify?.escalations, false)
  assert.equal((await s.api(p, 'PUT', '/api/account/notifications', { digest: 'no' })).status, 400)
  const t = await s.api(p, 'POST', '/api/account/tokens', { name: 'Peek', expiresInDays: 30 })
  assert.equal((await bearer(t.json.token, 'GET', '/api/account/notifications')).status, 403)
})

// ---- activity ----
test('the activity CSV says when it was cut off', async () => {
  const v = await s.seed.workspace({ name: 'Busy Shop', account: null })
  const at = new Date()
  await s.db.collection('events').insertMany(Array.from({ length: 10_005 }, (_, i) => ({ workspaceId: v.id, kind: 'ticket.updated', entity: 'ticket', entityId: String(i), data: { number: i }, userId: v.owner.id, at })))
  const r = await s.api(v.owner, 'GET', '/api/activity.csv')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-truncated'), '10005')
  assert.match(r.text.trimEnd().split('\r\n').at(-1)!, /^First 10000 rows of 10005; narrow the dates$/)
  // A day filter is a day in the workspace's time zone (Asia/Kolkata by default): today there includes now.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at)
  const page = await s.api(v.owner, 'GET', `/api/activity?from=${today}&to=${today}`)
  assert.equal(page.json.events.length, 50)
})
