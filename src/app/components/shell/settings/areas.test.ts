// Run: node --test src/app/components/shell/settings/areas.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ALL_TABS, canOpenTab, isSettingsTab, matchesFilter, MOVED, NO_ACCESS, resolveSettings, SETTINGS_AREAS, visibleAreas } from './areas.ts'
import { can, ROLES } from '../../../lib/permissions.ts'

test('every slug is unique, URL-safe and resolves to its own tab for an owner', () => {
  const slugs = ALL_TABS.map((t) => t.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  for (const s of slugs) {
    assert.match(s, /^[a-z]+$/)
    assert.deepEqual(resolveSettings(s, 'owner'), { kind: 'tab', tab: s })
  }
})

test('labels are unique and every tab says what it is for', () => {
  const labels = ALL_TABS.map((t) => t.label)
  assert.equal(new Set(labels).size, labels.length)
  for (const t of ALL_TABS) assert.ok(t.description.length > 10, t.slug)
})

test('permissions are real actions and match permissions.ts for every role', () => {
  for (const t of ALL_TABS) {
    if (t.need) assert.doesNotThrow(() => can('owner', t.need!), t.slug)
    for (const r of ROLES) assert.equal(canOpenTab(r.id, t.slug), !t.need || can(r.id, t.need), `${r.id} ${t.slug}`)
  }
  // Agents see no Billing or Activity; admins see Billing but owners alone manage WhatsApp.
  const agentTabs = visibleAreas('agent').flatMap((a) => a.tabs.map((t) => t.slug))
  assert.ok(!agentTabs.includes('billing') && !agentTabs.includes('activity'))
  assert.ok(visibleAreas('admin').flatMap((a) => a.tabs).some((t) => t.slug === 'billing'))
})

test('unknown, forbidden and moved addresses redirect', () => {
  assert.deepEqual(resolveSettings(undefined, 'agent'), { kind: 'home' })
  assert.deepEqual(resolveSettings('nonsense', 'owner'), { kind: 'redirect', to: '/settings' })
  assert.deepEqual(resolveSettings('toString', 'owner'), { kind: 'redirect', to: '/settings' })
  assert.deepEqual(resolveSettings('billing', 'agent'), { kind: 'redirect', to: '/settings', message: NO_ACCESS })
  assert.deepEqual(resolveSettings('whatsapp', 'owner'), { kind: 'redirect', to: '/whatsapp?tab=account' })
  assert.deepEqual(resolveSettings('whatsapp', 'admin'), { kind: 'redirect', to: '/settings', message: NO_ACCESS })
  assert.ok(!isSettingsTab('whatsapp'))
  for (const slug of Object.keys(MOVED)) assert.ok(!isSettingsTab(slug), slug)
})

test('the filter box matches labels, descriptions and keywords', () => {
  const find = (q: string) => SETTINGS_AREAS.flatMap((a) => a.tabs.filter((t) => matchesFilter(t, a, q)).map((t) => t.slug))
  assert.deepEqual(find('sla'), ['support', 'escalation'])
  assert.ok(find('password').includes('profile'))
  assert.ok(find('time zone').includes('support'))
  assert.deepEqual(find(''), ALL_TABS.map((t) => t.slug))
})

// The omnibar's Go to list is checked in src/app/omnibar/goTo.test.ts.
test('the Settings page reads this catalog, not its own list', () => {
  const page = readFileSync(new URL('../SettingsPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /from '\.\/settings\/areas'/)
  for (const t of ALL_TABS) assert.match(page, new RegExp(`${t.slug}: `), `SettingsPage renders ${t.slug}`)
})
