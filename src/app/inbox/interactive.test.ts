import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interactiveError, interactivePayload, interactiveText } from './interactive.ts'

test('buttons: 1 to 3 distinct labels of up to 20 characters', () => {
  assert.equal(interactiveError({ type: 'button', body: 'Pick one', buttons: ['Yes', 'No'] }), null)
  assert.match(interactiveError({ type: 'button', body: 'Pick', buttons: ['a', 'b', 'c', 'd'] })!, /3 buttons/)
  assert.match(interactiveError({ type: 'button', body: 'Pick', buttons: ['x'.repeat(21)] })!, /20 characters/)
  assert.match(interactiveError({ type: 'button', body: 'Pick', buttons: ['Yes', 'yes'] })!, /different/)
  assert.match(interactiveError({ type: 'button', body: ' ', buttons: ['Yes'] })!, /Write/)
})

test('lists: a button label and 1 to 10 options', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ title: `Option ${i}` }))
  assert.match(interactiveError({ type: 'list', body: 'Pick', button: 'Choose', rows })!, /10 options/)
  assert.equal(interactiveError({ type: 'list', body: 'Pick', button: 'Choose', rows: rows.slice(0, 3) }), null)
  assert.match(interactiveError({ type: 'list', body: 'Pick', button: '', rows: rows.slice(0, 3) })!, /Name the button/)
})

test('payloads drop empty entries and number the ids', () => {
  const p = interactivePayload({ type: 'button', body: ' Hi ', buttons: ['Yes', ' ', 'No'] })
  assert.deepEqual(p.action, { buttons: [{ type: 'reply', reply: { id: 'btn_1', title: 'Yes' } }, { type: 'reply', reply: { id: 'btn_2', title: 'No' } }] })
  assert.equal(interactiveText({ type: 'button', body: 'Hi', buttons: ['Yes', 'No'] }), 'Hi [Yes · No]')
})
