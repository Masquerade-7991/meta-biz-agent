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
  // Settings revamp (2026-10-22): data as server/identity/auth.ts, messaging/inbox.ts and support/* send it.
  [ev('workspace.renamed', { entity: 'workspace', entityId: 'w1', data: { name: 'Helo Store' }, changes: { name: ['Helo', 'Helo Store'] } }), 'Priya renamed the workspace to “Helo Store”'],
  [ev('workspace.transferred', { entity: 'member', entityId: 'u2', data: { name: 'Arjun', stepDown: true }, changes: { ownerId: ['u1', 'u2'], role: ['admin', 'owner'] } }), 'Priya made Arjun an owner and stepped down to admin'],
  [ev('workspace.transferred', { entity: 'member', entityId: 'u2', data: { name: 'Arjun', stepDown: false } }), 'Priya made Arjun an owner'],
  [ev('member.invite_resent', { data: { email: 'a@b.co', role: 'agent' } }), 'Priya resent the invite to a@b.co'],
  [ev('member.signup_cancelled', { data: { email: 'a@b.co' } }), "Priya cancelled a@b.co's sign-up"],
  [ev('profile.name_changed', { entity: 'member', entityId: 'u1' }), 'Priya changed their name'],
  [ev('profile.email_changed', { entity: 'member', entityId: 'u1' }), 'Priya changed their login email and was logged out elsewhere'],
  [ev('profile.password_changed', { data: { tokensRevoked: 2 } }), 'Priya changed their password (2 API tokens revoked)'],
  [ev('profile.password_changed', { data: { reset: true, tokensRevoked: 0 } }), 'Priya reset their password'],
  [ev('session.revoked', { data: { count: 2, others: true } }), 'Priya signed out 2 other devices'],
  [ev('session.revoked', { data: { count: 1, current: false } }), 'Priya signed out a device'],
  [ev('session.revoked', { data: { count: 1, current: true } }), 'Priya signed out this device'],
  [ev('canned.created', { entity: 'canned', entityId: 'c1', data: { title: 'Refunds', shortcut: '/refund', shared: true } }), 'Priya created the shared canned response /refund'],
  [ev('canned.updated', { entity: 'canned', entityId: 'c1', data: { title: 'Refunds', shortcut: '/refund' }, changes: { shared: [true, false] } }), 'Priya changed the canned response /refund: sharing from on to off'],
  [ev('canned.updated', { entity: 'canned', entityId: 'c1', data: { title: 'Refunds', shortcut: '/refund', bodyChanged: true } }), 'Priya changed the canned response /refund: the message'],
  [ev('canned.deleted', { entity: 'canned', entityId: 'c1', data: { title: 'Refunds', shortcut: '/refund', shared: false } }), 'Priya deleted the canned response /refund'],
  [sys('canned.deleted', { entity: 'member', entityId: 'u2', data: { count: 3, reason: 'member_left' } }), '3 private canned responses removed: their owner left'],
  [ev('segment.created', { entity: 'segment', entityId: 's1', data: { name: 'VIPs' } }), 'Priya saved the segment “VIPs”'],
  [ev('segment.deleted', { entity: 'segment', entityId: 's1', data: { name: 'VIPs' } }), 'Priya deleted the segment “VIPs”'],
  [ev('segment.deleted', { entity: 'segment', entityId: 's2', data: { name: 'North only', reason: 'field_removed' } }), 'The segment “North only” was deleted: its only filter was a contact field that was removed'],
  [ev('support.recomputed', { data: { updated: 12 } }), 'Priya applied new hours and targets to 12 open tickets'],
  [ev('settings.updated', { data: { area: 'support', fields: ['hours.week.mon', 'sla.urgent'] }, changes: { 'hours.week.mon': [{ open: '09:00', close: '18:00' }, null], 'sla.urgent': [{ firstResponse: 15 }, { firstResponse: 10 }] } }), "Priya changed support settings: Monday's hours and urgent response times"],
  [ev('settings.updated', { data: { area: 'routing_rules', count: 3, added: ['Refunds'], removed: ['Old'], changed: [], reordered: true } }), 'Priya changed routing rules: added “Refunds”, removed “Old” and changed the order'],
  [ev('settings.updated', { data: { area: 'contact_fields', count: 1, added: [], removed: ['City'], valuesCleared: 40 } }), 'Priya changed contact fields: removed “City” and cleared 40 contact values'],
  [ev('settings.updated', { data: { area: 'escalation', enabled: true }, changes: { 'levels.urgent': [[], [{ percent: 75 }]] } }), 'Priya changed escalation rules: urgent escalation levels'],
  [ev('settings.updated', { data: { area: 'billing' }, changes: { budget: [5000, 8000] } }), 'Priya changed billing settings: budget from 5000 to 8000'],
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

test('every kind the settings revamp added is in an area (the log hides kinds no area lists)', () => {
  const prefixes = Object.values(AREAS).flatMap((a) => a.kinds as readonly string[])
  for (const kind of ['workspace.renamed', 'workspace.transferred', 'member.invite_resent', 'member.signup_cancelled', 'profile.name_changed', 'profile.email_changed', 'profile.password_changed', 'canned.created', 'canned.updated', 'canned.deleted', 'segment.created', 'segment.deleted', 'session.revoked', 'support.recomputed'])
    assert.ok(prefixes.some((p) => kind.startsWith(p)), kind)
})

test('sign-ins have their own area, not Team & members', () => {
  const inArea = (area: keyof typeof AREAS, kind: string) => (AREAS[area].kinds as readonly string[]).some((p) => kind.startsWith(p))
  assert.ok(inArea('signins', 'member.logged_in'))
  assert.ok(!inArea('people', 'member.logged_in'))
  assert.ok(!inArea('people', 'member.switched_in'))
  for (const kind of ['member.invited', 'member.invite_revoked', 'member.joined', 'member.left', 'member.removed', 'member.role_changed', 'member.updated']) assert.ok(inArea('people', kind), kind)
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
