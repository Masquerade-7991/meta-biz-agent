// Run: node --test src/app/home/setupSteps.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { setupSteps, type SetupSignals } from './setupSteps.ts'

const none: SetupSignals = { connected: false, billed: false, built: false, tested: false, live: false, invited: false, canInvite: true }

test('steps run in order, the first not done is current, later ones wait for the one before', () => {
  const r = setupSteps(none)
  assert.deepEqual(r.steps.map((s) => s.id), ['connect', 'account', 'build', 'test', 'live', 'invite'])
  assert.deepEqual(r.steps.map((s) => s.current), [true, false, false, false, false, false])
  assert.deepEqual(r.steps.map((s) => s.unlocksAfter), [null, 1, 2, 3, 4, null])
  assert.equal(r.done, 0)
  assert.equal(r.allDone, false)
})

test('done comes from the signals, even for a step after the current one', () => {
  const r = setupSteps({ ...none, connected: true, tested: true })
  assert.equal(r.steps.find((s) => s.current)?.id, 'account')
  assert.equal(r.steps.find((s) => s.id === 'test')?.done, true)
  assert.equal(r.steps.find((s) => s.id === 'test')?.unlocksAfter, null)
  assert.equal(r.done, 2)
})

test('the optional invite step never blocks all done, and is hidden without the permission', () => {
  const all = { ...none, connected: true, billed: true, built: true, tested: true, live: true }
  const r = setupSteps(all)
  assert.equal(r.allDone, true)
  assert.equal(r.done, 5)
  assert.equal(r.total, 6)
  assert.equal(r.steps.some((s) => s.current), false)
  const noInvite = setupSteps({ ...all, canInvite: false })
  assert.equal(noInvite.total, 5)
  assert.equal(noInvite.steps.some((s) => s.id === 'invite'), false)
  assert.equal(setupSteps({ ...none, invited: true }).steps[0].current, true)
})
