// Run: node --test server/businessHours.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addBusinessMinutes, DEFAULT_HOURS, isOpen } from './businessHours.ts'

const ist = (s: string) => new Date(s + '+05:30')
const h = DEFAULT_HOURS // Mon–Fri 09:30–18:30, Sat 10:00–14:00, Sun closed, Asia/Kolkata

test('inside hours adds plain minutes', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-05T10:00'), 30, h).getTime(), ist('2026-10-05T10:30').getTime()) // Monday
})

test('time outside hours waits for the next opening', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-05T20:00'), 60, h).getTime(), ist('2026-10-06T10:30').getTime()) // Mon night → Tue
  assert.equal(addBusinessMinutes(ist('2026-10-05T08:00'), 15, h).getTime(), ist('2026-10-05T09:45').getTime()) // before opening
})

test('carries over closing time, Sunday and Saturday short hours', () => {
  assert.equal(addBusinessMinutes(ist('2026-10-09T18:00'), 60, h).getTime(), ist('2026-10-10T10:30').getTime()) // Fri 18:00 + 1h → Sat
  assert.equal(addBusinessMinutes(ist('2026-10-10T13:30'), 60, h).getTime(), ist('2026-10-12T10:00').getTime()) // Sat → skips Sun → Mon
})

test('holidays are skipped', () => {
  const hol = { ...h, holidays: ['2026-10-06'] }
  assert.equal(addBusinessMinutes(ist('2026-10-05T18:00'), 60, hol).getTime(), ist('2026-10-07T10:00').getTime())
})

test('isOpen follows the week and holidays', () => {
  assert.equal(isOpen(ist('2026-10-05T12:00'), h), true)
  assert.equal(isOpen(ist('2026-10-04T12:00'), h), false) // Sunday
  assert.equal(isOpen(ist('2026-10-05T18:30'), h), false) // closing minute
})

test('no open hours never comes due', () => {
  const closed = { ...h, week: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null } }
  assert.ok(addBusinessMinutes(ist('2026-10-05T10:00'), 10, closed).getTime() > Date.now() + 365 * 86_400_000)
})
