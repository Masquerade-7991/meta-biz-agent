import assert from 'node:assert/strict'
import test from 'node:test'
import { assetMap, hostedLinks } from './signupLink.ts'

const LINK = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=123&config_id=456&extras=${encodeURIComponent(JSON.stringify({ featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4', features: [] }))}`
const extrasOf = (url: string) => JSON.parse(new URL(url).searchParams.get('extras')!)

test('one link becomes a new-number link and a WhatsApp Business app link, keeping everything else', () => {
  const l = hostedLinks(LINK)!
  assert.ok(l)
  assert.deepEqual(extrasOf(l.coexistence), { featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4', features: [] })
  assert.deepEqual(extrasOf(l.new), { sessionInfoVersion: '3', version: 'v4', features: [] })
  for (const url of Object.values(l)) {
    const u = new URL(url)
    assert.equal(u.origin + u.pathname, 'https://business.facebook.com/messaging/whatsapp/onboard/')
    assert.equal(u.searchParams.get('app_id'), '123')
    assert.equal(u.searchParams.get('config_id'), '456')
  }
})

test('a link without extras gets session info v3; padding and quotes around it are fine', () => {
  const l = hostedLinks('  https://www.facebook.com/x/whatsapp/onboard/?app_id=1&config_id=2  ')!
  assert.deepEqual(extrasOf(l.new), { sessionInfoVersion: '3' })
})

test('anything that isn’t Meta’s signup page is refused', () => {
  for (const bad of [
    undefined,
    '',
    'not a url',
    'http://business.facebook.com/messaging/whatsapp/onboard/?app_id=1&config_id=2',
    'https://business.facebook.com.evil.example/messaging/whatsapp/onboard/?app_id=1&config_id=2',
    'https://evil.example/messaging/whatsapp/onboard/?app_id=1&config_id=2',
    'https://business.facebook.com/settings/?app_id=1&config_id=2',
    'https://business.facebook.com/messaging/whatsapp/onboard/?config_id=2',
    'https://business.facebook.com/messaging/whatsapp/onboard/?app_id=abc&config_id=2',
  ])
    assert.equal(hostedLinks(bad), null, String(bad))
})

test('the asset map names every piece, and fills in the ids Meta reports', () => {
  const empty = assetMap('new', 'Asha Foods')
  assert.deepEqual(empty.map((r) => r.meta), ['Business portfolio', 'WhatsApp Business account', 'Phone number', 'Permissions you grant'])
  assert.match(empty[0].helo, /Asha Foods/)
  assert.ok(empty.every((r) => !r.id))
  const filled = assetMap('coexistence', 'Asha Foods', { businessId: '1', wabaId: '2', phoneNumberId: '3' })
  assert.deepEqual(filled.slice(0, 3).map((r) => r.id), ['1', '2', '3'])
  assert.match(filled[2].helo, /WhatsApp Business app keeps working/)
})
