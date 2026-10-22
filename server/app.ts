// The API: every /api route, behind one request handler. index.ts serves it from a long-running
// process (npm run dev:server, or any Node host); vercel.ts serves it as a Vercel Function.
// Startup (database, call log) happens once per process through ready().
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { allow, getCached, invalidatePhone, putCached, ttlFor } from './platform/cache.ts'
import { getSession, handleAuth, usesApiToken } from './identity/auth.ts'
import { handleAnalytics } from './insights/analytics.ts'
import { handleActivity } from './insights/activity.ts'
import { handleReports } from './insights/reports.ts'
import { db, dbOffReason, initDb, NO_META_ASSETS, withWorkspace } from './platform/db.ts'
import { logApiCall, record, resourceOf, splitPhone } from './whatsapp/record.ts'
import { handleStore } from './whatsapp/store.ts'
import { HttpError, send, sendError } from './platform/http.ts'
import { docsPage, openapi } from './openapi/index.ts'
import { handleInbox, handleWebhook } from './messaging/inbox.ts'
import { getSettings, handleTickets } from './support/tickets.ts'
import { handleContacts } from './support/contacts.ts'
import { handleAssist } from './messaging/assist.ts'
import { handleTemplates } from './messaging/templates.ts'
import { handleBilling } from './whatsapp/billing.ts'
import { handleHealth } from './whatsapp/health.ts'
import { handleNumbers } from './whatsapp/numbers.ts'
import { agentUpstream, callUpstream, env, hasToken, pathIds, resolveIds, setCallLogger, upstream, type Kind, type UpstreamReply } from './whatsapp/upstream.ts'
import { accounts, assetsFor } from './whatsapp/accounts.ts'
import { INSTANCE } from './platform/context.ts'
import { isRole, ROLE } from './platform/roles.ts'
import { handleJobs } from './platform/jobs.ts'
import { breakerState } from './platform/breaker.ts'
import { createHash } from 'node:crypto'
import { handleWhatsApp } from './whatsapp/whatsapp.ts'
import { readTrace, trace } from './platform/trace.ts'
import { handleStream } from './platform/stream.ts'
import { can } from '../src/app/lib/permissions.ts'
import { setTimeZoneSource } from './platform/timezone.ts'

// Billing (whatsapp) reads the workspace's zone without importing support, which imports whatsapp.
setTimeZoneSource(async () => (await getSettings()).hours.timezone)

let starting: Promise<boolean> | null = null
let failedAt = 0
/** Connects the database once per process. A failed connect is retried after 30 s, so a serverless
 *  instance that started while MongoDB was unreachable recovers without a redeploy. */
export function ready(): Promise<boolean> {
  if (db) return Promise.resolve(true)
  if (!starting || (failedAt && Date.now() - failedAt > 30_000)) {
    failedAt = 0
    starting = initDb().then((ok) => {
      if (ok) setCallLogger(logApiCall)
      else failedAt = Date.now()
      return ok
    })
  }
  return starting
}

/** Deliveries from Meta not yet processed, and how long the oldest has waited. */
async function webhookBacklog() {
  const inbox = db!.collection('webhook_inbox')
  const due = { processedAt: null, attempts: { $lt: 10 } }
  const [pending, oldest] = await Promise.all([inbox.countDocuments(due), inbox.find(due, { projection: { receivedAt: 1 } }).sort({ receivedAt: 1 }).limit(1).next()])
  return { pending, oldestAgeS: oldest ? Math.round((Date.now() - +oldest.receivedAt) / 1000) : 0 }
}

const IDEMPOTENT = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Sites that may call the API from a browser (the docs site's "Try it"). Only with an API token:
 *  credentials are never allowed cross-origin, so the session cookie never rides along. */
const CORS_ORIGINS = new Set(
  (env('DOCS_ORIGINS') || 'https://helo-docs.vercel.app,http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
)
/** Adds CORS headers for an allowed origin; answers a preflight itself (true = done). */
function cors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = String(req.headers.origin ?? '')
  res.setHeader('vary', 'Origin')
  if (!CORS_ORIGINS.has(origin)) return false
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-expose-headers', 'x-trace-id, idempotent-replayed, retry-after')
  if (req.method !== 'OPTIONS') return false
  res.writeHead(204, {
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
    'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-api-version',
    'access-control-max-age': '600',
  })
  res.end()
  return true
}
/** `Idempotency-Key`: the same key from the same person on the same route within 10 minutes gets the
 *  first answer back (header `idempotent-replayed: true`) instead of doing the work again. True when
 *  replayed; otherwise the answer is captured as it goes out. */
async function idempotency(req: http.IncomingMessage, res: http.ServerResponse, scope: string): Promise<boolean> {
  const header = req.headers['idempotency-key']
  if (typeof header !== 'string' || !header || !IDEMPOTENT.has(req.method ?? '') || !db) return false
  const key = 'idem:' + createHash('sha256').update(`${scope}|${req.method}|${req.url?.split('?')[0]}|${header}`).digest('hex')
  const locks = db.collection('request_locks')
  const prior = await locks.findOne({ _id: key as never, at: { $gt: new Date(Date.now() - 10 * 60_000) } })
  if (prior?.response) {
    res.writeHead(prior.response.status, { 'content-type': prior.response.contentType, 'idempotent-replayed': 'true' })
    res.end(prior.response.body)
    return true
  }
  const chunks: Buffer[] = []
  const write = res.write.bind(res)
  const end = res.end.bind(res)
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk) chunks.push(Buffer.from(chunk as string | Buffer))
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof res.write
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as string | Buffer))
    return (end as (...a: unknown[]) => http.ServerResponse)(chunk, ...rest)
  }) as typeof res.end
  res.on('finish', () => {
    const body = Buffer.concat(chunks)
    if (res.statusCode >= 500 || body.length > 256 * 1024) return
    void locks
      .updateOne({ _id: key as never }, { $set: { at: new Date(), response: { status: res.statusCode, contentType: String(res.getHeader('content-type') ?? 'application/json'), body: body.toString('utf8') } } }, { upsert: true })
      .catch(() => null)
  })
  return false
}

/** How the job queue is doing, for the worker's health answer. */
async function queueDepth() {
  const jobs = db!.collection('jobs')
  const [queued, running, dead] = await Promise.all([jobs.countDocuments({ status: 'queued' }), jobs.countDocuments({ status: 'running' }), jobs.countDocuments({ status: 'dead' })])
  return { queued, running, dead }
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}


/** Local guard below Meta's limits: 500 agent_test/h per number, 1000/h per resource per number. */
async function rateLimited(kind: Kind, path: string): Promise<string | null> {
  const { phone, rest } = splitPhone(new URL(path, 'http://x').pathname)
  if (kind !== 'meta' || !phone) return null
  if (rest === 'agent_test') {
    return (await allow(`${phone}|agent_test`, 500)) ? null : 'Local safety limit reached (500 test messages per hour for this number). Try again shortly.'
  }
  const { resource } = resourceOf(rest)
  return (await allow(`${phone}|${resource}`, 1000)) ? null : `Local safety limit reached (1000 requests per hour for ${resource} on this number). Try again shortly.`
}

const inFlight = new Map<string, Promise<UpstreamReply>>()

/** Meta's 429 is per app and token, shared with everything else using them; a read waits once
 *  (Retry-After, else 2s) and tries again. Writes are never repeated. */
async function callWith429Retry(...args: Parameters<typeof callUpstream>): Promise<UpstreamReply> {
  const r = await callUpstream(...args)
  // A 401 from Meta means the server's token was refused, not that the member's session ended: the
  // browser treats any 401 as "logged out", so it must never see Meta's.
  if (r.status === 401)
    return { ...r, status: 502, contentType: 'application/json', text: JSON.stringify({ title: 'Meta refused the access token', detail: 'Meta answered 401: the access token in the server settings has expired or was revoked. Ask the workspace owner to replace it.', status: 502 }) }
  if (r.status !== 429 || args[1] !== 'GET') return r
  const wait = Math.min(Number(r.retryAfter) || 2, 10) * 1000
  console.log(`${args[1]} ${args[2]} → 429 from upstream, retrying in ${wait}ms`)
  await new Promise((done) => setTimeout(done, wait))
  return callUpstream(...args)
}

async function forward(req: http.IncomingMessage, res: http.ServerResponse, kind: Kind, path: string) {
  const method = req.method ?? 'GET'
  const ttl = method === 'GET' ? ttlFor(kind, path) : 0
  const key = `${kind} ${path}`
  const hit = ttl ? await getCached(key) : undefined
  if (hit) {
    res.writeHead(hit.status, { 'content-type': hit.contentType })
    res.end(hit.text)
    return
  }
  const limited = await rateLimited(kind, path)
  if (limited) {
    console.log(`${method} ${path} → 429 (local guard)`)
    return sendError(res, 429, 'Too many requests', limited)
  }
  const contentType = req.headers['content-type']
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
  try {
    // Identical reads already on their way to Meta share one call (parallel screens, StrictMode doubles).
    const shared = method === 'GET' ? inFlight.get(key) : undefined
    if (shared) {
      const r = await shared
      res.writeHead(r.status, { 'content-type': r.contentType })
      res.end(r.text)
      return
    }
    const call = callWith429Retry(kind, method, path, body, contentType)
    if (method === 'GET') {
      inFlight.set(key, call)
      void call.catch(() => {}).finally(() => inFlight.delete(key))
    }
    const r = await call
    res.writeHead(r.status, { 'content-type': r.contentType })
    res.end(r.text)
    const ok = r.status >= 200 && r.status < 300
    if (ttl && ok) await putCached(key, r, ttl)
    // Only settings reads are cached per number, so only a settings write makes them stale.
    if (method !== 'GET' && ok && path.includes('/agent_config/settings')) {
      const { phone } = splitPhone(new URL(path, 'http://x').pathname)
      if (phone) await invalidatePhone(phone)
    }
    record({ kind, method, path, reqBody: body, contentType: contentType ?? '', status: r.status, resText: r.text })
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, 'Not allowed', err.message)
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.log(`${method} ${path} → 502 (${detail})`)
    sendError(res, 502, 'Upstream unreachable', `${kind === 'meta' ? agentUpstream : upstream} did not respond. ${detail}`)
  }
}

/** Answers one request: the same code runs in the local server (index.ts) and on Vercel (vercel.ts). */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? '/'
  // Every answer names its trace, so a reported error can be looked up (GET /api/trace/<id>).
  const tid = randomUUID()
  res.setHeader('x-trace-id', tid)
  if (cors(req, res)) return
  if (url.split('?')[0] === '/api/ready') {
    res.writeHead(db ? 200 : 503, { 'content-type': 'application/json' })
    res.end(JSON.stringify(db ? { ok: true, instance: INSTANCE } : { title: 'Not ready', detail: dbOffReason, status: 503 }))
    return
  }
  if (url.split('?')[0] === '/api/health') {
    // Public, so a WhatsApp account's labels are only added for members of the workspace it belongs
    // to (the Create Agent fallback and dummy mode use them). Tokens never leave this process.
    const wsId = db ? (await getSession(req).catch(() => null))?.workspace?._id : undefined
    const account = wsId ? await accounts().findOne({ workspaceId: wsId }, { sort: { createdAt: 1 } }) : null
    const number = account?.phoneNumbers[0]
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        // The front-end tells "server unreachable" apart from "server up, database unreachable".
        database: db ? 'ok' : dbOffReason,
        upstream,
        hasToken,
        role: ROLE,
        instance: INSTANCE,
        breaker: { meta: breakerState('meta'), graph: breakerState('graph') },
        ...(db && isRole('worker') && { jobs: await queueDepth(), webhooks: await webhookBacklog() }),
        ...(account && {
          businessName: account.source === 'env' ? env('BUSINESS_NAME') : account.wabaName,
          wabaId: account.wabaId,
          // Display labels for the offline fallback, matching WhatsApp Manager (not IDs, not secrets).
          wabaName: account.wabaName,
          phoneNumberId: number?.id,
          phoneNumber: number?.display,
          phoneName: number?.verifiedName,
        }),
      }),
    )
    return
  }
  if (await handleAuth(req, res)) return
  // Meta calls this without a session; it checks its own signature and verify token.
  if (await handleWebhook(req, res)) return
  // Everything else needs a signed-in workspace member, and runs inside that member's workspace.
  if (!db) return sendError(res, 503, dbOffReason, 'Accounts need the database. Set MONGODB_URI in .env and restart the server.')
  const s = await getSession(req)
  const pathname = url.split('?')[0]
  // The docs page is opened in a browser tab: without a session, go log in instead of a JSON 401.
  if (!s && pathname === '/api/docs') return void res.writeHead(302, { location: '/' }).end()
  if (!s && usesApiToken(req)) return sendError(res, 401, 'Invalid API token', 'This API token is wrong, revoked or expired, or its owner left the workspace. Create a new one in Settings › API tokens.')
  if (!s) return sendError(res, 401, 'Not logged in', 'Log in to continue.')
  if (s.setup !== 'complete') return sendError(res, 403, 'Setup not finished', 'Finish setting up your account first.')
  if (!s.workspace) return sendError(res, 403, 'No workspace', 'Create or join a workspace first.')
  // API documentation (server/openapi): any member may read it.
  if (pathname === '/api/openapi.json' && req.method === 'GET') return send(res, 200, openapi)
  if (pathname === '/api/docs' && req.method === 'GET') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(docsPage)
  const assets = await assetsFor(s.workspace._id)
  const metaRoute = url.match(/^\/api\/(meta|graph)(\/.*)$/)
  if (metaRoute && !assets) return sendError(res, 403, NO_META_ASSETS.title, NO_META_ASSETS.detail)
  const me = { _id: s.user._id, name: s.user.name ?? '', role: s.role }
  const wsId = s.workspace._id
  res.on('finish', () => {
    if (res.statusCode >= 500) withWorkspace(wsId, () => trace('request.failed', { method: req.method, path: url.split('?')[0], status: res.statusCode }), null, { traceId: tid, userId: String(me._id) })
  })
  const traceRoute = url.match(/^\/api\/trace\/([0-9a-f-]{8,36})$/)
  await withWorkspace(wsId, async () => {
    if (handleStream(req, res)) return
    if (await idempotency(req, res, `${wsId}|${me._id}`)) return
    if (traceRoute && !can(s.role, 'traces.read')) return sendError(res, 403, 'Not allowed', 'Only owners and admins can read traces.')
    if (traceRoute) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await readTrace(traceRoute[1])))
    if (metaRoute) {
      // The Graph relay only reads (the console's WhatsApp changes go through their own routes, which
      // check owner and admin rights), and only the object its path names: ?ids= and batch would
      // reach any business with this workspace's token.
      if (metaRoute[1] === 'graph' && req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 403, 'Not allowed', 'The Graph relay is read-only.')
      if (metaRoute[1] === 'graph' && /[?&](ids|batch)=/i.test(metaRoute[2])) return sendError(res, 403, 'Not allowed', 'Name one WhatsApp object in the path.')
      const path = resolveIds(metaRoute[2])
      // Several businesses share this server: a workspace may only name its own WABA, numbers and business.
      if (pathIds(path).some((id) => !assets!.ids.has(id))) return sendError(res, 403, 'Not your WhatsApp account', 'That WhatsApp ID isn’t connected to this workspace.')
      // Changing the AI agent is for owners and admins; everyone can look.
      if (req.method !== 'GET' && req.method !== 'HEAD' && !can(s.role, 'agent.edit')) return sendError(res, 403, 'Not allowed', 'Only owners and admins change the AI agent.')
      await forward(req, res, metaRoute[1] as Kind, path)
    }
    else if (await handleHealth(req, res, me)) return
    else if (await handleNumbers(req, res, me)) return
    else if (await handleWhatsApp(req, res, me)) return
    else if (await handleInbox(req, res, me)) return
    else if (await handleTickets(req, res, me)) return
    else if (await handleAnalytics(req, res, me)) return
    else if (await handleReports(req, res, me)) return
    else if (await handleActivity(req, res, me)) return
    else if (await handleContacts(req, res, me)) return
    else if (await handleAssist(req, res, me)) return
    else if (await handleTemplates(req, res, me)) return
    else if (await handleBilling(req, res, me)) return
    else if (await handleJobs(req, res, me)) return
    else if (!(await handleStore(req, res))) res.writeHead(404).end()
  }, assets, { traceId: tid, userId: String(me._id) })
}
