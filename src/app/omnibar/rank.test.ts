// Run: node --test src/app/omnibar/rank.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesText, rank, score } from './rank.ts'

const rows = [
  { label: 'Routing rules', keywords: 'assign' },
  { label: 'Members', hint: 'Settings', keywords: 'people invite' },
  { label: 'Canned responses' },
  { label: 'Escalation', keywords: 'sla' },
  { label: 'Hours & targets', keywords: 'sla time zone' },
]

test('a label that starts with the query beats a word inside one, which beats keywords', () => {
  assert.deepEqual(rank(rows, 'r', 5).map((r) => r.label), ['Routing rules', 'Canned responses', 'Members', 'Hours & targets'])
  assert.ok(score(rows[2], 'resp') > score(rows[1], 'invite'))
})

test('every word must match; case and accents are ignored', () => {
  assert.deepEqual(rank(rows, 'time zone', 5).map((r) => r.label), ['Hours & targets'])
  assert.deepEqual(rank(rows, 'ZONE time', 5).map((r) => r.label), ['Hours & targets'])
  assert.deepEqual(rank([{ label: 'Café menu' }], 'cafe', 5).length, 1)
  assert.deepEqual(rank(rows, 'nothing here', 5), [])
})

test('equal scores keep their order; nothing typed keeps everything; the limit holds', () => {
  assert.deepEqual(rank(rows, 'sla', 5).map((r) => r.label), ['Escalation', 'Hours & targets'])
  assert.equal(rank(rows, '  ', 3).length, 3)
  assert.equal(rank(rows, '', 10)[0].label, 'Routing rules')
})

test('matchesText checks every word across the fields, ignoring empty ones', () => {
  assert.ok(matchesText('asha 98', 'Asha', null, '+91 98'))
  assert.ok(!matchesText('asha bot', 'Asha', undefined))
  assert.ok(matchesText('', 'anything'))
})

test('the hint is shown, not searched', () => {
  assert.equal(score({ label: 'Response targets', hint: 'Hours & targets' }, 'hours'), 0)
})
