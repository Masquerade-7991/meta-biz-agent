import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONNECT_KINDS } from './connectKinds.ts'

test('each way to connect runs a real Meta flow and asks for at least one confirmation', () => {
  assert.deepEqual(
    CONNECT_KINDS.map((k) => [k.id, k.flow]),
    [
      ['new', 'new'],
      ['app', 'coexistence'],
      ['move', 'new'],
    ],
  )
  for (const k of CONNECT_KINDS) assert.ok(k.confirm.length && k.know.length, k.id)
})
