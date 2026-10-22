// Escalation levels have stable ids, and a ticket remembers the id of the last level it reached
// (`escalationLevelId`), not a position: inserting, removing or editing levels never makes an
// in-flight ticket skip a level or hear about one twice. Older data is moved over lazily: levels
// without ids get them on read, a ticket with only a position maps to the level at that position once.
import { randomUUID } from 'node:crypto'
import { PRIORITIES, type EscalationLevel, type EscalationMatrix } from '../../src/app/support/routing.ts'

export type LevelWithId = EscalationLevel & { id: string }
export type MatrixWithIds = Omit<EscalationMatrix, 'levels'> & { levels: Record<keyof EscalationMatrix['levels'], LevelWithId[]> }

const ID = /^[\w-]{1,40}$/
const same = (a: EscalationLevel, b: EscalationLevel) => a.clock === b.clock && a.percent === b.percent

/**
 * Gives every level an id: the one sent (when valid and unused), else the id of the stored level it
 * matches (same clock and percent), else a new one. `raw` is what the request sent (parseMatrix drops
 * unknown keys but keeps the order), `stored` the matrix saved before.
 */
export function assignLevelIds(parsed: EscalationMatrix, raw: unknown, stored: Partial<MatrixWithIds> | null, newId: () => string = () => randomUUID().slice(0, 8)): MatrixWithIds {
  const rawLevels = (raw && typeof raw === 'object' ? (raw as { levels?: Record<string, unknown> }).levels : null) ?? {}
  const levels = {} as MatrixWithIds['levels']
  for (const p of PRIORITIES) {
    const sent = Array.isArray(rawLevels[p]) ? (rawLevels[p] as { id?: unknown }[]) : []
    const before = (stored?.levels?.[p] ?? []) as Partial<LevelWithId>[]
    const used = new Set<string>()
    levels[p] = parsed.levels[p].map((l, i) => {
      const asked = typeof sent[i]?.id === 'string' && ID.test(String(sent[i].id)) ? String(sent[i].id) : null
      const match = before.find((b) => b.id && !used.has(b.id) && same(b as EscalationLevel, l))?.id
      const id = asked && !used.has(asked) ? asked : (match ?? newId())
      used.add(id)
      return { ...l, id }
    })
  }
  return { ...parsed, levels }
}

/** Levels without ids (saved before ids, or the built-in default) get stable ones. `changed` says whether to save. */
export function ensureLevelIds(m: EscalationMatrix): { matrix: MatrixWithIds; changed: boolean } {
  let changed = false
  const levels = {} as MatrixWithIds['levels']
  for (const p of PRIORITIES)
    levels[p] = (m.levels[p] ?? []).map((l, i) => {
      const id = (l as Partial<LevelWithId>).id
      if (id) return l as LevelWithId
      changed = true
      return { ...l, id: `${p}-${i + 1}` }
    })
  return { matrix: { ...m, levels }, changed }
}

export interface EscalationState {
  escalationLevelId?: string | null
  /** Position reached (1-based), from before ids; still kept for lists and analytics. */
  escalationLevel?: number | null
  clockStartAt?: Date | number | null
  createdAt?: Date | number | null
  escalations?: { levelId?: string; at: Date | number }[]
}

/**
 * How many of `levels` count as already reached, i.e. `current` for nextEscalation: the position
 * just after the last level reached. When that level was removed, the levels it reached since the
 * clock last started that still exist decide; tickets from before ids use their stored position.
 */
export function reachedCount(levels: { id: string }[], t: EscalationState): number {
  if (t.escalationLevelId) {
    const i = levels.findIndex((l) => l.id === t.escalationLevelId)
    if (i >= 0) return i + 1
    const since = +new Date((t.clockStartAt ?? t.createdAt ?? 0) as Date)
    const fired = new Set((t.escalations ?? []).filter((e) => +new Date(e.at as Date) >= since && e.levelId).map((e) => e.levelId!))
    let last = 0
    levels.forEach((l, j) => {
      if (fired.has(l.id)) last = j + 1
    })
    return last
  }
  return Math.min(levels.length, Math.max(0, Number(t.escalationLevel ?? 0)))
}
