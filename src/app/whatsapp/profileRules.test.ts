import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationErrors, displayNameError, profileErrors, statusHelp } from './profileRules.ts'

const ok = { about: 'Hi', address: '', description: '', email: '', websites: [], vertical: 'RETAIL' }

test('profile: limits, email, websites and category', () => {
  assert.deepEqual(profileErrors(ok), {})
  assert.ok(profileErrors({ ...ok, about: 'x'.repeat(140) }).about)
  assert.ok(profileErrors({ ...ok, email: 'nope' }).email)
  assert.ok(profileErrors({ ...ok, websites: ['https://a.com', 'https://b.com', 'https://c.com'] }).websites)
  assert.ok(profileErrors({ ...ok, websites: ['example.com'] }).websites)
  assert.deepEqual(profileErrors({ ...ok, websites: ['https://helo.ai', ''] }), {})
  assert.ok(profileErrors({ ...ok, vertical: 'SPACESHIPS' }).vertical)
})

test('display names: length, no links, no shouting or decoration', () => {
  assert.equal(displayNameError('Helo Foods'), null)
  assert.equal(displayNameError('IBM'), null)
  assert.ok(displayNameError('Hi'))
  assert.ok(displayNameError('www.helo.ai'))
  assert.ok(displayNameError('HELO FOODS'))
  assert.ok(displayNameError('Helo!!! Foods'))
})

test('ice breakers and commands', () => {
  assert.equal(automationErrors({ prompts: ['Track my order'], commands: [{ name: 'orders', description: 'See your orders' }] }), null)
  assert.match(automationErrors({ prompts: ['a', 'b', 'c', 'd', 'e'], commands: [] })!, /4 ice breakers/)
  assert.match(automationErrors({ prompts: [], commands: [{ name: 'my orders', description: 'x' }] })!, /no spaces/)
  assert.match(automationErrors({ prompts: [], commands: [{ name: 'orders', description: '' }] })!, /Say what/)
  assert.match(automationErrors({ prompts: [], commands: [{ name: 'a', description: 'x' }, { name: 'A', description: 'y' }] })!, /different/)
})

test('every status has a label and help; unknown ones fall back', () => {
  assert.equal(statusHelp('CONNECTED').tone, 'ok')
  assert.equal(statusHelp('pending').action, 'verify')
  assert.equal(statusHelp('SOMETHING_NEW').label, 'Unknown')
})
