// MongoDB: one client, collections + indexes + TTLs created idempotently at startup.
// No MONGODB_URI → `db` stays null and everything that stores data is a no-op (or a 503 route).
import { MongoClient, type Collection, type Db, type Document, type IndexDescription } from 'mongodb'
import { env } from './upstream.ts'

export const WS = env('WORKSPACE_ID') || 'default'
const DAY = 86400
const D90 = 90 * DAY
const Y2 = 730 * DAY

let client: MongoClient | null = null
export let db: Db | null = null
/** Why the store is off: 'Database not configured' (no URI) or 'Database unavailable' (connect failed). */
export let dbOffReason = 'Database not configured'

export const col = <T extends Document = Document>(name: string): Collection<T> => {
  if (!db) throw new Error(dbOffReason)
  return db.collection<T>(name)
}

const TIME_SERIES = ['metrics_daily', 'handoff_snapshots']
const INDEXES: Record<string, IndexDescription[]> = {
  agents: [{ key: { workspaceId: 1 } }],
  agent_drafts: [{ key: { workspaceId: 1, phoneNumberId: 1 }, unique: true }],
  test_conversations: [
    { key: { conversationId: 1 }, unique: true },
    { key: { workspaceId: 1, phoneNumberId: 1, updatedAt: -1 } },
    { key: { updatedAt: 1 }, expireAfterSeconds: D90 },
  ],
  conversation_traces: [
    { key: { turnId: 1 }, unique: true },
    { key: { phoneNumberId: 1, consumer: 1, ts: -1 } },
    { key: { ts: 1 }, expireAfterSeconds: D90 },
  ],
  connector_logs: [
    { key: { dedupeKey: 1 }, unique: true },
    { key: { phoneNumberId: 1, connectorId: 1, at: -1 } },
    { key: { at: 1 }, expireAfterSeconds: D90 },
  ],
  connector_stats: [
    { key: { connectorId: 1, day: 1 }, unique: true },
    { key: { date: 1 }, expireAfterSeconds: Y2 },
  ],
  eval_runs: [
    { key: { jobId: 1 }, unique: true },
    { key: { phoneNumberId: 1, caseId: 1, completedAt: -1 } },
    { key: { startedAt: 1 }, expireAfterSeconds: Y2 },
  ],
  agent_events: [
    { key: { agentEventId: 1 }, unique: true },
    { key: { phoneNumberId: 1, createdAt: -1 } },
    { key: { createdAt: 1 }, expireAfterSeconds: D90 },
  ],
  audit_log: [
    { key: { phoneNumberId: 1, at: -1 } },
    { key: { at: 1 }, expireAfterSeconds: Y2 },
  ],
  // Every call to Meta (relay and collectors), success or failure: the relay log, kept 90 days.
  api_calls: [
    { key: { phoneNumberId: 1, at: -1 } },
    { key: { status: 1, at: -1 } },
    { key: { at: 1 }, expireAfterSeconds: D90 },
  ],
  webhook_events: [
    { key: { messageId: 1 }, unique: true },
    { key: { receivedAt: 1 }, expireAfterSeconds: D90 },
  ],
  notifications: [{ key: { workspaceId: 1, phoneNumberId: 1, dismissedAt: 1, createdAt: -1 } }],
  metrics_daily: [{ key: { 'meta.phoneNumberId': 1, 'meta.metric': 1, ts: 1 } }],
  handoff_snapshots: [{ key: { 'meta.phoneNumberId': 1, ts: 1 } }],
  // Configuration copies (mirror.ts): one document per item on Meta, kept after delete (deletedAt).
  ...Object.fromEntries(
    ['faqs', 'skills', 'rich_replies', 'websites', 'documents', 'allowlist', 'connectors', 'connector_tools'].map((c) => [
      c,
      [{ key: { workspaceId: 1, phoneNumberId: 1, metaId: 1 }, unique: true }],
    ]),
  ),
  // One document per agent: Meta's singletons, and the console screens taken from the draft.
  ...Object.fromEntries(
    ['business_info', 'agent_settings', 'identity', 'personality', 'guardrails', 'system_replies'].map((c) => [
      c,
      [{ key: { workspaceId: 1, phoneNumberId: 1 }, unique: true }],
    ]),
  ),
}

export async function ensureSchema(d: Db) {
  const existing = new Set((await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name))
  for (const name of Object.keys(INDEXES)) {
    if (existing.has(name)) continue
    await d.createCollection(
      name,
      TIME_SERIES.includes(name) ? { timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'hours' }, expireAfterSeconds: Y2 } : {},
    )
  }
  for (const [name, specs] of Object.entries(INDEXES)) await d.collection(name).createIndexes(specs)
}

/** Connects once. Returns false (and leaves `db` null) when unconfigured or unreachable. */
export async function initDb(): Promise<boolean> {
  const uri = env('MONGODB_URI')
  if (!uri) return false
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
    await client.connect()
    const d = client.db(env('MONGODB_DB') || 'meta_agent')
    await ensureSchema(d)
    db = d
    console.log('MongoDB connected, collections ready')
    return true
  } catch (err) {
    dbOffReason = 'Database unavailable'
    console.log(`MongoDB unavailable, running without a database (restart to retry): ${err instanceof Error ? err.message : err}`)
    await client?.close().catch(() => {})
    client = null
    return false
  }
}

export const closeDb = () => client?.close()
