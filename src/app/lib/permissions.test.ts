import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignableRoles, can, canSetRole, mayAssign } from './permissions.ts'

test('higher roles keep everything lower roles can do', () => {
  assert.ok(can('owner', 'whatsapp.manage'))
  assert.ok(!can('admin', 'whatsapp.manage'))
  assert.ok(can('admin', 'members.manage') && can('owner', 'members.manage'))
  assert.ok(can('supervisor', 'broadcasts.send') && !can('agent', 'broadcasts.send'))
  assert.ok(can('supervisor', 'chats.all') && !can('agent', 'chats.all'))
  assert.ok(!can(null, 'reports.view'))
})

test('admins manage everyone but owners, and never make owners', () => {
  assert.ok(canSetRole('owner', 'owner', 'agent'))
  assert.ok(canSetRole('admin', 'agent', 'admin'))
  assert.ok(!canSetRole('admin', 'owner', 'admin'))
  assert.ok(!canSetRole('admin', 'agent', 'owner'))
  assert.ok(!canSetRole('supervisor', 'agent', 'supervisor'))
  assert.deepEqual(assignableRoles('admin').map((r) => r.id), ['admin', 'supervisor', 'agent'])
  assert.deepEqual(assignableRoles('agent'), [])
})

test('agents take unassigned work or drop their own, never someone else\'s', () => {
  assert.ok(mayAssign('agent', 'me', 'me', null))
  assert.ok(mayAssign('agent', 'me', null, 'me'))
  assert.ok(!mayAssign('agent', 'me', 'me', 'other'))
  assert.ok(!mayAssign('agent', 'me', null, 'other'))
  assert.ok(!mayAssign('agent', 'me', 'other', null))
  assert.ok(mayAssign('supervisor', 'me', 'other', 'someone'))
})
