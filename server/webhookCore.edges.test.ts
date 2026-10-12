// Run: node --test server/webhookCore.edges.test.ts
// The webhook receiver's pure parts at the edges: signatures, ordering of statuses, pricing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'
import { chargeOf, deliveryId, replaceable, signedBy } from './webhookCore.ts'

const sign = (body: string | Buffer, secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}')

test('a signature over different bytes (re-serialised JSON, extra space) is refused', () => {
  const pretty = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1))
  assert.equal(signedBy(pretty, sign(body, 's'), ['s']), null)
  assert.equal(signedBy(Buffer.concat([body, Buffer.from(' ')]), sign(body, 's'), ['s']), null)
})

test('malformed headers are refused without throwing', () => {
  for (const h of ['', 'sha256=', 'sha1=' + 'a'.repeat(40), sign(body, 's').toUpperCase(), sign(body, 's') + 'x', 'sha256=' + 'é'.repeat(64)]) assert.equal(signedBy(body, h, ['s']), null, h)
})

test('unicode bodies are signed over their UTF-8 bytes', () => {
  const b = Buffer.from('{"text":"नमस्ते 👋 مرحبا"}')
  assert.equal(signedBy(b, sign(b, 's'), ['s']), 0)
})

test('the delivery id depends on every byte, including whitespace', () => {
  assert.notEqual(deliveryId(Buffer.from('{"a":1}')), deliveryId(Buffer.from('{"a": 1}')))
  assert.match(deliveryId(body), /^[0-9a-f]{64}$/)
})

test('status order: sent can only replace nothing; unknown statuses never apply', () => {
  assert.deepEqual(replaceable('sent'), [null])
  for (const s of ['', 'deleted', 'warning', 'pending', 'READ', 'played']) assert.equal(replaceable(s), null, s)
})

test('status order: read and failed can land on a message that has no status yet', () => {
  assert.ok(replaceable('read')!.includes(null))
  assert.ok(replaceable('failed')!.includes(null))
})

test('pricing: only conversation info, or only pricing, still makes a charge', () => {
  assert.equal(chargeOf({ id: 'w', status: 'sent', conversation: { id: 'c1' } })?.conversationId, 'c1')
  assert.equal(chargeOf({ id: 'w', status: 'sent', pricing: { category: 'utility' } })?.category, 'utility')
})

test('pricing: odd field types become null, never wrong values', () => {
  const c = chargeOf({ id: 'w', status: 'sent', timestamp: 'soon', pricing: { billable: 'true', category: 7, pricing_model: '' }, conversation: { expiration_timestamp: 'x', origin: 'marketing' } })!
  assert.equal(c.billable, null)
  assert.equal(c.category, null)
  assert.equal(c.pricingModel, null)
  assert.equal(c.conversationExpiresAt, null)
  assert.equal(c.conversationOrigin, null)
  assert.ok(Math.abs(+c.at - Date.now()) < 5000, 'an unreadable timestamp means now')
})

test('pricing: arrays and null are not objects', () => {
  assert.equal(chargeOf({ id: 'w', pricing: [], conversation: null }), null)
})
