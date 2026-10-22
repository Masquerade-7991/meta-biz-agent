// The Settings catalog: every area, its tabs, their addresses, labels, who may open them and a
// one-line description. The single source for the Settings home, the tabs on each area page, the
// ⌘K palette and the redirects, so the names can't drift apart again.
import { can, type Action, type Role } from '../../../lib/permissions.ts'

export type SettingsTab =
  | 'general'
  | 'members'
  | 'activity'
  | 'billing'
  | 'support'
  | 'teams'
  | 'routing'
  | 'escalation'
  | 'canned'
  | 'fields'
  | 'profile'
  | 'notifications'
  | 'security'
  | 'tokens'
export type SettingsAreaId = 'workspace' | 'desk' | 'you'

export interface SettingsTabDef {
  slug: SettingsTab
  label: string
  description: string
  /** Hidden from roles without this. Tabs without it are open to everyone (read-only where they can't edit). */
  need?: Action
  /** Extra words the filter box and ⌘K match on. */
  keywords?: string
}
export interface SettingsArea {
  id: SettingsAreaId
  label: string
  description: string
  tabs: SettingsTabDef[]
}

export const SETTINGS_AREAS: SettingsArea[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'The workspace itself, its people, what happened in it and what it costs.',
    tabs: [
      { slug: 'general', label: 'General', description: 'The workspace name, its ID and who owns it.', keywords: 'rename name owner transfer ownership id' },
      { slug: 'members', label: 'Members', description: 'Invite people, change roles and remove members.', keywords: 'people invite roles team users api tokens' },
      { slug: 'activity', label: 'Activity', description: 'Who did what, and what the system did on its own.', need: 'traces.read', keywords: 'log audit history events csv' },
      { slug: 'billing', label: 'Billing', description: 'WhatsApp spend this month, AI usage and the budget alert.', need: 'billing.view', keywords: 'spend cost budget money invoice' },
    ],
  },
  {
    id: 'desk',
    label: 'Support desk',
    description: 'How the team works: hours, who gets which ticket, escalation and saved replies.',
    tabs: [
      { slug: 'support', label: 'Hours & targets', description: 'Business hours, holidays, response targets, default routing and feedback.', keywords: 'business hours sla response time zone holidays away message csat feedback' },
      { slug: 'teams', label: 'Teams & people', description: 'Teams, each person’s skills and limit, and who sees which chats.', keywords: 'teams skills availability limit chat visibility restrict' },
      { slug: 'routing', label: 'Routing rules', description: 'Where each new ticket goes, decided top to bottom.', keywords: 'rules assign route' },
      { slug: 'escalation', label: 'Escalation', description: 'What happens as a ticket uses up its response targets.', keywords: 'escalation matrix sla breach alerts' },
      { slug: 'canned', label: 'Canned responses', description: 'Saved replies the team inserts with a /shortcut.', keywords: 'canned macros shortcuts saved replies' },
      { slug: 'fields', label: 'Contact fields', description: 'Extra details kept on every contact, like city or plan.', keywords: 'custom fields contacts csv columns' },
    ],
  },
  {
    id: 'you',
    label: 'You',
    description: 'Your own account: profile, emails you get, where you’re signed in and API tokens.',
    tabs: [
      { slug: 'profile', label: 'Profile', description: 'Your name, email, password, and leaving this workspace.', keywords: 'name email password leave account' },
      { slug: 'notifications', label: 'Notifications', description: 'Which emails you get from this workspace.', keywords: 'emails alerts digest' },
      { slug: 'security', label: 'Security', description: 'Where you’re signed in, and signing out other devices.', keywords: 'sessions devices sign out logout' },
      { slug: 'tokens', label: 'API tokens', description: 'Personal tokens for scripts and the API reference.', keywords: 'api tokens bearer developer' },
    ],
  },
]

export const ALL_TABS: SettingsTabDef[] = SETTINGS_AREAS.flatMap((a) => a.tabs)
export const isSettingsTab = (v: unknown): v is SettingsTab => typeof v === 'string' && ALL_TABS.some((t) => t.slug === v)
export const tabDef = (slug: SettingsTab) => ALL_TABS.find((t) => t.slug === slug)!
export const areaOf = (slug: SettingsTab) => SETTINGS_AREAS.find((a) => a.tabs.some((t) => t.slug === slug))!
export const canOpenTab = (role: Role | null | undefined, slug: SettingsTab) => {
  const need = tabDef(slug).need
  return !need || can(role, need)
}
/** The areas and tabs this role sees (areas with no tab left are dropped). */
export const visibleAreas = (role: Role | null | undefined): SettingsArea[] =>
  SETTINGS_AREAS.map((a) => ({ ...a, tabs: a.tabs.filter((t) => canOpenTab(role, t.slug)) })).filter((a) => a.tabs.length > 0)

/** Old addresses that moved elsewhere. */
export const MOVED: Record<string, { to: string; need: Action }> = {
  whatsapp: { to: '/whatsapp?tab=account', need: 'whatsapp.manage' },
}
export const NO_ACCESS = 'You don’t have access to that page'

/** What `/settings/<slug>` shows for this role: the home, a tab, or somewhere else (with a message). */
export type SettingsRoute = { kind: 'home' } | { kind: 'tab'; tab: SettingsTab } | { kind: 'redirect'; to: string; message?: string }
export function resolveSettings(slug: string | undefined, role: Role | null | undefined): SettingsRoute {
  if (!slug) return { kind: 'home' }
  const moved = Object.hasOwn(MOVED, slug) ? MOVED[slug] : null
  if (moved) return can(role, moved.need) ? { kind: 'redirect', to: moved.to } : { kind: 'redirect', to: '/settings', message: NO_ACCESS }
  if (!isSettingsTab(slug)) return { kind: 'redirect', to: '/settings' }
  if (!canOpenTab(role, slug)) return { kind: 'redirect', to: '/settings', message: NO_ACCESS }
  return { kind: 'tab', tab: slug }
}

/** The filter box on the Settings home: matches label, description and keywords, every word. */
export function matchesFilter(t: SettingsTabDef, area: SettingsArea, q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${t.label} ${t.description} ${t.keywords ?? ''} ${area.label}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}
