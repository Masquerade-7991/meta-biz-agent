import assert from 'node:assert/strict'
import test from 'node:test'
import { addProtected, clearProtected, refusal } from './protect.ts'

const WABA = '106769052057950'
const PHONE = '100563996021650'
const OTHER = '999999999999999'

test.beforeEach(() => {
  clearProtected()
  addProtected(WABA, PHONE)
})

test('refuses anything that changes who gets the business’s webhooks', () => {
  assert.ok(refusal('graph', 'POST', `/${WABA}/subscribed_apps`))
  assert.ok(refusal('graph', 'DELETE', `/${WABA}/subscribed_apps`))
  assert.ok(refusal('graph', 'POST', `/${WABA}/subscribed_apps`, '{"override_callback_uri":"https://x","verify_token":"t"}'))
  assert.ok(refusal('graph', 'POST', `/${PHONE}`, '{"webhook_configuration":{"override_callback_uri":"https://x"}}'))
})

test('refuses registration, PIN, codes, coexistence sync and credit lines on the business’s number', () => {
  for (const action of ['register', 'deregister', 'request_code', 'verify_code', 'smb_app_data'])
    assert.ok(refusal('graph', 'POST', `/${PHONE}/${action}`, '{}'), action)
  assert.ok(refusal('graph', 'POST', `/${PHONE}`, '{"pin":"123456"}'))
  assert.ok(refusal('graph', 'POST', `/1234567/whatsapp_credit_sharing_and_attach?waba_id=${WABA}&waba_currency=USD`))
})

test('still allows reading, agent configuration and normal sending', () => {
  assert.equal(refusal('graph', 'GET', `/${WABA}/subscribed_apps`), null)
  assert.equal(refusal('meta', 'PUT', `/${PHONE}/agent_config/settings`, '{"handoff":{}}'), null)
  assert.equal(refusal('meta', 'POST', `/business/whatsapp/phone_numbers/${PHONE}/thread_control`, '{}'), null)
  assert.equal(refusal('graph', 'POST', `/${PHONE}/messages`, '{"text":{"body":"pin: 1234"}}'), null)
  assert.equal(refusal('graph', 'POST', `/${PHONE}/whatsapp_business_profile`, '{"about":"hi"}'), null)
})

test('other workspaces’ own accounts keep their full controls', () => {
  assert.equal(refusal('graph', 'POST', `/${OTHER}/subscribed_apps`), null)
  assert.equal(refusal('graph', 'POST', `/${OTHER}/register`, '{"pin":"123456"}'), null)
})
