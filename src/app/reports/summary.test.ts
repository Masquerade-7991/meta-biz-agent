// Run: node --test src/app/reports/summary.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, changes, csvOf, periodOf, rollUp, sortRows, totalRow, type Breakdown, type Col } from './summary.ts'

const COLS: Col[] = [
  { key: 'date', label: 'Date', kind: 'period' },
  { key: 'n', label: 'Conversations', kind: 'count', agg: 'sum' },
  { key: 'rate', label: 'AI alone', kind: 'rate', ratio: ['ai', 'n'] },
  { key: 'reply', label: 'Median first reply', kind: 'minutes', agg: 'median' },
  { key: 'open', label: 'Open at the end', kind: 'count', agg: 'last' },
]
// Mon 5 Oct to Mon 12 Oct 2026: two weeks.
const ROWS = [
  { date: '2026-10-05', n: 10, ai: 5, reply: 4, open: 3 },
  { date: '2026-10-06', n: 30, ai: 27, reply: 10, open: 4 },
  { date: '2026-10-11', n: 0, ai: 0, reply: null, open: 2 },
  { date: '2026-10-12', n: 20, ai: 10, reply: 6, open: 1 },
]

test('sorting puts empty cells last both ways and sorts rates by their value', () => {
  const reply = COLS[3]
  assert.deepEqual(sortRows(ROWS, reply, 'asc').map((r) => r.reply), [4, 6, 10, null])
  assert.deepEqual(sortRows(ROWS, reply, 'desc').map((r) => r.reply), [10, 6, 4, null])
  assert.deepEqual(sortRows(ROWS, COLS[2], 'desc').map((r) => r.date), ['2026-10-06', '2026-10-05', '2026-10-12', '2026-10-11'])
  assert.deepEqual(sortRows(ROWS, COLS[0], 'desc').map((r) => r.date)[0], '2026-10-12')
})

test('totals: counts sum, rates weighted, medians of the rows unless the period gives its own, levels take the last', () => {
  const b: Breakdown = { id: 't', label: 't', columns: COLS, rows: ROWS }
  const t = totalRow(b)
  assert.equal(t.n, 60)
  assert.equal(cellValue(t, COLS[2]), 42 / 60) // not the mean of 50%, 90%, 50%
  assert.equal(t.reply, 6)
  assert.equal(t.open, 1)
  assert.equal(totalRow({ ...b, total: { reply: 7.5 } }).reply, 7.5)
})

test('roll-up into weeks (Monday first) and months', () => {
  assert.equal(periodOf('2026-10-11', 'week'), '2026-10-05') // Sunday → its Monday
  assert.equal(periodOf('2026-10-12', 'week'), '2026-10-12')
  assert.equal(periodOf('2026-10-12', 'month'), '2026-10-01')
  const weeks = rollUp(ROWS, COLS, 'week')
  assert.deepEqual(weeks.map((w) => [w.date, w.n, w.ai, w.reply, w.open]), [
    ['2026-10-05', 40, 32, 7, 2],
    ['2026-10-12', 20, 10, 6, 1],
  ])
  assert.equal(rollUp(ROWS, COLS, 'month').length, 1)
  assert.equal(rollUp(ROWS, COLS, 'day'), ROWS)
})

test('change against the row before', () => {
  assert.deepEqual(changes(ROWS, COLS[1]), [null, 2, -1, null])
})

test('CSV cells keep numbers, rates as percents, units in the header', () => {
  const t = csvOf({ id: 't', label: 't', columns: COLS, rows: ROWS.slice(0, 1) }, 'INR')
  assert.deepEqual(t.columns, ['Date', 'Conversations', 'AI alone (%)', 'Median first reply (minutes)', 'Open at the end'])
  assert.deepEqual(t.rows[0], ['2026-10-05', 10, 50, 4, 3])
})
