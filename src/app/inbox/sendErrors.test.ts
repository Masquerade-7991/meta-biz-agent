import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reasonOf } from './sendErrors.ts'

test('Meta codes map to reasons; unknown or missing codes are "other"', () => {
  assert.equal(reasonOf(131049), 'marketing_limit')
  assert.equal(reasonOf(131050), 'stopped_marketing')
  assert.equal(reasonOf(132015), 'template_problem')
  assert.equal(reasonOf(130429), 'too_fast')
  assert.equal(reasonOf(999999), 'other')
  assert.equal(reasonOf(undefined), 'other')
  assert.equal(reasonOf('131049'), 'other')
})
