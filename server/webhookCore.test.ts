import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'
import { chargeOf, deliveryId, replaceable, signedBy } from './webhookCore.ts'

const sign = (body: string, secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

test('accepts an event signed by any configured app, and says which', () => {
  const body = Buffer.from('{"entry":[]}')
  assert.equal(signedBy(body, sign('{"entry":[]}', 'second'), ['first', 'second']), 1)
  assert.equal(signedBy(body, sign('{"entry":[]}', 'first'), ['first', 'second']), 0)
  assert.equal(signedBy(body, sign('{"entry":[]}', 'stranger'), ['first', 'second']), null)
  assert.equal(signedBy(body, undefined, ['first']), null)
  assert.equal(signedBy(body, sign('{"entry":[]}', 'first'), []), null)
})

test('a retried delivery has the same id', () => {
  assert.equal(deliveryId(Buffer.from('a')), deliveryId(Buffer.from('a')))
  assert.notEqual(deliveryId(Buffer.from('a')), deliveryId(Buffer.from('b')))
})

test('statuses only move forward, and failed is final', () => {
  assert.deepEqual(replaceable('delivered'), [null, 'sent'])
  assert.deepEqual(replaceable('read'), [null, 'sent', 'delivered'])
  assert.ok(!replaceable('delivered')!.includes('read'))
  assert.ok(replaceable('failed')!.includes('read'))
  assert.equal(replaceable('deleted'), null)
})

test('reads what a status says the message cost', () => {
  const c = chargeOf({
    id: 'wamid.1',
    recipient_id: '919876543210',
    status: 'sent',
    timestamp: '1791400000',
    pricing: { billable: true, pricing_model: 'PMP', category: 'marketing', type: 'regular' },
    conversation: { id: 'conv1', origin: { type: 'marketing' }, expiration_timestamp: '1791486400' },
  })!
  assert.equal(c.billable, true)
  assert.equal(c.category, 'marketing')
  assert.equal(c.pricingModel, 'PMP')
  assert.equal(c.conversationOrigin, 'marketing')
  assert.equal(c.at.toISOString(), new Date(1791400000 * 1000).toISOString())
  assert.equal(chargeOf({ id: 'wamid.2', status: 'read' }), null)
})
