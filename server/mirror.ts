// A copy of the agent's configuration on Meta, one collection per kind, with every field Meta holds.
// Kept in step with Meta from relayed traffic: creates and edits upsert, deletes keep the document
// with deletedAt set (the trace stays), and a full list read (every agent open) reconciles both ways,
// which also backfills anything created before this existed. Secrets are blanked (stripSecrets).
import { col, ws } from './db.ts'
import { stripSecrets } from './store.ts'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

/** List resources: path pattern → collection; `id` / `parent` are capture-group numbers. */
const LISTS: { re: RegExp; coll: string; id: number; parent?: number }[] = [
  { re: /^agent_config\/faq(?:\/([^/]+))?$/, coll: 'faqs', id: 1 },
  { re: /^agent_config\/skills(?:\/([^/]+))?$/, coll: 'skills', id: 1 },
  { re: /^agent-ui-skills(?:\/([^/]+))?$/, coll: 'rich_replies', id: 1 },
  { re: /^agent_config\/websites(?:\/([^/]+))?$/, coll: 'websites', id: 1 },
  { re: /^agent_config\/files(?:\/([^/]+))?$/, coll: 'documents', id: 1 },
  { re: /^agent_config\/allowlist(?:\/([^/]+))?$/, coll: 'allowlist', id: 1 },
  { re: /^agent_connectors(?:\/([^/]+))?$/, coll: 'connectors', id: 1 },
  // Credential and tool-sync calls answer with the whole connector.
  { re: /^agent_connectors\/([^/]+)\/(?:upsertApiKey|upsertOAuth|refreshMCPTools)$/, coll: 'connectors', id: 1 },
  { re: /^agent_connectors\/([^/]+)\/tools(?:\/([^/]+))?$/, coll: 'connector_tools', id: 2, parent: 1 },
]
/** One document per agent. */
const SINGLES: Record<string, string> = { 'agent_config/business_info': 'business_info', 'agent_config/settings': 'agent_settings' }

export const MIRROR_COLLECTIONS = [...new Set([...LISTS.map((l) => l.coll), ...Object.values(SINGLES)])]
/** Collections whose full contents may also go into the audit log (allowlist holds customer numbers). */
export const isConfigCollection = (coll: string | null) => !!coll && coll !== 'allowlist'

/** Which collection a Meta path belongs to, if any. */
export function mirrorCollection(rest: string): string | null {
  return SINGLES[rest] ?? LISTS.find((l) => l.re.test(rest))?.coll ?? null
}

const fields = (v: unknown): Obj => {
  const { id: _id, ...rest } = obj(stripSecrets(v, true))
  return rest
}
const createdFrom = (v: Obj) => {
  const t = v.created_at ?? v.creation_time
  return typeof t === 'number' && t > 0 ? new Date(t < 1e12 ? t * 1000 : t) : new Date()
}

async function upsert(coll: string, phone: string, metaId: string, data: Obj, parent?: string) {
  const at = new Date()
  await col(coll).updateOne(
    { workspaceId: ws(), phoneNumberId: phone, metaId },
    {
      $set: { ...fields(data), ...(parent ? { connectorId: parent } : {}), updatedAt: at, syncedAt: at },
      $setOnInsert: { createdAt: createdFrom(data) },
      $unset: { deletedAt: '' },
    },
    { upsert: true },
  )
}

export async function mirror(phone: string, method: string, rest: string, query: URLSearchParams, reqBody: unknown, json: unknown) {
  const single = SINGLES[rest]
  if (single) {
    // Settings GET answers with a one-item list; PUTs are partial, so fields merge.
    const data = method === 'GET' ? obj(Array.isArray(json) ? json[0] : json) : { ...obj(reqBody), ...obj(Array.isArray(json) ? json[0] : json) }
    if (!Object.keys(data).length || (method !== 'GET' && method !== 'PUT')) return
    const at = new Date()
    await col(single).updateOne(
      { workspaceId: ws(), phoneNumberId: phone },
      { $set: { ...fields(data), updatedAt: at, syncedAt: at }, $setOnInsert: { createdAt: at } },
      { upsert: true },
    )
    return
  }

  const spec = LISTS.find((l) => l.re.test(rest))
  if (!spec) return
  const m = rest.match(spec.re)!
  const id = m[spec.id]
  const parent = spec.parent ? m[spec.parent] : undefined
  const res = obj(json)

  if (!id && method === 'GET') {
    const items = (Array.isArray(json) ? json : Array.isArray(res.data) ? res.data : null) as Obj[] | null
    if (!items) return
    const ids = items.map((i) => String(i.id)).filter((i) => i !== 'undefined')
    for (const item of items) if (item.id) await upsert(spec.coll, phone, String(item.id), item, parent)
    // A complete list (not a later page) is the truth: anything else we hold is gone on Meta.
    const paging = obj(res.paging)
    if (!query.get('after') && !paging.next)
      await col(spec.coll).updateMany(
        { workspaceId: ws(), phoneNumberId: phone, ...(parent ? { connectorId: parent } : {}), metaId: { $nin: ids }, deletedAt: { $exists: false } },
        { $set: { deletedAt: new Date() } },
      )
    return
  }
  if (id && method === 'DELETE') {
    await col(spec.coll).updateOne({ workspaceId: ws(), phoneNumberId: phone, metaId: id }, { $set: { deletedAt: new Date() } })
    return
  }
  // Create, edit, or a single read: the request body plus Meta's answer (which carries the id).
  const metaId = String(res.id ?? id ?? '')
  if (metaId) await upsert(spec.coll, phone, metaId, { ...obj(reqBody), ...res }, parent)
}

/** The console screens that never reach Meta as their own item, taken from the saved draft. */
const DRAFT_SECTIONS: [string, string, string[]][] = [
  ['identity', 'identity', ['avatarDataUrl']],
  ['personality', 'personalization', ['customSkills', 'lastSkillImport']],
  ['guardrails', 'guardrails', []],
  ['system_replies', 'replies', []],
]
export const DRAFT_COLLECTIONS = DRAFT_SECTIONS.map(([c]) => c)

export async function mirrorDraft(phone: string, state: Obj) {
  const at = new Date()
  for (const [coll, slice, drop] of DRAFT_SECTIONS) {
    const data = { ...obj(state[slice]) }
    for (const k of drop) delete data[k]
    if (!Object.keys(data).length) continue
    await col(coll).updateOne(
      { workspaceId: ws(), phoneNumberId: phone },
      { $set: { ...data, updatedAt: at }, $setOnInsert: { createdAt: at } },
      { upsert: true },
    )
  }
}
