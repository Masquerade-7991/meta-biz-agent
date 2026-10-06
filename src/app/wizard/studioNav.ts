import {
  ScrollText,
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  FlaskConical,
  LayoutGrid,
  Plug,
  Rocket,
  ShieldAlert,
  Sparkles,
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
  deploy: 'Test & launch',
  monitor: 'Monitor',
}

// A persistent sidebar with free navigation, but content stays organised the way this app's own
// wizard already modeled it — no Botpress-specific concepts (Playbooks, Tools, Escalation,
// Channels) that don't map to something Meta Business Agent actually has.
export const STUDIO_NAV_SECTIONS: StudioNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'identity', label: 'Identity', icon: BadgeCheck, group: 'build' },
  { id: 'abilities', label: 'Abilities', icon: Sparkles, group: 'build' },
  { id: 'knowledge', label: 'Knowledge', icon: BrainCircuit, group: 'build' },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'build' },
  { id: 'safety', label: 'Safety & handoff', icon: ShieldAlert, group: 'build' },
  { id: 'testEval', label: 'Test & Eval', icon: FlaskConical, group: 'deploy' },
  { id: 'publish', label: 'Publish', icon: Rocket, group: 'deploy' },
  { id: 'analytics', label: 'Performance', icon: BarChart3, group: 'monitor' },
  { id: 'activity', label: 'Logs', icon: ScrollText, group: 'monitor' },
]
