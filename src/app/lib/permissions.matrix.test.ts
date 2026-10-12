// Run: node --test src/app/lib/permissions.matrix.test.ts
// The whole permission matrix, role by role, so a change to one line is a visible diff here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignableRoles, can, canSetRole, isRole, mayAssign, ROLES, roleLabel, type Action, type Role } from './permissions.ts'

const R: Role[] = ['owner', 'admin', 'supervisor', 'agent']
/** The lowest role allowed each action (PRD roles table; server/openapi "who" lines are built from it). */
const LOWEST: Record<Action, Role> = {
  'whatsapp.manage': 'owner',
  'billing.manage': 'owner',
  'members.manage': 'admin',
  'settings.manage': 'admin',
  'automation.manage': 'admin',
  'agent.edit': 'admin',
  'templates.delete': 'admin',
  'billing.view': 'admin',
  'numbers.edit': 'admin',
  'alerts.receive': 'admin',
  'traces.read': 'admin',
  'broadcasts.send': 'supervisor',
  'templates.create': 'supervisor',
  'contacts.manage': 'supervisor',
  'chats.all': 'supervisor',
  'tickets.reassign': 'supervisor',
  'reports.view': 'supervisor',
  'numbers.view': 'supervisor',
}
const rank = (r: Role) => R.length - 1 - R.indexOf(r)

test('every action is allowed from its lowest role up, and never below', () => {
  for (const [action, lowest] of Object.entries(LOWEST) as [Action, Role][])
    for (const role of R) assert.equal(can(role, action), rank(role) >= rank(lowest), `${role} ${action}`)
})

test('no role, an empty role or a made-up role can do nothing', () => {
  for (const action of Object.keys(LOWEST) as Action[]) {
    assert.equal(can(null, action), false)
    assert.equal(can(undefined, action), false)
    assert.equal(can('' as Role, action), false)
    assert.equal(can('superuser' as Role, action), false)
  }
})

test('role changes: every actor × from × to', () => {
  for (const from of R)
    for (const to of R) {
      assert.equal(canSetRole('owner', from, to), true, `owner ${from}→${to}`)
      assert.equal(canSetRole('admin', from, to), from !== 'owner' && to !== 'owner', `admin ${from}→${to}`)
      assert.equal(canSetRole('supervisor', from, to), false)
      assert.equal(canSetRole('agent', from, to), false)
      assert.equal(canSetRole(null, from, to), false)
    }
})

test('who an owner can invite as', () => {
  assert.deepEqual(assignableRoles('owner').map((r) => r.id), R)
  assert.deepEqual(assignableRoles('supervisor'), [])
})

test('moving work: every role × from × to', () => {
  const people = [null, 'me', 'other'] as const
  for (const role of R)
    for (const from of people)
      for (const to of people) {
        const want = role === 'owner' || role === 'admin' || role === 'supervisor' ? true : (!from || from === 'me') && (to === null || to === 'me')
        assert.equal(mayAssign(role, 'me', to, from), want, `${role} ${from}→${to}`)
      }
})

test('isRole accepts the four roles and nothing else', () => {
  for (const r of R) assert.ok(isRole(r))
  for (const v of ['', 'Owner', 'root', 1, null, undefined, {}, ['owner']]) assert.equal(isRole(v), false, String(v))
})

test('isRole refuses names from the object prototype', { todo: 'QA-05: `v in RANK` walks the prototype, so "toString" / "constructor" pass as roles' }, () => {
  for (const v of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) assert.equal(isRole(v), false, v)
})

test('labels for every role, and a neutral word for anything else', () => {
  assert.deepEqual(R.map(roleLabel), ['Owner', 'Admin', 'Supervisor', 'Agent'])
  assert.equal(roleLabel(null), 'Member')
  assert.equal(ROLES.length, 4)
})
