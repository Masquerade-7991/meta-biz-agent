// Run: node --test server/reports.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRunDay, reportTable, scheduleRange, tableCsv } from '../src/app/reports/catalog.ts'

test('CSV opens in Excel and never runs a formula', () => {
  const csv = tableCsv({ columns: ['Name', 'Count'], rows: [['=HYPERLINK("x")', 3], ['Riya, "R"', null], ['plain', 1.5]] })
  assert.ok(csv.startsWith('﻿Name,Count\r\n'))
  assert.match(csv, /"'=HYPERLINK\(""x""\)",3\r\n/)
  assert.match(csv, /"Riya, ""R""",\r\n/)
  assert.match(csv, /plain,1\.5\r\n$/)
})

test('a log report is its columns and rows in order', () => {
  const t = reportTable('tickets', null, { kind: 'tickets', total: 1, columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', numeric: true }], rows: [{ b: 2, a: 'x' }] })
  assert.deepEqual(t, { columns: ['A', 'B'], rows: [['x', 2]] })
})

test('scheduled periods: yesterday, last 7 days, last month', () => {
  assert.deepEqual(scheduleRange('daily', '2026-10-12'), { from: '2026-10-11', to: '2026-10-11' })
  assert.deepEqual(scheduleRange('weekly', '2026-10-12'), { from: '2026-10-05', to: '2026-10-11' })
  assert.deepEqual(scheduleRange('monthly', '2026-10-01'), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(scheduleRange('monthly', '2026-03-01'), { from: '2026-02-01', to: '2026-02-28' })
})

test('next run day follows the cadence', () => {
  assert.equal(nextRunDay('daily', '2026-10-10', false), '2026-10-10')
  assert.equal(nextRunDay('daily', '2026-10-10', true), '2026-10-11')
  assert.equal(nextRunDay('weekly', '2026-10-10', false), '2026-10-12') // Saturday → Monday
  assert.equal(nextRunDay('weekly', '2026-10-12', true), '2026-10-19')
  assert.equal(nextRunDay('monthly', '2026-10-10', false), '2026-11-01')
})
