// The console's status words, one vocabulary per kind of thing, with the tone each is shown in
// (StatusPill, src/app/components/ui/status.tsx). Screens map their data onto these so the same
// state never reads two ways ("Active" here, "Live" there).

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** An AI agent: being set up, answering test numbers only, answering everyone, or stopped. */
export type AgentStatus = 'draft' | 'testing' | 'live' | 'paused'
export const AGENT_STATUS: Record<AgentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  testing: { label: 'Testing', tone: 'info' },
  live: { label: 'Live', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
}

/** A WhatsApp number's connection health. */
export type NumberStatus = 'connected' | 'attention' | 'disconnected'
export const NUMBER_STATUS: Record<NumberStatus, { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'success' },
  attention: { label: 'Needs attention', tone: 'warning' },
  disconnected: { label: 'Disconnected', tone: 'danger' },
}

/** A connection to the business's own system. */
export type ConnectionStatus = 'working' | 'failing' | 'untested'
export const CONNECTION_STATUS: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  working: { label: 'Working', tone: 'success' },
  failing: { label: 'Failing', tone: 'danger' },
  untested: { label: 'Not tested yet', tone: 'neutral' },
}

/** An agent's status from its publish settings: stopped → Paused; switched on for everyone → Live;
 *  switched on for test numbers only → Testing; never switched on → Draft. */
export function agentStatusOf(p: { activated: boolean; stopped: boolean; audienceMode: 'allowlisted' | 'everyone' }): AgentStatus {
  if (p.stopped) return 'paused'
  if (!p.activated) return 'draft'
  return p.audienceMode === 'everyone' ? 'live' : 'testing'
}
