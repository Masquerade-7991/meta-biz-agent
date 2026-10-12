// Run: node --test server/businessHours.edges.test.ts
// Edges of SLA business-hours maths: daylight saving, holidays, odd weeks and boundaries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addBusinessMinutes, DEFAULT_HOURS, isOpen, type Hours } from './businessHours.ts'

const closedWeek: Hours['week'] = { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null }
const hours = (timezone: string, week: Partial<Hours['week']>, holidays: string[] = []): Hours => ({ timezone, week: { ...closedWeek, ...week }, holidays })
const nineToFive = { open: '09:00', close: '17:00' }
const weekdays = { mon: nineToFive, tue: nineToFive, wed: nineToFive, thu: nineToFive, fri: nineToFive }
const iso = (d: Date) => d.toISOString()

test('zero minutes answers the start, cut to the minute', () => {
  const start = new Date('2026-10-05T04:30:45.900Z') // Monday 10:00:45 IST
  assert.equal(iso(addBusinessMinutes(start, 0, DEFAULT_HOURS)), '2026-10-05T04:30:00.000Z')
})

test('a deadline counted from before opening lands inside the working day', () => {
  // Monday 09:00 IST, 30 minutes → opens 09:30, due 10:00
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-05T03:30:00Z'), 30, DEFAULT_HOURS)), '2026-10-05T04:30:00.000Z')
})

test('a target exactly as long as the working day ends at closing time, not the next morning', () => {
  const h = hours('UTC', weekdays)
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-05T09:00:00Z'), 8 * 60, h)), '2026-10-05T17:00:00.000Z')
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-05T09:00:00Z'), 8 * 60 + 1, h)), '2026-10-06T09:01:00.000Z')
})

test('weekends and back-to-back holidays are skipped in the workspace’s own time zone', () => {
  const h = hours('Europe/London', weekdays, ['2026-12-25', '2026-12-28'])
  // Thu 24 Dec 16:30 + 60 min: 30 today, Fri 25th holiday, weekend, Mon 28th holiday → Tue 29th 09:30
  assert.equal(iso(addBusinessMinutes(new Date('2026-12-24T16:30:00Z'), 60, h)), '2026-12-29T09:30:00.000Z')
})

test('the year turns over without losing a day', () => {
  const h = hours('UTC', weekdays, ['2027-01-01'])
  // Thu 31 Dec 16:00 + 120 min → 60 today, Fri 1 Jan holiday → Mon 4 Jan 10:00
  assert.equal(iso(addBusinessMinutes(new Date('2026-12-31T16:00:00Z'), 120, h)), '2027-01-04T10:00:00.000Z')
})

test('spring forward: a closed night is jumped and the next opening is local 09:00', () => {
  // New York, Sat 7 Mar 2026 20:00 EST; Sunday is the 23-hour day. Monday opens 09:00 EDT = 13:00Z.
  const h = hours('America/New_York', weekdays)
  assert.equal(iso(addBusinessMinutes(new Date('2026-03-08T01:00:00Z'), 15, h)), '2026-03-09T13:15:00.000Z')
})

test('fall back: the 25-hour Sunday still opens Monday at local 09:00', () => {
  // New York, DST ends Sun 1 Nov 2026 02:00 EDT → 01:00 EST. Monday 09:00 EST = 14:00Z.
  const h = hours('America/New_York', weekdays)
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-31T22:00:00Z'), 15, h)), '2026-11-02T14:15:00.000Z')
})

test('India has no daylight saving: the same wall time all year', () => {
  assert.equal(iso(addBusinessMinutes(new Date('2026-03-08T04:00:00Z'), 30, DEFAULT_HOURS)), '2026-03-09T04:30:00.000Z') // Sun → Mon 10:00 IST
  assert.equal(iso(addBusinessMinutes(new Date('2026-11-01T04:00:00Z'), 30, DEFAULT_HOURS)), '2026-11-02T04:30:00.000Z')
})

test('working hours that span the spring-forward hour count only real minutes', { todo: 'QA-09: the jump skips 02:00–03:00 but the step adds wall minutes as real ones' }, () => {
  // Sundays 01:00–04:00 New York. On 8 Mar 2026 that window holds 120 real minutes (02:00–03:00 doesn't exist).
  const h = hours('America/New_York', { sun: { open: '01:00', close: '04:00' } })
  const due = addBusinessMinutes(new Date('2026-03-08T06:00:00Z'), 150, h) // 01:00 EST
  // 120 minutes on the 8th, the other 30 the next Sunday from 01:00 EDT (05:00Z).
  assert.equal(iso(due), '2026-03-15T05:30:00.000Z')
})

test('a holiday on every open day, or no open day at all, never comes due', () => {
  const satOnly = hours('UTC', { sat: { open: '10:00', close: '11:00' } }, ['2026-10-10'])
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-09T00:00:00Z'), 30, satOnly)), '2026-10-17T10:30:00.000Z') // next Saturday
  assert.ok(+addBusinessMinutes(new Date('2026-10-09T00:00:00Z'), 30, hours('UTC', {})) > Date.now() + 100 * 365 * 86_400_000)
})

test('a day whose closing time is not after opening counts as closed (the settings form refuses overnight shifts)', () => {
  const h = hours('UTC', { mon: { open: '22:00', close: '06:00' }, tue: { open: '10:00', close: '10:00' }, wed: nineToFive })
  assert.equal(isOpen(new Date('2026-10-05T23:00:00Z'), h), false)
  assert.equal(isOpen(new Date('2026-10-06T10:00:00Z'), h), false)
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-05T23:00:00Z'), 10, h)), '2026-10-07T09:10:00.000Z')
})

test('the opening minute is open and the closing minute is not', () => {
  const h = hours('Asia/Kolkata', weekdays)
  assert.equal(isOpen(new Date('2026-10-05T03:30:00Z'), h), true) // 09:00 IST
  assert.equal(isOpen(new Date('2026-10-05T03:29:00Z'), h), false)
  assert.equal(isOpen(new Date('2026-10-05T11:30:00Z'), h), false) // 17:00 IST
})

test('a 24-hour day (00:00–24:00 is not accepted, 00:00–23:59 is) loses only the last minute', () => {
  const h = hours('UTC', { mon: { open: '00:00', close: '23:59' }, tue: { open: '00:00', close: '23:59' } })
  assert.equal(iso(addBusinessMinutes(new Date('2026-10-05T23:58:00Z'), 2, h)), '2026-10-06T00:01:00.000Z')
})
