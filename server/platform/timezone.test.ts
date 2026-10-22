import assert from 'node:assert/strict'
import test from 'node:test'
import type http from 'node:http'
import { monthIn, setTimeZoneSource, workspaceTimeZone } from './timezone.ts'
import { HttpError, needUnmodified } from './http.ts'

test('monthIn: the month and its first instant in the zone', () => {
  // 31 Oct 20:00 UTC is already 1 Nov in Kolkata (+05:30).
  assert.deepEqual(monthIn('Asia/Kolkata', new Date('2026-10-31T20:00:00Z')), { month: '2026-11', start: new Date('2026-10-31T18:30:00Z') })
  assert.deepEqual(monthIn('UTC', new Date('2026-10-31T20:00:00Z')), { month: '2026-10', start: new Date('2026-10-01T00:00:00Z') })
  // New York: 1 Nov 2026 starts at EDT (-4), DST ends later that day.
  assert.deepEqual(monthIn('America/New_York', new Date('2026-11-15T12:00:00Z')), { month: '2026-11', start: new Date('2026-11-01T04:00:00Z') })
  // 1 Apr 2026 in New York is EDT although January was EST.
  assert.equal(monthIn('America/New_York', new Date('2026-04-02T12:00:00Z')).start.toISOString(), '2026-04-01T04:00:00.000Z')
})

test('workspaceTimeZone: falls back to UTC for a missing or unknown zone', async () => {
  setTimeZoneSource(async () => 'Asia/Kolkata')
  assert.equal(await workspaceTimeZone(), 'Asia/Kolkata')
  setTimeZoneSource(async () => 'Mars/Olympus')
  assert.equal(await workspaceTimeZone(), 'UTC')
  setTimeZoneSource(async () => {
    throw new Error('no db')
  })
  assert.equal(await workspaceTimeZone(), 'UTC')
  setTimeZoneSource(async () => 'UTC')
})

test('needUnmodified: 409 only when the stored copy is newer than what was read', () => {
  const req = (h?: string) => ({ headers: h ? { 'if-unmodified-since': h } : {} }) as http.IncomingMessage
  const stored = new Date('2026-10-22T10:00:00.500Z')
  needUnmodified(req(), stored)
  needUnmodified(req(stored.toISOString()), stored)
  needUnmodified(req('2026-10-22T10:00:00.000Z'), undefined)
  assert.throws(() => needUnmodified(req('2026-10-22T09:59:59.000Z'), stored), (e: unknown) => e instanceof HttpError && e.status === 409)
  assert.throws(() => needUnmodified(req('yesterday-ish'), stored), (e: unknown) => e instanceof HttpError && e.status === 400)
})
