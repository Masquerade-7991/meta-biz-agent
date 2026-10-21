// The activity log (/api/activity): who did what, newest first. Dummy mode shows a few sample rows.
import { jsonClient } from './client'
import { isDummyMode } from './dummy'
import type { ActivityEvent, Area, Names } from '@/app/activity/activityText'

export interface ActivityQuery {
  entity?: 'ticket' | 'agent' | 'number'
  entityId?: string
  area?: Area | ''
  userId?: string
  from?: string
  to?: string
  /** An error reference (the 8 characters shown with an error). */
  ref?: string
}
interface ActivityPage {
  events: ActivityEvent[]
  more: boolean
  names: Names
}

const qs = (q: ActivityQuery, before?: string) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...q, before })) if (v) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
function dummy<T>(_m: string, path: string): Promise<T> {
  if (path.startsWith('/api/jobs/')) return Promise.resolve({ id: path.split('/')[3], type: 'reminder.fire', status: 'queued', attempts: 0 } as T)
  const u = new URL(path, 'http://x')
  const ticket = u.searchParams.get('entity') === 'ticket' ? u.searchParams.get('entityId') : null
  const n = ticket ?? '1042'
  const all: ActivityEvent[] = [
    { id: 'd6', at: ago(4), kind: 'ticket.updated', userId: 'demo', actor: 'Demo User', entity: 'ticket', entityId: n, data: { number: n }, changes: { priority: ['normal', 'urgent'] }, traceId: null },
    { id: 'd5', at: ago(18), kind: 'ticket.updated', userId: 'demo', actor: 'Demo User', entity: 'ticket', entityId: n, data: { number: n }, changes: { assigneeId: [null, 'demo'] }, traceId: null },
    { id: 'd4', at: ago(25), kind: 'ticket.created', userId: null, actor: null, entity: 'ticket', entityId: n, data: { number: n, source: 'handoff' }, traceId: null },
    { id: 'd3', at: ago(90), kind: 'agent.update', userId: 'demo', actor: 'Demo User', entity: 'agent', entityId: 'x', data: { resource: 'settings', 'rollout.enabled': true }, traceId: null },
    { id: 'd2', at: ago(300), kind: 'member.invited', userId: 'demo', actor: 'Demo User', entity: null, entityId: null, data: { email: 'asha@example.com', role: 'agent' }, traceId: null },
    { id: 'd1', at: ago(1440), kind: 'settings.updated', userId: 'demo', actor: 'Demo User', entity: null, entityId: null, data: { area: 'support' }, changes: { hours: [{}, { x: 1 }] }, traceId: null },
  ]
  const events = ticket ? all.filter((e) => e.entity === 'ticket') : all
  return Promise.resolve({ events, more: false, names: { demo: 'Demo User' } } as T)
}

const call = jsonClient(dummy)
export const listActivity = (q: ActivityQuery, before?: string) => call<ActivityPage>(`/api/activity${qs(q, before)}`)
/** Puts a background task that gave up back in the queue (owners and admins). */
export const retryJob = (id: string) => call<{ id: string; type: string; status: string; attempts: number }>(`/api/jobs/${id}/retry`, 'POST')
/** The CSV of the same filters (a download link; not available in dummy mode). */
export const activityCsvUrl = (q: ActivityQuery) => (isDummyMode() ? null : `/api/activity.csv${qs(q)}`)
