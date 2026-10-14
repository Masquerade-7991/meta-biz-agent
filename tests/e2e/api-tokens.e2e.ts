// Journey: API tokens (Authorization: Bearer hk_…) and CORS for the docs site's "Try it": create, call
// from another origin, the owner's current role applies, account changes refused, revoke, leaving.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('tokens')
  w = await s.seed.workspace()
})
after(() => s?.stop())

const DOCS = 'https://helo-docs.vercel.app'
/** A request the way the docs site's browser sends it: no cookie, a Bearer token, another origin. */
const bearer = (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${s.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin: DOCS, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function create(who: typeof w.owner, name: string) {
  const r = await s.api(who, 'POST', '/api/account/tokens', { name, expiresInDays: 30 })
  assert.equal(r.status, 200, r.text)
  assert.match(r.json.token, /^hk_/)
  return r.json as { id: string; token: string; prefix: string }
}

test('preflight from the docs site is answered; other origins get no CORS headers', async () => {
  const ok = await fetch(`${s.base}/api/tickets`, { method: 'OPTIONS', headers: { origin: DOCS, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })
  assert.equal(ok.status, 204)
  assert.equal(ok.headers.get('access-control-allow-origin'), DOCS)
  assert.match(ok.headers.get('access-control-allow-headers') ?? '', /authorization/)
  assert.equal(ok.headers.get('access-control-allow-credentials'), null, 'cookies never cross origins')
  const other = await fetch(`${s.base}/api/tickets`, { headers: { origin: 'https://attacker.example' } })
  assert.equal(other.headers.get('access-control-allow-origin'), null)
})

test('a token reads like its owner, from another origin', async () => {
  const t = await create(w.agent, 'Docs try it')
  const r = await bearer(t.token, 'GET', '/api/tickets')
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal(r.headers.get('access-control-allow-origin'), DOCS)
  assert.ok(r.headers.get('access-control-expose-headers')?.includes('x-trace-id'))
  // The owner's role applies: an agent can't read reports.
  assert.equal((await bearer(t.token, 'GET', '/api/reports')).status, 403)
  // Listed without the secret.
  const list = await s.api(w.agent, 'GET', '/api/account/tokens')
  assert.equal(list.json.tokens.length, 1)
  assert.equal(list.json.tokens[0].token, undefined)
  assert.equal(list.json.tokens[0].prefix, t.prefix)
})

test('a role change applies to the token at once', async () => {
  const p = await s.seed.person({ name: 'Promoted Agent', role: 'agent', workspaceId: w.id })
  const t = await create(p, 'Reports')
  assert.equal((await bearer(t.token, 'GET', '/api/reports')).status, 403)
  assert.equal((await s.api(w.owner, 'PUT', `/api/workspace/members/${p.id}`, { role: 'supervisor' })).status, 200)
  assert.equal((await bearer(t.token, 'GET', '/api/reports')).status, 200)
})

test('a token can’t change the account, its workspace or tokens', async () => {
  const t = await create(w.admin, 'Limited')
  assert.equal((await bearer(t.token, 'GET', '/api/auth/me')).status, 200)
  for (const [m, p, body] of [
    ['POST', '/api/account/tokens', { name: 'more' }],
    ['DELETE', `/api/account/tokens/${t.id}`, undefined],
    ['POST', '/api/account/password', { currentPassword: 'x', newPassword: 'y'.repeat(10) }],
    ['POST', '/api/workspace', { name: 'Mine now' }],
    ['POST', '/api/auth/logout', undefined],
  ] as const) {
    const r = await bearer(t.token, m, p, body)
    assert.equal(r.status, 403, `${m} ${p}`)
  }
})

test('revoked, wrong and orphaned tokens get 401', async () => {
  assert.equal((await bearer('hk_not-a-real-token', 'GET', '/api/tickets')).status, 401)
  const t = await create(w.supervisor, 'Short lived')
  assert.equal((await s.api(w.supervisor, 'DELETE', `/api/account/tokens/${t.id}`)).status, 200)
  const r = await bearer(t.token, 'GET', '/api/tickets')
  assert.equal(r.status, 401)
  assert.equal((await r.json()).title, 'Invalid API token')

  const p = await s.seed.person({ name: 'Leaving Agent', role: 'agent', workspaceId: w.id })
  const t2 = await create(p, 'Gone')
  assert.equal((await s.api(w.owner, 'DELETE', `/api/workspace/members/${p.id}`)).status, 200)
  assert.equal((await bearer(t2.token, 'GET', '/api/tickets')).status, 401)
  assert.equal(await s.db.collection('api_tokens').countDocuments({ userId: p.id }), 0, 'removed with the member')
})

test('admins see and revoke everyone’s tokens; agents can’t', async () => {
  const t = await create(w.agent, 'Seen by admin')
  assert.equal((await s.api(w.agent, 'GET', '/api/workspace/tokens')).status, 403)
  const all = await s.api(w.admin, 'GET', '/api/workspace/tokens')
  assert.equal(all.status, 200)
  assert.ok(all.json.tokens.some((x: { id: string; ownerName: string }) => x.id === t.id && x.ownerName === 'Ajay Agent'))
  assert.equal((await s.api(w.admin, 'DELETE', `/api/workspace/tokens/${t.id}`)).status, 200)
  assert.equal((await bearer(t.token, 'GET', '/api/tickets')).status, 401)
})
