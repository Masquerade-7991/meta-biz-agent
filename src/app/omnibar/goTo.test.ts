// Run: node --test src/app/omnibar/goTo.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Home } from 'lucide-react'
import { goToEntries } from './goTo.ts'
import { visibleAreas } from '../components/shell/settings/areas.ts'
import { REPORTS } from '../reports/catalog.ts'

const base = { pages: [{ id: 'home', label: 'Home', icon: Home, path: '/' }], agentName: null, otherWorkspaces: [] }
const ids = (role: 'owner' | 'admin' | 'supervisor' | 'agent', extra = {}) => goToEntries({ role, ...base, ...extra }).map((e) => e.id)

test('every Settings tab this role may open is listed, and only those', () => {
  for (const role of ['owner', 'admin', 'supervisor', 'agent'] as const) {
    const tabs = ids(role).filter((id) => id.startsWith('settings:'))
    assert.deepEqual(tabs, visibleAreas(role).flatMap((a) => a.tabs.map((t) => `settings:${t.slug}`)), role)
  }
  assert.ok(!ids('agent').includes('settings:billing'))
})

test('role-gated actions follow permissions', () => {
  assert.ok(ids('owner').includes('new-agent') && ids('owner').includes('api-docs') && ids('owner').includes('whatsapp-account'))
  assert.ok(!ids('agent').includes('new-agent') && !ids('agent').includes('api-docs'))
  assert.ok(!ids('admin').includes('whatsapp-account'))
  assert.equal(ids('owner').filter((id) => id.startsWith('report:')).length, REPORTS.length)
  assert.equal(ids('agent').filter((id) => id.startsWith('report:')).length, 0)
})

test('agent sections and workspaces appear only when there is one to open', () => {
  assert.ok(!ids('owner').some((id) => id.startsWith('studio:')))
  const withAgent = goToEntries({ role: 'owner', ...base, agentName: 'Asha', otherWorkspaces: [{ id: 'w2', name: 'Acme' }] })
  const faq = withAgent.find((e) => e.id === 'studio:knowledge')!
  assert.deepEqual(faq.action, { kind: 'path', path: '/agents/studio/knowledge' })
  assert.equal(faq.hint, 'Asha')
  assert.deepEqual(withAgent.find((e) => e.id === 'workspace:w2')?.action, { kind: 'workspace', id: 'w2' })
  assert.deepEqual(withAgent.find((e) => e.id === 'page:home')?.action, { kind: 'path', path: '/' })
})

test('the omnibar and the Settings page read the Settings catalog, not their own lists', () => {
  const src = readFileSync(new URL('./goTo.ts', import.meta.url), 'utf8')
  assert.match(src, /from '\.\.\/components\/shell\/settings\/areas\.ts'/)
  assert.doesNotMatch(src, /'members'/)
})
