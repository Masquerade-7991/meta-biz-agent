// Run: node --test server/analytics.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayStart } from './analytics.ts'
import { addDays, csatScore, dayList, daysBetween, median } from '../src/app/analytics/types.ts'

test('a local day starts at local midnight', () => {
  assert.equal(dayStart('2026-10-05', 'Asia/Kolkata').toISOString(), '2026-10-04T18:30:00.000Z')
  assert.equal(dayStart('2026-10-05', 'UTC').toISOString(), '2026-10-05T00:00:00.000Z')
  // Daylight saving: New York is UTC-4 in October and UTC-5 in December.
  assert.equal(dayStart('2026-10-05', 'America/New_York').toISOString(), '2026-10-05T04:00:00.000Z')
  assert.equal(dayStart('2026-12-05', 'America/New_York').toISOString(), '2026-12-05T05:00:00.000Z')
})

test('day arithmetic', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30')
  assert.equal(daysBetween('2026-10-01', '2026-10-30'), 30)
  assert.deepEqual(dayList('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
})

test('median and satisfaction', () => {
  assert.equal(median([]), null)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(csatScore(0, 0, 0), null)
  assert.equal(csatScore(2, 2, 0), 0.75)
})

test('filters reject dates that match the pattern but are not real days', async () => {
  const { parseFilter } = await import('./analytics.ts')
  const url = (q: string) => new URL('http://x/api/analytics/overview?' + q)
  assert.throws(() => parseFilter(url('from=2026-02-31&to=2026-03-05'), 'UTC'), /must be dates/)
  assert.throws(() => parseFilter(url('from=2026-13-45&to=2026-03-05'), 'UTC'), /must be dates/)
  assert.throws(() => parseFilter(url('from=2026-03-05&to=2026-03-01'), 'UTC'), /not after/)
  assert.deepEqual(parseFilter(url('from=2026-02-28&to=2026-03-01'), 'UTC').from, '2026-02-28')
})
