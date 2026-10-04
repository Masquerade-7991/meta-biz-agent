import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reasonOf, retryAt } from './sendErrors.ts'

test('Meta codes map to reasons; unknown or missing codes are "other"', () => {
  assert.equal(reasonOf(131049), 'marketing_limit')
  assert.equal(reasonOf(131050), 'stopped_marketing')
  assert.equal(reasonOf(132015), 'template_problem')
  assert.equal(reasonOf(130429), 'too_fast')
  assert.equal(reasonOf(999999), 'other')
  assert.equal(reasonOf(undefined), 'other')
  assert.equal(reasonOf('131049'), 'other')
})

test('the daily marketing cap retries a day later, at most twice', () => {
  const now = 1_000_000
  assert.equal(retryAt('marketing_limit', 0, now)?.getTime(), now + 86_400_000)
  assert.ok(retryAt('marketing_limit', 1, now))
  assert.equal(retryAt('marketing_limit', 2, now), null)
})

test('permanent failures never retry', () => {
  assert.equal(retryAt('stopped_marketing', 0), null)
  assert.equal(retryAt('template_problem', 0), null)
  assert.equal(retryAt('other', 0), null)
})
