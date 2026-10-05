import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActionValue, ConnectionAction } from './types.ts'
import { coerce, previewRequest, runInput, splitToolName, toolBody, toolToAction, valueProblems, type MetaTool } from './toolRequest.ts'

const v = (o: Partial<ActionValue>): ActionValue => ({ id: o.name ?? 'v', name: 'v', type: 'text', required: false, location: 'body', source: 'conversation', description: '', ...o })
const tool = (o: Partial<ConnectionAction>): ConnectionAction => ({ id: 't', connectionId: 'c', name: 'search_products', description: 'd', method: 'POST', path: '/graphql.json', values: [], createdAt: 0, ...o })

test('body values: required goes in body.required, never on the value (Meta rejects it there)', () => {
  const b = toolBody(tool({ values: [v({ name: 'query', required: true }), v({ name: 'cursor' })] })).request_definition.body!
  assert.deepEqual(b.required, ['query'])
  assert.equal('required' in b.params.query, false)
})

test('reading a tool back keeps body Required, sources and types', () => {
  const meta: MetaTool = {
    id: '9',
    name: 'search_products',
    description: 'd',
    request_definition: {
      method: 'POST',
      path: '/orders/{id}',
      path_parameters: { id: { type: 'string', required: true } },
      query_parameters: { limit: { type: 'integer', binding: { kind: 'default', value: '3' } } },
      body: { content_type: 'application/json', params: { query: { type: 'string' }, filter: { type: 'object', properties: {} } }, required: ['query'] },
    },
  }
  const a = toolToAction(meta, 'c', false)
  const by = Object.fromEntries(a.values.map((x) => [x.name, x]))
  assert.equal(by.query.required, true)
  assert.equal(by.limit.source, 'fixed')
  assert.equal(by.limit.type, 'integer')
  assert.ok(by.filter.raw, 'objects are kept as Meta sent them')
  // and they go back unchanged
  assert.deepEqual(toolBody(a).request_definition.body!.params.filter, { type: 'object', properties: {} })
})

test('Required survives a round trip for every source (Meta marks fixed values required too)', () => {
  const meta: MetaTool = { id: '1', name: 's', description: 'd', request_definition: { method: 'POST', path: '/g', body: { content_type: 'application/json', params: { query: { type: 'string', binding: { kind: 'default', value: '{ x }' } } }, required: ['query'] } } }
  assert.deepEqual(toolBody(toolToAction(meta, 'c', false)).request_definition.body!.required, ['query'])
})

test('GET never sends body values', () => {
  assert.equal(toolBody(tool({ method: 'GET', values: [v({ name: 'q' })] })).request_definition.body, null)
})

test('value names must be unique across every place, and present', () => {
  const p = valueProblems(tool({ values: [v({ id: 'a', name: 'id', location: 'query' }), v({ id: 'b', name: 'id', location: 'body' }), v({ id: 'c', name: ' ' })] }))
  assert.ok(p.b && !p.a)
  assert.ok(p.c)
  assert.ok(valueProblems(tool({ method: 'GET', values: [v({ name: 'q' })] }))[''])
})

test('test inputs are typed before they reach Meta', () => {
  assert.equal(coerce('integer', '3'), 3)
  assert.equal(coerce('integer', '3.5'), undefined)
  assert.equal(coerce('boolean', 'Yes'), true)
  const { input, errors } = runInput(tool({ values: [v({ id: 'n', name: 'n', type: 'integer', required: true }), v({ id: 'f', name: 'f', source: 'fixed' })] }), { n: '7' })
  assert.deepEqual(input, { n: 7 })
  assert.deepEqual(errors, {})
  assert.ok(runInput(tool({ values: [v({ id: 'n', name: 'n', required: true })] }), {}).errors.n)
})

test('preview shows the request the way it is sent', () => {
  const p = previewRequest(
    'https://shop.example.com/admin/api/2026-10/',
    [{ location: 'header', fieldName: 'X-Shopify-Access-Token', prefix: '', hint: '86a5' }],
    tool({ path: '/graphql.json', values: [v({ name: 'query', source: 'fixed', fixedValue: '{ products }' })] }),
  )
  assert.equal(p.url, 'https://shop.example.com/admin/api/2026-10/graphql.json')
  assert.deepEqual(p.headers[0], ['X-Shopify-Access-Token', '••••86a5'])
  assert.deepEqual(JSON.parse(p.body!), { query: '{ products }' })
  const q = previewRequest('https://x.io', [], tool({ method: 'GET', path: '/orders/{id}', values: [v({ id: 'id', name: 'id', location: 'path', description: 'order number' }), v({ name: 'limit', location: 'query', source: 'fixed', fixedValue: '3' })] }), { id: '42' })
  assert.equal(q.url, 'https://x.io/orders/42?limit=3')
  assert.equal(q.body, null)
})

test("Meta's called-tool names split back into connection and tool", () => {
  assert.deepEqual(splitToolName('integration_126711280073588_Shopify_store__Search_products'), { connector: 'Shopify_store', tool: 'Search_products' })
  assert.deepEqual(splitToolName('lookup'), { connector: null, tool: 'lookup' })
})
