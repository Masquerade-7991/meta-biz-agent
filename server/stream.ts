// GET /api/stream: Server-Sent Events for the signed-in member's workspace. Every trace() event
// (trace.ts) is pushed as it happens, so screens refresh on change instead of on a timer.
// Clients reconnect on their own (EventSource); a comment line every 25 s keeps proxies from closing it.
import type http from 'node:http'
import { ws } from './db.ts'
import { subscribe, type TraceEvent } from './trace.ts'

const open = new Set<http.ServerResponse>()
/** Ends every open stream (shutdown); browsers reconnect to the next instance on their own. */
export function closeStreams() {
  for (const res of open) res.end()
  open.clear()
}

export function handleStream(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== 'GET' || new URL(req.url ?? '/', 'http://x').pathname !== '/api/stream') return false
  // Serverless (Vercel): no long-lived process to hold the stream, and events from other instances
  // wouldn't reach it. 204 tells the browser's EventSource to stop; screens keep polling instead.
  if (process.env.VERCEL) {
    res.writeHead(204).end()
    return true
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  res.write('retry: 5000\n\n')
  const w = ws()
  const push = (e: TraceEvent) => res.write(`data: ${JSON.stringify({ kind: e.kind, entity: e.entity, entityId: e.entityId, data: e.data, at: e.at, traceId: e.traceId })}\n\n`)
  const off = subscribe(w, push)
  open.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(ping)
    off()
    open.delete(res)
  })
  return true
}
