// Journey: sign up by magic link, log in, roles and what each may do, invites, switching
// workspaces, removal, the last owner, and the raw Meta relay's permissions.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('auth')
  w = await s.seed.workspace()
})
after(() => s?.stop())

const linkToken = (log: string, email: string) => {
  const i = log.lastIndexOf(`[mail → ${email}]`)
  const m = i >= 0 ? log.slice(i).match(/token=([A-Za-z0-9_-]{20,})/) : null
  return m?.[1] ?? null
}
const sidOf = (r: { headers: Headers }) => r.headers.get('set-cookie')?.match(/sid=([^;]*)/)?.[1] ?? ''
const as = (token: string) => ({ token }) as never

test('health is public; everything else needs a session', async () => {
  assert.equal((await s.api(null, 'GET', '/api/health')).status, 200)
  for (const p of ['/api/tickets', '/api/inbox/conversations', '/api/contacts', '/api/activity', '/api/meta/PHONE_NUMBER_ID/agent_config/settings'])
    assert.equal((await s.api(null, 'GET', p)).status, 401, p)
  assert.equal((await s.api(as('not-a-session'), 'GET', '/api/tickets')).status, 401)
})

test('sign up by emailed link, finish setup, log out and log back in', async () => {
  const email = `new.person.${Date.now()}@e2e.test`
  assert.equal((await s.api(null, 'POST', '/api/auth/signup', { email })).status, 200)
  const token = await s.until(() => linkToken(s.log(), email))
  const v = await s.api(null, 'POST', '/api/auth/verify', { token })
  assert.equal(v.status, 200)
  const sid = sidOf(v)
  assert.equal(v.json.me.setup, 'account')
  // An unfinished account can only finish setup.
  assert.equal((await s.api(as(sid), 'GET', '/api/tickets')).status, 403)
  const done = await s.api(as(sid), 'POST', '/api/account/setup', { name: 'Néha 🌟 Shah', password: 'a long password', workspaceName: 'Néha’s shop' })
  assert.equal(done.status, 200, done.text)
  assert.equal(done.json.role, 'owner')
  assert.equal(done.json.user.name, 'Néha 🌟 Shah')
  // The link is single-use.
  assert.equal((await s.api(null, 'POST', '/api/auth/verify', { token })).status, 410)
  assert.equal((await s.api(as(sid), 'POST', '/api/auth/logout')).status, 200)
  assert.equal((await s.api(as(sid), 'GET', '/api/auth/me')).status, 401)
  assert.equal((await s.api(null, 'POST', '/api/auth/login', { email, password: 'wrong password' })).status, 401)
  const login = await s.api(null, 'POST', '/api/auth/login', { email: email.toUpperCase(), password: 'a long password' })
  assert.equal(login.status, 200, 'email is case-insensitive')
})

test('auth routes refuse non-JSON bodies (cross-site form posts)', async () => {
  const r = await s.api(null, 'POST', '/api/auth/login', 'email=a@b.co&password=x', { 'content-type': 'application/x-www-form-urlencoded' })
  assert.equal(r.status, 415)
})

test('what each role may read', async () => {
  const cases: [string, string, Record<string, number>][] = [
    ['GET', '/api/reports', { owner: 200, admin: 200, supervisor: 200, agent: 403 }],
    ['GET', '/api/analytics/overview', { owner: 200, admin: 200, supervisor: 200, agent: 403 }],
    ['GET', '/api/activity', { owner: 200, admin: 200, supervisor: 403, agent: 403 }],
    ['GET', '/api/whatsapp/webhook-status', { owner: 200, admin: 403, supervisor: 403, agent: 403 }],
    ['GET', '/api/tickets', { owner: 200, admin: 200, supervisor: 200, agent: 200 }],
  ]
  for (const [m, p, want] of cases)
    for (const role of ['owner', 'admin', 'supervisor', 'agent'] as const) {
      const r = await s.api(w[role], m, p)
      assert.equal(r.status, want[role], `${role} ${m} ${p}: ${r.text.slice(0, 200)}`)
    }
})

test('what each role may change', async () => {
  // Inviting: admins and owners; admins never as owner.
  assert.equal((await s.api(w.agent, 'POST', '/api/workspace/invites', { email: 'x1@e2e.test', role: 'agent' })).status, 403)
  assert.equal((await s.api(w.supervisor, 'POST', '/api/workspace/invites', { email: 'x2@e2e.test', role: 'agent' })).status, 403)
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email: 'x3@e2e.test', role: 'owner' })).status, 403)
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email: 'x4@e2e.test', role: 'admin' })).status, 200)
  assert.equal((await s.api(w.admin, 'POST', '/api/workspace/invites', { email: 'x4@e2e.test', role: 'admin' })).status, 409, 'invited twice')
  // Role changes: admins can't touch owners.
  assert.equal((await s.api(w.admin, 'PUT', `/api/workspace/members/${w.owner.id}`, { role: 'agent' })).status, 403)
  assert.equal((await s.api(w.admin, 'PUT', `/api/workspace/members/${w.agent.id}`, { role: 'supervisor' })).status, 200)
  assert.equal((await s.api(w.admin, 'PUT', `/api/workspace/members/${w.agent.id}`, { role: 'agent' })).status, 200)
  // The AI agent's setup: admins and owners write, everyone reads.
  assert.equal((await s.api(w.supervisor, 'PUT', '/api/meta/PHONE_NUMBER_ID/agent_config/settings', { tone: 'x' })).status, 403)
  assert.equal((await s.api(w.agent, 'GET', '/api/meta/PHONE_NUMBER_ID/agent_config/settings')).status, 200)
  // Support settings: admins and owners.
  assert.equal((await s.api(w.supervisor, 'PUT', '/api/support/escalation', { enabled: true, levels: {} })).status, 403)
})

test('the last owner can neither leave nor be demoted', async () => {
  assert.equal((await s.api(w.owner, 'POST', '/api/workspace/leave')).status, 400)
  assert.equal((await s.api(w.owner, 'PUT', `/api/workspace/members/${w.owner.id}`, { role: 'admin' })).status, 400)
  assert.equal((await s.api(w.owner, 'DELETE', `/api/workspace/members/${w.owner.id}`)).status, 400)
})

test('an existing account answers an invite in the app, signed in as the invited email', async () => {
  const other = await s.seed.workspace({ name: 'Other workspace', account: null })
  const r = await s.api(w.owner, 'POST', '/api/workspace/invites', { email: other.agent.email, role: 'supervisor' })
  assert.equal(r.status, 200, r.text)
  const me = await s.api(other.agent, 'GET', '/api/auth/me')
  const inv = me.json.invites.find((i: { workspaceName: string }) => i.workspaceName === 'E2E Store')
  assert.ok(inv, 'the invite is listed for the invited person')
  // Someone else can't answer it.
  assert.equal((await s.api(other.owner, 'POST', `/api/account/invites/${inv.id}/accept`)).status, 410)
  const ok = await s.api(other.agent, 'POST', `/api/account/invites/${inv.id}/accept`)
  assert.equal(ok.status, 200)
  assert.equal(ok.json.workspace.name, 'E2E Store')
  assert.equal(ok.json.role, 'supervisor')
  assert.equal(ok.json.workspaces.length, 2)
  // Switching back and forth is per session.
  assert.equal((await s.api(other.agent, 'POST', '/api/account/workspace', { workspaceId: other.id })).json.workspace.name, 'Other workspace')
  assert.equal((await s.api(other.agent, 'POST', '/api/account/workspace', { workspaceId: 'not-mine' })).status, 404)
  // Removed from E2E Store: their other workspace stays.
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/members/${other.agent.id}`)).status, 200)
  const after = await s.api(other.agent, 'GET', '/api/auth/me')
  assert.equal(after.json.workspaces.length, 1)
})

test('someone removed from their only workspace loses access at once', async () => {
  const p = await s.seed.person({ name: 'Temp Agent', role: 'agent', workspaceId: w.id })
  assert.equal((await s.api(p, 'GET', '/api/tickets')).status, 200)
  assert.equal((await s.api(w.owner, 'DELETE', `/api/workspace/members/${p.id}`)).status, 200)
  assert.equal((await s.api(p, 'GET', '/api/tickets')).status, 403)
})

test('a role named after an Object property is refused', async () => {
  const p = await s.seed.person({ name: 'Proto Agent', role: 'agent', workspaceId: w.id })
  const r = await s.api(w.owner, 'PUT', `/api/workspace/members/${p.id}`, { role: 'toString' })
  assert.equal(r.status, 400, r.text)
})

test('the raw Graph relay can’t do what the WhatsApp settings reserve for owners', async () => {
  const before = s.fake.calls.length
  const r = await s.api(w.admin, 'POST', `/api/graph/WABA_ID/subscribed_apps`, { override_callback_uri: 'https://attacker.example/hook', verify_token: 'x' })
  assert.equal(r.status, 403, r.text)
  assert.equal(s.fake.calls.length, before, 'nothing reached Meta')
})

test('two owners demoting each other at the same moment never leave the workspace without an owner', async () => {
  for (let round = 0; round < 5; round++) {
    const w2 = await s.seed.workspace({ name: `Race ${round}`, account: null })
    const b = await s.seed.person({ name: 'Second Owner', role: 'owner', workspaceId: w2.id })
    const [x, y] = await Promise.all([
      s.api(w2.owner, 'PUT', `/api/workspace/members/${b.id}`, { role: 'admin' }),
      s.api(b as never, 'PUT', `/api/workspace/members/${w2.owner.id}`, { role: 'admin' }),
    ])
    const owners = await s.db.collection('memberships').countDocuments({ workspaceId: w2.id, role: 'owner' })
    assert.ok(owners >= 1, `round ${round}: ${x.status}/${y.status} left ${owners} owners`)
    assert.ok([x.status, y.status].every((st) => st === 200 || st === 400 || st === 409), `${x.status} ${y.status}`)
  }
})
