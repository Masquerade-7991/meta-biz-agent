// Journey: message templates on the WhatsApp account (list, submit for review, delete, by role) and
// sending one into a chat from the Inbox, e.g. after the 24-hour window.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, TEMPLATE, type Stack } from './harness.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
const PHONE = '919860000001'
before(async () => {
  s = await startStack('templates')
  w = await s.seed.workspace()
  assert.equal((await s.webhook(inbound(w.numbers[0], PHONE, 'is my order coming?'))).status, 200)
})
after(() => s?.stop())

test('templates come from the WhatsApp account, for everyone in the workspace', async () => {
  const r = await s.api(w.agent, 'GET', '/api/templates')
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json[0].name, TEMPLATE.name)
})

test('supervisors and up submit templates for review; every variable needs an example', async () => {
  const t = { name: 'back_in_stock', category: 'UTILITY', language: 'en', body: 'Hi {{1}}, it’s back.', examples: { 'body:1': 'Asha' } }
  assert.equal((await s.api(w.agent, 'POST', '/api/templates', t)).status, 403)
  assert.equal((await s.api(w.supervisor, 'POST', '/api/templates', { ...t, examples: {} })).status, 400)
  assert.equal((await s.api(w.supervisor, 'POST', '/api/templates', { ...t, name: 'Not Valid' })).status, 400)
  const r = await s.api(w.supervisor, 'POST', '/api/templates', t)
  assert.equal(r.status, 200, r.text)
  const call = s.fake.find('POST', /\/message_templates$/).at(-1)
  assert.equal(call?.body?.name, 'back_in_stock')
})

test('only owners and admins delete templates', async () => {
  assert.equal((await s.api(w.supervisor, 'DELETE', '/api/templates/back_in_stock')).status, 403)
  assert.equal((await s.api(w.admin, 'DELETE', '/api/templates/back_in_stock')).status, 200)
  assert.equal(s.fake.find('DELETE', /\/message_templates$/).at(-1)?.query.get('name'), 'back_in_stock')
})

test('a template sent into a chat reaches the customer and the team takes the chat over', async () => {
  const before = s.fake.find('POST', /\/messages$/).length
  const r = await s.api(w.agent, 'POST', '/api/templates/send-one', { phone: PHONE, template: { name: TEMPLATE.name, language: 'en' }, values: { 'body:1': 'Asha' } })
  assert.equal(r.status, 200, r.text)
  const sent = s.fake.find('POST', /\/messages$/).slice(before)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body?.type, 'template')
  assert.equal(sent[0].body?.to, PHONE)
  const conv = await s.db.collection('conversations').findOne({ workspaceId: w.id, phone: PHONE })
  assert.equal(conv?.owner, 'human')
})

test('unknown templates and unknown chats are explained', async () => {
  assert.equal((await s.api(w.agent, 'POST', '/api/templates/send-one', { phone: PHONE, template: { name: 'nope', language: 'en' }, values: {} })).status, 404)
  assert.equal((await s.api(w.agent, 'POST', '/api/templates/send-one', { phone: '919860000099', template: { name: TEMPLATE.name, language: 'en' }, values: { 'body:1': 'x' } })).status, 404)
})
