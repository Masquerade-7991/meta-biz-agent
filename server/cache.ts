// Tiny in-memory TTL cache for relayed GETs, plus the rolling-hour rate guard. One process only;
// ponytail: move both to Redis if the relay ever runs as several processes.
import { env, type UpstreamReply } from './upstream.ts'

const off = env('RELAY_CACHE') === 'off' // for upstream-level tests and live debugging

const entries = new Map<string, { exp: number; reply: UpstreamReply }>()

/** TTL for a resolved GET path, or 0 when it must not be cached. */
export function ttlFor(kind: 'meta' | 'graph', path: string): number {
  if (off) return 0
  if (kind === 'graph') return 10 * 60_000
  if (/^\/\d+\/agent_config\/settings(\?|$)/.test(path)) return 60_000
  // Range queries only: a single day is a trend point (closed days live in Mongo; today must be live).
  const range = path.match(/\/insights\/(?:conversations|tool_calls|agent_events)\?.*start_date=([\d-]+).*end_date=([\d-]+)/)
  return range && range[1] !== range[2] ? 5 * 60_000 : 0
}

export function getCached(key: string): UpstreamReply | undefined {
  const e = entries.get(key)
  if (e && e.exp > Date.now()) return e.reply
  entries.delete(key)
}

export const putCached = (key: string, reply: UpstreamReply, ttl: number) => void entries.set(key, { exp: Date.now() + ttl, reply })

/** Drops every entry for one number (any write to it may change its settings). */
export function invalidatePhone(phone: string) {
  for (const k of entries.keys()) if (k.includes(`/${phone}/`)) entries.delete(k)
}

const hits = new Map<string, number[]>()
/** Counts one call against `key`; false once `limit` calls happened in the last hour. */
export function allow(key: string, limit: number): boolean {
  const since = Date.now() - 3_600_000
  const list = (hits.get(key) ?? []).filter((t) => t > since)
  hits.set(key, list)
  if (list.length >= limit) return false
  list.push(Date.now())
  return true
}
