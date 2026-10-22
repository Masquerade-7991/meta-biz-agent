// Run: node --test src/app/wizard/metaName.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMetaName } from './metaName.ts'

const META_NAME = /^[A-Za-z0-9_]+$/

test('typed names become names Meta accepts; valid names stay as they are', () => {
  assert.equal(toMetaName('Shopify store'), 'Shopify_store')
  assert.equal(toMetaName('  look up order! '), 'look_up_order')
  assert.equal(toMetaName('crème-brûlée.v2'), 'creme_brulee_v2')
  assert.equal(toMetaName('Shopify_store'), 'Shopify_store')
  assert.equal(toMetaName('ऑर्डर'), '')
  for (const s of ['a b', 'x--y', '__z__', 'Order #42 (new)']) assert.match(toMetaName(s), META_NAME, s)
})
