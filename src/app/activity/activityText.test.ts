import assert from 'node:assert/strict'
import test from 'node:test'
import { activityText, changesText, type ActivityEvent } from './activityText.ts'

const ev = (x: Partial<ActivityEvent>): ActivityEvent => ({ id: '1', at: '2026-10-12T10:00:00Z', kind: 'x', userId: 'u1', actor: 'Priya', entity: null, entityId: null, data: {}, traceId: null, ...x })
const names = { u1: 'Priya', u2: 'Arjun', 'team:t1': 'Billing' }

test('a ticket edit reads as before → after in the console’s words', () => {
  const e = ev({ kind: 'ticket.updated', entity: 'ticket', entityId: '1042', data: { number: 1042 }, changes: { priority: ['normal', 'urgent'], assigneeId: [null, 'u2'] } })
  assert.equal(activityText(e, names), 'Priya changed priority from Normal to Urgent and assignee from nobody to Arjun on #1042')
  assert.equal(changesText({ status: ['open', 'pending'] }), 'status from Open to Waiting on customer')
  assert.equal(changesText({ teamId: ['t1', null] }, names), 'team from Billing to none')
})

test('nested settings are named, not spelled out', () => {
  const e = ev({ kind: 'settings.updated', data: { area: 'support' }, changes: { hours: [{ a: 1 }, { a: 2 }], restrictAgents: [false, true] } })
  assert.equal(activityText(e), 'Priya changed support settings: business hours and who sees which chats from off to on')
})

test('system events and people who left still read well', () => {
  assert.equal(activityText(ev({ kind: 'ticket.resolved', userId: null, actor: null, data: { number: 7, reason: 'handed_back' } })), '#7 resolved: the chat went back to the AI agent')
  assert.equal(activityText(ev({ kind: 'ticket.updated', userId: 'gone', actor: null, data: { number: 7 }, changes: { status: ['pending', 'open'] } })), 'A former member changed status from Waiting on customer to Open on #7')
  assert.equal(activityText(ev({ kind: 'member.role_changed', entity: 'member', entityId: 'u2', data: { name: 'Arjun' }, changes: { role: ['agent', 'admin'] } })), "Priya changed Arjun's role from Agent to Admin")
  assert.equal(activityText(ev({ kind: 'agent.update', data: { resource: 'settings', 'rollout.enabled': true } })), 'Priya published the AI agent')
  assert.equal(activityText(ev({ kind: 'agent.create', data: { resource: 'faq', question: 'Do you ship?' } })), 'Priya added the AI agent\'s faq “Do you ship?”')
  assert.match(activityText(ev({ kind: 'some.new_thing' })), /^Priya: some new thing$/)
})
