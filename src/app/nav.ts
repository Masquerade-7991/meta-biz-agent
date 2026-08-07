import {
  Activity,
  Bot,
  BarChart3,
  BrainCircuit,
  Clipboard,
  Contact,
  FileText,
  History,
  MessageSquare,
  Phone,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type NavId =
  | 'chats'
  | 'ai-agents'
  | 'knowledge-base'
  | 'flows'
  | 'monitor'
  | 'prompt-to-workflow'
  | 'whatsapp'
  | 'contacts'
  | 'analytics'
  | 'activities'
  | 'history'
  | 'settings'

export interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  /** Distinct, emphasized entry point — visually set apart from the rest of the rail. */
  distinct?: boolean
}

// Order and icons verified against product screenshots (icon highlighted = active page):
// flow listing page.png, Analytics page.png, knowledge base default.png,
// monitor page.png, prompt to workflow list page.png, contacts list page.png,
// activities page.png, history page.png. AI Agents is a new distinct entry and the
// app's start page (Home was folded into its empty state).
export const NAV_ITEMS: NavItem[] = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot, distinct: true },
  { id: 'knowledge-base', label: 'Knowledge Bases', icon: BrainCircuit },
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'prompt-to-workflow', label: 'Prompt to Workflow', icon: FileText },
  { id: 'whatsapp', label: 'WhatsApp', icon: Phone },
  { id: 'contacts', label: 'Contacts', icon: Contact },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'activities', label: 'Activities', icon: Clipboard },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
]
