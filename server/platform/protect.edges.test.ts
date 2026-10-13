// Run: node --test server/protect.edges.test.ts
// Ways a call could still rewire the business's own WhatsApp account past refusal().
import assert from 'node:assert/strict'
import test from 'node:test'
import { addProtected, clearProtected, isProtected, refusal } from './protect.ts'

const WABA = '106769052057950'
const PHONE = '100563996021650'

test.beforeEach(() => {
  clearProtected()
  addProtected(WABA, PHONE)
})

test('only numeric ids are protected; blanks, undefined and words are ignored', () => {
  clearProtected()
  addProtected(undefined, null, '', 'WABA_ID', ' 123 ', WABA)
  assert.ok(isProtected(WABA))
  assert.ok(!isProtected('WABA_ID'))
  assert.ok(!isProtected(''))
  assert.ok(!isProtected(null))
})

test('every writing method is checked, not only POST', () => {
  for (const m of ['POST', 'DELETE', 'PUT', 'PATCH', 'post']) assert.ok(refusal('graph', m, `/${WABA}/subscribed_apps`), m)
})

test('a protected id in the query string (waba_id) is enough', () => {
  assert.ok(refusal('graph', 'POST', `/123456789/whatsapp_credit_sharing_and_attach?waba_currency=USD&waba_id=${WABA}`))
})

test('the PIN field with spacing or in the query is refused', () => {
  assert.ok(refusal('graph', 'POST', `/${PHONE}`, '{ "pin" : "123456" }'))
  assert.ok(refusal('graph', 'POST', `/${PHONE}/register?pin=123456`))
})

test('a protected id named in the body (waba_id) is refused too', () => {
  assert.ok(refusal('graph', 'POST', '/123456789/whatsapp_credit_sharing_and_attach', `{"waba_id":"${WABA}","waba_currency":"USD"}`))
})

test('a form-encoded PIN body is refused like a JSON one', () => {
  assert.ok(refusal('graph', 'POST', `/${PHONE}`, 'pin=123456'))
})

test('a Graph batch request naming the protected account is refused', () => {
  const batch = JSON.stringify({ batch: [{ method: 'POST', relative_url: `${WABA}/subscribed_apps` }] })
  assert.ok(refusal('graph', 'POST', '/', batch))
})

test('the edge name is matched whatever its case', () => {
  assert.ok(refusal('graph', 'POST', `/${WABA}/Subscribed_Apps`))
})

test('agent (api.facebook.com) calls are never refused, even writes on the protected number', () => {
  assert.equal(refusal('meta', 'DELETE', `/${PHONE}/delete_agent`), null)
})
