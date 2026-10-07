import assert from 'node:assert/strict'
import test from 'node:test'
import { coordsFromMapsLink, nameFromTrigger } from './richReplies.ts'

test('reads coordinates from the common Google Maps link shapes', () => {
  const want = { latitude: '19.0596', longitude: '72.8295' }
  assert.deepEqual(coordsFromMapsLink('https://www.google.com/maps/place/Shop/@19.0596,72.8295,17z/data=x'), want)
  assert.deepEqual(coordsFromMapsLink('https://maps.google.com/?q=19.0596,72.8295'), want)
  assert.deepEqual(coordsFromMapsLink('https://www.google.com/maps/place/X/data=!3m1!4b1!4m6!3m5!3d19.0596!4d72.8295'), want)
  assert.deepEqual(coordsFromMapsLink('19.0596, 72.8295'), want)
  assert.deepEqual(coordsFromMapsLink('https://www.google.com/maps/@-33.8688,151.2093,12z'), { latitude: '-33.8688', longitude: '151.2093' })
})

test('gives up on links without coordinates and out-of-range numbers', () => {
  assert.equal(coordsFromMapsLink('https://maps.app.goo.gl/AbCdEf'), null)
  assert.equal(coordsFromMapsLink('120.5, 72.1'), null)
})

test('names a reply from its trigger', () => {
  assert.equal(nameFromTrigger('When a customer asks for your menu'), 'Asks for your menu')
  assert.equal(nameFromTrigger('If someone wants to book a demo.'), 'Wants to book a demo')
  assert.equal(nameFromTrigger(''), '')
  assert.ok(nameFromTrigger('When a customer ' + 'asks about the very long thing '.repeat(4)).endsWith('…'))
})
