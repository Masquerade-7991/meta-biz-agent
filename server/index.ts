// The API server as a long-running process: npm run dev:server locally, or any Node host. The
// routes live in app.ts; this file adds the port and the background work (jobs, collectors).
// With MONGODB_URI set, traffic is recorded (record.ts) and /api/store/*, /api/analytics/* are served
// from MongoDB. Literal WABA_ID / PHONE_NUMBER_ID / BUSINESS_ID in Meta paths are filled in per workspace.
import http from 'node:http'
import { handle, ready } from './app.ts'
import { startCollectors } from './collectors.ts'
import { resumeBroadcasts } from './broadcasts.ts'
import { startJobs } from './jobs.ts'
import { startBilling } from './billing.ts'
import { startHealth } from './health.ts'
import { agentUpstream, env, upstream } from './upstream.ts'

// Hosts like Render hand the port in PORT.
const PORT = Number(env('SERVER_PORT') || env('PORT') || 8787)

http.createServer((req, res) => void handle(req, res)).listen(PORT, () => console.log(`API proxy on :${PORT} → graph: ${upstream || '(no upstream set)'} · agent: ${agentUpstream || '(no upstream set)'}`))
if (await ready()) {
  await resumeBroadcasts()
  await startBilling()
  await startHealth()
  // JOBS=off: a second copy of the server (e.g. against a stand-in Meta) must not run real jobs.
  if (env('JOBS') !== 'off') startJobs()
  if (env('COLLECTORS') !== 'off') startCollectors()
} else if (!env('MONGODB_URI')) console.log('No MONGODB_URI: running without a database (store routes return 503)')
