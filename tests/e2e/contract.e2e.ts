// Contract: every GET route the spec (docs/openapi.json) describes without path parameters answers
// with a documented status, and a 200 has the documented shape (array, or object with its required
// keys). Run as the owner and as an agent, so role refusals are documented too. The Meta relay
// routes are checked for status only: the fake Meta's answers aren't Meta's shapes.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, startStack, type Stack } from './harness.ts'

type Schema = { type?: string; required?: string[]; $ref?: string; properties?: Record<string, Schema> }
type Op = { parameters?: { name: string; in: string; required?: boolean }[]; responses: Record<string, { content?: Record<string, { schema?: Schema }> }> }
const spec = JSON.parse(readFileSync(path.join(ROOT, 'docs/openapi.json'), 'utf8')) as { paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, Schema> } }
const resolve = (s: Schema | undefined): Schema | undefined => (s?.$ref ? spec.components.schemas[s.$ref.split('/').pop()!] : s)

// Not plain request/response: the event stream never ends, the webhook needs a signed body, the cron a secret.
const SKIP = new Set(['/api/stream', '/api/webhooks/whatsapp', '/api/cron', '/api/docs'])

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('contract')
  w = await s.seed.workspace()
})
after(() => s?.stop())

const routes = Object.entries(spec.paths)
  .filter(([p, ops]) => ops.get && !p.includes('{') && !SKIP.has(p))
  .map(([p, ops]) => [p, ops.get] as const)

test('the spec lists the routes this test covers', () => {
  assert.ok(routes.length >= 50, `only ${routes.length} GET routes`)
})

for (const [p, op] of routes) {
  const required = (op.parameters ?? []).filter((x) => x.in === 'query' && x.required).map((x) => x.name)
  const documented = Object.keys(op.responses).map(Number)
  const value = (n: string) => (n === 'phone' ? w.numbers[0] : n === 'job_id' ? 'job1' : n === 'eval_ids' ? 'e1' : 'x')

  test(`GET ${p}: documented status and shape`, async () => {
    const query = required.length ? '?' + required.map((n) => `${n}=${value(n)}`).join('&') : ''
    const owner = await s.api(w.owner, 'GET', p + query)
    assert.ok(documented.includes(owner.status), `owner got ${owner.status}, spec documents ${documented.join('/')}: ${owner.text.slice(0, 200)}`)
    const agent = await s.api(w.agent, 'GET', p + query)
    assert.ok(documented.includes(agent.status), `agent got ${agent.status}, spec documents ${documented.join('/')}`)
    const anon = await s.api(null, 'GET', p + query)
    assert.ok(documented.includes(anon.status) || anon.status === 401, `anonymous got ${anon.status}`)

    if (owner.status !== 200 || p.startsWith('/api/meta/')) return
    const schema = resolve(op.responses['200']?.content?.['application/json']?.schema)
    if (!schema || owner.json === null) return
    if (schema.type === 'array') assert.ok(Array.isArray(owner.json), `expected an array, got ${owner.text.slice(0, 80)}`)
    if (schema.type === 'object') {
      assert.equal(typeof owner.json, 'object')
      for (const k of schema.required ?? []) assert.ok(k in owner.json, `missing required key "${k}" in ${owner.text.slice(0, 200)}`)
    }
  })
}
