import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkMedia } from './media.ts'

const MB = 1024 * 1024

test('accepted types map to their WhatsApp kind', () => {
  assert.deepEqual(checkMedia('image/png', 1000), { kind: 'image' })
  assert.deepEqual(checkMedia('application/pdf', 20 * MB), { kind: 'document' })
  assert.deepEqual(checkMedia('audio/ogg; codecs=opus', 1000), { kind: 'audio' })
  assert.deepEqual(checkMedia('VIDEO/MP4', 1000), { kind: 'video' })
})

test('size limits are per kind', () => {
  assert.ok('error' in checkMedia('image/jpeg', 6 * MB))
  assert.ok('kind' in checkMedia('image/jpeg', 5 * MB))
  assert.ok('error' in checkMedia('video/mp4', 17 * MB))
  assert.ok('error' in checkMedia('image/png', 0))
})

test('unsupported types are refused with a reason', () => {
  const r = checkMedia('image/gif', 1000)
  assert.ok('error' in r && r.error.includes('image/gif'))
  assert.ok('error' in checkMedia('', 10))
})
