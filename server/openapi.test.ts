// Keeps the API description (server/openapi) honest: every route the server checks for by name is
// documented, every documented route still exists, the document is well-formed, and the committed
// docs/openapi.json is current.
// ponytail: reads route checks out of the source (`path === '/api/…' && m === 'GET'`) instead of a
// route table, so routes matched only by a regex are covered by the "still exists" check alone.
// A real route table would close that gap if routes keep growing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { openapi } from './openapi/index.ts'

const read = (dir: string) =>
  readdirSync(new URL(dir, import.meta.url))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(new URL(dir + f, import.meta.url), 'utf8'))
const source = [...read('./'), ...read('../api/')].join('\n')
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
/** Not API routes: Vercel's own entry point, which every /api request is rewritten to (server/vercel.ts). */
const INTERNAL = new Set(['/api/server'])
/** Documented routes the server matches with a pattern rather than by name, and that pattern. */
const MATCHED_BY = { '/api/meta': '/api/(meta|graph)', '/api/graph': '/api/(meta|graph)' } as Record<string, string>

type Operation = { operationId?: string; summary?: string; tags?: string[]; responses?: Record<string, unknown>; security?: unknown; 'x-meta'?: boolean }
const paths = openapi.paths as unknown as Record<string, Record<string, Operation>>
const operations = Object.entries(paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ path, method, op })))

test('every route the server names is documented', () => {
  const missing: string[] = []
  for (const line of source.split('\n')) {
    for (const [, path] of line.matchAll(/(?:path|pathname|url\.split\('\?'\)\[0\])\s*===\s*'(\/api\/[^']+)'/g)) {
      const method = line.match(/(?:\bm|method)\s*===\s*'([A-Z]+)'/)?.[1]?.toLowerCase()
      if (INTERNAL.has(path)) continue
      const item = paths[path]
      if (!item || (method && !item[method])) missing.push(`${method?.toUpperCase() ?? 'ANY'} ${path}`)
    }
  }
  assert.deepEqual(missing, [], 'Add these to server/openapi/*')
})

test('every documented route still exists', () => {
  const plain = source.replace(/\\\//g, '/')
  const gone = Object.entries(paths)
    .filter(([, item]) => !Object.values(item).every((op) => op['x-meta']))
    .map(([path]) => path.split('{')[0].replace(/\/$/, ''))
    .filter((prefix) => !plain.includes(MATCHED_BY[prefix] ?? prefix))
  assert.deepEqual(gone, [], 'No server code mentions these documented routes any more')
})

test('every operation is complete and unique', () => {
  const ids = new Set<string>()
  for (const { path, method, op } of operations) {
    const where = `${method.toUpperCase()} ${path}`
    assert.ok(METHODS.includes(method as (typeof METHODS)[number]), where)
    assert.ok(op.operationId && !ids.has(op.operationId), `${where}: missing or duplicate operationId`)
    ids.add(op.operationId)
    assert.ok(op.summary && op.tags?.length, `${where}: needs a summary and a tag`)
    assert.ok(Object.keys(op.responses ?? {}).some((s) => s.startsWith('2')), `${where}: needs a success response`)
  }
})

test('every $ref points at something', () => {
  const json = JSON.stringify(openapi)
  const components = openapi.components as unknown as Record<string, Record<string, unknown>>
  for (const [, kind, name] of json.matchAll(/"#\/components\/(\w+)\/(\w+)"/g)) assert.ok(components[kind]?.[name], `#/components/${kind}/${name} is missing`)
})

test('docs/openapi.json is current', () => {
  const committed = readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8')
  assert.equal(committed, JSON.stringify(openapi, null, 2) + '\n', 'Run npm run docs:openapi')
})
