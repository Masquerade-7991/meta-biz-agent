// The one way to reach Meta (via Helo.ai's server): used by the relay and the collectors, so
// headers, placeholders and timeouts stay the same for both.
import { HttpError, obj, str, type Obj } from './http.ts'
import { currentAssets, traceId } from './context.ts'
try {
  process.loadEnvFile?.('.env')
} catch {
  // no .env: run on the process environment
}
export const env = (k: string) => (process.env[k] ?? '').trim()

// UPSTREAM=meta → straight to Meta with our own token (META_TOKEN or BEARER_TOKEN): agent calls to
// BASE_URL_1 (api.facebook.com), WABA / number lists to Graph. Anything else → BASE_URL_2 (Helo.ai server).
const direct = env('UPSTREAM') === 'meta'
const serverToken = env('META_TOKEN') || env('BEARER_TOKEN')
export const upstream = (direct ? env('GRAPH_BASE_URL') || 'https://graph.facebook.com/v23.0' : env('BASE_URL_2')).replace(/\/+$/, '')
const GRAPH_PREFIX = env('GRAPH_PREFIX').replace(/\/+$/, '')
// Meta Business Agent endpoints live on api.facebook.com, not graph.facebook.com (Graph answers
// "Unknown path components", code 2500). AGENT_BASE_URL points agent calls at a route that reaches
// api.facebook.com; Graph calls (WABA / phone-number lists) keep using the upstream above.
export const agentUpstream = (env('AGENT_BASE_URL') || (direct ? env('BASE_URL_1') : upstream)).replace(/\/+$/, '')
export const hasToken = !!serverToken
/** The server's own WhatsApp account (.env). Requests use their workspace's account instead (context.ts). */
export const envIds: Record<string, string> = {
  WABA_ID: env('WABA_ID'),
  PHONE_NUMBER_ID: env('PHONE_NUMBER_ID'),
  BUSINESS_ID: env('BUSINESS_ID'),
}

/** Swaps literal WABA_ID / PHONE_NUMBER_ID / BUSINESS_ID path segments for the current workspace's
 *  account (outside any workspace, e.g. a diagnostic script, for the .env account). */
export function resolveIds(rest: string) {
  const a = currentAssets()
  const ids = a === undefined ? envIds : { WABA_ID: a?.wabaId ?? '', PHONE_NUMBER_ID: a?.phoneNumberId ?? '', BUSINESS_ID: a?.businessId ?? '' }
  return rest.replace(/\/(WABA_ID|PHONE_NUMBER_ID|BUSINESS_ID)(?=\/|\?|$)/g, (_, k: string) => '/' + ids[k as keyof typeof ids])
}

/** Real IDs named in a path (long numeric segments), e.g. /123456789012345/agent_config. */
export const pathIds = (path: string) => (path.split('?')[0].match(/\/\d{10,}(?=\/|$)/g) ?? []).map((s) => s.slice(1))

/** The token for a call: the account the path names, else the workspace's default, else the server's. */
function tokenFor(path: string) {
  const a = currentAssets()
  if (!a) return serverToken
  for (const id of pathIds(path)) if (a.tokens.has(id)) return a.tokens.get(id) ?? serverToken
  return a.token ?? serverToken
}

export type Kind = 'meta' | 'graph'
export interface UpstreamReply {
  status: number
  text: string
  contentType: string
}

export const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** One call to Meta, as the api_calls log stores it (no token, no bodies). */
export interface CallLog {
  at: Date
  source: 'relay' | 'collector'
  kind: Kind
  method: string
  url: string
  status: number // 0 = no answer (network error or timeout)
  ms: number
  error?: string
  fbtraceId?: string
}
// Set by the server once MongoDB is up (record.ts writes to api_calls); a no-op until then.
let logCall: (c: CallLog) => void = () => {}
export const setCallLogger = (f: (c: CallLog) => void) => void (logCall = f)
// Token-like query params never reach the log.
const safeUrl = (u: string) => u.replace(/([?&](?:access_token|input_token)=)[^&]*/g, '$1<hidden>')

/** `path` is already resolved (real IDs). Throws on network failure or timeout. */
export async function callUpstream(
  kind: Kind,
  method: string,
  path: string,
  body?: Buffer,
  contentType?: string,
  source: CallLog['source'] = 'relay',
): Promise<UpstreamReply> {
  const headers: Record<string, string> = {}
  // Thread Control is the one endpoint on the 1.0.0 contract; Graph calls send no version.
  if (kind === 'meta') headers['X-API-Version'] = path.includes('/thread_control') ? '1.0.0' : '2.0.0'
  if (contentType) headers['content-type'] = contentType
  const token = tokenFor(path)
  if (token) headers.authorization = `Bearer ${token}`
  const target = (kind === 'meta' ? agentUpstream : upstream + GRAPH_PREFIX) + path
  // A test message waits for the agent's model to answer (25 s seen on the real agent); others are quick.
  const timeout = path.includes('/agent_test') ? 90_000 : 20_000
  const at = new Date()
  const base = { at, source, kind, method, url: safeUrl(target) }
  try {
    const r = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(timeout) })
    const text = await r.text()
    console.log(`[${traceId()?.slice(0, 8) ?? '-'}] ${method} ${safeUrl(target)} → ${r.status}`)
    // Errors keep Meta's message and trace id (StandardError {title, detail, fbtrace_id} or Graph {error: {...}}).
    const e = r.ok ? null : (parseJson(text) as { title?: string; detail?: string; fbtrace_id?: string; error?: { message?: string; fbtrace_id?: string } } | null)
    logCall({
      ...base,
      status: r.status,
      ms: Date.now() - at.getTime(),
      ...(e ? { error: [e.title, e.detail ?? e.error?.message].filter(Boolean).join(': ').slice(0, 500) || text.slice(0, 300) } : {}),
      ...(e?.fbtrace_id || e?.error?.fbtrace_id ? { fbtraceId: e.fbtrace_id ?? e.error?.fbtrace_id } : {}),
    })
    return { status: r.status, text, contentType: r.headers.get('content-type') ?? 'application/json' }
  } catch (err) {
    logCall({ ...base, status: 0, ms: Date.now() - at.getTime(), error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
    throw err
  }
}
/**
 * Calls Meta on behalf of a route and returns the parsed JSON. A refusal throws an HttpError with
 * Meta's own words: 400 stays 400, anything else becomes 502 (or `failStatus` when given).
 */
export async function metaJson(kind: Kind, method: string, path: string, body?: Obj, failStatus?: number): Promise<Obj> {
  const r = await callUpstream(kind, method, resolveIds(path), body && Buffer.from(JSON.stringify(body)), body && 'application/json')
  const json = obj(parseJson(r.text))
  if (r.status >= 300) {
    const e = obj(json.error)
    throw new HttpError(failStatus ?? (r.status === 400 ? 400 : 502), str(e.error_user_msg) ?? str(e.message) ?? `${kind === 'graph' ? 'WhatsApp' : 'Meta'} answered ${r.status}.`, typeof e.code === 'number' ? e.code : undefined)
  }
  return json
}

/** The token calls about `id` (a number, WABA or business) use, and the Graph base URL: for the few
 *  calls that can't go through metaJson (Resumable Upload names the app, not the number). */
export const tokenForId = (id: string) => tokenFor(`/${id}`)
export const graphBase = () => upstream + GRAPH_PREFIX

/** Downloads a file Meta hosts (a media URL from GET /<media-id>), with the workspace's token. */
export async function downloadMeta(url: string): Promise<{ buf: Buffer; mime: string }> {
  const token = tokenFor('')
  const at = new Date()
  const r = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(60_000) })
  logCall({ at, source: 'relay', kind: 'graph', method: 'GET', url: safeUrl(url.split('?')[0]), status: r.status, ms: Date.now() - at.getTime() })
  if (!r.ok) throw new HttpError(502, `WhatsApp didn’t hand over the file (${r.status}).`)
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') ?? 'application/octet-stream' }
}

export async function metaGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const r = await callUpstream('meta', 'GET', path, undefined, undefined, 'collector').catch((err: unknown) => Promise.reject(Object.assign(new Error(String(err)), { down: true })))
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status} for ${path}`), { status: r.status })
  return parseJson(r.text) as T
}
