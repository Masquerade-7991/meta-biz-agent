// Run: node --test src/app/activity/activityText.kinds.test.ts
// Every event kind the server writes (grep "trace(" in server/), with the data it really sends,
// reads as a sentence: no "undefined", no "null", no raw kind names in the areas people filter by.
import assert from 'node:assert/strict'
import test from 'node:test'
import { activityText, AREAS, isArea, type ActivityEvent } from './activityText.ts'

const names = { u1: 'Priya', u2: 'Arjun', 'team:t1': 'Billing' }
const ev = (kind: string, x: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: '1', at: '2026-10-12T10:00:00Z', kind, userId: 'u1', actor: 'Priya', entity: null, entityId: null, data: {}, traceId: null, ...x })
const sys = (kind: string, x: Partial<ActivityEvent> = {}) => ev(kind, { userId: null, actor: null, ...x })
const ticket = (n: number) => ({ entity: 'ticket', entityId: String(n) })

/** [event as the server emits it, expected sentence]. Data copied from each trace() call site. */
const CASES: [ActivityEvent, string][] = [
  [sys('ticket.created', { ...ticket(1001), data: { number: 1001, source: 'handoff', priority: 'normal', assigned: true, rule: null } }), 'Ticket #1001 opened: the AI handed the chat over'],
  [ev('ticket.created', { ...ticket(1002), data: { number: 1002, source: 'manual' } }), 'Priya opened ticket #1002'],
  [ev('ticket.updated', { ...ticket(1001), data: { number: 1001 }, changes: { tags: [[], ['vip', 'billing']] } }), 'Priya changed tags from none to vip, billing on #1001'],
  [sys('ticket.updated', { ...ticket(1001), data: { number: 1001, reason: 'customer' }, changes: { status: ['pending', 'open'] } }), 'The system changed status from Waiting on customer to Open on #1001'],
  [ev('ticket.updated', { ...ticket(1001), data: { number: 1001, reason: 'member_left' }, changes: { assigneeId: ['u2', null] } }), '#1001 was unassigned because its assignee left the workspace'],
  [ev('ticket.resolved', { ...ticket(1001), data: { number: 1001, askCsat: true, handBack: true } }), 'Priya resolved #1001 and asked for a rating'],
  [sys('ticket.reopened', { ...ticket(1001), data: { number: 1001, reason: 'customer' } }), '#1001 reopened: the customer wrote again'],
  [sys('ticket.escalated', { ...ticket(1001), data: { number: 1001, level: 2, notified: 3 } }), '#1001 escalated to level 2'],
  [sys('ticket.rated', { ...ticket(1001), data: { number: 1001, score: 3, label: 'Good' } }), 'The customer rated #1001 good'],
  [ev('conversation.updated', { entity: 'conversation', entityId: '919800000001', data: { action: 'control', to: 'take' } }), 'Priya took over a chat from the AI agent'],
  [ev('conversation.updated', { data: { action: 'assign' } }), 'Priya assigned a chat'],
  [sys('conversation.updated', { data: { action: 'woke', by: 'time' } }), 'The system woke a snoozed chat'],
  [ev('customer.linked', { data: { merged: true } }), "Priya linked a customer's records"],
  [ev('member.invited', { data: { role: 'supervisor', email: 'a@b.co' } }), 'Priya invited a@b.co as Supervisor'],
  [ev('member.invite_revoked', { data: { email: 'a@b.co' } }), 'Priya cancelled the invite for a@b.co'],
  [ev('member.invite_declined', { data: { email: 'a@b.co' } }), 'a@b.co declined the invite'],
  [ev('member.joined', { data: { role: 'agent', name: 'Priya' } }), 'Priya joined as Agent'],
  [ev('member.left', { data: { name: 'Priya' } }), 'Priya left the workspace'],
  [ev('member.removed', { entity: 'member', entityId: 'u2', data: { name: 'Arjun', email: 'a@b.co' } }), 'Priya removed Arjun from the workspace'],
  [ev('member.updated', { entity: 'member', entityId: 'u2', data: {}, changes: { availability: ['online', 'away'] } }), "Priya changed Arjun's availability from online to away"],
  [ev('member.logged_in'), 'Priya logged in'],
  [ev('member.switched_in'), 'Priya switched to this workspace'],
  [ev('team.created', { data: { name: 'Billing' } }), 'Priya created the team “Billing”'],
  [ev('team.updated', { data: { name: 'Billing' }, changes: { memberIds: [['u1'], ['u1', 'u2']] } }), 'Priya changed the team “Billing”: members from Priya to Priya, Arjun'],
  [ev('team.deleted', { data: { name: 'Billing' } }), 'Priya deleted the team “Billing”'],
  [ev('contact.created', { entity: 'contact', entityId: '919800000001' }), 'Priya added the contact +919800000001'],
  [ev('contact.updated', { entity: 'contact', entityId: '919800000001', data: { fields: ['name', 'tags'] } }), 'Priya edited the contact +919800000001 (name, tags)'],
  [ev('contact.deleted', { entity: 'contact', entityId: '919800000001' }), 'Priya deleted the contact +919800000001 and their chat history'],
  [ev('contact.imported', { data: { added: 3, updated: 1, skipped: 0 } }), 'Priya imported contacts: 3 added, 1 updated, 0 skipped'],
  [ev('template.created', { data: { name: 'order_update' } }), 'Priya submitted the template “order_update” for review'],
  [ev('template.deleted', { data: { name: 'order_update' } }), 'Priya deleted the template “order_update”'],
  [ev('report.scheduled', { data: { name: 'Weekly' } }), 'Priya scheduled the report email “Weekly”'],
  [sys('report.sent', { data: { reports: 2, recipients: 1, failed: 0, dropped: 0, cadence: 'weekly' } }), 'Report email sent to 1 person'],
  [ev('report.downloaded', { data: { report: 'business_review' } }), 'Priya downloaded the business review report'],
  [ev('settings.updated', { data: { area: 'routing_rules', count: 2 } }), 'Priya changed routing rules'],
  [ev('settings.updated', { data: { area: 'billing', budget: true } }), 'Priya changed billing settings'],
  [ev('whatsapp.connected', { data: { wabaId: '1', flow: 'signup' } }), 'Priya connected a WhatsApp account'],
  [ev('whatsapp.disconnected', { data: { wabaId: '1', name: 'Helo Store' } }), 'Priya disconnected the WhatsApp account Helo Store'],
  [sys('number.quality', { data: { phoneNumberId: '1', from: 'GREEN', to: 'YELLOW' } }), "A number's quality changed from GREEN to YELLOW"],
  [sys('account.notice', { data: { field: 'account_update', event: 'DISABLED_UPDATE', detail: null } }), 'Meta sent an account notice'],
  [sys('alert.raised', { data: { key: 'member_left:u2', severity: 'warning', target: 'members' } }), 'Alert raised: member left'],
  [ev('webhook.baseline_reset'), 'Priya marked the apps receiving events as expected'],
]

test('every emitted event reads as the sentence people expect', () => {
  for (const [e, want] of CASES) assert.equal(activityText(e, names), want, e.kind)
})

test('no sentence leaks undefined, null or NaN', () => {
  for (const [e] of CASES) assert.doesNotMatch(activityText(e, names), /undefined|null|NaN|\[object/, e.kind)
})

test('every kind people can filter to has its own sentence, not the raw kind', () => {
  const e = sys('template.status', { entity: 'template', entityId: 'order_update', data: { name: 'order_update', language: 'en', event: 'APPROVED', reason: null } })
  assert.doesNotMatch(activityText(e, names), /: template status$/)
})

test('number history events (block, PIN, registration) belong to an area of the workspace log', () => {
  const prefixes = Object.values(AREAS).flatMap((a) => a.kinds as readonly string[])
  for (const kind of ['number.blocked', 'number.unblocked', 'number.pin_viewed', 'number.pin_changed', 'number.registered', 'number.deregistered', 'number.profile_updated'])
    assert.ok(prefixes.some((p) => kind.startsWith(p)), kind)
})

test('an area name from the query string is checked against the list, not the prototype', () => {
  assert.ok(isArea('tickets'))
  assert.ok(!isArea('toString'))
  assert.ok(!isArea('constructor'))
  assert.ok(!isArea(undefined))
})

test('people who left and system actors read sensibly', () => {
  assert.equal(activityText(ev('ticket.resolved', { userId: 'gone', actor: null, data: { number: 7 } }), names), 'A former member resolved #7')
  assert.equal(activityText(sys('ticket.updated', { data: { number: 7 }, changes: { assigneeId: [null, 'gone'] } }), names), 'The system changed assignee from nobody to a former member on #7')
})

test('unicode names and RTL text pass through untouched', () => {
  const e = ev('team.created', { actor: 'محمد', data: { name: 'دعم 🛟' } })
  assert.equal(activityText(e, names), 'محمد created the team “دعم 🛟”')
})
