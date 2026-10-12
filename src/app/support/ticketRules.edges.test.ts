// Run: node --test src/app/support/ticketRules.edges.test.ts
// The edges of the ticket lifecycle: the reopen boundary, odd dates, and paused clocks.
import assert from 'node:assert/strict'
import test from 'node:test'
import { customerWrites, pausedFor, REOPEN_DAYS, shiftDues } from './ticketRules.ts'

const now = Date.parse('2026-10-12T10:00:00Z')
const DAY = 86_400_000

test('the reopen window ends exactly REOPEN_DAYS after resolving', () => {
  const at = (ms: number) => ({ status: 'resolved', resolvedAt: new Date(now - ms) })
  assert.equal(customerWrites(at(REOPEN_DAYS * DAY - 1), 'human', now), 'reopen', 'one millisecond inside')
  assert.equal(customerWrites(at(REOPEN_DAYS * DAY), 'human', now), 'new', 'on the boundary a new ticket starts')
})

test('resolved dates stored as strings work like dates', () => {
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: new Date(now - DAY).toISOString() }, 'human', now), 'reopen')
})

test('a resolved ticket with no resolve time starts a new one rather than reopening', () => {
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: null }, 'human', now), 'new')
  assert.equal(customerWrites({ status: 'resolved' }, 'human', now), 'new')
})

test('a resolve time in the future (clock skew between servers) still reopens, never throws', () => {
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: new Date(now + 60_000) }, 'human', now), 'reopen')
})

test('an unknown or garbage status behaves like no ticket at all', () => {
  assert.equal(customerWrites({ status: 'archived' }, 'human', now), 'new')
  assert.equal(customerWrites({ status: 'archived' }, 'ai', now), 'none')
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: 'not a date' }, 'human', now), 'new')
})

test('waiting on the customer resumes whoever holds the chat', () => {
  assert.equal(customerWrites({ status: 'pending', resolvedAt: new Date(now - 10 * DAY) }, 'ai', now), 'resume')
})

test('pause length handles strings and missing values', () => {
  assert.equal(pausedFor(new Date(now - 90_000).toISOString(), now), 90_000)
  assert.equal(pausedFor(undefined, now), 0)
  assert.equal(pausedFor('', now), 0)
})

test('shifting deadlines keeps both clocks and accepts strings', () => {
  const d = shiftDues({ firstResponseDueAt: '2026-10-12T10:00:00Z', resolveDueAt: '2026-10-13T10:00:00Z' }, 3_600_000)
  assert.equal(d.firstResponseDueAt.toISOString(), '2026-10-12T11:00:00.000Z')
  assert.equal(d.resolveDueAt.toISOString(), '2026-10-13T11:00:00.000Z')
  const same = shiftDues({ firstResponseDueAt: new Date(now), resolveDueAt: new Date(now) }, 0)
  assert.equal(+same.firstResponseDueAt, now)
})

test('a "never" deadline (no business hours) stays a valid far-future date when shifted', { todo: 'QA-14: shiftDues overflows 8.64e15 into Invalid Date; duesFrom caps, shiftDues does not' }, () => {
  const never = new Date(8.64e15)
  const d = shiftDues({ firstResponseDueAt: never, resolveDueAt: never }, 60_000)
  assert.ok(!Number.isNaN(+d.resolveDueAt))
  assert.equal(+d.resolveDueAt, 8.64e15)
})
