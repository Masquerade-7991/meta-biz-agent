// Run: node --test src/app/support/hoursRules.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { holidayOf, hoursErrors, noHours, pastHoliday, supportSettingsError, timeZones, validDate } from './hoursRules.ts'
import type { SupportSettings } from '../api/tickets.ts'

const base = (): SupportSettings => ({
  hours: { timezone: 'Asia/Kolkata', week: { sun: null, mon: { open: '09:30', close: '18:30' }, tue: null, wed: null, thu: null, fri: null, sat: null }, holidays: [] },
  awayMessage: '',
  sla: { urgent: { firstResponse: 15, resolve: 240 }, high: { firstResponse: 30, resolve: 480 }, normal: { firstResponse: 60, resolve: 1440 }, low: { firstResponse: 240, resolve: 2880 } },
  routing: { mode: 'round_robin', teamId: null, userId: null },
  teams: [],
  csat: { enabled: false, question: '' },
  restrictAgents: false,
  aiSummary: false,
})

test('a valid week has no problems', () => assert.deepEqual(hoursErrors(base()), {}))

test('each problem is named on its own field, in plain words', () => {
  const s = base()
  s.hours.timezone = 'Mars/Olympus'
  s.hours.week.mon = { open: '18:00', close: '09:00' }
  s.sla.high = { firstResponse: Number.NaN, resolve: 480 }
  s.sla.low = { firstResponse: 240, resolve: 60 }
  s.routing = { mode: 'fixed', teamId: null, userId: null }
  const e = hoursErrors(s)
  assert.match(e.timezone, /time zone/)
  assert.equal(e['day.mon'], 'Monday: closing time must be after opening.')
  assert.match(e['sla.high.firstResponse'], /whole minutes/)
  assert.equal(e['sla.low.resolve'], 'Low: resolve can’t be sooner than the first reply.')
  assert.match(e.routing, /person/)
})

test('a 24-hour day is valid', () => {
  const s = base()
  s.hours.week.mon = { open: '00:00', close: '24:00' }
  assert.deepEqual(hoursErrors(s), {})
})

test('an all-closed week needs 24/7 or a confirmation', () => {
  const s = base()
  s.hours.week.mon = null
  assert.ok(noHours(s))
  assert.match(supportSettingsError(s, false) ?? '', /never run/)
  assert.equal(supportSettingsError(s, true), null)
  assert.ok(!noHours({ ...s, twentyFourSeven: true }))
})

test('holidays: old bare dates and named yearly ones; past and invalid dates', () => {
  assert.deepEqual(holidayOf('2026-11-01'), { date: '2026-11-01', name: '', yearly: false })
  assert.deepEqual(holidayOf({ date: '2026-11-01', name: 'Diwali', yearly: true }), { date: '2026-11-01', name: 'Diwali', yearly: true })
  assert.ok(validDate('2028-02-29'))
  assert.ok(!validDate('2027-02-29'))
  assert.ok(!validDate('2026-13-01'))
  assert.ok(pastHoliday('2026-01-01', false, '2026-10-22'))
  assert.ok(!pastHoliday('2026-01-01', true, '2026-10-22'))
  const s = base()
  s.hours.holidays = ['2026-02-30']
  assert.ok(hoursErrors(s).holiday)
})

test('the time-zone list is the full IANA list, with UTC', () => {
  const z = timeZones()
  assert.ok(z.length > 300)
  assert.ok(z.includes('UTC') && z.includes('Asia/Kolkata') && z.includes('America/Argentina/Buenos_Aires'))
})
