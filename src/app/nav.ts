import { BarChart3, Bot, Contact, FileText, Home, Inbox, Megaphone, Settings, Smartphone, Ticket, type LucideIcon } from 'lucide-react'
import { can, type Action, type Role } from '@/app/lib/permissions'

export type NavId = 'home' | 'inbox' | 'tickets' | 'contacts' | 'ai-agents' | 'broadcasts' | 'whatsapp' | 'analytics' | 'reports' | 'settings'

export interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  /** Sidebar group: the day's work, reaching customers, and setting things up. */
  group: 'work' | 'grow' | 'setup'
  /** Shown only to roles allowed this (src/app/lib/permissions.ts). */
  need?: Action
}

// Grouped by job: the day's customer work, then the AI agent and outreach, then setup.
// Knowledge lives inside each AI agent, not here.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, group: 'work' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, group: 'work' },
  { id: 'tickets', label: 'Tickets', icon: Ticket, group: 'work' },
  { id: 'contacts', label: 'Contacts', icon: Contact, group: 'work' },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot, group: 'grow' },
  { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone, group: 'grow' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, need: 'reports.view', group: 'grow' },
  { id: 'reports', label: 'Reports', icon: FileText, need: 'reports.view', group: 'grow' },
  { id: 'whatsapp', label: 'WhatsApp', icon: Smartphone, need: 'numbers.view', group: 'setup' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'setup' },
]

/** The pages this role sees in the sidebar. */
export const navFor = (role: Role | null | undefined) => NAV_ITEMS.filter((i) => !i.need || can(role, i.need))

// ---- URLs ----
// Every page has its own address, so links can be shared and the browser's back button works.
const PAGE_PATHS: Record<NavId, string> = {
  home: '/',
  inbox: '/inbox',
  tickets: '/tickets',
  contacts: '/contacts',
  'ai-agents': '/agents',
  broadcasts: '/broadcasts',
  whatsapp: '/whatsapp',
  analytics: '/analytics',
  reports: '/reports',
  settings: '/settings',
}
export const pathFor = (id: NavId, settingsTab?: string) => (id === 'settings' && settingsTab ? `/settings/${settingsTab}` : PAGE_PATHS[id])

/** The page a path belongs to (`/settings/billing` → settings), or null for anything else. */
export function navFromPath(pathname: string): NavId | null {
  const first = '/' + (pathname.split('/')[1] ?? '')
  if (first === '/') return 'home'
  return (Object.entries(PAGE_PATHS).find(([, p]) => p === first)?.[0] as NavId | undefined) ?? null
}

export const NAV_GROUPS: { id: NavItem['group']; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'grow', label: 'Automate & grow' },
  { id: 'setup', label: 'Setup' },
]
