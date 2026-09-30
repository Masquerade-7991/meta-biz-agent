// /api/store/* and /api/analytics/* routes, served from MongoDB.
import type http from 'node:http'
import { col, db, dbOffReason, WS } from './db.ts'
import { addDays, dayIn, ensureDays } from './collectors.ts'
import { metaGet, ids } from './upstream.ts'

type Obj = Record<string, unknown>
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const TITLES: Record<number, string> = { 400: 'Bad request', 404: 'Not found', 413: 'Payload too large', 502: 'Upstream unreachable' }
const MAX_BODY = 1024 * 1024

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Body over 1 MB.')
    chunks.push(c as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || 'null')
  } catch {
    throw new HttpError(400, 'Body is not valid JSON.')
  }
}

/** Digits, or the PHONE_NUMBER_ID placeholder (filled from .env). */
function phoneParam(v: string | null | undefined): string {
  const p = v === 'PHONE_NUMBER_ID' ? ids.PHONE_NUMBER_ID : (v ?? '')
  if (!/^\d{1,20}$/.test(p)) throw new HttpError(400, 'phone must be digits.')
  return p
}
function dateParam(v: string | null): Date | undefined {
  if (!v) return undefined
  const d = new Date(/^\d+$/.test(v) ? Number(v) : v)
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid date: ${v}`)
  return d
}
function intParam(v: string | null, def: number, min: number, max: number): number {
  const n = v == null || v === '' ? def : Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Expected a whole number from ${min} to ${max}.`)
  return n
}

// ---- agents ----
const agentOut = ({ _id, workspaceId: _w, ...rest }: Obj) => ({ phoneNumberId: String(_id), ...rest })
function agentFields(b: unknown): Obj {
  const o = (b && typeof b === 'object' ? b : {}) as Obj
  const out: Obj = {}
  if (o.displayName !== undefined) {
    if (typeof o.displayName !== 'string' || o.displayName.length > 200) throw new HttpError(400, 'displayName must be text up to 200 characters.')
    out.displayName = o.displayName
  }
  if (o.everLive !== undefined) {
    if (typeof o.everLive !== 'boolean') throw new HttpError(400, 'everLive must be true or false.')
    out.everLive = o.everLive
  }
  if (o.wabaId !== undefined) {
    if (typeof o.wabaId !== 'string' || !/^\d{1,20}$/.test(o.wabaId)) throw new HttpError(400, 'wabaId must be digits.')
    out.wabaId = o.wabaId
  }
  for (const k of ['createdAt', 'lastOpenedAt'] as const) {
    if (o[k] === undefined) continue
    const d = typeof o[k] === 'number' || typeof o[k] === 'string' ? new Date(o[k] as string | number) : null
    if (!d || Number.isNaN(d.getTime())) throw new HttpError(400, `${k} must be an ISO date or milliseconds.`)
    out[k] = d
  }
  return out
}
const upsertAgent = (phone: string, fields: Obj) =>
  col('agents').findOneAndUpdate({ _id: phone as never }, { $set: { workspaceId: WS, ...fields } }, { upsert: true, returnDocument: 'after' })
const listAgents = async () =>
  (await col('agents').find({ workspaceId: WS, deletedAt: { $exists: false } }).sort({ _id: 1 }).toArray()).map(agentOut)

// ---- drafts: secrets are blanked before anything is stored ----
const SECRET_KEYS = new Set(['clientSecret', 'client_secret', 'token', 'password', 'apiKey', 'api_key', 'secretKey'])
/** Blanks secret fields anywhere, plus every `value` under `connections` (API key values). */
export function stripSecrets(v: unknown, inConnections = false): unknown {
  if (Array.isArray(v)) return v.map((x) => stripSecrets(x, inConnections))
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) =>
      SECRET_KEYS.has(k) || (inConnections && k === 'value') ? [k, typeof x === 'string' ? '' : null] : [k, stripSecrets(x, inConnections || k === 'connections')],
    ),
  )
}

// ---- traces: turns grouped by conversation ----
async function traces(phone: string, consumer: string | null, from?: Date, to?: Date) {
  const filter: Obj = { phoneNumberId: phone }
  if (consumer) filter.consumer = consumer
  if (from || to) filter.ts = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  return col('conversation_traces')
    .aggregate([
      { $match: filter },
      { $sort: { ts: 1 } },
      {
        $group: {
          _id: '$conversationId',
          consumer: { $last: '$consumer' },
          startedAt: { $first: '$ts' },
          endedAt: { $last: '$ts' },
          turns: { $push: { turnId: '$turnId', ts: '$ts', e2eLatencyMs: '$e2eLatencyMs', steps: '$steps' } },
        },
      },
      { $sort: { endedAt: -1 } },
      { $limit: 200 },
      { $project: { _id: 0, conversationId: '$_id', consumer: 1, startedAt: 1, endedAt: 1, turns: 1 } },
    ])
    .toArray()
}

// ---- analytics ----
async function trend(phone: string, days: number) {
  const today = dayIn(new Date())
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -(days - 1) + i))
  const [stored, live] = await Promise.all([
    ensureDays(phone, 'ai_threads', dates).catch(() => new Map<string, Obj>()),
    metaGet<{ data?: { ai_threads?: { count?: number } }[] }>(
      `/${phone}/insights/conversations?start_date=${today}&end_date=${today}&metrics=ai_threads`,
    ).then((r) => r.data?.[0]?.ai_threads?.count ?? 0, () => null),
  ])
  const out = dates.map((date) => ({
    date,
    aiThreads: date === today ? live : ((stored.get(date)?.value as number | undefined) ?? null),
    partial: date === today,
  }))
  if (out.every((p) => p.aiThreads === null)) throw new HttpError(502, 'Could not load conversation counts from Meta.')
  return out
}

async function route(req: http.IncomingMessage, u: URL): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  const p = (k: string) => u.searchParams.get(k)
  let seg: RegExpMatchArray | null
  if (path === '/api/store/agents' && m === 'GET') return await listAgents()
  if (path === '/api/store/agents' && m === 'PUT') {
    const body = await readJson(req)
    if (!Array.isArray(body)) throw new HttpError(400, 'Expected a list of agents.')
    const rows = body.map((r: Obj) => [phoneParam(String(r?.phoneNumberId ?? '')), agentFields(r)] as const)
    for (const [phone, fields] of rows) await upsertAgent(phone, fields)
    return await listAgents()
  }
  if ((seg = path.match(/^\/api\/store\/agents\/([^/]+)$/))) {
    const phone = phoneParam(seg[1])
    if (m === 'GET') {
      const a = await col('agents').findOne({ _id: phone as never, deletedAt: { $exists: false } })
      if (!a) throw new HttpError(404, `No stored agent for ${phone}.`)
      return agentOut(a)
    }
    if (m === 'PUT') return agentOut((await upsertAgent(phone, agentFields(await readJson(req))))!)
  }
  if ((seg = path.match(/^\/api\/store\/drafts\/([^/]+)$/))) {
    const phone = phoneParam(seg[1])
    if (m === 'GET') {
      const d = await col('agent_drafts').findOne({ workspaceId: WS, phoneNumberId: phone })
      return { state: d?.state ?? null, updatedAt: d?.updatedAt ?? null }
    }
    if (m === 'PUT') {
      const body = (await readJson(req)) as Obj | null
      if (!body || typeof body.state !== 'object' || body.state === null || Array.isArray(body.state)) throw new HttpError(400, 'Expected {state: {...}}.')
      const updatedAt = new Date()
      await col('agent_drafts').updateOne(
        { workspaceId: WS, phoneNumberId: phone },
        { $set: { state: stripSecrets(body.state), updatedAt } },
        { upsert: true },
      )
      return { ok: true, updatedAt }
    }
  }
  if (m === 'GET') {
    if (path === '/api/store/test-conversations') {
      const rows = await col('test_conversations')
        .find({ workspaceId: WS, phoneNumberId: phoneParam(p('phone')) }, { projection: { _id: 0, workspaceId: 0 } })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray()
      return rows
    }
    if (path === '/api/store/traces') {
      const consumer = p('consumer')?.replace(/\D/g, '') || null
      return await traces(phoneParam(p('phone')), consumer, dateParam(p('from')), dateParam(p('to')))
    }
    if (path === '/api/store/audit') {
      const rows = await col('audit_log')
        .find({ phoneNumberId: phoneParam(p('phone')) }, { projection: { _id: 0, workspaceId: 0 } })
        .sort({ at: -1 })
        .limit(intParam(p('limit'), 100, 1, 500))
        .toArray()
      return rows
    }
    if (path === '/api/store/eval-runs') {
      const rows = await col('eval_runs')
        .aggregate([
          { $match: { phoneNumberId: phoneParam(p('phone')), status: { $in: ['COMPLETED', 'FAILED'] }, caseId: { $ne: null } } },
          { $sort: { completedAt: -1 } },
          { $group: { _id: '$caseId', run: { $first: '$$ROOT' } } },
          { $replaceRoot: { newRoot: '$run' } },
          {
            $project: {
              _id: 0,
              caseId: 1,
              jobId: 1,
              status: 1,
              startedAt: 1,
              completedAt: 1,
              result: { $ifNull: ['$result', null] },
              error: { $ifNull: ['$error', null] },
              evaluations: { $ifNull: ['$evaluations', null] },
            },
          },
        ])
        .toArray()
      return rows
    }
    if (path === '/api/store/agent-events') {
      const rows = await col('agent_events')
        .find({ phoneNumberId: phoneParam(p('phone')) }, { projection: { _id: 0, workspaceId: 0, phoneNumberId: 0 } })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray()
      return rows
    }
    if (path === '/api/analytics/trend') {
      const days = intParam(p('days'), 7, 1, 30)
      if (![7, 14, 30].includes(days)) throw new HttpError(400, 'days must be 7, 14 or 30.')
      return await trend(phoneParam(p('phone')), days)
    }
    if (path === '/api/analytics/handoffs') {
      const days = intParam(p('days'), 7, 1, 90)
      const rows = await col('handoff_snapshots')
        .find({ 'meta.phoneNumberId': phoneParam(p('phone')), ts: { $gte: new Date(Date.now() - days * 86400000) } }, { projection: { _id: 0, ts: 1, count: 1 } })
        .sort({ ts: 1 })
        .toArray()
      return rows
    }
  }
  throw new HttpError(404, `${m} ${path}`)
}

/** Returns true when it handled the request. */
export async function handleStore(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/store/') && !u.pathname.startsWith('/api/analytics/')) return false
  if (!db) {
    send(res, 503, { title: dbOffReason, detail: 'Set MONGODB_URI in .env and restart the server to enable storage.', status: 503 })
    return true
  }
  try {
    send(res, 200, await route(req, u))
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { title: TITLES[err.status] ?? 'Error', detail: err.message, status: err.status })
    else {
      console.log(`${req.method} ${u.pathname} → 503 (${err instanceof Error ? err.message : err})`)
      send(res, 503, { title: 'Database unavailable', detail: err instanceof Error ? err.message : String(err), status: 503 })
    }
  }
  return true
}
