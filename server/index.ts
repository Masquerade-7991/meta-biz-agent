// The API server as a long-running process: npm run dev:server locally, or any Node host. The
// routes live in app.ts; this file adds the port and the background work (jobs, collectors).
// With MONGODB_URI set, traffic is recorded (record.ts) and /api/store/*, /api/analytics/* are served
// from MongoDB. Literal WABA_ID / PHONE_NUMBER_ID / BUSINESS_ID in Meta paths are filled in per workspace.
import http from 'node:http'
import { handle, ready } from './app.ts'
import { startCollectors } from './insights/collectors.ts'
import { resumeBroadcasts } from './outreach/broadcasts.ts'
import { releaseLeases, startJobs } from './platform/jobs.ts'
import { startBilling } from './whatsapp/billing.ts'
import { startHealth } from './whatsapp/health.ts'
import { reprocessWebhooks } from './messaging/inbox.ts'
import { escalateAll } from './support/supportOps.ts'
import { closeStreams } from './platform/stream.ts'
import { closeDb } from './platform/db.ts'
import { agentUpstream, env, upstream } from './whatsapp/upstream.ts'
import { isRole, ROLE, serves } from './platform/roles.ts'

// One stray failure (an unanswered Meta call, a dropped database socket) shouldn't take the whole
// API down: under `node --watch` a crashed server stays down until a file changes, and the console
// then only says it can't reach its servers. Log it and keep serving.
process.on('unhandledRejection', (err) => console.error(`unhandled rejection (kept running): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`))
process.on('uncaughtException', (err) => console.error(`uncaught exception (kept running): ${err.stack ?? err.message}`))

// Hosts like Render hand the port in PORT.
const PORT = Number(env('SERVER_PORT') || env('PORT') || 8787)

const server = http.createServer((req, res) => {
  if (!serves((req.url ?? '/').split('?')[0])) {
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Not served here', detail: `This instance is the ${ROLE} role.`, status: 404 }))
    return
  }
  void handle(req, res)
})
server.listen(PORT, () => console.log(`${ROLE} on :${PORT} → graph: ${upstream || '(no upstream set)'} · agent: ${agentUpstream || '(no upstream set)'}`))

const timers: NodeJS.Timeout[] = []
const stoppers: (() => void)[] = []
// The background work belongs to the worker role (every role when ROLE is unset).
const up = await ready()
if (up && isRole('worker')) {
  await resumeBroadcasts()
  await startBilling()
  await startHealth()
  // JOBS=off: a second copy of the server (e.g. against a stand-in Meta) must not run real jobs.
  if (env('JOBS') !== 'off') timers.push(startJobs())
  // Webhook deliveries stored but not processed are tried again every 5 minutes.
  timers.push(setInterval(() => void reprocessWebhooks().catch(() => 0), 5 * 60_000).unref())
  // Tickets running out of time move up the escalation matrix (supportOps.ts).
  if (env('JOBS') !== 'off') timers.push(setInterval(() => void escalateAll().catch(() => 0), 60_000).unref())
  if (env('COLLECTORS') !== 'off') stoppers.push(startCollectors())
} else if (!up && !env('MONGODB_URI')) console.log('No MONGODB_URI: running without a database (store routes return 503)')

// A deploy or restart (SIGTERM) drains instead of dropping: no new requests, in-flight ones finish,
// running jobs go straight back to the queue, open streams end so browsers reconnect elsewhere.
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`${signal}: shutting down`)
  const force = setTimeout(() => process.exit(1), 10_000).unref()
  server.close()
  timers.forEach(clearInterval)
  stoppers.forEach((stop) => stop())
  closeStreams()
  await releaseLeases()
  await closeDb()?.catch(() => null)
  clearTimeout(force)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
