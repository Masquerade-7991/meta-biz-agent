// HTTP plumbing every route module shares: an error that carries its status, JSON in and out,
// loose-JSON readers, and serveJson, the one wrapper that turns a route function into a handler.
// Imports nothing from the app, so any module can use it.
import type http from 'node:http'

export type Obj = Record<string, unknown>
export const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
export const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Every error body has Meta's StandardError shape, so the UI handles one format. */
export function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}
export const sendError = (res: http.ServerResponse, status: number, title: string, detail: string) => send(res, status, { title, detail, status })

const MAX_BODY = 1024 * 1024
export async function readJson(req: http.IncomingMessage): Promise<unknown> {
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

/** Titles shown above an error's detail, per status; each module adds its own wording. */
export type Titles = Record<number, string>

/**
 * Answers one request with `run`'s result as JSON. A thrown HttpError becomes {title, detail, status}
 * with the title from `titles`; anything else is logged and answered with `unexpected` (default: 500
 * "Something went wrong"). Without a database it answers 503 with `noDb` and `run` never starts.
 */
export async function serveJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  o: { titles: Titles; db: unknown; noDb: { title: string; detail: string }; unexpected?: (err: unknown) => { status: number; title: string; detail: string } },
  run: () => Promise<unknown>,
): Promise<true> {
  if (!o.db) {
    sendError(res, 503, o.noDb.title, o.noDb.detail)
    return true
  }
  try {
    send(res, 200, await run())
  } catch (err) {
    if (err instanceof HttpError) sendError(res, err.status, o.titles[err.status] ?? 'Error', err.message)
    else {
      const e = o.unexpected?.(err) ?? { status: 500, title: 'Something went wrong', detail: 'Please try again.' }
      console.log(`${req.method} ${new URL(req.url ?? '/', 'http://x').pathname} → ${e.status} (${err instanceof Error ? err.message : err})`)
      sendError(res, e.status, e.title, e.detail)
    }
  }
  return true
}
