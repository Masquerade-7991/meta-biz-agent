import assert from 'node:assert/strict'
import test from 'node:test'
import { customerWrites, pausedFor, shiftDues } from './ticketRules.ts'

const now = Date.parse('2026-10-12T10:00:00Z')
const daysAgo = (d: number) => new Date(now - d * 86_400_000)

test('a customer writing moves their ticket the way people expect', () => {
  assert.equal(customerWrites({ status: 'pending' }, 'ai', now), 'resume')
  assert.equal(customerWrites({ status: 'pending' }, 'human', now), 'resume')
  assert.equal(customerWrites({ status: 'open' }, 'human', now), 'none')
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: daysAgo(1) }, 'ai', now), 'none', 'the AI agent answers')
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: daysAgo(1) }, 'human', now), 'reopen')
  assert.equal(customerWrites({ status: 'resolved', resolvedAt: daysAgo(4) }, 'human', now), 'new')
  assert.equal(customerWrites(null, 'human', now), 'new')
  assert.equal(customerWrites(null, 'ai', now), 'none')
})

test('waiting on the customer pushes the deadlines back by exactly that long', () => {
  const t = { firstResponseDueAt: new Date(now + 60_000), resolveDueAt: new Date(now + 3_600_000) }
  const waited = pausedFor(new Date(now - 30 * 60_000), now)
  assert.equal(waited, 30 * 60_000)
  const d = shiftDues(t, waited)
  assert.equal(+d.firstResponseDueAt, now + 31 * 60_000)
  assert.equal(+d.resolveDueAt, now + 90 * 60_000)
  assert.equal(pausedFor(null, now), 0)
  assert.equal(pausedFor(new Date(now + 5000), now), 0, 'a clock never runs backwards')
})
