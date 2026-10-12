// Run: node --test src/app/whatsapp/signupEvent.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignupEvent, signupMessage } from './signupEvent.ts'

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

test('an ERROR event, and an account with no number', () => {
  assert.deepEqual(parseSignupEvent('https://www.facebook.com', msg('ERROR', { error_message: 'Business locked', error_code: '7', session_id: 's2' })), { kind: 'error', message: 'Business locked', code: '7', sessionId: 's2' })
  assert.equal((parseSignupEvent('https://www.facebook.com', msg('ERROR', {})) as { message: string }).message, 'Something went wrong in Meta’s signup.')
  assert.deepEqual(parseSignupEvent('https://www.facebook.com', msg('FINISH_ONLY_WABA', { waba_id: '1', business_id: '3' })), { kind: 'finish', flow: 'new', wabaId: '1', phoneNumberId: '', businessId: '3' })
})

test('leaving or an error reads in plain words', () => {
  assert.equal(signupMessage({ kind: 'cancel', step: 'PHONE_NUMBER_VERIFICATION' }), 'You left Meta’s signup while verifying the phone number. Nothing was connected.')
  assert.equal(signupMessage({ kind: 'cancel', step: 'SOME_NEW_STEP' }), 'You left Meta’s signup while some new step. Nothing was connected.')
  assert.equal(signupMessage({ kind: 'cancel', step: '' }), 'You left Meta’s signup. Nothing was connected.')
  assert.equal(signupMessage({ kind: 'error', message: 'Locked', code: '1', sessionId: 's9' }), 'Meta stopped the signup: Locked (reference s9)')
})
