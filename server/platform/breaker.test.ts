import assert from 'node:assert/strict'
import test from 'node:test'
import { acquire, breakerState, guard, inFlightCount, record, resetBreakers } from './breaker.ts'

test('five failures in a row open the circuit; a success closes the count', async () => {
  resetBreakers()
  for (let i = 0; i < 4; i++) record('meta', false)
  assert.equal(breakerState('meta'), 'closed')
  record('meta', true)
  for (let i = 0; i < 4; i++) record('meta', false)
  assert.equal(breakerState('meta'), 'closed', 'the success reset the run')
  record('meta', false)
  assert.equal(breakerState('meta'), 'open')
  assert.equal(breakerState('graph'), 'closed', 'kinds are independent')
  await assert.rejects(guard('meta'), { name: 'BreakerOpen' })
  await guard('graph')
  resetBreakers()
})

test('a 4xx from Meta is Meta working, not Meta down', () => {
  resetBreakers()
  for (let i = 0; i < 10; i++) record('meta', true)
  assert.equal(breakerState('meta'), 'closed')
})

test('the bulkhead seats eight calls and queues the rest in order', async () => {
  const seats = await Promise.all(Array.from({ length: 8 }, () => acquire()))
  assert.equal(inFlightCount(), 8)
  const order: number[] = []
  const ninth = acquire().then((r) => (order.push(9), r))
  const tenth = acquire().then((r) => (order.push(10), r))
  await new Promise((done) => setTimeout(done, 10))
  assert.equal(inFlightCount(), 8, 'nine and ten wait')
  seats[0]()
  const r9 = await ninth
  assert.deepEqual(order, [9])
  seats[1]()
  const r10 = await tenth
  assert.deepEqual(order, [9, 10])
  r9()
  r9()
  r10()
  seats.slice(2).forEach((r) => r())
  assert.equal(inFlightCount(), 0, 'releasing twice counts once')
})
