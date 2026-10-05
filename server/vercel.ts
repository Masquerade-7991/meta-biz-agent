// The API as a Vercel Function (api/server.mjs loads the bundle of this file; see
// scripts/bundle-server.mjs). vercel.json sends every /api/<path> here as /api/server?p=<path>.
// There's no long-running process on Vercel, so background jobs (broadcast sending, snoozes,
// reminders, syncs) run in short bursts after requests, plus a daily cron as a safety net.
import type http from 'node:http'
import { handle, ready } from './app.ts'
import { db } from './db.ts'
import { jobsTick } from './jobs.ts'
import { resumeBroadcasts } from './broadcasts.ts'
import { startBilling } from './billing.ts'
import { startHealth } from './health.ts'
import { runOnce } from './collectors.ts'
import { env } from './upstream.ts'

let lastKick = 0

export default async function vercel(req: http.IncomingMessage, res: http.ServerResponse) {
  // Put back the address the browser asked for.
  const u = new URL(req.url ?? '/', 'http://x')
  if (u.pathname === '/api/server') {
    // Vercel may pass the captured path more than once; every copy is ours, not the browser's.
    const p = u.searchParams.get('p') ?? ''
    u.searchParams.delete('p')
    req.url = `/api/${p}${u.search}`
  }
  if (req.url?.split('?')[0] === '/api/cron') return cron(req, res)
  await ready()
  await handle(req, res)
  // The answer is already sent; due jobs get a few seconds, at most every 15 s per instance.
  if (db && Date.now() - lastKick > 15_000) {
    lastKick = Date.now()
    await jobsTick(8_000).catch(() => 0)
  }
}

/** Vercel Cron (vercel.json): makes sure the recurring jobs exist, runs what's due, and collects
 *  Meta's metrics. Only Vercel may call it (Authorization: Bearer CRON_SECRET). */
async function cron(req: http.IncomingMessage, res: http.ServerResponse) {
  const secret = env('CRON_SECRET')
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Not allowed', detail: 'Cron only.' }))
    return
  }
  if (!(await ready())) {
    res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Database unavailable', detail: 'MongoDB didn’t answer.' }))
    return
  }
  await resumeBroadcasts()
  await startBilling()
  await startHealth()
  const ran = await jobsTick(40_000)
  for (const job of ['metrics', 'handoffs', 'connectorLogs', 'traces'] as const) await runOnce(job)
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, jobs: ran }))
}
