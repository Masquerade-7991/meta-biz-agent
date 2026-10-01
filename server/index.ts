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
import { initDb } from './db.ts'
import { logApiCall, record, resourceOf, splitPhone } from './record.ts'
import { handleStore } from './store.ts'
import { agentUpstream, callUpstream, env, hasToken, ids, resolveIds, setCallLogger, upstream, type Kind } from './upstream.ts'

const PORT = Number(env('SERVER_PORT') || 8787)

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function sendError(res: http.ServerResponse, status: number, title: string, detail: string) {
  // Same StandardError shape Meta uses, so the UI handles one error format.
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ title, detail, status }))
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
    res.writeHead(200, { 'content-type': 'application/json' })
    // IDs aren't secrets; the Create Agent picker shows them. The token never leaves this process.
    res.end(
      JSON.stringify({
        ok: true,
        upstream,
        hasToken,
        businessName: env('BUSINESS_NAME'),
        wabaId: ids.WABA_ID,
        // Display labels for the offline fallback, matching WhatsApp Manager (not IDs, not secrets).
        wabaName: env('WABA_NAME'),
        phoneNumberId: ids.PHONE_NUMBER_ID,
        phoneNumber: env('PHONE_NUMBER'),
        phoneName: env('PHONE_NAME'),
      }),
    )
    return
  }
  if (url.startsWith('/api/meta/')) await forward(req, res, 'meta', resolveIds(url.slice('/api/meta'.length)))
  else if (url.startsWith('/api/graph/')) await forward(req, res, 'graph', resolveIds(url.slice('/api/graph'.length)))
  else if (!(await handleStore(req, res))) res.writeHead(404).end()
})

server.listen(PORT, () => console.log(`API proxy on :${PORT} → graph: ${upstream || '(no upstream set)'} · agent: ${agentUpstream || '(no upstream set)'}`))
if (await initDb()) {
  setCallLogger(logApiCall)
  if (env('COLLECTORS') !== 'off') startCollectors()
} else if (!env('MONGODB_URI')) console.log('No MONGODB_URI: running without a database (store routes return 503)')
