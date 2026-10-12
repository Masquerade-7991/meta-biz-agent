// Journey: connecting a WhatsApp number. Two servers: one with only Meta's hosted signup link
// (EMBEDDED_SIGNUP_LINK) and one with the full Embedded Signup. What each tells whom, and what the
// full flow stores.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, type Stack } from './harness.ts'

const LINK = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=111&config_id=222&extras=${encodeURIComponent(JSON.stringify({ featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4' }))}`
const OFF = { META_ES_CONFIG_ID: '', META_APP_ID: '', APP_ID: '', EMBEDDED_SIGNUP_LINK: '' }

let hosted: Stack
let full: Stack
let hw: Awaited<ReturnType<Stack['seed']['workspace']>>
let fw: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  ;[hosted, full] = await Promise.all([
    startStack('wa_hosted', { port: 8797, env: { ...OFF, EMBEDDED_SIGNUP_LINK: LINK } }),
    startStack('wa_full', { port: 8798, env: { ...OFF, META_APP_ID: '555', META_ES_CONFIG_ID: '777', META_APP_SECRET: 'e2e-secret' } }),
  ])
  hw = await hosted.seed.workspace({ account: null })
  fw = await full.seed.workspace({ account: null })
  full.fake.on('GET', /\/oauth\/access_token$/, () => ({ json: { access_token: 'business-token' } }))
  full.fake.on('GET', /\/phone_numbers$/, () => ({ json: { data: [{ id: '770000000000102', display_phone_number: '+91 90000 00002', verified_name: 'Other' }, { id: '770000000000101', display_phone_number: '+91 90000 00001', verified_name: 'Asha Foods' }] } }))
  full.fake.on('GET', /^\/v[\d.]+\/770000000000001$|^\/770000000000001$/, () => ({ json: { id: '770000000000001', name: 'Asha Foods WABA' } }))
})
after(async () => {
  await Promise.all([hosted?.stop(), full?.stop()])
})

const NAMES = /META_|APP_SECRET|TOKEN_ENCRYPTION_KEY|EMBEDDED_SIGNUP_LINK/

test('hosted link only: owners get Meta’s signup page for each kind of number; nobody sees setting names', async () => {
  const owner = await hosted.api(hw.owner, 'GET', '/api/whatsapp/config')
  assert.equal(owner.status, 200, owner.text)
  assert.equal(owner.json.mode, 'hosted')
  assert.doesNotMatch(owner.text, NAMES)
  const extras = (u: string) => JSON.parse(new URL(u).searchParams.get('extras')!)
  assert.equal(extras(owner.json.links.coexistence).featureType, 'whatsapp_business_app_onboarding')
  assert.equal(extras(owner.json.links.new).featureType, undefined)
  assert.equal(new URL(owner.json.links.new).searchParams.get('config_id'), '222')
  assert.equal(owner.json.link, LINK, 'Connect opens the link exactly as configured')
  assert.equal(owner.json.appId, undefined)

  const agent = await hosted.api(hw.agent, 'GET', '/api/whatsapp/config')
  assert.equal(agent.json.mode, 'hosted')
  assert.equal(agent.json.links, undefined, 'only owners connect, so only they get the link')
  assert.equal(agent.json.link, undefined)
})

test('hosted link only: the console can’t finish a connection itself, and says so plainly', async () => {
  const r = await hosted.api(hw.owner, 'POST', '/api/whatsapp/connect', { code: 'x', wabaId: '1', phoneNumberId: '2' })
  assert.equal(r.status, 503)
  assert.match(r.json.detail, /Talk to Helo\.ai/)
  assert.doesNotMatch(r.text, NAMES)
})

test('full signup: owners get what opens Meta’s window; the connection is finished and stored', async () => {
  const cfg = await full.api(fw.owner, 'GET', '/api/whatsapp/config')
  assert.equal(cfg.json.mode, 'sdk')
  assert.equal(cfg.json.appId, '555')
  assert.equal(cfg.json.configId, '777')
  assert.equal((await full.api(fw.supervisor, 'GET', '/api/whatsapp/config')).json.appId, undefined)

  const r = await full.api(fw.owner, 'POST', '/api/whatsapp/connect', { code: 'c1', wabaId: '770000000000001', phoneNumberId: '770000000000101', businessId: '770000000000999', flow: 'new', billing: 'own' })
  assert.equal(r.status, 200, r.text)
  const a = r.json.account
  assert.equal(a.primaryNumberId, '770000000000101')
  assert.equal(a.steps.billing.state, 'waiting', 'paying Meta directly is a next step, not a failure')
  assert.equal(a.needsAttention, false)
  assert.match(r.json.pin, /^\d{6}$/)
  // Meta listed another number first: registration still went to the one signed up.
  assert.ok(full.fake.find('POST', /\/770000000000101\/register$/).length === 1)
  assert.equal(full.fake.find('POST', /\/770000000000102\/register$/).length, 0)
  assert.equal(a.phoneNumbers.length, 2)
  const pin = await full.api(fw.owner, 'GET', '/api/whatsapp/accounts/770000000000001/pin')
  assert.equal(pin.json.pin, r.json.pin)
})

test('full signup: an account another workspace has is refused before the one-time code is used', async () => {
  const other = await full.seed.workspace({ name: 'Other', account: { wabaId: '770000000000555', numbers: ['770000000000556'] } })
  assert.ok(other)
  const before = full.fake.find('GET', /\/oauth\/access_token$/).length
  const r = await full.api(fw.owner, 'POST', '/api/whatsapp/connect', { code: 'c2', wabaId: '770000000000555', phoneNumberId: '770000000000556', flow: 'new', billing: 'own' })
  assert.equal(r.status, 409, r.text)
  assert.equal(full.fake.find('GET', /\/oauth\/access_token$/).length, before)
})

test('full signup: only owners connect, and Meta returning no number is explained', async () => {
  assert.equal((await full.api(fw.admin, 'POST', '/api/whatsapp/connect', { code: 'c', wabaId: '1', phoneNumberId: '2' })).status, 403)
  const r = await full.api(fw.owner, 'POST', '/api/whatsapp/connect', { code: 'c3', wabaId: '770000000000777', phoneNumberId: '' })
  assert.equal(r.status, 400)
  assert.match(r.json.detail, /account and number/)
})
