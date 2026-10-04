import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customerKey, customerLabel, isBsuid, parseCustomerKey, sendTarget } from './customer.ts'

test('BSUID format: country code, dot, alphanumerics; parent IDs carry ENT', () => {
  assert.ok(isBsuid('US.13491208655302741918'))
  assert.ok(isBsuid('US.ENT.11815799212886844830'))
  assert.ok(isBsuid('IN.abc123'))
  assert.ok(!isBsuid('919876543210'))
  assert.ok(!isBsuid('us.123'))
  assert.ok(!isBsuid('US.'))
  assert.ok(!isBsuid('US.12 34'))
})

test('a phone number wins over a BSUID; a BSUID alone is the key', () => {
  assert.equal(customerKey('+91 98765 43210', 'IN.777'), '919876543210')
  assert.equal(customerKey(undefined, 'IN.777'), 'IN.777')
  assert.equal(customerKey('', 'not a bsuid'), '')
  assert.equal(customerKey(null, null), '')
})

test('parsing keys from input and URLs', () => {
  assert.equal(parseCustomerKey(' US.123 '), 'US.123')
  assert.equal(parseCustomerKey('+1 (425) 555-0199'), '14255550199')
})

test('sending uses `recipient` for a BSUID and `to` for a number', () => {
  assert.deepEqual(sendTarget('US.123'), { recipient: 'US.123' })
  assert.deepEqual(sendTarget('14255550199'), { to: '14255550199' })
})

test('labels never show a BSUID', () => {
  assert.equal(customerLabel('14255550199'), '+14255550199')
  assert.equal(customerLabel('US.123', 'asha'), '@asha')
  assert.equal(customerLabel('US.123'), 'WhatsApp user (number hidden)')
})
