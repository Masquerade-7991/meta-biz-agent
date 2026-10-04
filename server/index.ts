// Thin pass-through to the Meta Business Agent API (or Helo.ai's server in front of it).
// The browser calls /api/meta/<path>; we forward to <upstream>/<path> with the Meta headers.
// /api/graph/<path> goes to <upstream><GRAPH_PREFIX>/<path> (plain Graph API, no X-API-Version).
// Literal WABA_ID / PHONE_NUMBER_ID / BUSINESS_ID segments in <path> are swapped for the .env values,
// so the browser never needs to know them; real IDs pass through. Run: npm run dev:server
// With MONGODB_URI set, successful traffic is also recorded (record.ts), /api/store/* and
// /api/analytics/* are served from MongoDB (store.ts), and collectors run in the background.
import http from 'node:http'
import { allow, getCached, invalidatePhone, putCached, ttlFor } from './cache.ts'
import { startCollectors } from './collectors.ts'
import { getSession, handleAuth } from './auth.ts'
import { db, dbOffReason, initDb, NO_META_ASSETS, withWorkspace } from './db.ts'
import { logApiCall, record, resourceOf, splitPhone } from './record.ts'
import { handleStore } from './store.ts'
import { sendError } from './http.ts'
import { handleInbox, handleWebhook } from './inbox.ts'
import { handleTickets } from './tickets.ts'
import { handleContacts } from './contacts.ts'
import { handleBroadcasts, startBroadcastWorker } from './broadcasts.ts'
import { agentUpstream, callUpstream, env, hasToken, pathIds, resolveIds, setCallLogger, upstream, type Kind } from './upstream.ts'
import { accounts, assetsFor } from './accounts.ts'
import { handleWhatsApp } from './whatsapp.ts'

const PORT = Number(env('SERVER_PORT') || 8787)

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
    const r = await callUpstream(kind, method, path, body, contentType)
    res.writeHead(r.status, { 'content-type': r.contentType })
    res.end(r.text)
    const ok = r.status >= 200 && r.status < 300
    if (ttl && ok) putCached(key, r, ttl)
    if (method !== 'GET' && ok) {
      const { phone } = splitPhone(new URL(path, 'http://x').pathname)
      if (phone) invalidatePhone(phone)
    }
    record({ kind, method, path, reqBody: body, contentType: contentType ?? '', status: r.status, resText: r.text })
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.log(`${method} ${path} → 502 (${detail})`)
    sendError(res, 502, 'Upstream unreachable', `${kind === 'meta' ? agentUpstream : upstream} did not respond. ${detail}`)
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (url === '/api/health') {
    // Public, so a WhatsApp account's labels are only added for members of the workspace it belongs
    // to (the Create Agent fallback and dummy mode use them). Tokens never leave this process.
    const wsId = db ? (await getSession(req).catch(() => null))?.workspace?._id : undefined
    const account = wsId ? await accounts().findOne({ workspaceId: wsId }, { sort: { createdAt: 1 } }) : null
    const number = account?.phoneNumbers[0]
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
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
  if (!s) return sendError(res, 401, 'Not logged in', 'Log in to continue.')
  if (s.setup !== 'complete') return sendError(res, 403, 'Setup not finished', 'Finish setting up your account first.')
  if (!s.workspace) return sendError(res, 403, 'No workspace', 'Create or join a workspace first.')
  const assets = await assetsFor(s.workspace._id)
  const metaRoute = url.match(/^\/api\/(meta|graph)(\/.*)$/)
  if (metaRoute && !assets) return sendError(res, 403, NO_META_ASSETS.title, NO_META_ASSETS.detail)
  const me = { _id: s.user._id, name: s.user.name ?? '', role: s.role }
  await withWorkspace(s.workspace._id, async () => {
    if (metaRoute) {
      const path = resolveIds(metaRoute[2])
      // Several businesses share this server: a workspace may only name its own WABA, numbers and business.
      if (pathIds(path).some((id) => !assets!.ids.has(id))) return sendError(res, 403, 'Not your WhatsApp account', 'That WhatsApp ID isn’t connected to this workspace.')
      await forward(req, res, metaRoute[1] as Kind, path)
    }
    else if (await handleWhatsApp(req, res, me)) return
    else if (await handleInbox(req, res, me)) return
    else if (await handleTickets(req, res, me)) return
    else if (await handleContacts(req, res, me)) return
    else if (await handleBroadcasts(req, res, me)) return
    else if (!(await handleStore(req, res))) res.writeHead(404).end()
  }, assets)
})

server.listen(PORT, () => console.log(`API proxy on :${PORT} → graph: ${upstream || '(no upstream set)'} · agent: ${agentUpstream || '(no upstream set)'}`))
if (await initDb()) {
  setCallLogger(logApiCall)
  startBroadcastWorker()
  if (env('COLLECTORS') !== 'off') startCollectors()
} else if (!env('MONGODB_URI')) console.log('No MONGODB_URI: running without a database (store routes return 503)')
