// Run: node --test server/templates.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTemplate, slotsOf, templatePayload, type Template } from '../src/app/broadcasts/templates.ts'

const order: Template = {
  name: 'order_update',
  language: 'en',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
    { type: 'BODY', text: 'Hi {{1}}, your order {{2}} ships {{2}} today.' },
    { type: 'FOOTER', text: 'Helo.ai' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track', url: 'https://helo.ai/t/{{1}}' }, { type: 'QUICK_REPLY', text: 'Help' }] },
  ],
}

test('finds every slot once, in order', () => {
  assert.deepEqual(slotsOf(order).map((s) => s.id), ['header:1', 'body:1', 'body:2', 'button:0'])
})

test('builds the Cloud API payload', () => {
  const p = templatePayload(order, { 'header:1': '#42', 'body:1': 'Priya', 'body:2': 'A-42', 'button:0': 'A42' })
  assert.deepEqual(p, {
    name: 'order_update',
    language: { code: 'en' },
    components: [
      { type: 'header', parameters: [{ type: 'text', text: '#42' }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'A-42' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'A42' }] },
    ],
  })
})

test('media headers need a link; templates without slots send bare', () => {
  const img: Template = { name: 'promo', language: 'en_US', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Sale!' }] }
  assert.deepEqual(slotsOf(img), [{ id: 'header:media', label: 'Header image link', kind: 'media' }])
  assert.deepEqual(templatePayload(img, { 'header:media': 'https://x/y.png' }).components, [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/y.png' } }] }])
  assert.deepEqual(templatePayload({ name: 'hi', language: 'en', components: [{ type: 'BODY', text: 'Hello' }] }, {}), { name: 'hi', language: { code: 'en' } })
})

test('missing values are named', () => {
  assert.throws(() => templatePayload(order, { 'body:1': 'x' }), /Header \{\{1\}\}.*\{\{2\}\}.*Track/)
})

test('renders what the customer sees', () => {
  assert.equal(renderTemplate(order, { 'header:1': '#42', 'body:1': 'Priya', 'body:2': 'A-42' }), '*Order #42*\n\nHi Priya, your order A-42 ships A-42 today.\n\n_Helo.ai_\n[Track · Help]')
})
