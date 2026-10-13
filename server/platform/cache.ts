// The relay's cache for Meta GETs and the rolling-hour rate guard, shared by every instance through
// MongoDB (`relay_cache`, `rate_hits`; both expire on their own). A two-second in-process layer in
// front keeps hot paths off the database. Without a database both fall back to process memory.
import { col, db } from './db.ts'
import { env } from './env.ts'
import type { UpstreamReply } from '../whatsapp/index.ts'

const off = env('RELAY_CACHE') === 'off' // for upstream-level tests and live debugging
const LOCAL_MS = 2_000

type Entry = { exp: number; reply: UpstreamReply }
const local = new Map<string, Entry>()
const cacheCol = () => col<{ _id: string; reply: UpstreamReply; exp: Date }>('relay_cache')

/** TTL for a resolved GET path, or 0 when it must not be cached. */
export function ttlFor(kind: 'meta' | 'graph', path: string): number {
  if (off) return 0
  if (kind === 'graph') return 10 * 60_000
  if (/^\/\d+\/agent_config\/settings(\?|$)/.test(path)) return 60_000
  // Range queries only: a single day is a trend point (closed days live in Mongo; today must be live).
  const range = path.match(/\/insights\/(?:conversations|tool_calls|agent_events)\?.*start_date=([\d-]+).*end_date=([\d-]+)/)
  return range && range[1] !== range[2] ? 5 * 60_000 : 0
}

export async function getCached(key: string): Promise<UpstreamReply | undefined> {
  const e = local.get(key)
  if (e && e.exp > Date.now()) return e.reply
  local.delete(key)
  if (!db) return
  const row = await cacheCol().findOne({ _id: key, exp: { $gt: new Date() } }).catch(() => null)
  if (!row) return
  local.set(key, { exp: Math.min(+row.exp, Date.now() + LOCAL_MS), reply: row.reply })
  return row.reply
}

export async function putCached(key: string, reply: UpstreamReply, ttl: number): Promise<void> {
  const exp = Date.now() + ttl
  local.set(key, { exp: db ? Math.min(exp, Date.now() + LOCAL_MS) : exp, reply })
  if (db) await cacheCol().updateOne({ _id: key }, { $set: { reply, exp: new Date(exp) } }, { upsert: true }).catch(() => null)
}

/** Drops every entry for one number (any write to it may change its settings). */
export async function invalidatePhone(phone: string): Promise<void> {
  for (const k of local.keys()) if (k.includes(`/${phone}/`)) local.delete(k)
  if (db) await cacheCol().deleteMany({ _id: { $regex: `/${phone}/` } }).catch(() => null)
}

const hits = new Map<string, number[]>()
/** Counts one call against `key`; false once `limit` calls happened in the last hour. */
export async function allow(key: string, limit: number): Promise<boolean> {
  const now = Date.now()
  const since = now - 3_600_000
  if (!db) {
    const list = (hits.get(key) ?? []).filter((t) => t > since)
    hits.set(key, list)
    if (list.length >= limit) return false
    list.push(now)
    return true
  }
  const rate = col<{ key: string; at: Date }>('rate_hits')
  if ((await rate.countDocuments({ key, at: { $gt: new Date(since) } })) >= limit) return false
  await rate.insertOne({ key, at: new Date(now) })
  return true
}
