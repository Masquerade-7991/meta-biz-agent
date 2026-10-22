// Run: node --test server/support/escalationIds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextEscalation, parseMatrix, type EscalationLevel } from '../../src/app/support/routing.ts'
import { assignLevelIds, ensureLevelIds, reachedCount } from './escalationIds.ts'

const lvl = (percent: number, clock: EscalationLevel['clock'] = 'resolution'): EscalationLevel => ({ clock, percent, notify: ['assignee'], email: false, reassignTeamId: null, raisePriority: false })
const withIds = (ids: string[], percents: number[]) => ids.map((id, i) => ({ ...lvl(percents[i]), id }))
// A ticket whose resolution clock is 100 minutes long, `pct` percent used.
const clock = { createdAt: 0, firstResponseDueAt: 50 * 60_000, resolveDueAt: 100 * 60_000, firstRespondedAt: 1, status: 'open' as const }
const at = (pct: number) => pct * 60_000

test('inserting a level before the one reached neither skips nor repeats', () => {
  const before = withIds(['a', 'b', 'c'], [50, 75, 100])
  const t = { escalationLevelId: 'a', escalationLevel: 1 }
  const after = withIds(['a', 'x', 'b', 'c'], [50, 60, 75, 100])
  const current = reachedCount(after, t)
  assert.equal(current, 1)
  assert.equal(nextEscalation(clock, after, current, at(80)), 2) // x fires next, then b, c
  assert.equal(reachedCount(before, t), 1)
})

test('removing an earlier level doesn’t skip the next one', () => {
  const t = { escalationLevelId: 'b', escalationLevel: 2 }
  const after = withIds(['b', 'c'], [75, 100])
  assert.equal(reachedCount(after, t), 1) // by position (2) c would have been skipped
  assert.equal(nextEscalation(clock, after, 1, at(100)), 2)
})

test('removing the level reached falls back to the levels it reached since the clock started', () => {
  const t = { escalationLevelId: 'b', escalationLevel: 2, clockStartAt: 0, escalations: [{ levelId: 'old', at: -5 }, { levelId: 'a', at: 10 }, { levelId: 'b', at: 20 }] }
  const after = withIds(['a', 'c'], [50, 100])
  assert.equal(reachedCount(after, t), 1) // a is done, c is next: nothing repeats
  const reopened = { ...t, clockStartAt: 30 } // reaching a before the reopen doesn't count
  assert.equal(reachedCount(after, reopened), 0)
})

test('tickets from before ids keep their position', () => {
  assert.equal(reachedCount(withIds(['a', 'b'], [50, 100]), { escalationLevel: 1 }), 1)
  assert.equal(reachedCount(withIds(['a'], [50]), { escalationLevel: 3 }), 1)
  assert.equal(reachedCount(withIds(['a'], [50]), {}), 0)
})

test('ids: kept when sent, matched to the stored level when not, new otherwise', () => {
  let n = 0
  const stored = { levels: { urgent: withIds(['u1', 'u2'], [75, 100]), high: [], normal: [], low: [] } }
  const raw = { enabled: true, levels: { urgent: [{ ...lvl(50) }, { ...lvl(75) }, { ...lvl(100), id: 'u2' }], high: [], normal: [], low: [] } }
  const m = assignLevelIds(parseMatrix(raw, new Set()), raw, stored, () => `new${++n}`)
  assert.deepEqual(m.levels.urgent.map((l) => l.id), ['new1', 'u1', 'u2'])
  // A duplicated id is replaced, not kept twice.
  const dup = { levels: { urgent: [{ ...lvl(50), id: 'z' }, { ...lvl(75), id: 'z' }] } }
  const d = assignLevelIds(parseMatrix(dup, new Set()), dup, null, () => `n${++n}`)
  assert.notEqual(d.levels.urgent[0].id, d.levels.urgent[1].id)
})

test('levels without ids get stable ones once', () => {
  const m = parseMatrix({ levels: { urgent: [lvl(50), lvl(100)] } }, new Set())
  const a = ensureLevelIds(m)
  assert.equal(a.changed, true)
  assert.deepEqual(a.matrix.levels.urgent.map((l) => l.id), ['urgent-1', 'urgent-2'])
  assert.equal(ensureLevelIds(a.matrix).changed, false)
})
