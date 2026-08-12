import {
  Activity,
  BadgeCheck,
  BrainCircuit,
  LayoutGrid,
  MessageSquareText,
  Plug,
  Rocket,
  ShieldAlert,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import type { StudioSectionId } from './types'

export interface StudioNavItem {
  id: StudioSectionId
  label: string
  icon: LucideIcon
  group?: 'build' | 'deploy' | 'monitor'
}

export const STUDIO_GROUP_LABEL: Record<'build' | 'deploy' | 'monitor', string> = {
  build: 'Build',
  deploy: 'Deploy',
  monitor: 'Monitor',
}

// A persistent sidebar with free navigation, but content stays organised the way this app's own
// wizard already modeled it — no Botpress-specific concepts (Playbooks, Tools, Escalation,
// Channels) that don't map to something Meta Business Agent actually has.
export const STUDIO_NAV_SECTIONS: StudioNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'identity', label: 'Identity', icon: BadgeCheck, group: 'build' },
  { id: 'personality', label: 'Personality', icon: Sparkles, group: 'build' },
  { id: 'skills', label: 'Skills', icon: Wand2, group: 'build' },
  { id: 'richReplies', label: 'Rich replies', icon: MessageSquareText, group: 'build' },
  { id: 'knowledge', label: 'Knowledge', icon: BrainCircuit, group: 'build' },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'build' },
  { id: 'safety', label: 'Safety & handoff', icon: ShieldAlert, group: 'build' },
  { id: 'publish', label: 'Test & publish', icon: Rocket, group: 'deploy' },
  { id: 'activity', label: 'Activity', icon: Activity, group: 'monitor' },
]
