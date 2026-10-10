// Teams, routing rules and the escalation matrix: the shapes and the pure decisions, shared by the
// server (server/routing.ts, server/escalation.ts) and the settings screens. No I/O here, so the
// rules can be tested and previewed in the browser exactly as the server will apply them.

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
export type TicketSource = 'handoff' | 'takeover' | 'reply' | 'manual'
export type Availability = 'online' | 'away' | 'offline'

export interface Team {
  id: string
  name: string
  description: string
  /** Notified when the team's tickets escalate; can move work inside the team. */
  leadId: string | null
  memberIds: string[]
  /** How the team hands out new tickets. */
  assign: 'round_robin' | 'least_busy' | 'queue'
}

/** Per person, per workspace (stored on the membership). */
export interface AgentProfile {
  userId: string
  name: string
  skills: string[]
  /** Open tickets after which they get no new ones; null = no limit. */
  maxOpen: number | null
  availability: Availability
}

// ---- rules ----
export type Condition =
  | { field: 'source'; in: TicketSource[] }
  | { field: 'priority'; in: Priority[] }
  | { field: 'keyword'; any: string[] }
  | { field: 'contactTag'; any: string[] }
  | { field: 'hours'; is: 'open' | 'closed' }
  | { field: 'number'; in: string[] }

export type Action =
  | { do: 'assignTeam'; teamId: string; skill?: string }
  | { do: 'assignUser'; userId: string }
  | { do: 'leaveUnassigned' }
  | { do: 'setPriority'; priority: Priority }
  | { do: 'addTags'; tags: string[] }

export interface Rule {
  id: string
  name: string
  enabled: boolean
  /** all = every condition must hold; any = one is enough. No conditions = always. */
  match: 'all' | 'any'
  when: Condition[]
  then: Action[]
}

/** What's known about a ticket when it opens. */
export interface Facts {
  source: TicketSource
  priority: Priority
  /** The customer's latest words. */
  text: string
  contactTags: string[]
  /** Inside business hours right now. */
  open: boolean
  phoneNumberId: string | null
}

const lc = (s: string) => s.trim().toLowerCase()

export function conditionHolds(c: Condition, f: Facts): boolean {
  switch (c.field) {
    case 'source':
      return c.in.includes(f.source)
    case 'priority':
      return c.in.includes(f.priority)
    case 'keyword': {
      const text = lc(f.text)
      return c.any.some((k) => lc(k) && text.includes(lc(k)))
    }
    case 'contactTag': {
      const tags = new Set(f.contactTags.map(lc))
      return c.any.some((t) => tags.has(lc(t)))
    }
    case 'hours':
      return (c.is === 'open') === f.open
    case 'number':
      return !!f.phoneNumberId && c.in.includes(f.phoneNumberId)
  }
}

export const ruleMatches = (r: Rule, f: Facts) =>
  r.enabled && (!r.when.length || (r.match === 'any' ? r.when.some((c) => conditionHolds(c, f)) : r.when.every((c) => conditionHolds(c, f))))

/** Rules run top to bottom; the first that matches decides. */
export const firstMatch = (rules: Rule[], f: Facts) => rules.find((r) => ruleMatches(r, f)) ?? null

/** What a rule does to a new ticket, before anyone is picked from a team. */
export function applyRule(r: Rule | null, f: Facts) {
  const out: { priority: Priority; tags: string[]; target: { kind: 'team'; teamId: string; skill?: string } | { kind: 'user'; userId: string } | { kind: 'none' } | { kind: 'default' } } = {
    priority: f.priority,
    tags: [],
    target: { kind: 'default' },
  }
  for (const a of r?.then ?? []) {
    if (a.do === 'setPriority') out.priority = a.priority
    else if (a.do === 'addTags') out.tags.push(...a.tags.map(lc).filter(Boolean))
    else if (a.do === 'assignTeam') out.target = { kind: 'team', teamId: a.teamId, ...(a.skill && { skill: a.skill }) }
    else if (a.do === 'assignUser') out.target = { kind: 'user', userId: a.userId }
    else if (a.do === 'leaveUnassigned') out.target = { kind: 'none' }
  }
  return out
}

/**
 * Picks who in a pool gets the ticket. Only people who are online, under their limit and (when a
 * skill is asked for) have it are eligible. `least_busy` takes the fewest open tickets (ties go
 * round-robin), `round_robin` takes turns, `queue` leaves it for the team to pick up.
 * Returns null when nobody is eligible: the ticket waits in the team's queue.
 */
export function pickFromPool(
  pool: string[],
  mode: Team['assign'],
  profiles: Map<string, Pick<AgentProfile, 'skills' | 'maxOpen' | 'availability'>>,
  openCount: Map<string, number>,
  turn: number,
  skill?: string,
): string | null {
  if (mode === 'queue') return null
  const eligible = pool.filter((id) => {
    const p = profiles.get(id)
    if (!p || p.availability !== 'online') return false
    if (p.maxOpen != null && (openCount.get(id) ?? 0) >= p.maxOpen) return false
    return !skill || p.skills.map(lc).includes(lc(skill))
  })
  if (!eligible.length) return null
  if (mode === 'least_busy') {
    const fewest = Math.min(...eligible.map((id) => openCount.get(id) ?? 0))
    const tied = eligible.filter((id) => (openCount.get(id) ?? 0) === fewest)
    return tied[turn % tied.length]
  }
  return eligible[turn % eligible.length]
}

// ---- escalation ----
export type Notify = 'assignee' | 'team_lead' | 'supervisors' | 'admins'

export interface EscalationLevel {
  /** Which clock: time to first reply, or time to resolve. */
  clock: 'first_response' | 'resolution'
  /** Share of the target used when this level fires: 75 = three quarters in, 100 = at breach, 150 = half the target again past it. */
  percent: number
  notify: Notify[]
  email: boolean
  /** Move the ticket to a team (its usual way of assigning) or leave it where it is. */
  reassignTeamId: string | null
  raisePriority: boolean
}

export interface EscalationMatrix {
  enabled: boolean
  /** Up to three levels per priority, in the order they fire. */
  levels: Record<Priority, EscalationLevel[]>
}

export const MAX_LEVELS = 3

export const DEFAULT_MATRIX: EscalationMatrix = {
  enabled: false,
  levels: {
    urgent: [
      { clock: 'first_response', percent: 75, notify: ['assignee', 'team_lead'], email: false, reassignTeamId: null, raisePriority: false },
      { clock: 'first_response', percent: 100, notify: ['team_lead', 'supervisors'], email: true, reassignTeamId: null, raisePriority: false },
      { clock: 'resolution', percent: 100, notify: ['supervisors', 'admins'], email: true, reassignTeamId: null, raisePriority: false },
    ],
    high: [
      { clock: 'first_response', percent: 100, notify: ['assignee', 'team_lead'], email: false, reassignTeamId: null, raisePriority: false },
      { clock: 'resolution', percent: 100, notify: ['team_lead', 'supervisors'], email: true, reassignTeamId: null, raisePriority: false },
    ],
    normal: [{ clock: 'resolution', percent: 100, notify: ['assignee', 'team_lead'], email: false, reassignTeamId: null, raisePriority: true }],
    low: [],
  },
}

export interface TicketClock {
  createdAt: number
  firstResponseDueAt: number
  resolveDueAt: number
  firstRespondedAt: number | null
  status: 'open' | 'pending' | 'resolved'
}

/** How much of a clock's target is used up, in percent (over 100 = breached). null once the clock stopped. */
export function clockPercent(t: TicketClock, clock: EscalationLevel['clock'], now: number): number | null {
  if (t.status === 'resolved') return null
  if (clock === 'first_response' && t.firstRespondedAt != null) return null
  const due = clock === 'first_response' ? t.firstResponseDueAt : t.resolveDueAt
  const span = Math.max(60_000, due - t.createdAt)
  return ((now - t.createdAt) / span) * 100
}

/**
 * The next level a ticket has reached and not yet had, given it already reached `current` (0 = none).
 * Levels fire in order: level 2 never fires before level 1, even when both are due at once
 * (the next sweep takes it), so everyone along the way hears about it.
 */
export function nextEscalation(t: TicketClock, levels: EscalationLevel[], current: number, now: number): number | null {
  const next = current + 1
  const l = levels[next - 1]
  if (!l) return null
  const pct = clockPercent(t, l.clock, now)
  return pct != null && pct >= l.percent ? next : null
}

export const notifyLabel: Record<Notify, string> = { assignee: 'Assignee', team_lead: 'Team lead', supervisors: 'Supervisors', admins: 'Admins & owners' }

export function describeLevel(l: EscalationLevel) {
  const when = l.percent === 100 ? 'at breach' : l.percent < 100 ? `${l.percent}% in` : `${l.percent - 100}% past target`
  return `${l.clock === 'first_response' ? 'First reply' : 'Resolution'} ${when}`
}

// ---- validation (server and forms) ----
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strs = (v: unknown, max = 20) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [])

/** Throws a readable message for the first problem; returns clean rules. */
export function parseRules(v: unknown, known: { teams: Set<string>; members: Set<string> }): Rule[] {
  if (!Array.isArray(v)) throw new Error('Send the rules as a list.')
  if (v.length > 50) throw new Error('Keep it to 50 rules or fewer.')
  return v.map((raw, i) => {
    if (!isObj(raw)) throw new Error(`Rule ${i + 1} isn’t valid.`)
    const name = String(raw.name ?? '').trim().slice(0, 80)
    if (!name) throw new Error(`Rule ${i + 1} needs a name.`)
    const when = (Array.isArray(raw.when) ? raw.when : []).slice(0, 10).map((c): Condition => {
      const x = isObj(c) ? c : {}
      switch (x.field) {
        case 'source':
          return { field: 'source', in: strs(x.in).filter((s): s is TicketSource => ['handoff', 'takeover', 'reply', 'manual'].includes(s)) }
        case 'priority':
          return { field: 'priority', in: strs(x.in).filter((s): s is Priority => (PRIORITIES as readonly string[]).includes(s)) }
        case 'keyword':
          return { field: 'keyword', any: strs(x.any, 30).map((s) => s.slice(0, 60)) }
        case 'contactTag':
          return { field: 'contactTag', any: strs(x.any).map(lc) }
        case 'hours':
          return { field: 'hours', is: x.is === 'closed' ? 'closed' : 'open' }
        case 'number':
          return { field: 'number', in: strs(x.in) }
        default:
          throw new Error(`“${name}” has a condition we don’t recognise.`)
      }
    })
    for (const c of when)
      if (('in' in c && !c.in.length) || ('any' in c && !c.any.length)) throw new Error(`“${name}”: every condition needs at least one value.`)
    const then = (Array.isArray(raw.then) ? raw.then : []).slice(0, 6).map((a): Action => {
      const x = isObj(a) ? a : {}
      switch (x.do) {
        case 'assignTeam':
          if (!known.teams.has(String(x.teamId))) throw new Error(`“${name}” sends tickets to a team that no longer exists.`)
          return { do: 'assignTeam', teamId: String(x.teamId), ...(String(x.skill ?? '').trim() && { skill: String(x.skill).trim().slice(0, 40) }) }
        case 'assignUser':
          if (!known.members.has(String(x.userId))) throw new Error(`“${name}” assigns to someone who isn’t in the workspace.`)
          return { do: 'assignUser', userId: String(x.userId) }
        case 'leaveUnassigned':
          return { do: 'leaveUnassigned' }
        case 'setPriority':
          if (!(PRIORITIES as readonly string[]).includes(String(x.priority))) throw new Error(`“${name}”: pick a priority.`)
          return { do: 'setPriority', priority: x.priority as Priority }
        case 'addTags':
          return { do: 'addTags', tags: strs(x.tags, 10).map(lc) }
        default:
          throw new Error(`“${name}” has an action we don’t recognise.`)
      }
    })
    if (!then.length) throw new Error(`“${name}” needs at least one action.`)
    return { id: String(raw.id || `r${Date.now().toString(36)}${i}`), name, enabled: raw.enabled !== false, match: raw.match === 'any' ? 'any' : 'all', when, then }
  })
}

export function parseMatrix(v: unknown, teams: Set<string>): EscalationMatrix {
  const x = isObj(v) ? v : {}
  const lv = isObj(x.levels) ? x.levels : {}
  const levels = Object.fromEntries(
    PRIORITIES.map((p) => {
      const list = (Array.isArray(lv[p]) ? lv[p] : []).slice(0, MAX_LEVELS).map((raw, i): EscalationLevel => {
        const l = isObj(raw) ? raw : {}
        const percent = Math.round(Number(l.percent))
        if (!(percent >= 25 && percent <= 500)) throw new Error(`${p} level ${i + 1}: fire between 25% and 500% of the target.`)
        // Own names only: "toString" and "constructor" are in the prototype chain, not the labels.
        const notify = [...new Set(strs(l.notify))].filter((n): n is Notify => Object.hasOwn(notifyLabel, n))
        const reassignTeamId = l.reassignTeamId && teams.has(String(l.reassignTeamId)) ? String(l.reassignTeamId) : null
        if (!notify.length && !reassignTeamId && l.raisePriority !== true) throw new Error(`${p} level ${i + 1} does nothing: notify someone, move the ticket or raise its priority.`)
        return { clock: l.clock === 'first_response' ? 'first_response' : 'resolution', percent, notify, email: l.email === true, reassignTeamId, raisePriority: l.raisePriority === true }
      })
      return [p, list]
    }),
  ) as EscalationMatrix['levels']
  return { enabled: x.enabled === true, levels }
}

export function parseTeam(v: unknown, members: Set<string>): Omit<Team, 'id'> {
  const x = isObj(v) ? v : {}
  const name = String(x.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Give the team a name.')
  const memberIds = [...new Set(strs(x.memberIds, 500))].filter((id) => members.has(id))
  const leadId = x.leadId && members.has(String(x.leadId)) ? String(x.leadId) : null
  const assign = x.assign === 'least_busy' || x.assign === 'queue' ? x.assign : 'round_robin'
  return { name, description: String(x.description ?? '').trim().slice(0, 200), leadId, memberIds, assign }
}

export const raise = (p: Priority): Priority => PRIORITIES[Math.max(0, PRIORITIES.indexOf(p) - 1)]
