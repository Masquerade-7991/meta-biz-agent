// Run: node --test src/app/reports/catalog.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOG_KINDS } from '../analytics/types.ts'
import { isLogReport, logKindOf, recordsOf, RENAMED, REPORT_GROUPS, REPORTS, reportOfLog, resolveReport, type ReportFilter } from './catalog.ts'

test('every report sits in a group with valid filters; records read a log, summaries drill down to records', () => {
  const groups = new Set<string>(REPORT_GROUPS.map((g) => g.id))
  const filters = new Set<ReportFilter>(['agents', 'team', 'person'])
  for (const r of REPORTS) {
    assert.ok(groups.has(r.group), r.id)
    assert.equal(r.group === 'records', isLogReport(r.id), r.id)
    assert.ok((r.filters as readonly string[]).includes('agents'), r.id)
    assert.ok(r.filters.every((f) => filters.has(f)), r.id)
    if (r.group === 'summary') assert.equal(isLogReport(recordsOf(r.id)!), true, r.id)
  }
})

test('every log has its record report', () => {
  for (const k of LOG_KINDS) assert.equal(logKindOf(reportOfLog(k)), k)
})

test('old report ids land on their new report', () => {
  assert.equal(resolveReport('daily'), 'business_review')
  assert.equal(resolveReport('agents'), 'ai_agent')
  assert.equal(resolveReport('people'), 'team')
  assert.equal(resolveReport('teams'), 'team')
  assert.equal(resolveReport('consumption'), 'spend')
  assert.equal(resolveReport('tickets'), 'tickets')
  assert.equal(resolveReport('nonsense'), null)
  assert.equal(resolveReport('toString'), null)
  for (const to of Object.values(RENAMED)) assert.ok(REPORTS.some((r) => r.id === to))
})
