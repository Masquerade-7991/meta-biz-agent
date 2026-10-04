import { BarChart3, Bot, Contact, Home, Inbox, Megaphone, Settings, Ticket, type LucideIcon } from 'lucide-react'

export type NavId = 'home' | 'inbox' | 'tickets' | 'contacts' | 'ai-agents' | 'broadcasts' | 'analytics' | 'settings'

export interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  /** Distinct, emphasized entry point — visually set apart from the rest of the rail. */
  distinct?: boolean
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
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]
