// What happens to a ticket when the customer writes, when it waits on them and when it comes back:
// the pure decisions, shared by the server (tickets.ts) and Dummy mode so both behave the same.

/** A customer writing within this many days of a resolve reopens that ticket; later, a new one starts. */
export const REOPEN_DAYS = 3

export type CustomerWrites = 'resume' | 'reopen' | 'new' | 'none'

/**
 * What a customer's message does to their latest ticket:
 * - waiting on them → `resume` (back to open, the clock runs again);
 * - open → `none` (it's already being handled);
 * - the AI agent holds the chat → `none` (it answers; nobody needs a ticket);
 * - resolved within REOPEN_DAYS → `reopen` the same ticket;
 * - resolved earlier, or never had one, while a person holds the chat → `new`.
 */
export function customerWrites(latest: { status: string; resolvedAt?: Date | string | null } | null, owner: 'ai' | 'human', now: number): CustomerWrites {
  if (latest?.status === 'pending') return 'resume'
  if (latest?.status === 'open') return 'none'
  if (owner !== 'human') return 'none'
  if (latest?.status === 'resolved' && latest.resolvedAt && now - +new Date(latest.resolvedAt) < REOPEN_DAYS * 86_400_000) return 'reopen'
  return 'new'
}

/** How long the response clocks were paused, after waiting on the customer from `pausedAt` until `now`. */
export const pausedFor = (pausedAt: Date | string | null | undefined, now: number) => (pausedAt ? Math.max(0, now - +new Date(pausedAt)) : 0)

/** Due dates move later by the time spent waiting on the customer. */
export function shiftDues<T extends { firstResponseDueAt: Date | string; resolveDueAt: Date | string }>(t: T, ms: number) {
  return { firstResponseDueAt: new Date(+new Date(t.firstResponseDueAt) + ms), resolveDueAt: new Date(+new Date(t.resolveDueAt) + ms) }
}
