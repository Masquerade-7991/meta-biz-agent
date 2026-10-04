// Run: node --test src/app/whatsapp/signupEvent.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignupEvent } from './signupEvent.ts'

const msg = (event: string, data: object) => JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data })

test('finish, for a new number and for a WhatsApp Business app number', () => {
  assert.deepEqual(parseSignupEvent('https://www.facebook.com', msg('FINISH', { waba_id: '1', phone_number_id: '2', business_id: '3' })), { kind: 'finish', flow: 'new', wabaId: '1', phoneNumberId: '2', businessId: '3' })
  assert.equal((parseSignupEvent('https://business.facebook.com', msg('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', { waba_id: '1', phone_number_id: '2' })) as { flow: string }).flow, 'coexistence')
})

test('cancel and error', () => {
  assert.deepEqual(parseSignupEvent('https://www.facebook.com', msg('CANCEL', { current_step: 'PHONE_NUMBER_VERIFICATION' })), { kind: 'cancel', step: 'PHONE_NUMBER_VERIFICATION' })
  assert.deepEqual(parseSignupEvent('https://www.facebook.com', msg('CANCEL', { error_message: 'Nope', error_code: '42', session_id: 's1' })), { kind: 'error', message: 'Nope', code: '42', sessionId: 's1' })
})

test('ignores other origins and other messages', () => {
  assert.equal(parseSignupEvent('https://evil.example', msg('FINISH', { waba_id: '1' })), null)
  assert.equal(parseSignupEvent('https://facebook.com.evil.example', msg('FINISH', { waba_id: '1' })), null)
  assert.equal(parseSignupEvent('https://www.facebook.com', '{"type":"other"}'), null)
  assert.equal(parseSignupEvent('https://www.facebook.com', 'not json'), null)
})
