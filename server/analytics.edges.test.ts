// Run: node --test server/analytics.edges.test.ts
// Analytics day maths and definitions at the edges: DST days, month ends, empty data, formats.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayStart, parseFilter } from './analytics.ts'
import { addDays, csatScore, dayList, daysBetween, isoDay, median } from '../src/app/analytics/types.ts'
import { change, dur, pct, pointChange } from '../src/app/analytics/format.ts'
import { nextRunDay, scheduleRange, tableCsv } from '../src/app/reports/catalog.ts'

const url = (q: string) => new URL('http://x/api/analytics/overview?' + q)
/** Local wall clock of an instant in a zone, "YYYY-MM-DD HH:MM". */
const wall = (d: Date, tz: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d)

test('a day starts at local midnight on the days clocks change in the northern hemisphere', () => {
  for (const [day, tz] of [
    ['2026-03-08', 'America/New_York'],
    ['2026-11-01', 'America/New_York'],
    ['2026-03-29', 'Europe/Berlin'],
    ['2026-10-25', 'Europe/London'],
  ])
    assert.equal(wall(dayStart(day, tz), tz), `${day} 00:00`, `${day} ${tz}`)
})

test('a day starts at local midnight on the days clocks change in Australia and New Zealand', () => {
  for (const [day, tz] of [
    ['2026-04-05', 'Australia/Sydney'],
    ['2026-10-04', 'Australia/Sydney'],
    ['2026-04-05', 'Pacific/Auckland'],
    ['2026-09-27', 'Pacific/Auckland'],
  ])
    assert.equal(wall(dayStart(day, tz), tz), `${day} 00:00`, `${day} ${tz}`)
})

test('half-hour and 45-minute zones start their day at local midnight', () => {
  for (const tz of ['Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Adelaide', 'America/St_Johns']) assert.equal(wall(dayStart('2026-07-15', tz), tz), '2026-07-15 00:00', tz)
})

test('isoDay is the local date: 23:30 UTC is already tomorrow in India', () => {
  assert.equal(isoDay(new Date('2026-10-11T23:30:00Z'), 'Asia/Kolkata'), '2026-10-12')
  assert.equal(isoDay(new Date('2026-10-11T23:30:00Z'), 'UTC'), '2026-10-11')
  assert.equal(isoDay(new Date('2026-10-12T03:00:00Z'), 'America/Los_Angeles'), '2026-10-11')
})

test('day lists cross month ends, leap days and the year end', () => {
  assert.deepEqual(dayList('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01'])
  assert.equal(daysBetween('2026-01-01', '2026-12-31'), 365)
  assert.equal(addDays('2026-03-31', 1), '2026-04-01')
  assert.deepEqual(dayList('2026-10-12', '2026-10-12'), ['2026-10-12'])
})

test('filters: one day is fine, 366 days is the most, 367 is refused', () => {
  assert.equal(parseFilter(url('from=2026-10-12&to=2026-10-12'), 'UTC').from, '2026-10-12')
  assert.doesNotThrow(() => parseFilter(url('from=2025-10-12&to=2026-10-12'), 'UTC')) // 366 days
  assert.throws(() => parseFilter(url('from=2025-10-11&to=2026-10-12'), 'UTC'), /366 days or fewer/)
})

test('filters: leap day exists only in leap years; junk and injection-looking values are refused', () => {
  assert.doesNotThrow(() => parseFilter(url('from=2028-02-29&to=2028-03-01'), 'UTC'))
  assert.throws(() => parseFilter(url('from=2027-02-29&to=2027-03-01'), 'UTC'), /must be dates/)
  assert.throws(() => parseFilter(url('from=2026-10-01T00:00&to=2026-10-02'), 'UTC'), /must be dates/)
  assert.throws(() => parseFilter(url('from={"$gt":""}&to=2026-10-02'), 'UTC'), /must be dates/)
})

test('filters: no dates means the last 30 days ending today in the workspace’s zone', () => {
  const f = parseFilter(url(''), 'Pacific/Kiritimati') // UTC+14: often already tomorrow
  assert.equal(f.to, isoDay(new Date(), 'Pacific/Kiritimati'))
  assert.equal(daysBetween(f.from, f.to), 30)
})

test('filters: numbers are kept only when they are the workspace’s own (outside a request, none are)', () => {
  assert.deepEqual(parseFilter(url('numbers=111,222'), 'UTC').numbers, [])
  assert.equal(parseFilter(url('team=&person='), 'UTC').team, null)
})

test('median and CSAT with one value, ties and only bad answers', () => {
  assert.equal(median([7]), 7)
  assert.equal(median([2, 2, 2, 9]), 2)
  assert.equal(csatScore(0, 0, 5), 0)
  assert.equal(csatScore(1, 0, 0), 1)
  assert.equal(csatScore(0, 1, 0), 0.5)
})

test('changes against the period before: nothing to compare is null, not infinity', () => {
  assert.equal(change({ value: 10, prev: 0 }), null)
  assert.equal(change({ value: 5, prev: 10 }), -0.5)
  assert.equal(change({ value: -5, prev: -10 }), 0.5)
  assert.equal(pointChange({ value: 0.6, prev: null }), null)
  assert.ok(Math.abs(pointChange({ value: 0.6, prev: 0.5 })! - 0.1) < 1e-9)
})

test('durations switch units at sensible places', () => {
  assert.equal(dur(null), '–')
  assert.equal(dur(0), '0m')
  assert.equal(dur(59), '59m')
  assert.equal(dur(60), '1.0h')
  assert.equal(dur(599), '10.0h')
  assert.equal(dur(600), '10h')
  assert.equal(dur(60 * 48), '2d')
  assert.equal(pct(0.995), '100%')
})

test('a minute just under the hour never reads as 60m', () => {
  assert.notEqual(dur(59.6), '60m')
})

test('scheduled report periods across year and leap boundaries', () => {
  assert.deepEqual(scheduleRange('monthly', '2027-01-01'), { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual(scheduleRange('monthly', '2028-03-01'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(scheduleRange('daily', '2027-01-01'), { from: '2026-12-31', to: '2026-12-31' })
  assert.deepEqual(scheduleRange('weekly', '2026-03-02'), { from: '2026-02-23', to: '2026-03-01' })
})

test('next run day across year end, and monthly from the 1st itself', () => {
  assert.equal(nextRunDay('monthly', '2026-12-15', false), '2027-01-01')
  assert.equal(nextRunDay('monthly', '2026-11-01', false), '2026-11-01')
  assert.equal(nextRunDay('monthly', '2026-11-01', true), '2026-12-01')
  assert.equal(nextRunDay('weekly', '2026-12-28', true), '2027-01-04')
})

test('report CSV: unicode survives, numbers stay numbers, negatives are not mistaken for formulas', () => {
  const csv = tableCsv({ columns: ['Agent', 'Δ'], rows: [['मदद 🤖', -3], ['متجر', 0]] })
  assert.match(csv, /मदद 🤖,-3\r\n/)
  assert.match(csv, /متجر,0\r\n/)
})

test('report CSV: tab and carriage-return prefixes are neutralised too (OWASP list)', () => {
  const csv = tableCsv({ columns: ['x'], rows: [['\t=1+1'], ['\r=1+1']] })
  assert.doesNotMatch(csv, /\r\n"?[\t\r]=/)
})
