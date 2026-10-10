// Run: node --test src/app/inbox/sessions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionStarts } from './sessions.ts'

const msg = (id: string, at: string, author = 'customer') => ({ id, at, author })

test('a new session starts when the customer writes after more than a day', () => {
  const s = sessionStarts([
    msg('a', '2026-10-01T10:00:00Z'),
    msg('b', '2026-10-01T10:05:00Z', 'ai'),
    msg('c', '2026-10-02T09:00:00Z'), // within 24 h of a: same session
    msg('d', '2026-10-03T09:30:00Z', 'agent'), // our messages never open one
    msg('e', '2026-10-03T09:31:00Z'), // 24.5 h after c
  ])
  assert.deepEqual([...s.entries()], [
    ['a', { n: 1, at: '2026-10-01T10:00:00Z' }],
    ['e', { n: 2, at: '2026-10-03T09:31:00Z' }],
  ])
})

test('no customer messages, no sessions', () => {
  assert.equal(sessionStarts([msg('x', '2026-10-01T10:00:00Z', 'agent')]).size, 0)
})
