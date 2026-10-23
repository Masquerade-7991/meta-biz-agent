// The omnibar's "Go to" list: every page, Settings tab, report and agent section this person may
// open, and the quick actions (new agent, API docs, workspace, theme, density). Pure, so it can be
// tested; Omnibar.tsx turns each action into a navigation or a call.
import { ArrowLeftRight, BookOpen, FileText, FlaskConical, Monitor, Moon, Plus, Rows3, Rows4, Settings, Sun, type LucideIcon } from 'lucide-react'
import { can, type Role } from '../lib/permissions.ts'
import { visibleAreas } from '../components/shell/settings/areas.ts'
import { REPORTS } from '../reports/catalog.ts'
import { STUDIO_NAV_SECTIONS } from '../wizard/studioNav.ts'
import { studioPath } from '../wizard/studioPaths.ts'

export type GoToAction =
  | { kind: 'path'; path: string }
  | { kind: 'tab'; url: string }
  | { kind: 'theme'; theme: 'light' | 'dark' | 'system' }
  | { kind: 'density'; density: 'comfortable' | 'compact' }
  | { kind: 'workspace'; id: string }

export interface GoToEntry {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon: LucideIcon
  action: GoToAction
}

export interface GoToInput {
  role: Role
  /** The sidebar's pages for this role (navFor in nav.ts), with their addresses. */
  pages: { id: string; label: string; icon: LucideIcon; path: string }[]
  /** The open agent's name, when one is open in this browser. */
  agentName: string | null
  /** Workspaces to switch to (not the current one). */
  otherWorkspaces: { id: string; name: string }[]
}

export function goToEntries({ role, pages, agentName, otherWorkspaces }: GoToInput): GoToEntry[] {
  const path = (p: string): GoToAction => ({ kind: 'path', path: p })
  const out: GoToEntry[] = pages.map((p) => ({ id: `page:${p.id}`, label: p.label, hint: 'Page', keywords: 'page', icon: p.icon, action: path(p.path) }))
  if (can(role, 'agent.edit')) out.push({ id: 'new-agent', label: 'Create an AI agent', keywords: 'new add', icon: Plus, action: path('/agents?new') })
  if (agentName) {
    out.push({ id: 'test-agent', label: `Test ${agentName}`, keywords: 'try chat', icon: FlaskConical, action: path(studioPath('testEval')) })
    for (const s of STUDIO_NAV_SECTIONS) out.push({ id: `studio:${s.id}`, label: s.label, hint: agentName, keywords: `agent studio ${agentName}`, icon: s.icon, action: path(studioPath(s.id)) })
  }
  if (can(role, 'reports.view')) {
    for (const r of REPORTS) out.push({ id: `report:${r.id}`, label: `${r.title} report`, hint: 'Reports', keywords: 'report download csv', icon: FileText, action: path(`/reports/${r.id}`) })
  }
  // The same catalog as the Settings home and its tabs (settings/areas.ts).
  out.push({ id: 'settings', label: 'All settings', hint: 'Settings', keywords: 'settings home', icon: Settings, action: path('/settings') })
  for (const a of visibleAreas(role)) {
    for (const t of a.tabs) out.push({ id: `settings:${t.slug}`, label: t.label, hint: `Settings · ${a.label}`, keywords: `settings ${t.keywords ?? ''}`, icon: Settings, action: path(`/settings/${t.slug}`) })
  }
  if (can(role, 'whatsapp.manage')) out.push({ id: 'whatsapp-account', label: 'WhatsApp account', hint: 'Assets', keywords: 'webhooks live events disconnect', icon: Settings, action: path('/whatsapp?tab=account') })
  if (can(role, 'settings.manage')) out.push({ id: 'api-docs', label: 'API docs', keywords: 'documentation swagger', icon: BookOpen, action: { kind: 'tab', url: '/api/docs' } })
  for (const w of otherWorkspaces) out.push({ id: `workspace:${w.id}`, label: `Switch to ${w.name}`, hint: 'Workspace', keywords: 'switch workspace', icon: ArrowLeftRight, action: { kind: 'workspace', id: w.id } })
  out.push(
    { id: 'density:compact', label: 'Compact lists', keywords: 'density', icon: Rows4, action: { kind: 'density', density: 'compact' } },
    { id: 'density:comfortable', label: 'Comfortable lists', keywords: 'density', icon: Rows3, action: { kind: 'density', density: 'comfortable' } },
    { id: 'theme:light', label: 'Light theme', keywords: 'theme appearance', icon: Sun, action: { kind: 'theme', theme: 'light' } },
    { id: 'theme:dark', label: 'Dark theme', keywords: 'theme appearance', icon: Moon, action: { kind: 'theme', theme: 'dark' } },
    { id: 'theme:system', label: 'Match system theme', keywords: 'theme appearance', icon: Monitor, action: { kind: 'theme', theme: 'system' } },
  )
  return out
}
