// A canned response can also act on the ticket after it's sent (a macro): resolve it or wait on the
// customer, set priority, add tags, or hand the chat back to the AI. Shared by server and composer.
export type Priority = 'urgent' | 'high' | 'normal' | 'low'
export interface CannedActions {
  status?: 'pending' | 'resolved'
  priority?: Priority
  tags?: string[]
  /** Give the chat back to the AI agent (not on a resolve: resolving already offers it). */
  handBack?: boolean
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']

/** Keeps only valid actions; undefined when there are none. */
export function parseActions(v: unknown): CannedActions | undefined {
  if (!v || typeof v !== 'object') return undefined
  const x = v as Record<string, unknown>
  const out: CannedActions = {}
  if (x.status === 'pending' || x.status === 'resolved') out.status = x.status
  if (PRIORITIES.includes(x.priority as Priority)) out.priority = x.priority as Priority
  const tags = Array.isArray(x.tags) ? x.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10) : []
  if (tags.length) out.tags = tags
  if (x.handBack === true && out.status !== 'resolved') out.handBack = true
  return Object.keys(out).length ? out : undefined
}

export function describeActions(a: CannedActions | undefined) {
  if (!a) return ''
  return [
    a.status === 'resolved' && 'resolve the ticket',
    a.status === 'pending' && 'wait on the customer',
    a.priority && `set priority ${a.priority}`,
    a.tags?.length && `tag ${a.tags.join(', ')}`,
    a.handBack && 'hand back to the AI',
  ]
    .filter(Boolean)
    .join(', ')
}
