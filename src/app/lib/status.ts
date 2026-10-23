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

/** An agent's status from its publish settings: stopped → Paused; switched on for everyone → Live;
 *  switched on for test numbers only → Testing; never switched on → Draft. */
export function agentStatusOf(p: { activated: boolean; stopped: boolean; audienceMode: 'allowlisted' | 'everyone' }): AgentStatus {
  if (p.stopped) return 'paused'
  if (!p.activated) return 'draft'
  return p.audienceMode === 'everyone' ? 'live' : 'testing'
}

/** A progress bar's colour: red for the first third, amber for the middle, green near the end. */
export const progressTone = (done: number, total: number) => (done * 3 <= total ? 'bg-destructive' : done * 3 <= total * 2 ? 'bg-warning' : 'bg-success')
