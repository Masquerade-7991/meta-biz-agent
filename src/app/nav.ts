import { BarChart3, Bot, Contact, Home, Inbox, Megaphone, Settings, Ticket, type LucideIcon } from 'lucide-react'
import { can, type Action, type Role } from '@/app/lib/permissions'

export type NavId = 'home' | 'inbox' | 'tickets' | 'contacts' | 'ai-agents' | 'broadcasts' | 'analytics' | 'settings'

export interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  /** Distinct, emphasized entry point — visually set apart from the rest of the rail. */
  distinct?: boolean
  /** Shown only to roles allowed this (src/app/lib/permissions.ts). */
  need?: Action
}

// Customer-facing work first (Home, Inbox, Tickets, Contacts), then the agent and outreach.
// Knowledge lives inside each AI agent, not here.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'tickets', label: 'Tickets', icon: Ticket },
  { id: 'contacts', label: 'Contacts', icon: Contact },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot, distinct: true },
  { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, need: 'reports.view' },
  { id: 'settings', label: 'Settings', icon: Settings },
]

/** The pages this role sees in the sidebar. */
export const navFor = (role: Role | null | undefined) => NAV_ITEMS.filter((i) => !i.need || can(role, i.need))
