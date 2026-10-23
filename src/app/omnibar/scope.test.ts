// Run: node --test src/app/omnibar/scope.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { activeScope, setScope, type ScopeEntries } from './scope.ts'

const s = (id: string) => ({ id, placeholder: id })

test('the innermost scope wins, whatever order they mount in', () => {
  // React mounts the tab (child) before Settings (parent).
  let e: ScopeEntries = {}
  e = setScope(e, 'settings/members', s('settings/members'), 1)
  e = setScope(e, 'settings', s('settings'), 2)
  assert.equal(activeScope(e)?.id, 'settings/members')
})

test('unmounting the inner scope restores the outer one; removing an unknown id changes nothing', () => {
  let e: ScopeEntries = {}
  e = setScope(e, 'studio', s('studio'), 1)
  e = setScope(e, 'studio/knowledge/faq', s('studio/knowledge/faq'), 2)
  e = setScope(e, 'studio/knowledge/faq', null, 3)
  assert.equal(activeScope(e)?.id, 'studio')
  assert.equal(setScope(e, 'nope', null, 4), e)
  assert.equal(activeScope(setScope(e, 'studio', null, 5)), null)
})

test('an update keeps its place; among equals the latest mounted wins', () => {
  let e: ScopeEntries = {}
  e = setScope(e, 'inbox', s('inbox'), 1)
  e = setScope(e, 'tickets', s('tickets'), 2)
  assert.equal(activeScope(e)?.id, 'tickets')
  e = setScope(e, 'inbox', { ...s('inbox'), placeholder: 'changed' }, 3)
  assert.equal(activeScope(e)?.id, 'tickets')
  assert.equal(e.inbox.scope.placeholder, 'changed')
})
