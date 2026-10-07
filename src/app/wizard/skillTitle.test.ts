import assert from 'node:assert/strict'
import test from 'node:test'
import { skillTitle, titleTaken } from './skillTitle.ts'

test('makes a valid Meta title from a readable name', () => {
  assert.equal(skillTitle('Order status'), 'order-status')
  assert.equal(skillTitle('  Book a demo!! '), 'book-a-demo')
  assert.equal(skillTitle('Café & Bar'), 'caf-bar')
})

test('never ends in a hyphen after cutting to 64', () => {
  const t = skillTitle('a'.repeat(63) + ' b')
  assert.equal(t, 'a'.repeat(63))
  assert.ok(t.length <= 64 && !t.endsWith('-'))
})

test('a name with no latin letters or digits gets the fallback', () => {
  assert.equal(skillTitle('ऑर्डर की स्थिति'), 'skill')
  assert.equal(skillTitle('🎉', 'reply-ab12'), 'reply-ab12')
})

test('spots names that reach Meta as the same title', () => {
  assert.ok(titleTaken('Order-Status', ['order status']))
  assert.ok(!titleTaken('Order status', ['Order tracking']))
})
