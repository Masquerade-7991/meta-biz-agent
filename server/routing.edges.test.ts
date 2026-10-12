// Run: node --test server/routing.edges.test.ts
// Edges of routing rules, picking people and the escalation order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRule,
  clockPercent,
  conditionHolds,
  DEFAULT_MATRIX,
  describeLevel,
  firstMatch,
  MAX_LEVELS,
  nextEscalation,
  parseMatrix,
  parseRules,
  parseTeam,
  pickFromPool,
  raise,
  type Facts,
  type Rule,
  type TicketClock,
} from '../src/app/support/routing.ts'

const facts: Facts = { source: 'handoff', priority: 'normal', text: '', contactTags: [], open: true, phoneNumberId: null }
const rule = (r: Partial<Rule>): Rule => ({ id: 'x', name: 'x', enabled: true, match: 'all', when: [], then: [{ do: 'leaveUnassigned' }], ...r })
const known = { teams: new Set(['t1']), members: new Set(['u1']) }

// ---- conditions ----
test('keywords match unicode, emoji and right-to-left text, ignoring case', () => {
  const kw = (any: string[], text: string) => conditionHolds({ field: 'keyword', any }, { ...facts, text })
  assert.ok(kw(['रिफंड'], 'मुझे रिफंड चाहिए'))
  assert.ok(kw(['استرداد'], 'أريد استرداد المبلغ'))
  assert.ok(kw(['🔥'], 'urgent 🔥🔥'))
  assert.ok(kw(['ÉCHANGE'], 'je veux un échange'))
  assert.ok(!kw(['   '], 'anything'), 'a blank keyword never matches everything')
})

test('keywords are substrings, so a short word also matches inside longer words', () => {
  // Documents today's behaviour (see QA report): "no" matches "know" and "cannot".
  assert.ok(conditionHolds({ field: 'keyword', any: ['no'] }, { ...facts, text: 'I know' }))
})

test('a number condition never matches a chat with no number', () => {
  assert.equal(conditionHolds({ field: 'number', in: ['p1'] }, facts), false)
})

test('a rule with no conditions always matches; with match "any" and one true condition it matches', () => {
  assert.ok(firstMatch([rule({})], facts))
  assert.ok(firstMatch([rule({ match: 'any', when: [{ field: 'hours', is: 'closed' }, { field: 'source', in: ['handoff'] }] })], facts))
  assert.equal(firstMatch([], facts), null)
})

test('only the first matching rule acts; a later rule’s tags are not added', () => {
  const rules = [rule({ id: 'a', then: [{ do: 'addTags', tags: ['first'] }] }), rule({ id: 'b', then: [{ do: 'addTags', tags: ['second'] }] })]
  assert.deepEqual(applyRule(firstMatch(rules, facts), facts).tags, ['first'])
})

test('within one rule the last target wins and priority changes apply in order', () => {
  const r = rule({ then: [{ do: 'assignUser', userId: 'u1' }, { do: 'setPriority', priority: 'low' }, { do: 'leaveUnassigned' }, { do: 'setPriority', priority: 'urgent' }] })
  assert.deepEqual(applyRule(r, facts), { priority: 'urgent', tags: [], target: { kind: 'none' } })
})

// ---- picking people ----
const p = (availability: 'online' | 'away' | 'offline', maxOpen: number | null = null, skills: string[] = []) => ({ availability, maxOpen, skills })

test('an empty pool, a limit of zero and someone with no profile are never picked', () => {
  const profiles = new Map([['zero', p('online', 0)]])
  assert.equal(pickFromPool([], 'round_robin', profiles, new Map(), 0), null)
  assert.equal(pickFromPool(['zero'], 'round_robin', profiles, new Map(), 0), null)
  assert.equal(pickFromPool(['ghost'], 'least_busy', profiles, new Map(), 0), null)
})

test('round robin takes turns over the eligible people only', () => {
  const profiles = new Map([
    ['a', p('online')],
    ['b', p('offline')],
    ['c', p('online')],
  ])
  const picks = [0, 1, 2, 3].map((turn) => pickFromPool(['a', 'b', 'c'], 'round_robin', profiles, new Map(), turn))
  assert.deepEqual(picks, ['a', 'c', 'a', 'c'])
})

test('skills match ignoring case and surrounding space', () => {
  const profiles = new Map([['a', p('online', null, [' Hindi '])]])
  assert.equal(pickFromPool(['a'], 'round_robin', profiles, new Map(), 0, 'HINDI'), 'a')
  assert.equal(pickFromPool(['a'], 'round_robin', profiles, new Map(), 0, 'tamil'), null)
})

// ---- escalation ----
const H = 3_600_000
const clock = (o: Partial<TicketClock> = {}): TicketClock => ({ createdAt: 0, firstResponseDueAt: 1 * H, resolveDueAt: 8 * H, firstRespondedAt: null, status: 'open', ...o })

test('a clock with no time at all (due at creation) counts as one minute, never divides by zero', () => {
  const pct = clockPercent(clock({ firstResponseDueAt: 0 }), 'first_response', 30_000)
  assert.equal(pct, 50)
})

test('the percent passes 100 at the deadline and keeps growing past it', () => {
  assert.equal(clockPercent(clock(), 'first_response', 1 * H), 100)
  assert.equal(clockPercent(clock(), 'resolution', 12 * H), 150)
})

test('a waiting ticket’s percent is not computed here: the sweep only looks at open tickets', () => {
  // escalateDue reads status "open" only; clockPercent itself would still count a pending ticket.
  assert.ok((clockPercent(clock({ status: 'pending' }), 'resolution', 9 * H) ?? 0) > 100)
})

test('answering on time does not stop a later resolution breach from escalating', { todo: 'QA-01: a stopped first-reply level blocks every level after it' }, () => {
  // High priority by default: [first reply at breach, resolution at breach]. The team replied after
  // 10 minutes, then the ticket sat unresolved for 9 hours (resolution due at 8h).
  const levels = DEFAULT_MATRIX.levels.high
  assert.equal(nextEscalation(clock({ firstRespondedAt: H / 6 }), levels, 0, 9 * H), 2)
})

test('urgent: replying before the 75% mark still lets the resolution level fire', { todo: 'QA-01: same root cause, urgent default matrix' }, () => {
  const levels = DEFAULT_MATRIX.levels.urgent // FR 75%, FR 100%, resolution 100%
  assert.equal(nextEscalation(clock({ firstRespondedAt: H / 2 }), levels, 0, 9 * H), 3)
})

test('no levels, or past the last level, never escalates', () => {
  assert.equal(nextEscalation(clock(), DEFAULT_MATRIX.levels.low, 0, 100 * H), null)
  assert.equal(nextEscalation(clock(), DEFAULT_MATRIX.levels.normal, 1, 100 * H), null)
})

test('describeLevel names before, at and past the target', () => {
  const base = { notify: [], email: false, reassignTeamId: null, raisePriority: false } as const
  assert.equal(describeLevel({ ...base, clock: 'first_response', percent: 75, notify: [] }), 'First reply 75% in')
  assert.equal(describeLevel({ ...base, clock: 'resolution', percent: 100, notify: [] }), 'Resolution at breach')
  assert.equal(describeLevel({ ...base, clock: 'resolution', percent: 150, notify: [] }), 'Resolution 50% past target')
})

test('raise moves each priority one step and stops at urgent', () => {
  assert.deepEqual((['low', 'normal', 'high', 'urgent'] as const).map(raise), ['normal', 'high', 'urgent', 'urgent'])
})

// ---- validation ----
test('rules: more than 50 is refused, extra conditions and actions are cut', () => {
  assert.throws(() => parseRules(Array.from({ length: 51 }, () => ({ name: 'r', then: [{ do: 'leaveUnassigned' }] })), known), /50 rules/)
  const [r] = parseRules(
    [{ name: 'many', when: Array.from({ length: 15 }, () => ({ field: 'hours', is: 'open' })), then: Array.from({ length: 9 }, () => ({ do: 'leaveUnassigned' })) }],
    known,
  )
  assert.equal(r.when.length, 10)
  assert.equal(r.then.length, 6)
})

test('rules: unknown conditions or actions, empty value lists and missing priorities explain themselves', () => {
  assert.throws(() => parseRules('nope', known), /as a list/)
  assert.throws(() => parseRules([null], known), /isn’t valid/)
  assert.throws(() => parseRules([{ name: 'A', when: [{ field: 'weather' }], then: [{ do: 'leaveUnassigned' }] }], known), /condition we don’t recognise/)
  assert.throws(() => parseRules([{ name: 'A', then: [{ do: 'launch' }] }], known), /action we don’t recognise/)
  assert.throws(() => parseRules([{ name: 'A', when: [{ field: 'source', in: ['nope'] }], then: [{ do: 'leaveUnassigned' }] }], known), /at least one value/)
  assert.throws(() => parseRules([{ name: 'A', then: [{ do: 'setPriority', priority: 'asap' }] }], known), /pick a priority/)
  assert.throws(() => parseRules([{ name: 'A', then: [{ do: 'assignUser', userId: 'stranger' }] }], known), /isn’t in the workspace/)
  assert.throws(() => parseRules([{ name: 'A', then: [] }], known), /at least one action/)
})

test('rules: names are trimmed and cut, emoji names survive, keywords are cut to 60 characters', () => {
  const [r] = parseRules([{ name: '  🔥 VIP ' + 'x'.repeat(100), when: [{ field: 'keyword', any: ['k'.repeat(80)] }], then: [{ do: 'leaveUnassigned' }] }], known)
  assert.ok(r.name.startsWith('🔥 VIP'))
  assert.equal(r.name.length, 80)
  assert.equal((r.when[0] as { any: string[] }).any[0].length, 60)
})

test('matrix: at most three levels per priority, percent bounds inclusive, unknown teams dropped', () => {
  const level = { percent: 100, notify: ['admins'] }
  const m = parseMatrix({ levels: { urgent: [level, level, level, level], high: [{ percent: 25, notify: ['assignee'] }, { percent: 500, notify: ['assignee'] }] } }, new Set())
  assert.equal(m.levels.urgent.length, MAX_LEVELS)
  assert.deepEqual(m.levels.high.map((l) => l.percent), [25, 500])
  assert.throws(() => parseMatrix({ levels: { low: [{ percent: 501, notify: ['admins'] }] } }, new Set()), /between 25% and 500%/)
  assert.throws(() => parseMatrix({ levels: { low: [{ percent: 'abc', notify: ['admins'] }] } }, new Set()), /between 25% and 500%/)
  const moved = parseMatrix({ levels: { low: [{ percent: 100, notify: [], reassignTeamId: 'gone', raisePriority: true }] } }, new Set(['t1']))
  assert.equal(moved.levels.low[0].reassignTeamId, null)
  assert.equal(moved.enabled, false, 'off unless asked')
})

test('matrix: levels out of order are accepted as sent', { todo: 'QA-25: parseMatrix accepts 100% then 75% on the same clock; level 2 then fires at once after level 1' }, () => {
  assert.throws(() =>
    parseMatrix({ levels: { urgent: [{ clock: 'first_response', percent: 100, notify: ['admins'] }, { clock: 'first_response', percent: 75, notify: ['admins'] }] } }, new Set()),
  )
})

test('teams: a name is required, members outside the workspace and duplicates are dropped', () => {
  assert.throws(() => parseTeam({ name: '  ' }, new Set()), /team a name/)
  const t = parseTeam({ name: ' Billing ', memberIds: ['u1', 'u1', 'stranger'], leadId: 'stranger', assign: 'magic' }, new Set(['u1']))
  assert.deepEqual(t, { name: 'Billing', description: '', leadId: null, memberIds: ['u1'], assign: 'round_robin' })
})
