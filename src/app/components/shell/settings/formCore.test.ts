// Run: node --test src/app/components/shell/settings/formCore.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { dropped, enqueue, isConflict, landed, lastChanged, NO_STAMP, same, shown, stampOf, type Chain } from './formCore.ts'

test('a change is a change of value, not of key order or undefined keys', () => {
  assert.ok(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }))
  assert.ok(same({ a: 1, x: undefined }, { a: 1 }))
  assert.ok(!same({ a: 1 }, { a: 2 }))
  assert.ok(!same([1, 2], [2, 1]))
  assert.ok(!same({ a: null }, { a: 0 }))
  assert.ok(!same([], {}))
})

test('dirty, then discard: editing back to the saved value is clean again', () => {
  const saved = { name: 'Riya', hours: { mon: null } }
  let draft = { ...saved, name: 'Riya M' }
  assert.ok(!same(draft, saved))
  draft = { ...draft, name: 'Riya' }
  assert.ok(same(draft, saved))
})

test('a 409 is a conflict; other failures are not', () => {
  assert.ok(isConflict({ status: 409 }))
  assert.ok(!isConflict({ status: 400 }))
  assert.ok(!isConflict(new Error('x')))
  assert.ok(!isConflict(null))
})

test('stamps come from the server answer and read as a sentence', () => {
  const now = Date.parse('2026-10-22T12:00:00Z')
  assert.deepEqual(stampOf({ updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Riya' }), { updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Riya' })
  assert.deepEqual(stampOf([1, 2]), NO_STAMP)
  assert.equal(lastChanged({ updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Riya' }, now), 'Last changed by Riya, 2 hours ago')
  assert.equal(lastChanged({ updatedAt: '2026-10-22T11:59:50Z', updatedBy: null }, now), 'Last changed, just now')
  assert.equal(lastChanged(NO_STAMP, now), null)
  assert.equal(lastChanged({ updatedAt: 'nope', updatedBy: 'x' }, now), null)
})

test('chained saves: a failed change drops alone and never undoes a newer one', () => {
  let c: Chain<string[]> = { confirmed: ['a', 'b'], stamp: NO_STAMP, pending: [] }
  c = enqueue(c, { id: 1, apply: (v) => v.filter((x) => x !== 'a') })
  c = enqueue(c, { id: 2, apply: (v) => [...v, 'c'] })
  assert.deepEqual(shown(c), ['b', 'c'])
  // The first (delete a) fails: only it is undone; adding c still shows and still goes.
  c = dropped(c)
  assert.deepEqual(shown(c), ['a', 'b', 'c'])
  assert.equal(c.pending[0].id, 2)
  // The server accepts the second, built on what it last confirmed.
  c = landed(c, c.pending[0].apply(c.confirmed), { updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'You' })
  assert.deepEqual(shown(c), ['a', 'b', 'c'])
  assert.equal(c.pending.length, 0)
  assert.equal(c.stamp.updatedBy, 'You')
})

test('chained saves keep their order: each is built on the answer to the one before', () => {
  let c: Chain<number[]> = { confirmed: [1, 2, 3], stamp: NO_STAMP, pending: [] }
  c = enqueue(c, { id: 1, apply: (v) => [v[1], v[0], ...v.slice(2)] })
  c = enqueue(c, { id: 2, apply: (v) => v.map((x) => (x === 3 ? 30 : x)) })
  const first = c.pending[0].apply(c.confirmed)
  c = landed(c, first, NO_STAMP)
  assert.deepEqual(c.pending[0].apply(c.confirmed), [2, 1, 30])
})
