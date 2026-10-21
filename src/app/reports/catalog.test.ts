// Run: node --test src/app/reports/catalog.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLogReport, REPORT_GROUPS, REPORTS } from './catalog.ts'

test('every report sits in a group, records are the logs, and each filters by agents at least', () => {
  const groups = new Set(REPORT_GROUPS.map((g) => g.id))
  for (const r of REPORTS) {
    assert.ok(groups.has(r.group), r.id)
    assert.equal(r.group === 'records', isLogReport(r.id), r.id)
    assert.ok((r.filters as readonly string[]).includes('agents'), r.id)
  }
})

