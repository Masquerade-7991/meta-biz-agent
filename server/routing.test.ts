// Run: node --test server/routing.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRule,
  DEFAULT_MATRIX,
  firstMatch,
  nextEscalation,
  parseMatrix,
  parseRules,
  pickFromPool,
  raise,
  type Facts,
  type Rule,
  type TicketClock,
} from '../src/app/support/routing.ts'

const facts: Facts = { source: 'handoff', priority: 'normal', text: 'My REFUND hasn’t arrived', contactTags: ['VIP'], open: true, phoneNumberId: 'p1' }
const rule = (r: Partial<Rule>): Rule => ({ id: 'x', name: 'x', enabled: true, match: 'all', when: [], then: [{ do: 'leaveUnassigned' }], ...r })

test('first matching rule wins, top to bottom; disabled rules are skipped', () => {
  const rules = [
    rule({ id: 'off', enabled: false }),
    rule({ id: 'billing', when: [{ field: 'keyword', any: ['refund', 'invoice'] }] }),
    rule({ id: 'always' }),
  ]
  assert.equal(firstMatch(rules, facts)?.id, 'billing')
  assert.equal(firstMatch(rules, { ...facts, text: 'hello' })?.id, 'always')
})

test('all vs any, tags ignore case, hours and number', () => {
  const when = [
    { field: 'contactTag' as const, any: ['vip'] },
    { field: 'hours' as const, is: 'closed' as const },
  ]
  assert.equal(firstMatch([rule({ when })], facts), null)
  assert.ok(firstMatch([rule({ when, match: 'any' })], facts))
  assert.ok(firstMatch([rule({ when: [{ field: 'number', in: ['p1'] }] })], facts))
  assert.equal(firstMatch([rule({ when: [{ field: 'number', in: ['p2'] }] })], facts), null)
})

test('a rule sets priority, tags and target', () => {
  const r = rule({ then: [{ do: 'setPriority', priority: 'high' }, { do: 'addTags', tags: ['Billing'] }, { do: 'assignTeam', teamId: 't1', skill: 'hindi' }] })
  assert.deepEqual(applyRule(r, facts), { priority: 'high', tags: ['billing'], target: { kind: 'team', teamId: 't1', skill: 'hindi' } })
  assert.deepEqual(applyRule(null, facts).target, { kind: 'default' })
})

const p = (availability: 'online' | 'away' | 'offline', maxOpen: number | null = null, skills: string[] = []) => ({ availability, maxOpen, skills })

test('only online people under their limit with the skill are picked', () => {
  const profiles = new Map([
    ['a', p('online', 2)],
    ['b', p('away')],
    ['c', p('online', null, ['Hindi'])],
  ])
  const open = new Map([['a', 2]])
  assert.equal(pickFromPool(['a', 'b', 'c'], 'round_robin', profiles, open, 0), 'c') // a is full, b is away
  assert.equal(pickFromPool(['a', 'b'], 'round_robin', profiles, open, 0), null) // waits in the queue
  assert.equal(pickFromPool(['a', 'c'], 'round_robin', profiles, new Map(), 0, 'hindi'), 'c')
  assert.equal(pickFromPool(['a', 'c'], 'queue', profiles, new Map(), 0), null)
})

test('least busy takes the fewest open tickets, ties take turns', () => {
  const profiles = new Map([
    ['a', p('online')],
    ['b', p('online')],
    ['c', p('online')],
  ])
  const open = new Map([
    ['a', 3],
    ['b', 1],
    ['c', 1],
  ])
  assert.equal(pickFromPool(['a', 'b', 'c'], 'least_busy', profiles, open, 0), 'b')
  assert.equal(pickFromPool(['a', 'b', 'c'], 'least_busy', profiles, open, 1), 'c')
  assert.equal(pickFromPool(['a', 'b', 'c'], 'round_robin', profiles, open, 4), 'b')
})

const H = 3_600_000
const clock = (o: Partial<TicketClock> = {}): TicketClock => ({ createdAt: 0, firstResponseDueAt: 1 * H, resolveDueAt: 8 * H, firstRespondedAt: null, status: 'open', ...o })

test('escalation levels fire in order and only once', () => {
  const levels = DEFAULT_MATRIX.levels.urgent // 75% first reply, 100% first reply, 100% resolution
  assert.equal(nextEscalation(clock(), levels, 0, 0.5 * H), null)
  assert.equal(nextEscalation(clock(), levels, 0, 0.8 * H), 1)
  assert.equal(nextEscalation(clock(), levels, 1, 0.8 * H), null)
  // Both first-reply levels are due at once: level 2 waits for the next sweep.
  assert.equal(nextEscalation(clock(), levels, 0, 2 * H), 1)
  assert.equal(nextEscalation(clock(), levels, 1, 2 * H), 2)
  assert.equal(nextEscalation(clock(), levels, 3, 100 * H), null)
})

test('a stopped clock never escalates', () => {
  const levels = DEFAULT_MATRIX.levels.urgent
  assert.equal(nextEscalation(clock({ firstRespondedAt: 0.1 * H }), levels, 0, 5 * H), null) // replied in time
  assert.equal(nextEscalation(clock({ firstRespondedAt: 0.1 * H }), levels, 2, 9 * H), 3) // resolution still runs
  assert.equal(nextEscalation(clock({ status: 'resolved' }), levels, 2, 9 * H), null)
})

test('raise moves one step up and stops at urgent', () => {
  assert.equal(raise('low'), 'normal')
  assert.equal(raise('urgent'), 'urgent')
})

test('rule and matrix validation explain the problem', () => {
  const known = { teams: new Set(['t1']), members: new Set(['u1']) }
  assert.throws(() => parseRules([{ name: '', then: [] }], known), /needs a name/)
  assert.throws(() => parseRules([{ name: 'A', then: [{ do: 'assignTeam', teamId: 'gone' }] }], known), /no longer exists/)
  assert.throws(() => parseRules([{ name: 'A', when: [{ field: 'keyword', any: [] }], then: [{ do: 'leaveUnassigned' }] }], known), /at least one value/)
  const [r] = parseRules([{ name: 'A', when: [{ field: 'contactTag', any: ['VIP'] }], then: [{ do: 'assignTeam', teamId: 't1' }] }], known)
  assert.deepEqual(r.when, [{ field: 'contactTag', any: ['vip'] }])
  assert.throws(() => parseMatrix({ levels: { urgent: [{ percent: 10, notify: ['admins'] }] } }, new Set()), /between 25% and 500%/)
  assert.throws(() => parseMatrix({ levels: { urgent: [{ percent: 100, notify: [] }] } }, new Set()), /does nothing/)
  assert.equal(parseMatrix({ enabled: true, levels: {} }, new Set()).enabled, true)
})

test('notify only accepts the real recipients, not prototype names', () => {
  const m = parseMatrix({ levels: { urgent: [{ percent: 100, notify: ['toString', 'assignee', 'assignee', 'constructor'] }] } }, new Set())
  assert.deepEqual(m.levels.urgent[0].notify, ['assignee'])
  assert.throws(() => parseMatrix({ levels: { urgent: [{ percent: 100, notify: ['toString'] }] } }, new Set()), /does nothing/)
})
