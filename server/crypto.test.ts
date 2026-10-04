// Run: node --test server/crypto.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { keyFrom, open, seal } from './crypto.ts'

const key = randomBytes(32)

test('round-trips and never stores the plain text', () => {
  const s = seal('EAAG-secret-token', key)
  assert.ok(!s.includes('EAAG'))
  assert.equal(open(s, key), 'EAAG-secret-token')
  assert.notEqual(seal('x', key), seal('x', key)) // fresh IV each time
})

test('rejects tampering and the wrong key', () => {
  const s = seal('token', key)
  const parts = s.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => open(parts.join('.'), key))
  assert.throws(() => open(s, randomBytes(32)))
  assert.throws(() => open('plain', key))
})

test('keys must be 32 bytes of base64', () => {
  assert.equal(keyFrom(''), null)
  assert.equal(keyFrom(Buffer.alloc(16).toString('base64')), null)
  assert.ok(keyFrom(randomBytes(32).toString('base64')))
})
