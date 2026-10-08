// The API: every /api route, behind one request handler. index.ts serves it from a long-running
// process (npm run dev:server, or any Node host); vercel.ts serves it as a Vercel Function.
// Startup (database, call log) happens once per process through ready().
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { allow, getCached, invalidatePhone, putCached, ttlFor } from './cache.ts'
import { getSession, handleAuth } from './auth.ts'
import { db, dbOffReason, initDb, NO_META_ASSETS, withWorkspace } from './db.ts'
import { logApiCall, record, resourceOf, splitPhone } from './record.ts'
import { handleStore } from './store.ts'
import { HttpError, send, sendError } from './http.ts'
import { docsPage, openapi } from './openapi/index.ts'
import { handleInbox, handleWebhook } from './inbox.ts'
import { handleTickets } from './tickets.ts'
import { handleContacts } from './contacts.ts'
import { handleAssist } from './assist.ts'
import { handleBroadcasts } from './broadcasts.ts'
import { handleBilling } from './billing.ts'
import { handleHealth } from './health.ts'
import { handleNumbers } from './numbers.ts'
import { agentUpstream, callUpstream, env, hasToken, pathIds, resolveIds, setCallLogger, upstream, type Kind, type UpstreamReply } from './upstream.ts'
import { accounts, assetsFor } from './accounts.ts'
import { handleWhatsApp } from './whatsapp.ts'
import { readTrace, trace } from './trace.ts'
import { handleStream } from './stream.ts'
import { can } from '../src/app/lib/permissions.ts'

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

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}


/** Local guard below Meta's limits: 500 agent_test/h per number, 1000/h per resource per number. */
function rateLimited(kind: Kind, path: string): string | null {
  const { phone, rest } = splitPhone(new URL(path, 'http://x').pathname)
  if (kind !== 'meta' || !phone) return null
  if (rest === 'agent_test') {
    return allow(`${phone}|agent_test`, 500) ? null : 'Local safety limit reached (500 test messages per hour for this number). Try again shortly.'
  }
  const { resource } = resourceOf(rest)
  return allow(`${phone}|${resource}`, 1000) ? null : `Local safety limit reached (1000 requests per hour for ${resource} on this number). Try again shortly.`
}

const inFlight = new Map<string, Promise<UpstreamReply>>()

/** Meta's 429 is per app and token, shared with everything else using them; a read waits once
 *  (Retry-After, else 2s) and tries again. Writes are never repeated. */
async function callWith429Retry(...args: Parameters<typeof callUpstream>): Promise<UpstreamReply> {
  const r = await callUpstream(...args)
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
  const hit = ttl ? getCached(key) : undefined
  if (hit) {
    res.writeHead(hit.status, { 'content-type': hit.contentType })
    res.end(hit.text)
    return
  }
  const limited = rateLimited(kind, path)
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
    if (ttl && ok) putCached(key, r, ttl)
    // Only settings reads are cached per number, so only a settings write makes them stale.
    if (method !== 'GET' && ok && path.includes('/agent_config/settings')) {
      const { phone } = splitPhone(new URL(path, 'http://x').pathname)
      if (phone) invalidatePhone(phone)
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
    if (traceRoute && !can(s.role, 'traces.read')) return sendError(res, 403, 'Not allowed', 'Only owners and admins can read traces.')
    if (traceRoute) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await readTrace(traceRoute[1])))
    if (metaRoute) {
      const path = resolveIds(metaRoute[2])
      // Several businesses share this server: a workspace may only name its own WABA, numbers and business.
      if (pathIds(path).some((id) => !assets!.ids.has(id))) return sendError(res, 403, 'Not your WhatsApp account', 'That WhatsApp ID isn’t connected to this workspace.')
      // Changing the AI agent is for owners and admins; everyone can look.
      if (req.method !== 'GET' && req.method !== 'HEAD' && !can(s.role, 'agent.edit')) return sendError(res, 403, 'Not allowed', 'Only owners and admins change the AI agent.')
      await forward(req, res, metaRoute[1] as Kind, path)
    }
    else if (await handleHealth(req, res)) return
    else if (await handleNumbers(req, res, me)) return
    else if (await handleWhatsApp(req, res, me)) return
    else if (await handleInbox(req, res, me)) return
    else if (await handleTickets(req, res, me)) return
    else if (await handleContacts(req, res, me)) return
    else if (await handleAssist(req, res, me)) return
    else if (await handleBroadcasts(req, res, me)) return
    else if (await handleBilling(req, res, me)) return
    else if (!(await handleStore(req, res))) res.writeHead(404).end()
  }, assets, { traceId: tid, userId: String(me._id) })
}
